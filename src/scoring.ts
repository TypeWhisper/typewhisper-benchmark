import { contentDigest } from "./identity.js";
import { scoreResult, type MetricOutcome } from "./metrics.js";
import { buildExecutionPlan } from "./plan.js";
import { runKitDigest } from "./run-kit.js";
import {
  ExternalRunBundleSchema,
  RunKitSchema,
  VisualizationSnapshotSchema,
  type BenchmarkProfile,
  type Catalog,
  type CorpusManifest,
  type ExternalRunBundle,
  type ResultEvent,
  type RunKit,
  type VisualizationSnapshot,
} from "./schema.js";

interface ScoredEvent {
  result: ResultEvent;
  language: string;
  outcomes: MetricOutcome[];
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) throw new Error("Cannot calculate an empty percentile");
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

function validateRun(options: {
  bundle: ExternalRunBundle;
  kit: RunKit;
  catalog: Catalog;
  corpus: CorpusManifest;
  profile: BenchmarkProfile;
}): void {
  const { bundle, kit, catalog, corpus, profile } = options;
  const { kitDigest, ...kitContent } = kit;
  if (runKitDigest(kitContent) !== kitDigest) {
    throw new Error(`Run kit ${kitDigest} has an invalid content digest`);
  }
  if (bundle.manifest.runKitDigest !== kit.kitDigest) {
    throw new Error(`Run ${bundle.manifest.runId} does not match its run kit`);
  }
  if (bundle.manifest.gitCommit !== kit.gitCommit) {
    throw new Error(`Run ${bundle.manifest.runId} has a different Git commit than its run kit`);
  }
  if (kit.profileId !== profile.id || kit.corpusVersion !== corpus.corpusVersion) {
    throw new Error(`Run kit ${kit.kitDigest} does not match the selected profile/corpus`);
  }

  const plan = buildExecutionPlan({
    catalog,
    corpus,
    profile,
    targetIds: [kit.targetId],
  });
  if (plan.planId !== kit.planId || bundle.manifest.planId !== plan.planId) {
    throw new Error(`Run ${bundle.manifest.runId} has an invalid plan identity`);
  }
  if (
    bundle.manifest.targetIds.length !== 1 ||
    bundle.manifest.targetIds[0] !== kit.targetId
  ) {
    throw new Error(`Run ${bundle.manifest.runId} must contain only target ${kit.targetId}`);
  }

  const expected = new Set(
    plan.tasks.map((task) => `${task.targetId}:${task.caseId}:${task.trial}`)
  );
  const kitTasks = new Map(
    kit.tasks.map((task) => [`${kit.targetId}:${task.caseId}:${task.trial}`, task])
  );
  const actual = new Set(
    bundle.results.map(
      (result) => `${result.targetId}:${result.caseId}:${result.trial}`
    )
  );
  const missing = [...expected].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Run ${bundle.manifest.runId} task mismatch: ${missing.length} missing, ${extra.length} extra`
    );
  }
  const errors = bundle.results.filter((result) => result.status === "error");
  if (errors.length > 0) {
    throw new Error(
      `Run ${bundle.manifest.runId} is incomplete: ${errors.length} task(s) failed`
    );
  }

  for (const result of bundle.results) {
    const key = `${result.targetId}:${result.caseId}:${result.trial}`;
    const task = kitTasks.get(key)!;
    const metadata = result.providerMetadata;
    if (metadata?.audioSha256 !== task.audio.sha256) {
      throw new Error(`Run ${bundle.manifest.runId} used unverified audio for ${key}`);
    }
    if (
      metadata.engine !== kit.execution.engine ||
      metadata.model !== kit.execution.model
    ) {
      throw new Error(`Run ${bundle.manifest.runId} used the wrong engine/model for ${key}`);
    }
    if (
      kit.execution.requiredActiveBackend &&
      metadata.activeBackend !== kit.execution.requiredActiveBackend
    ) {
      throw new Error(`Run ${bundle.manifest.runId} used the wrong backend for ${key}`);
    }
  }

  const runtime = bundle.manifest.environment.runtimeVersions;
  if (
    kit.execution.expectedDictionaryTermsSha256 &&
    runtime.dictionaryTermsSha256 !== kit.execution.expectedDictionaryTermsSha256
  ) {
    throw new Error(`Run ${bundle.manifest.runId} used an unexpected dictionary context`);
  }
  if (
    kit.execution.requireNoCorrections &&
    runtime.dictionaryCorrectionCount !== "0"
  ) {
    throw new Error(`Run ${bundle.manifest.runId} used dictionary corrections`);
  }
  if (kit.execution.warmup) {
    const warmupMs = Number(runtime.warmupMs);
    if (!Number.isFinite(warmupMs) || warmupMs < 0) {
      throw new Error(`Run ${bundle.manifest.runId} has no valid warm-up attestation`);
    }
  }
}

function aggregate(outcomes: MetricOutcome[]): number {
  const countBased = outcomes.every(
    (outcome) => outcome.errors !== undefined && outcome.units !== undefined
  );
  if (countBased) {
    const errors = outcomes.reduce((sum, outcome) => sum + outcome.errors!, 0);
    const units = outcomes.reduce((sum, outcome) => sum + outcome.units!, 0);
    return errors / Math.max(1, units);
  }
  return outcomes.reduce((sum, outcome) => sum + outcome.value, 0) / outcomes.length;
}

export function createVisualizationSnapshot(options: {
  catalog: Catalog;
  corpus: CorpusManifest;
  profile: BenchmarkProfile;
  runs: Array<{ kit: RunKit; bundle: ExternalRunBundle }>;
  scoringGitCommit: string;
  generatedAt?: string;
}): VisualizationSnapshot {
  const metricIds = options.profile.metrics.map((metric) => {
    if (metric.version !== "1") {
      throw new Error(`Unsupported ${metric.id} metric version: ${metric.version}`);
    }
    return metric.id;
  });
  const items = new Map(options.corpus.items.map((item) => [item.id, item]));
  const selectedItems = options.profile.caseIds.map((caseId) => items.get(caseId)!);
  const scored: ScoredEvent[] = [];
  const bundles: ExternalRunBundle[] = [];
  const kits: RunKit[] = [];

  for (const input of options.runs) {
    const kit = RunKitSchema.parse(input.kit);
    const bundle = ExternalRunBundleSchema.parse(input.bundle);
    validateRun({ ...options, kit, bundle });
    kits.push(kit);
    bundles.push(bundle);
    for (const result of bundle.results) {
      const item = items.get(result.caseId)!;
      scored.push({
        result,
        language: item.language,
        outcomes: scoreResult(item, result, metricIds),
      });
    }
  }

  if (bundles.length === 0) throw new Error("At least one run is required");
  const runIds = bundles.map((bundle) => bundle.manifest.runId);
  if (new Set(runIds).size !== runIds.length) throw new Error("Run IDs must be unique");
  const targetIds = kits.map((kit) => kit.targetId);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new Error("A snapshot accepts only one reviewed run per target");
  }

  const languages = [...new Set(selectedItems.map((item) => item.language))].sort();
  const aggregates: VisualizationSnapshot["aggregates"] = [];
  const latency: VisualizationSnapshot["latency"] = [];

  for (const targetId of targetIds) {
    for (const language of languages) {
      const totalCases = selectedItems.filter((item) => item.language === language).length;
      const events = scored.filter(
        (entry) =>
          entry.result.targetId === targetId && entry.language === language
      );
      for (const metricId of metricIds) {
        const eligible = events.filter((event) =>
          event.outcomes.some((outcome) => outcome.metricId === metricId)
        );
        if (eligible.length === 0) continue;
        const outcomes = eligible.map(
          (event) =>
            event.outcomes.find((outcome) => outcome.metricId === metricId)!
        );
        aggregates.push({
          targetId,
          language,
          metricId,
          value: aggregate(outcomes),
          eligibleCases: new Set(eligible.map((event) => event.result.caseId)).size,
          totalCases,
        });
      }

      const durations = events
        .map((event) => event.result.durationMs)
        .filter((value): value is number => value !== undefined);
      if (durations.length > 0) {
        latency.push({
          targetId,
          language,
          medianMs: percentile(durations, 0.5),
          p95Ms: percentile(durations, 0.95),
        });
      }
    }
  }

  const targets = targetIds.map((targetId) => {
    const target = options.catalog.targets.find((entry) => entry.id === targetId)!;
    const model = options.catalog.models.find((entry) => entry.id === target.modelId)!;
    return {
      id: target.id,
      displayName: target.displayName,
      provider: model.provider,
      modelId: model.upstreamModelId,
      revision: model.revision,
    };
  });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const snapshotContent = {
    schemaVersion: 1 as const,
    generatedAt,
    profileId: options.profile.id,
    corpusVersion: options.corpus.corpusVersion,
    scoringGitCommit: options.scoringGitCommit,
    caseCount: selectedItems.length,
    runIds,
    languages,
    targets,
    aggregates,
    latency,
  };
  return VisualizationSnapshotSchema.parse({
    ...snapshotContent,
    snapshotId: contentDigest(snapshotContent),
  });
}
