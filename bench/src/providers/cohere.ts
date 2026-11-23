import { execFile } from "child_process";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";
import { COHERE_LANGUAGES } from "./crispasr.js";

const execFileAsync = promisify(execFile);

/** The endpoint TypeWhisper's Cohere plugin posts to (docs.cohere.com/v2/reference/create-audio-transcription). */
const API_URL = "https://api.cohere.com/v2/audio/transcriptions";

/** The model TypeWhisper's Cohere plugin sends. */
export const DEFAULT_COHERE_MODEL = "cohere-transcribe-03-2026";

const RETRIES = 5;
/**
 * Some requests get no answer at all (about one in five in November 2026, with a trial key, at any pace and
 * concurrency); the same clip sent again goes through. A clip takes about half a second, so a request is given up
 * after this long and sent again at once.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The models to run: `COHERE_TRANSCRIBE_MODELS` (comma-separated API model ids) or the plugin's model. Every id
 * gets its own result file, `cohere_<id>.json`.
 */
export function cohereModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const ids = (env.COHERE_TRANSCRIBE_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : [DEFAULT_COHERE_MODEL];
}

/**
 * The languages to send: `COHERE_TRANSCRIBE_LANGUAGES` (comma-separated ISO 639-1 codes) or the 14 languages of
 * Cohere Transcribe. The API has no language detection, so the auto-detect suite is never run.
 */
export function cohereLanguages(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const codes = (env.COHERE_TRANSCRIBE_LANGUAGES ?? "")
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code && code !== "auto");
  return new Set(codes.length > 0 ? codes : COHERE_LANGUAGES);
}

/** The plugin's multipart form: `model`, `language` and the clip as `audio.wav`. */
export function createCohereForm(wav: Uint8Array, model: string, language: string): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("language", language);
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  return form;
}

/**
 * A 429 for the monthly call cap of a trial key ("limited to 1000 API calls / month") does not clear within a
 * run, unlike the per-minute limit, so it is not retried.
 */
export function isMonthlyLimit(body: string): boolean {
  return /\/\s*month|per month|monthly/i.test(body);
}

const SAMPLE_RATE = 16_000;

/**
 * The 44-byte WAV header `PluginWavEncoder` writes before 16 kHz mono 16-bit PCM. Written here because ffmpeg
 * cannot fill in the sizes when it writes WAV to a pipe (it leaves 0xFFFFFFFF).
 */
export function wavHeader(pcmBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBytes, 40);
  return header;
}

/** Converts a clip to the WAV the plugin uploads: 16 kHz mono 16-bit PCM (`PluginWavEncoder`), no padding. */
async function encodeWav(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }
  );
  const pcm = stdout as unknown as Buffer;
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Spaces request starts evenly, `60 / perMinute` seconds apart, so a key stays below its per-minute limit instead of
 * spending requests on 429 answers.
 */
export class RequestSpacer {
  private next = 0;

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now
  ) {}

  /** The wait before the next request may start; books that start. */
  book(): number {
    const now = this.now();
    const at = Math.max(now, this.next);
    this.next = at + 60_000 / this.perMinute;
    return at - now;
  }

  async take(): Promise<void> {
    await sleep(this.book());
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    /** The server's Retry-After, if it sent one. */
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** The pause before retry `attempt` (1-based): Retry-After when given, else 5, 10, 20, 40, 60 s. */
export function retryDelayMs(attempt: number, retryAfter?: number): number {
  return retryAfter ?? Math.min(5_000 * 2 ** (attempt - 1), 60_000);
}

/**
 * Cohere Transcribe through Cohere's API, as TypeWhisper's Cohere plugin calls it: one multipart `POST` per clip
 * with the model, the suite language and the clip as 16 kHz WAV. `durationMs` is the request, without the WAV
 * conversion. A request without an answer after 15 s is sent again at once; a 429 or server error is retried after
 * a pause (Retry-After when given, else 5 s doubling to 60 s). `COHERE_REQUESTS_PER_MINUTE` spaces requests evenly
 * below a per-minute limit, outside the per-clip timeout.
 * Cohere names no per-hour API price, so no cost is recorded.
 */
export class CohereProvider implements STTProvider {
  id = "cohere";
  name = "Cohere";
  type = "cloud" as const;
  models: string[];

  private readonly languages: Set<string>;
  private readonly spacer?: RequestSpacer;
  private retries = 0;
  private rateLimited = 0;
  private timedOut = 0;
  private callsRemaining?: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.models = cohereModels(env);
    this.languages = cohereLanguages(env);
    const perMinute = Number(env.COHERE_REQUESTS_PER_MINUTE);
    if (Number.isFinite(perMinute) && perMinute > 0) this.spacer = new RequestSpacer(perMinute);
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.COHERE_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    return this.models.includes(model) && this.languages.has(language);
  }

  async beforeTranscribe(): Promise<void> {
    await this.spacer?.take();
  }

  dispose(): void {
    if (this.retries > 0) {
      console.log(`Cohere: ${this.retries} request(s) retried, ${this.rateLimited} after a 429, ${this.timedOut} without an answer`);
    }
    if (this.callsRemaining !== undefined) console.log(`Cohere: lowest x-trial-endpoint-call-remaining ${this.callsRemaining}`);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const wav = await encodeWav(audio.filePath);
    for (let attempt = 1; ; attempt++) {
      try {
        return { ...(await this.request(wav, model, audio.language)), model };
      } catch (error) {
        const retryable = error instanceof RetryableError || (error instanceof TypeError && /fetch failed/i.test(error.message));
        if (!retryable || attempt >= RETRIES) throw error;
        this.retries += 1;
        console.log(`Cohere: retrying (${error.message.slice(0, 240)})`);
        await sleep(retryDelayMs(attempt, error instanceof RetryableError ? error.retryAfterMs : undefined));
        await this.spacer?.take();
      }
    }
  }

  private async request(wav: Buffer, model: string, language: string): Promise<Omit<TranscriptionResult, "model">> {
    const key = process.env.COHERE_API_KEY;
    if (!key) throw new Error("COHERE_API_KEY is not set");
    const start = performance.now();
    let res: Response;
    let body: string;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: createCohereForm(wav, model, language),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      body = await res.text();
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      this.timedOut += 1;
      throw new RetryableError(`Cohere: no answer within ${REQUEST_TIMEOUT_MS / 1_000} s`, 0);
    }
    const durationMs = Math.round(performance.now() - start);

    const remaining = Number(res.headers.get("x-trial-endpoint-call-remaining") ?? NaN);
    if (Number.isFinite(remaining)) this.callsRemaining = Math.min(this.callsRemaining ?? remaining, remaining);

    if (res.status === 429 && !isMonthlyLimit(body)) {
      this.rateLimited += 1;
      throw new RetryableError(`Cohere 429: ${body.slice(0, 300)}`, retryAfterMs(res));
    }
    if (res.status >= 500) throw new RetryableError(`Cohere ${res.status}: ${body.slice(0, 300)}`, retryAfterMs(res));
    if (!res.ok) throw new Error(`Cohere ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body) as { text?: string };
    if (typeof json.text !== "string") throw new Error(`Cohere response without text: ${body.slice(0, 300)}`);
    return { text: json.text.trim(), durationMs };
  }
}
