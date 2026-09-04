import type {
  BenchmarkProfile,
  CorpusItem,
  ResultEvent,
} from "./schema.js";

export interface MetricOutcome {
  metricId: BenchmarkProfile["metrics"][number]["id"];
  value: number;
  errors?: number;
  units?: number;
}

function collapseWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeVerbatim(value: string): string {
  return collapseWhitespace(value)
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function wordTokens(value: string, language: string): string[] {
  const normalized = normalizeVerbatim(value);
  if (!normalized) return [];

  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(language, { granularity: "word" });
    const words = [...segmenter.segment(normalized)]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
    if (words.length > 0) return words;
  }

  return normalized.split(" ").filter(Boolean);
}

function characterTokens(value: string): string[] {
  return [...normalizeVerbatim(value).replace(/\s+/gu, "")];
}

export function editDistance<T>(reference: readonly T[], hypothesis: readonly T[]): number {
  let previous = Array.from(
    { length: hypothesis.length + 1 },
    (_, index) => index
  );

  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex++) {
    const current = [referenceIndex];
    for (
      let hypothesisIndex = 1;
      hypothesisIndex <= hypothesis.length;
      hypothesisIndex++
    ) {
      const substitutionCost =
        reference[referenceIndex - 1] === hypothesis[hypothesisIndex - 1] ? 0 : 1;
      current[hypothesisIndex] = Math.min(
        previous[hypothesisIndex]! + 1,
        current[hypothesisIndex - 1]! + 1,
        previous[hypothesisIndex - 1]! + substitutionCost
      );
    }
    previous = current;
  }

  return previous[hypothesis.length]!;
}

function bestErrorRate(
  references: string[],
  hypothesis: string,
  tokenize: (value: string) => string[]
): { errors: number; units: number; value: number } {
  const candidates = references.map((reference) => {
    const referenceTokens = tokenize(reference);
    const errors = editDistance(referenceTokens, tokenize(hypothesis));
    const units = Math.max(1, referenceTokens.length);
    return { errors, units, value: errors / units };
  });
  return candidates.reduce((best, candidate) =>
    candidate.value < best.value ? candidate : best
  );
}

function similarity(reference: string, hypothesis: string): number {
  const expected = [...collapseWhitespace(reference)];
  const actual = [...collapseWhitespace(hypothesis)];
  const denominator = Math.max(1, expected.length, actual.length);
  return Math.max(0, 1 - editDistance(expected, actual) / denominator);
}

function includesValue(
  transcript: string,
  candidates: string[],
  caseSensitive: boolean
): boolean {
  const normalizedTranscript = collapseWhitespace(transcript);
  const haystack = caseSensitive
    ? normalizedTranscript
    : normalizedTranscript.toLocaleLowerCase("und");
  return candidates.some((candidate) => {
    const normalizedCandidate = collapseWhitespace(candidate);
    const needle = caseSensitive
      ? normalizedCandidate
      : normalizedCandidate.toLocaleLowerCase("und");
    return haystack.includes(needle);
  });
}

function expectationRecall(
  transcript: string,
  expectations: Array<{ expected: string; alternatives: string[] }>,
  caseSensitive: boolean
): number | undefined {
  if (expectations.length === 0) return undefined;
  const matches = expectations.filter((expectation) =>
    includesValue(
      transcript,
      [expectation.expected, ...expectation.alternatives],
      caseSensitive
    )
  ).length;
  return matches / expectations.length;
}

export function scoreResult(
  item: CorpusItem,
  result: ResultEvent,
  metricIds: BenchmarkProfile["metrics"][number]["id"][]
): MetricOutcome[] {
  if (result.status !== "ok" || result.transcript === undefined) return [];

  const transcript = result.transcript;
  const references = [
    item.references.verbatim,
    ...item.references.alternatives,
    ...(item.references.formatted ? [item.references.formatted] : []),
  ];
  const outcomes: MetricOutcome[] = [];

  for (const metricId of metricIds) {
    if (metricId === "wer") {
      const score = bestErrorRate(references, transcript, (value) =>
        wordTokens(value, item.language)
      );
      outcomes.push({ metricId, ...score });
      continue;
    }

    if (metricId === "cer") {
      const score = bestErrorRate(references, transcript, characterTokens);
      outcomes.push({ metricId, ...score });
      continue;
    }

    if (metricId === "formatting") {
      if (item.references.formatted !== undefined) {
        outcomes.push({
          metricId,
          value: similarity(item.references.formatted, transcript),
        });
      }
      continue;
    }

    if (metricId === "numbers") {
      const value = expectationRecall(
        transcript,
        item.expectations.numbers,
        false
      );
      if (value !== undefined) outcomes.push({ metricId, value });
      continue;
    }

    if (metricId === "proper-nouns") {
      const value = expectationRecall(
        transcript,
        item.expectations.properNouns,
        true
      );
      if (value !== undefined) outcomes.push({ metricId, value });
      continue;
    }

    const code = item.expectations.code;
    if (code) {
      const tokenRecall = expectationRecall(transcript, code.tokens, true);
      const codeSimilarity = similarity(code.reference, transcript);
      outcomes.push({
        metricId,
        value:
          tokenRecall === undefined
            ? codeSimilarity
            : (codeSimilarity + tokenRecall) / 2,
      });
    }
  }

  return outcomes;
}
