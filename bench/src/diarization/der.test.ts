import { describe, expect, it } from "vitest";
import { computeDer, maxWeightAssignment, parseRttm, parseUem, poolDer, scoredRegions, type Turn } from "./der.js";

const t = (start: number, end: number, speaker: string): Turn => ({ start, end, speaker });

describe("computeDer", () => {
  it("is zero for a perfect hypothesis with other labels", () => {
    const ref = [t(0, 5, "A"), t(5, 10, "B")];
    const hyp = [t(0, 5, "x"), t(5, 10, "y")];
    const r = computeDer(ref, hyp);
    expect(r.der).toBe(0);
    expect(r.mapping).toEqual({ A: "x", B: "y" });
  });

  it("counts missed speech, false alarms and confusion", () => {
    const ref = [t(0, 10, "A"), t(10, 20, "B")];
    // x maps to A and y to B: 0-2 missed, 10-15 confused, 20-23 false alarm.
    const hyp = [t(2, 15, "x"), t(15, 20, "y"), t(20, 23, "y")];
    const r = computeDer(ref, hyp);
    expect(r.total).toBeCloseTo(20);
    expect(r.missed).toBeCloseTo(2);
    expect(r.confusion).toBeCloseTo(5);
    expect(r.falseAlarm).toBeCloseTo(3);
    expect(r.der).toBeCloseTo(10 / 20);
  });

  it("counts overlapping reference speech once per speaker", () => {
    const ref = [t(0, 10, "A"), t(5, 10, "B")];
    const hyp = [t(0, 10, "x")];
    const r = computeDer(ref, hyp);
    expect(r.total).toBeCloseTo(15);
    expect(r.missed).toBeCloseTo(5);
    expect(r.der).toBeCloseTo(5 / 15);
  });

  it("maps speakers to maximize shared time, not by first appearance", () => {
    const ref = [t(0, 1, "A"), t(1, 10, "B"), t(10, 12, "A")];
    const hyp = [t(0, 1, "x"), t(1, 10, "x"), t(10, 12, "y")];
    const r = computeDer(ref, hyp);
    expect(r.mapping).toEqual({ B: "x", A: "y" });
    expect(r.confusion).toBeCloseTo(1);
  });

  it("scores only the UEM region", () => {
    const ref = [t(0, 10, "A")];
    const hyp = [t(0, 20, "x")];
    expect(computeDer(ref, hyp, { uem: [{ start: 0, end: 10 }] }).der).toBe(0);
    expect(computeDer(ref, hyp).falseAlarm).toBeCloseTo(10);
  });

  it("removes a collar around reference boundaries", () => {
    const ref = [t(0, 10, "A"), t(10, 20, "B")];
    const hyp = [t(0, 10.2, "x"), t(10.2, 20, "y")];
    expect(computeDer(ref, hyp).confusion).toBeCloseTo(0.2);
    expect(computeDer(ref, hyp, { collar: 0.25 }).der).toBe(0);
    // The collar also removes 0.25 s at the start and end of the file.
    expect(scoredRegions(ref, hyp, [{ start: 0, end: 20 }], 0.25)).toEqual([
      { start: 0.25, end: 9.75 },
      { start: 10.25, end: 19.75 },
    ]);
  });

  it("scores an empty hypothesis as all missed", () => {
    const r = computeDer([t(0, 4, "A")], []);
    expect(r.der).toBe(1);
    expect(r.missed).toBeCloseTo(4);
  });

  it("pools by summed time, not by averaging files", () => {
    const a = computeDer([t(0, 10, "A")], []);
    const b = computeDer([t(0, 90, "A")], [t(0, 90, "x")]);
    expect(poolDer([a, b]).der).toBeCloseTo(0.1);
  });
});

describe("maxWeightAssignment", () => {
  it("finds the best assignment of a rectangular matrix", () => {
    expect(maxWeightAssignment([[1, 9, 1], [9, 1, 1]])).toEqual([1, 0]);
    expect(maxWeightAssignment([[5], [7], [1]])).toEqual([-1, 0, -1]);
    expect(maxWeightAssignment([[3, 2], [3, 0]])).toEqual([1, 0]);
  });
});

describe("parsers", () => {
  it("reads RTTM and UEM", () => {
    expect(parseRttm("SPEAKER f 1 1.5 2.0 <NA> <NA> spk1 <NA> <NA>\n\n")).toEqual([t(1.5, 3.5, "spk1")]);
    expect(parseUem("ES2004a 1 0.000 1049.35\n")).toEqual([{ start: 0, end: 1049.35 }]);
  });
});
