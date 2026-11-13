import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

const ASYNC_API = "https://api.assemblyai.com/v2";
const SYNC_URL = "https://sync.assemblyai.com/v1/transcribe";
const REALTIME_URL = "wss://streaming.assemblyai.com/v3/ws";
const SPEECH_MODEL = "universal-3-5-pro";

/** Universal-3.5 Pro list prices from assemblyai.com/pricing (November 2026). */
const ASYNC_COST_PER_HOUR = 0.21;
const SYNC_COST_PER_HOUR = 0.3;
/** Universal-3.5 Pro Realtime, billed on session duration (assemblyai.com/docs/getting-started/models, November 2026). */
const REALTIME_COST_PER_HOUR = 0.45;

/** The plugin sleeps one second before every poll. */
const POLL_INTERVAL_MS = 1_000;
const RETRIES = 4;

/**
 * Universal-3.5 Pro's languages in the plugin's model catalog: the async API runs other codes on Universal-2, and
 * the plugin sends `language_codes` to the realtime API only for these.
 */
const PRO_LANGUAGES = [
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
  api: "async" | "sync" | "realtime";
  languages: Set<string>;
}

// TypeWhisper's AssemblyAI plugin 1.2.0 has three modes for Universal-3.5 Pro: Live (the default) streams
// dictations to the realtime API while they are recorded, Sync sends recordings to the Sync API (no speaker labels,
// up to 20 minutes), and Async keeps the async API it used alone up to 1.1.4. All three paths run here.
export const ASSEMBLYAI_MODELS: Record<string, AssemblyAIModel> = {
  "universal-3-5-pro": { api: "async", languages: new Set(PRO_LANGUAGES) },
  "universal-3-5-pro-sync": { api: "sync", languages: new Set(SYNC_LANGUAGES) },
  // Russian is not among Universal-3.5 Pro's languages; the plugin would stream it without `language_codes`.
  "universal-3-5-pro-realtime": { api: "realtime", languages: new Set(PRO_LANGUAGES) },
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

const SAMPLE_RATE = 16_000;
/** The realtime API rejects frames shorter than 50 ms or longer than 1 s (error 3005). */
const MIN_FRAME_SAMPLES = SAMPLE_RATE / 20;
/** About what the app's audio tap delivers per callback. */
const FRAME_SAMPLES = SAMPLE_RATE / 10;

/**
 * The plugin's realtime URL (`makeStreamingURL`) without dictionary terms: 16 kHz, Universal-3.5 Pro, and the
 * language as a JSON array when it is one of Universal-3.5 Pro's (none for auto).
 */
export function createRealtimeUrl(language: string): string {
  const query = new URLSearchParams({ sample_rate: String(SAMPLE_RATE), speech_model: SPEECH_MODEL });
  if (PRO_LANGUAGES.includes(language)) query.set("language_codes", JSON.stringify([language]));
  return `${REALTIME_URL}?${query}`;
}

/**
 * Splits 16-bit PCM into the frames a live dictation sends: 100 ms each, the last one padded with silence to the
 * shortest frame the API accepts, as the plugin's `sendPendingAudio(flush: true)` does.
 */
export function realtimeFrames(pcm: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += FRAME_SAMPLES * 2) {
    const frame = pcm.subarray(offset, Math.min(offset + FRAME_SAMPLES * 2, pcm.length));
    frames.push(frame.length >= MIN_FRAME_SAMPLES * 2 ? frame : Buffer.concat([frame, Buffer.alloc(MIN_FRAME_SAMPLES * 2 - frame.length)]));
  }
  return frames;
}

/** Joins turns with a space, except between Chinese or Japanese characters (the plugin's `joinedText`). */
export function joinTurns(parts: string[]): string {
  const cjk = /[\u3000-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3ffff}]/u;
  let result = "";
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const last = [...result].at(-1);
    if (last && !(cjk.test(last) && cjk.test([...part][0]))) result += " ";
    result += part;
  }
  return result;
}

