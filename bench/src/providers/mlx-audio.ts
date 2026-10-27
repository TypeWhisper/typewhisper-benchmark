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
  /**
   * How the suite language reaches the model: Qwen3-ASR takes its name, Canary its code. The
   * others get none (Voxtral Realtime detects it; Granite's `language` means translation).
   */
  language?: "name" | "code";
  /** Extra generate() arguments, such as Granite's punctuation prompt */
  options?: Record<string, string | number>;
  languages: string[];
}

// Granite Speech's documented instruction for punctuated, truecased transcripts.
const GRANITE_PUNCTUATION_PROMPT = "transcribe the speech with proper punctuation and capitalization.";
const GRANITE_LANGUAGES = ["en", "de", "fr", "es", "pt", "auto"];

// Same repos as TypeWhisper's Qwen3, Voxtral, Granite and Canary plugins, then candidates.
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
    language: "name",
    languages: Object.keys(QWEN3_LANGUAGES),
  },
  "qwen3-asr-1.7b-8bit": {
    repo: "mlx-community/Qwen3-ASR-1.7B-8bit",
    revision: "a8379a2e2f9e313c9292cdf1af4055ab56d50d55",
    language: "name",
    languages: Object.keys(QWEN3_LANGUAGES),
  },
  "voxtral-mini-4b-realtime-4bit": {
    repo: "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
    revision: "fdebf7b2af834a1db4b8a3c99ab7480b333adf9e",
    languages: ["en", "de", "ru", "fr", "es", "it", "pt", "auto"],
  },
  // TypeWhisper's Granite plugin: no language and its built-in prompt (transcription, not translation).
  "granite-4.0-1b-speech-8bit": {
    repo: "mlx-community/granite-4.0-1b-speech-8bit",
    revision: "5ed3098fb331d0131cb2aeafdbacc19841359736",
    languages: GRANITE_LANGUAGES,
  },
  // Candidates from IBM (Apache 2.0), prompted for punctuation as the model cards recommend.
  "granite-speech-4.1-2b": {
    repo: "ibm-granite/granite-speech-4.1-2b",
    revision: "823ca793aa49925d4eb2e758709b7f2c98513e8e",
    options: { prompt: GRANITE_PUNCTUATION_PROMPT },
    languages: GRANITE_LANGUAGES,
  },
  "granite-speech-4.1-2b-nar": {
    repo: "mlx-community/granite-speech-4.1-2b-nar-mlx",
    revision: "6acb7892068dd30227f20aba6eb7c4b0ae5c7e7c",
    languages: GRANITE_LANGUAGES,
  },
  "granite-speech-5.0-2b": {
    repo: "ibm-granite/granite-speech-5.0-2b",
    revision: "c684620bb54fc89d14ba27256b23bbc9e09ba764",
    options: { prompt: GRANITE_PUNCTUATION_PROMPT },
    languages: GRANITE_LANGUAGES,
  },
  "granite-speech-5.0-470m-turboctc": {
    repo: "ibm-granite/granite-speech-5.0-470m-turboctc",
    revision: "1dd23f46f6d4e6eae2531982ba2e33220086dd97",
    // English only; it still runs on other explicit languages to document how it behaves there.
    languages: ["en", "de", "ru"],
  },
  // NVIDIA Canary 1B v2 (CC BY 4.0) in the MLX conversion mlx-audio documents (NVIDIA's own repo
  // lacks the tokenizer file mlx-audio reads): source = target language, punctuation on.
  // TypeWhisper's Canary plugin allows 512 tokens per chunk.
  "canary-1b-v2": {
    repo: "qfuxa/canary-mlx",
    revision: "1d2d321f7bfd2026ee2dcb5639f524ab8b5f0c96",
    language: "code",
    options: { max_tokens: 512 },
    languages: ["en", "de", "ru", "fr", "es", "it", "pt"],
  },
  // The Greek/English Canary fine-tune TypeWhisper's Canary plugin offers. The suites have no
  // Greek, so it runs with English as the source language everywhere, like an English-only model.
  "sophea-canary": {
    repo: "KIEFERSA/Sophea-Canary-ASR-mlx",
    revision: "1d0827f8f869dfad40f6b6980434cf34b1987963",
    options: { max_tokens: 512, language: "en" },
    languages: ["en", "de", "ru"],
  },
};

/** generate() arguments for one clip; the worker adds temperature 0. */
export function generateOptions(model: string, language: string): Record<string, string | number> {
  const entry = MLX_MODELS[model];
  const options: Record<string, string | number> = { ...entry?.options };
  if (entry?.language === "name") options.language = QWEN3_LANGUAGES[language];
  if (entry?.language === "code") options.language = language;
  return options;
}

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
      options: generateOptions(model, audio.language),
    });
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
    for (const resolvePending of this.pending.values()) resolvePending({ error: "mlx-audio worker stopped" });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private entry(model: string): MlxModel {
    const entry = MLX_MODELS[model];
    if (!entry) {
      throw new Error(`Unknown MLX model '${model}'. Available: ${this.models.join(", ")}`);
    }
    return entry;
  }

  private async request(payload: Record<string, unknown>): Promise<WorkerResponse> {
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
        // Several events can report the same dead worker; only the current one resets state.
        if (this.worker !== worker) return;
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
