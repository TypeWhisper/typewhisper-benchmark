import { describe, it, expect } from "vitest";
import {
  createDeepgramRequestOptions,
  DeepgramProvider,
} from "./deepgram.js";

describe("DeepgramProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new DeepgramProvider();
    expect(provider.id).toBe("deepgram");
    expect(provider.name).toBe("Deepgram");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toContain("nova-3");
    expect(provider.models).toContain("nova-2");
  });

  it("reports unavailable without API key", async () => {
    const originalKey = process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    const provider = new DeepgramProvider();
    expect(await provider.isAvailable()).toBe(false);
    if (originalKey) process.env.DEEPGRAM_API_KEY = originalKey;
  });

  it("supports explicit and auto language modes", () => {
    const provider = new DeepgramProvider();
    expect(provider.supportsLanguage("nova-3", "en")).toBe(true);
    expect(provider.supportsLanguage("nova-2", "auto")).toBe(true);
  });

  it("requests formatted transcripts", () => {
    const options = createDeepgramRequestOptions(
      {
        filePath: "sample.wav",
        format: "wav",
        sampleRate: 16000,
        durationSeconds: 1,
        language: "auto",
      },
      "nova-3"
    );

    expect(options).toMatchObject({
      model: "nova-3",
      detect_language: true,
      smart_format: true,
      punctuate: true,
    });
  });
});
