import { createRequire } from "module";
import { cpus } from "os";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
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
  /** "online-transducer" is a streaming zipformer that sherpa-onnx's OnlineRecognizer runs. */
  type: "transducer" | "online-transducer" | "canary" | "nemo-ctc";
  /** Model folder; a function for single-language packages that come in one folder per language */
  dirName: string | ((language: string) => string);
  files: {
    encoder: string;
    decoder?: string;
    joiner?: string;
    tokens: string;
  };
  /** Fbank feature dimension; NeMo models default to 80, GigaAM uses 64 */
  featureDim?: number;
  /** sherpa-onnx modelType hint, needed for NeMo-style transducers such as GigaAM */
  modelType?: string;
  /** Supported languages, or null for auto-detect (multilingual transducer) */
  languages: string[] | null;
  /** Audio per encoder chunk of a streaming model (its decode_chunk_len, in 10 ms frames) */
  chunkSeconds?: number;
  /** Decoding as the model card recommends; greedy search unless set */
  decoding?: { method: "modified_beam_search"; maxActivePaths: number };
}

// Kroko's runtime (kroko-onnx, a sherpa-onnx fork) and model cards decode with a beam of 4.
const KROKO_BEAM = { method: "modified_beam_search", maxActivePaths: 4 } as const;

// The free Kroko Community packages: one streaming zipformer per language, in two chunk sizes.
// download-sherpa-onnx-models.sh unpacks each package into the folder named here.
export const KROKO_COMMUNITY_LANGUAGES = ["de", "en", "es", "fr", "it", "nl", "pt"];

function krokoCommunity(chunk: 64 | 128): ModelEntry {
  return {
    type: "online-transducer",
    dirName: (language) => `kroko-${language}-community-${chunk}-l-streaming-001`,
    files: { encoder: "encoder.onnx", decoder: "decoder.onnx", joiner: "joiner.onnx", tokens: "tokens.txt" },
    languages: KROKO_COMMUNITY_LANGUAGES,
    chunkSeconds: chunk === 64 ? 1.28 : 2.56,
    decoding: KROKO_BEAM,
  };
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
  // FluidVoice's fine-tune of Parakeet TDT 0.6B v3 in its own int8 ONNX export (external weight
  // files next to each graph, NeMo vocab.txt as the token list).
  "fluid-speech-pro": {
    type: "transducer",
    dirName: "fluid-speech-pro-onnx-int8",
    files: {
      encoder: "encoder-model.int8.onnx",
      decoder: "decoder.int8.onnx",
      joiner: "joiner.int8.onnx",
      tokens: "vocab.txt",
    },
    featureDim: 128,
    modelType: "nemo_transducer",
    languages: null,
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
  // Kroko ASR XL, Banafo's English offline zipformer (gated licence; see the download script).
  "kroko-asr-xl-en": {
    type: "transducer",
    dirName: "kroko-asr-xl-en-offline",
    files: { encoder: "encoder.onnx", decoder: "decoder.onnx", joiner: "joiner.onnx", tokens: "tokens.txt" },
    languages: ["en"],
    decoding: KROKO_BEAM,
  },
  "kroko-community-64": krokoCommunity(64),
  "kroko-community-128": krokoCommunity(128),
  // GigaAM v3 (Russian only). The "-punct" variants are the end-to-end models that also
  // restore punctuation and capitalization.
  "gigaam-v3-ctc": gigaAm("ctc", "sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16"),
  "gigaam-v3-ctc-punct": gigaAm("ctc", "sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16"),
  "gigaam-v3-rnnt": gigaAm("rnnt", "sherpa-onnx-nemo-transducer-giga-am-v3-russian-2025-12-16"),
  "gigaam-v3-rnnt-punct": gigaAm(
    "rnnt",
    "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16"
  ),
};

function gigaAm(kind: "ctc" | "rnnt", dirName: string): ModelEntry {
  return {
    type: kind === "ctc" ? "nemo-ctc" : "transducer",
    dirName,
    files:
      kind === "ctc"
        ? { encoder: "model.int8.onnx", tokens: "tokens.txt" }
        : {
            encoder: "encoder.int8.onnx",
            decoder: "decoder.onnx",
            joiner: "joiner.onnx",
            tokens: "tokens.txt",
          },
    featureDim: 64,
    modelType: kind === "rnnt" ? "nemo_transducer" : undefined,
    languages: ["ru"],
  };
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MODELS_BASE_PATH = fileURLToPath(
  new URL("../../../models/sherpa-onnx", import.meta.url)
);

export function getSherpaOnnxModelsBasePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!env.SHERPA_ONNX_MODELS_PATH) {
    return DEFAULT_MODELS_BASE_PATH;
  }
  return resolve(REPO_ROOT, env.SHERPA_ONNX_MODELS_PATH);
}

