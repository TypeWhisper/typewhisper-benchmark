import { describe, expect, it } from "vitest";
import { MLX_MODELS, MlxAudioProvider, generateOptions } from "./mlx-audio.js";

describe("MlxAudioProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new MlxAudioProvider();
    expect(provider.id).toBe("mlx-audio");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual([
      "qwen3-asr-0.6b-8bit",
      "qwen3-asr-1.7b-8bit",
      "voxtral-mini-4b-realtime-4bit",
      "granite-4.0-1b-speech-8bit",
      "granite-speech-4.1-2b",
      "granite-speech-4.1-2b-nar",
      "granite-speech-5.0-2b",
      "granite-speech-5.0-470m-turboctc",
      "canary-1b-v2",
      "sophea-canary",
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
  });
});
