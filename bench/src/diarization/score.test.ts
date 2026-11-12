import { describe, expect, it } from "vitest";
import type { LoadedReference } from "./score.js";
import { scoreHypothesis, summarize, validateHypothesis } from "./score.js";
import type { DiarizationHypothesisFile, DiarizationSet } from "./types.js";

const set: DiarizationSet = {
  schema: 1,
  id: "diarization-v1",
  description: "test",
  items: [
    {
      id: "ami/X/array",
      group: "ami-array",
      language: "en",
      audio: "ami/X.wav",
      url: "",
      sha256: "",
      bytes: 0,
      seconds: 20,
      references: { "only-words": "a.rttm", "forced-alignment": "b.rttm" },
      uem: "x.uem",
      speakers: 2,
    },
    {
      id: "synthetic/de-2sp",
      group: "synthetic",
      language: "de",
      audio: "synthetic/de.wav",
      url: "",
      sha256: "",
      bytes: 0,
      seconds: 10,
      references: { exact: "c.rttm" },
      uem: null,
      speakers: 2,
    },
  ],
};

const references = new Map<string, LoadedReference>([
  [
    "ami/X/array",
    {
      turns: [
        ["only-words", [{ start: 0, end: 10, speaker: "A" }, { start: 10, end: 20, speaker: "B" }]],
        ["forced-alignment", [{ start: 1, end: 9, speaker: "A" }, { start: 11, end: 19, speaker: "B" }]],
      ],
      uem: [{ start: 0, end: 20 }],
    },
  ],
  ["synthetic/de-2sp", { turns: [["exact", [{ start: 0, end: 5, speaker: "p" }, { start: 5, end: 10, speaker: "q" }]]], uem: null }],
]);

function file(items: DiarizationHypothesisFile["items"]): DiarizationHypothesisFile {
  return {
    schema: 1,
    setId: "diarization-v1",
    platform: "windows",
    engineId: "test-engine",
    engineName: "Test",
    runtime: "test 1.0",
    model: "m",
    shipped: false,
    settings: {},
    machine: { model: "PC", chip: "CPU", memoryGb: 32, os: "Windows 11" },
    measuredAt: "2026-11-10T00:00:00.000Z",
    prepareMs: 10,
    items,
  };
}

describe("scoreHypothesis", () => {
  it("scores every reference and pools groups", async () => {
    const report = await scoreHypothesis(
      file([
        { id: "ami/X/array", turns: [[0, 10, "s0"], [10, 20, "s1"]], processingMs: 1000 },
        { id: "synthetic/de-2sp", turns: [[0, 10, "s0"]], processingMs: 500 },
      ]),
      set,
      references
    );
    const ami = report.items[0];
    expect(ami.scores["only-words"]!.collar0.der).toBe(0);
    // The tighter reference turns the engine's edges into false alarms: 4 s over 16 s of speech.
    expect(ami.scores["forced-alignment"]!.collar0.der).toBeCloseTo(0.25);
    expect(ami.speakers).toEqual({ reference: 2, found: 2 });
    expect(report.items[1].scores.exact!.collar0.der).toBeCloseTo(0.5);
    expect(report.summary["ami-array"].speedFactor).toBe(20);
    expect(report.summary.synthetic.speakerCountAccuracy).toBe(0);
    expect(report.summary["ami-headset"].files).toBe(0);
    expect(report.scoring.references).toEqual(["only-words", "forced-alignment", "exact"]);
  });

  it("counts a missing or failed file as all speech missed", async () => {
    const report = await scoreHypothesis(
      file([{ id: "ami/X/array", turns: [], processingMs: 0, error: "crashed" }]),
      set,
      references
    );
    expect(report.items[0].error).toBe("crashed");
    expect(report.items[0].scores["only-words"]!.collar0.der).toBe(1);
    expect(report.items[1].error).toBe("not run");
    expect(summarize(report.items).failed).toBe(2);
  });

  it("rejects malformed files with a reason", () => {
    const bad = { ...file([{ id: "nope", turns: [[2, 1, "s"]], processingMs: 0 }]), engineId: "Bad Id", setId: "other" };
    const problems = validateHypothesis(bad, set);
    expect(problems.join("\n")).toMatch(/setId/);
    expect(problems.join("\n")).toMatch(/engineId/);
    expect(problems.join("\n")).toMatch(/unknown item nope/);
    expect(problems.join("\n")).toMatch(/end >= start/);
  });
});
