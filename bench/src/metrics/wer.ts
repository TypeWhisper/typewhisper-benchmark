// Word Error Rate and Character Error Rate using Levenshtein distance.

/**
 * Compute Levenshtein distance between two arrays (words or characters).
 * Uses a two-row approach for memory efficiency: O(min(m, n)) space.
 */
function levenshteinDistance<T>(a: T[], b: T[]): number {
  // Ensure `a` is the shorter array so we allocate fewer columns.
  if (a.length > b.length) return levenshteinDistance(b, a);

  const m = a.length;
  const n = b.length;

  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  // Base case: distance from empty prefix of b to a[0..j]
  for (let j = 0; j <= m; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    // Swap rows
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}

/**
 * Word Error Rate: edit distance on word arrays divided by the number
 * of reference words.
 *
 * - Both empty -> 0
 * - One empty -> 1
 * - Result is clamped to a maximum of 1
 */
export function calculateWER(reference: string, hypothesis: string): number {
  const refWords = reference.split(/\s+/).filter((w) => w.length > 0);
  const hypWords = hypothesis.split(/\s+/).filter((w) => w.length > 0);

  if (refWords.length === 0 && hypWords.length === 0) return 0;
  if (refWords.length === 0 || hypWords.length === 0) return 1;

  const distance = levenshteinDistance(refWords, hypWords);
  return Math.min(distance / refWords.length, 1);
}

/**
 * Character Error Rate: edit distance on character arrays divided by the
 * number of reference characters.
 *
 * - Both empty -> 0
 * - One empty -> 1
 * - Result is clamped to a maximum of 1
 */
export function calculateCER(reference: string, hypothesis: string): number {
  const refChars = [...reference];
  const hypChars = [...hypothesis];

  if (refChars.length === 0 && hypChars.length === 0) return 0;
  if (refChars.length === 0 || hypChars.length === 0) return 1;

  const distance = levenshteinDistance(refChars, hypChars);
  return Math.min(distance / refChars.length, 1);
}
