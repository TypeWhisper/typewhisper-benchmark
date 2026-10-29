import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { computeMetrics } from "./metrics/index.js";
import { buildSuiteMetadata, mergeBenchmarkSummaries } from "./summary.js";
import type { ProviderType, SuiteMetadata, TestCase, TestResult, TestSuite } from "./types.js";

/** The metric fields of a result, computed from its transcript and the clip's current references. */
export function scoreTranscript(
  test: TestCase,
  suite: TestSuite,
  transcription: string
): Pick<
  TestResult,
  | "werRaw"
  | "werNormalized"
  | "cer"
  | "codeWerNormalized"
  | "codeCer"
  | "punctuationScore"
  | "formattingScore"
  | "bestAlternativeWer"
> {
  const metrics = computeMetrics({
    reference: test.groundTruth,
    hypothesis: transcription,
    language: suite.language,
    codeReference: test.codeGroundTruth,
    formattedReference: test.formattedGroundTruth,
    alternativeReferences: test.alternativeGroundTruths,
  });
  return {
    werRaw: metrics.werRaw,
    werNormalized: metrics.werNormalized,
    cer: metrics.cer,
    codeWerNormalized: metrics.codeWerNormalized,
    codeCer: metrics.codeCer,
    punctuationScore: metrics.punctuationScore,
    formattingScore: metrics.formattingScore,
    bestAlternativeWer: metrics.bestAlternativeWer,
  };
}

export interface RescoreOptions {
  /** Only rescore these suites; all suites when omitted */
  suiteIds?: string[];
  /** Suites to remove from the result files of `dropProviders` */
  dropSuites?: string[];
  /** Providers whose results for `dropSuites` are removed, e.g. cloud APIs that cannot be rerun */
  dropProviders?: string[];
}

export interface RescoreReport {
  file: string;
  /** Results whose metrics changed */
  changed: number;
  /** Suites whose stored metadata (name, description, …) was refreshed from their definition */
  refreshed: string[];
  /** Suites removed from the file */
  dropped: string[];
}

interface ModelFile {
  ranking: { providerId: string; providerType: ProviderType; model: string };
  suiteMetadata?: Partial<Record<string, SuiteMetadata>>;
  resultsBySuite: Record<string, TestResult[]>;
}

/**
 * Recomputes the metrics of stored per-model results against the current suite references, without
 * running any model, and rebuilds each changed file's ranking the way the runner does. Files with
 * nothing to change are left untouched.
 */
export async function rescoreResultFiles(
  resultsDir: string,
  suites: TestSuite[],
  options: RescoreOptions = {}
): Promise<RescoreReport[]> {
  const suitesById = new Map(suites.map((suite) => [suite.id, suite]));
  const reports: RescoreReport[] = [];
  const files = (await readdir(resultsDir)).filter((file) => file.endsWith(".json")).sort();

  for (const file of files) {
    const path = join(resultsDir, file);
    const data = JSON.parse(await readFile(path, "utf-8")) as ModelFile;
    const providerId = data.ranking?.providerId;
    const dropped: string[] = [];
    const refreshed: string[] = [];
    let changed = 0;

    if (providerId && options.dropProviders?.includes(providerId)) {
      for (const suiteId of options.dropSuites ?? []) {
        if (!data.resultsBySuite[suiteId]) continue;
        delete data.resultsBySuite[suiteId];
        if (data.suiteMetadata) delete data.suiteMetadata[suiteId];
        dropped.push(suiteId);
      }
    }

    for (const [suiteId, results] of Object.entries(data.resultsBySuite)) {
      if (options.suiteIds && !options.suiteIds.includes(suiteId)) continue;
      const suite = suitesById.get(suiteId);
      if (!suite) continue;
      const fresh = buildSuiteMetadata([suite])[suiteId];
      if (JSON.stringify(data.suiteMetadata?.[suiteId]) !== JSON.stringify(fresh)) {
        data.suiteMetadata = { ...data.suiteMetadata, [suiteId]: fresh };
        refreshed.push(suiteId);
      }
      const testsById = new Map(suite.tests.map((test) => [test.id, test]));
      for (const result of results) {
        const test = testsById.get(result.testId);
        if (result.status !== "ok" || !test) continue;
        const scores = scoreTranscript(test, suite, result.transcription);
        const before = JSON.stringify(result);
        Object.assign(result, scores);
        if (JSON.stringify(result) !== before) changed += 1;
      }
    }

    if (!changed && !dropped.length && !refreshed.length) continue;

    const summary = mergeBenchmarkSummaries({
      resultsBySuite: data.resultsBySuite,
      suiteMetadata: data.suiteMetadata,
      providerTypeMap: new Map([[providerId, data.ranking.providerType]]),
      version: new Date().toISOString().slice(0, 10),
    });
    const modelFile = {
      ranking: summary.rankings[0] ?? data.ranking,
      suiteMetadata: summary.suiteMetadata,
      resultsBySuite: data.resultsBySuite,
    };
    await writeFile(path, JSON.stringify(modelFile, null, 2) + "\n", "utf-8");
    reports.push({ file, changed, refreshed, dropped });
  }
  return reports;
}
