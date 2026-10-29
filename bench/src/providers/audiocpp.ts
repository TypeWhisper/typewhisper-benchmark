import { execFile, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { request as httpRequest } from "http";
import { createServer } from "net";
import { arch, platform } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import type { STTProvider, AudioInput, TranscriptionResult } from "../types.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(new URL("../../../models/audiocpp", import.meta.url));
const WARMUP_CLIP = fileURLToPath(new URL("../../audio/samples-en/clean-01.wav", import.meta.url));

export const SERVER_RELATIVE_PATH = "runtime/audiocpp_server";
const SAMPLE_RATE = 16_000;
// The plugin sends 4096 samples (256 ms) per HTTP chunk, then 300 ms of silence.
const CHUNK_SAMPLES = 4096;
const TAIL_SILENCE_SAMPLES = (SAMPLE_RATE * 3) / 10;

interface AudioCppModel {
  file: string;
  languages: string[];
}

// The GGUF files TypeWhisper's Confucius4-R2T2 plugin downloads; Q8_0 is its recommendation.
export const AUDIOCPP_MODELS: Record<string, AudioCppModel> = {
  "confucius4-r2t2-q8_0": {
    file: "r2t2-q8_0.gguf",
    languages: ["en", "de", "ru", "fr", "es", "it", "pt", "auto"],
  },
};

// R2T2Protocol.languageNames for the suite languages; auto-detect sends none.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  ru: "Russian",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
};

export function getAudioCppModelsBasePath(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.AUDIOCPP_MODELS_PATH) return DEFAULT_MODELS_BASE_PATH;
  return resolve(REPO_ROOT, env.AUDIOCPP_MODELS_PATH);
}

/** The plugin's server.json (R2T2ManagedServer), on a port of our own. */
export function serverConfig(model: string, port: number, base: string): Record<string, unknown> {
  return {
    host: "127.0.0.1",
    port,
    backend: "metal",
    lazy_load: true,
    idle_unload_ms: 1_800_000,
    models: [
      {
        id: "r2t2",
        family: "confucius4_r2t2",
        path: join(base, AUDIOCPP_MODELS[model].file),
        task: "asr",
        mode: "streaming",
        session_options: { "confucius4_r2t2.chunk_size_ms": "320" },
      },
    ],
  };
}

/** The plugin's live route (R2T2Protocol.livePath). */
export function livePath(language: string): string {
  const params = new URLSearchParams({ model: "r2t2", sample_rate: String(SAMPLE_RATE), channels: "1", sample_format: "s16le" });
  const name = LANGUAGE_NAMES[language];
  if (name) params.set("language", name);
  return `/v1/audio/transcriptions/live?${params.toString()}`;
}

/** The final transcript from the server's event stream, or the joined deltas if it sent none. */
export function transcriptFromEvents(body: string): string {
  let deltas = "";
  for (const line of body.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data);
    if (event.type === "error") throw new Error(`audio.cpp: ${event.error?.message ?? data}`);
    if (event.type === "transcript.text.done") return String(event.text ?? "");
    if (event.type === "transcript.text.delta") deltas += String(event.delta ?? "");
  }
  return deltas;
}

/** 16 kHz mono PCM16LE of an audio file, as the plugin sends TypeWhisper's samples. */
async function pcm16(filePath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }
  );
  return stdout;
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

interface RunningServer {
  process?: ChildProcess;
  port: number;
  ready: Promise<void>;
}

/**
 * Confucius4-R2T2 through audio.cpp's `audiocpp_server`, set up and called the way TypeWhisper's
 * Confucius4-R2T2 plugin does in batch transcription: the plugin's server config, the clip streamed
 * as chunked PCM16 with 300 ms of trailing silence, and the language name. Timing is the streamed
 * request over loopback and excludes starting the server, loading the model, one warm-up request
 * and decoding the audio file.
 */
export class AudioCppProvider implements STTProvider {
  id = "audiocpp";
  name = "audio.cpp";
  type = "local" as const;
  models = Object.keys(AUDIOCPP_MODELS);

  private servers = new Map<string, RunningServer>();

  async isAvailable(): Promise<boolean> {
    return platform() === "darwin" && arch() === "arm64";
  }