interface RealtimeTurn {
  turn_order?: number;
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  words?: Array<{ text?: string; start?: number; end?: number }>;
}

/** Seconds of audio after the last word that are too short to hold another one (the plugin's value). */
const TRAILING_AUDIO_WITHOUT_WORDS = 0.35;

/**
 * The plugin's turn bookkeeping (`AssemblyAILiveTranscriptionSession`): finished turns by `turn_order`, the
 * formatted final preferred over an unformatted one, and the partial text of the turn in progress.
 */
export class RealtimeTranscript {
  private finished = new Map<number, { text: string; lastWordEnd?: number }>();
  private partialOrder: number | undefined;
  private partialText = "";
  private terminateSent = false;
  private finishedTurnAfterTerminate = false;

  handleTurn(turn: RealtimeTurn): void {
    const order = turn.turn_order ?? Math.max(-1, ...this.finished.keys()) + 1;
    const text = (turn.transcript ?? "").trim();
    if (turn.end_of_turn !== true) {
      if (!this.finished.has(order)) {
        this.partialOrder = order;
        this.partialText = text;
      }
      return;
    }
    if (turn.turn_is_formatted !== false || !this.finished.has(order)) {
      const end = turn.words?.at(-1)?.end;
      this.finished.set(order, { text, lastWordEnd: typeof end === "number" ? end / 1000 : undefined });
    }
    if (this.terminateSent) this.finishedTurnAfterTerminate = true;
    if (this.partialOrder === order) {
      this.partialOrder = undefined;
      this.partialText = "";
    }
  }

  markTerminateSent(): void {
    this.terminateSent = true;
  }

  private orderedTurns() {
    return [...this.finished].sort(([a], [b]) => a - b).map(([, turn]) => turn).filter((turn) => turn.text);
  }

  /** Finished turns plus the turn in progress (the plugin's `currentText`). */
  get text(): string {
    const parts = this.orderedTurns().map((turn) => turn.text);
    if (this.partialOrder !== undefined && !this.finished.has(this.partialOrder)) parts.push(this.partialText);
    return joinTurns(parts);
  }

  /**
   * After `Terminate`: a finished turn arrived, no turn is open, and the last word ends within 0.35 s of the audio
   * sent (the plugin's `transcriptCoversSentAudio`).
   */
  coversSentAudio(sentSeconds: number): boolean {
    if (!this.finishedTurnAfterTerminate || this.partialOrder !== undefined) return false;
    const lastWordEnd = this.orderedTurns().at(-1)?.lastWordEnd;
    return lastWordEnd !== undefined && lastWordEnd >= sentSeconds - TRAILING_AUDIO_WITHOUT_WORDS;
  }
}

/**
 * Spaces session starts evenly and holds them all back after AssemblyAI refused one. The free plan takes at most
 * five new streaming sessions per minute and closes any further one (1008, "Too many concurrent sessions").
 */
export class SessionStartPacer {
  private next = 0;
  private blockedUntil = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Waits for the next free start and books it. */
  async take(): Promise<void> {
    for (;;) {
      const now = this.now();
      const at = Math.max(now, this.next, this.blockedUntil);
      this.next = at + this.intervalMs;
      if (at > now) await sleep(at - now);
      if (this.now() >= this.blockedUntil) return;
    }
  }

  /** No session starts for `ms`. */
  pause(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }
}

/** One start every 13 s stays below five per minute with some room. */
const SESSION_START_INTERVAL_MS = 13_000;
const SESSION_LIMIT_PAUSE_MS = 60_000;
const SESSION_LIMIT_RETRIES = 6;
/** The plugin waits 10 s for `Begin` and 8 s for the transcript after `Terminate`. */
const BEGIN_TIMEOUT_MS = 10_000;
const FINISH_TIMEOUT_MS = 8_000;
/** How long the benchmark keeps listening for `Termination` after the plugin would have closed (untimed). */
const TERMINATION_GRACE_MS = 5_000;

