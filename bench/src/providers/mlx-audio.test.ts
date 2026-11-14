import { describe, expect, it, vi } from "vitest";
import {
  MLX_MODELS,
  MlxAudioProvider,
  generateOptions,
  germanMedicineTerms,
  nemotronTranscribePrompt,
  sovTranscribePrompt,
  stripSpeakerLabels,
} from "./mlx-audio.js";

describe("MlxAudioProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new MlxAudioProvider();
    expect(provider.id).toBe("mlx-audio");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual([
      "qwen3-asr-0.6b-8bit",
      "qwen3-asr-1.7b-8bit",
      "qwen3-asr-1.7b-8bit-plugin",
      "qwen3-asr-1.7b-8bit-medicine",
      "voxtral-mini-4b-realtime-4bit",
      "granite-4.0-1b-speech-8bit",
      "granite-speech-4.1-2b",
      "granite-speech-4.1-2b-nar",
      "granite-speech-5.0-2b",
      "granite-speech-5.0-470m-turboctc",
      "canary-1b-v2",
      "sophea-canary",
      "phonon-2.5",
      "parakeet-medical-de",
      "nemotron-3.5-transcribe-4bit",
      "nemotron-3.5-transcribe-4bit-written",
      "vibevoice-asr-streaming-1.5b",
      "sov-transcribe-1-8bit",
      "sov-transcribe-1-4bit",
    ]);
  });

  it("pins every model to a Hugging Face revision", () => {
    for (const entry of Object.values(MLX_MODELS)) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("runs on listed languages only", () => {
    const provider = new MlxAudioProvider();
    expect(provider.supportsLanguage("qwen3-asr-0.6b-8bit", "ru")).toBe(true);
    expect(provider.supportsLanguage("qwen3-asr-0.6b-8bit", "auto")).toBe(false);
    expect(provider.supportsLanguage("voxtral-mini-4b-realtime-4bit", "auto")).toBe(true);
    expect(provider.supportsLanguage("unknown", "ru")).toBe(false);
    expect(provider.supportsLanguage("canary-1b-v2", "auto")).toBe(false);
    expect(provider.supportsLanguage("granite-speech-5.0-2b", "ru")).toBe(false);
  });

  it("passes each model the language the way it expects it", () => {
    expect(generateOptions("qwen3-asr-0.6b-8bit", "de")).toEqual({ language: "German" });
    expect(generateOptions("canary-1b-v2", "de")).toEqual({ language: "de", max_tokens: 512 });
    // Granite's language argument selects translation, so transcription gets none.
    expect(generateOptions("granite-4.0-1b-speech-8bit", "de")).toEqual({});
    expect(generateOptions("granite-speech-5.0-2b", "de").language).toBeUndefined();
    expect(generateOptions("voxtral-mini-4b-realtime-4bit", "de")).toEqual({});
    expect(generateOptions("phonon-2.5", "de")).toEqual({});
    const medicine = generateOptions("qwen3-asr-1.7b-8bit-medicine", "de");
    expect(medicine.language).toBe("German");
    expect(String(medicine.system_prompt)).toMatch(/^Transcribe only words .*\nTechnical terms: Paracetamol, Ibuprofen, .*\.$/s);
    expect(germanMedicineTerms()).toHaveLength(315);
  });

  it("gives SOV-Transcribe-1 the model card's language hint, or its auto-language prompt", () => {
    expect(generateOptions("sov-transcribe-1-4bit", "fr")).toEqual({
      max_tokens: 1024,
      prompt: "Transcribe the French audio into text, ensuring all punctuation marks are included.",
    });
    expect(sovTranscribePrompt("auto")).toContain("in the language's standard writing system");
    const provider = new MlxAudioProvider();
    expect(provider.supportsLanguage("sov-transcribe-1-8bit", "pt")).toBe(true);
    expect(provider.supportsLanguage("sov-transcribe-1-8bit", "ru")).toBe(false);
  });

  it("names the suite language in Nemotron 3.5 Transcribe's prompt", () => {
    const options = generateOptions("nemotron-3.5-transcribe-4bit", "de");
    expect(options.max_tokens).toBe(1024);
    expect(options.prompt).toBe(nemotronTranscribePrompt("de"));
    expect(nemotronTranscribePrompt("de")).toContain("Language: German.");
    expect(nemotronTranscribePrompt("auto")).toContain("Language: as spoken.");
    // The card's optional number clause made the 4-bit model return empty transcripts.
    expect(nemotronTranscribePrompt("en")).not.toContain("numbers");
  });

  it("drops speaker labels from speaker-attributed transcripts", () => {
    expect(stripSpeakerLabels("Speaker 0:The quick brown fox.")).toBe("The quick brown fox.");
    expect(stripSpeakerLabels("Speaker 0: Hello. Speaker 1:Hi there.")).toBe("Hello. Hi there.");
    expect(stripSpeakerLabels("No labels here.")).toBe("No labels here.");
    expect(stripSpeakerLabels("Speaker 0:The quick brown fox.Speaker 1:Hi there.")).toBe("The quick brown fox. Hi there.");
  });
});

describe("MlxAudioProvider.release", () => {
  it("stops the main-branch worker when an unload queued behind a stuck clip misses the deadline", async () => {
    vi.useFakeTimers();
    try {
      const provider = new MlxAudioProvider();
      const dispose = vi.fn();
      // A clip that never answers holds the queue, so the unload behind it never runs.
      (provider as any).nextWorker = { request: () => new Promise(() => {}), dispose };
      const released = provider.release("sov-transcribe-1-4bit");
      await vi.advanceTimersByTimeAsync(30_000);
      await released;
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the main-branch worker when the unload answers", async () => {
    const provider = new MlxAudioProvider();
    const dispose = vi.fn();
    (provider as any).nextWorker = { request: async () => ({}), dispose };
    await provider.release("sov-transcribe-1-4bit");
    expect(dispose).not.toHaveBeenCalled();
  });
});
