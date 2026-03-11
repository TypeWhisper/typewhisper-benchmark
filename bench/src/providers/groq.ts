import Groq from "groq-sdk";
import { createReadStream } from "fs";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

export class GroqProvider implements STTProvider {
  id = "groq";
  name = "Groq";
  type = "cloud" as const;
  models = ["whisper-large-v3", "whisper-large-v3-turbo"];

  private client: Groq | null = null;

  private getClient(): Groq {
    if (!this.client) {
      this.client = new Groq();
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.GROQ_API_KEY;
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
      language: audio.language,
    });

    const durationMs = Math.round(performance.now() - start);

    // Groq Whisper pricing: $0.0028/min
    const cost = (audio.durationSeconds / 60) * 0.0028;

    return {
      text: response.text,
      durationMs,
      cost,
      model,
    };
  }
}
