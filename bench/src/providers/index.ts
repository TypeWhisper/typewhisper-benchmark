import type { STTProvider } from "../types.js";
import { OpenAIProvider } from "./openai.js";
import { DeepgramProvider } from "./deepgram.js";
import { GroqProvider } from "./groq.js";
import { WhisperCppProvider } from "./whisper-cpp.js";
import { AppleSpeechProvider } from "./apple-speech.js";
import { SherpaOnnxProvider } from "./sherpa-onnx.js";
import { AuroraAsrProvider } from "./aurora-asr.js";
import { MlxAudioProvider } from "./mlx-audio.js";
import { FluidAudioProvider } from "./fluidaudio.js";
import { BarkProvider } from "./bark.js";
import { CrispAsrProvider } from "./crispasr.js";
import { KyutaiSttProvider } from "./kyutai-stt.js";
import { MlxVlmProvider } from "./mlx-vlm.js";
import { SpeechAnalyzerProvider } from "./speech-analyzer.js";
import { AudioCppProvider } from "./audiocpp.js";
import { NeedleProvider } from "./needle.js";
import { ArcProvider } from "./arc.js";

const ALL_PROVIDERS: STTProvider[] = [
  new OpenAIProvider(),
  new DeepgramProvider(),
  new GroqProvider(),
  new WhisperCppProvider(),
  new AppleSpeechProvider(),
  new SherpaOnnxProvider(),
  new AuroraAsrProvider(),
  new MlxAudioProvider(),
  new FluidAudioProvider(),
  new BarkProvider(),
  new BarkProvider(undefined, "mlx"),
  new CrispAsrProvider(),
  new KyutaiSttProvider(),
  new MlxVlmProvider(),
  new SpeechAnalyzerProvider(),
  new AudioCppProvider(),
  new NeedleProvider(),
  new ArcProvider(),
];

export function getAllProviders(): STTProvider[] {
  return ALL_PROVIDERS;
}

export async function getAvailableProviders(): Promise<STTProvider[]> {
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (p) => ({
      provider: p,
      available: await p.isAvailable(),
    }))
  );
  return results.filter((r) => r.available).map((r) => r.provider);
}

export function getProviderById(id: string): STTProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}