function getNumThreads(): number {
  const envThreads = process.env.SHERPA_ONNX_THREADS;
  if (envThreads) return parseInt(envThreads, 10);
  return Math.max(1, Math.floor(cpus().length / 2));
}

/** The model folder for a language; single-language packages have one per language. */
function modelDir(entry: ModelEntry, language: string): string {
  const name = typeof entry.dirName === "function" ? entry.dirName(language) : entry.dirName;
  return join(getSherpaOnnxModelsBasePath(), name);
}

function modelFilesExist(entry: ModelEntry, language?: string): boolean {
  // Without a language, a per-language package counts as present when any language is.
  if (language === undefined && typeof entry.dirName === "function") {
    return (entry.languages ?? []).some((lang) => modelFilesExist(entry, lang));
  }
  const dir = modelDir(entry, language ?? "");
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
    return Object.values(MODEL_REGISTRY).some((entry) => modelFilesExist(entry));
  }

  supportsLanguage(model: string, language: string): boolean {
    const entry = MODEL_REGISTRY[model];
    if (!entry) return false;
    if (entry.languages == null) return true;
    if (language === "auto") return false;
    return entry.languages.includes(language);
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

    if (!this.supportsLanguage(model, audio.language)) {
      throw new Error(
        `Model '${model}' does not support language '${audio.language}'. ` +
          `Supported: ${entry.languages?.join(", ") ?? "auto"}`
      );
    }

    if (!modelFilesExist(entry, audio.language)) {
      throw new Error(
        `Model files not found for '${model}'. Run: bash scripts/download-sherpa-onnx-models.sh`
      );
    }

    const recognizer = this.getOrCreateRecognizer(entry, model, audio.language);
    const start = performance.now();

    const wave = sherpa_onnx.readWave(audio.filePath);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    if (entry.type === "online-transducer") {
      // Kroko's examples append 0.66 s of silence before input_finished. A streaming zipformer
      // only decodes whole chunks, though, and the 128-L chunk is 2.56 s long, so that tail
      // drops the last words of most clips. One chunk more of silence lets the final chunk run.
      const tail = Math.round((0.66 + (entry.chunkSeconds ?? 0)) * wave.sampleRate);
      stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: new Float32Array(tail) });
      stream.inputFinished();
      while (recognizer.isReady(stream)) recognizer.decode(stream);
    } else {
      recognizer.decode(stream);
    }
    const text = recognizer.getResult(stream).text;

    const durationMs = Math.round(performance.now() - start);

    return {
      text: text.trim(),
      durationMs,
      cost: 0,
      model,
    };
  }

  /** Drops the model's recognizers, so the next model does not share memory with them. */
  release(model: string): void {
    for (const key of [...this.recognizerCache.keys()]) {
      if (key === model || key.startsWith(`${model}:`)) this.recognizerCache.delete(key);
    }
  }

  private getOrCreateRecognizer(
    entry: ModelEntry,
    model: string,
    language: string
  ): any {
    // Canary takes the language in its config; per-language packages are one model per language.
    const perLanguage = entry.type === "canary" || typeof entry.dirName === "function";
    const cacheKey = perLanguage ? `${model}:${language}` : model;
    let recognizer = this.recognizerCache.get(cacheKey);
    if (recognizer) return recognizer;

    const dir = modelDir(entry, language);
    const numThreads = getNumThreads();

    const config: any = {
      featConfig: {
        sampleRate: 16000,
        featureDim: entry.featureDim ?? 80,
      },
      modelConfig: {
        numThreads,
        debug: 0,
        provider: "cpu",
        tokens: join(dir, entry.files.tokens),
      },
      decodingMethod: entry.decoding?.method ?? "greedy_search",
      ...(entry.decoding ? { maxActivePaths: entry.decoding.maxActivePaths } : {}),
    };

    if (entry.type === "transducer" || entry.type === "online-transducer") {
      config.modelConfig.transducer = {
        encoder: join(dir, entry.files.encoder),
        decoder: join(dir, entry.files.decoder!),
        joiner: join(dir, entry.files.joiner!),
      };
      if (entry.modelType) config.modelConfig.modelType = entry.modelType;
    } else if (entry.type === "nemo-ctc") {
      config.modelConfig.nemoCtc = { model: join(dir, entry.files.encoder) };
    } else {
      // canary / encoder-decoder
      const lang = toCanaryLang(language);
      config.modelConfig.canary = {
        encoder: join(dir, entry.files.encoder),
        decoder: join(dir, entry.files.decoder!),
        srcLang: lang,
        tgtLang: lang,
        usePnc: 0,
      };
    }

    recognizer =
      entry.type === "online-transducer"
        ? new sherpa_onnx.OnlineRecognizer(config)
        : new sherpa_onnx.OfflineRecognizer(config);
    this.recognizerCache.set(cacheKey, recognizer);
    return recognizer;
  }
}
