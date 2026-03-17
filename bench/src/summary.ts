import type {
  BenchmarkOrigin,
  BenchmarkSummary,
  BenchmarkTier,
  ModelRanking,
  ProviderType,
  STTProvider,
  SuiteMetadata,
  TestCategory,
  TestCase,
  TestResult,
  TestSuite,
} from "./types.js";

const PUBLIC_SOURCES = new Set<TestCase["source"]>([
  "librispeech",
  "common-voice",
  "fleurs",
  "voxpopuli",
]);

const SLICE_DEFINITIONS = [
  {
    id: "fast-speech",
    matches: (result: TestResult) => /(^|-)fast-/.test(result.testId),
  },
  {
    id: "numbers-dates",
    matches: (result: TestResult) => /(^|-)numbers-/.test(result.testId),
  },
  {
    id: "technical-jargon",
    matches: (result: TestResult) => /(^|-)tech-/.test(result.testId),
  },
  {
    id: "proper-nouns",
    matches: (result: TestResult) => /(^|-)names-/.test(result.testId),
  },
] as const;

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function averageOptional(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value != null);
  return defined.length > 0 ? average(defined) : undefined;
}

export function inferSuiteTier(
  suite: Pick<TestSuite, "id" | "category" | "benchmarkTier">
): BenchmarkTier {
  if (suite.benchmarkTier) return suite.benchmarkTier;
  if (
    suite.id.startsWith("hard-") ||
    suite.category === "code-dictation" ||
    suite.category === "code-switching"
  ) {
    return "diagnostic";
  }
  return "core";
}

export function inferSuiteOrigin(
  tests: Array<Pick<TestCase, "source">>
): BenchmarkOrigin {
  return tests.length > 0 && tests.every((test) => PUBLIC_SOURCES.has(test.source))
    ? "public"
    : "synthetic";
}

export function buildSuiteMetadata(
  suites: TestSuite[]
): Record<string, SuiteMetadata> {
  return Object.fromEntries(
    suites.map((suite) => [
      suite.id,
      {
        name: suite.name,
        description: suite.description,
        language: suite.language,
        category: suite.category,
        tier: inferSuiteTier(suite),
        origin: inferSuiteOrigin(suite.tests),
        testCount: suite.tests.length,
      },
    ])
  );
}

export function inferLegacyCategory(suiteId: string): TestCategory {
  if (suiteId.startsWith("clean-speech-")) return "clean-speech";
  if (suiteId.startsWith("noisy-environment-")) return "noisy-environment";
  if (suiteId.startsWith("accented-speech-")) return "accented-speech";
  if (suiteId.startsWith("code-dictation-")) return "code-dictation";
  if (suiteId.startsWith("whispered-lowquality-")) return "low-quality-audio";
  if (suiteId.startsWith("code-switching-")) return "code-switching";
  if (suiteId.startsWith("punctuation-formatting-")) return "punctuation-formatting";
  if (suiteId.startsWith("number-formatting-")) return "number-formatting";
  if (suiteId.startsWith("long-form-speech-")) return "long-form-speech";
  if (suiteId.startsWith("hard-")) return "technical-jargon";
  return "clean-speech";
}

function inferLegacyLanguage(suiteId: string): string {
  const match = suiteId.match(/-(de|en|auto)$/);
  return match?.[1] ?? "de";
}

function inferLegacyOrigin(
  suiteId: string,
  category: TestCategory,
  results: TestResult[]
): BenchmarkOrigin {
  const sources = new Set(
    results
      .map((result) => result.testSource)
      .filter((source): source is TestCase["source"] => source != null)
  );

  if (sources.size > 0) {
    return [...sources].every((source) => PUBLIC_SOURCES.has(source))
      ? "public"
      : "synthetic";
  }

  if (
    suiteId.startsWith("clean-speech-") ||
    suiteId.startsWith("accented-speech-") ||
    category === "long-form-speech"
  ) {
    return "public";
  }

  return "synthetic";
}

