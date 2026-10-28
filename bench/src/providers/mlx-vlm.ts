import { execFile, spawn, type ChildProcess } from "child_process";
import { arch, platform } from "os";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SCRIPT = fileURLToPath(
  new URL("../../scripts/mlx-vlm-worker.py", import.meta.url)
);

interface VlmModel {
  repo: string;
  /** Pinned Hugging Face revision, so results stay reproducible */
  revision: string;
  languages: string[];
}

// LFM3-Audio is prompted per task: "Perform ASR in <language>." with the English language name,
// or "Perform ASR." to let the model infer the language. Its speech languages include English and
// German but not Russian, so the Russian suites are skipped.
const LFM3_LANGUAGES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
};
const LFM3_SUITE_LANGUAGES = [...Object.keys(LFM3_LANGUAGES), "auto"];

// Liquid's own MLX builds of LFM3-Audio-2B (LFM Open License v1.0). Liquid recommends 8-bit;
// 4-bit quantizes the language backbone only and keeps the audio encoder in bf16.
export const VLM_MODELS: Record<string, VlmModel> = {
  "lfm3-audio-2b-8bit": {
    repo: "LiquidAI/LFM3-Audio-2B-MLX-8bit",
    revision: "22d2992154da0c0171c2c30710cc68d211e7e8e4",
    languages: LFM3_SUITE_LANGUAGES,
  },
  "lfm3-audio-2b-4bit": {
    repo: "LiquidAI/LFM3-Audio-2B-MLX-4bit",
    revision: "f73a8a6666f3160377d20b4119035b23d6533cc6",
    languages: LFM3_SUITE_LANGUAGES,
  },
  "lfm3-audio-2b-bf16": {
    repo: "LiquidAI/LFM3-Audio-2B-MLX-bf16",
    revision: "e9a4a12b6fbd1924d4a5dccd0b3417a2bf41eff0",
    languages: LFM3_SUITE_LANGUAGES,
  },
};

/** The model card's ASR system prompt for one suite language. */
export function asrSystemPrompt(language: string): string {
  const name = LFM3_LANGUAGES[language];
  return name ? `Perform ASR in ${name}.` : "Perform ASR.";
}

// The token limit of the model card's ASR example.
const MAX_TOKENS = 1024;

// generate() cannot be interrupted, so a request that runs past its deadline stops the worker and
// the next request starts a fresh one. Transcription stays below the runner's default 120 s timeout,
// so a stuck clip cannot hold up the clips after it. Preparation covers dependency setup, download
// and loading.
const DEFAULT_TIMEOUTS = { prepareMs: 30 * 60_000, transcribeMs: 110_000 };

interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Audio language models in a long-lived mlx-vlm worker (started via uv). Timing is measured inside
 * the worker (prompt rendering and generate()) and excludes Python startup, download and loading.
 */
export class MlxVlmProvider implements STTProvider {
  id = "mlx-vlm";
  name = "MLX-VLM";
  type = "local" as const;
  models = Object.keys(VLM_MODELS);

  private uvPath: string;
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;
  private timeouts: typeof DEFAULT_TIMEOUTS;

  constructor(uvPath?: string, timeouts: Partial<typeof DEFAULT_TIMEOUTS> = {}) {
    this.uvPath = uvPath || process.env.MLX_VLM_UV_PATH || "uv";
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
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
    return VLM_MODELS[model]?.languages.includes(language) ?? false;
  }

  async prepare(model: string): Promise<void> {
    const entry = this.entry(model);
    const res = await this.request(
      { load: "1", repo: entry.repo, revision: entry.revision },
      this.timeouts.prepareMs
    );
    if (res.error) throw new Error(String(res.error));
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = this.entry(model);

    const res = await this.request(
      {
        repo: entry.repo,
        revision: entry.revision,
        file: audio.filePath,
        system: asrSystemPrompt(audio.language),
        options: { max_tokens: MAX_TOKENS },
      },
      this.timeouts.transcribeMs
    );
    if (res.error) throw new Error(String(res.error));

    return {
      text: (res.text ?? "").trim(),
      durationMs: Math.round(res.durationMs ?? 0),
      cost: 0,
      model,
    };
  }

  /** Stops the worker, so requests that timed out in the runner cannot keep the process alive. */
  dispose(): void {
    const worker = this.worker;
    if (!worker) return;
    for (const resolvePending of this.pending.values()) resolvePending({ error: "mlx-vlm worker stopped" });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private entry(model: string): VlmModel {
    const entry = VLM_MODELS[model];
    if (!entry) {
      throw new Error(`Unknown MLX-VLM model '${model}'. Available: ${this.models.join(", ")}`);
    }
    return entry;
  }

  /** Sends one request; past the deadline it stops the worker and answers with an error. */
  private async request(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerResponse> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<WorkerResponse>((resolveDeadline) => {
      timer = setTimeout(() => {
        resolveDeadline({ error: `mlx-vlm worker did not answer within ${timeoutMs / 1000} s` });
        this.dispose();
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.send(payload), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async send(payload: Record<string, unknown>): Promise<WorkerResponse> {
    await this.startWorker();
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: "mlx-vlm worker is not running" };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `mlx-vlm worker write failed: ${err.message}` });
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
        // Several events can report the same dead worker; only the current one resets state.
        if (this.worker !== worker) return;
        rejectReady(new Error(error));
        for (const resolvePending of this.pending.values()) resolvePending({ error });
        this.pending.clear();
        this.worker = undefined;
        this.ready = undefined;
      };
      // A missing uv binary or a dead pipe must fail the requests, not crash the benchmark.
      worker.on("error", (err) => fail(`mlx-vlm worker failed to start: ${err.message}`));
      worker.stdin?.on("error", (err) => fail(`mlx-vlm worker stdin error: ${err.message}`));

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

      worker.on("exit", (code) => fail(`mlx-vlm worker exited with code ${code}`));
    });

    return this.ready;
  }
}
