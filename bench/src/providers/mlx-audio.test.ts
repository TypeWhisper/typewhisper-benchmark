import { describe, expect, it } from "vitest";
import { MLX_MODELS, MlxAudioProvider } from "./mlx-audio.js";

describe("MlxAudioProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new MlxAudioProvider();
    expect(provider.id).toBe("mlx-audio");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual([
      "qwen3-asr-0.6b-8bit",
      "qwen3-asr-1.7b-8bit",
      "voxtral-mini-4b-realtime-4bit",
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
    expect(provider.supportsLanguage("unknown", "ru")).toBe(false);
  });
});
