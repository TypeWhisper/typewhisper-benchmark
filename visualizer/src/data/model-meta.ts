/**
 * Hand-maintained facts about the benchmarked models, keyed by model id (`<providerId>:<model>`,
 * the pair in each result file name). Sources: the PR descriptions (#4–#11), the providers in
 * bench/src/providers/, and the plugins of TypeWhisper for macOS.
 *
 * A result file without an entry still shows up: `modelMeta()` derives a name from the id and the
 * runtime from the provider. Add an entry here when a new model lands.
 */

/** How a model relates to TypeWhisper. */
export type TwStatus =
  /** TypeWhisper ships the model (see `plugin`); `note` says where the benchmark setup differs. */
  | "engine"
  /** Measured as a possible engine. */
  | "candidate"
  /** A variant run to test one idea, not an app setting. */
  | "probe"
  /** Context only. */
  | "reference";

export interface ModelMeta {
  name: string;
  /** Label for charts, ideally under 24 characters. */
  short: string;
  org: string;
  family: string;
  params?: string;
  size?: string;
  quant?: string;
  license?: string;
  runtime: string;
  deployment: "local" | "cloud";
  /** Plain-language language coverage of the model. */
  languages?: string;
  /** Suite languages the model was trained for; scores in other languages are shown muted. */
  trainedFor?: string[];
  tw: { status: TwStatus; plugin?: string; isDefault?: boolean; note?: string };
  links?: Array<{ label: string; href: string }>;
  /** PR of this repository that added the model. */
  pr?: number;
  /** True when the entry was derived from the id because nobody has described the model yet. */
  derived?: boolean;
}

interface ProviderInfo {
  name: string;
  runtime: string;
  deployment: "local" | "cloud";
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  "apple-speech": { name: "Apple Speech", runtime: "SFSpeechRecognizer (macOS)", deployment: "local" },
  "aurora-asr": { name: "AuroraASR", runtime: "PyTorch (uv worker)", deployment: "local" },
  bark: { name: "Underdog Bark", runtime: "Core ML (model repo runner)", deployment: "local" },
  "bark-mlx": { name: "Underdog Bark", runtime: "MLX (model repo runner)", deployment: "local" },
  crispasr: { name: "CrispASR", runtime: "CrispASR 0.8.24 (GGUF, Metal)", deployment: "local" },
  deepgram: { name: "Deepgram", runtime: "Deepgram API", deployment: "cloud" },
  fluidaudio: { name: "FluidAudio", runtime: "FluidAudio 0.17.5 (Core ML)", deployment: "local" },
  groq: { name: "Groq", runtime: "Groq API", deployment: "cloud" },
  "kyutai-stt": { name: "Kyutai STT", runtime: "moshi_mlx 0.3.0 (MLX)", deployment: "local" },
  "mlx-audio": { name: "MLX Audio", runtime: "mlx-audio (MLX, Python)", deployment: "local" },
  "mlx-vlm": { name: "MLX-VLM", runtime: "mlx-vlm (MLX, Python)", deployment: "local" },
  openai: { name: "OpenAI", runtime: "OpenAI API", deployment: "cloud" },
  "sherpa-onnx": { name: "sherpa-onnx", runtime: "sherpa-onnx (ONNX, CPU)", deployment: "local" },
  "whisper-cpp": { name: "whisper.cpp", runtime: "whisper.cpp (whisper-cli)", deployment: "local" },
};

const hf = (repo: string) => ({ label: "Hugging Face", href: `https://huggingface.co/${repo}` });

const MLX_AUDIO_NOTE =
  "TypeWhisper runs it with mlx-audio-swift; this benchmark uses the Python mlx-audio package with the plugin's settings.";
const WHISPER_NOTE =
  "TypeWhisper runs these Whisper weights through WhisperKit (Core ML). whisper-cli reloads the model for every clip, so speed here is far below the app's.";
const EN = ["en"];
const EN_DE = ["en", "de"];

type Entry = Omit<ModelMeta, "runtime" | "deployment"> & Partial<Pick<ModelMeta, "runtime" | "deployment">>;

const parakeet = (patch: Partial<Entry>): Entry => ({
  name: "",
  short: "",
  org: "NVIDIA",
  family: "Parakeet",
  params: "0.6B",
  license: "CC BY 4.0",
  tw: { status: "engine", plugin: "Parakeet" },
  pr: 6,
  ...patch,
});

