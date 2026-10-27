import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  FLUIDAUDIO_MODELS,
  FluidAudioProvider,
  LOCAL_MODEL_FILES,
  NEMOTRON_MODEL_FILES,
  getFluidAudioModelsBasePath,
  hasFluidAudioModelFiles,
  nemotronLanguagePrompt,
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
      "nemotron-3.5-asr-streaming-0.6b",
      "nemotron-3.5-asr-streaming-0.6b-pad1s",
    ]);
  });

  it("describes every model as an official repo, a local folder or a Nemotron folder", () => {
    for (const entry of Object.values(FLUIDAUDIO_MODELS)) {
      expect([entry.official, entry.local, entry.nemotron].filter(Boolean)).toHaveLength(1);
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

  it("needs every compiled component only for local folders", () => {
    expect(hasFluidAudioModelFiles("parakeet-ultra", {}, () => false)).toBe(true);
    expect(hasFluidAudioModelFiles("fluid-speech-mini", {}, () => false)).toBe(false);
    const inBarkPro = (path: string) => path.includes("/bark-3.0-pro/");
    expect(hasFluidAudioModelFiles("bark-3.0-pro", {}, inBarkPro)).toBe(true);
    // A folder left behind by an interrupted install, with only some components.
    expect(
      hasFluidAudioModelFiles("bark-3.0-pro", {}, (path) =>
        inBarkPro(path) && !path.endsWith(LOCAL_MODEL_FILES[2])
      )
    ).toBe(false);
    expect(hasFluidAudioModelFiles("unknown", {}, () => true)).toBe(false);
    const nemotron = "nemotron-3.5-asr-streaming-0.6b";
    expect(hasFluidAudioModelFiles(nemotron, {}, (path) => path.includes("-1120ms/"))).toBe(true);
    expect(
      hasFluidAudioModelFiles(nemotron, {}, (path) => !path.endsWith(NEMOTRON_MODEL_FILES[3]))
    ).toBe(false);
  });

  it("prompts Nemotron with the suite's locale and lets it detect the language on auto", () => {
    expect(nemotronLanguagePrompt("de")).toBe("de-DE");
    expect(nemotronLanguagePrompt("en")).toBe("en-US");
    expect(nemotronLanguagePrompt("auto")).toBeUndefined();
  });
});
