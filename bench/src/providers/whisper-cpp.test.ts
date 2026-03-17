import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import {
  WhisperCppProvider,
  getWhisperCppModelPath,
  getWhisperCppModelsBasePath,
  hasWhisperCppModelFiles,
} from "./whisper-cpp.js";

describe("WhisperCppProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new WhisperCppProvider();
    expect(provider.id).toBe("whisper-cpp");
    expect(provider.name).toBe("whisper.cpp");
    expect(provider.type).toBe("local");
    expect(provider.models).toContain("large-v3");
    expect(provider.models).toContain("large-v3-turbo");
    expect(provider.models.length).toBe(6);
  });

  it("supports explicit and auto language modes", () => {
    const provider = new WhisperCppProvider();
    expect(provider.supportsLanguage("large-v3", "de")).toBe(true);
    expect(provider.supportsLanguage("large-v3", "auto")).toBe(true);
  });

  it("resolves the default models path from the repo root", () => {
    const expectedPath = fileURLToPath(
      new URL("../../../models", import.meta.url)
    );
    expect(getWhisperCppModelsBasePath({})).toBe(expectedPath);
    expect(getWhisperCppModelPath("tiny", {})).toBe(
      resolve(expectedPath, "ggml-tiny.bin")
    );
  });

  it("respects WHISPER_CPP_MODELS_PATH overrides", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const env = { WHISPER_CPP_MODELS_PATH: "models" };
    expect(getWhisperCppModelsBasePath(env)).toBe(
      resolve(repoRoot, "models")
    );
    expect(getWhisperCppModelPath("base", env)).toBe(
      resolve(repoRoot, "models", "ggml-base.bin")
    );
  });

  it("requires at least one model file for availability", () => {
    expect(
      hasWhisperCppModelFiles(["tiny", "base"], {}, () => false)
    ).toBe(false);
    expect(
      hasWhisperCppModelFiles(["tiny", "base"], {}, (path) =>
        path.endsWith("ggml-base.bin")
      )
    ).toBe(true);
  });
});
