import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

/** Scribe's Fast mode: one synchronous request per file (developers.zoom.us/docs/ai-services/scribe/fast-mode). */
const FAST_URL = "https://api.zoom.us/v2/aiservices/scribe/transcribe";
/** Scribe's Live mode: a WebSocket session with subprotocol `live-asr` (developers.zoom.us/docs/ai-services/scribe/live-mode). */
const LIVE_URL = "wss://api.zoom.us/v2/aiservices/scribe/live";

/**
 * List price per audio hour: $5.83 per 1,000 minutes on artificialanalysis.ai (November 2026). Zoom states no Live
 * rate; Live sessions are charged here at the same rate for the time they are open.
 */
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
  api: "fast" | "live";
  /** The `config.model` for a language. */
  modelFor(language: string): string;
  languages: Set<string>;
}

// The benchmark ids name what a plugin would offer: Zoom's model for the dictation language, the multilingual model,
// and the two English Pro models (Pro models are never picked automatically and exist only for English).
// The `-live` models stream the clip to Live mode at recording pace, as a plugin's live dictation would.
export const ZOOM_MODELS: Record<string, ZoomModel> = {
  "zoom-scribe": { api: "fast", modelFor: (language) => `zoom-scribe-${language}`, languages: LANGUAGE_MODELS },
  "zoom-scribe-multilingual": { api: "fast", modelFor: () => "zoom-scribe-multilingual", languages: MULTILINGUAL_LANGUAGES },
  "zoom-scribe-en-pro": { api: "fast", modelFor: () => "zoom-scribe-en-pro", languages: new Set(["en"]) },
  "zoom-scribe-en-pro-v2.1": { api: "fast", modelFor: () => "zoom-scribe-en-pro-v2.1", languages: new Set(["en"]) },
  "zoom-scribe-multilingual-live": {
    api: "live",
    modelFor: () => "zoom-scribe-multilingual",
    languages: MULTILINGUAL_LANGUAGES,
  },
};

/** The Live `session.update`: model, the language's locale, partial results on, 16 kHz PCM16. */
export function createLiveSessionUpdate(model: string, language: string): Record<string, unknown> {
  return {
    type: "session.update",
    config: { language: ZOOM_LOCALES[language], model, interim_results: true },
    audio: { format: "pcm16" },
  };
}

/**
 * Live results by `item_id`, in the order the items started: the final `transcript` of a completed item, else the
 * latest `delta` (each delta holds the whole partial text of its item).
 */
export class LiveTranscript {
  private items = new Map<string, { text: string; completed: boolean }>();

  handle(event: { type?: string; item_id?: string; delta?: string; transcript?: string }): void {
    if (!event.item_id) return;
    const item = this.items.get(event.item_id) ?? { text: "", completed: false };
    if (event.type === "transcription.delta" && !item.completed) item.text = (event.delta ?? "").trim();
    if (event.type === "transcription.completed") {
      item.text = (event.transcript ?? "").trim();
      item.completed = true;
    }
    this.items.set(event.item_id, item);
  }

  get text(): string {
    return [...this.items.values()]
      .map((item) => item.text)
      .filter(Boolean)
      .join(" ");
  }

  get openItems(): number {
    return [...this.items.values()].filter((item) => !item.completed && item.text).length;
  }
}

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

const SAMPLE_RATE = 16_000;
/** 100 ms of 16-bit PCM per frame, as the Live docs ask for and the app's audio tap delivers. */
const FRAME_BYTES = (SAMPLE_RATE / 10) * 2;
const CREATED_TIMEOUT_MS = 10_000;
const UPDATED_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 10_000;