const whisperCpp = (size: string, params: string): Entry => ({
  name: `Whisper ${size} (whisper.cpp)`,
  short: `whisper.cpp ${size}`,
  org: "OpenAI",
  family: "Whisper",
  params,
  license: "MIT",
  languages: "About 100 languages",
  tw: { status: "engine", plugin: "WhisperKit", note: WHISPER_NOTE },
  links: [{ label: "GitHub", href: "https://github.com/openai/whisper" }],
});

const granite = (patch: Partial<Entry>): Entry => ({
  name: "",
  short: "",
  org: "IBM",
  family: "Granite Speech",
  license: "Apache 2.0",
  languages: "English, German, French, Spanish, Portuguese",
  trainedFor: EN_DE,
  tw: { status: "candidate" },
  pr: 10,
  ...patch,
});

const gigaam = (name: string, short: string, patch: Partial<Entry> = {}): Entry => ({
  name,
  short,
  org: "Sber (SaluteDevices)",
  family: "GigaAM",
  quant: "int8",
  license: "MIT",
  languages: "Russian",
  trainedFor: ["ru"],
  tw: { status: "candidate" },
  links: [{ label: "GitHub", href: "https://github.com/salute-developers/GigaAM" }],
  pr: 5,
  ...patch,
});

const lfm3 = (quant: string, note?: string): Entry => ({
  name: `LFM3-Audio-2B (${quant})`,
  short: `LFM3-Audio ${quant}`,
  org: "Liquid AI",
  family: "LFM3-Audio",
  params: "2B",
  quant,
  license: "LFM Open License v1.0",
  runtime: "mlx-vlm @230fc308 (MLX)",
  languages: "19 speech languages, no Russian",
  trainedFor: EN_DE,
  tw: { status: "candidate", note },
  links: [hf("LiquidAI/LFM3-Audio-2B")],
  pr: 11,
});

