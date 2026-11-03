import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { basename } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

const API_BASE = "https://api.soniox.com";
const REALTIME_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

/** Price per hour of audio on soniox.com/pricing (November 2026), the same for v5 and v6. */
const COST_PER_HOUR = { realtime: 0.12, async: 0.1 };

/** TypeWhisper's Soniox plugin sends 4,096 samples per WebSocket frame. */
const CHUNK_BYTES = 4_096 * 2;
const POLL_INTERVAL_MS = 1_000;
const RETRIES = 3;

// Soniox STT v6 (released 2026-11-03) replaces v5, which Soniox retires on 2026-12-15. TypeWhisper dictates
// through the real-time models and transcribes files through the async models, so all four run here.
export const SONIOX_MODELS = ["stt-rt-v6", "stt-rt-v5", "stt-async-v6", "stt-async-v5"];

export function isRealtimeModel(model: string): boolean {
  return model.startsWith("stt-rt-");
}

function languageHints(language: string): string[] {
  return language === "auto" ? [] : [language];
}

/** The start message of TypeWhisper's Soniox plugin (makeRealtimeConfigPayload), without context or translation. */
export function createRealtimeConfig(model: string, language: string): Record<string, unknown> {
  const hints = languageHints(language);
  return {
    model,
    audio_format: "s16le",
    sample_rate: 16_000,
    num_channels: 1,
    enable_endpoint_detection: true,
    enable_language_identification: true,
    ...(hints.length > 0 && { language_hints: hints }),
  };
}

/** The body of TypeWhisper's async request (makeCreateTranscriptionRequest), without context or translation. */
export function createAsyncTranscriptionBody(fileId: string, model: string, language: string): Record<string, unknown> {
  const hints = languageHints(language);
  return {
    file_id: fileId,
    model,
    ...(hints.length > 0 && { language_hints: hints }),
  };
}

/** Markers Soniox puts into the token stream for endpoints and finalization; the plugin drops them. */
export function isSentinelToken(text: string): boolean {
  return ["<fin>", "<end>", "<eos>"].includes(text.trim().toLowerCase());
}

/** Joins the final tokens of one WebSocket response the way the plugin's collector does. */
export function finalTokenText(tokens: Array<{ text?: string; is_final?: boolean }>): string {
  return tokens
    .filter((t) => t.is_final && t.text && !isSentinelToken(t.text))
    .map((t) => t.text)
    .join("");
}

async function decodePcm16(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }
  );
  return stdout as unknown as Buffer;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Soniox limits requests per minute separately for real-time sessions, file management and async transcriptions,
 * and answers 429 above that. Each async clip takes two file requests and four or more transcription requests
 * (create, polls, transcript, delete), so parallel clips need to be paced to stay below the limit.
 */
export class MinuteRateLimiter {
  private times: number[] = [];

  constructor(private readonly perMinute: number) {}

  /** Waits for a free slot in the last minute and returns how long it waited. */
  async take(): Promise<number> {
    const start = Date.now();
    for (;;) {
      const now = Date.now();
      this.times = this.times.filter((t) => now - t < 60_000);
      if (this.times.length < this.perMinute) {
        this.times.push(now);
        return now - start;
      }
      await sleep(60_000 - (now - this.times[0]) + 25);
    }
  }
}

/** Below Soniox's 100 requests per minute (per group: real-time, files, async), leaving room for other use of the key. */
const REQUESTS_PER_MINUTE = 80;

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(message);
}

async function withRetries<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= RETRIES || !isRetryable(error)) throw error;
      // A 429 clears once the per-minute window moves on.
      const rateLimited = /\b429\b/.test(error instanceof Error ? error.message : String(error));
      await sleep(rateLimited ? 20_000 : 2_000 * attempt);
    }
  }
}

/**
 * Soniox STT through its real-time WebSocket and its async file API, set up like TypeWhisper's Soniox plugin
 * for macOS (US region, no custom context, no translation). Real-time clips are decoded to 16 kHz mono PCM and
 * sent as fast as the socket takes them, then finalized; `durationMs` runs from connecting to the server's
 * `finished` message, and `metadata.finalizeMs` is the wait after the last audio frame. Both include the server
 * catching up with audio that arrived faster than real time, so neither is the wait after a live dictation.
 * Async clips upload the WAV file (the plugin uploads M4A), poll once per second like the plugin, and delete
 * the file and transcription afterwards.
 */
export class SonioxProvider implements STTProvider {
  id = "soniox";
  name = "Soniox";
  type = "cloud" as const;
  models = SONIOX_MODELS;

  async isAvailable(): Promise<boolean> {
    return !!process.env.SONIOX_API_KEY;
  }

  supportsLanguage(model: string, _language: string): boolean {
    return SONIOX_MODELS.includes(model);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const realtime = isRealtimeModel(model);
    const result = await withRetries(() =>
      realtime ? this.transcribeRealtime(audio, model) : this.transcribeAsync(audio, model)
    );
    const rate = realtime ? COST_PER_HOUR.realtime : COST_PER_HOUR.async;
    return { ...result, cost: (audio.durationSeconds / 3600) * rate, model };
  }

