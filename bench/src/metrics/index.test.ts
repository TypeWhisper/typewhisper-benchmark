import { describe, it, expect } from "vitest";
import { computeMetrics } from "./index.js";

describe("computeMetrics", () => {
  it("computes all metrics for a matching transcription", () => {
    const result = computeMetrics({
      reference: "Hello world",
      hypothesis: "Hello world",
      language: "en",
    });
    expect(result.werRaw).toBe(0);
    expect(result.werNormalized).toBe(0);
    expect(result.cer).toBe(0);
  });

  it("computes metrics with normalization benefit", () => {
    const result = computeMetrics({
      reference: "I have 3 cats",
      hypothesis: "I have three cats",
      language: "en",
    });
    expect(result.werRaw).toBeGreaterThan(0);
    expect(result.werNormalized).toBe(0);
  });

  it("computes metrics for German text", () => {
    const result = computeMetrics({
      reference: "Ich habe 3 Katzen",
      hypothesis: "ich habe drei katzen",
      language: "de",
    });
    expect(result.werNormalized).toBe(0);
  });

  it("handles completely wrong transcription", () => {
    const result = computeMetrics({
      reference: "the quick brown fox",
      hypothesis: "a lazy red dog",
      language: "en",
    });
    expect(result.werNormalized).toBe(1);
    expect(result.cer).toBeGreaterThan(0);
  });
});
