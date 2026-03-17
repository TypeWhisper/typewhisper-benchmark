import type {
  BenchmarkOrigin,
  BenchmarkSummary,
  BenchmarkTier,
  ModelRanking,
  ProviderType,
  SuiteMetadata,
  TestResult,
} from "./types";

export type Scope = "global" | "category" | "suite" | "slice";
export type TierFilter = BenchmarkTier | "all";
export type OriginFilter = BenchmarkOrigin | "all";
export type LanguageFilter = "all" | "de" | "en" | "auto";

export interface ViewFilters {
  scope: Scope;
  scopeValue: string;
  tier: TierFilter;
  language: LanguageFilter;
  origin: OriginFilter;
}

export interface NormalizedBenchmarkSummary extends BenchmarkSummary {
  suiteMetadata: Record<string, SuiteMetadata>;
  rankingsBySuite: Record<string, ModelRanking[]>;
  rankingsByCategory: Record<string, ModelRanking[]>;
  rankingsBySlice: Record<string, ModelRanking[]>;
}

const SLICE_IDS = [
  "fast-speech",
  "numbers-dates",
  "technical-jargon",
  "proper-nouns",
] as const;

const SLICE_LABELS: Record<(typeof SLICE_IDS)[number], string> = {
  "fast-speech": "Fast Speech",
  "numbers-dates": "Numbers & Dates",
  "technical-jargon": "Technical Jargon",
  "proper-nouns": "Proper Nouns",
};

function inferLegacyCategory(suiteId: string): string {
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
  return suiteId.match(/-(de|en|auto)$/)?.[1] ?? "de";
}

function inferLegacyTier(suiteId: string, category: string): BenchmarkTier {
  if (
    suiteId.startsWith("hard-") ||
    category === "code-dictation" ||
    category === "code-switching"
  ) {
    return "diagnostic";
  }
  return "core";
}

function inferLegacyOrigin(suiteId: string, category: string): BenchmarkOrigin {
  if (
    suiteId.startsWith("clean-speech-") ||
    suiteId.startsWith("accented-speech-") ||
    category === "long-form-speech"
  ) {
    return "public";
  }
  return "synthetic";
}

function inferLegacyName(suiteId: string, language: string, category: string): string {
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
      return suiteId.startsWith("hard-") ? `Hard Cases (${langLabel})` : suiteId;
  }
}

function normalizeSuiteMetadata(summary: BenchmarkSummary): Record<string, SuiteMetadata> {
  const suiteIds = new Set([
    ...summary.metadata.suites,
    ...Object.keys(summary.resultsBySuite),
  ]);

  return Object.fromEntries(
    [...suiteIds].map((suiteId) => {
      const existing = summary.suiteMetadata?.[suiteId];
      const category = existing?.category ?? inferLegacyCategory(suiteId);
      const language = existing?.language ?? inferLegacyLanguage(suiteId);
      const results = summary.resultsBySuite[suiteId] ?? [];
      return [
        suiteId,
        {
          name: existing?.name ?? inferLegacyName(suiteId, language, category),
          description:
            existing?.description ?? `Legacy suite metadata inferred for ${suiteId}`,
          language,
          category,
          tier: existing?.tier ?? inferLegacyTier(suiteId, category),
          origin: existing?.origin ?? inferLegacyOrigin(suiteId, category),
          testCount:
            existing?.testCount ?? new Set(results.map((result) => result.testId)).size,
        },
      ];
    })
  );
}

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function averageOptional(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value != null);
  return defined.length > 0 ? average(defined) : undefined;
}

function isSkipped(result: TestResult): boolean {
  return result.status === "skipped";
}

function isError(result: TestResult): boolean {
  return result.status === "error" || !!result.error;
}

function sliceMatches(sliceId: string, result: TestResult): boolean {
  switch (sliceId) {
    case "fast-speech":
      return /(^|-)fast-/.test(result.testId);
    case "numbers-dates":
      return /(^|-)numbers-/.test(result.testId);
    case "technical-jargon":
      return /(^|-)tech-/.test(result.testId);
    case "proper-nouns":
      return /(^|-)names-/.test(result.testId);
    default:
      return false;
  }
}

function providerTypeMap(summary: BenchmarkSummary): Map<string, ProviderType> {
  return new Map(
    summary.rankings.map((ranking) => [ranking.providerId, ranking.providerType])
  );
}

