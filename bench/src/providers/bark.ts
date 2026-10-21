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
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(new URL("../../../models/bark", import.meta.url));
const WORKER_SCRIPT = fileURLToPath(new URL("../../scripts/bark-coreml-worker.py", import.meta.url));

export function getBarkModelsBasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.BARK_MODELS_PATH) return DEFAULT_MODELS_BASE_PATH;
  return resolve(REPO_ROOT, env.BARK_MODELS_PATH);
}

export function hasBarkModelFiles(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  return fileExists(join(getBarkModelsBasePath(env), model, "coreml", "ane", "bark_coreml.py"));
}

interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Underdog Bark 3.0 and 3.0 Plus (ConwayResearch) through the Core ML runner their model repos
 * ship, in a long-lived Python worker (started via uv). Their encoder takes features rather than
 * FluidAudio's mel contract, so they cannot run through FluidAudio; Bark 3.0 Pro can and lives in
 * the fluidaudio provider. Timing is measured inside the worker and excludes Python startup,
 * model loading and reading the audio file, but includes the numpy feature extraction and decoder.
 */
export class BarkProvider implements STTProvider {
  id = "bark";
  name = "Underdog Bark (Core ML)";
  type = "local" as const;
  models = ["3.0", "3.0-plus"];

  private uvPath: string;
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;

  constructor(uvPath?: string) {
    this.uvPath = uvPath || process.env.BARK_UV_PATH || "uv";
  }

  async isAvailable(): Promise<boolean> {
    if (platform() !== "darwin" || arch() !== "arm64") return false;
    try {
      await execFileAsync(this.uvPath, ["--version"]);
      return this.models.some((model) => hasBarkModelFiles(model));
    } catch {
      return false;
    }
  }

  // English-only models; they still run on other explicit languages so the benchmark documents
  // how they behave there.
  supportsLanguage(model: string, language: string): boolean {
    return this.models.includes(model) && language !== "auto";
  }

  async prepare(model: string): Promise<void> {
    const res = await this.request({ model: this.checked(model), load: true });
    if (res.error) throw new Error(res.error);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const res = await this.request({ model: this.checked(model), file: audio.filePath });
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
    for (const resolvePending of this.pending.values()) resolvePending({ error: "Bark worker stopped" });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private checked(model: string): string {
    if (!this.models.includes(model)) {
      throw new Error(`Unknown Bark model '${model}'. Available: ${this.models.join(", ")}`);
    }
    if (!hasBarkModelFiles(model)) {
      throw new Error(`Model files not found for '${model}'. Run: bash bench/scripts/download-bark-models.sh`);
    }
    return model;
  }

  private async request(payload: Record<string, unknown>): Promise<WorkerResponse> {
    await this.startWorker();
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: "Bark worker is not running" };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `Bark worker write failed: ${err.message}` });
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

    this.ready = new Promise((resolveReady, rejectReady) => {
      const worker = spawn(
        this.uvPath,
        ["run", "--quiet", "--script", WORKER_SCRIPT, getBarkModelsBasePath()],
        { stdio: ["pipe", "pipe", "inherit"] }
      );
      this.worker = worker;
      const fail = (error: string) => {
        // A start that is still waiting must fail, even for a replaced worker.
        rejectReady(new Error(error));
        // An error and the exit that follows, or a late exit after dispose(), must not
        // touch the state of a worker that replaced this one.
        if (this.worker !== worker) return;
        for (const resolvePending of this.pending.values()) resolvePending({ error });
        this.pending.clear();
        this.worker = undefined;
        this.ready = undefined;
        // After a broken pipe the process may still run; do not leave it behind.
        worker.kill();
      };
      // A missing uv binary or a dead pipe must fail the requests, not crash the benchmark.
      worker.on("error", (err) => fail(`Bark worker failed to start: ${err.message}`));
      worker.stdin?.on("error", (err) => fail(`Bark worker stdin error: ${err.message}`));

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

      worker.on("exit", (code) => fail(`Bark worker exited with code ${code}`));
    });

    return this.ready;
  }
}
