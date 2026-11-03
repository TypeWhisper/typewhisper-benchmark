import { execFile } from "child_process";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

const PRERECORDED_URL = "https://api.reson8.dev/v1/speech-to-text/prerecorded";
const REALTIME_URL = "wss://api.reson8.dev/v1/speech-to-text/realtime";
/** The plugin's largest realtime audio frame. */
const FRAME_BYTES = 8_192;
const RETRIES = 4;

interface Reson8Model {
  /** Sent as `model`; the plugin leaves it out for the default model. */
  queryModel?: string;
  /** Streams over the realtime endpoint, as the plugin's live dictation does, instead of one prerecorded request. */
  realtime?: boolean;
  /** Resonant-1 takes word timings, which the plugin always requests; Rumble-2-Flash rejects them. */
  wordTimings: boolean;
  languages: Set<string>;
}

// Reson8's two speech-to-text models as `GET /v1/model` lists them (November 2026). Resonant-1 is the
// default and streams; Rumble-2-Flash only takes prerecorded audio and plain parameters.
export const RESON8_MODELS: Record<string, Reson8Model> = {
  "resonant-1": {
    wordTimings: true,
    languages: new Set(["de", "en", "es", "fr", "fy", "it", "nl", "pl", "pt", "sv"]),
  },
  "resonant-1-realtime": {
    realtime: true,
    wordTimings: true,
    languages: new Set(["de", "en", "es", "fr", "fy", "it", "nl", "pl", "pt", "sv"]),
  },
  "rumble-2-flash": {
    queryModel: "rumble-2-flash",
    wordTimings: false,
    languages: new Set(["de", "en", "ru"]),
  },
};

/**
 * The query of TypeWhisper's Reson8 plugin (`queryItems` with the default settings: natural filler mode, no
 * dictionary): raw 16 kHz mono PCM, the detected language in the response, the suite language unless it is auto,
 * word timings where the model takes them, and interim transcripts on the realtime endpoint (`realtimePath`).
 */
export function createReson8Query(model: string, language: string): URLSearchParams {
  const entry = RESON8_MODELS[model];
  if (!entry) throw new Error(`Unknown Reson8 model '${model}'`);
  const query = new URLSearchParams({
    encoding: "pcm_s16le",
    sample_rate: "16000",
    channels: "1",
    include_language: "true",
  });
  if (language !== "auto") query.set("language", language);
  if (entry.queryModel) query.set("model", entry.queryModel);
  if (entry.wordTimings) {
    query.set("include_timestamps", "true");
    query.set("include_words", "true");
  }
  if (entry.realtime) query.set("include_interim", "true");
  return query;
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
 * Reson8 as TypeWhisper's Reson8 plugin (1.1.0) calls it. `resonant-1` and `rumble-2-flash` use the prerecorded
 * endpoint, the plugin's default for recordings, files and dictations without a live session. `resonant-1-realtime`
 * streams like a live dictation (`Reson8RealtimeSession`): audio frames of at most 8 KB, sent here as fast as the
 * socket takes them, then `flush_request`; the final transcripts until `flush_confirmation` are joined with spaces.
 * Reson8 limits concurrent connections (one on the free plan) and answers 429 above it; those requests are retried
 * after a pause. A 402 (credit limit of the free plan) fails at once. `durationMs` covers the request or the
 * connection, not the PCM decoding.
 */
export class Reson8Provider implements STTProvider {
  id = "reson8";
  name = "Reson8";
  type = "cloud" as const;
  models = Object.keys(RESON8_MODELS);

  async isAvailable(): Promise<boolean> {
    return !!process.env.RESON8_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    const entry = RESON8_MODELS[model];
    return !!entry && (language === "auto" || entry.languages.has(language));
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const key = process.env.RESON8_API_KEY;
    if (!key) throw new Error("RESON8_API_KEY is not set");
    const pcm = await decodePcm16(audio.filePath);
    const query = createReson8Query(model, audio.language);
    if (RESON8_MODELS[model].realtime) return this.transcribeRealtime(pcm, query, key, model);
    const url = `${PRERECORDED_URL}?${query}`;

    for (let attempt = 1; ; attempt++) {
      const start = performance.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `ApiKey ${key}`, "Content-Type": "application/octet-stream" },
          body: new Uint8Array(pcm),
        });
      } catch (error) {
        if (attempt >= RETRIES) throw error;
        await sleep(2_000 * attempt);
        continue;
      }
      const body = await res.text();
      const durationMs = Math.round(performance.now() - start);
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        await sleep(3_000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`Reson8 ${res.status}: ${body.slice(0, 300)}`);
      const json = JSON.parse(body) as { text?: string; language?: string };
      return {
        text: (json.text ?? "").trim(),
        durationMs,
        model,
        metadata: { language: json.language },
      };
    }
  }

  private async transcribeRealtime(
    pcm: Buffer,
    query: URLSearchParams,
    key: string,
    model: string
  ): Promise<TranscriptionResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.streamOnce(pcm, query, key, model);
      } catch (error) {
        // A rejected connection (for example at the concurrent connection limit) never opens.
        if (!(error instanceof ConnectionNotOpened) || attempt >= RETRIES) throw error;
        await sleep(3_000 * attempt);
      }
    }
  }

  private async streamOnce(pcm: Buffer, query: URLSearchParams, key: string, model: string): Promise<TranscriptionResult> {
    const start = performance.now();
    // Node's WebSocket (undici) takes headers, as the plugin sends `Authorization: ApiKey …` on the upgrade.
    const ws = new WebSocket(`${REALTIME_URL}?${query}`, {
      headers: { Authorization: `ApiKey ${key}` },
    } as unknown as string[]);
    ws.binaryType = "arraybuffer";
    const finals: string[] = [];
    let opened = false;
    let flushRequested = false;
    let flushAt = 0;
    const audioSeconds = pcm.length / 32_000;

    const done = new Promise<void>((resolve, reject) => {
      // The plugin waits 10 s plus 0.1 s per second of audio for the flush confirmation.
      const timer = setTimeout(() => reject(new Error("Reson8 realtime timeout")), Math.min(10_000 + audioSeconds * 100 + audioSeconds * 1_000, 110_000));
      ws.onmessage = (event) => {
        const json = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
        if (json.type === "transcript" && json.is_final === true) {
          const text = String(json.text ?? "").trim();
          if (text) finals.push(text);
        } else if (json.type === "flush_confirmation" && flushRequested) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(opened ? new Error("Reson8 realtime socket error") : new ConnectionNotOpened());
      };
      ws.onclose = (event) => {
        clearTimeout(timer);
        reject(opened ? new Error(`Reson8 realtime closed (${event.code} ${event.reason})`) : new ConnectionNotOpened());
      };
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          opened = true;
          resolve();
        };
        done.catch(reject);
      });
      for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        ws.send(pcm.subarray(offset, Math.min(offset + FRAME_BYTES, pcm.length)));
      }
      flushRequested = true;
      flushAt = performance.now();
      ws.send(JSON.stringify({ type: "flush_request", id: "typewhisper" }));
      await done;
    } finally {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }

    const end = performance.now();
    return {
      text: finals.join(" "),
      durationMs: Math.round(end - start),
      model,
      metadata: { flushMs: Math.round(end - flushAt) },
    };
  }
}

class ConnectionNotOpened extends Error {
  constructor() {
    super("Reson8 realtime connection was not opened");
  }
}
