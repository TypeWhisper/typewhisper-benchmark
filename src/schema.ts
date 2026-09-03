import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

export const InternalIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "Use a stable lowercase ID containing only letters, numbers, dots, underscores, and hyphens"
  );

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const ExecutionModeSchema = z.enum(["batch", "streaming"]);
export const TrackSchema = z.enum(["dictation", "file-transcription"]);
export const MetricIdSchema = z.enum([
  "wer",
  "cer",
  "formatting",
  "numbers",
  "proper-nouns",
  "code",
]);

export const AdapterDefinitionSchema = z.object({
  id: InternalIdSchema,
  displayName: z.string().min(1),
  kind: z.enum(["cloud", "local", "system"]),
  protocolVersion: z.string().min(1),
  modes: z.array(ExecutionModeSchema).min(1),
});

export const ModelDefinitionSchema = z.object({
  id: InternalIdSchema,
  displayName: z.string().min(1),
  provider: InternalIdSchema,
  upstreamModelId: z.string().min(1),
  revision: z.string().min(1),
  releaseChannel: z.enum(["stable", "preview", "deprecated"]),
  languages: z.union([z.literal("*"), z.array(z.string().min(2)).min(1)]),
  modes: z.array(ExecutionModeSchema).min(1),
});

export const RuntimeDefinitionSchema = z.object({
  engine: z.string().min(1),
  version: z.string().min(1),
  quantization: z.string().min(1).optional(),
});

export const TargetDefinitionSchema = z.object({
  id: InternalIdSchema,
  displayName: z.string().min(1),
  adapterId: InternalIdSchema,
  modelId: InternalIdSchema,
  mode: ExecutionModeSchema,
  runtime: RuntimeDefinitionSchema.optional(),
  parameters: z.record(z.string(), JsonValueSchema).default({}),
});

function duplicateIds(values: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates];
}

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    adapters: z.array(AdapterDefinitionSchema),
    models: z.array(ModelDefinitionSchema),
    targets: z.array(TargetDefinitionSchema),
  })
  .superRefine((catalog, context) => {
    for (const collection of ["adapters", "models", "targets"] as const) {
      for (const id of duplicateIds(catalog[collection])) {
        context.addIssue({
          code: "custom",
          path: [collection],
          message: `Duplicate ${collection} ID: ${id}`,
        });
      }
    }

    const adapters = new Map(catalog.adapters.map((adapter) => [adapter.id, adapter]));
    const models = new Map(catalog.models.map((model) => [model.id, model]));

    catalog.targets.forEach((target, index) => {
      const adapter = adapters.get(target.adapterId);
      const model = models.get(target.modelId);

      if (!adapter) {
        context.addIssue({
          code: "custom",
          path: ["targets", index, "adapterId"],
          message: `Unknown adapter: ${target.adapterId}`,
        });
      } else if (!adapter.modes.includes(target.mode)) {
        context.addIssue({
          code: "custom",
          path: ["targets", index, "mode"],
          message: `Adapter ${adapter.id} does not support ${target.mode}`,
        });
      }

      if (!model) {
        context.addIssue({
          code: "custom",
          path: ["targets", index, "modelId"],
          message: `Unknown model: ${target.modelId}`,
        });
      } else if (!model.modes.includes(target.mode)) {
        context.addIssue({
          code: "custom",
          path: ["targets", index, "mode"],
          message: `Model ${model.id} does not support ${target.mode}`,
        });
      }
    });
  });

const RelativeAudioPathSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !/^[a-zA-Z]:[\\/]/.test(value) &&
    !value.split(/[\\/]/).includes(".."),
  "Audio path must be relative and remain inside the corpus directory"
);

const RightsSchema = z.object({
  license: z.string().min(1),
  redistributable: z.boolean(),
  attribution: z.string().min(1).optional(),
  termsUrl: z.string().url().optional(),
});

const SourceSchema = z
  .object({
    kind: z.enum([
      "self-recorded",
      "web-reference",
      "public-dataset",
      "synthetic",
    ]),
    name: z.string().min(1),
    url: z.string().url().optional(),
    retrievedAt: z.string().datetime().optional(),
    datasetVersion: z.string().min(1).optional(),
    rights: RightsSchema,
  })
  .superRefine((source, context) => {
    if (
      (source.kind === "web-reference" || source.kind === "public-dataset") &&
      !source.url
    ) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `${source.kind} requires a source URL`,
      });
    }
    if (source.kind === "web-reference" && !source.retrievedAt) {
      context.addIssue({
        code: "custom",
        path: ["retrievedAt"],
        message: "web-reference requires a retrieval timestamp",
      });
    }
  });

