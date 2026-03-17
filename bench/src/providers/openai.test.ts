import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "./openai.js";

describe("OpenAIProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new OpenAIProvider();
    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toContain("whisper-1");
    expect(provider.models).toContain("gpt-4o-transcribe");
    expect(provider.models).toContain("gpt-4o-mini-transcribe");
  });

  it("reports unavailable without API key", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider();
    expect(await provider.isAvailable()).toBe(false);
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  });

  it("supports explicit and auto language modes", () => {
    const provider = new OpenAIProvider();
    expect(provider.supportsLanguage("whisper-1", "de")).toBe(true);
    expect(provider.supportsLanguage("gpt-4o-transcribe", "auto")).toBe(true);
  });
});
