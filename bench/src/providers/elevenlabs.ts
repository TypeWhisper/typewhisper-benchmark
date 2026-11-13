import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";
import { decodePcm16, encodeUpload } from "./assemblyai.js";

const BATCH_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

/** List prices per audio hour on elevenlabs.io/pricing/api (November 2026). */
const BATCH_COST_PER_HOUR = 0.2;
const REALTIME_COST_PER_HOUR = 0.22;

const RETRIES = 4;

/** Scribe's documented languages and the further codes its API accepts (the plugin's `supportedLanguages`). */
const SCRIBE_LANGUAGES = new Set([
  "af", "am", "ar", "as", "ast", "az", "ba", "be", "bg", "bn",
  "bo", "br", "bs", "ca", "ceb", "cs", "cy", "da", "de", "el",
  "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "ga", "gl",
  "gu", "ha", "he", "hi", "hr", "ht", "hu", "hy", "id", "ig",
  "is", "it", "ja", "jv", "ka", "kea", "kk", "km", "kn", "ko",
  "ku", "ky", "la", "lb", "lg", "ln", "lo", "lt", "luo", "lv",
  "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne",
  "nl", "nn", "no", "nso", "oc", "or", "pa", "pl", "ps", "pt",
  "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq",
  "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl",
  "tr", "tt", "uk", "umb", "ur", "uz", "vi", "wo", "xh", "yi",
  "yo", "yue", "zh", "zu",
]);

interface ElevenLabsModel {
  api: "batch" | "realtime";
  /** The `model_id` the API receives. */
  modelId: string;
  /** Realtime only: the plugin's Mixed languages option (`multilang_mode=true`). */
  multilang?: boolean;
}

// TypeWhisper's ElevenLabs plugin 1.3.0 (TypeWhisper/typewhisper-mac#1923) offers Scribe v3, Scribe v2 and Scribe v2
// Medical. Recordings and files go to the batch API with the selected model; in Auto mode, dictations stream to the
// realtime API, Scribe v3 with Scribe v3 Live and Scribe v2 with Scribe v2 Realtime. The Mixed languages option sends
// `multilang_mode=true` to Scribe v3 Live; Scribe v2 Realtime rejects it.
export const ELEVENLABS_MODELS: Record<string, ElevenLabsModel> = {
  scribe_v3: { api: "batch", modelId: "scribe_v3" },
  scribe_v2: { api: "batch", modelId: "scribe_v2" },
  scribe_v3_live: { api: "realtime", modelId: "scribe_v3_live" },
  "scribe_v3_live-multilang": { api: "realtime", modelId: "scribe_v3_live", multilang: true },
  scribe_v2_realtime: { api: "realtime", modelId: "scribe_v2_realtime" },
};

/**
 * The plugin's batch request (`transcribeREST`) without dictionary terms, with its default options: clean
 * transcript on, audio events off, one speaker, word timestamps, and the language unless it detects one.
 */
export function createBatchForm(upload: Uint8Array, modelId: string, language: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(upload)], { type: "audio/mp4" }), "audio.m4a");
  form.append("model_id", modelId);
  if (language !== "auto") form.append("language_code", language);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("no_verbatim", "true");
  form.append("num_speakers", "1");
  return form;
}

/** The plugin's `realtimeURL`: manual commits, clean transcript, timestamps, and the language or its detection. */
export function createRealtimeUrl(modelId: string, language: string, multilang = false): string {
  const query = new URLSearchParams({
    model_id: modelId,
    audio_format: "pcm_16000",
    commit_strategy: "manual",
    no_verbatim: "true",
    include_timestamps: "true",
  });
  if (multilang) query.set("multilang_mode", "true");
  if (language !== "auto") query.set("language_code", language);
  else query.set("include_language_detection", "true");
  return `${REALTIME_URL}?${query}`;
}

/** Han, kana and the Southeast Asian scripts that write words without spaces between them. */
function writesWithoutSpaces(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x0e00 && code <= 0x0eff) ||
    (code >= 0x1000 && code <= 0x109f) ||
    (code >= 0x1780 && code <= 0x17ff) ||
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff61 && code <= 0xff9f) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

/** Joins commit texts with a space, except between scripts without spaces (the plugin's `joinedText`). */
export function joinedText(parts: string[]): string {
  let result = "";
  for (const part of parts) {
    if (!part) continue;
    const last = [...result].at(-1);
    const first = [...part][0];
    if (last && !/\s/.test(last) && !/\s/.test(first) && !(writesWithoutSpaces(last) && writesWithoutSpaces(first))) {
      result += " ";
    }
    result += part;
  }
  return result;
}

