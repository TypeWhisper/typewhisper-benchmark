import type { STTProvider } from "../types.js";
import { OpenAIProvider } from "./openai.js";
import { DeepgramProvider } from "./deepgram.js";
import { GroqProvider } from "./groq.js";
import { WhisperCppProvider } from "./whisper-cpp.js";
import { AppleSpeechProvider } from "./apple-speech.js";

const ALL_PROVIDERS: STTProvider[] = [
  new OpenAIProvider(),
  new DeepgramProvider(),
  new GroqProvider(),
  new WhisperCppProvider(),
  new AppleSpeechProvider(),
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
