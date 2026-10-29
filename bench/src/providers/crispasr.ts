import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { createServer } from "net";
import { arch, platform } from "os";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(new URL("../../../models/crispasr", import.meta.url));
const WARMUP_CLIP = fileURLToPath(new URL("../../audio/samples-en/clean-01.wav", import.meta.url));

export const RUNTIME_RELATIVE_PATH = "runtime/crispasr-macos/crispasr";
/** The newer CrispASR release that runs the candidates (download-crispasr-candidates.sh). */
export const CANDIDATE_RUNTIME_RELATIVE_PATH = "runtime-0.8.47/crispasr-macos/crispasr";
export const VAD_FILE = "ggml-silero-v6.2.0.bin";

interface CrispAsrModel {
  backend: string;
  file: string;
  languages: string[];
  /**
   * A candidate no TypeWhisper plugin runs: CrispASR 0.8.47 with its defaults, no VAD pipeline and
   * no padding, and the suite language ("auto" on the auto-detect suite) with every request.
   */
  candidate?: boolean;
}

// Languages for multilingual candidates: all suite languages plus auto-detect.
const ALL_SUITE_LANGUAGES = ["en", "de", "ru", "fr", "es", "it", "pt", "auto"];
// English-only candidates also run on the German and Russian suites, like the AuroraASR results,
// to show how they behave there; they skip auto-detect.
const ENGLISH_PLUS_DOCUMENTED = ["en", "de", "ru"];

// Cohere Transcribe takes no auto-detect; TypeWhisper's plugin lists these 14 languages.
const COHERE_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "pl", "el", "ar", "ja", "zh", "vi", "ko"];

// Same GGUF files TypeWhisper's Cohere Transcribe (Local) plugin downloads; q5_0 is its default.
export const CRISPASR_MODELS: Record<string, CrispAsrModel> = {
  "cohere-transcribe-q5_0": { backend: "cohere", file: "cohere-transcribe-q5_0.gguf", languages: COHERE_LANGUAGES },
  "cohere-transcribe-q8_0": { backend: "cohere", file: "cohere-transcribe-q8_0.gguf", languages: COHERE_LANGUAGES },
  // Candidates, as GGUF conversions by CrispASR's author (cstr/*-GGUF), at pinned revisions.
  // Hojo-ASR-Multi-V1 (Apache 2.0): Qwen3-Omni audio tower + Qwen3-4B; de, fr, it, pt, es, ru and more.
  "hojo-asr-multi-v1-f16": {
    backend: "hojo-asr",
    file: "candidates/hojo-asr-multi-v1-f16.gguf",
    languages: ALL_SUITE_LANGUAGES,
    candidate: true,
  },
  // Fun-ASR-MLT-Nano-2512 (FunASR Model License v1.1): 31 languages incl. de and ru.
  "fun-asr-mlt-nano-f16": {
    backend: "fun-asr-mlt-nano",
    file: "candidates/funasr-mlt-nano-2512-f16.gguf",
    languages: ALL_SUITE_LANGUAGES,
    candidate: true,
  },
  // NVIDIA Canary-Qwen 2.5B (CC BY 4.0): English only.
  "canary-qwen-2.5b-q8_0": {
    backend: "canary-qwen",
    file: "candidates/canary-qwen-2.5b-q8_0.gguf",
    languages: ENGLISH_PLUS_DOCUMENTED,
    candidate: true,
  },
  // Google Gemma 4 E4B (Apache 2.0), a general model with audio input; CrispASR runs E4B on its
  // gemma4-e2b backend.
  "gemma4-e4b-it-q8_0": {
    backend: "gemma4-e2b",
    file: "candidates/gemma4-e4b-it-q8_0.gguf",
    languages: ALL_SUITE_LANGUAGES,
    candidate: true,
  },
  // Mistral's offline Voxtral Mini 3B (Apache 2.0): en, es, fr, pt, hi, de, nl, it. mlx-audio's
  // port needs PyTorch for its processor, so it runs here.
  "voxtral-mini-3b-2507-q8_0": {
    backend: "voxtral",
    file: "candidates/voxtral-mini-3b-2507-q8_0.gguf",
    languages: ["en", "de", "fr", "es", "it", "pt", "auto"],
    candidate: true,
  },
  // moondream Parakeet Redux (CC BY 4.0): Parakeet TDT 0.6B v3 with a ternary encoder, which the
  // converter dequantizes exactly. Accuracy is the model's; speed is not its packed CPU runtime's.
  "parakeet-redux-f16": {
    backend: "parakeet",
    file: "candidates/parakeet-redux-f16.gguf",
    languages: ALL_SUITE_LANGUAGES,
    candidate: true,
  },
};

export function getCrispAsrModelsBasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.CRISPASR_MODELS_PATH) return DEFAULT_MODELS_BASE_PATH;
  return resolve(REPO_ROOT, env.CRISPASR_MODELS_PATH);
}

export function hasCrispAsrModelFiles(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  const entry = CRISPASR_MODELS[model];
  if (!entry) return false;
  const base = getCrispAsrModelsBasePath(env);
  const files = entry.candidate
    ? [CANDIDATE_RUNTIME_RELATIVE_PATH, entry.file]
    : [RUNTIME_RELATIVE_PATH, VAD_FILE, entry.file];
  return files.every((file) => fileExists(join(base, file)));
}

/**
 * The plugin's server arguments (CrispAsrServer.swift), on a port of our own. Candidates get
 * CrispASR's defaults with Metal and the same thread count.
 */