const ENTRIES: Record<string, Entry> = {
  "apple-speech:default": {
    name: "Apple Speech (SFSpeechRecognizer)",
    short: "Apple Speech",
    org: "Apple",
    family: "Apple Speech",
    license: "Part of macOS",
    languages: "macOS dictation languages",
    tw: {
      status: "reference",
      note: "The older SFSpeechRecognizer API. TypeWhisper's Apple engine uses SpeechAnalyzer, which this benchmark does not measure.",
    },
  },
  "aurora-asr:1m-fp32": {
    name: "AuroraASR-1M (FP32)",
    short: "AuroraASR-1M FP32",
    org: "AuroraAI-Research",
    family: "AuroraASR",
    params: "950K",
    quant: "FP32",
    languages: "English",
    trainedFor: EN,
    tw: { status: "reference", note: "English-only Conformer-CTC without casing or punctuation." },
    links: [hf("AuroraAI-Research/AuroraASR-1M")],
    pr: 4,
  },
  "aurora-asr:1m-int8": {
    name: "AuroraASR-1M (INT8)",
    short: "AuroraASR-1M INT8",
    org: "AuroraAI-Research",
    family: "AuroraASR",
    params: "950K",
    quant: "INT8",
    languages: "English",
    trainedFor: EN,
    tw: { status: "reference", note: "English-only Conformer-CTC without casing or punctuation." },
    links: [hf("AuroraAI-Research/AuroraASR-1M")],
    pr: 4,
  },
  "bark:3.0": {
    name: "Underdog Bark 3.0 (Core ML)",
    short: "Bark 3.0 Core ML",
    org: "ConwayResearch",
    family: "Underdog Bark",
    size: "202 MB",
    license: "CC BY 4.0",
    languages: "English",
    trainedFor: EN,
    tw: { status: "candidate", note: "Fine-tune of Parakeet TDT 0.6B v3." },
    links: [hf("ConwayResearch/Underdog-Bark-3.0")],
    pr: 6,
  },
  "bark:3.0-plus": {
    name: "Underdog Bark 3.0 Plus (Core ML)",
    short: "Bark 3.0 Plus",
    org: "ConwayResearch",
    family: "Underdog Bark",
    license: "CC BY 4.0",
    languages: "English",
    trainedFor: EN,
    tw: { status: "candidate", note: "Fine-tune of Parakeet TDT 0.6B v3." },
    links: [hf("ConwayResearch/Underdog-Bark-3.0")],
    pr: 6,
  },
  "bark-mlx:3.0": {
    name: "Underdog Bark 3.0 (MLX, 163 MB)",
    short: "Bark 3.0 MLX",
    org: "ConwayResearch",
    family: "Underdog Bark",
    size: "163 MB",
    license: "CC BY 4.0",
    runtime: "mlx-audio 0.5.3 (model repo runner)",
    languages: "English",
    trainedFor: EN,
    tw: { status: "candidate", note: "The 163 MB file the model card describes; same transcripts as the Core ML build." },
    links: [hf("ConwayResearch/Underdog-Bark-3.0")],
    pr: 7,
  },
  "fluidaudio:bark-3.0-pro": {
    name: "Underdog Bark 3.0 Pro",
    short: "Bark 3.0 Pro",
    org: "ConwayResearch",
    family: "Underdog Bark",
    size: "1.25 GB",
    license: "CC BY 4.0",
    languages: "English",
    trainedFor: EN,
    tw: {
      status: "candidate",
      note: "Runs with 0.25 s of leading silence and the short8 encoder for clips up to 8 s, as its model card evaluated.",
    },
    links: [hf("ConwayResearch/Underdog-Bark-3.0")],
    pr: 6,
  },
  "crispasr:cohere-transcribe-q5_0": {
    name: "Cohere Transcribe (Q5_0)",
    short: "Cohere Transcribe Q5_0",
    org: "Cohere",
    family: "Cohere Transcribe",
    size: "1.74 GB",
    quant: "Q5_0",
    license: "Apache 2.0",
    languages: "14 languages, no Russian, no auto-detect",
    trainedFor: EN_DE,
    tw: { status: "engine", plugin: "Cohere Transcribe (Local)", isDefault: true, note: "The plugin's default quantization." },
    pr: 10,
  },
  "crispasr:cohere-transcribe-q8_0": {
    name: "Cohere Transcribe (Q8_0)",
    short: "Cohere Transcribe Q8_0",
    org: "Cohere",
    family: "Cohere Transcribe",
    size: "2.42 GB",
    quant: "Q8_0",
    license: "Apache 2.0",
    languages: "14 languages, no Russian, no auto-detect",
    trainedFor: EN_DE,
    tw: { status: "engine", plugin: "Cohere Transcribe (Local)" },
    pr: 10,
  },
  "fluidaudio:fluid-speech-mini": parakeet({
    name: "Fluid Speech Mini",
    short: "Fluid Speech Mini",
    org: "FluidVoice",
    size: "~250 MB",
    languages: "English",
    trainedFor: EN,
    tw: { status: "engine", plugin: "Parakeet", note: "Built on Parakeet TDT 0.6B v3 and Parakeet Ultra." },
    links: [hf("FluidVoice-Labs/fluid-speech-mini-coreml")],
  }),
  "fluidaudio:nemotron-3.5-asr-streaming-0.6b": {
    name: "Nemotron 3.5 ASR Streaming 0.6B",
    short: "Nemotron 3.5 Streaming",
    org: "NVIDIA",
    family: "Nemotron",
    params: "0.6B",
    size: "~665 MB",
    license: "OpenMDW-1.1",
    languages: "28 languages",
    tw: { status: "engine", plugin: "Parakeet", note: "Streams while the user speaks; fed in 10 s blocks here, as the plugin does for files." },
    pr: 10,
  },
  "fluidaudio:nemotron-3.5-asr-streaming-0.6b-pad1s": {
    name: "Nemotron 3.5 ASR Streaming 0.6B, 1 s padding",
    short: "Nemotron +1 s padding",
    org: "NVIDIA",
    family: "Nemotron",
    params: "0.6B",
    license: "OpenMDW-1.1",
    languages: "28 languages",
    tw: { status: "probe", note: "Adds 1 s of silence before and after each clip. A probe, not an app setting." },
    pr: 10,
  },
  "fluidaudio:parakeet-tdt-0.6b-v2": parakeet({
    name: "Parakeet TDT 0.6B v2",
    short: "Parakeet TDT v2",
    size: "~600 MB",
    languages: "English",
    trainedFor: EN,
    links: [hf("nvidia/parakeet-tdt-0.6b-v2")],
  }),
  "fluidaudio:parakeet-tdt-0.6b-v3": parakeet({
    name: "Parakeet TDT 0.6B v3",
    short: "Parakeet TDT v3",
    size: "~600 MB",
    languages: "25 European languages",
    links: [hf("nvidia/parakeet-tdt-0.6b-v3")],
  }),
  "fluidaudio:parakeet-ultra": parakeet({
    name: "Parakeet Ultra",
    short: "Parakeet Ultra",
    org: "Moondream",
    size: "~630 MB",
    languages: "25 European languages",
    tw: {
      status: "engine",
      plugin: "Parakeet",
      isDefault: true,
      note: "Parakeet TDT v3 trained further. The Parakeet plugin's default model.",
    },
  }),
  "groq:whisper-large-v3": {
    name: "Whisper large-v3 (Groq)",
    short: "Groq large-v3",
    org: "OpenAI, hosted by Groq",
    family: "Whisper",
    params: "1.55B",
    license: "MIT (weights)",
    languages: "About 100 languages",
    tw: { status: "engine", plugin: "Groq" },
  },
  "groq:whisper-large-v3-turbo": {
    name: "Whisper large-v3-turbo (Groq)",
    short: "Groq large-v3-turbo",
    org: "OpenAI, hosted by Groq",
    family: "Whisper",
    params: "809M",
    license: "MIT (weights)",
    languages: "About 100 languages",
    tw: { status: "engine", plugin: "Groq" },
  },
  "kyutai-stt:stt-1b-en_fr": {
    name: "Kyutai STT 1B (en/fr)",
    short: "Kyutai STT 1B",
    org: "Kyutai",
    family: "Kyutai STT",
    params: "1B",
    license: "CC BY 4.0",
    languages: "English, French",
    trainedFor: EN,
    tw: { status: "candidate", note: "Streaming model; the sequential pass is slow on files." },
    links: [hf("kyutai/stt-1b-en_fr-mlx")],
    pr: 10,
  },
  "kyutai-stt:stt-2.6b-en": {
    name: "Kyutai STT 2.6B (en)",
    short: "Kyutai STT 2.6B",
    org: "Kyutai",
    family: "Kyutai STT",
    params: "2.6B",
    license: "CC BY 4.0",
    languages: "English",
    trainedFor: EN,
    tw: { status: "candidate", note: "Streaming model; the sequential pass is slow on files." },
    links: [hf("kyutai/stt-2.6b-en-mlx")],
    pr: 10,
  },
  "mlx-audio:canary-1b-v2": {
    name: "Canary 1B v2",
    short: "Canary 1B v2",
    org: "NVIDIA",
    family: "Canary",
    params: "1B",
    license: "CC BY 4.0",
    languages: "25 European languages",
    tw: { status: "candidate", note: "MLX conversion qfuxa/canary-mlx; the suite language is source and target, punctuation on." },
    links: [hf("nvidia/canary-1b-v2")],
    pr: 10,
  },
  "mlx-audio:granite-4.0-1b-speech-8bit": granite({
    name: "Granite Speech 4.0 1B (8-bit)",
    short: "Granite 4.0 1B 8-bit",
    params: "1B",
    quant: "8-bit",
    size: "~2.9 GB",
    tw: {
      status: "engine",
      plugin: "Granite Speech",
      note: `Called like the plugin: no language, built-in prompt. ${MLX_AUDIO_NOTE}`,
    },
    links: [hf("mlx-community/granite-4.0-1b-speech-8bit")],
  }),
  "mlx-audio:granite-speech-4.1-2b": granite({
    name: "Granite Speech 4.1 2B",
    short: "Granite 4.1 2B",
    params: "2B",
    quant: "bf16",
    tw: { status: "candidate", note: "Prompted for punctuation, as the model card recommends." },
    links: [hf("ibm-granite/granite-speech-4.1-2b")],
  }),
  "mlx-audio:granite-speech-4.1-2b-nar": granite({
    name: "Granite Speech 4.1 2B NAR",
    short: "Granite 4.1 2B NAR",
    params: "2B",
    links: [hf("mlx-community/granite-speech-4.1-2b-nar-mlx")],
  }),
  "mlx-audio:granite-speech-5.0-2b": granite({
    name: "Granite Speech 5.0 2B",
    short: "Granite 5.0 2B",
    params: "2B",
    quant: "bf16",
    size: "~4.6 GB",
    tw: {
      status: "engine",
      plugin: "Granite Speech",
      note: `Benchmarked with the model card's punctuation prompt. ${MLX_AUDIO_NOTE}`,
    },
    links: [hf("ibm-granite/granite-speech-5.0-2b")],
  }),
  "mlx-audio:granite-speech-5.0-470m-turboctc": granite({
    name: "Granite Speech 5.0 470M TurboCTC",
    short: "Granite 5.0 TurboCTC",
    params: "470M",
    quant: "bf16",
    size: "~950 MB",
    languages: "English, French, German, Spanish, Portuguese, Italian, Japanese",
    tw: {
      status: "engine",
      plugin: "Granite Speech",
      isDefault: true,
      note: `The Granite Speech plugin's default model. ${MLX_AUDIO_NOTE}`,
    },
    links: [hf("ibm-granite/granite-speech-5.0-470m-turboctc")],
  }),
  "mlx-audio:qwen3-asr-0.6b-8bit": {
    name: "Qwen3-ASR 0.6B (8-bit)",
    short: "Qwen3-ASR 0.6B",
    org: "Alibaba (Qwen)",
    family: "Qwen3-ASR",
    params: "0.6B",
    quant: "8-bit",
    size: "~1.0 GB",
    license: "Apache 2.0",
    languages: "Multilingual",
    tw: { status: "engine", plugin: "Qwen3", note: MLX_AUDIO_NOTE },
    links: [hf("mlx-community/Qwen3-ASR-0.6B-8bit")],
    pr: 5,
  },
  "mlx-audio:qwen3-asr-1.7b-8bit": {
    name: "Qwen3-ASR 1.7B (8-bit)",
    short: "Qwen3-ASR 1.7B",
    org: "Alibaba (Qwen)",
    family: "Qwen3-ASR",
    params: "1.7B",
    quant: "8-bit",
    size: "~2.5 GB",
    license: "Apache 2.0",
    languages: "Multilingual",
    tw: { status: "engine", plugin: "Qwen3", note: MLX_AUDIO_NOTE },
    links: [hf("mlx-community/Qwen3-ASR-1.7B-8bit")],
    pr: 5,
  },
  "mlx-audio:sophea-canary": {
    name: "Sophea Canary (EN/EL)",
    short: "Sophea Canary",
    org: "KIEFERSA",
    family: "Canary",
    size: "~1.9 GB",
    license: "CC BY 4.0",
    languages: "English, Greek",
    trainedFor: EN,
    tw: {
      status: "engine",
      plugin: "Canary",
      note: `Greek/English fine-tune; runs with English as the source language on every suite. ${MLX_AUDIO_NOTE}`,
    },
    links: [hf("KIEFERSA/Sophea-Canary-ASR-mlx")],
    pr: 10,
  },
  "mlx-audio:voxtral-mini-4b-realtime-4bit": {
    name: "Voxtral Mini 4B Realtime (4-bit)",
    short: "Voxtral Mini 4B",
    org: "Mistral AI",
    family: "Voxtral",
    params: "4B",
    quant: "4-bit",
    size: "~2.5 GB",
    license: "Apache 2.0",
    languages: "Multilingual",
    tw: { status: "engine", plugin: "Voxtral", note: MLX_AUDIO_NOTE },
    links: [hf("mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit")],
    pr: 5,
  },
  "mlx-vlm:lfm3-audio-2b-8bit": lfm3(
    "8-bit",
    "Liquid's recommended quantization. TypeWhisper could run it through the OpenAI Compatible plugin and llama-server (#11)."
  ),
  "mlx-vlm:lfm3-audio-2b-4bit": lfm3("4-bit"),
  "mlx-vlm:lfm3-audio-2b-bf16": lfm3("bf16"),
  "openai:gpt-4o-mini-transcribe": {
    name: "GPT-4o mini Transcribe",
    short: "gpt-4o-mini-transcribe",
    org: "OpenAI",
    family: "GPT-4o Transcribe",
    license: "Proprietary API",
    languages: "Multilingual",
    tw: { status: "engine", plugin: "OpenAI" },
  },
  "openai:gpt-4o-transcribe": {
    name: "GPT-4o Transcribe",
    short: "gpt-4o-transcribe",
    org: "OpenAI",
    family: "GPT-4o Transcribe",
    license: "Proprietary API",
    languages: "Multilingual",
    tw: { status: "engine", plugin: "OpenAI" },
  },
  "openai:whisper-1": {
    name: "Whisper (OpenAI API)",
    short: "OpenAI whisper-1",
    org: "OpenAI",
    family: "Whisper",
    license: "Proprietary API",
    languages: "About 100 languages",
    tw: { status: "engine", plugin: "OpenAI" },
  },
  "sherpa-onnx:canary-180m-flash": {
    name: "Canary 180M Flash (int8)",
    short: "Canary 180M Flash",
    org: "NVIDIA",
    family: "Canary",
    params: "180M",
    quant: "int8",
    license: "CC BY 4.0",
    languages: "English, German, Spanish, French",
    trainedFor: EN_DE,
    tw: { status: "reference" },
  },
  "sherpa-onnx:gigaam-v3-ctc": gigaam("GigaAM v3 CTC", "GigaAM v3 CTC"),
  "sherpa-onnx:gigaam-v3-ctc-punct": gigaam("GigaAM v3 CTC with punctuation", "GigaAM v3 CTC punct"),
  "sherpa-onnx:gigaam-v3-rnnt": gigaam("GigaAM v3 RNN-T", "GigaAM v3 RNN-T"),
  "sherpa-onnx:gigaam-v3-rnnt-punct": gigaam("GigaAM v3 RNN-T with punctuation", "GigaAM v3 RNN-T punct", {
    size: "~230 MB",
    tw: {
      status: "engine",
      plugin: "GigaAM",
      note: "The model TypeWhisper's GigaAM plugin ships (v3 end-to-end RNN-T); the plugin uses a different ONNX export.",
    },
  }),
  "sherpa-onnx:parakeet-tdt-0.6b": parakeet({
    name: "Parakeet TDT 0.6B v3 (sherpa-onnx int8)",
    short: "Parakeet v3 sherpa-onnx",
    quant: "int8",
    languages: "25 European languages",
    tw: { status: "reference", note: "TypeWhisper runs Parakeet through FluidAudio; this is the int8 ONNX build on the CPU." },
    pr: undefined,
  }),
  "whisper-cpp:tiny": whisperCpp("tiny", "39M"),
  "whisper-cpp:base": whisperCpp("base", "74M"),
  "whisper-cpp:small": whisperCpp("small", "244M"),
  "whisper-cpp:medium": whisperCpp("medium", "769M"),
  "whisper-cpp:large-v3": whisperCpp("large-v3", "1.55B"),
  "whisper-cpp:large-v3-turbo": whisperCpp("large-v3-turbo", "809M"),
};

