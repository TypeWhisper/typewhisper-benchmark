import { describe, expect, it } from "vitest";
import { SPEECH_ANALYZER_LOCALES, SpeechAnalyzerProvider } from "./speech-analyzer.js";

describe("SpeechAnalyzerProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new SpeechAnalyzerProvider();
    expect(provider.id).toBe("apple-speechanalyzer");
    expect(provider.type).toBe("system");
    expect(provider.models).toEqual(["speechtranscriber"]);
  });

  it("needs a locale, so it skips Russian and auto-detect", () => {
    const provider = new SpeechAnalyzerProvider();
    expect(SPEECH_ANALYZER_LOCALES.de).toBe("de-DE");
    expect(provider.supportsLanguage("speechtranscriber", "en")).toBe(true);
    expect(provider.supportsLanguage("speechtranscriber", "de")).toBe(true);
    expect(provider.supportsLanguage("speechtranscriber", "ru")).toBe(false);
    expect(provider.supportsLanguage("speechtranscriber", "auto")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });
});
