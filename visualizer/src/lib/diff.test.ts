import { describe, expect, it } from "vitest";
import { countErrors, wordDiff } from "./diff";

describe("wordDiff", () => {
  it("ignores case and punctuation", () => {
    const ops = wordDiff("The quick brown fox.", "the quick, brown fox");
    expect(ops.every((op) => op.type === "eq")).toBe(true);
  });

  it("marks substitutions, insertions and deletions", () => {
    const ops = wordDiff("Ich muss ein Treffen planen", "muss eintreffen planen heute");
    expect(ops).toEqual([
      { type: "del", ref: "Ich" },
      { type: "eq", hyp: "muss", ref: "muss" },
      { type: "sub", hyp: "eintreffen", ref: "ein" },
      { type: "del", ref: "Treffen" },
      { type: "eq", hyp: "planen", ref: "planen" },
      { type: "ins", hyp: "heute" },
    ]);
    expect(countErrors(ops)).toBe(4);
  });

  it("handles empty transcripts", () => {
    expect(wordDiff("two words", "")).toEqual([
      { type: "del", ref: "two" },
      { type: "del", ref: "words" },
    ]);
    expect(wordDiff("", "")).toEqual([]);
  });

  it("folds ё into е like the Russian normalizer", () => {
    expect(wordDiff("ещё", "еще")[0].type).toBe("eq");
  });
});
