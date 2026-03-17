import { describe, it, expect } from "vitest";
import { GroqProvider } from "./groq.js";

describe("GroqProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new GroqProvider();
    expect(provider.id).toBe("groq");
    expect(provider.name).toBe("Groq");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toContain("whisper-large-v3");
    expect(provider.models).toContain("whisper-large-v3-turbo");
  });

  it("reports unavailable without API key", async () => {
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const provider = new GroqProvider();
    expect(await provider.isAvailable()).toBe(false);
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  });

  it("supports explicit and auto language modes", () => {
    const provider = new GroqProvider();
    expect(provider.supportsLanguage("whisper-large-v3", "en")).toBe(true);
    expect(provider.supportsLanguage("whisper-large-v3-turbo", "auto")).toBe(true);
  });
});
