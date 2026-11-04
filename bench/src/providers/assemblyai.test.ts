import { describe, expect, it, vi } from "vitest";
import {
  AssemblyAIProvider,
  createAsyncTranscriptBody,
  createRealtimeUrl,
  createSyncConfig,
  createSyncForm,
  joinTurns,
  RealtimeTranscript,
  realtimeFrames,
  SessionStartPacer,
} from "./assemblyai.js";

describe("AssemblyAIProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new AssemblyAIProvider();
    expect(provider.id).toBe("assemblyai");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual(["universal-3-5-pro", "universal-3-5-pro-sync", "universal-3-5-pro-realtime"]);
  });

  it("runs Russian only on the Sync API, where Universal-3.5 Pro takes it", () => {
    const provider = new AssemblyAIProvider();
    expect(provider.supportsLanguage("universal-3-5-pro", "de")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro", "ru")).toBe(false);
    expect(provider.supportsLanguage("universal-3-5-pro", "auto")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-sync", "ru")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-sync", "pl")).toBe(false);
    expect(provider.supportsLanguage("universal-3-5-pro-realtime", "de")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-realtime", "auto")).toBe(true);
    expect(provider.supportsLanguage("universal-3-5-pro-realtime", "ru")).toBe(false);
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

  it("builds the plugin's realtime URL, with the language only when Universal-3.5 Pro has it", () => {
    const de = new URL(createRealtimeUrl("de"));
    expect(`${de.origin}${de.pathname}`).toBe("wss://streaming.assemblyai.com/v3/ws");
    expect(Object.fromEntries(de.searchParams)).toEqual({
      sample_rate: "16000",
      speech_model: "universal-3-5-pro",
      language_codes: '["de"]',
    });
    expect(new URL(createRealtimeUrl("auto")).searchParams.has("language_codes")).toBe(false);
  });

  it("sends 100 ms frames and pads the last one to 50 ms", () => {
    const frames = realtimeFrames(Buffer.alloc((1_600 * 2 + 200) * 2, 1));
    expect(frames.map((frame) => frame.length / 2)).toEqual([1_600, 1_600, 800]);
    expect(frames[2].subarray(0, 400).every((byte) => byte === 1)).toBe(true);
    expect(frames[2].subarray(400).every((byte) => byte === 0)).toBe(true);
    expect(realtimeFrames(Buffer.alloc((1_600 + 900) * 2)).map((frame) => frame.length / 2)).toEqual([1_600, 900]);
  });

  it("joins turns with spaces except between Chinese or Japanese characters", () => {
    expect(joinTurns(["Hallo.", " ", "Wie geht's?"])).toBe("Hallo. Wie geht's?");
    expect(joinTurns(["你好。", "谢谢"])).toBe("你好。谢谢");
    expect(joinTurns(["OK", "谢谢"])).toBe("OK 谢谢");
  });

  it("keeps the formatted final of each turn and the partial of the open turn", () => {
    const transcript = new RealtimeTranscript();
    transcript.handleTurn({ turn_order: 0, transcript: "hallo welt", end_of_turn: false });
    expect(transcript.text).toBe("hallo welt");
    transcript.handleTurn({ turn_order: 0, transcript: "Hallo Welt.", end_of_turn: true, turn_is_formatted: true });
    transcript.handleTurn({ turn_order: 0, transcript: "hallo welt", end_of_turn: true, turn_is_formatted: false });
    transcript.handleTurn({ turn_order: 1, transcript: "noch", end_of_turn: false });
    expect(transcript.text).toBe("Hallo Welt. noch");
  });

  it("finishes once a turn after Terminate covers the audio sent", () => {
    const transcript = new RealtimeTranscript();
    transcript.handleTurn({ turn_order: 0, transcript: "Eins.", end_of_turn: true, words: [{ text: "Eins.", start: 100, end: 2_700 }] });
    transcript.markTerminateSent();
    // No turn finished after Terminate yet.
    expect(transcript.coversSentAudio(3)).toBe(false);
    transcript.handleTurn({ turn_order: 1, transcript: "Zwei", end_of_turn: false });
    transcript.handleTurn({ turn_order: 1, transcript: "Zwei.", end_of_turn: true, words: [{ text: "Zwei.", start: 2_200, end: 2_600 }] });
    // The last word ends 0.4 s before the end of the audio.
    expect(transcript.coversSentAudio(3)).toBe(false);
    transcript.handleTurn({ turn_order: 2, transcript: "Drei.", end_of_turn: true, words: [{ text: "Drei.", start: 2_700, end: 2_700 }] });
    expect(transcript.coversSentAudio(3)).toBe(true);
    transcript.handleTurn({ turn_order: 3, transcript: "vier", end_of_turn: false });
    expect(transcript.coversSentAudio(3)).toBe(false);
  });

  it("spaces session starts and holds them all back after a refusal", async () => {
    vi.useFakeTimers();
    try {
      const pacer = new SessionStartPacer(13_000);
      const t0 = Date.now();
      const starts: number[] = [];
      const start = async () => {
        await pacer.take();
        starts.push(Date.now() - t0);
      };
      const first = Promise.all([start(), start(), start()]);
      await vi.advanceTimersByTimeAsync(5_000);
      // Refused at 5 s: the starts booked for 13 s and 26 s wait until 65 s.
      pacer.pause(60_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await first;
      expect(starts).toEqual([0, 65_000, 78_000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
