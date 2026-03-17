import OpenAI from "openai";
import { createReadStream } from "fs";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

export class OpenAIProvider implements STTProvider {
  id = "openai";
  name = "OpenAI";
  type = "cloud" as const;
  models = ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"];

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI();
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.OPENAI_API_KEY;
  }

  supportsLanguage(_model: string, _language: string): boolean {
    return true;
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    const client = this.getClient();
    const start = performance.now();

    const response = await client.audio.transcriptions.create({
      model,
      file: createReadStream(audio.filePath),
      ...(audio.language !== "auto" && { language: audio.language }),
    });

    const durationMs = Math.round(performance.now() - start);

    // Cost estimation based on OpenAI pricing
    const costPerMinute = model === "whisper-1" ? 0.006 : 0.01;
    const cost = (audio.durationSeconds / 60) * costPerMinute;

    return {
      text: response.text,
      durationMs,
      cost,
      model,
    };
  }
}