export function serverArguments(model: string, port: number, base: string): string[] {
  const entry = CRISPASR_MODELS[model];
  if (entry.candidate) {
    return [
      "--server",
      "--backend", entry.backend,
      "--model", join(base, entry.file),
      "--host", "127.0.0.1",
      "--port", String(port),
      "--threads", "8",
      "--gpu-backend", "metal",
    ];
  }
  return [
    "--server",
    "--backend", entry.backend,
    "--model", join(base, entry.file),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--language", "en",
    "--vad",
    "--vad-model", join(base, VAD_FILE),
    "--strict-pipeline",
    "--require-vad",
    "--threads", "8",
    "--gpu-backend", "metal",
  ];
}

/**
 * Pads a 16-bit PCM WAV to at least one second of trailing silence, like the plugin's
 * PluginAudioUploadEncoder.normalizedAudioForUpload. Other files pass through unchanged.
 */
export function padWavToOneSecond(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return wav;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") {
      if (!byteRate || size >= byteRate) return wav;
      const out = Buffer.concat([wav.subarray(0, offset + 8 + size), Buffer.alloc(byteRate - size)]);
      out.writeUInt32LE(byteRate, offset + 4);
      out.writeUInt32LE(out.length - 8, 4);
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  return wav;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolvePort(address.port) : reject()));
    });
  });
}

/**
 * GGUF models through CrispASR's OpenAI-compatible server, started the way TypeWhisper's
 * Cohere Transcribe (Local) plugin starts it (Silero VAD, Metal). Timing is the HTTP round trip
 * over loopback and excludes starting the server, loading the model and one warm-up request.
 */
interface RunningServer {
  process: ChildProcess;
  baseUrl: string;
  ready: Promise<void>;
}

export class CrispAsrProvider implements STTProvider {
  id = "crispasr";
  name = "CrispASR";
  type = "local" as const;
  models = Object.keys(CRISPASR_MODELS);

  /** One server per model, so a run with several models never restarts one mid-run. */
  private servers = new Map<string, RunningServer>();
  private readonly apiKey = `bench-${process.pid}`;

  async isAvailable(): Promise<boolean> {
    return platform() === "darwin" && arch() === "arm64";
  }

  supportsLanguage(model: string, language: string): boolean {
    return CRISPASR_MODELS[model]?.languages.includes(language) ?? false;
  }

  prepare(model: string): Promise<void> {
    return this.serverFor(model).ready;
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const server = this.serverFor(model);
    await server.ready;
    server.process.ref();
    try {
      const start = performance.now();
      const text = await this.post(server.baseUrl, audio.filePath, model, audio.language);
      return { text: text.trim(), durationMs: Math.round(performance.now() - start), cost: 0, model };
    } finally {
      unref(server.process);
    }
  }

  dispose(): void {
    for (const server of this.servers.values()) server.process.kill();
    this.servers.clear();
  }

  private serverFor(model: string): RunningServer {
    const running = this.servers.get(model);
    // A server killed by a signal keeps exitCode null but sets signalCode.
    if (running && running.process.exitCode == null && running.process.signalCode == null) return running;
    const entry = CRISPASR_MODELS[model];
    if (!hasCrispAsrModelFiles(model)) {
      const script = entry?.candidate ? "download-crispasr-candidates.sh" : "download-crispasr-models.sh";
      throw new Error(`Model files not found for '${model}'. Run: bash bench/scripts/${script}`);
    }
    const base = getCrispAsrModelsBasePath();
    let outputTail = "";
    let child: ChildProcess | undefined;
    const server = { baseUrl: "" } as RunningServer;
    server.ready = (async () => {
      const port = await freePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      server.baseUrl = baseUrl;
      const runtime = entry.candidate ? CANDIDATE_RUNTIME_RELATIVE_PATH : RUNTIME_RELATIVE_PATH;
      child = spawn(join(base, runtime), serverArguments(model, port, base), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CRISPASR_API_KEYS: this.apiKey, CRISPASR_CACHE_DIR: join(base, "cache") },
      });
      server.process = child;
      // A runtime that cannot be executed (missing permission, wrong architecture) emits
      // "error" instead of exiting; without a listener that would end the whole benchmark.
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      const capture = (chunk: Buffer) => {
        outputTail = (outputTail + chunk.toString()).slice(-4000);
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      process.once("exit", () => child?.kill());

      const deadline = Date.now() + 300_000;
      for (;;) {
        if (spawnError) throw new Error(`crispasr could not start: ${spawnError.message}`);
        if (child.exitCode != null) throw new Error(`crispasr exited: ${outputTail}`);
        if (Date.now() > deadline) throw new Error(`crispasr did not start: ${outputTail}`);
        const healthy = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) }).then(
          (r) => r.ok,
          () => false,
        );
        if (healthy) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      // The first request compiles Metal kernels; keep it out of the timed runs.
      await this.post(baseUrl, WARMUP_CLIP, model, "en", AbortSignal.timeout(300_000));
      unref(child);
    })();
    this.servers.set(model, server);
    server.ready.catch(() => {
      child?.kill();
      if (this.servers.get(model) === server) this.servers.delete(model);
    });
    return server;
  }

  private async post(
    baseUrl: string,
    filePath: string,
    model: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const raw = await readFile(filePath);
    const wav = CRISPASR_MODELS[model]?.candidate ? raw : padWavToOneSecond(raw);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), basename(filePath));
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("language", language);
    const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`crispasr HTTP ${res.status}: ${body.slice(0, 300)}`);
    return String(JSON.parse(body).text ?? "");
  }
}

/** Keep the benchmark alive only while a request is in flight. */
function unref(child: ChildProcess): void {
  for (const handle of [child, child.stdout, child.stderr] as any[]) handle?.unref?.();
}