const ExpectedValueSchema = z.object({
  id: InternalIdSchema,
  expected: z.string().min(1),
  alternatives: z.array(z.string().min(1)).default([]),
});

const CodeExpectationSchema = z.object({
  language: z.string().min(1),
  reference: z.string().min(1),
  tokens: z.array(ExpectedValueSchema).default([]),
});

export const CorpusItemSchema = z
  .object({
    id: InternalIdSchema,
    audio: z.object({
      path: RelativeAudioPathSchema,
      sha256: Sha256Schema,
      format: z.enum(["wav", "flac", "mp3", "m4a", "ogg", "webm"]),
      sampleRateHz: z.number().int().positive(),
      channels: z.number().int().min(1),
      durationMs: z.number().positive(),
    }),
    language: z.string().min(2),
    tags: z.array(InternalIdSchema),
    references: z.object({
      verbatim: z.string().min(1),
      alternatives: z.array(z.string().min(1)).default([]),
      formatted: z.string().min(1).optional(),
    }),
    expectations: z
      .object({
        numbers: z.array(ExpectedValueSchema).default([]),
        properNouns: z.array(ExpectedValueSchema).default([]),
        code: CodeExpectationSchema.optional(),
      })
      .default({ numbers: [], properNouns: [] }),
    source: SourceSchema,
    recording: z
      .object({
        device: z.string().min(1),
        environment: z.string().min(1),
        speakerId: InternalIdSchema,
      })
      .optional(),
    review: z.object({
      status: z.literal("verified"),
      reviewedBy: z.string().min(1),
      reviewedAt: z.string().datetime(),
    }),
  })
  .superRefine((item, context) => {
    if (item.source.kind === "self-recorded" && !item.recording) {
      context.addIssue({
        code: "custom",
        path: ["recording"],
        message: "self-recorded audio requires recording metadata",
      });
    }
  });

export const CorpusManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusVersion: z.string().min(1),
    status: z.enum(["draft", "published"]),
    items: z.array(CorpusItemSchema),
  })
  .superRefine((corpus, context) => {
    for (const id of duplicateIds(corpus.items)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: `Duplicate corpus item ID: ${id}`,
      });
    }
    if (corpus.status === "published" && corpus.items.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "A published corpus cannot be empty",
      });
    }
  });

export const MetricReferenceSchema = z.object({
  id: MetricIdSchema,
  version: z.string().min(1),
});

export const BenchmarkProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: InternalIdSchema,
  displayName: z.string().min(1),
  track: TrackSchema,
  mode: ExecutionModeSchema,
  corpusVersion: z.string().min(1),
  caseIds: z.array(InternalIdSchema).min(1),
  metrics: z.array(MetricReferenceSchema).min(1),
  trialsPerCase: z.number().int().min(1),
});

export const RunEnvironmentSchema = z.object({
  environmentId: InternalIdSchema,
  os: z.string().min(1),
  architecture: z.string().min(1),
  cpu: z.string().min(1).optional(),
  accelerator: z.string().min(1).optional(),
  memoryBytes: z.number().int().positive().optional(),
  region: z.string().min(1).optional(),
  runtimeVersions: z.record(z.string(), z.string().min(1)),
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: InternalIdSchema,
  planId: Sha256Schema,
  createdAt: z.string().datetime(),
  gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
  targetIds: z.array(InternalIdSchema).min(1),
  environment: RunEnvironmentSchema,
});

export const ResultEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: InternalIdSchema,
    planId: Sha256Schema,
    targetId: InternalIdSchema,
    caseId: InternalIdSchema,
    trial: z.number().int().min(1),
    status: z.enum(["ok", "error"]),
    transcript: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    firstTokenMs: z.number().nonnegative().optional(),
    error: z.string().min(1).optional(),
    providerMetadata: z.record(z.string(), JsonValueSchema).optional(),
  })
  .superRefine((result, context) => {
    if (result.status === "ok" && result.transcript === undefined) {
      context.addIssue({
        code: "custom",
        path: ["transcript"],
        message: "A successful result requires a transcript",
      });
    }
    if (result.status === "error" && !result.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "An error result requires an error message",
      });
    }
  });

export type AdapterDefinition = z.infer<typeof AdapterDefinitionSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type TargetDefinition = z.infer<typeof TargetDefinitionSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type CorpusItem = z.infer<typeof CorpusItemSchema>;
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;
export type BenchmarkProfile = z.infer<typeof BenchmarkProfileSchema>;
export type RunEnvironment = z.infer<typeof RunEnvironmentSchema>;
export type ResultEvent = z.infer<typeof ResultEventSchema>;