function inferLegacyName(suiteId: string, language: string, category: TestCategory): string {
  const langLabel =
    language === "de" ? "German" : language === "en" ? "English" : "Auto";

  switch (category) {
    case "clean-speech":
      return `Clean Speech (${langLabel})`;
    case "noisy-environment":
      return `Noisy Environment (${langLabel})`;
    case "accented-speech":
      return `Accented Speech (${langLabel})`;
    case "code-dictation":
      return `Code Dictation (${langLabel})`;
    case "code-switching":
      return language === "auto"
        ? "Code-Switching (auto-detect)"
        : "Code-Switching (DE hint)";
    case "punctuation-formatting":
      return `Punctuation & Formatting (${langLabel})`;
    case "number-formatting":
      return `Number Formatting (${langLabel})`;
    case "low-quality-audio":
      return `Low Quality Audio (${langLabel})`;
    case "long-form-speech":
      return `Long-form Speech (${langLabel})`;
    default:
      return suiteId.startsWith("hard-")
        ? `Hard Cases (${langLabel})`
        : suiteId;
  }
}

export function inferLegacySuiteMetadata(
  suiteId: string,
  results: TestResult[] = []
): SuiteMetadata {
  const category = results[0]?.suiteCategory ?? inferLegacyCategory(suiteId);
  const language = results[0]?.suiteLanguage ?? inferLegacyLanguage(suiteId);
  return {
    name: inferLegacyName(suiteId, language, category),
    description: `Legacy suite metadata inferred for ${suiteId}`,
    language,
    category,
    tier: inferSuiteTier({
      id: suiteId,
      category,
      benchmarkTier: undefined,
    }),
    origin: inferLegacyOrigin(suiteId, category, results),
    testCount:
      results.length > 0 ? new Set(results.map((result) => result.testId)).size : 0,
  };
}

export function normalizeSuiteMetadata(
  suiteMetadata: Partial<Record<string, SuiteMetadata>> | undefined,
  resultsBySuite: Record<string, TestResult[]>
): Record<string, SuiteMetadata> {
  const normalized: Record<string, SuiteMetadata> = {};

  for (const [suiteId, results] of Object.entries(resultsBySuite)) {
    const inferred = inferLegacySuiteMetadata(suiteId, results);
    const existing = suiteMetadata?.[suiteId];
    normalized[suiteId] = {
      ...inferred,
      ...existing,
      testCount:
        existing?.testCount ??
        inferred.testCount ??
        new Set(results.map((result) => result.testId)).size,
    };
  }

  return normalized;
}

function isSkipped(result: TestResult): boolean {
  return result.status === "skipped";
}

function isError(result: TestResult): boolean {
  return result.status === "error" || !!result.error;
}

function computeRankings(
  results: TestResult[],
  providerTypeMap: Map<string, ProviderType>
): ModelRanking[] {
  const grouped = new Map<string, TestResult[]>();

  for (const result of results) {
    const key = `${result.providerId}/${result.model}`;
    const group = grouped.get(key) ?? [];
    group.push(result);
    grouped.set(key, group);
  }

  const rankings: ModelRanking[] = [];

  for (const [key, group] of grouped) {
    const [providerId, model] = key.split("/");
    const valid = group.filter(
      (result) => !isSkipped(result) && !isError(result)
    );
    const errors = group.filter((result) => isError(result));
    const skips = group.filter((result) => isSkipped(result));
    const attempted = group.length - skips.length;

    if (valid.length === 0) {
      rankings.push({
        providerId,
        model,
        providerType: providerTypeMap.get(providerId) ?? "cloud",
        avgWerNormalized: 1,
        avgCer: 1,
        avgRealtimeFactor: 0,
        avgDurationMs: 0,
        totalTests: group.length,
        errorCount: errors.length,
        errorRate: attempted > 0 ? errors.length / attempted : 0,
        skipCount: skips.length,
      });
      continue;
    }

    const totalAudioMs = valid.reduce(
      (sum, result) => sum + result.audioDurationMs,
      0
    );
    const totalCost = valid.reduce(
      (sum, result) => sum + (result.costUsd ?? 0),
      0
    );

    rankings.push({
      providerId,
      model,
      providerType: providerTypeMap.get(providerId) ?? "cloud",
      avgWerNormalized: average(valid.map((result) => result.werNormalized)),
      avgCer: average(valid.map((result) => result.cer)),
      avgPunctuationScore: averageOptional(
        valid.map((result) => result.punctuationScore)
      ),
      avgFormattingScore: averageOptional(
        valid.map((result) => result.formattingScore)
      ),
      avgRealtimeFactor: average(
        valid.map((result) => result.realtimeFactor)
      ),
      avgDurationMs: average(valid.map((result) => result.durationMs)),
      costPerHourAudio:
        totalAudioMs > 0 ? (totalCost / totalAudioMs) * 3600000 : undefined,
      totalTests: group.length,
      errorCount: errors.length,
      errorRate: attempted > 0 ? errors.length / attempted : 0,
      skipCount: skips.length,
    });
  }

  rankings.sort((left, right) => left.avgWerNormalized - right.avgWerNormalized);
  return rankings;
}

