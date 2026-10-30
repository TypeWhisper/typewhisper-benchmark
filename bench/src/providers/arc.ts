import { execFile } from "child_process";
import { existsSync } from "fs";
import { arch, homedir, platform } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { JsonLineWorker } from "./json-line-worker.js";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const WORKER_SCRIPT = fileURLToPath(new URL("../../scripts/arc-worker.py", import.meta.url));
const TIMEOUTS = { prepareMs: 30 * 60_000, transcribeMs: 110_000 };

/** Model revision of WhissleAI/arc-v1.1 that arc-transcriber 1.2.0 loads (Arc Mini 1.1.1, Arc Transcriber 1.2.0). */
export const ARC_REVISION = "v1.2.0";

interface ArcModel {
  backbone: "mini" | "full";
}

// Whissle's Arc (CC BY-NC 4.0, gated on Hugging Face, released 2026-10): one streaming model that returns the
// transcript plus name, number, speaker and event tags. English only. Arc Mini sits on a modified Moonshine
// Streaming tiny encoder (about 71 MB); Arc Transcriber adds about 77 MB of heads and decoder on NVIDIA's
// Parakeet-TDT 0.6B v2 encoder. arc_audio supports CPU and CUDA; on MPS it fails with "Passed CPU tensor to
// MPS op", so both run on the CPU here.
export const ARC_MODELS: Record<string, ArcModel> = {
  mini: { backbone: "mini" },
  transcriber: { backbone: "full" },
};

/** True when a Hugging Face token is set or cached, which the gated Arc weights need. */
export function hasHuggingFaceToken(env: NodeJS.ProcessEnv = process.env, home = homedir()): boolean {
  if (env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN) return true;
  const hfHome = env.HF_HOME || join(home, ".cache", "huggingface");
  return existsSync(env.HF_TOKEN_PATH || join(hfHome, "token"));
}

/**
 * Arc in a long-lived Python worker (started via uv) on arc_audio 1.2.0. The weights are gated: the worker
 * needs a Hugging Face token (HF_TOKEN or a cached login) whose account accepted the licence. Timing is
 * measured inside the worker around Arc.predict() and excludes Python startup, download, loading and
 * decoding the WAV file.
 */
export class ArcProvider implements STTProvider {
  id = "whissle-arc";
  name = "Whissle Arc";
  type = "local" as const;
  models = Object.keys(ARC_MODELS);

  private uvPath = process.env.ARC_UV_PATH || "uv";
  private threads = process.env.ARC_THREADS ? Number(process.env.ARC_THREADS) : undefined;
  private worker = new JsonLineWorker("Arc", async () => ({
    file: this.uvPath,
    args: ["run", "--quiet", "--script", WORKER_SCRIPT],
  }));

  async isAvailable(): Promise<boolean> {
    if (platform() !== "darwin" || arch() !== "arm64") return false;
    // Without a token the gated download fails, so a default run should leave Arc out.
    if (!hasHuggingFaceToken()) return false;
    try {
      await execFileAsync(this.uvPath, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  supportsLanguage(model: string, language: string): boolean {
    return model in ARC_MODELS && language === "en";
  }

  async prepare(model: string): Promise<void> {
    const res = await this.worker.request({ load: "1", ...this.request(model) }, TIMEOUTS.prepareMs);
    if (res.error) throw new Error(res.error);
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const res = await this.worker.request({ ...this.request(model), file: audio.filePath }, TIMEOUTS.transcribeMs);
    if (res.error) throw new Error(res.error);
    return { text: (res.text ?? "").trim(), durationMs: Math.round(res.durationMs ?? 0), cost: 0, model };
  }

  dispose(): void {
    this.worker.dispose();
  }

  private request(model: string) {
    const entry = ARC_MODELS[model];
    if (!entry) throw new Error(`Unknown Arc model '${model}'. Available: ${this.models.join(", ")}`);
    return { backbone: entry.backbone, revision: ARC_REVISION, device: "cpu", threads: this.threads ?? null };
  }
}
