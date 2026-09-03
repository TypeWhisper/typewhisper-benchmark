import {
  BenchmarkProfileSchema,
  CatalogSchema,
  CorpusManifestSchema,
} from "../src/schema.js";

export function fixtureCatalog() {
  return CatalogSchema.parse({
    schemaVersion: 1,
    adapters: [
      {
        id: "fixture-cloud",
        displayName: "Fixture Cloud",
        kind: "cloud",
        protocolVersion: "1",
        modes: ["batch"],
      },
    ],
    models: [
      {
        id: "fixture-model",
        displayName: "Fixture Model",
        provider: "fixture",
        upstreamModelId: "fixture/model",
        revision: "fixture-revision-1",
        releaseChannel: "stable",
        languages: ["de", "en"],
        modes: ["batch"],
      },
    ],
    targets: [
      {
        id: "fixture-target",
        displayName: "Fixture Target",
        adapterId: "fixture-cloud",
        modelId: "fixture-model",
        mode: "batch",
        parameters: { temperature: 0 },
      },
    ],
  });
}

export function fixtureCorpus() {
  return CorpusManifestSchema.parse({
    schemaVersion: 1,
    corpusVersion: "fixture-corpus-1",
    status: "published",
    items: [
      {
        id: "fixture-de-1",
        audio: {
          path: "audio/fixture-de-1.wav",
          sha256: "a".repeat(64),
          format: "wav",
          sampleRateHz: 16000,
          channels: 1,
          durationMs: 2500,
        },
        language: "de",
        tags: ["clean", "numbers", "proper-nouns"],
        references: {
          verbatim: "TypeWhisper kostet im Beispiel zwölf Euro.",
          formatted: "TypeWhisper kostet im Beispiel 12 Euro.",
        },
        expectations: {
          numbers: [{ id: "price", expected: "12", alternatives: ["zwölf"] }],
          properNouns: [{ id: "product", expected: "TypeWhisper" }],
        },
        source: {
          kind: "self-recorded",
          name: "Test fixture",
          rights: {
            license: "Test only",
            redistributable: false,
          },
        },
        recording: {
          device: "Fixture microphone",
          environment: "Quiet room",
          speakerId: "fixture-speaker",
        },
        review: {
          status: "verified",
          reviewedBy: "test-suite",
          reviewedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
  });
}

export function fixtureProfile() {
  return BenchmarkProfileSchema.parse({
    schemaVersion: 1,
    id: "fixture-profile",
    displayName: "Fixture Profile",
    track: "file-transcription",
    mode: "batch",
    corpusVersion: "fixture-corpus-1",
    caseIds: ["fixture-de-1"],
    metrics: [
      { id: "wer", version: "1" },
      { id: "cer", version: "1" },
      { id: "formatting", version: "1" },
      { id: "numbers", version: "1" },
      { id: "proper-nouns", version: "1" },
      { id: "code", version: "1" },
    ],
    trialsPerCase: 2,
  });
}