const SAMPLE_RATE = 16_000;
/** About what the app's audio tap delivers per callback. */
const FRAME_SAMPLES = SAMPLE_RATE / 10;

/**
 * The plugin's `ElevenLabsLiveCommitPolicy`: commit in a pause once 20 s of audio are uncommitted, always at 30 s
 * (ElevenLabs commits on its own after about 36 s), and pad the final commit to 0.4 s (below 0.3 s ElevenLabs
 * closes the session).
 */
export class LiveCommitPolicy {
  static readonly pauseCommitSeconds = 20;
  static readonly maximumUncommittedSeconds = 30;
  static readonly minimumCommitSeconds = 0.4;
  static readonly pauseSeconds = 0.5;
  static readonly relativeQuietLevel = 0.15;
  static readonly absoluteQuietLevel = 0.003;
  private static readonly windowSamples = SAMPLE_RATE / 10;

  uncommittedSamples = 0;
  private trailingQuietSamples = 0;
  private loudestWindowLevel = 0;
  private partialWindow: number[] = [];

  /** Takes 16-bit PCM samples. */
  append(pcm: Buffer): void {
    const samples = pcm.length / 2;
    this.uncommittedSamples += samples;
    for (let i = 0; i < samples; i++) this.partialWindow.push(pcm.readInt16LE(i * 2) / 32_768);
    let start = 0;
    while (this.partialWindow.length - start >= LiveCommitPolicy.windowSamples) {
      let sum = 0;
      for (let i = start; i < start + LiveCommitPolicy.windowSamples; i++) sum += this.partialWindow[i] ** 2;
      start += LiveCommitPolicy.windowSamples;
      const level = Math.sqrt(sum / LiveCommitPolicy.windowSamples);
      this.loudestWindowLevel = Math.max(this.loudestWindowLevel, level);
      const quiet = Math.max(LiveCommitPolicy.absoluteQuietLevel, this.loudestWindowLevel * LiveCommitPolicy.relativeQuietLevel);
      this.trailingQuietSamples = level < quiet ? this.trailingQuietSamples + LiveCommitPolicy.windowSamples : 0;
    }
    this.partialWindow = this.partialWindow.slice(start);
  }

  get shouldCommit(): boolean {
    const seconds = this.uncommittedSamples / SAMPLE_RATE;
    if (seconds >= LiveCommitPolicy.maximumUncommittedSeconds) return true;
    return seconds >= LiveCommitPolicy.pauseCommitSeconds && this.trailingQuietSamples / SAMPLE_RATE >= LiveCommitPolicy.pauseSeconds;
  }

  get finalCommitPaddingSamples(): number {
    return Math.max(0, Math.round(LiveCommitPolicy.minimumCommitSeconds * SAMPLE_RATE) - this.uncommittedSamples);
  }

  didCommit(): void {
    this.uncommittedSamples = 0;
    this.trailingQuietSamples = 0;
    this.loudestWindowLevel = 0;
    this.partialWindow = [];
  }
}

/** The plugin's `audioMessage`. */
export function audioMessage(pcm: Buffer, commit: boolean): string {
  return JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: pcm.toString("base64"), sample_rate: SAMPLE_RATE, commit });
}

/** Realtime messages that end a session (the plugin's `realtimeErrorMessageTypes`), or any type with "error". */
const REALTIME_ERRORS = new Set([
  "auth_error", "quota_exceeded", "commit_throttled", "unaccepted_terms", "rate_limited",
  "queue_overflow", "resource_exhausted", "session_time_limit_exceeded", "input_error",
  "invalid_request", "chunk_size_exceeded", "insufficient_audio_activity", "transcriber_error",
]);
/** Refusals worth a retry with a later session. */
const RETRYABLE_REALTIME_ERRORS = new Set(["rate_limited", "queue_overflow", "resource_exhausted", "commit_throttled"]);

export function isRealtimeError(messageType: string): boolean {
  return REALTIME_ERRORS.has(messageType) || /error/i.test(messageType);
}

/** The plugin waits 10 s for `session_started` and 8 s for the answers to all commits after the final one. */
const START_TIMEOUT_MS = 10_000;
const FINISH_TIMEOUT_MS = 8_000;

class RetryableError extends Error {
  constructor(
    message: string,
    readonly waitMs: number
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, fallbackMs: number): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : fallbackMs;
}

