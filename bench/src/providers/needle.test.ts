import { describe, expect, it } from "vitest";
import { NEEDLE_MODELS, NeedleProvider, needleLanguage } from "./needle.js";

describe("NeedleProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new NeedleProvider();
    expect(provider.id).toBe("needle");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["whistle"]);
  });

  it("pins Whistle to a Hugging Face revision", () => {
    expect(NEEDLE_MODELS.whistle.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("runs the suite languages including auto-detect", () => {
    const provider = new NeedleProvider();
    expect(provider.supportsLanguage("whistle", "de")).toBe(true);
    expect(provider.supportsLanguage("whistle", "auto")).toBe(true);
    expect(provider.supportsLanguage("unknown", "de")).toBe(false);
  });

  it("hints only languages Whistle knows and lets it detect the rest", () => {
    expect(needleLanguage("whistle", "de")).toBe("de");
    expect(needleLanguage("whistle", "ru")).toBeNull();
    expect(needleLanguage("whistle", "auto")).toBeNull();
  });
});
