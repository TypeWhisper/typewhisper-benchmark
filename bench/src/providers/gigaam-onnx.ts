import { execFile } from "child_process";
import { existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { join, resolve } from "path";
import { promisify } from "util";
import { JsonLineWorker } from "./json-line-worker.js";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(new URL("../../../models/gigaam", import.meta.url));
const WORKER_SCRIPT = fileURLToPath(new URL("../../scripts/gigaam-onnx-worker.py", import.meta.url));
const TIMEOUTS = { prepareMs: 5 * 60_000, transcribeMs: 110_000 };

/** The language_vector order of GigaAM-Multilingual-v2; slot 0 detects the language. */
export const MULTILINGUAL_V2_LANGUAGES = [
  "ru", "en", "kk", "ky", "uz", "be", "fr", "es", "ba", "ka", "hy",
  "ro", "tk", "az", "tg", "de", "it", "nl", "pl", "pt", "tt",
];
const SUITE_LANGUAGES = ["ru", "en", "de", "fr", "es", "it", "nl", "pt"];

interface GigaAmModel {
  /** Folder under models/gigaam */
  dir: string;
  /** "e2e": separate decoder and joint graphs (v3); "advance": greedy loop inside one graph */
  kind: "e2e" | "advance";
  /** Suite languages it runs on */
  languages: string[];
  /** How the encoder's language_vector is set, for encoders that take one */
  language?: "suite" | "auto";
}

// Sber's GigaAM, int8 ONNX on the CPU, run the way TypeWhisper's GigaAM plugin runs it.
// v3 is the model the plugin ships (istupakov/gigaam-v3-onnx). v4 (Russian and English) and
// Multilingual v2 (21 languages) came out on 2026-11-26 and are exported from Sber's checkpoints
// with bench/scripts/export-gigaam-onnx.py. Multilingual v2 runs once with the suite language and
// once with automatic language detection, the two ways the plugin could call it.
export const GIGAAM_MODELS: Record<string, GigaAmModel> = {
  "v3-e2e-rnnt": { dir: "v3", kind: "e2e", languages: ["ru"] },
  "v4-rnnt": { dir: "v4", kind: "advance", languages: ["ru", "en"] },
  "multilingual-v2-rnnt": {
    dir: "multilingual-v2",
    kind: "advance",
    languages: SUITE_LANGUAGES,
    language: "suite",
  },
  "multilingual-v2-rnnt-auto": {
    dir: "multilingual-v2",
    kind: "advance",
    languages: [...SUITE_LANGUAGES, "auto"],
    language: "auto",
  },
};

export function getGigaAmModelsBasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GIGAAM_MODELS_PATH ? resolve(REPO_ROOT, env.GIGAAM_MODELS_PATH) : DEFAULT_MODELS_BASE_PATH;
}

/** The language_vector slot for a suite language: 0 detects the language. */
export function gigaAmLanguageSlot(model: string, language: string): number {
  const entry = GIGAAM_MODELS[model];
  if (entry?.language !== "suite") return 0;
  const index = MULTILINGUAL_V2_LANGUAGES.indexOf(language);
  return index < 0 ? 0 : index + 1;
}

export function hasGigaAmModelFiles(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
  listDir: (path: string) => string[] = (path) => (existsSync(path) ? readdirSync(path) : [])
): boolean {
  const files = listDir(join(getGigaAmModelsBasePath(env), dir));
  return files.some((f) => f.endsWith("_encoder.int8.onnx")) && files.some((f) => f.endsWith("_vocab.txt"));
}

/**
 * GigaAM RNN-T models in a long-lived Python worker (started via uv) on ONNX Runtime's CPU
 * provider. Timing is measured inside the worker and excludes Python startup, model loading and
 * reading the WAV file.
 */
export class GigaAmOnnxProvider implements STTProvider {
  id = "gigaam-onnx";
  name = "GigaAM (ONNX Runtime)";
  type = "local" as const;
  models = Object.keys(GIGAAM_MODELS);

  private uvPath = process.env.GIGAAM_UV_PATH || "uv";
  private worker = new JsonLineWorker("GigaAM", async () => ({
    file: this.uvPath,
    args: ["run", "--quiet", "--script", WORKER_SCRIPT],
  }));

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.uvPath, ["--version"]);
    } catch {
      return false;
    }
    return Object.values(GIGAAM_MODELS).some((entry) => hasGigaAmModelFiles(entry.dir));
  }

  supportsLanguage(model: string, language: string): boolean {
    return GIGAAM_MODELS[model]?.languages.includes(language) ?? false;
  }

  async prepare(model: string): Promise<void> {
    const res = await this.worker.request({ load: "1", model: this.modelPath(model) }, TIMEOUTS.prepareMs);
    if (res.error) throw new Error(res.error);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = this.entry(model);
    const res = await this.worker.request(
      {
        model: this.modelPath(model),
        kind: entry.kind,
        file: audio.filePath,
        slot: gigaAmLanguageSlot(model, audio.language),
      },
      TIMEOUTS.transcribeMs
    );
    if (res.error) throw new Error(res.error);
    return { text: (res.text ?? "").trim(), durationMs: Math.round(res.durationMs ?? 0), cost: 0, model };
  }

  /** Stops the worker, so the next model does not share memory with this one. */
  release(_model?: string): void {
    this.worker.dispose();
  }

  dispose(): void {
    this.worker.dispose();
  }

  private modelPath(model: string): string {
    const entry = this.entry(model);
    if (!hasGigaAmModelFiles(entry.dir)) {
      throw new Error(
        `Model files not found for '${model}'. Run bench/scripts/download-gigaam-models.sh ` +
          `(v3) or bench/scripts/export-gigaam-onnx.py (v4, Multilingual v2)`
      );
    }
    return join(getGigaAmModelsBasePath(), entry.dir);
  }

  private entry(model: string): GigaAmModel {
    const entry = GIGAAM_MODELS[model];
    if (!entry) throw new Error(`Unknown GigaAM model '${model}'. Available: ${this.models.join(", ")}`);
    return entry;
  }
}
