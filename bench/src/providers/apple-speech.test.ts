import { describe, it, expect } from "vitest";
import { AppleSpeechProvider } from "./apple-speech.js";

describe("AppleSpeechProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new AppleSpeechProvider();
    expect(provider.id).toBe("apple-speech");
    expect(provider.name).toBe("Apple Speech");
    expect(provider.type).toBe("system");
    expect(provider.models).toEqual(["default"]);
  });

  it("rejects auto language detection", () => {
    const provider = new AppleSpeechProvider();
    expect(provider.supportsLanguage("default", "auto")).toBe(false);
    expect(provider.supportsLanguage("default", "de")).toBe(true);
  });
});
