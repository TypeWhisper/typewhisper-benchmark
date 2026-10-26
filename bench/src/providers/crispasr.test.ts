import { describe, expect, it } from "vitest";
import {
  CrispAsrProvider,
  hasCrispAsrModelFiles,
  padWavToOneSecond,
  serverArguments,
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
    expect(provider.models).toEqual(["cohere-transcribe-q5_0", "cohere-transcribe-q8_0"]);
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
