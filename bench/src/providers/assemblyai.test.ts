import { describe, expect, it } from "vitest";
import {
  AssemblyAIProvider,
  createAsyncTranscriptBody,
  createSyncConfig,
  createSyncForm,
} from "./assemblyai.js";

describe("AssemblyAIProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new AssemblyAIProvider();
    expect(provider.id).toBe("assemblyai");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual(["universal-3-5-pro", "universal-3-5-pro-sync"]);
  });

  it("runs Russian only on the Sync API, where Universal-3.5 Pro takes it", () => {
    const provider = new AssemblyAIProvider();
    expect(provider.supportsLanguage("universal-3-5-pro", "de")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro", "ru")).toBe(false);
    expect(provider.supportsLanguage("universal-3-5-pro", "auto")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-sync", "ru")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-sync", "pl")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("builds the plugin's async transcript body", () => {
    expect(createAsyncTranscriptBody("https://cdn/x", "de")).toEqual({
      audio_url: "https://cdn/x",
      speech_models: ["universal-3-5-pro"],
      language_code: "de",
    });
    expect(createAsyncTranscriptBody("https://cdn/x", "auto")).toEqual({
      audio_url: "https://cdn/x",
      speech_models: ["universal-3-5-pro"],
      language_detection: true,
    });
  });

  it("sends the language to the Sync API and no config part for auto", async () => {
    expect(createSyncConfig("en")).toEqual({ language_codes: ["en"] });
    expect(createSyncConfig("auto")).toBeNull();

    const form = createSyncForm(new Uint8Array([1, 2, 3]), "de");
    const audio = form.get("audio") as File;
    expect(audio.name).toBe("audio.m4a");
    expect(audio.type).toBe("audio/mp4");
    const config = form.get("config") as File;
    expect(config.type).toBe("application/json");
    expect(JSON.parse(await config.text())).toEqual({ language_codes: ["de"] });
    expect(createSyncForm(new Uint8Array([1]), "auto").has("config")).toBe(false);
  });
});
