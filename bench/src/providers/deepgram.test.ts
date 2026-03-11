import { describe, it, expect } from "vitest";
import { DeepgramProvider } from "./deepgram.js";

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
});
