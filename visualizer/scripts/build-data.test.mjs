import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEED_REFERENCE, buildData, digitsHit, finalizeCell, numberTokens, rowStatus } from "./build-data.mjs";

describe("Digits metric", () => {
  it("takes whitespace tokens with a digit, without trailing punctuation", () => {
    expect(numberTokens("revenue reached $578,000")).toEqual(["$578,000"]);
    expect(numberTokens("der 15. Maerz 2026")).toEqual(["15", "2026"]);
    expect(numberTokens("on March 15 at 2:30, 300 guests will arrive")).toEqual(["15", "2:30", "300"]);
    expect(numberTokens("the 21st century")).toEqual(["21st"]);
    expect(numberTokens("no numbers here")).toEqual([]);
  });

  it("needs every number verbatim in the transcript", () => {
    expect(digitsHit("the company has 2,400 employees", "The company has 2,400 employees.")).toBe(true);
    expect(digitsHit("the company has 2,400 employees", "The company has 2400 employees.")).toBe(false);
    expect(digitsHit("at 2:30 PM", "At 2.30 p.m.")).toBe(false);
    expect(digitsHit("no numbers", "anything")).toBeNull();
    // A number must match whole: a wrong, longer number does not count.
    expect(digitsHit("4322 Besucher und 999 Euro", "43220 Besucher und 9990 Euro")).toBe(false);
    expect(digitsHit("15 guests", "115 guests")).toBe(false);
    expect(digitsHit("15 guests", "15,000 guests")).toBe(false);
    expect(digitsHit("revenue reached $578,000", "Revenue reached $578,000.")).toBe(true);
    expect(digitsHit("am 15. Maerz", "Am 15. März")).toBe(true);
    // Phone numbers may be written without the reference's grouping, but not with other digits.
    expect(digitsHit("0171 345 6789", "01713456789")).toBe(true);
    expect(digitsHit("meine Nummer ist +49 171 234 56", "Meine Nummer ist +49 17123456")).toBe(true);
    expect(digitsHit("0171 345 6789", "01713456780")).toBe(false);
    expect(digitsHit("on March 15 at 2:30, 300 guests", "On March 15 at 2:30, 300 guests.")).toBe(true);
  });
});

describe("rowStatus", () => {
  it("treats legacy rows without a status as ok unless they carry an error", () => {
    expect(rowStatus({})).toBe("ok");
    expect(rowStatus({ error: "Connection error." })).toBe("err");
    expect(rowStatus({ status: "error" })).toBe("err");
    expect(rowStatus({ status: "skipped" })).toBe("skip");
  });
});

describe("finalizeCell", () => {
  it("omits empty counters and keeps the counts behind each mean", () => {
    const cell = finalizeCell({
      n: 4, ok: 2, err: 1, skip: 1,
      wer: 0.3, cer: 0.1, ms: 100, rtf: 0.02, audioMs: 6000, cost: 0,
      p: 0, pn: 0, f: 1.5, fn: 2, dg: 1, dn: 2,
    });
    expect(cell).toEqual({
      n: 4, ok: 2, err: 1, skip: 1,
      wer: 0.15, cer: 0.05, ms: 50, rtf: 0.01, sec: 3,
      f: 0.75, fn: 2, dg: 0.5, dn: 2,
    });
  });
});

