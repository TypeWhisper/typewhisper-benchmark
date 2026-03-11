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
import type {
  BenchmarkConfig,
  STTProvider,
  TestSuite,
  TestResult,
  BenchmarkSummary,
  ModelRanking,
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
        onEvent?.({
          type: "done",
          providerId: item.provider.id,
          model: item.model,
          testId: test.id,
          durationMs: cached.durationMs,
          werNormalized: cached.werNormalized,
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
        });

        const result: TestResult = {
          testId: test.id,
          suiteId: item.suite.id,
          providerId: item.provider.id,
          model: item.model,
          run: item.run,
          transcription: transcription.text,
          werRaw: metrics.werRaw,
          werNormalized: metrics.werNormalized,
          cer: metrics.cer,
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
  const summary = computeSummary(results, suites, providers, version);

  // Save results
  await saveResults(config.outputDirectory, summary, version);

  return summary;
}

function computeSummary(
  results: TestResult[],
  suites: TestSuite[],
  providers: STTProvider[],
  version: string
): BenchmarkSummary {
  const modelGroups = new Map<string, TestResult[]>();

  for (const r of results) {
    const key = `${r.providerId}/${r.model}`;
    const group = modelGroups.get(key) || [];
    group.push(r);
    modelGroups.set(key, group);
  }

  // Build a lookup for provider type
  const providerTypeMap = new Map<string, "cloud" | "local" | "system">();
  for (const p of providers) {
    providerTypeMap.set(p.id, p.type);
  }

  const rankings: ModelRanking[] = [];

  for (const [key, group] of modelGroups) {
    const [providerId, model] = key.split("/");
    const valid = group.filter((r) => !r.error);
    const errors = group.filter((r) => r.error);

    if (valid.length === 0) {
      rankings.push({
        providerId,
        model,
        providerType: providerTypeMap.get(providerId) || "cloud",
        avgWerNormalized: 1,
        avgCer: 1,
        avgRealtimeFactor: 0,
        avgDurationMs: 0,
        totalTests: group.length,
        errorCount: errors.length,
        errorRate: 1,
      });
      continue;
    }

    const totalAudioMs = valid.reduce((sum, r) => sum + r.audioDurationMs, 0);
    const totalCost = valid.reduce((sum, r) => sum + (r.costUsd || 0), 0);

    rankings.push({
      providerId,
      model,
      providerType: providerTypeMap.get(providerId) || "cloud",
      avgWerNormalized:
        valid.reduce((sum, r) => sum + r.werNormalized, 0) / valid.length,
      avgCer: valid.reduce((sum, r) => sum + r.cer, 0) / valid.length,
      avgRealtimeFactor:
        valid.reduce((sum, r) => sum + r.realtimeFactor, 0) / valid.length,
      avgDurationMs:
        valid.reduce((sum, r) => sum + r.durationMs, 0) / valid.length,
      costPerHourAudio:
        totalAudioMs > 0 ? (totalCost / totalAudioMs) * 3600000 : undefined,
      totalTests: group.length,
      errorCount: errors.length,
      errorRate: errors.length / group.length,
    });
  }

  rankings.sort((a, b) => a.avgWerNormalized - b.avgWerNormalized);

  const resultsBySuite: Record<string, TestResult[]> = {};
  for (const r of results) {
    (resultsBySuite[r.suiteId] ||= []).push(r);
  }

  return {
    rankings,
    metadata: {
      timestamp: new Date().toISOString(),
      version,
      totalModels: rankings.length,
      totalTests: results.length,
      suites: suites.map((s) => s.id),
      languages: [...new Set(suites.map((s) => s.language))],
      categories: [...new Set(suites.map((s) => s.category))],
    },
    resultsBySuite,
  };
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

  // Also write to visualizer data location
  try {
    const projectRoot = resolve(BENCH_ROOT, "..");
    const vizDir = join(projectRoot, "visualizer", "public", "data");
    if (!existsSync(vizDir)) await mkdir(vizDir, { recursive: true });
    await writeFile(
      join(vizDir, "benchmark-results.json"),
      JSON.stringify(summary, null, 2),
      "utf-8"
    );
  } catch {
    // Visualizer may not exist yet
  }
}
