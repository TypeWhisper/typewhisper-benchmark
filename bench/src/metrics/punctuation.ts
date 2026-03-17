// Punctuation and formatting accuracy metrics.
// Compares punctuation marks and capitalization between reference and hypothesis.

/**
 * Extract (word, trailingPunctuation) pairs from text.
 * Words are lowercased for matching, punctuation is preserved.
 */
function extractWordPunctPairs(text: string): Array<{ word: string; punct: string; original: string }> {
  // Match a word optionally followed by punctuation
  const regex = /(\p{L}[\p{L}\p{N}]*)([\p{P}]*)/gu;
  const pairs: Array<{ word: string; punct: string; original: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    pairs.push({
      word: match[1].toLowerCase(),
      punct: match[2],
      original: match[1],
    });
  }

  return pairs;
}

/**
 * Align two word sequences using Levenshtein-style DP.
 * Returns pairs of (refIndex, hypIndex) for matched words.
 */
function alignWords(
  ref: string[],
  hyp: string[]
): Array<[number, number]> {
  const m = ref.length;
  const n = hyp.length;

  // DP table: cost[i][j] = min edit distance for ref[0..i-1] vs hyp[0..j-1]
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const op: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  // 0=match/sub, 1=delete(skip ref), 2=insert(skip hyp)
  for (let i = 0; i <= m; i++) cost[i][0] = i;
  for (let j = 0; j <= n; j++) cost[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const subCost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      const sub = cost[i - 1][j - 1] + subCost;
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;

      if (sub <= del && sub <= ins) {
        cost[i][j] = sub;
        op[i][j] = 0;
      } else if (del <= ins) {
        cost[i][j] = del;
        op[i][j] = 1;
      } else {
        cost[i][j] = ins;
        op[i][j] = 2;
      }
    }
  }

  // Backtrace to find aligned pairs
  const aligned: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && op[i][j] === 0) {
      if (ref[i - 1] === hyp[j - 1]) {
        aligned.push([i - 1, j - 1]);
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || op[i][j] === 1)) {
      i--;
    } else {
      j--;
    }
  }

  return aligned.reverse();
}

/**
 * Calculate punctuation accuracy score.
 * Compares trailing punctuation of aligned word pairs.
 *
 * @returns 0-1 score (1 = all punctuation correct)
 */
export function calculatePunctuationScore(reference: string, hypothesis: string): number {
  const refPairs = extractWordPunctPairs(reference);
  const hypPairs = extractWordPunctPairs(hypothesis);

  if (refPairs.length === 0) return 1;

  // Count how many reference words have punctuation
  const refWithPunct = refPairs.filter(p => p.punct.length > 0);
  if (refWithPunct.length === 0) return 1;

  const refWords = refPairs.map(p => p.word);
  const hypWords = hypPairs.map(p => p.word);

  const aligned = alignWords(refWords, hypWords);

  let correct = 0;
  let expected = 0;

  for (const [ri, hi] of aligned) {
    const refPunct = refPairs[ri].punct;
    if (refPunct.length > 0) {
      expected++;
      if (hypPairs[hi].punct === refPunct) {
        correct++;
      }
    }
  }

  // Also count unmatched ref words with punctuation as misses
  const matchedRefIndices = new Set(aligned.map(([ri]) => ri));
  for (let i = 0; i < refPairs.length; i++) {
    if (!matchedRefIndices.has(i) && refPairs[i].punct.length > 0) {
      expected++;
    }
  }

  return expected > 0 ? correct / expected : 1;
}

/**
 * Calculate capitalization accuracy score.
 * Compares first character case of aligned word pairs.
 *
 * @returns 0-1 score (1 = all capitalization correct)
 */
export function calculateCapitalizationScore(reference: string, hypothesis: string): number {
  const refPairs = extractWordPunctPairs(reference);
  const hypPairs = extractWordPunctPairs(hypothesis);

  if (refPairs.length === 0) return 1;

  const refWords = refPairs.map(p => p.word);
  const hypWords = hypPairs.map(p => p.word);

  const aligned = alignWords(refWords, hypWords);

  if (aligned.length === 0) return 0;

  let correct = 0;

  for (const [ri, hi] of aligned) {
    const refFirst = refPairs[ri].original[0];
    const hypFirst = hypPairs[hi].original[0];
    if (refFirst === hypFirst) {
      correct++;
    }
  }

  return correct / aligned.length;
}

/**
 * Calculate composite formatting score.
 * 50% punctuation accuracy + 50% capitalization accuracy.
 */
export function calculateFormattingScore(reference: string, hypothesis: string): number {
  const punctScore = calculatePunctuationScore(reference, hypothesis);
  const capScore = calculateCapitalizationScore(reference, hypothesis);
  return punctScore * 0.5 + capScore * 0.5;
}