  private apiKey(): string {
    const key = process.env.SONIOX_API_KEY;
    if (!key) throw new Error("SONIOX_API_KEY is not set");
    return key;
  }

  private async transcribeRealtime(
    audio: AudioInput,
    model: string
  ): Promise<Omit<TranscriptionResult, "model">> {
    const pcm = await decodePcm16(audio.filePath);
    await this.realtimeConnections.take();
    const start = performance.now();
    // Node's WebSocket (undici) takes headers; the plugin sends the key the same way since #1562.
    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${this.apiKey()}` },
    } as unknown as string[]);
    ws.binaryType = "arraybuffer";

    const parts: string[] = [];
    let finalizeAt = 0;

    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Soniox real-time timeout")), 110_000);
      ws.onmessage = (event) => {
        const json = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
        if (json.error_code || json.error_message) {
          clearTimeout(timer);
          reject(new Error(`Soniox ${json.error_code ?? ""}: ${json.error_message ?? "error"}`));
          return;
        }
        if (Array.isArray(json.tokens)) parts.push(finalTokenText(json.tokens));
        if (json.finished) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Soniox real-time socket error"));
      };
      ws.onclose = (event) => {
        clearTimeout(timer);
        reject(new Error(`Soniox real-time socket closed (${event.code} ${event.reason})`));
      };
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        done.catch(reject);
      });
      ws.send(JSON.stringify(createRealtimeConfig(model, audio.language)));
      for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
        ws.send(pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length)));
      }
      finalizeAt = performance.now();
      ws.send(JSON.stringify({ type: "finalize" }));
      // The plugin ends the stream with an empty binary frame; Node's WebSocket does not send one (Soniox then
      // times out with 408), so this sends the empty text frame that Soniox accepts as well.
      ws.send("");
      await done;
    } finally {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }

    const end = performance.now();
    return {
      text: parts.join("").trim(),
      durationMs: Math.round(end - start),
      metadata: { finalizeMs: Math.round(end - finalizeAt) },
    };
  }

  private realtimeConnections = new MinuteRateLimiter(REQUESTS_PER_MINUTE);
  private fileRequests = new MinuteRateLimiter(REQUESTS_PER_MINUTE);
  private transcriptionRequests = new MinuteRateLimiter(REQUESTS_PER_MINUTE);

  /** One async API request, paced per limit group; `waited` collects the time spent waiting for a slot. */
  private async request(path: string, init: RequestInit = {}, waited = { ms: 0 }): Promise<any> {
    const limiter = path.startsWith("/v1/files") ? this.fileRequests : this.transcriptionRequests;
    for (let attempt = 1; ; attempt++) {
      waited.ms += await limiter.take();
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.apiKey()}`, ...(init.headers ?? {}) },
      });
      const body = await res.text();
      if (res.status === 429 && attempt < RETRIES) {
        // Another client used the same key's budget; wait for the minute window to move on.
        const pause = 20_000;
        await sleep(pause);
        waited.ms += pause;
        continue;
      }
      if (!res.ok) throw new Error(`Soniox ${init.method ?? "GET"} ${path}: ${res.status} ${body.slice(0, 300)}`);
      return body ? JSON.parse(body) : {};
    }
  }

  private async transcribeAsync(
    audio: AudioInput,
    model: string
  ): Promise<Omit<TranscriptionResult, "model">> {
    const start = performance.now();
    const waited = { ms: 0 };
    const form = new FormData();
    form.append("file", new Blob([await readFile(audio.filePath)]), basename(audio.filePath));

    let fileId: string | undefined;
    let transcriptionId: string | undefined;
    try {
      fileId = (await this.request("/v1/files", { method: "POST", body: form }, waited)).id as string;
      transcriptionId = (
        await this.request(
          "/v1/transcriptions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createAsyncTranscriptionBody(fileId, model, audio.language)),
          },
          waited
        )
      ).id as string;

      for (let polls = 0; ; polls++) {
        const status = await this.request(`/v1/transcriptions/${transcriptionId}`, {}, waited);
        if (status.status === "completed") break;
        if (status.status === "error") throw new Error(`Soniox transcription error: ${status.error_message ?? ""}`);
        if (polls > 110) throw new Error("Soniox async timeout");
        await sleep(POLL_INTERVAL_MS);
      }

      const transcript = await this.request(`/v1/transcriptions/${transcriptionId}/transcript`, {}, waited);
      const tokens: Array<{ text?: string }> = transcript.tokens ?? [];
      const text = tokens.length > 0 ? tokens.map((t) => t.text ?? "").join("") : (transcript.text ?? "");
      // Time spent waiting for a request slot is pacing, not Soniox's processing time.
      return { text: text.trim(), durationMs: Math.round(performance.now() - start - waited.ms) };
    } finally {
      // Leftover files and transcriptions count against the project quota (TypeWhisper #1063).
      if (transcriptionId) await this.request(`/v1/transcriptions/${transcriptionId}`, { method: "DELETE" }).catch(() => {});
      if (fileId) await this.request(`/v1/files/${fileId}`, { method: "DELETE" }).catch(() => {});
    }
  }
}
