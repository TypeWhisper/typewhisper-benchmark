import { describe, expect, it } from "vitest";
import {
  createAsyncTranscriptionBody,
  createRealtimeConfig,
  finalTokenText,
  isRealtimeModel,
  SonioxProvider,
} from "./soniox.js";

describe("SonioxProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new SonioxProvider();
    expect(provider.id).toBe("soniox");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual(["stt-rt-v6", "stt-rt-v5", "stt-async-v6", "stt-async-v5"]);
    expect(isRealtimeModel("stt-rt-v6")).toBe(true);
    expect(isRealtimeModel("stt-async-v6")).toBe(false);
  });

  it("starts real-time sessions like TypeWhisper's plugin", () => {
    expect(createRealtimeConfig("stt-rt-v6", "de")).toEqual({
      model: "stt-rt-v6",
      audio_format: "s16le",
      sample_rate: 16_000,
      num_channels: 1,
      enable_endpoint_detection: true,
      enable_language_identification: true,
      language_hints: ["de"],
    });
    expect(createRealtimeConfig("stt-rt-v6", "auto")).not.toHaveProperty("language_hints");
  });

  it("sends language hints to async transcriptions except for auto", () => {
    expect(createAsyncTranscriptionBody("f1", "stt-async-v6", "en")).toEqual({
      file_id: "f1",
      model: "stt-async-v6",
      language_hints: ["en"],
    });
    expect(createAsyncTranscriptionBody("f1", "stt-async-v6", "auto")).toEqual({ file_id: "f1", model: "stt-async-v6" });
  });

  it("keeps final tokens and drops interim tokens and markers", () => {
    expect(
      finalTokenText([
        { text: "Der", is_final: true },
        { text: " Umsatz", is_final: true },
        { text: "<end>", is_final: true },
        { text: " betrug", is_final: false },
        { text: "<fin>", is_final: true },
      ])
    ).toBe("Der Umsatz");
  });
});
