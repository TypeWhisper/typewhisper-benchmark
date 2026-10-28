/**
 * Word-level alignment of a transcript against its reference, for display. Words are compared
 * after lowercasing and stripping punctuation; the benchmark's WER uses a fuller normalizer
 * (number spelling, hesitations), so it can forgive words this marks.
 */

export type DiffOp =
  | { type: "eq"; hyp: string; ref: string }
  | { type: "sub"; hyp: string; ref: string }
  | { type: "ins"; hyp: string }
  | { type: "del"; ref: string };

interface Token {
  text: string;
  norm: string;
}

export function normalizeWord(word: string): string {
  return word
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\p{P}\p{S}]/gu, "");
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ text: word, norm: normalizeWord(word) }))
    .filter((token) => token.norm.length > 0);
}

/** Levenshtein alignment over words. */
export function wordDiff(reference: string, hypothesis: string): DiffOp[] {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const cost = new Uint32Array(rows * cols);
  for (let i = 0; i < rows; i += 1) cost[i * cols] = i;
  for (let j = 0; j < cols; j += 1) cost[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const same = ref[i - 1].norm === hyp[j - 1].norm;
      cost[i * cols + j] = Math.min(
        cost[(i - 1) * cols + (j - 1)] + (same ? 0 : 1),
        cost[(i - 1) * cols + j] + 1,
        cost[i * cols + (j - 1)] + 1
      );
    }
  }

  // Walk back preferring matches, then insertions/deletions, then substitutions, so equal-cost
  // paths keep words that match ("planen" = "planen") aligned.
  const ops: DiffOp[] = [];
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const here = cost[i * cols + j];
    if (i > 0 && j > 0 && ref[i - 1].norm === hyp[j - 1].norm && here === cost[(i - 1) * cols + (j - 1)]) {
      ops.push({ type: "eq", hyp: hyp[j - 1].text, ref: ref[i - 1].text });
      i -= 1;
      j -= 1;
    } else if (j > 0 && here === cost[i * cols + (j - 1)] + 1) {
      ops.push({ type: "ins", hyp: hyp[j - 1].text });
      j -= 1;
    } else if (i > 0 && here === cost[(i - 1) * cols + j] + 1) {
      ops.push({ type: "del", ref: ref[i - 1].text });
      i -= 1;
    } else {
      ops.push({ type: "sub", hyp: hyp[j - 1].text, ref: ref[i - 1].text });
      i -= 1;
      j -= 1;
    }
  }
  return ops.reverse();
}

export function countErrors(ops: DiffOp[]): number {
  return ops.filter((op) => op.type !== "eq").length;
}
