import { describe, expect, it } from "vitest";
import {
  buildBenchmarkSummary,
  mergeBenchmarkSummaries,
} from "./summary.js";
import type { STTProvider, TestResult, TestSuite } from "./types.js";

const provider: STTProvider = {
  id: "mock",
  name: "Mock",
  type: "cloud",
  models: ["baseline"],
  async transcribe() {
    return {
      text: "",
      durationMs: 0,
      model: "baseline",
    };
  },
  async isAvailable() {
    return true;
  },
  supportsLanguage() {
    return true;
  },
};

function createResult(overrides: Partial<TestResult>): TestResult {
  return {
    testId: "de-fast-01",
    suiteId: "hard-de",
    providerId: "mock",
    model: "baseline",
    run: 1,
    suiteCategory: "technical-jargon",
    suiteLanguage: "de",
    testTags: ["fast-speech"],
    testSource: "custom",
    status: "ok",
    transcription: "ok",
    werRaw: 0,
    werNormalized: 0,
    cer: 0,
    durationMs: 1000,
    realtimeFactor: 0.5,
    audioDurationMs: 2000,
    timestamp: "2026-03-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("summary", () => {
  it("builds slice rankings without double-counting global rankings", () => {
    const suites: TestSuite[] = [
      {
        id: "hard-de",
        name: "Hard Cases (German)",
        description: "Legacy hard cases",
        language: "de",
        category: "technical-jargon",
        benchmarkTier: "diagnostic",
        tests: [
          {
            id: "de-fast-01",
            audioFile: "samples-hard-de/fast-01.wav",
            groundTruth: "fast",
            tags: ["fast-speech"],
            source: "custom",
          },
          {
            id: "de-tech-01",
            audioFile: "samples-hard-de/tech-01.wav",
            groundTruth: "tech",
            tags: ["technical-jargon"],
            source: "custom",
          },
        ],
      },
    ];

    const summary = buildBenchmarkSummary(
      [
        createResult({ testId: "de-fast-01", werNormalized: 0.2 }),
        createResult({
          testId: "de-tech-01",
          testTags: ["technical-jargon"],
          werNormalized: 0.4,
        }),
      ],
      suites,
      [provider],
      "2026-03-16"
    );

    expect(summary.rankings).toHaveLength(1);
    expect(summary.rankings[0].totalTests).toBe(2);
    expect(summary.rankingsBySlice["fast-speech"]).toHaveLength(1);
    expect(summary.rankingsBySlice["fast-speech"][0].totalTests).toBe(1);
    expect(summary.rankingsBySlice["technical-jargon"][0].totalTests).toBe(1);
    expect(summary.rankingsBySlice["fast-speech"][0].avgWerNormalized).toBe(0.2);
  });

  it("infers suite metadata for legacy code-switching auto results", () => {
    const merged = mergeBenchmarkSummaries({
      resultsBySuite: {
        "code-switching-auto": [
          createResult({
            suiteId: "code-switching-auto",
            suiteCategory: "code-switching",
            suiteLanguage: "auto",
            status: "skipped",
            skipReason: "unsupported",
            testId: "cs-tech-01",
            testTags: ["tech-talk"],
          }),
        ],
      },
      providerTypeMap: new Map([["mock", "cloud"]]),
      version: "2026-03-16",
    });

    expect(merged.suiteMetadata["code-switching-auto"].language).toBe("auto");
    expect(merged.suiteMetadata["code-switching-auto"].category).toBe(
      "code-switching"
    );
    expect(merged.suiteMetadata["code-switching-auto"].tier).toBe("diagnostic");
  });
});
