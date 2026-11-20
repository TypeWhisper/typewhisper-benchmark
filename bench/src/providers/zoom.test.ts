import { describe, expect, it } from "vitest";
import { createFastBody, createLiveSessionUpdate, LiveTranscript, transcriptText, ZoomProvider } from "./zoom.js";

describe("ZoomProvider", () => {
  it("offers the language models, the multilingual model and the English Pro models", () => {
    const provider = new ZoomProvider();
    expect(provider.id).toBe("zoom");
    expect(provider.type).toBe("cloud");
    expect(provider.supportsLanguage("zoom-scribe", "de")).toBe(true);
    expect(provider.supportsLanguage("zoom-scribe", "nl")).toBe(false);
    expect(provider.supportsLanguage("zoom-scribe-multilingual", "ru")).toBe(false);
    expect(provider.supportsLanguage("zoom-scribe-en-pro-v2.1", "en")).toBe(true);
    expect(provider.supportsLanguage("zoom-scribe-en-pro-v2.1", "de")).toBe(false);
  });

  it("sends the clip as a data URL with the language's locale", () => {
    const body = JSON.parse(createFastBody(new Uint8Array([1, 2, 3]), "zoom-scribe-de", "de"));
    expect(body).toEqual({ file: "data:audio/mp4;base64,AQID", config: { language: "de-DE", model: "zoom-scribe-de" } });
  });

  it("reads the display text and falls back to the segments", () => {
    expect(transcriptText({ result: { text_display: " Hallo Welt. " } })).toBe("Hallo Welt.");
    expect(transcriptText({ result: { segments: [{ text: "Hallo" }, { text: " Welt." }] } })).toBe("Hallo Welt.");
  });
});

describe("Zoom Live", () => {
  it("starts a session with partial results in the language's locale", () => {
    expect(createLiveSessionUpdate("zoom-scribe-multilingual", "fr")).toEqual({
      type: "session.update",
      config: { language: "fr-FR", model: "zoom-scribe-multilingual", interim_results: true },
      audio: { format: "pcm16" },
    });
  });

  it("keeps the final transcript per item and falls back to the latest delta", () => {
    const t = new LiveTranscript();
    t.handle({ type: "transcription.delta", item_id: "a", delta: "Mein 6." });
    t.handle({ type: "transcription.delta", item_id: "a", delta: "Mein sechster Sohn." });
    t.handle({ type: "transcription.delta", item_id: "b", delta: "Ist er" });
    t.handle({ type: "transcription.completed", item_id: "a", transcript: "Mein sechster Sohn scheint." });
    t.handle({ type: "transcription.delta", item_id: "a", delta: "ignored" });
    expect(t.text).toBe("Mein sechster Sohn scheint. Ist er");
    expect(t.openItems).toBe(1);
  });
});