async function decodePcm16(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }
  );
  return stdout as unknown as Buffer;
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
  private live = { sessions: 0, openItemsAtClose: 0, firstPartialMs: [] as number[], openSeconds: 0 };

  async isAvailable(): Promise<boolean> {
    return !!process.env.ZOOM_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    return !!ZOOM_MODELS[model]?.languages.has(language);
  }

  dispose(): void {
    if (this.retries > 0) console.log(`Zoom: ${this.retries} request(s) retried`);
    const live = this.live;
    if (live.sessions > 0) {
      const partials = [...live.firstPartialMs].sort((a, b) => a - b);
      console.log(
        `Zoom live: ${live.sessions} sessions, first partial after ${partials[Math.floor(partials.length / 2)] ?? "-"} ms ` +
          `(median), ${live.openItemsAtClose} item(s) without a final at session.closed, open ${live.openSeconds.toFixed(1)} s`
      );
    }
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = ZOOM_MODELS[model];
    if (!entry) throw new Error(`Unknown Zoom model '${model}'`);
    const zoomModel = entry.modelFor(audio.language);
    if (entry.api === "live") {
      const pcm = await decodePcm16(audio.filePath);
      for (let attempt = 1; ; attempt++) {
        try {
          return { ...(await this.streamOnce(pcm, zoomModel, audio.language)), model };
        } catch (error) {
          if (!(error instanceof RetryableError) || attempt >= RETRIES) throw error;
          this.retries += 1;
          await sleep(error.waitMs);
        }
      }
    }
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

  /**
   * One Live session as a live dictation runs it: after `session.created`, `session.update`; once Zoom answers with
   * `session.updated`, 100 ms PCM frames at the pace they would be recorded, then `session.close` when the audio
   * ends. The session is done at
   * `session.closed`, after the last `transcription.completed`. `durationMs` is the wait from `session.close` until
   * then, what a user waits for after they stop.
   */
  private async streamOnce(pcm: Buffer, zoomModel: string, language: string): Promise<Omit<TranscriptionResult, "model">> {
    const key = process.env.ZOOM_API_KEY;
    if (!key) throw new Error("ZOOM_API_KEY is not set");
    // Node's WebSocket (undici) takes the subprotocol and the upgrade headers in its init object.
    const ws = new WebSocket(LIVE_URL, {
      protocols: ["live-asr"],
      headers: { Authorization: `Bearer ${key}` },
    } as unknown as string[]);
    ws.binaryType = "arraybuffer";

    const transcript = new LiveTranscript();
    const state = {
      openedAt: 0,
      created: false,
      updated: false,
      sessionClosed: false,
      socketClosed: false,
      failure: undefined as Error | undefined,
      firstPartialAt: 0,
    };
    let wake: (() => void) | undefined;
    const changed = () => wake?.();
    const waitFor = async (ready: () => boolean, timeoutMs: number): Promise<boolean> => {
      const deadline = performance.now() + timeoutMs;
      while (!ready()) {
        const left = deadline - performance.now();
        if (left <= 0) return false;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      return true;
    };

    ws.onopen = () => {
      state.openedAt = performance.now();
    };
    ws.onmessage = (event) => {
      const json = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
      if (json.type === "session.created") state.created = true;
      else if (json.type === "session.updated") state.updated = true;
      else if (json.type === "session.closed") state.sessionClosed = true;
      else if (json.type === "error") {
        const message = `Zoom live error ${json.error?.code ?? ""}: ${json.error?.message ?? "unknown"}`;
        if (json.error?.fatal !== false) state.failure ??= state.created ? new Error(message) : new RetryableError(message, 5_000);
      } else {
        transcript.handle(json);
        if (json.type === "transcription.delta" && !state.firstPartialAt) state.firstPartialAt = performance.now();
      }
      changed();
    };
    ws.onerror = () => changed();
    ws.onclose = (event) => {
      state.socketClosed = true;
      if (!state.sessionClosed) {
        const message = `Zoom live closed (${event.code} ${event.reason})`;
        state.failure ??= state.created ? new Error(message) : new RetryableError(message, 5_000);
      }
      changed();
    };

    try {
      if (!(await waitFor(() => state.created || !!state.failure, CREATED_TIMEOUT_MS))) {
        throw new RetryableError("Zoom live: no session.created within 10 s", 5_000);
      }
      if (state.failure) throw state.failure;
      this.live.sessions += 1;
      ws.send(JSON.stringify(createLiveSessionUpdate(zoomModel, language)));
      // Audio only after Zoom confirms the configuration, as the plugin does, so no frame runs with default settings.
      if (!(await waitFor(() => state.updated || !!state.failure, UPDATED_TIMEOUT_MS))) {
        throw new Error("Zoom live: no session.updated within 10 s of session.update");
      }
      if (state.failure) throw state.failure;

      const streamStart = performance.now();
      for (let offset = 0, index = 1; offset < pcm.length; offset += FRAME_BYTES, index++) {
        const frame = pcm.subarray(offset, Math.min(offset + FRAME_BYTES, pcm.length));
        const recordedMs = ((offset + frame.length) / 2 / SAMPLE_RATE) * 1_000;
        const wait = streamStart + recordedMs - performance.now();
        if (wait > 0) await sleep(wait);
        if (state.failure) throw state.failure;
        ws.send(frame);
      }
      ws.send(JSON.stringify({ type: "session.close" }));
      const closeAt = performance.now();
      const done = await waitFor(() => state.sessionClosed || !!state.failure, CLOSE_TIMEOUT_MS);
      const finishAt = performance.now();
      if (state.failure) throw state.failure;
      if (!done) throw new Error("Zoom live: no session.closed within 10 s of session.close");

      const openSeconds = (finishAt - state.openedAt) / 1_000;
      this.live.openSeconds += openSeconds;
      this.live.openItemsAtClose += transcript.openItems;
      const firstPartialMs = state.firstPartialAt ? Math.round(state.firstPartialAt - streamStart) : undefined;
      if (firstPartialMs !== undefined) this.live.firstPartialMs.push(firstPartialMs);
      return {
        text: transcript.text,
        durationMs: Math.round(finishAt - closeAt),
        cost: (openSeconds / 3600) * COST_PER_HOUR,
        metadata: { firstPartialMs, openSeconds, openItemsAtClose: transcript.openItems },
      };
    } finally {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
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
