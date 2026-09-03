import { describe, expect, it } from "vitest";
import {
  CatalogSchema,
  CorpusItemSchema,
  CorpusManifestSchema,
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
