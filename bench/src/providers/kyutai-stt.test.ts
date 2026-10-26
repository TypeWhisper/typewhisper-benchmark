import { describe, expect, it } from "vitest";
import { KYUTAI_MODELS, KyutaiSttProvider } from "./kyutai-stt.js";

describe("KyutaiSttProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new KyutaiSttProvider();
    expect(provider.id).toBe("kyutai-stt");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["stt-1b-en_fr", "stt-2.6b-en"]);
  });

  it("pins every model to a Hugging Face revision", () => {
    for (const entry of Object.values(KYUTAI_MODELS)) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("runs on English suites only", () => {
    const provider = new KyutaiSttProvider();
    expect(provider.supportsLanguage("stt-1b-en_fr", "en")).toBe(true);
    expect(provider.supportsLanguage("stt-1b-en_fr", "de")).toBe(false);
    expect(provider.supportsLanguage("stt-2.6b-en", "auto")).toBe(false);
  });
});
