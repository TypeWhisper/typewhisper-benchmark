import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");
import { getAudioInfo } from "./audio.js";
import { computeMetrics } from "./metrics/index.js";
import {
  buildBenchmarkSummary,
  mergeBenchmarkSummaries,
} from "./summary.js";
import type {
  BenchmarkConfig,
  STTProvider,
  SuiteMetadata,
  TestResult,
  BenchmarkSummary,
  TestSuite,
} from "./types.js";

// === Events ===

export type RunnerEvent =
  | { type: "plan"; totalTests: number; providers: string[] }
  | { type: "start"; providerId: string; model: string; testId: string }
  | {
      type: "done";
      providerId: string;
      model: string;
      testId: string;
      durationMs: number;
      werNormalized: number;
    }
  | {
      type: "skip";
      providerId: string;
      model: string;
      testId: string;
      reason: string;
    }
  | {
      type: "error";
      providerId: string;
      model: string;
      testId: string;
      error: string;
    };

// === Cache ===

function cacheKey(
  suiteId: string,
  testId: string,
  providerId: string,
  model: string,
  run: number
): string {
  return createHash("sha1")
    .update(`${suiteId}:${testId}:${providerId}:${model}:${run}`)
    .digest("hex")
    .slice(0, 16);
}

async function readCache(
  cacheDir: string,
  key: string
): Promise<TestResult | null> {
  const filePath = join(cacheDir, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as TestResult;
  } catch {
    return null;
  }
}

