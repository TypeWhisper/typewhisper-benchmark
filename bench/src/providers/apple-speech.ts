import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_PATH = resolve(__dirname, "..", "..", "scripts", "apple-speech.swift");

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
      SCRIPT_PATH,
      audio.filePath,
      audio.language,
    ], { timeout: 90000 });

    const durationMs = Math.round(performance.now() - start);

    return {
      text: stdout.trim(),
      durationMs,
      cost: 0,
      model: "apple-speech",
    };
  }
}