/**
 * ElevenLabs Scribe as TypeWhisper's ElevenLabs plugin (1.3.0) transcribes dictations and recordings, without
 * dictionary terms.
 *
 * - `scribe_v3`, `scribe_v2`: the batch API. One multipart request with the plugin's M4A upload (encoded before the
 *   timer starts) and its default options. `durationMs` is that request.
 * - `scribe_v3_live`, `scribe_v3_live-multilang`, `scribe_v2_realtime`: the realtime API as a live dictation in
 *   Auto mode streams. After `session_started`, 16 kHz PCM goes out in 100 ms chunks at the pace it would be
 *   recorded; the plugin's commit policy commits in pauses after 20 s and at 30 s; at the end the last audio is
 *   padded to 0.4 s if needed and committed. The text joins the committed transcripts once every commit is
 *   answered by `committed_transcript_with_timestamps`. `durationMs` is the wait from the final commit to that
 *   point, what a user waits for after they stop. The cost is the audio duration at $0.22 per hour.
 *
 * A 429, 5xx or a realtime refusal (rate_limited, queue_overflow, resource_exhausted) is retried after a pause.
 */
export class ElevenLabsProvider implements STTProvider {
  id = "elevenlabs";
  name = "ElevenLabs";
  type = "cloud" as const;
  models = Object.keys(ELEVENLABS_MODELS);

  private retries = 0;
  private realtime = {
    sessions: 0,
    commits: 0,
    pauseCommits: 0,
    refusals: [] as string[],
    firstPartialMs: [] as number[],
    openSeconds: 0,
  };

  async isAvailable(): Promise<boolean> {
    return !!process.env.ELEVENLABS_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    return !!ELEVENLABS_MODELS[model] && (language === "auto" || SCRIBE_LANGUAGES.has(language));
  }

  dispose(): void {
    if (this.retries > 0) console.log(`ElevenLabs: ${this.retries} request(s) retried`);
    const rt = this.realtime;
    if (rt.sessions > 0) {
      const partials = [...rt.firstPartialMs].sort((a, b) => a - b);
      const median = partials.length ? partials[Math.floor(partials.length / 2)] : undefined;
      console.log(
        `ElevenLabs realtime: ${rt.sessions} sessions, ${rt.commits} commits (${rt.pauseCommits} before the end); ` +
          `first partial after ${median ?? "-"} ms (median); open ${rt.openSeconds.toFixed(1)} s`
      );
      if (rt.refusals.length > 0) console.log(`ElevenLabs realtime refusals:\n  ${rt.refusals.join("\n  ")}`);
    }
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = ELEVENLABS_MODELS[model];
    if (!entry) throw new Error(`Unknown ElevenLabs model '${model}'`);
    const upload = entry.api === "batch" ? await encodeUpload(audio.filePath) : undefined;
    const pcm = entry.api === "realtime" ? await decodePcm16(audio.filePath) : undefined;

    for (let attempt = 1; ; attempt++) {
      try {
        if (entry.api === "batch") {
          const result = await this.transcribeBatch(upload!, entry.modelId, audio.language);
          return { ...result, model, cost: (audio.durationSeconds / 3600) * BATCH_COST_PER_HOUR };
        }
        const result = await this.streamOnce(pcm!, entry, audio);
        return { ...result, model, cost: (audio.durationSeconds / 3600) * REALTIME_COST_PER_HOUR };
      } catch (error) {
        const retryable = error instanceof RetryableError || (error instanceof TypeError && /fetch failed/i.test(error.message));
        if (!retryable || attempt >= RETRIES) throw error;
        this.retries += 1;
        await sleep(error instanceof RetryableError ? error.waitMs : 2_000 * attempt);
      }
    }
  }

  private apiKey(): string {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
    return key;
  }

