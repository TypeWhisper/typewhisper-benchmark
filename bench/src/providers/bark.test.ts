import { fileURLToPath } from "url";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { BarkProvider, getBarkModelsBasePath, hasBarkModelFiles } from "./bark.js";

describe("BarkProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new BarkProvider();
    expect(provider.id).toBe("bark");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["3.0", "3.0-plus"]);
  });

  it("runs on explicit languages but not auto-detect", () => {
    const provider = new BarkProvider();
    expect(provider.supportsLanguage("3.0", "en")).toBe(true);
    expect(provider.supportsLanguage("3.0-plus", "de")).toBe(true);
    expect(provider.supportsLanguage("3.0", "auto")).toBe(false);
    expect(provider.supportsLanguage("3.0-pro", "en")).toBe(false);
  });

  it("resolves the models path from the repo root", () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    expect(getBarkModelsBasePath({})).toBe(resolve(repoRoot, "models/bark"));
    expect(getBarkModelsBasePath({ BARK_MODELS_PATH: "models/b" })).toBe(resolve(repoRoot, "models/b"));
  });

  it("looks for the runner shipped with the pinned model revision", () => {
    expect(hasBarkModelFiles("3.0", {}, () => false)).toBe(false);
    expect(
      hasBarkModelFiles("3.0", {}, (path) => path.endsWith("3.0/coreml/ane/bark_coreml.py"))
    ).toBe(true);
  });
});
