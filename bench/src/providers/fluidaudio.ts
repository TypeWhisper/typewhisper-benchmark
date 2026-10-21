import { execFile, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { arch, platform } from "os";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(
  new URL("../../../models/fluidaudio", import.meta.url)
);
const WORKER_PACKAGE = fileURLToPath(new URL("../../fluidaudio-worker", import.meta.url));
const WORKER_BINARY = join(WORKER_PACKAGE, ".build", "release", "FluidAudioWorker");

export interface FluidAudioModel {
  /** Official FluidInference Core ML repo that FluidAudio downloads itself */
  official?: "v2" | "v3" | "ultra";
  /** Folder under the models path, prepared by download-fluidaudio-models.sh */
  local?: string;
  /** FluidAudio decode contract for local folders */
  version?: "v3" | "ultra";
  /** Leading silence the model card evaluated with */
  leadPadSeconds?: number;
  /** Encoder function for clips up to 8 s (multifunction encoders) */
  shortFunction?: string;
  /** null = multilingual (runs every suite); otherwise trained languages */
  languages: string[] | null;
}

// Same runtime TypeWhisper's Parakeet plugin uses (FluidAudio 0.17.5 on the Neural Engine).
export const FLUIDAUDIO_MODELS: Record<string, FluidAudioModel> = {
  "parakeet-tdt-0.6b-v3": { official: "v3", languages: null },
  "parakeet-tdt-0.6b-v2": { official: "v2", languages: ["en"] },
  "parakeet-ultra": { official: "ultra", languages: null },
  // FluidVoice-Labs fine-tune of Parakeet Ultra. Its joint has no top-K outputs, which is fine
  // because no language hint is passed.
  "fluid-speech-mini": { local: "fluid-speech-mini", version: "ultra", languages: ["en"] },
  // ConwayResearch fine-tune of Parakeet v3; its runner loads it as `.ultra`, adds 0.25 s of
  // leading silence and uses the `short8` encoder function for clips up to 8 s.
  "bark-3.0-pro": {
    local: "bark-3.0-pro",
    version: "ultra",
    leadPadSeconds: 0.25,
    shortFunction: "short8",
    languages: ["en"],
  },
};

export function getFluidAudioModelsBasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.FLUIDAUDIO_MODELS_PATH) return DEFAULT_MODELS_BASE_PATH;
  return resolve(REPO_ROOT, env.FLUIDAUDIO_MODELS_PATH);
}

/** Local folders need a compiled encoder; official models download on first use. */
export function hasFluidAudioModelFiles(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  const entry = FLUIDAUDIO_MODELS[model];
  if (!entry) return false;
  if (!entry.local) return true;
  return fileExists(join(getFluidAudioModelsBasePath(env), entry.local, "Encoder.mlmodelc"));
}

interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Parakeet-family Core ML models through FluidAudio, in a long-lived Swift worker. Timing is
 * measured inside the worker around the transcription call and excludes building the worker,
 * downloading, loading, prewarming and reading the audio file.
 */
export class FluidAudioProvider implements STTProvider {
  id = "fluidaudio";
  name = "FluidAudio";
  type = "local" as const;
  models = Object.keys(FLUIDAUDIO_MODELS);

  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private built?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;

  async isAvailable(): Promise<boolean> {
    if (platform() !== "darwin" || arch() !== "arm64") return false;
    try {
      await execFileAsync("swift", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  // English-only fine-tunes still run on other explicit languages so the benchmark documents
  // how they behave there; only auto-detect is reserved for the multilingual models.
  supportsLanguage(model: string, language: string): boolean {
    const entry = FLUIDAUDIO_MODELS[model];
    if (!entry) return false;
    if (entry.languages == null) return true;
    return language !== "auto";
  }

  async prepare(model: string): Promise<void> {
    const res = await this.request({ ...this.spec(model), load: true });
    if (res.error) throw new Error(res.error);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const res = await this.request({ ...this.spec(model), file: audio.filePath });
    if (res.error) throw new Error(res.error);
    return {
      text: (res.text ?? "").trim(),
      durationMs: Math.round(res.durationMs ?? 0),
      cost: 0,
      model,
    };
  }

  /** Stops the worker after a run, including one stuck on a request that timed out. */
  dispose(): void {
    const worker = this.worker;
    if (!worker) return;
    for (const resolvePending of this.pending.values()) resolvePending({ error: "FluidAudio worker stopped" });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private spec(model: string): Record<string, unknown> {
    const entry = FLUIDAUDIO_MODELS[model];
    if (!entry) {
      throw new Error(`Unknown FluidAudio model '${model}'. Available: ${this.models.join(", ")}`);
    }
    const base = getFluidAudioModelsBasePath();
    if (!hasFluidAudioModelFiles(model)) {
      throw new Error(
        `Model files not found for '${model}'. Run: bash bench/scripts/download-fluidaudio-models.sh`
      );
    }
    return entry.official
      ? { model, official: entry.official, modelsRoot: base }
      : {
          model,
          local: join(base, entry.local!),
          version: entry.version,
          leadPadSeconds: entry.leadPadSeconds,
          shortFunction: entry.shortFunction,
        };
  }

  /** Build the worker once (the first build compiles FluidAudio and takes a few minutes). */
  private build(): Promise<void> {
    this.built ??= execFileAsync(
      "swift",
      ["build", "-c", "release", "--package-path", WORKER_PACKAGE],
      { maxBuffer: 64 * 1024 * 1024 }
    ).then(() => undefined);
    return this.built;
  }

  private async request(payload: Record<string, unknown>): Promise<WorkerResponse> {
    try {
      await this.startWorker();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: "FluidAudio worker is not running" };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `FluidAudio worker write failed: ${err.message}` });
      });
    });
  }

  private settle(id: number, res: WorkerResponse): void {
    this.pending.get(id)?.(res);
    this.pending.delete(id);
    if (this.pending.size === 0) this.keepAlive(false);
  }

  /** Keep the benchmark alive while the worker starts or has requests, not once it is idle. */
  private keepAlive(active: boolean): void {
    const handles = [this.worker, this.worker?.stdin, this.worker?.stdout] as any[];
    for (const handle of handles) active ? handle?.ref?.() : handle?.unref?.();
  }

  private startWorker(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = this.build().then(
      () =>
        new Promise<void>((resolveReady, rejectReady) => {
          const worker = spawn(WORKER_BINARY, [], { stdio: ["pipe", "pipe", "inherit"] });
          this.worker = worker;
          const fail = (error: string) => {
            rejectReady(new Error(error));
            for (const resolvePending of this.pending.values()) resolvePending({ error });
            this.pending.clear();
            this.worker = undefined;
            this.ready = undefined;
          };
          // A dead pipe must fail the requests, not crash the benchmark.
          worker.on("error", (err) => fail(`FluidAudio worker failed to start: ${err.message}`));
          worker.stdin?.on("error", (err) => fail(`FluidAudio worker stdin error: ${err.message}`));

          process.once("exit", () => worker.kill());

          createInterface({ input: worker.stdout! }).on("line", (line) => {
            let res: WorkerResponse;
            try {
              res = JSON.parse(line);
            } catch {
              return; // ignore stray library output
            }
            if (res.ready) {
              if (this.pending.size === 0) this.keepAlive(false);
              resolveReady();
              return;
            }
            if (res.id != null) this.settle(res.id, res);
          });

          worker.on("exit", (code) => fail(`FluidAudio worker exited with code ${code}`));
        })
    );
    this.ready.catch(() => {
      this.ready = undefined;
      this.built = undefined;
    });

    return this.ready;
  }
}
