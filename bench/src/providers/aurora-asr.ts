import { execFile, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { join, resolve } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(
  new URL("../../../models/aurora-asr", import.meta.url)
);
const WORKER_SCRIPT = fileURLToPath(
  new URL("../../scripts/aurora-asr-worker.py", import.meta.url)
);

export function getAuroraAsrModelsBasePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!env.AURORA_ASR_MODELS_PATH) {
    return DEFAULT_MODELS_BASE_PATH;
  }
  return resolve(REPO_ROOT, env.AURORA_ASR_MODELS_PATH);
}

export function hasAuroraAsrModelFiles(
  models: string[],
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  const base = getAuroraAsrModelsBasePath(env);
  return models.some((model) =>
    fileExists(join(base, model, "model.safetensors"))
  );
}

interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * AuroraASR-1M runs in PyTorch, so a long-lived Python worker (started via uv) serves all
 * requests. Timing is measured inside the worker and excludes Python startup and model loading.
 */
export class AuroraAsrProvider implements STTProvider {
  id = "aurora-asr";
  name = "AuroraASR";
  type = "local" as const;
  models = ["1m-fp32", "1m-int8"];

  private uvPath: string;
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;

  constructor(uvPath?: string) {
    this.uvPath = uvPath || process.env.AURORA_ASR_UV_PATH || "uv";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.uvPath, ["--version"]);
      return hasAuroraAsrModelFiles(this.models.map(modelDir));
    } catch {
      return false;
    }
  }

  // The model is English-only, but it still runs on other explicit languages so the
  // benchmark documents how it behaves there instead of silently skipping them.
  supportsLanguage(_model: string, language: string): boolean {
    return language !== "auto";
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    if (!this.models.includes(model)) {
      throw new Error(
        `Unknown AuroraASR model '${model}'. Available: ${this.models.join(", ")}`
      );
    }
    if (!hasAuroraAsrModelFiles([modelDir(model)])) {
      throw new Error(
        `Model files not found for '${model}'. Run: bash bench/scripts/download-aurora-asr-models.sh`
      );
    }

    const res = await this.request({ model: modelDir(model), file: audio.filePath });
    if (res.error) throw new Error(res.error);

    return {
      text: (res.text ?? "").trim(),
      durationMs: Math.round(res.durationMs ?? 0),
      cost: 0,
      model,
    };
  }

  /**
   * Stops the worker, which holds every model it loaded and may still be working on a request
   * that timed out. The next request starts a new worker.
   */
  async release(_model?: string): Promise<void> {
    const worker = this.worker;
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
    await new Promise<void>((resolveExit) => {
      const force = setTimeout(() => worker.kill("SIGKILL"), 5_000);
      worker.once("exit", () => {
        clearTimeout(force);
        resolveExit();
      });
      worker.kill();
    });
  }

  dispose(): void {
    this.worker?.kill();
  }

  private async request(payload: { model: string; file: string }): Promise<WorkerResponse> {
    await this.startWorker();
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.worker!.stdin!.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }

  private startWorker(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise((resolveReady, rejectReady) => {
      const worker = spawn(
        this.uvPath,
        ["run", "--quiet", "--script", WORKER_SCRIPT, getAuroraAsrModelsBasePath()],
        { stdio: ["pipe", "pipe", "inherit"] }
      );
      this.worker = worker;

      // Do not keep the benchmark process alive once all work is done.
      worker.unref();
      (worker.stdin as any)?.unref?.();
      (worker.stdout as any)?.unref?.();
      process.once("exit", () => worker.kill());

      createInterface({ input: worker.stdout! }).on("line", (line) => {
        let res: WorkerResponse;
        try {
          res = JSON.parse(line);
        } catch {
          return; // ignore stray library output
        }
        if (res.ready) {
          resolveReady();
          return;
        }
        if (res.id != null) {
          this.pending.get(res.id)?.(res);
          this.pending.delete(res.id);
        }
      });

      worker.on("exit", (code) => {
        const error = `AuroraASR worker exited with code ${code}`;
        rejectReady(new Error(error));
        for (const resolvePending of this.pending.values()) resolvePending({ error });
        this.pending.clear();
        this.worker = undefined;
        this.ready = undefined;
      });
    });

    return this.ready;
  }
}

function modelDir(model: string): string {
  return model.replace(/^1m-/, "");
}
