import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

const ASYNC_API = "https://api.assemblyai.com/v2";
const SYNC_URL = "https://sync.assemblyai.com/v1/transcribe";
const SPEECH_MODEL = "universal-3-5-pro";

/** Universal-3.5 Pro list prices from assemblyai.com/pricing (November 2026). */
const ASYNC_COST_PER_HOUR = 0.21;
const SYNC_COST_PER_HOUR = 0.3;

/** The plugin sleeps one second before every poll. */
const POLL_INTERVAL_MS = 1_000;
const RETRIES = 4;

/** Universal-3.5 Pro's languages in the plugin's model catalog; the async API runs other codes on Universal-2. */
const ASYNC_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "tr", "nl", "sv",
  "no", "da", "fi", "hi", "vi", "ar", "he", "ja", "zh",
];

/** The codes the Sync API takes in `language_codes`; any other code is a 400. */
const SYNC_LANGUAGES = [
  "en", "es", "de", "fr", "it", "pt", "tr", "nl", "sv", "no", "da",
  "fi", "hi", "vi", "ar", "he", "ja", "ur", "zh", "ko", "ca", "gl",
  "ru", "ro", "et", "fa", "yue", "af", "mr", "zu", "xh", "nn",
];

interface AssemblyAIModel {
  api: "async" | "sync";
  languages: Set<string>;
}

// TypeWhisper's AssemblyAI plugin transcribes finished recordings with Universal-3.5 Pro. Since plugin 1.1.5 it
// tries the Sync API first (no speaker labels, up to 20 minutes) and falls back to the async API, which it used
// alone before. Both paths run here so they can be compared.
export const ASSEMBLYAI_MODELS: Record<string, AssemblyAIModel> = {
  "universal-3-5-pro": { api: "async", languages: new Set(ASYNC_LANGUAGES) },
  "universal-3-5-pro-sync": { api: "sync", languages: new Set(SYNC_LANGUAGES) },
};

/** The plugin's async request body (`makeSubmitTranscriptionBody`) without dictionary terms or speaker labels. */
export function createAsyncTranscriptBody(audioUrl: string, language: string): Record<string, unknown> {
  return {
    audio_url: audioUrl,
    speech_models: [SPEECH_MODEL],
    ...(language === "auto" ? { language_detection: true } : { language_code: language }),
  };
}

/** The plugin's sync `config` part (`SyncRequest.config`) without dictionary terms; null when it sends none. */
export function createSyncConfig(language: string): Record<string, unknown> | null {
  return language === "auto" ? null : { language_codes: [language] };
}

/** The plugin's multipart body (`makeSyncRequestBody`): the audio part, then `config` when there is one. */
export function createSyncForm(audio: Uint8Array, language: string): FormData {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/mp4" }), "audio.m4a");
  const config = createSyncConfig(language);
  if (config) form.append("config", new Blob([JSON.stringify(config)], { type: "application/json" }));
  return form;
}

/**
 * Encodes a clip the way the plugin uploads it (`PluginAudioUploadEncoder`): padded with silence to at least one
 * second, then AAC at 48 kbit/s, 16 kHz mono, in an M4A container. macOS uses afconvert, Apple's AAC encoder like
 * the plugin's AVAudioFile; elsewhere ffmpeg's AAC encoder stands in.
 */
async function encodeUpload(filePath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "assemblyai-"));
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

/** Seconds of a Retry-After header, or the fallback. */
function retryAfterMs(res: Response, fallbackMs: number): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : fallbackMs;
}

/**
 * AssemblyAI Universal-3.5 Pro as TypeWhisper's AssemblyAI plugin (1.1.5) transcribes finished recordings, without
 * dictionary terms or speaker labels. Both models upload the plugin's M4A (encoded before the timer starts).
 *
 * - `universal-3-5-pro`, the async API: upload to `/v2/upload`, create the transcript with `speech_models` and
 *   `language_code` (`language_detection` for auto), then sleep one second before each poll like the plugin.
 *   `durationMs` runs from the upload to the poll that sees `completed`. The transcript is deleted afterwards.
 * - `universal-3-5-pro-sync`, the Sync API: one multipart request with the audio and `language_codes` (no config
 *   part for auto) to `sync.assemblyai.com/v1/transcribe`, the model in `X-AAI-Model`. `durationMs` is that request.
 *
 * A 429, 503 or other server error is retried after a pause (Retry-After when given); the timed duration is the
 * attempt that succeeded.
 */
export class AssemblyAIProvider implements STTProvider {
  id = "assemblyai";
  name = "AssemblyAI";
  type = "cloud" as const;
  models = Object.keys(ASSEMBLYAI_MODELS);

