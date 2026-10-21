import { execFile, spawn, type ChildProcess } from "child_process";
import { arch, platform } from "os";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SCRIPT = fileURLToPath(
  new URL("../../scripts/mlx-audio-worker.py", import.meta.url)
);

interface MlxModel {
  repo: string;
  /** Pinned Hugging Face revision, so results stay reproducible */
  revision: string;
  /** Qwen3-ASR takes an explicit language name; Voxtral Realtime always auto-detects */
  takesLanguage: boolean;
  languages: string[];
}

// Same repos as TypeWhisper's Qwen3 and Voxtral plugins.
const QWEN3_LANGUAGES: Record<string, string> = {
  en: "English",
  de: "German",
  ru: "Russian",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
};

export const MLX_MODELS: Record<string, MlxModel> = {
  "qwen3-asr-0.6b-8bit": {
    repo: "mlx-community/Qwen3-ASR-0.6B-8bit",
    revision: "89e96d92ba34aca20b3e29fb10cc284097d1219f",
    takesLanguage: true,
    languages: Object.keys(QWEN3_LANGUAGES),
  },
  "qwen3-asr-1.7b-8bit": {
    repo: "mlx-community/Qwen3-ASR-1.7B-8bit",
    revision: "a8379a2e2f9e313c9292cdf1af4055ab56d50d55",
    takesLanguage: true,
    languages: Object.keys(QWEN3_LANGUAGES),
  },
  "voxtral-mini-4b-realtime-4bit": {
    repo: "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
    revision: "fdebf7b2af834a1db4b8a3c99ab7480b333adf9e",
    takesLanguage: false,
    languages: ["en", "de", "ru", "fr", "es", "it", "pt", "auto"],
  },
};

interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * MLX models run in a long-lived Python worker (started via uv). Timing is measured inside
 * the worker and excludes Python startup, model download and loading.
 */
export class MlxAudioProvider implements STTProvider {
  id = "mlx-audio";
  name = "MLX Audio";
  type = "local" as const;
  models = Object.keys(MLX_MODELS);

  private uvPath: string;
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;

  constructor(uvPath?: string) {
    this.uvPath = uvPath || process.env.MLX_AUDIO_UV_PATH || "uv";
  }

  async isAvailable(): Promise<boolean> {
    if (platform() !== "darwin" || arch() !== "arm64") return false;
    try {
      await execFileAsync(this.uvPath, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  supportsLanguage(model: string, language: string): boolean {
    return MLX_MODELS[model]?.languages.includes(language) ?? false;
  }

  async prepare(model: string): Promise<void> {
    const entry = this.entry(model);
    const res = await this.request({ load: "1", repo: entry.repo, revision: entry.revision });
    if (res.error) throw new Error(String(res.error));
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = this.entry(model);

    const res = await this.request({
      repo: entry.repo,
      revision: entry.revision,
      file: audio.filePath,
      language: entry.takesLanguage ? QWEN3_LANGUAGES[audio.language] : undefined,
    });
    if (res.error) throw new Error(String(res.error));

    return {
      text: (res.text ?? "").trim(),
      durationMs: Math.round(res.durationMs ?? 0),
      cost: 0,
      model,
    };
  }

  private entry(model: string): MlxModel {
    const entry = MLX_MODELS[model];
    if (!entry) {
      throw new Error(`Unknown MLX model '${model}'. Available: ${this.models.join(", ")}`);
    }
    return entry;
  }

  private async request(payload: Record<string, string | undefined>): Promise<WorkerResponse> {
    await this.startWorker();
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: "mlx-audio worker is not running" };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `mlx-audio worker write failed: ${err.message}` });
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
      const worker = spawn(this.uvPath, ["run", "--quiet", "--script", WORKER_SCRIPT], {
        stdio: ["pipe", "pipe", "inherit"],
      });
      this.worker = worker;
      const fail = (error: string) => {
        rejectReady(new Error(error));
        for (const resolvePending of this.pending.values()) resolvePending({ error });
        this.pending.clear();
        this.worker = undefined;
        this.ready = undefined;
      };
      // A missing uv binary or a dead pipe must fail the requests, not crash the benchmark.
      worker.on("error", (err) => fail(`mlx-audio worker failed to start: ${err.message}`));
      worker.stdin?.on("error", (err) => fail(`mlx-audio worker stdin error: ${err.message}`));

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

      worker.on("exit", (code) => fail(`mlx-audio worker exited with code ${code}`));
    });

    return this.ready;
  }
}