const UPPER = new Set(["asr", "stt", "tdt", "ctc", "rnnt", "mlx", "gpt", "nar", "en", "de", "fr", "ru", "q4", "q5", "q8"]);

/** "granite-speech-5.0-2b" -> "Granite Speech 5.0 2B" */
export function prettifyModel(model: string): string {
  return model
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (UPPER.has(lower)) return lower.toUpperCase();
      if (/^\d+(\.\d+)?[bmk]$/i.test(part)) return part.toUpperCase();
      if (/\d/.test(part)) return part;
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function splitModelId(id: string): { provider: string; model: string } {
  const index = id.indexOf(":");
  return index < 0 ? { provider: "", model: id } : { provider: id.slice(0, index), model: id.slice(index + 1) };
}

const cache = new Map<string, ModelMeta>();

/** Metadata for a model id; derived from the id when there is no entry. */
export function modelMeta(id: string, providerType?: string): ModelMeta {
  const cached = cache.get(id);
  if (cached) return cached;
  const { provider, model } = splitModelId(id);
  const providerInfo = PROVIDERS[provider];
  const deployment: "local" | "cloud" =
    providerInfo?.deployment ?? (providerType === "cloud" ? "cloud" : "local");
  const entry = ENTRIES[id];
  const meta: ModelMeta = entry
    ? { runtime: providerInfo?.runtime ?? provider, deployment, ...entry }
    : {
        name: `${prettifyModel(model)}${providerInfo ? ` (${providerInfo.name})` : ""}`,
        short: prettifyModel(model),
        org: providerInfo?.name ?? provider,
        family: prettifyModel(model).split(" ")[0] ?? model,
        runtime: providerInfo?.runtime ?? provider,
        deployment,
        tw: { status: "reference" },
        derived: true,
      };
  cache.set(id, meta);
  return meta;
}

export function hasMetaEntry(id: string): boolean {
  return id in ENTRIES;
}

export const TW_STATUS_LABEL: Record<TwStatus, string> = {
  engine: "TypeWhisper engine",
  candidate: "Candidate",
  probe: "Probe",
  reference: "Reference",
};
