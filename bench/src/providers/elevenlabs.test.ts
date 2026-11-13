import { describe, expect, it } from "vitest";
import {
  audioMessage,
  createBatchForm,
  createRealtimeUrl,
  ElevenLabsProvider,
  isRealtimeError,
  joinedText,
  LiveCommitPolicy,
} from "./elevenlabs.js";

/** 16-bit PCM of `seconds` at a constant level. */
function pcm(seconds: number, level: number): Buffer {
  const samples = Math.round(seconds * 16_000);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(level * 32_767) * (i % 2 ? 1 : -1), i * 2);
  return buffer;
}

describe("ElevenLabsProvider", () => {
  it("has the plugin's batch and realtime models", () => {
    const provider = new ElevenLabsProvider();
    expect(provider.id).toBe("elevenlabs");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual([
      "scribe_v3",
      "scribe_v2",
      "scribe_v3_live",
      "scribe_v3_live-multilang",
      "scribe_v2_realtime",
    ]);
  });

  it("takes Scribe's languages and auto", () => {
    const provider = new ElevenLabsProvider();
    expect(provider.supportsLanguage("scribe_v3", "ru")).toBe(true);
    expect(provider.supportsLanguage("scribe_v3_live", "auto")).toBe(true);
    expect(provider.supportsLanguage("scribe_v2_realtime", "jw")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("builds the plugin's batch request", async () => {
    const form = createBatchForm(new Uint8Array([1, 2]), "scribe_v3", "de");
    expect([...form.keys()]).toEqual([
      "file",
      "model_id",
      "language_code",
      "timestamps_granularity",
      "tag_audio_events",
      "no_verbatim",
      "num_speakers",
    ]);
    expect(form.get("model_id")).toBe("scribe_v3");
    expect(form.get("language_code")).toBe("de");
    expect(form.get("no_verbatim")).toBe("true");
    expect(form.get("num_speakers")).toBe("1");
    expect(createBatchForm(new Uint8Array([1]), "scribe_v2", "auto").has("language_code")).toBe(false);
  });

  it("builds the plugin's realtime URL, with multilang_mode only when asked", () => {
    const de = new URL(createRealtimeUrl("scribe_v3_live", "de"));
    expect(de.origin + de.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(Object.fromEntries(de.searchParams)).toEqual({
      model_id: "scribe_v3_live",
      audio_format: "pcm_16000",
      commit_strategy: "manual",
      no_verbatim: "true",
      include_timestamps: "true",
      language_code: "de",
    });
    const auto = new URL(createRealtimeUrl("scribe_v3_live", "auto", true));
    expect(auto.searchParams.get("multilang_mode")).toBe("true");
    expect(auto.searchParams.get("include_language_detection")).toBe("true");
    expect(auto.searchParams.has("language_code")).toBe(false);
  });

  it("sends audio chunks and commits as the plugin does", () => {
    expect(JSON.parse(audioMessage(Buffer.from([1, 0]), false))).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "AQA=",
      sample_rate: 16000,
      commit: false,
    });
    expect(JSON.parse(audioMessage(Buffer.alloc(0), true))).toMatchObject({ audio_base_64: "", commit: true });
  });

  it("commits in a pause after 20 s, always at 30 s, and pads the final commit", () => {
    const paused = new LiveCommitPolicy();
    paused.append(pcm(19, 0.3));
    paused.append(pcm(0.8, 0.0));
    expect(paused.shouldCommit).toBe(false); // 19.8 s
    paused.append(pcm(0.2, 0.0));
    expect(paused.shouldCommit).toBe(true); // 20 s with a 1 s pause

    const noPause = new LiveCommitPolicy();
    noPause.append(pcm(25, 0.3));
    expect(noPause.shouldCommit).toBe(false);

    const speaking = new LiveCommitPolicy();
    speaking.append(pcm(29.9, 0.3));
    expect(speaking.shouldCommit).toBe(false);
    speaking.append(pcm(0.1, 0.3));
    expect(speaking.shouldCommit).toBe(true);
    speaking.didCommit();
    expect(speaking.uncommittedSamples).toBe(0);

    const short = new LiveCommitPolicy();
    short.append(pcm(0.1, 0.3));
    expect(short.finalCommitPaddingSamples).toBe(4_800);
  });

  it("joins commit texts like the plugin", () => {
    expect(joinedText(["Hallo.", "", "Wie geht's?"])).toBe("Hallo. Wie geht's?");
    expect(joinedText(["你好", "世界"])).toBe("你好世界");
  });

  it("treats the plugin's realtime errors as the end of a session", () => {
    expect(isRealtimeError("invalid_request")).toBe(true);
    expect(isRealtimeError("auth_error")).toBe(true);
    expect(isRealtimeError("partial_transcript")).toBe(false);
    expect(isRealtimeError("warning")).toBe(false);
  });
});
