import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  FLUIDAUDIO_MODELS,
  FluidAudioProvider,
  getFluidAudioModelsBasePath,
  hasFluidAudioModelFiles,
} from "./fluidaudio.js";

describe("FluidAudioProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new FluidAudioProvider();
    expect(provider.id).toBe("fluidaudio");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual([
      "parakeet-tdt-0.6b-v3",
      "parakeet-tdt-0.6b-v2",
      "parakeet-ultra",
      "fluid-speech-mini",
      "bark-3.0-pro",
    ]);
  });

  it("describes every model either as an official repo or a local folder", () => {
    for (const entry of Object.values(FLUIDAUDIO_MODELS)) {
      expect(Boolean(entry.official) !== Boolean(entry.local)).toBe(true);
      if (entry.local) expect(entry.version).toBeDefined();
    }
  });

  it("runs multilingual models everywhere and English-only models on explicit languages", () => {
    const provider = new FluidAudioProvider();
    expect(provider.supportsLanguage("parakeet-ultra", "auto")).toBe(true);
    expect(provider.supportsLanguage("parakeet-tdt-0.6b-v3", "ru")).toBe(true);
    expect(provider.supportsLanguage("fluid-speech-mini", "de")).toBe(true);
    expect(provider.supportsLanguage("bark-3.0-pro", "auto")).toBe(false);
    expect(provider.supportsLanguage("parakeet-tdt-0.6b-v2", "auto")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("resolves the models path from the repo root", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(getFluidAudioModelsBasePath({})).toBe(resolve(repoRoot, "models/fluidaudio"));
    expect(getFluidAudioModelsBasePath({ FLUIDAUDIO_MODELS_PATH: "models/fa" })).toBe(
      resolve(repoRoot, "models/fa")
    );
  });

  it("needs a compiled encoder only for local folders", () => {
    expect(hasFluidAudioModelFiles("parakeet-ultra", {}, () => false)).toBe(true);
    expect(hasFluidAudioModelFiles("fluid-speech-mini", {}, () => false)).toBe(false);
    expect(
      hasFluidAudioModelFiles("bark-3.0-pro", {}, (path) =>
        path.endsWith("bark-3.0-pro/Encoder.mlmodelc")
      )
    ).toBe(true);
    expect(hasFluidAudioModelFiles("unknown", {}, () => true)).toBe(false);
  });
});
