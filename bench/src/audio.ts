import { execFile } from "child_process";
import { promisify } from "util";
import { extname } from "path";
import type { AudioInput } from "./types.js";

const execFileAsync = promisify(execFile);

export async function getAudioInfo(
  filePath: string,
  language: string
): Promise<AudioInput> {
  const ext = extname(filePath).slice(1).toLowerCase();
  const format = ext as AudioInput["format"];

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    const probe = JSON.parse(stdout);
    const audioStream = probe.streams?.find(
      (s: any) => s.codec_type === "audio"
    );

    return {
      filePath,
      format,
      sampleRate: audioStream?.sample_rate
        ? parseInt(audioStream.sample_rate)
        : 16000,
      durationSeconds: probe.format?.duration
        ? parseFloat(probe.format.duration)
        : 0,
      language,
    };
  } catch {
    // Fallback if ffprobe is not available
    return {
      filePath,
      format,
      sampleRate: 16000,
      durationSeconds: 0,
      language,
    };
  }
}
