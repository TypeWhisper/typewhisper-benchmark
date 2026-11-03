import { describe, expect, it } from "vitest";
import { createReson8Query, Reson8Provider } from "./reson8.js";

describe("Reson8Provider", () => {
  it("has correct provider metadata", () => {
    const provider = new Reson8Provider();
    expect(provider.id).toBe("reson8");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual(["resonant-1", "resonant-1-realtime", "rumble-2-flash"]);
  });

  it("runs Resonant-1 on its ten languages and Rumble-2-Flash on Russian too", () => {
    const provider = new Reson8Provider();
    expect(provider.supportsLanguage("resonant-1", "de")).toBe(true);
    expect(provider.supportsLanguage("resonant-1", "ru")).toBe(false);
    expect(provider.supportsLanguage("resonant-1", "auto")).toBe(true);
    expect(provider.supportsLanguage("rumble-2-flash", "ru")).toBe(true);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("builds the plugin's prerecorded query", () => {
    expect(Object.fromEntries(createReson8Query("resonant-1", "de"))).toEqual({
      encoding: "pcm_s16le",
      sample_rate: "16000",
      channels: "1",
      include_language: "true",
      language: "de",
      include_timestamps: "true",
      include_words: "true",
    });
    expect(Object.fromEntries(createReson8Query("rumble-2-flash", "auto"))).toEqual({
      encoding: "pcm_s16le",
      sample_rate: "16000",
      channels: "1",
      include_language: "true",
      model: "rumble-2-flash",
    });
    expect(createReson8Query("resonant-1-realtime", "en").get("include_interim")).toBe("true");
    expect(createReson8Query("resonant-1", "en").has("include_interim")).toBe(false);
  });
});
