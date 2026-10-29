import { execFile } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { platform, release } from "os";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { JsonLineWorker } from "./json-line-worker.js";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SOURCE = fileURLToPath(new URL("../../scripts/speech-analyzer-worker.swift", import.meta.url));
const WORKER_BINARY = fileURLToPath(new URL("../../.build/speech-analyzer-worker", import.meta.url));

/**
 * The locale each suite language uses. SpeechTranscriber has no Russian model and needs a locale,
 * so the Russian and auto-detect suites are skipped.
 */
export const SPEECH_ANALYZER_LOCALES: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-BR",
};

const TIMEOUTS = { prepareMs: 15 * 60_000, transcribeMs: 110_000 };

/** Compiles the worker when the binary is missing or older than its source. */
async function buildWorker(): Promise<{ file: string; args: string[] }> {
  const stale =
    !existsSync(WORKER_BINARY) || statSync(WORKER_BINARY).mtimeMs < statSync(WORKER_SOURCE).mtimeMs;
  if (stale) {
    mkdirSync(dirname(WORKER_BINARY), { recursive: true });
    await execFileAsync("swiftc", ["-O", WORKER_SOURCE, "-o", WORKER_BINARY]);
  }
  return { file: WORKER_BINARY, args: [] };
}

/**
 * Apple's SpeechAnalyzer with SpeechTranscriber (macOS 26 or later), called like TypeWhisper's
 * Apple Speech plugin transcribes a recording when live preview is off. The older `apple-speech` provider uses
 * SFSpeechRecognizer instead. Timing is measured inside the worker around the plugin's work and
 * excludes building the worker, installing the locale's model and reading the audio file.
 */
export class SpeechAnalyzerProvider implements STTProvider {
  id = "apple-speechanalyzer";
  name = "Apple SpeechAnalyzer";
  type = "system" as const;
  models = ["speechtranscriber"];

  private worker = new JsonLineWorker("SpeechAnalyzer", buildWorker);
  /** Locales whose speech model is installed; others install before their first timed clip. */
  private installed = new Set<string>();

  async isAvailable(): Promise<boolean> {
    // macOS 26 is Darwin 25.
    return platform() === "darwin" && Number(release().split(".")[0]) >= 25;
  }

  supportsLanguage(model: string, language: string): boolean {
    return this.models.includes(model) && language in SPEECH_ANALYZER_LOCALES;
  }

  async prepare(_model: string): Promise<void> {
    for (const locale of ["en-US", "de-DE"]) await this.install(locale);
  }

  private async install(locale: string): Promise<void> {
    if (this.installed.has(locale)) return;
    const res = await this.worker.request({ load: "1", locale }, TIMEOUTS.prepareMs);
    if (res.error) throw new Error(res.error);
    this.installed.add(locale);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const locale = SPEECH_ANALYZER_LOCALES[audio.language];
    if (!locale) throw new Error(`SpeechAnalyzer has no locale for '${audio.language}'`);
    await this.install(locale);
    const res = await this.worker.request({ locale, file: audio.filePath }, TIMEOUTS.transcribeMs);
    if (res.error) throw new Error(res.error);
    return {
      text: (res.text ?? "").trim(),
      durationMs: Math.round(res.durationMs ?? 0),
      cost: 0,
      model,
    };
  }

  dispose(): void {
    this.worker.dispose();
  }
}
