import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

/** Scribe's Fast mode: one synchronous request per file (developers.zoom.us/docs/ai-services/scribe/fast-mode). */
const FAST_URL = "https://api.zoom.us/v2/aiservices/scribe/transcribe";

/** List price per audio hour: $5.83 per 1,000 minutes on artificialanalysis.ai (November 2026). */
const COST_PER_HOUR = 0.35;

/** Fast mode takes at most 2 MB of request body for audio sent inline as a data URL. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const RETRIES = 4;

/** The locale Scribe expects for each corpus language; Scribe rejects bare ISO 639-1 codes. */
export const ZOOM_LOCALES: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-BR",
  nl: "nl-NL",
  ru: "ru-RU",
};

/** The languages with a `zoom-scribe-<language>` model, as the API lists them for each locale (November 2026). */
const LANGUAGE_MODELS = new Set(["en", "de", "es", "fr", "it", "pt"]);

/** `zoom-scribe-multilingual`'s languages among the corpus languages. */
const MULTILINGUAL_LANGUAGES = new Set(["en", "de", "es", "fr", "it", "pt"]);

interface ZoomModel {
  /** The `config.model` for a language. */
  modelFor(language: string): string;
  languages: Set<string>;
}

// The benchmark ids name what a plugin would offer: Zoom's model for the dictation language, the multilingual model,
// and the two English Pro models (Pro models are never picked automatically and exist only for English).
export const ZOOM_MODELS: Record<string, ZoomModel> = {
  "zoom-scribe": { modelFor: (language) => `zoom-scribe-${language}`, languages: LANGUAGE_MODELS },
  "zoom-scribe-multilingual": { modelFor: () => "zoom-scribe-multilingual", languages: MULTILINGUAL_LANGUAGES },
  "zoom-scribe-en-pro": { modelFor: () => "zoom-scribe-en-pro", languages: new Set(["en"]) },
  "zoom-scribe-en-pro-v2.1": { modelFor: () => "zoom-scribe-en-pro-v2.1", languages: new Set(["en"]) },
};

/** The Fast-mode body: the clip inline as a data URL and the language's locale, with Scribe's default options. */
export function createFastBody(upload: Uint8Array, model: string, language: string): string {
  return JSON.stringify({
    file: `data:audio/mp4;base64,${Buffer.from(upload).toString("base64")}`,
    config: { language: ZOOM_LOCALES[language], model },
  });
}

/** The display text, or the joined segments when a response has none. */
export function transcriptText(json: {
  result?: { text_display?: string; segments?: Array<{ text?: string }> };
}): string {
  const display = json.result?.text_display;
  if (typeof display === "string") return display.trim();
  return (json.result?.segments ?? [])
    .map((segment) => (segment.text ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Encodes a clip like TypeWhisper's cloud plugins (`PluginAudioUploadEncoder`): padded with silence to at least one
 * second, then AAC at 48 kbit/s, 16 kHz mono, in an M4A container.
 */
async function encodeUpload(filePath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "zoom-"));
  try {
    const wav = join(dir, "padded.wav");
    const m4a = join(dir, "audio.m4a");
    await execFileAsync("ffmpeg", [
      "-v", "error", "-i", filePath, "-ac", "1", "-ar", "16000", "-af", "apad=whole_dur=1", "-c:a", "pcm_s16le", wav,
    ]);
    if (process.platform === "darwin") {
      await execFileAsync("afconvert", ["-f", "m4af", "-d", "aac@16000", "-c", "1", "-b", "48000", wav, m4a]);
    } else {
      await execFileAsync("ffmpeg", ["-v", "error", "-i", wav, "-c:a", "aac", "-b:a", "48k", "-ac", "1", "-ar", "16000", m4a]);
    }
    return await readFile(m4a);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RetryableError extends Error {
  constructor(
    message: string,
    readonly waitMs: number
  ) {
    super(message);
  }
}

function retryAfterMs(res: Response, fallbackMs: number): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
}

export class ZoomProvider implements STTProvider {
  id = "zoom";
  name = "Zoom";
  type = "cloud" as const;
  models = Object.keys(ZOOM_MODELS);

  private retries = 0;

  async isAvailable(): Promise<boolean> {
    return !!process.env.ZOOM_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    return !!ZOOM_MODELS[model]?.languages.has(language);
  }

  dispose(): void {
    if (this.retries > 0) console.log(`Zoom: ${this.retries} request(s) retried`);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = ZOOM_MODELS[model];
    if (!entry) throw new Error(`Unknown Zoom model '${model}'`);
    const zoomModel = entry.modelFor(audio.language);
    const body = createFastBody(await encodeUpload(audio.filePath), zoomModel, audio.language);
    if (body.length > MAX_BODY_BYTES) throw new Error(`Zoom request body is ${body.length} bytes, above the 2 MB limit`);

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.transcribeFast(body);
        return { ...result, model, cost: (audio.durationSeconds / 3600) * COST_PER_HOUR };
      } catch (error) {
        const retryable = error instanceof RetryableError || (error instanceof TypeError && /fetch failed/i.test(error.message));
        if (!retryable || attempt >= RETRIES) throw error;
        this.retries += 1;
        await sleep(error instanceof RetryableError ? error.waitMs : 2_000 * attempt);
      }
    }
  }

  private async transcribeFast(body: string): Promise<Omit<TranscriptionResult, "model">> {
    const key = process.env.ZOOM_API_KEY;
    if (!key) throw new Error("ZOOM_API_KEY is not set");
    const start = performance.now();
    const res = await fetch(FAST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    const durationMs = Math.round(performance.now() - start);
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`Zoom ${res.status}: ${text.slice(0, 300)}`, retryAfterMs(res, 5_000));
    }
    if (!res.ok) throw new Error(`Zoom ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text) as { model?: string; request_id?: string; result?: { text_display?: string } };
    return { text: transcriptText(json), durationMs, metadata: { zoomModel: json.model, requestId: json.request_id } };
  }
}
