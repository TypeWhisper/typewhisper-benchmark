import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

export class AppleSpeechProvider implements STTProvider {
  id = "apple-speech";
  name = "Apple Speech";
  type = "system" as const;
  models = ["default"];

  async isAvailable(): Promise<boolean> {
    return platform() === "darwin";
  }

  async transcribe(
    audio: AudioInput,
    _model: string
  ): Promise<TranscriptionResult> {
    const start = performance.now();

    const { stdout } = await execFileAsync("swift", [
      "bench/scripts/apple-speech.swift",
      audio.filePath,
      audio.language,
    ]);

    const durationMs = Math.round(performance.now() - start);

    return {
      text: stdout.trim(),
      durationMs,
      cost: 0,
      model: "apple-speech",
    };
  }
}
