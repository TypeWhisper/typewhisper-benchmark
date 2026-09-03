import { describe, expect, it } from "vitest";
import {
  CatalogSchema,
  CorpusItemSchema,
  CorpusManifestSchema,
  RecordingPlanSchema,
  ResultEventSchema,
} from "../src/schema.js";
import { fixtureCatalog, fixtureCorpus } from "./fixtures.js";

describe("catalog schema", () => {
  it("accepts a referenced target", () => {
    expect(fixtureCatalog().targets).toHaveLength(1);
  });

  it("rejects dangling adapter references", () => {
    const catalog = fixtureCatalog();
    catalog.targets[0]!.adapterId = "missing-adapter";
    expect(() => CatalogSchema.parse(catalog)).toThrow(/Unknown adapter/);
  });

  it("rejects duplicate IDs", () => {
    const catalog = fixtureCatalog();
    catalog.models.push({ ...catalog.models[0]! });
    expect(() => CatalogSchema.parse(catalog)).toThrow(/Duplicate models ID/);
  });
});

describe("corpus schema", () => {
  it("accepts self-recorded audio with recording metadata", () => {
    expect(fixtureCorpus().items[0]!.source.kind).toBe("self-recorded");
  });

  it("requires recording metadata for self-recorded audio", () => {
    const item = fixtureCorpus().items[0]!;
    const { recording: _recording, ...withoutRecording } = item;
    expect(() => CorpusItemSchema.parse(withoutRecording)).toThrow(
      /requires recording metadata/
    );
  });

  it("requires provenance for web references", () => {
    const item = fixtureCorpus().items[0]!;
    expect(() =>
      CorpusItemSchema.parse({
        ...item,
        source: {
          kind: "web-reference",
          name: "Web fixture",
          rights: { license: "CC-BY-4.0", redistributable: true },
        },
      })
    ).toThrow(/requires a source URL/);
  });

  it("rejects an empty published corpus", () => {
    expect(() =>
      CorpusManifestSchema.parse({
        schemaVersion: 1,
        corpusVersion: "empty-1",
        status: "published",
        items: [],
      })
    ).toThrow(/cannot be empty/);
  });

  it("requires stable public-dataset locators", () => {
    const item = fixtureCorpus().items[0]!;
    expect(() =>
      CorpusItemSchema.parse({
        ...item,
        source: {
          kind: "public-dataset",
          name: "Dataset fixture",
          url: "https://example.com/dataset",
          rights: { license: "CC-BY-4.0", redistributable: true },
        },
      })
    ).toThrow(/requires datasetVersion/);
  });
});

describe("recording plan schema", () => {
  it("accepts a concrete recording prompt", () => {
    const plan = RecordingPlanSchema.parse({
      schemaVersion: 1,
      id: "recording-plan-v1",
      status: "draft",
      languagePacks: [
        {
          language: "de-DE",
          tier: "anchor",
          selfRecordedTarget: 1,
          webReferenceTarget: 1,
          categoryTargets: {
            "everyday-dictation": 0,
            formatting: 0,
            numbers: 1,
            "proper-nouns": 0,
            code: 0,
            "mixed-hard": 0,
          },
          nativeReviewRequired: true,
        },
      ],
      prompts: [
        {
          id: "de-own-001",
          language: "de-DE",
          category: "numbers",
          spokenText: "Der Termin ist am zwölften September um neun Uhr dreißig",
          formattedReference: "Der Termin ist am 12. September um 9:30 Uhr.",
          expectations: {
            numbers: [{ id: "time", expected: "9:30" }],
          },
        },
      ],
    });
    expect(plan.prompts).toHaveLength(1);
  });

  it("rejects duplicate prompt IDs", () => {
    const prompt = {
      id: "de-own-001",
      language: "de-DE",
      category: "everyday-dictation",
      spokenText: "Bitte verschiebe den Termin auf morgen",
      formattedReference: "Bitte verschiebe den Termin auf morgen.",
    };
    expect(() =>
      RecordingPlanSchema.parse({
        schemaVersion: 1,
        id: "recording-plan-v1",
        status: "draft",
        languagePacks: [
          {
            language: "de-DE",
            tier: "anchor",
            selfRecordedTarget: 2,
            webReferenceTarget: 1,
            categoryTargets: {
              "everyday-dictation": 2,
              formatting: 0,
              numbers: 0,
              "proper-nouns": 0,
              code: 0,
              "mixed-hard": 0,
            },
            nativeReviewRequired: true,
          },
        ],
        prompts: [prompt, prompt],
      })
    ).toThrow(/Duplicate recording prompt ID/);
  });
});

describe("result schema", () => {
  it("requires transcripts for successful results", () => {
    expect(() =>
      ResultEventSchema.parse({
        schemaVersion: 1,
        runId: "run-1",
        planId: "a".repeat(64),
        targetId: "fixture-target",
        caseId: "fixture-de-1",
        trial: 1,
        status: "ok",
      })
    ).toThrow(/requires a transcript/);
  });
});
