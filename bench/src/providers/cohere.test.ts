import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CohereProvider,
  cohereLanguages,
  cohereModels,
  createCohereForm,
  DEFAULT_COHERE_MODEL,
  isMonthlyLimit,
  RequestSpacer,
  retryDelayMs,
  wavHeader,
} from "./cohere.js";

describe("CohereProvider", () => {
  it("runs the plugin's model on the 14 Cohere Transcribe languages", () => {
    const provider = new CohereProvider({});
    expect(provider.id).toBe("cohere");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual([DEFAULT_COHERE_MODEL]);
    expect(provider.supportsLanguage(DEFAULT_COHERE_MODEL, "nl")).toBe(true);
    expect(provider.supportsLanguage(DEFAULT_COHERE_MODEL, "ru")).toBe(false);
    expect(provider.supportsLanguage(DEFAULT_COHERE_MODEL, "auto")).toBe(false);
    expect(provider.supportsLanguage("other-model", "en")).toBe(false);
  });

  it("takes model ids and languages from the environment", () => {
    expect(cohereModels({ COHERE_TRANSCRIBE_MODELS: " model-a, model-b ,model-a," })).toEqual(["model-a", "model-b"]);
    expect(cohereModels({ COHERE_TRANSCRIBE_MODELS: " " })).toEqual([DEFAULT_COHERE_MODEL]);
    expect([...cohereLanguages({ COHERE_TRANSCRIBE_LANGUAGES: "EN, de, auto" })]).toEqual(["en", "de"]);
    const provider = new CohereProvider({ COHERE_TRANSCRIBE_MODELS: "model-a" });
    expect(provider.models).toEqual(["model-a"]);
    expect(provider.supportsLanguage("model-a", "de")).toBe(true);
  });

  it("reports unavailable without API key", async () => {
    const original = process.env.COHERE_API_KEY;
    delete process.env.COHERE_API_KEY;
    expect(await new CohereProvider({}).isAvailable()).toBe(false);
    if (original) process.env.COHERE_API_KEY = original;
  });

  it("sends model, language and the clip as audio.wav", async () => {
    const form = createCohereForm(new Uint8Array([1, 2, 3]), DEFAULT_COHERE_MODEL, "de");
    expect(form.get("model")).toBe(DEFAULT_COHERE_MODEL);
    expect(form.get("language")).toBe("de");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(file.type).toBe("audio/wav");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("retries the per-minute limit but not the monthly trial cap", () => {
    expect(isMonthlyLimit('{"message":"You are using a Trial key, which is limited to 1000 API calls / month."}')).toBe(true);
    expect(isMonthlyLimit('{"message":"too many requests"}')).toBe(false);
    expect([1, 2, 3, 4, 5, 6].map((attempt) => retryDelayMs(attempt))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(retryDelayMs(3, 7_000)).toBe(7_000);
  });
});

describe("RequestSpacer", () => {
  it("spaces request starts evenly instead of letting a burst through", () => {
    let now = 1_000;
    const spacer = new RequestSpacer(5, () => now);
    expect([spacer.book(), spacer.book(), spacer.book()]).toEqual([0, 12_000, 24_000]);
    now += 60_000;
    expect(spacer.book()).toBe(0);
  });
});

describe("Cohere WAV upload", () => {
  it("writes the 44-byte header of 16 kHz mono 16-bit PCM with real sizes", () => {
    const header = wavHeader(32_000);
    expect(header.length).toBe(44);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.readUInt32LE(4)).toBe(36 + 32_000);
    expect(header.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(header.readUInt16LE(22)).toBe(1);
    expect(header.readUInt32LE(24)).toBe(16_000);
    expect(header.readUInt16LE(34)).toBe(16);
    expect(header.toString("ascii", 36, 40)).toBe("data");
    expect(header.readUInt32LE(40)).toBe(32_000);
  });
});

describe("Cohere requests", () => {
  const clip = fileURLToPath(new URL("../../audio/samples-en/clean-01.wav", import.meta.url));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends a clip again after a connection reset while the answer arrives", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key");
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("terminated"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: " Hello. " }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const provider = new CohereProvider({});
    const audio = { filePath: clip, format: "wav" as const, sampleRate: 16_000, durationSeconds: 3, language: "en" };
    const result = await provider.transcribe(audio, DEFAULT_COHERE_MODEL);
    expect(result.text).toBe("Hello.");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry the monthly cap", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key");
    const body = JSON.stringify({ message: "You are using a Trial key, which is limited to 1000 API calls / month." });
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const provider = new CohereProvider({});
    const audio = { filePath: clip, format: "wav" as const, sampleRate: 16_000, durationSeconds: 3, language: "en" };
    await expect(provider.transcribe(audio, DEFAULT_COHERE_MODEL)).rejects.toThrow(/Cohere 429/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
