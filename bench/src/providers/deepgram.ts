import { createClient } from "@deepgram/sdk";
import { readFile } from "fs/promises";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

export function createDeepgramRequestOptions(
  audio: AudioInput,
  model: string
): Record<string, unknown> {
  return {
    model,
    ...(audio.language !== "auto"
      ? { language: audio.language }
      : { detect_language: true }),
    smart_format: true,
    punctuate: true,
  };
}

export class DeepgramProvider implements STTProvider {
  id = "deepgram";
  name = "Deepgram";
  type = "cloud" as const;
  models = ["nova-3", "nova-2"];

  async isAvailable(): Promise<boolean> {
    return !!process.env.DEEPGRAM_API_KEY;
  }

  supportsLanguage(_model: string, _language: string): boolean {
    return true;
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    const client = createClient(process.env.DEEPGRAM_API_KEY!);
    const start = performance.now();

    const audioBuffer = await readFile(audio.filePath);
    const { result } = await client.listen.prerecorded.transcribeFile(
      audioBuffer,
      createDeepgramRequestOptions(audio, model)
    );

    const durationMs = Math.round(performance.now() - start);
    const text =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    // Deepgram pricing: Nova-3 = $0.0043/min, Nova-2 = $0.0036/min
    const costPerMinute = model === "nova-3" ? 0.0043 : 0.0036;
    const cost = (audio.durationSeconds / 60) * costPerMinute;

    return { text, durationMs, cost, model };
  }
}