describe("buildData", () => {
  const row = (testId, patch) => ({
    testId, suiteId: "number-formatting-en", providerId: "acme", model: "fast", run: 1,
    status: "ok", transcription: "", werNormalized: 0, cer: 0, durationMs: 10,
    realtimeFactor: 0.01, audioDurationMs: 1000, timestamp: "2026-10-01T00:00:00.000Z", ...patch,
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "tw-build-data-"));
    const resultsDir = join(root, "results");
    const testsDir = join(root, "tests");
    mkdirSync(resultsDir);
    mkdirSync(testsDir);
    writeFileSync(
      join(testsDir, "number-formatting-en.json"),
      JSON.stringify({
        id: "number-formatting-en", name: "Number Formatting (English)", language: "en",
        category: "number-formatting", benchmarkTier: "core",
        tests: [
          { id: "n1", groundTruth: "352 participants registered", tags: ["cardinal"] },
          { id: "n2", groundTruth: "at 2:30 PM" },
        ],
      })
    );
    writeFileSync(
      join(resultsDir, "acme_fast.json"),
      JSON.stringify({
        ranking: { providerId: "acme", model: "fast", providerType: "local" },
        suiteMetadata: {},
        resultsBySuite: {
          "number-formatting-en": [
            row("n1", { transcription: "352 participants registered.", werNormalized: 0 }),
            row("n2", { transcription: "at two thirty", werNormalized: 0.5, durationMs: 30 }),
            row("n2", { run: 2, status: "error", error: "timeout" }),
          ],
        },
      })
    );
    writeFileSync(join(resultsDir, "broken.json"), "{ not json");
    return { resultsDir, testsDir };
  }

  it("aggregates per model and suite and skips malformed files", () => {
    const { summary, clipFiles, fileCount } = buildData(fixture());
    expect(fileCount).toBe(2);
    expect(Object.keys(summary.models)).toEqual(["acme:fast"]);
    expect(summary.suites["number-formatting-en"]).toMatchObject({
      name: "Number Formatting (English)", language: "en", tier: "core", clips: 2, scores: ["dg"], references: true,
    });
    expect(summary.cells["acme:fast"]["number-formatting-en"]).toMatchObject({
      n: 3, ok: 2, err: 1, wer: 0.25, ms: 20, dg: 0.5, dn: 2,
    });
    expect(summary.version).toMatch(/^[0-9a-f]{10}$/);

    const clips = clipFiles["number-formatting-en"];
    expect(clips.clips.map((clip) => clip.id)).toEqual(["n1", "n2"]);
    expect(clips.clips[0]).toMatchObject({ ref: "352 participants registered", tags: ["cardinal"] });
    // n2 keeps the ok first run, not the failed second one.
    expect(clips.results["acme:fast"][1]).toEqual(["at two thirty", 0.5, 0, 30, 0]);
  });

  it("takes speed runs from the reference machine for models with results", () => {
    const dirs = fixture();
    const speedDir = join(dirs.resultsDir, "..", "speed");
    mkdirSync(speedDir);
    const report = (providerId, model, machine) => ({
      providerId, model, language: "en", measuredAt: "2026-10-29T21:00:00.000Z",
      speedSet: { id: "speed-en-v1", clips: 30 }, settings: { passes: 3 }, machine,
      summary: {
        speedFactor: 173.6, passSpread: 0.02,
        buckets: { short: { medianMs: 38.8 }, medium: { medianMs: 55 }, long: { medianMs: 79.7 } },
      },
    });
    writeFileSync(join(speedDir, "acme_fast.json"), JSON.stringify(report("acme", "fast", SPEED_REFERENCE)));
    writeFileSync(join(speedDir, "acme_other.json"), JSON.stringify(report("acme", "other", SPEED_REFERENCE)));
    writeFileSync(
      join(speedDir, "acme_laptop.json"),
      JSON.stringify(report("acme", "fast", { ...SPEED_REFERENCE, model: "Mac16,1" }))
    );
    writeFileSync(join(speedDir, "null.json"), "null");
    writeFileSync(join(speedDir, "broken.json"), "{");
    const { summary } = buildData({ ...dirs, speedDir });
    // No accuracy results for acme:other, the laptop run does not count, and malformed files are skipped.
    expect(summary.speed).toEqual({
      "acme:fast": { x: 173.6, short: 38.8, medium: 55, long: 79.7, clips: 30, passes: 3, spread: 0.02, at: "2026-10-29" },
    });
  });
});
