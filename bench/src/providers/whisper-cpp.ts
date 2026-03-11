import { execFile } from "child_process";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);

export class WhisperCppProvider implements STTProvider {
  id = "whisper-cpp";
  name = "whisper.cpp";
  type = "local" as const;
  models = [
    "tiny", "base", "small", "medium",
    "large-v3", "large-v3-turbo",
  ];

  private binaryPath: string;

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath || process.env.WHISPER_CPP_PATH || "whisper-cli";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.binaryPath, ["--help"]);
      return true;
    } catch {
      return false;
    }
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    const start = performance.now();

    const modelPath = process.env.WHISPER_CPP_MODELS_PATH
      ? `${process.env.WHISPER_CPP_MODELS_PATH}/ggml-${model}.bin`
      : `models/ggml-${model}.bin`;

    const { stdout } = await execFileAsync(this.binaryPath, [
      "-m", modelPath,
      "-f", audio.filePath,
      "-l", audio.language,
      "--no-timestamps",
      "--no-prints",
    ]);

    const durationMs = Math.round(performance.now() - start);

    return {
      text: stdout.trim(),
      durationMs,
      cost: 0, // Local = free
      model,
    };
  }
}