export function buildRankings(
  results: TestResult[],
  providerTypes: Map<string, ProviderType>
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
    const valid = group.filter((result) => !isSkipped(result) && !isError(result));
    const errors = group.filter((result) => isError(result));
    const skips = group.filter((result) => isSkipped(result));
    const attempted = group.length - skips.length;

    if (valid.length === 0) {
      rankings.push({
        providerId,
        model,
        providerType: providerTypes.get(providerId) ?? "cloud",
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
    const totalCost = valid.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);

    rankings.push({
      providerId,
      model,
      providerType: providerTypes.get(providerId) ?? "cloud",
      avgWerNormalized: average(valid.map((result) => result.werNormalized)),
      avgCer: average(valid.map((result) => result.cer)),
      avgPunctuationScore: averageOptional(
        valid.map((result) => result.punctuationScore)
      ),
      avgFormattingScore: averageOptional(
        valid.map((result) => result.formattingScore)
      ),
      avgRealtimeFactor: average(valid.map((result) => result.realtimeFactor)),
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

export function normalizeSummary(summary: BenchmarkSummary): NormalizedBenchmarkSummary {
  return {
    ...summary,
    suiteMetadata: normalizeSuiteMetadata(summary),
    rankingsBySuite: summary.rankingsBySuite ?? {},
    rankingsByCategory: summary.rankingsByCategory ?? {},
    rankingsBySlice: summary.rankingsBySlice ?? {},
  };
}

export function getFilteredSuiteIds(
  summary: NormalizedBenchmarkSummary,
  filters: Pick<ViewFilters, "tier" | "language" | "origin">
): string[] {
  return Object.entries(summary.suiteMetadata)
    .filter(([, meta]) => filters.tier === "all" || meta.tier === filters.tier)
    .filter(
      ([, meta]) => filters.language === "all" || meta.language === filters.language
    )
    .filter(
      ([, meta]) => filters.origin === "all" || meta.origin === filters.origin
    )
    .map(([suiteId]) => suiteId)
    .sort((left, right) =>
      summary.suiteMetadata[left].name.localeCompare(summary.suiteMetadata[right].name)
    );
}

export function getScopeOptions(
  summary: NormalizedBenchmarkSummary,
  filters: Pick<ViewFilters, "tier" | "language" | "origin">
): {
  categories: Array<{ value: string; label: string }>;
  suites: Array<{ value: string; label: string }>;
  slices: Array<{ value: string; label: string }>;
} {
  const suiteIds = getFilteredSuiteIds(summary, filters);
  const categories = [...new Set(suiteIds.map((suiteId) => summary.suiteMetadata[suiteId].category))]
    .sort()
    .map((value) => ({ value, label: value }));

  const suites = suiteIds.map((suiteId) => ({
    value: suiteId,
    label: summary.suiteMetadata[suiteId].name,
  }));

  const filteredResults = suiteIds.flatMap(
    (suiteId) => summary.resultsBySuite[suiteId] ?? []
  );
  const slices = SLICE_IDS.filter((sliceId) =>
    filteredResults.some((result) => sliceMatches(sliceId, result))
  ).map((value) => ({
    value,
    label: SLICE_LABELS[value],
  }));

  return { categories, suites, slices };
}

function collectResults(
  summary: NormalizedBenchmarkSummary,
  filters: ViewFilters
): TestResult[] {
  const suiteIds = new Set(
    getFilteredSuiteIds(summary, {
      tier: filters.tier,
      language: filters.language,
      origin: filters.origin,
    })
  );

  let results = Object.entries(summary.resultsBySuite)
    .filter(([suiteId]) => suiteIds.has(suiteId))
    .flatMap(([, suiteResults]) => suiteResults);

  if (filters.scope === "category" && filters.scopeValue) {
    results = results.filter(
      (result) => summary.suiteMetadata[result.suiteId]?.category === filters.scopeValue
    );
  }

  if (filters.scope === "suite" && filters.scopeValue) {
    results = results.filter((result) => result.suiteId === filters.scopeValue);
  }

  if (filters.scope === "slice" && filters.scopeValue) {
    results = results.filter((result) => sliceMatches(filters.scopeValue, result));
  }

  return results;
}

export function getViewRankings(
  summary: NormalizedBenchmarkSummary,
  filters: ViewFilters
): ModelRanking[] {
  return buildRankings(collectResults(summary, filters), providerTypeMap(summary));
}

export function getViewHeading(
  summary: NormalizedBenchmarkSummary,
  filters: ViewFilters
): { title: string; description: string } {
  switch (filters.scope) {
    case "category":
      return {
        title: filters.scopeValue || "Category",
        description: "Rankings aggregated over all suites in the selected category.",
      };
    case "suite":
      return {
        title:
          summary.suiteMetadata[filters.scopeValue]?.name || filters.scopeValue || "Suite",
        description:
          summary.suiteMetadata[filters.scopeValue]?.description ||
          "Rankings for the selected suite.",
      };
    case "slice":
      return {
        title:
          SLICE_LABELS[filters.scopeValue as (typeof SLICE_IDS)[number]] ||
          filters.scopeValue ||
          "Slice",
        description: "Diagnostic slice derived from existing test IDs without rerunning clips.",
      };
    default:
      return {
        title: "Global",
        description: "Rankings across all suites matching the active filters.",
      };
  }
}

export function getVisibleTestCount(
  summary: NormalizedBenchmarkSummary,
  filters: Pick<ViewFilters, "tier" | "language" | "origin">
): number {
  return getFilteredSuiteIds(summary, filters).reduce(
    (sum, suiteId) => sum + summary.suiteMetadata[suiteId].testCount,
    0
  );
}
