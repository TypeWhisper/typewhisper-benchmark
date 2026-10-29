import { describe, expect, it } from "vitest";
import {
  CrispAsrProvider,
  hasCrispAsrModelFiles,
  padWavToOneSecond,
  serverArguments,
  VAD_FILE,
} from "./crispasr.js";

function wav(samples: number, sampleRate = 16_000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2, 1)]);
}

describe("CrispAsrProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new CrispAsrProvider();
    expect(provider.id).toBe("crispasr");
    expect(provider.type).toBe("local");
    expect(provider.models).toEqual([
      "cohere-transcribe-q5_0",
      "cohere-transcribe-q8_0",
      "hojo-asr-multi-v1-f16",
      "fun-asr-mlt-nano-f16",
      "canary-qwen-2.5b-q8_0",
      "gemma4-e4b-it-q8_0",
      "voxtral-mini-3b-2507-q8_0",
      "parakeet-redux-f16",
    ]);
  });

  it("starts candidates on the newer runtime without the plugin's VAD pipeline", () => {
    const args = serverArguments("hojo-asr-multi-v1-f16", 4321, "/m");
    expect(args).not.toContain("--require-vad");
    expect(args).not.toContain("--vad");
    expect(args).toContain("/m/candidates/hojo-asr-multi-v1-f16.gguf");
    expect(args.slice(args.indexOf("--backend"), args.indexOf("--backend") + 2)).toEqual(["--backend", "hojo-asr"]);
    expect(hasCrispAsrModelFiles("parakeet-redux-f16", {}, (p) => !p.endsWith(VAD_FILE))).toBe(true);
    expect(hasCrispAsrModelFiles("parakeet-redux-f16", {}, (p) => !p.includes("runtime-0.8.47"))).toBe(false);
  });

  it("runs English-only candidates on English and, for the record, German and Russian", () => {
    const provider = new CrispAsrProvider();
    expect(provider.supportsLanguage("canary-qwen-2.5b-q8_0", "de")).toBe(true);
    expect(provider.supportsLanguage("canary-qwen-2.5b-q8_0", "auto")).toBe(false);
    expect(provider.supportsLanguage("parakeet-redux-f16", "auto")).toBe(true);
  });

  it("runs Cohere only on explicitly selected languages it supports", () => {
    const provider = new CrispAsrProvider();
    expect(provider.supportsLanguage("cohere-transcribe-q5_0", "de")).toBe(true);
    expect(provider.supportsLanguage("cohere-transcribe-q5_0", "ru")).toBe(false);
    expect(provider.supportsLanguage("cohere-transcribe-q5_0", "auto")).toBe(false);
  });

  it("starts the server the way TypeWhisper's plugin does", () => {
    const args = serverArguments("cohere-transcribe-q5_0", 4321, "/m");
    expect(args).toContain("--require-vad");
    expect(args.slice(args.indexOf("--backend"), args.indexOf("--backend") + 2)).toEqual(["--backend", "cohere"]);
    expect(args).toContain("/m/cohere-transcribe-q5_0.gguf");
  });

  it("needs the runtime, the VAD model and the GGUF file", () => {
    expect(hasCrispAsrModelFiles("cohere-transcribe-q5_0", {}, () => true)).toBe(true);
    expect(hasCrispAsrModelFiles("cohere-transcribe-q5_0", {}, (p) => !p.endsWith(".gguf"))).toBe(false);
    expect(hasCrispAsrModelFiles("unknown", {}, () => true)).toBe(false);
  });

  it("pads clips shorter than one second with trailing silence", () => {
    const padded = padWavToOneSecond(wav(8_000));
    expect(padded.readUInt32LE(40)).toBe(32_000);
    expect(padded.length).toBe(44 + 32_000);
    expect(padded.readUInt32LE(4)).toBe(padded.length - 8);
    const long = wav(20_000);
    expect(padWavToOneSecond(long)).toBe(long);
  });
});
