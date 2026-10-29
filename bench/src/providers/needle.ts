import { execFile } from "child_process";
import { arch, platform } from "os";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { JsonLineWorker } from "./json-line-worker.js";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SCRIPT = fileURLToPath(new URL("../../scripts/needle-worker.py", import.meta.url));
const TIMEOUTS = { prepareMs: 15 * 60_000, transcribeMs: 110_000 };

interface NeedleModel {
  repo: string;
  /** Pinned Hugging Face revision, so results stay reproducible */
  revision: string;
  /** Languages the model accepts as a hint */
  hints: string[];
  /** Suite languages it runs on */
  languages: string[];
}

// Cactus Compute's Whistle (Apache 2.0, released 2026-09-30): a 16.9 MB model for English, German,
// French, Spanish, Italian, Dutch and Polish on Needle's CPU engine. It gets the suite language when
// it knows it and detects the language otherwise: on the auto-detect suite, and on the Russian
// suites, which run for the record (Whistle rejects "ru" as a language hint).
export const NEEDLE_MODELS: Record<string, NeedleModel> = {
  whistle: {
    repo: "Cactus-Compute/whistle",
    revision: "741118687e1f008f06d1351a402a731274789790",
    hints: ["en", "de", "fr", "es", "it", "nl", "pl"],
    languages: ["en", "de", "ru", "fr", "es", "it", "auto"],
  },
};

/** The language hint Needle gets for a suite language, or null to let the model detect it. */
export function needleLanguage(model: string, language: string): string | null {
  return NEEDLE_MODELS[model]?.hints.includes(language) ? language : null;
}

/**
 * Whistle in a long-lived Python worker (started via uv) on Needle's CPU engine. Timing is measured
 * inside the worker around the transcribe call and excludes Python startup, download, loading and
 * decoding the WAV file.
 */
export class NeedleProvider implements STTProvider {
  id = "needle";
  name = "Cactus Needle";
  type = "local" as const;
  models = Object.keys(NEEDLE_MODELS);

  private uvPath = process.env.NEEDLE_UV_PATH || "uv";
  private worker = new JsonLineWorker("Needle", async () => ({
    file: this.uvPath,
    args: ["run", "--quiet", "--script", WORKER_SCRIPT],
  }));

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
    return NEEDLE_MODELS[model]?.languages.includes(language) ?? false;
  }

  async prepare(model: string): Promise<void> {
    const entry = this.entry(model);
    const res = await this.worker.request({ load: "1", repo: entry.repo, revision: entry.revision }, TIMEOUTS.prepareMs);
    if (res.error) throw new Error(res.error);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = this.entry(model);
    const res = await this.worker.request(
      {
        repo: entry.repo,
        revision: entry.revision,
        file: audio.filePath,
        language: needleLanguage(model, audio.language),
      },
      TIMEOUTS.transcribeMs
    );
    if (res.error) throw new Error(res.error);
    return { text: (res.text ?? "").trim(), durationMs: Math.round(res.durationMs ?? 0), cost: 0, model };
  }

  dispose(): void {
    this.worker.dispose();
  }

  private entry(model: string): NeedleModel {
    const entry = NEEDLE_MODELS[model];
    if (!entry) throw new Error(`Unknown Needle model '${model}'. Available: ${this.models.join(", ")}`);
    return entry;
  }
}
