import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { MlxVlmProvider, VLM_MODELS, asrSystemPrompt } from "./mlx-vlm.js";

describe("MlxVlmProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new MlxVlmProvider();
    expect(provider.id).toBe("mlx-vlm");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual(["lfm3-audio-2b-8bit", "lfm3-audio-2b-4bit", "lfm3-audio-2b-bf16"]);
  });

  it("pins every model to a Hugging Face revision", () => {
    for (const entry of Object.values(VLM_MODELS)) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("runs LFM3-Audio on its languages and auto-detect, not Russian", () => {
    const provider = new MlxVlmProvider();
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "en")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "de")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "auto")).toBe(true);
    expect(provider.supportsLanguage("lfm3-audio-2b-8bit", "ru")).toBe(false);
    expect(provider.supportsLanguage("unknown", "en")).toBe(false);
  });

  it("names the language in the ASR prompt, or lets the model infer it", () => {
    expect(asrSystemPrompt("en")).toBe("Perform ASR in English.");
    expect(asrSystemPrompt("de")).toBe("Perform ASR in German.");
    expect(asrSystemPrompt("auto")).toBe("Perform ASR.");
  });
});

describe("MlxVlmProvider deadlines", () => {
  // Stand-ins for `uv run --script worker.py`: one never gets ready, one never answers.
  const fakeUv = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "mlx-vlm-test-"));
    const path = join(dir, "uv");
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  it("fails preparation that does not finish in time and stops the worker", async () => {
    const provider = new MlxVlmProvider(fakeUv("exec sleep 30"), { prepareMs: 200 });
    await expect(provider.prepare("lfm3-audio-2b-8bit")).rejects.toThrow(/did not answer within 0.2 s/);
    expect((provider as any).worker).toBeUndefined();
  });

  it("fails a stuck transcription and starts a new worker for the next one", async () => {
    const uv = fakeUv(`echo '{"ready": true}'; exec sleep 30`);
    const provider = new MlxVlmProvider(uv, { transcribeMs: 200 });
    const audio = { filePath: "/tmp/x.wav", format: "wav" as const, sampleRate: 16000, durationSeconds: 1, language: "en" };
    await expect(provider.transcribe(audio, "lfm3-audio-2b-8bit")).rejects.toThrow(/did not answer/);
    expect((provider as any).worker).toBeUndefined();
    await expect(provider.transcribe(audio, "lfm3-audio-2b-8bit")).rejects.toThrow(/did not answer/);
    provider.dispose();
  });
});
