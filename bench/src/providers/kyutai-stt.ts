import { execFile, spawn, type ChildProcess } from "child_process";
import { arch, platform } from "os";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SCRIPT = fileURLToPath(
  new URL("../../scripts/kyutai-stt-worker.py", import.meta.url)
);

interface KyutaiModel {
  repo: string;
  /** Pinned Hugging Face revision, so results stay reproducible */
  revision: string;
  languages: string[];
}

// Kyutai's streaming STT models (CC BY 4.0), MLX checkpoints. They take no language hint and
// transcribe English (and French for the 1B model). Like the other English-only models they still
// run on the German and Russian suites, so the benchmark documents how they behave there.
const EXPLICIT_LANGUAGES = ["en", "de", "ru"];
export const KYUTAI_MODELS: Record<string, KyutaiModel> = {
  "stt-1b-en_fr": {
    repo: "kyutai/stt-1b-en_fr-mlx",
    revision: "2b995724eef1e964b7ccb6a762b35a665c4abe0d",
    languages: EXPLICIT_LANGUAGES,
  },
  "stt-2.6b-en": {
    repo: "kyutai/stt-2.6b-en-mlx",
    revision: "5ccfc8f844ab8abaf591c7954f70c07e72325554",
    languages: EXPLICIT_LANGUAGES,
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
 * Kyutai STT in a long-lived Python worker (moshi_mlx, started via uv). Timing is measured inside
 * the worker and covers the whole streaming pass, including the Mimi audio tokenizer and the
 * padding the model needs to emit its last words; it excludes Python startup and loading.
 */
export class KyutaiSttProvider implements STTProvider {
  id = "kyutai-stt";
  name = "Kyutai STT";
  type = "local" as const;
  models = Object.keys(KYUTAI_MODELS);

  private uvPath: string;
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;

  constructor(uvPath?: string) {
    this.uvPath = uvPath || process.env.KYUTAI_UV_PATH || "uv";
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
    return KYUTAI_MODELS[model]?.languages.includes(language) ?? false;
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
    for (const resolvePending of this.pending.values()) resolvePending({ error: "Kyutai worker stopped" });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private entry(model: string): KyutaiModel {
    const entry = KYUTAI_MODELS[model];
    if (!entry) {
      throw new Error(`Unknown Kyutai model '${model}'. Available: ${this.models.join(", ")}`);
    }
    return entry;
  }

  private async request(payload: Record<string, unknown>): Promise<WorkerResponse> {
    await this.startWorker();
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: "Kyutai worker is not running" };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `Kyutai worker write failed: ${err.message}` });
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
      worker.on("error", (err) => fail(`Kyutai worker failed to start: ${err.message}`));
      worker.stdin?.on("error", (err) => fail(`Kyutai worker stdin error: ${err.message}`));

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

      worker.on("exit", (code) => fail(`Kyutai worker exited with code ${code}`));
    });

    return this.ready;
  }
}