class SessionLimitError extends Error {}
class SessionNotStartedError extends Error {}

export async function decodePcm16(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }
  );
  return stdout as unknown as Buffer;
}

/**
 * Encodes a clip the way the plugin uploads it (`PluginAudioUploadEncoder`): padded with silence to at least one
 * second, then AAC at 48 kbit/s, 16 kHz mono, in an M4A container. macOS uses afconvert, Apple's AAC encoder like
 * the plugin's AVAudioFile; elsewhere ffmpeg's AAC encoder stands in.
 */
export async function encodeUpload(filePath: string): Promise<Buffer> {
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
 * AssemblyAI Universal-3.5 Pro as TypeWhisper's AssemblyAI plugin (1.2.0) transcribes dictations and recordings,
 * without dictionary terms or speaker labels. The async and Sync models upload the plugin's M4A (encoded before the
 * timer starts).
 *
 * - `universal-3-5-pro`, the async API: upload to `/v2/upload`, create the transcript with `speech_models` and
 *   `language_code` (`language_detection` for auto), then sleep one second before each poll like the plugin.
 *   `durationMs` runs from the upload to the poll that sees `completed`. The transcript is deleted afterwards.
 * - `universal-3-5-pro-sync`, the Sync API: one multipart request with the audio and `language_codes` (no config
 *   part for auto) to `sync.assemblyai.com/v1/transcribe`, the model in `X-AAI-Model`. `durationMs` is that request.
 * - `universal-3-5-pro-realtime`, the realtime API as the plugin's Live mode dictates: after `Begin`, 16 kHz PCM goes
 *   out in 100 ms frames at the pace it would be recorded, then `Terminate`. The session ends like the plugin's: at
 *   `Termination`, or once a turn finished after `Terminate`, no turn is open and the last word ends within 0.35 s
 *   of the audio sent. `durationMs` is the wait from `Terminate` to that point, what a user waits for after they
 *   stop. The cost is the session's open time until then at $0.45 per hour.
 *
 * A 429, 503 or other server error is retried after a pause (Retry-After when given); the timed duration is the
 * attempt that succeeded. Realtime sessions start at most once every 13 s; a session AssemblyAI refuses for the
 * session limit is retried after a minute without starts.
 */
export class AssemblyAIProvider implements STTProvider {
  id = "assemblyai";
  name = "AssemblyAI";
  type = "cloud" as const;
  models = Object.keys(ASSEMBLYAI_MODELS);

