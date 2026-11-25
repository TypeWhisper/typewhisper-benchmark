import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORUK_MODELS,
  OrukProvider,
  estimateOrukCost,
  resolveOrukEndpoint,
} from "./oruk.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("OrukProvider", () => {
  it("has correct provider metadata and English-only language support", () => {
    const provider = new OrukProvider();
    expect(provider.id).toBe("oruk");
    expect(provider.name).toBe("Oruk");
    expect(provider.type).toBe("cloud");
    expect(provider.models).toEqual(["oruk-fourier-2b"]);
    expect(ORUK_MODELS["oruk-fourier-2b"].costPerMinute).toBe(0.008);

    expect(provider.supportsLanguage("oruk-fourier-2b", "en")).toBe(true);
    expect(provider.supportsLanguage("oruk-fourier-2b", "de")).toBe(false);
    expect(provider.supportsLanguage("oruk-fourier-2b", "auto")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("reports availability based on ORUK_API_KEY", async () => {
    const original = process.env.ORUK_API_KEY;
    try {
      delete process.env.ORUK_API_KEY;
      const provider = new OrukProvider();
      expect(await provider.isAvailable()).toBe(false);
      process.env.ORUK_API_KEY = "oruk_test_dummy";
      expect(await provider.isAvailable()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.ORUK_API_KEY;
      else process.env.ORUK_API_KEY = original;
    }
  });

  it("normalizes endpoint URLs and estimates cost with 1-second minimum", () => {
    expect(resolveOrukEndpoint("")).toBe("https://speech-api.oruk.ai/v1/audio/transcriptions");
    expect(resolveOrukEndpoint("https://speech-api.oruk.ai/v1/")).toBe(
      "https://speech-api.oruk.ai/v1/audio/transcriptions"
    );
    expect(resolveOrukEndpoint("https://staging.example/v1/audio/transcriptions")).toBe(
      "https://staging.example/v1/audio/transcriptions"
    );
    expect(estimateOrukCost("oruk-fourier-2b", 60)).toBeCloseTo(0.008, 8);
    expect(estimateOrukCost("oruk-fourier-2b", 0.3)).toBeCloseTo(0.008 / 60, 8);
  });

  it("posts multipart form strictly matching Fourier2bRequest and fails fast on 401", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oruk-provider-"));
    tempDirs.push(dir);
    const clip = join(dir, "sample.wav");
    await writeFile(clip, Buffer.from("RIFFstub"));

    const original = process.env.ORUK_API_KEY;
    process.env.ORUK_API_KEY = "oruk_test_dummy";
    try {
      const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer oruk_test_dummy");
        const body = init?.body as FormData;
        expect(body.get("model")).toBe("oruk-fourier-2b");
        expect(body.get("response_format")).toBe("json");
        expect(body.get("language")).toBe("en");
        expect([...body.keys()].sort()).toEqual(["file", "language", "model", "response_format"]);
        return new Response(JSON.stringify({ text: "  Hello Fourier. " }), { status: 200 });
      });

      const provider = new OrukProvider(mockFetch as unknown as typeof fetch);
      const res = await provider.transcribe(
        { filePath: clip, format: "wav", sampleRate: 16000, durationSeconds: 4.054, language: "en" },
        "oruk-fourier-2b"
      );
      expect(res.text).toBe("Hello Fourier.");
      expect(res.model).toBe("oruk-fourier-2b");
      expect(res.cost).toBeCloseTo((4.054 / 60) * 0.008, 8);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const failFetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));
      const failProvider = new OrukProvider(failFetch as unknown as typeof fetch);
      await expect(
        failProvider.transcribe(
          { filePath: clip, format: "wav", sampleRate: 16000, durationSeconds: 2, language: "en" },
          "oruk-fourier-2b"
        )
      ).rejects.toThrow("Oruk API error (401)");
      expect(failFetch).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete process.env.ORUK_API_KEY;
      else process.env.ORUK_API_KEY = original;
    }
  });
});