async function writeCache(
  cacheDir: string,
  key: string,
  result: TestResult
): Promise<void> {
  if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
  const filePath = join(cacheDir, `${key}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
}

// === Runner ===

interface WorkItem {
  suite: TestSuite;
  testIndex: number;
  provider: STTProvider;
  model: string;
  run: number;
}

export interface RunnerOptions {
  suites: TestSuite[];
  providers: STTProvider[];
  config: BenchmarkConfig;
  version: string;
  onEvent?: (event: RunnerEvent) => void;
}

export async function runBenchmark(
  options: RunnerOptions
): Promise<BenchmarkSummary> {
  const { suites, providers, config, version, onEvent } = options;

  const cacheDir = join(config.outputDirectory, "cache");
  const results: TestResult[] = [];

  // Build work queue
  const workQueue: WorkItem[] = [];
  for (const suite of suites) {
    for (let ti = 0; ti < suite.tests.length; ti++) {
      for (const provider of providers) {
        for (const model of provider.models) {
          for (let run = 1; run <= config.runsPerModel; run++) {
            workQueue.push({ suite, testIndex: ti, provider, model, run });
          }
        }
      }
    }
  }

  onEvent?.({
    type: "plan",
    totalTests: workQueue.length,
    providers: providers.flatMap((p) => p.models.map((m) => `${p.id}/${m}`)),
  });

  // Process with concurrency limit using atomic index
  let queueIndex = 0;

  async function worker(): Promise<void> {
    while (queueIndex < workQueue.length) {
      const idx = queueIndex++;
      const item = workQueue[idx];
      if (!item) break;
      const test = item.suite.tests[item.testIndex];

      const key = cacheKey(
        item.suite.id,
        test.id,
        item.provider.id,
        item.model,
        item.run
      );

      // Check cache
      const cached = await readCache(cacheDir, key);
      if (cached && !cached.error) {
        results.push(cached);
        if (cached.status === "skipped") {
          onEvent?.({
            type: "skip",
            providerId: item.provider.id,
            model: item.model,
            testId: test.id,
            reason: cached.skipReason || "Skipped",
          });
        } else {
          onEvent?.({
            type: "done",
            providerId: item.provider.id,
            model: item.model,
            testId: test.id,
            durationMs: cached.durationMs,
            werNormalized: cached.werNormalized,
          });
        }
        continue;
      }

      if (!item.provider.supportsLanguage(item.model, item.suite.language)) {
        const skippedResult: TestResult = {
          testId: test.id,
          suiteId: item.suite.id,
          providerId: item.provider.id,
          model: item.model,
          run: item.run,
          suiteCategory: item.suite.category,
          suiteLanguage: item.suite.language,
          testTags: test.tags,
          testSource: test.source,
          testMetadata: test.metadata,
          status: "skipped",
          transcription: "",
          werRaw: 0,
          werNormalized: 0,
          cer: 0,
          durationMs: 0,
          realtimeFactor: 0,
          audioDurationMs: 0,
          timestamp: new Date().toISOString(),
          skipReason: `Model "${item.model}" does not support language "${item.suite.language}"`,
        };

        results.push(skippedResult);
        await writeCache(cacheDir, key, skippedResult);

        onEvent?.({
          type: "skip",
          providerId: item.provider.id,
          model: item.model,
          testId: test.id,
          reason: skippedResult.skipReason || "Skipped",
        });
        continue;
      }

      onEvent?.({
        type: "start",
        providerId: item.provider.id,
        model: item.model,
        testId: test.id,
      });

      try {
        const audioPath = join(BENCH_ROOT, "audio", test.audioFile);
        const audioInfo = await getAudioInfo(audioPath, item.suite.language);

        const transcription = await Promise.race([
          item.provider.transcribe(audioInfo, item.model),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Timeout")),
              config.timeoutSeconds * 1000
            )
          ),
        ]);

        const metrics = computeMetrics({
          reference: test.groundTruth,
          hypothesis: transcription.text,
          language: item.suite.language,
          codeReference: test.codeGroundTruth,
          formattedReference: test.formattedGroundTruth,
          alternativeReferences: test.alternativeGroundTruths,
        });

        const result: TestResult = {
          testId: test.id,
          suiteId: item.suite.id,
          providerId: item.provider.id,
          model: item.model,
          run: item.run,
          suiteCategory: item.suite.category,
          suiteLanguage: item.suite.language,
          testTags: test.tags,
          testSource: test.source,
          testMetadata: test.metadata,
          status: "ok",
          transcription: transcription.text,
          werRaw: metrics.werRaw,
          werNormalized: metrics.werNormalized,
          cer: metrics.cer,
          codeWerNormalized: metrics.codeWerNormalized,
          codeCer: metrics.codeCer,
          punctuationScore: metrics.punctuationScore,
          formattingScore: metrics.formattingScore,
          bestAlternativeWer: metrics.bestAlternativeWer,
          durationMs: transcription.durationMs,
          realtimeFactor:
            audioInfo.durationSeconds > 0
              ? transcription.durationMs / (audioInfo.durationSeconds * 1000)
              : 0,
          audioDurationMs: audioInfo.durationSeconds * 1000,
          costUsd: transcription.cost,
          timestamp: new Date().toISOString(),
        };

        results.push(result);
        await writeCache(cacheDir, key, result);

        onEvent?.({
          type: "done",
          providerId: item.provider.id,
          model: item.model,
          testId: test.id,
          durationMs: result.durationMs,
          werNormalized: result.werNormalized,
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);

        const errorResult: TestResult = {
          testId: test.id,
          suiteId: item.suite.id,
          providerId: item.provider.id,
          model: item.model,
          run: item.run,
          suiteCategory: item.suite.category,
          suiteLanguage: item.suite.language,
          testTags: test.tags,
          testSource: test.source,
          testMetadata: test.metadata,
          status: "error",
          transcription: "",
          werRaw: 1,
          werNormalized: 1,
          cer: 1,
          durationMs: 0,
          realtimeFactor: 0,
          audioDurationMs: 0,
          timestamp: new Date().toISOString(),
          error: errorMsg,
        };

        results.push(errorResult);
        // Errors are NOT cached - will be retried on next run

        onEvent?.({
          type: "error",
          providerId: item.provider.id,
          model: item.model,
          testId: test.id,
          error: errorMsg,
        });
      }
    }
  }

  // Stagger worker start
  const workerCount = Math.min(config.maxConcurrency, workQueue.length);
  const workers = Array.from({ length: workerCount }, (_, i) =>
    new Promise<void>((resolve) =>
      setTimeout(() => resolve(), i * config.staggerDelayMs)
    ).then(() => worker())
  );

  await Promise.all(workers);

  // Compute summary and rankings
  const summary = buildBenchmarkSummary(results, suites, providers, version);

  // Save results
  await saveResults(config.outputDirectory, summary, version);

  return summary;
}
async function saveResults(
  outputDir: string,
  summary: BenchmarkSummary,
  version: string
): Promise<void> {
  const dir = join(outputDir, version);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  await writeFile(
    join(dir, `summary-${timestamp}.json`),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );

  // Write per-provider-model result files (conflict-free for git)
  await savePerModelResults(summary);
}

/** Write one JSON file per provider+model, then merge all into benchmark-results.json */
async function savePerModelResults(summary: BenchmarkSummary): Promise<void> {
  if (process.env.VITEST) return;

  try {
    const projectRoot = resolve(BENCH_ROOT, "..");
    const resultsDir = join(projectRoot, "visualizer", "public", "data", "results");
    if (!existsSync(resultsDir)) await mkdir(resultsDir, { recursive: true });

    // Write individual files for each provider+model in this run
    // Merge with existing results from other suites
    for (const ranking of summary.rankings) {
      const filename = `${ranking.providerId}_${ranking.model}.json`;
      const filePath = join(resultsDir, filename);

      // Load existing results for this model (from previous runs on other suites)
      let existingResults: Record<string, TestResult[]> = {};
      let existingSuiteMetadata: Partial<Record<string, SuiteMetadata>> = {};
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, "utf-8");
          const existing = JSON.parse(raw);
          if (existing.resultsBySuite) existingResults = existing.resultsBySuite;
          if (existing.suiteMetadata) existingSuiteMetadata = existing.suiteMetadata;
        } catch {
          // Ignore malformed files
        }
      }

      // Merge: new suite results overwrite existing ones for same suite
      const newResults: Record<string, TestResult[]> = {};
      for (const [suiteId, results] of Object.entries(summary.resultsBySuite)) {
        const filtered = results.filter(
          (r) => r.providerId === ranking.providerId && r.model === ranking.model
        );
        if (filtered.length > 0) newResults[suiteId] = filtered;
      }

      const mergedResults = { ...existingResults, ...newResults };
      const mergedSuiteMetadata = {
        ...existingSuiteMetadata,
        ...summary.suiteMetadata,
      };

      const mergedSummary = mergeBenchmarkSummaries({
        resultsBySuite: mergedResults,
        suiteMetadata: mergedSuiteMetadata,
        providerTypeMap: new Map([[ranking.providerId, ranking.providerType]]),
        version: summary.metadata.version,
      });
      const mergedRanking = mergedSummary.rankings[0] ?? ranking;

      const modelFile = {
        ranking: mergedRanking,
        suiteMetadata: mergedSummary.suiteMetadata,
        resultsBySuite: mergedResults,
      };

      await writeFile(
        filePath,
        JSON.stringify(modelFile, null, 2) + "\n",
        "utf-8"
      );
    }

    // Merge all individual files into combined benchmark-results.json
    await mergeResultFiles(projectRoot);
  } catch {
    // Visualizer may not exist yet
  }
}

/** Read all per-model files from results/ and merge into benchmark-results.json */
export async function mergeResultFiles(projectRoot?: string): Promise<void> {
  const root = projectRoot || resolve(BENCH_ROOT, "..");
  const resultsDir = join(root, "visualizer", "public", "data", "results");
  const outFile = join(root, "visualizer", "public", "data", "benchmark-results.json");

  if (!existsSync(resultsDir)) return;

  const { readdir } = await import("fs/promises");
  const files = (await readdir(resultsDir)).filter((f) => f.endsWith(".json"));
  const resultsBySuite: Record<string, TestResult[]> = {};
  const suiteMetadata: Partial<Record<string, SuiteMetadata>> = {};
  const providerTypeMap = new Map<string, "cloud" | "local" | "system">();

  for (const file of files) {
    try {
      const raw = await readFile(join(resultsDir, file), "utf-8");
      const data = JSON.parse(raw);
      if (data.ranking?.providerId && data.ranking?.providerType) {
        providerTypeMap.set(data.ranking.providerId, data.ranking.providerType);
      }
      if (data.suiteMetadata) {
        Object.assign(suiteMetadata, data.suiteMetadata);
      }
      if (data.resultsBySuite) {
        for (const [suiteId, results] of Object.entries(data.resultsBySuite)) {
          (resultsBySuite[suiteId] ||= []).push(...(results as TestResult[]));
        }
      }
    } catch {
      // Skip malformed files
    }
  }
  const merged: BenchmarkSummary = mergeBenchmarkSummaries({
    resultsBySuite,
    suiteMetadata,
    providerTypeMap,
    version: new Date().toISOString().slice(0, 10),
  });

  await writeFile(outFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}