  supportsLanguage(model: string, language: string): boolean {
    return AUDIOCPP_MODELS[model]?.languages.includes(language) ?? false;
  }

  prepare(model: string): Promise<void> {
    return this.serverFor(model).ready;
  }

  async transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult> {
    const server = this.serverFor(model);
    await server.ready;
    const pcm = await pcm16(audio.filePath);
    server.process?.ref();
    try {
      const start = performance.now();
      const text = await this.stream(server.port, pcm, audio.language, 110_000);
      return { text: text.trim(), durationMs: Math.round(performance.now() - start), cost: 0, model };
    } finally {
      unref(server.process);
    }
  }

  dispose(): void {
    for (const server of this.servers.values()) server.process?.kill();
    this.servers.clear();
  }

  private serverFor(model: string): RunningServer {
    const running = this.servers.get(model);
    if (running && running.process?.exitCode == null && running.process?.signalCode == null) return running;
    const base = getAudioCppModelsBasePath();
    const entry = AUDIOCPP_MODELS[model];
    if (!entry || ![SERVER_RELATIVE_PATH, entry.file].every((file) => existsSync(join(base, file)))) {
      throw new Error(`Model files not found for '${model}'. Run: bash bench/scripts/download-audiocpp-models.sh`);
    }
    let outputTail = "";
    const server = { port: 0 } as RunningServer;
    server.ready = (async () => {
      server.port = await freePort();
      const configPath = join(base, "config", `${model}-${process.pid}.json`);
      await mkdir(join(base, "config"), { recursive: true });
      await writeFile(configPath, JSON.stringify(serverConfig(model, server.port, base), null, 2));
      const child = spawn(join(base, SERVER_RELATIVE_PATH), ["--config", configPath, "--no-ui"], {
        cwd: join(base, "runtime"),
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.process = child;
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      const capture = (chunk: Buffer) => {
        outputTail = (outputTail + chunk.toString()).slice(-4000);
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      process.once("exit", () => child.kill());

      const deadline = Date.now() + 300_000;
      for (;;) {
        if (spawnError) throw new Error(`audiocpp_server could not start: ${spawnError.message}`);
        if (child.exitCode != null) throw new Error(`audiocpp_server exited: ${outputTail}`);
        if (Date.now() > deadline) throw new Error(`audiocpp_server did not start: ${outputTail}`);
        const healthy = await fetch(`http://127.0.0.1:${server.port}/health`, { signal: AbortSignal.timeout(2_000) }).then(
          (r) => r.ok,
          () => false
        );
        if (healthy) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      // The server loads the model lazily and compiles Metal kernels on the first request.
      await this.stream(server.port, await pcm16(WARMUP_CLIP), "en", 300_000);
      unref(child);
    })();
    this.servers.set(model, server);
    server.ready.catch(() => {
      server.process?.kill();
      if (this.servers.get(model) === server) this.servers.delete(model);
    });
    return server;
  }

  /** Streams PCM16 to the live route like R2T2LiveConnection and returns the final transcript. */
  private stream(port: number, pcm: Buffer, language: string, timeoutMs: number): Promise<string> {
    return new Promise((resolveText, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: livePath(language),
          headers: {
            "Content-Type": "application/octet-stream",
            "Transfer-Encoding": "chunked",
            Accept: "text/event-stream",
            Connection: "close",
          },
          timeout: timeoutMs,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            if (res.statusCode !== 200) return reject(new Error(`audio.cpp HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            try {
              resolveText(transcriptFromEvents(body));
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error(`audio.cpp did not answer within ${timeoutMs / 1000} s`)));
      req.on("error", reject);
      for (let offset = 0; offset < pcm.length; offset += CHUNK_SAMPLES * 2) {
        req.write(pcm.subarray(offset, Math.min(offset + CHUNK_SAMPLES * 2, pcm.length)));
      }
      req.write(Buffer.alloc(TAIL_SILENCE_SAMPLES * 2));
      req.end();
    });
  }
}

/** Keep the benchmark alive only while a request is in flight. */
function unref(child?: ChildProcess): void {
  for (const handle of [child, child?.stdout, child?.stderr] as any[]) handle?.unref?.();
}
