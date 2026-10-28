import { describe, expect, it } from "vitest";
import { MlxVlmProvider, VLM_MODELS, asrSystemPrompt } from "./mlx-vlm.js";

describe("MlxVlmProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new MlxVlmProvider();
    expect(provider.id).toBe("mlx-vlm");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["lfm3-audio-2b-8bit", "lfm3-audio-2b-4bit", "lfm3-audio-2b-bf16"]);
  });

  it("pins every model to a Hugging Face revision", () => {
    for (const entry of Object.values(VLM_MODELS)) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("runs LFM3-Audio on its languages and auto-detect, not Russian", () => {
    const provider = new MlxVlmProvider();
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "en")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "de")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "auto")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "ru")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("names the language in the ASR prompt, or lets the model infer it", () => {
    expect(asrSystemPrompt("en")).toBe("Perform ASR in English.");
    expect(asrSystemPrompt("de")).toBe("Perform ASR in German.");
    expect(asrSystemPrompt("auto")).toBe("Perform ASR.");
  });
});