  /** Async clips by the model the API reports in `speech_model_used`. */
  private asyncModelsUsed = new Map<string, number>();
  private retries = 0;

  async isAvailable(): Promise<boolean> {
    return !!process.env.ASSEMBLYAI_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    const entry = ASSEMBLYAI_MODELS[model];
    return !!entry && (language === "auto" || entry.languages.has(language));
  }

  dispose(): void {
    if (this.asyncModelsUsed.size > 0) {
      const used = [...this.asyncModelsUsed].map(([model, clips]) => `${model} ${clips}`).join(", ");
      console.log(`AssemblyAI async speech_model_used: ${used}`);
    }
    if (this.retries > 0) console.log(`AssemblyAI: ${this.retries} request(s) retried`);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = ASSEMBLYAI_MODELS[model];
    if (!entry) throw new Error(`Unknown AssemblyAI model '${model}'`);
    const upload = await encodeUpload(audio.filePath);

    for (let attempt = 1; ; attempt++) {
      try {
        const result =
          entry.api === "sync"
            ? await this.transcribeSync(upload, audio.language)
            : await this.transcribeAsync(upload, audio.language);
        const cost = (audio.durationSeconds / 3600) * (entry.api === "sync" ? SYNC_COST_PER_HOUR : ASYNC_COST_PER_HOUR);
        return { ...result, model, cost };
      } catch (error) {
        const retryable = error instanceof RetryableError || (error instanceof TypeError && /fetch failed/i.test(error.message));
        if (!retryable || attempt >= RETRIES) throw error;
        this.retries += 1;
        await sleep(error instanceof RetryableError ? error.waitMs : 2_000 * attempt);
      }
    }
  }

  private apiKey(): string {
    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");
    return key;
  }

  private async transcribeSync(upload: Buffer, language: string): Promise<Omit<TranscriptionResult, "model">> {
    const form = createSyncForm(upload, language);
    const start = performance.now();
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { Authorization: this.apiKey(), "X-AAI-Model": SPEECH_MODEL },
      body: form,
    });
    const body = await res.text();
    const durationMs = Math.round(performance.now() - start);
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`AssemblyAI sync ${res.status}: ${body.slice(0, 300)}`, retryAfterMs(res, 5_000));
    }
    if (!res.ok) throw new Error(`AssemblyAI sync ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body) as { text?: string; request_time_ms?: number; confidence?: number };
    return {
      text: (json.text ?? "").trim(),
      durationMs,
      metadata: { requestTimeMs: json.request_time_ms, confidence: json.confidence },
    };
  }

  /** One async API request; a 429 or server error ends the attempt so the clip starts over. */
  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${ASYNC_API}${path}`, {
      ...init,
      headers: { Authorization: this.apiKey(), ...(init.headers ?? {}) },
    });
    const body = await res.text();
    const label = `AssemblyAI ${init.method ?? "GET"} ${path.split("/").slice(0, 2).join("/")}`;
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`${label}: ${res.status} ${body.slice(0, 300)}`, retryAfterMs(res, 10_000));
    }
    if (!res.ok) throw new Error(`${label}: ${res.status} ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : {};
  }

  private async transcribeAsync(upload: Buffer, language: string): Promise<Omit<TranscriptionResult, "model">> {
    const start = performance.now();
    const { upload_url: audioUrl } = await this.request("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(upload),
    });
    const { id } = await this.request("/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createAsyncTranscriptBody(audioUrl, language)),
    });

    try {
      for (let polls = 1; ; polls++) {
        await sleep(POLL_INTERVAL_MS);
        // Like the plugin, a failed poll is skipped rather than retried.
        const res = await fetch(`${ASYNC_API}/transcript/${id}`, { headers: { Authorization: this.apiKey() } });
        const status = res.ok ? ((await res.json()) as Record<string, any>) : null;
        if (status?.status === "completed") {
          const durationMs = Math.round(performance.now() - start);
          const used = String(status.speech_model_used ?? "unknown");
          this.asyncModelsUsed.set(used, (this.asyncModelsUsed.get(used) ?? 0) + 1);
          return {
            text: String(status.text ?? "").trim(),
            durationMs,
            metadata: { polls, speechModelUsed: used, languageCode: status.language_code },
          };
        }
        if (status?.status === "error") throw new Error(`AssemblyAI transcription error: ${status.error ?? ""}`);
        if (polls >= 110) throw new Error("AssemblyAI async timeout");
      }
    } finally {
      // Outside the timed part: the plugin keeps its transcripts, the benchmark does not need them.
      await fetch(`${ASYNC_API}/transcript/${id}`, { method: "DELETE", headers: { Authorization: this.apiKey() } }).catch(
        () => {}
      );
    }
  }
}