  /** Async clips by the model the API reports in `speech_model_used`. */
  private asyncModelsUsed = new Map<string, number>();
  private retries = 0;
  private sessionStarts = new SessionStartPacer(SESSION_START_INTERVAL_MS);
  /** Clips whose first session start was booked in `beforeTranscribe`, outside the runner's timeout. */
  private bookedStarts = new WeakSet<AudioInput>();
  private realtime = {
    sessions: 0,
    /** When and why sessions were refused or failed to start. */
    refusals: [] as string[],
    limitRetries: 0,
    otherRetries: 0,
    finishedAtTermination: 0,
    finishedOnCoverage: 0,
    /** Clips whose text changed between the plugin's finish point and `Termination`. */
    changedAfterFinish: [] as string[],
    firstPartialMs: [] as number[],
    openSeconds: 0,
    reportedSessionSeconds: 0,
  };

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
    const rt = this.realtime;
    if (rt.sessions > 0) {
      const partials = [...rt.firstPartialMs].sort((a, b) => a - b);
      const median = partials.length ? partials[Math.floor(partials.length / 2)] : undefined;
      console.log(
        `AssemblyAI realtime: ${rt.sessions} sessions, ${rt.finishedOnCoverage} finished once the turns covered the ` +
          `audio and ${rt.finishedAtTermination} at Termination; ${rt.limitRetries} refused for the session limit, ` +
          `${rt.otherRetries} other retries; first partial after ${median ?? "-"} ms (median); open ` +
          `${rt.openSeconds.toFixed(1)} s until the finish, Termination reported ${rt.reportedSessionSeconds.toFixed(1)} s`
      );
      if (rt.refusals.length > 0) console.log(`AssemblyAI realtime sessions not started:\n  ${rt.refusals.join("\n  ")}`);
      if (rt.changedAfterFinish.length > 0) {
        console.log(`AssemblyAI realtime: text changed after the finish point for ${rt.changedAfterFinish.join("; ")}`);
      }
    }
  }

  /**
   * Books a realtime clip's session start before the runner times the clip, so the pace (one start every 13 s)
   * does not count against the per-clip timeout at any concurrency.
   */
  async beforeTranscribe(audio: AudioInput, model: string): Promise<void> {
    if (ASSEMBLYAI_MODELS[model]?.api !== "realtime") return;
    await this.sessionStarts.take();
    this.bookedStarts.add(audio);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const entry = ASSEMBLYAI_MODELS[model];
    if (!entry) throw new Error(`Unknown AssemblyAI model '${model}'`);
    if (entry.api === "realtime") return { ...(await this.transcribeRealtime(audio)), model };
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

  private async transcribeRealtime(audio: AudioInput): Promise<Omit<TranscriptionResult, "model">> {
    const pcm = await decodePcm16(audio.filePath);
    for (let attempt = 1; ; attempt++) {
      // Waiting for a start happens before the session opens, so it is in neither the latency nor the cost. The
      // first start is usually booked in `beforeTranscribe`; a retry after a refusal waits here.
      if (attempt === 1 && this.bookedStarts.delete(audio)) {
        // Booked outside the timeout.
      } else {
        await this.sessionStarts.take();
      }
      try {
        return await this.streamOnce(pcm, audio);
      } catch (error) {
        if (error instanceof SessionLimitError || error instanceof SessionNotStartedError) {
          this.realtime.refusals.push(`${new Date().toISOString()} ${error.message}`);
        }
        if (error instanceof SessionLimitError && attempt < SESSION_LIMIT_RETRIES) {
          this.realtime.limitRetries += 1;
          this.sessionStarts.pause(SESSION_LIMIT_PAUSE_MS);
          continue;
        }
        if (error instanceof SessionNotStartedError && attempt < RETRIES) {
          this.realtime.otherRetries += 1;
          await sleep(2_000 * attempt);
          continue;
        }
        throw error;
      }
    }
  }

  private async streamOnce(pcm: Buffer, audio: AudioInput): Promise<Omit<TranscriptionResult, "model">> {
    // Node's WebSocket (undici) takes headers; the plugin sends the key in `Authorization` on the upgrade.
    const ws = new WebSocket(createRealtimeUrl(audio.language), {
      headers: { Authorization: this.apiKey() },
    } as unknown as string[]);
    ws.binaryType = "arraybuffer";

    const transcript = new RealtimeTranscript();
    const state = {
      openedAt: 0,
      begun: false,
      terminated: false,
      closed: false,
      failure: undefined as Error | undefined,
      sessionSeconds: undefined as number | undefined,
      firstPartialAt: 0,
    };
    let wake: (() => void) | undefined;
    const changed = () => wake?.();
    /** Resolves once `ready` holds, or false after `timeoutMs`. */
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
      if (json.type === "Begin") {
        state.begun = true;
      } else if (json.type === "Turn") {
        transcript.handleTurn(json);
        if (!state.firstPartialAt && String(json.transcript ?? "").trim()) state.firstPartialAt = performance.now();
      } else if (json.type === "Termination") {
        state.terminated = true;
        if (typeof json.session_duration_seconds === "number") state.sessionSeconds = json.session_duration_seconds;
      } else if (json.type === "Error") {
        const message = `AssemblyAI realtime error ${json.error_code ?? ""}: ${json.error ?? "unknown"}`;
        state.failure ??= /too many concurrent sessions/i.test(message)
          ? new SessionLimitError(message)
          : state.begun
            ? new Error(message)
            : new SessionNotStartedError(message);
      }
      changed();
    };
    ws.onerror = () => changed();
    ws.onclose = (event) => {
      state.closed = true;
      const message = `AssemblyAI realtime closed (${event.code} ${event.reason})`;
      if (!state.begun) {
        state.failure ??= /too many concurrent sessions/i.test(event.reason)
          ? new SessionLimitError(message)
          : new SessionNotStartedError(message);
      } else if (!state.terminated) {
        state.failure ??= new Error(message);
      }
      changed();
    };

    try {
      if (!(await waitFor(() => state.begun || !!state.failure || state.closed, BEGIN_TIMEOUT_MS))) {
        throw new SessionNotStartedError("AssemblyAI realtime: no Begin within 10 s");
      }
      if (state.failure) throw state.failure;
      this.realtime.sessions += 1;

      // Each frame leaves once it would be recorded, so the last one and `Terminate` go out when the audio ends.
      const streamStart = performance.now();
      const audioSamples = pcm.length / 2;
      let sentSamples = 0;
      for (const [index, frame] of realtimeFrames(pcm).entries()) {
        const recordedSamples = Math.min((index + 1) * FRAME_SAMPLES, audioSamples);
        const wait = streamStart + (recordedSamples / SAMPLE_RATE) * 1_000 - performance.now();
        if (wait > 0) await sleep(wait);
        if (state.failure) throw state.failure;
        ws.send(frame);
        sentSamples += frame.length / 2;
      }
      ws.send(JSON.stringify({ type: "Terminate" }));
      transcript.markTerminateSent();
      const terminateAt = performance.now();
      const sentSeconds = sentSamples / SAMPLE_RATE;

      const complete = await waitFor(
        () => state.terminated || !!state.failure || transcript.coversSentAudio(sentSeconds),
        FINISH_TIMEOUT_MS
      );
      const finishAt = performance.now();
      if (state.failure) throw state.failure;
      if (!complete) throw new Error("AssemblyAI realtime: the session did not end within 8 s of Terminate");
      const text = transcript.text;
      const finishedAtTermination = state.terminated;
      if (finishedAtTermination) this.realtime.finishedAtTermination += 1;
      else this.realtime.finishedOnCoverage += 1;
      const openSeconds = (finishAt - state.openedAt) / 1_000;
      this.realtime.openSeconds += openSeconds;
      const firstPartialMs = state.firstPartialAt ? Math.round(state.firstPartialAt - streamStart) : undefined;
      if (firstPartialMs !== undefined) this.realtime.firstPartialMs.push(firstPartialMs);

      // Untimed: the plugin closes here; the benchmark waits for `Termination` to check that nothing came later.
      await waitFor(() => state.terminated || state.closed, TERMINATION_GRACE_MS);
      if (state.sessionSeconds !== undefined) this.realtime.reportedSessionSeconds += state.sessionSeconds;
      if (transcript.text !== text) {
        this.realtime.changedAfterFinish.push(`${audio.filePath.split("/").pop()}: "${text}" -> "${transcript.text}"`);
      }

      return {
        text,
        durationMs: Math.round(finishAt - terminateAt),
        cost: (openSeconds / 3600) * REALTIME_COST_PER_HOUR,
        metadata: {
          finishedAt: finishedAtTermination ? "termination" : "coverage",
          firstPartialMs,
          openSeconds,
          sessionSeconds: state.sessionSeconds,
        },
      };
    } finally {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
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
      // Outside the timed part: the plugin keeps its transcripts, the benchmark does not need them. A failed
      // deletion is reported but does not replace the transcription's own error.
      try {
        const res = await fetch(`${ASYNC_API}/transcript/${id}`, {
          method: "DELETE",
          headers: { Authorization: this.apiKey() },
        });
        if (!res.ok) console.warn(`AssemblyAI: could not delete transcript ${id}: HTTP ${res.status}`);
      } catch (error) {
        console.warn(`AssemblyAI: could not delete transcript ${id}: ${(error as Error).message}`);
      }
    }
  }
}
