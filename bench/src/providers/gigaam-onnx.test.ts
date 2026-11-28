import { describe, expect, it } from "vitest";
import {
  GIGAAM_MODELS,
  GigaAmOnnxProvider,
  MULTILINGUAL_V2_LANGUAGES,
  gigaAmLanguageSlot,
  hasGigaAmModelFiles,
} from "./gigaam-onnx.js";

describe("GigaAmOnnxProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new GigaAmOnnxProvider();
    expect(provider.id).toBe("gigaam-onnx");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["v3-e2e-rnnt", "v4-rnnt", "multilingual-v2-rnnt", "multilingual-v2-rnnt-auto"]);
  });

  it("runs each model only on the languages it was trained for", () => {
    const provider = new GigaAmOnnxProvider();
    expect(provider.supportsLanguage("v3-e2e-rnnt", "ru")).toBe(true);
    expect(provider.supportsLanguage("v3-e2e-rnnt", "en")).toBe(false);
    expect(provider.supportsLanguage("v4-rnnt", "en")).toBe(true);
    expect(provider.supportsLanguage("v4-rnnt", "de")).toBe(false);
    expect(provider.supportsLanguage("multilingual-v2-rnnt", "de")).toBe(true);
    expect(provider.supportsLanguage("multilingual-v2-rnnt", "auto")).toBe(false);
    expect(provider.supportsLanguage("multilingual-v2-rnnt-auto", "auto")).toBe(true);
    expect(provider.supportsLanguage("unknown", "ru")).toBe(false);
  });

  it("maps suite languages to Multilingual v2's language_vector slots", () => {
    expect(MULTILINGUAL_V2_LANGUAGES).toHaveLength(21);
    expect(gigaAmLanguageSlot("multilingual-v2-rnnt", "ru")).toBe(1);
    expect(gigaAmLanguageSlot("multilingual-v2-rnnt", "en")).toBe(2);
    expect(gigaAmLanguageSlot("multilingual-v2-rnnt", "de")).toBe(16);
    expect(gigaAmLanguageSlot("multilingual-v2-rnnt", "pt")).toBe(20);
    expect(gigaAmLanguageSlot("multilingual-v2-rnnt-auto", "de")).toBe(0);
    expect(gigaAmLanguageSlot("v4-rnnt", "en")).toBe(0);
  });

  it("needs an int8 encoder and a vocabulary in the model folder", () => {
    const env = { GIGAAM_MODELS_PATH: "/models" } as NodeJS.ProcessEnv;
    const list = (files: string[]) => () => files;
    expect(hasGigaAmModelFiles("v4", env, list(["v4_rnnt_encoder.int8.onnx", "v4_rnnt_e2e_vocab.txt"]))).toBe(true);
    expect(hasGigaAmModelFiles("v4", env, list(["v4_rnnt_encoder.int8.onnx"]))).toBe(false);
    expect(Object.values(GIGAAM_MODELS).map((m) => m.dir)).toContain("multilingual-v2");
  });
});
