import { readFile } from "fs/promises";
import { basename } from "path";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const DEFAULT_ENDPOINT = "https://speech-api.oruk.ai/v1/audio/transcriptions";
const RETRIES = 4;

interface OrukModel {
  /** Reference price in USD per audio minute (1-second minimum billable duration). */
  costPerMinute: number;
  languages: Set<string>;
}

/**
 * Oruk Speech API models (`https://speech-api.oruk.ai/v1/audio/transcriptions`, OpenAI-compatible multipart).
 * `oruk-fourier-2b` is Oruk's open-weights English-only Qwen3-ASR 1.7B fine-tune (`oruk/oruk-fourier-2b`).
 */
export const ORUK_MODELS: Record<string, OrukModel> = {
  "oruk-fourier-2b": {
    costPerMinute: 0.008,
    languages: new Set(["en"]),
  },
};

const MIME_TYPES: Record<AudioInput["format"], string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves `ORUK_BASE_URL` (accepts either `.../v1` or the full `/v1/audio/transcriptions` URL). */
export function resolveOrukEndpoint(baseUrl?: string): string {
  const raw = (baseUrl ?? process.env.ORUK_BASE_URL)?.trim();
  if (!raw) return DEFAULT_ENDPOINT;
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.endsWith("/audio/transcriptions")) return trimmed;
  return `${trimmed}/audio/transcriptions`;
}

/** Oruk bills `oruk-fourier-2b` at $0.0080/audio-minute with a 1-second minimum. */
export function estimateOrukCost(model: string, durationSeconds: number): number {
  const entry = ORUK_MODELS[model];
  if (!entry) return 0;
  const billableSeconds = Math.max(1, durationSeconds);
  return (billableSeconds / 60) * entry.costPerMinute;
}

export class OrukProvider implements STTProvider {
  id = "oruk";
  name = "Oruk";
  type = "cloud" as const;
  models = Object.keys(ORUK_MODELS);

  private fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.ORUK_API_KEY;
  }

  supportsLanguage(model: string, language: string): boolean {
    const entry = ORUK_MODELS[model];
    return !!entry && entry.languages.has(language);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const apiKey = process.env.ORUK_API_KEY;
    if (!apiKey) throw new Error("ORUK_API_KEY is not set");
    if (!ORUK_MODELS[model]) throw new Error(`Unknown Oruk model '${model}'`);

    const endpoint = resolveOrukEndpoint();
    const bytes = await readFile(audio.filePath);
    const mimeType = MIME_TYPES[audio.format] ?? "application/octet-stream";
    const fileName = basename(audio.filePath) || `audio.${audio.format}`;

    for (let attempt = 1; ; attempt++) {
      const form = new FormData();
      form.append("model", model);
      form.append("response_format", "json");
      if (audio.language !== "auto") form.append("language", audio.language);
      form.append("file", new Blob([bytes], { type: mimeType }), fileName);

      const start = performance.now();
      let res: Response;
      try {
        res = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      } catch (error) {
        if (attempt >= RETRIES) throw error;
        await sleep(2_000 * attempt);
        continue;
      }

      const raw = await res.text();
      const durationMs = Math.round(performance.now() - start);
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        await sleep(3_000 * attempt);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Oruk API error (${res.status}): ${raw.slice(0, 400)}`);
      }

      const parsed = JSON.parse(raw) as { text?: string };
      return {
        text: (parsed.text ?? "").trim(),
        durationMs,
        cost: estimateOrukCost(model, audio.durationSeconds),
        model,
      };
    }
  }
}
