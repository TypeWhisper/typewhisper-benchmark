import { describe, expect, it } from "vitest";
import { ARC_MODELS, ARC_REVISION, ArcProvider } from "./arc.js";

describe("ArcProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new ArcProvider();
    expect(provider.id).toBe("whissle-arc");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["mini", "transcriber"]);
  });

  it("maps the models to Arc's backbones at a pinned revision", () => {
    expect(ARC_MODELS.mini.backbone).toBe("mini");
    expect(ARC_MODELS.transcriber.backbone).toBe("full");
    expect(ARC_REVISION).toBe("v1.2.0");
  });

  it("runs only English suites", () => {
    const provider = new ArcProvider();
    expect(provider.supportsLanguage("mini", "en")).toBe(true);
    expect(provider.supportsLanguage("transcriber", "de")).toBe(false);
    expect(provider.supportsLanguage("mini", "auto")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });
});
