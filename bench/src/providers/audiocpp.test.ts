import { describe, expect, it } from "vitest";
import { AudioCppProvider, livePath, serverConfig, transcriptFromEvents } from "./audiocpp.js";

describe("AudioCppProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new AudioCppProvider();
    expect(provider.id).toBe("audiocpp");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["confucius4-r2t2-q8_0"]);
    expect(provider.supportsLanguage("confucius4-r2t2-q8_0", "auto")).toBe(true);
  });

  it("configures the server like TypeWhisper's Confucius4-R2T2 plugin", () => {
    const config = serverConfig("confucius4-r2t2-q8_0", 4321, "/m") as any;
    expect(config.port).toBe(4321);
    expect(config.backend).toBe("metal");
    expect(config.models[0]).toMatchObject({
      id: "r2t2",
      family: "confucius4_r2t2",
      path: "/m/r2t2-q8_0.gguf",
      mode: "streaming",
      session_options: { "confucius4_r2t2.chunk_size_ms": "320" },
    });
  });

  it("names the language like the plugin and lets the model detect it on auto", () => {
    expect(livePath("de")).toBe(
      "/v1/audio/transcriptions/live?model=r2t2&sample_rate=16000&channels=1&sample_format=s16le&language=German"
    );
    expect(livePath("auto")).not.toContain("language=");
  });

  it("reads the final transcript from the event stream", () => {
    const events = [
      'data: {"type":"transcript.text.delta","delta":"Hallo "}',
      'data: {"type":"transcript.text.delta","delta":"Welt"}',
      'data: {"type":"transcript.text.done","text":"Hallo Welt."}',
      "data: [DONE]",
    ].join("\n\n");
    expect(transcriptFromEvents(events)).toBe("Hallo Welt.");
    expect(transcriptFromEvents(events.split("\n\n").slice(0, 2).join("\n\n"))).toBe("Hallo Welt");
    expect(() => transcriptFromEvents('data: {"type":"error","error":{"message":"boom"}}')).toThrow("boom");
  });
});
