import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getSherpaOnnxModelsBasePath } from "./sherpa-onnx.js";

describe("SherpaOnnxProvider", () => {
  it("resolves the default models path from the repo root", () => {
    expect(getSherpaOnnxModelsBasePath({})).toBe(
      fileURLToPath(new URL("../../../models/sherpa-onnx", import.meta.url))
    );
  });

  it("respects SHERPA_ONNX_MODELS_PATH overrides", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(
      getSherpaOnnxModelsBasePath({
        SHERPA_ONNX_MODELS_PATH: "models/sherpa-onnx",
      })
    ).toBe(resolve(repoRoot, "models/sherpa-onnx"));
  });
});