  private async transcribeBatch(upload: Buffer, modelId: string, language: string): Promise<Omit<TranscriptionResult, "model">> {
    const form = createBatchForm(upload, modelId, language);
    const start = performance.now();
    const res = await fetch(BATCH_URL, { method: "POST", headers: { "xi-api-key": this.apiKey() }, body: form });
    const body = await res.text();
    const durationMs = Math.round(performance.now() - start);
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`ElevenLabs batch ${res.status}: ${body.slice(0, 300)}`, retryAfterMs(res, 5_000));
    }
    if (!res.ok) throw new Error(`ElevenLabs batch ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body) as { text?: string; language_code?: string; language_probability?: number };
    return {
      text: (json.text ?? "").trim(),
      durationMs,
      metadata: { languageCode: json.language_code, languageProbability: json.language_probability },
    };
  }

  private async streamOnce(pcm: Buffer, entry: ElevenLabsModel, audio: AudioInput): Promise<Omit<TranscriptionResult, "model">> {
    // Node's WebSocket (undici) takes headers; the plugin sends the key in `xi-api-key` on the upgrade.
    const ws = new WebSocket(createRealtimeUrl(entry.modelId, audio.language, entry.multilang), {
      headers: { "xi-api-key": this.apiKey() },
    } as unknown as string[]);

    const state = {
      openedAt: 0,
      started: false,
      closed: false,
      failure: undefined as Error | undefined,
      answered: 0,
      committed: [] as string[],
      detectedLanguage: undefined as string | undefined,
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
      const type = String(json.message_type ?? "");
      if (type === "session_started") {
        state.started = true;
      } else if (type === "partial_transcript") {
        if (!state.firstPartialAt && String(json.text ?? "").trim()) state.firstPartialAt = performance.now();
      } else if (type === "committed_transcript_with_timestamps") {
        // Each commit also sends `committed_transcript` with the same text; the plugin counts only this one.
        state.answered += 1;
        const text = String(json.text ?? "").trim();
        if (text) state.committed.push(text);
        if (json.language_code) state.detectedLanguage = String(json.language_code);
      } else if (isRealtimeError(type)) {
        const message = `ElevenLabs realtime ${type}: ${json.error ?? json.message ?? ""}`;
        state.failure ??= RETRYABLE_REALTIME_ERRORS.has(type) ? new RetryableError(message, 10_000) : new Error(message);
        if (RETRYABLE_REALTIME_ERRORS.has(type)) this.realtime.refusals.push(`${new Date().toISOString()} ${message}`);
      }
      changed();
    };
    ws.onerror = () => changed();
    ws.onclose = (event) => {
      state.closed = true;
      if (!state.started) state.failure ??= new RetryableError(`ElevenLabs realtime closed before the start (${event.code} ${event.reason})`, 5_000);
      changed();
    };

    try {
      if (!(await waitFor(() => state.started || !!state.failure || state.closed, START_TIMEOUT_MS))) {
        throw new RetryableError("ElevenLabs realtime: no session_started within 10 s", 5_000);
      }
      if (state.failure) throw state.failure;
      if (!state.started) throw new RetryableError("ElevenLabs realtime: closed before session_started", 5_000);
      this.realtime.sessions += 1;

      const policy = new LiveCommitPolicy();
      let sentCommits = 0;
      const commit = () => {
        ws.send(audioMessage(Buffer.alloc(0), true));
        sentCommits += 1;
        policy.didCommit();
      };

      // Each chunk leaves once it would be recorded, so the final commit goes out when the audio ends.
      const streamStart = performance.now();
      for (let offset = 0; offset < pcm.length; offset += FRAME_SAMPLES * 2) {
        const frame = pcm.subarray(offset, Math.min(offset + FRAME_SAMPLES * 2, pcm.length));
        const wait = streamStart + ((offset + frame.length) / 2 / SAMPLE_RATE) * 1_000 - performance.now();
        if (wait > 0) await sleep(wait);
        if (state.failure) throw state.failure;
        if (state.closed) throw new Error("ElevenLabs realtime closed during the dictation");
        ws.send(audioMessage(frame, false));
        policy.append(frame);
        if (policy.shouldCommit) {
          commit();
          this.realtime.pauseCommits += 1;
        }
      }
      if (policy.uncommittedSamples > 0 || sentCommits === 0) {
        const padding = policy.finalCommitPaddingSamples;
        if (padding > 0) {
          const silence = Buffer.alloc(padding * 2);
          ws.send(audioMessage(silence, false));
          policy.append(silence);
        }
        commit();
      }
      const finalCommitAt = performance.now();
      this.realtime.commits += sentCommits;

      const complete = await waitFor(() => state.answered >= sentCommits || !!state.failure || state.closed, FINISH_TIMEOUT_MS);
      const finishAt = performance.now();
      if (state.failure) throw state.failure;
      if (!complete || state.answered < sentCommits) {
        throw new Error(`ElevenLabs realtime: ${state.answered} of ${sentCommits} commits answered within 8 s`);
      }
      const text = joinedText(state.committed);
      if (!text) throw new Error("ElevenLabs realtime returned no transcript");
      const openSeconds = (finishAt - state.openedAt) / 1_000;
      this.realtime.openSeconds += openSeconds;
      const firstPartialMs = state.firstPartialAt ? Math.round(state.firstPartialAt - streamStart) : undefined;
      if (firstPartialMs !== undefined) this.realtime.firstPartialMs.push(firstPartialMs);

      return {
        text,
        durationMs: Math.round(finishAt - finalCommitAt),
        metadata: { commits: sentCommits, firstPartialMs, openSeconds, languageCode: state.detectedLanguage },
      };
    } finally {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
  }
}