function groupResultsBy<T extends string>(
  results: TestResult[],
  getKey: (result: TestResult) => T | null
): Record<T, TestResult[]> {
  const grouped = {} as Record<T, TestResult[]>;

  for (const result of results) {
    const key = getKey(result);
    if (!key) continue;
    (grouped[key] ||= []).push(result);
  }

  return grouped;
}

function groupRankings(
  groups: Record<string, TestResult[]>,
  providerTypeMap: Map<string, ProviderType>
): Record<string, ModelRanking[]> {
  return Object.fromEntries(
    Object.entries(groups).map(([key, group]) => [
      key,
      computeRankings(group, providerTypeMap),
    ])
  );
}

export function buildSummaryFromResults(options: {
  results: TestResult[];
  suiteMetadata: Record<string, SuiteMetadata>;
  providerTypeMap: Map<string, ProviderType>;
  version: string;
}): BenchmarkSummary {
  const { results, suiteMetadata, providerTypeMap, version } = options;

  const resultsBySuite = groupResultsBy(results, (result) => result.suiteId);
  const normalizedSuiteMetadata = normalizeSuiteMetadata(
    suiteMetadata,
    resultsBySuite
  );

  const rankings = computeRankings(results, providerTypeMap);
  const rankingsBySuite = groupRankings(resultsBySuite, providerTypeMap);
  const rankingsByCategory = groupRankings(
    groupResultsBy(
      results,
      (result) => normalizedSuiteMetadata[result.suiteId]?.category ?? null
    ),
    providerTypeMap
  );
  const rankingsBySlice = groupRankings(
    Object.fromEntries(
      SLICE_DEFINITIONS.map((slice) => [
        slice.id,
        results.filter((result) => slice.matches(result)),
      ])
    ),
    providerTypeMap
  );

  const suites = Object.keys(normalizedSuiteMetadata);
  const totalTests = suites.reduce(
    (sum, suiteId) => sum + normalizedSuiteMetadata[suiteId].testCount,
    0
  );

  return {
    rankings,
    suiteMetadata: normalizedSuiteMetadata,
    rankingsBySuite,
    rankingsByCategory,
    rankingsBySlice,
    metadata: {
      timestamp: new Date().toISOString(),
      version,
      totalModels: rankings.length,
      totalTests,
      suites,
      languages: [...new Set(suites.map((suiteId) => normalizedSuiteMetadata[suiteId].language))],
      categories: [
        ...new Set(
          suites.map((suiteId) => normalizedSuiteMetadata[suiteId].category)
        ),
      ],
    },
    resultsBySuite,
  };
}

export function buildBenchmarkSummary(
  results: TestResult[],
  suites: TestSuite[],
  providers: STTProvider[],
  version: string
): BenchmarkSummary {
  return buildSummaryFromResults({
    results,
    suiteMetadata: buildSuiteMetadata(suites),
    providerTypeMap: new Map(
      providers.map((provider) => [provider.id, provider.type])
    ),
    version,
  });
}

export function mergeBenchmarkSummaries(options: {
  resultsBySuite: Record<string, TestResult[]>;
  suiteMetadata?: Partial<Record<string, SuiteMetadata>>;
  providerTypeMap: Map<string, ProviderType>;
  version: string;
}): BenchmarkSummary {
  const results = Object.values(options.resultsBySuite).flat();
  return buildSummaryFromResults({
    results,
    suiteMetadata: normalizeSuiteMetadata(
      options.suiteMetadata,
      options.resultsBySuite
    ),
    providerTypeMap: options.providerTypeMap,
    version: options.version,
  });
}

export const BENCHMARK_SLICES = SLICE_DEFINITIONS.map((slice) => slice.id);
