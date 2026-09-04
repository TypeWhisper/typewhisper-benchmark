import { describe, expect, it } from "vitest";
import { buildExecutionPlan } from "../src/plan.js";
import { fixtureCatalog, fixtureCorpus, fixtureProfile } from "./fixtures.js";

describe("execution planning", () => {
  it("expands all required trials", () => {
    const plan = buildExecutionPlan({
      catalog: fixtureCatalog(),
      corpus: fixtureCorpus(),
      profile: fixtureProfile(),
    });

    expect(plan.targetIds).toEqual(["fixture-target"]);
    expect(plan.tasks).toEqual([
      { targetId: "fixture-target", caseId: "fixture-de-1", trial: 1 },
      { targetId: "fixture-target", caseId: "fixture-de-1", trial: 2 },
    ]);
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes identity when a model revision changes", () => {
    const catalog = fixtureCatalog();
    const baseline = buildExecutionPlan({
      catalog,
      corpus: fixtureCorpus(),
      profile: fixtureProfile(),
    });

    catalog.models[0]!.revision = "fixture-revision-2";
    const changed = buildExecutionPlan({
      catalog,
      corpus: fixtureCorpus(),
      profile: fixtureProfile(),
    });

    expect(changed.planId).not.toBe(baseline.planId);
  });

  it("changes identity when an audio digest changes", () => {
    const corpus = fixtureCorpus();
    const baseline = buildExecutionPlan({
      catalog: fixtureCatalog(),
      corpus,
      profile: fixtureProfile(),
    });

    corpus.items[0]!.audio.sha256 = "b".repeat(64);
    const changed = buildExecutionPlan({
      catalog: fixtureCatalog(),
      corpus,
      profile: fixtureProfile(),
    });

    expect(changed.planId).not.toBe(baseline.planId);
  });

  it("rejects targets without complete language coverage", () => {
    const catalog = fixtureCatalog();
    catalog.models[0]!.languages = ["en"];

    expect(() =>
      buildExecutionPlan({
        catalog,
        corpus: fixtureCorpus(),
        profile: fixtureProfile(),
      })
    ).toThrow(/does not support required languages: de/);
  });
});
