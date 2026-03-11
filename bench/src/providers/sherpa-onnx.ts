import { createRequire } from "module";
import { cpus } from "os";
import { existsSync } from "fs";
import { join, resolve } from "path";
import type {
  STTProvider,
  AudioInput,
  TranscriptionResult,
} from "../types.js";

// sherpa-onnx-node is a CommonJS native addon — use createRequire for ESM compat
let sherpa_onnx: any;
try {
  const require = createRequire(import.meta.url);
  sherpa_onnx = require("sherpa-onnx-node");
} catch {
  // Native addon not available — isAvailable() will return false
}

interface ModelEntry {
  type: "transducer" | "canary";
  dirName: string;
  files: {
    encoder: string;
    decoder: string;
    joiner?: string;
    tokens: string;
  };
  /** Supported languages, or null for auto-detect (multilingual transducer) */
  languages: string[] | null;
}

const MODEL_REGISTRY: Record<string, ModelEntry> = {
  "parakeet-tdt-0.6b": {
    type: "transducer",
    dirName: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    files: {
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      joiner: "joiner.int8.onnx",
      tokens: "tokens.txt",
    },
    languages: null, // multilingual transducer, auto-detects language
  },
  "canary-180m-flash": {
    type: "canary",
    dirName: "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8",
    files: {
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      tokens: "tokens.txt",
    },
    languages: ["en", "de", "es", "fr"],
  },
};

function getModelsBasePath(): string {
  return resolve(
    process.env.SHERPA_ONNX_MODELS_PATH || "models/sherpa-onnx"
  );
}

function getNumThreads(): number {
  const envThreads = process.env.SHERPA_ONNX_THREADS;
  if (envThreads) return parseInt(envThreads, 10);
  return Math.max(1, Math.floor(cpus().length / 2));
}

function modelFilesExist(entry: ModelEntry): boolean {
  const basePath = getModelsBasePath();
  const dir = join(basePath, entry.dirName);
  if (!existsSync(dir)) return false;
  const { encoder, decoder, joiner, tokens } = entry.files;
  for (const f of [encoder, decoder, joiner, tokens]) {
    if (f && !existsSync(join(dir, f))) return false;
  }
  return true;
}

/** Map ISO 639-1 to sherpa-onnx canary language tags */
function toCanaryLang(iso: string): string {
  const map: Record<string, string> = { en: "en", de: "de", es: "es", fr: "fr" };
  return map[iso] ?? iso;
}

export class SherpaOnnxProvider implements STTProvider {
  id = "sherpa-onnx";
  name = "SherpaOnnx";
  type = "local" as const;
  models = Object.keys(MODEL_REGISTRY);

  private recognizerCache = new Map<string, any>();

  async isAvailable(): Promise<boolean> {
    if (!sherpa_onnx) return false;
    return Object.values(MODEL_REGISTRY).some(modelFilesExist);
  }

  async transcribe(
    audio: AudioInput,
    model: string
  ): Promise<TranscriptionResult> {
    if (!sherpa_onnx) {
      throw new Error("sherpa-onnx-node is not installed");
    }

    if (audio.format !== "wav") {
      throw new Error(
        `SherpaOnnx only supports WAV files, got '${audio.format}'. ` +
          "Convert with: ffmpeg -i input.mp3 -ar 16000 -ac 1 output.wav"
      );
    }

    const entry = MODEL_REGISTRY[model];
    if (!entry) {
      throw new Error(
        `Unknown SherpaOnnx model '${model}'. Available: ${this.models.join(", ")}`
      );
    }

    if (entry.languages && !entry.languages.includes(audio.language)) {
      throw new Error(
        `Model '${model}' does not support language '${audio.language}'. ` +
          `Supported: ${entry.languages.join(", ")}`
      );
    }

    if (!modelFilesExist(entry)) {
      throw new Error(
        `Model files not found for '${model}'. Run: bash scripts/download-sherpa-onnx-models.sh`
      );
    }

    const recognizer = this.getOrCreateRecognizer(entry, model, audio.language);
    const start = performance.now();

    const wave = sherpa_onnx.readWave(audio.filePath);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    recognizer.decode(stream);
    const text = recognizer.getResult(stream).text;

    const durationMs = Math.round(performance.now() - start);

    return {
      text: text.trim(),
      durationMs,
      cost: 0,
      model,
    };
  }

  private getOrCreateRecognizer(
    entry: ModelEntry,
    model: string,
    language: string
  ): any {
    // Transducer auto-detects language, canary needs lang in config
    const cacheKey = entry.languages ? `${model}:${language}` : model;
    let recognizer = this.recognizerCache.get(cacheKey);
    if (recognizer) return recognizer;

    const basePath = getModelsBasePath();
    const dir = join(basePath, entry.dirName);
    const numThreads = getNumThreads();

    const config: any = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80,
      },
      modelConfig: {
        numThreads,
        debug: 0,
        provider: "cpu",
        tokens: join(dir, entry.files.tokens),
      },
      decodingMethod: "greedy_search",
    };

    if (entry.type === "transducer") {
      config.modelConfig.transducer = {
        encoder: join(dir, entry.files.encoder),
        decoder: join(dir, entry.files.decoder),
        joiner: join(dir, entry.files.joiner!),
      };
    } else {
      // canary / encoder-decoder
      const lang = toCanaryLang(language);
      config.modelConfig.canary = {
        encoder: join(dir, entry.files.encoder),
        decoder: join(dir, entry.files.decoder),
        srcLang: lang,
        tgtLang: lang,
        usePnc: 0,
      };
    }

    recognizer = new sherpa_onnx.OfflineRecognizer(config);
    this.recognizerCache.set(cacheKey, recognizer);
    return recognizer;
  }
}
