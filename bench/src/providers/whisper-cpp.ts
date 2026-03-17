import { execFile } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, resolve } from "path";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(
  new URL("../../../models", import.meta.url)
);

export function getWhisperCppModelsBasePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!env.WHISPER_CPP_MODELS_PATH) {
    return DEFAULT_MODELS_BASE_PATH;
  }
  return resolve(REPO_ROOT, env.WHISPER_CPP_MODELS_PATH);
}

export function getWhisperCppModelPath(
  model: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(getWhisperCppModelsBasePath(env), `ggml-${model}.bin`);
}

export function hasWhisperCppModelFiles(
  models: string[],
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  return models.some((model) => fileExists(getWhisperCppModelPath(model, env)));
}

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
      return hasWhisperCppModelFiles(this.models);
    } catch {
      return false;
    }
  }

  supportsLanguage(_model: string, _language: string): boolean {
    return true;
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    const start = performance.now();
    const modelPath = getWhisperCppModelPath(model);
    if (!existsSync(modelPath)) {
      throw new Error(
        `Model file not found for '${model}': ${modelPath}. ` +
          "Set WHISPER_CPP_MODELS_PATH or download the ggml model files."
      );
    }

    const args = [
      "-m", modelPath,
      "-f", audio.filePath,
      "-l", audio.language === "auto" ? "auto" : audio.language,
      "--no-timestamps",
      "--no-prints",
    ];
    const { stdout } = await execFileAsync(this.binaryPath, args);

    const durationMs = Math.round(performance.now() - start);

    return {
      text: stdout.trim(),
      durationMs,
      cost: 0, // Local = free
      model,
    };
  }
}
