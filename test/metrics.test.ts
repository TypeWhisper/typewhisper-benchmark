import { describe, expect, it } from "vitest";
import { editDistance, normalizeVerbatim, scoreResult } from "../src/metrics.js";
import { fixtureCorpus } from "./fixtures.js";

describe("metric scoring", () => {
  it("normalizes case, punctuation, and compatibility characters for WER", () => {
    expect(normalizeVerbatim("  TYPEWHISPER, kostet １２ Euro! ")).toBe(
      "typewhisper kostet 12 euro"
    );
  });

  it("calculates a conventional Levenshtein distance", () => {
    expect(editDistance([..."kitten"], [..."sitting"])).toBe(3);
  });

  it("keeps verbatim accuracy separate from formatted output", () => {
    const item = fixtureCorpus().items[0]!;
    const scores = scoreResult(
      item,
      {
        schemaVersion: 1,
        runId: "run-1",
        planId: "a".repeat(64),
        targetId: "fixture-target",
        caseId: item.id,
        trial: 1,
        status: "ok",
        transcript: "TypeWhisper kostet im Beispiel 12 Euro.",
      },
      ["wer", "cer", "formatting", "numbers", "proper-nouns"]
    );

    expect(scores.find((score) => score.metricId === "wer")?.value).toBe(0);
    expect(scores.find((score) => score.metricId === "formatting")?.value).toBe(1);
    expect(scores.find((score) => score.metricId === "numbers")?.value).toBe(1);
    expect(scores.find((score) => score.metricId === "proper-nouns")?.value).toBe(1);
  });

  it("does not emit an ineligible code score", () => {
    const item = fixtureCorpus().items[0]!;
    const scores = scoreResult(
      item,
      {
        schemaVersion: 1,
        runId: "run-1",
        planId: "a".repeat(64),
        targetId: "fixture-target",
        caseId: item.id,
        trial: 1,
        status: "ok",
        transcript: "TypeWhisper kostet im Beispiel zwölf Euro.",
      },
      ["code"]
    );
    expect(scores).toEqual([]);
  });
});
