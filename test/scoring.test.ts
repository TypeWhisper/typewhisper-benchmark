import { describe, expect, it } from "vitest";
import { contentDigest } from "../src/identity.js";
import { buildExecutionPlan } from "../src/plan.js";
import { createVisualizationSnapshot } from "../src/scoring.js";
import {
  ExternalRunBundleSchema,
  RunKitSchema,
  type ResultEvent,
} from "../src/schema.js";
import { fixtureCatalog, fixtureCorpus, fixtureProfile } from "./fixtures.js";

function fixtureRun() {
  const catalog = fixtureCatalog();
  catalog.adapters[0]!.id = "typewhisper-http";
  catalog.targets[0]!.adapterId = "typewhisper-http";
  catalog.targets[0]!.parameters = {
    typewhisperEngine: "fixture",
    typewhisperModel: "fixture-model",
  };
  const corpus = fixtureCorpus();
  const profile = fixtureProfile();
  profile.trialsPerCase = 1;
  const plan = buildExecutionPlan({ catalog, corpus, profile });
  const kitContent = {
    schemaVersion: 1 as const,
    runnerProtocol: "typewhisper-http-v1" as const,
    planId: plan.planId,
    profileId: profile.id,
    corpusVersion: corpus.corpusVersion,
    gitCommit: "a".repeat(40),
    targetId: "fixture-target",
    execution: {
      engine: "fixture",
      model: "fixture-model",
      awaitDownload: false,
      applyCorrections: false as const,
      normalizeNumbers: false as const,
      useSelectedModel: false,
      warmup: true,
      requireNoCorrections: false,
    },
    tasks: [
      {
        caseId: "fixture-de-1",
        trial: 1,
        language: "de",
        audio: { path: "audio/fixture.wav", sha256: "b".repeat(64) },
      },
    ],
  };
  const kit = RunKitSchema.parse({
    ...kitContent,
    kitDigest: contentDigest(kitContent),
  });
  const result: ResultEvent = {
    schemaVersion: 1,
    runId: "fixture-run",
    planId: plan.planId,
    targetId: "fixture-target",
    caseId: "fixture-de-1",
    trial: 1,
    status: "ok",
    transcript: "TypeWhisper kostet im Beispiel 12 Euro.",
    durationMs: 200,
    providerMetadata: {
      audioSha256: "b".repeat(64),
      engine: "fixture",
      model: "fixture-model",
      activeBackend: "not-reported",
    },
  };
  const bundle = ExternalRunBundleSchema.parse({
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      runId: "fixture-run",
      planId: plan.planId,
      runKitDigest: kit.kitDigest,
      createdAt: "2026-09-04T12:00:00.000Z",
      gitCommit: kit.gitCommit,
      targetIds: ["fixture-target"],
      environment: {
        environmentId: "fixture-machine",
        os: "Fixture OS",
        architecture: "fixture",
        runtimeVersions: { warmupMs: "100" },
      },
    },
    results: [result],
  });
  return { catalog, corpus, profile, kit, bundle };
}

describe("snapshot scoring", () => {
  it("validates and aggregates a complete run", () => {
    const fixture = fixtureRun();
    const snapshot = createVisualizationSnapshot({
      ...fixture,
      runs: [{ kit: fixture.kit, bundle: fixture.bundle }],
      scoringGitCommit: "c".repeat(40),
      generatedAt: "2026-09-04T13:00:00.000Z",
    });
    expect(snapshot.caseCount).toBe(1);
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.aggregates.find((entry) => entry.metricId === "formatting")?.value).toBe(1);
    expect(snapshot.latency[0]?.medianMs).toBe(200);
    expect(snapshot.snapshotId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a run with failed tasks", () => {
    const fixture = fixtureRun();
    fixture.bundle.results[0] = {
      ...fixture.bundle.results[0]!,
      status: "error",
      transcript: undefined,
      error: "fixture failure",
    };
    expect(() =>
      createVisualizationSnapshot({
        ...fixture,
        runs: [{ kit: fixture.kit, bundle: fixture.bundle }],
        scoringGitCommit: "c".repeat(40),
      })
    ).toThrow(/incomplete/);
  });
});
