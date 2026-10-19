import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  AuroraAsrProvider,
  getAuroraAsrModelsBasePath,
  hasAuroraAsrModelFiles,
} from "./aurora-asr.js";

describe("AuroraAsrProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new AuroraAsrProvider();
    expect(provider.id).toBe("aurora-asr");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["1m-fp32", "1m-int8"]);
  });

  it("runs on explicit languages but not auto-detect", () => {
    const provider = new AuroraAsrProvider();
    expect(provider.supportsLanguage("1m-fp32", "en")).toBe(true);
    expect(provider.supportsLanguage("1m-fp32", "de")).toBe(true);
    expect(provider.supportsLanguage("1m-fp32", "auto")).toBe(false);
  });

  it("resolves the default models path from the repo root", () => {
    expect(getAuroraAsrModelsBasePath({})).toBe(
      fileURLToPath(new URL("../../../models/aurora-asr", import.meta.url))
    );
  });

  it("respects AURORA_ASR_MODELS_PATH overrides", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(
      getAuroraAsrModelsBasePath({ AURORA_ASR_MODELS_PATH: "models/aurora" })
    ).toBe(resolve(repoRoot, "models/aurora"));
  });

  it("requires at least one model directory for availability", () => {
    expect(hasAuroraAsrModelFiles(["fp32", "int8"], {}, () => false)).toBe(false);
    expect(
      hasAuroraAsrModelFiles(["fp32", "int8"], {}, (path) =>
        path.endsWith("int8/model.safetensors")
      )
    ).toBe(true);
  });
});
