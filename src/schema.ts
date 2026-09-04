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
  .max(128)
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

export const RightsSchema = z.object({
  license: z.string().min(1),
  redistributable: z.boolean(),
  attribution: z.string().min(1).optional(),
  termsUrl: z.string().url().optional(),
});

export const SourceSchema = z
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
    subset: z.string().min(1).optional(),
    split: z.string().min(1).optional(),
    sampleId: z.string().min(1).optional(),
    segment: z
      .object({
        startMs: z.number().nonnegative(),
        endMs: z.number().positive(),
      })
      .refine((segment) => segment.endMs > segment.startMs, {
        message: "Segment end must be after its start",
      })
      .optional(),
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
    if (source.kind === "public-dataset") {
      for (const field of [
        "datasetVersion",
        "subset",
        "split",
        "sampleId",
      ] as const) {
        if (!source[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `public-dataset requires ${field}`,
          });
        }
      }
    }
  });

export const ExpectedValueSchema = z.object({
  id: InternalIdSchema,
  expected: z.string().min(1),
  alternatives: z.array(z.string().min(1)).default([]),
});

export const CodeExpectationSchema = z.object({
  language: z.string().min(1),
  reference: z.string().min(1),
  tokens: z.array(ExpectedValueSchema).default([]),
});

export const EvaluationExpectationsSchema = z.object({
  numbers: z.array(ExpectedValueSchema).default([]),
  properNouns: z.array(ExpectedValueSchema).default([]),
  code: CodeExpectationSchema.optional(),
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
    expectations: EvaluationExpectationsSchema.default({
      numbers: [],
      properNouns: [],
    }),
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

export const RecordingCategorySchema = z.enum([
  "everyday-dictation",
  "formatting",
  "numbers",
  "proper-nouns",
  "code",
  "mixed-hard",
]);

export const RecordingPromptSchema = z.object({
  id: InternalIdSchema,
  language: z.string().min(2),
  category: RecordingCategorySchema,
  spokenText: z.string().min(1),
  formattedReference: z.string().min(1),
  expectations: EvaluationExpectationsSchema.default({
    numbers: [],
    properNouns: [],
  }),
  notes: z.array(z.string().min(1)).default([]),
});

export const RecordingCategoryTargetsSchema = z.object({
  "everyday-dictation": z.number().int().nonnegative(),
  formatting: z.number().int().nonnegative(),
  numbers: z.number().int().nonnegative(),
  "proper-nouns": z.number().int().nonnegative(),
  code: z.number().int().nonnegative(),
  "mixed-hard": z.number().int().nonnegative(),
});

export const RecordingLanguagePackSchema = z.object({
  language: z.string().min(2),
  tier: z.enum(["anchor", "coverage"]),
  selfRecordedTarget: z.number().int().positive(),
  webReferenceTarget: z.number().int().positive(),
  categoryTargets: RecordingCategoryTargetsSchema,
  nativeReviewRequired: z.literal(true),
});

export const RecordingPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: InternalIdSchema,
    status: z.enum(["draft", "ready"]),
    languagePacks: z.array(RecordingLanguagePackSchema).min(1),
    prompts: z.array(RecordingPromptSchema).min(1),
  })
  .superRefine((plan, context) => {
    for (const id of duplicateIds(plan.prompts)) {
      context.addIssue({
        code: "custom",
        path: ["prompts"],
        message: `Duplicate recording prompt ID: ${id}`,
      });
    }

    const packLanguages = new Set<string>();
    plan.languagePacks.forEach((pack, index) => {
      if (packLanguages.has(pack.language)) {
        context.addIssue({
          code: "custom",
          path: ["languagePacks", index, "language"],
          message: `Duplicate language pack: ${pack.language}`,
        });
      }
      packLanguages.add(pack.language);
    });

    for (const prompt of plan.prompts) {
      if (!packLanguages.has(prompt.language)) {
        context.addIssue({
          code: "custom",
          path: ["prompts"],
          message: `Prompt ${prompt.id} uses unknown language pack ${prompt.language}`,
        });
      }
    }

    for (const pack of plan.languagePacks) {
      const actual = plan.prompts.filter(
        (prompt) => prompt.language === pack.language
      ).length;
      if (actual !== pack.selfRecordedTarget) {
        context.addIssue({
          code: "custom",
          path: ["languagePacks"],
          message: `Language pack ${pack.language} declares ${pack.selfRecordedTarget} self-recorded prompts but contains ${actual}`,
        });
      }

      const declaredCategoryTotal = Object.values(pack.categoryTargets).reduce(
        (sum, count) => sum + count,
        0
      );
      if (declaredCategoryTotal !== pack.selfRecordedTarget) {
        context.addIssue({
          code: "custom",
          path: ["languagePacks"],
          message: `Language pack ${pack.language} category targets total ${declaredCategoryTotal}, expected ${pack.selfRecordedTarget}`,
        });
      }

      for (const category of RecordingCategorySchema.options) {
        const categoryActual = plan.prompts.filter(
          (prompt) =>
            prompt.language === pack.language && prompt.category === category
        ).length;
        const categoryTarget = pack.categoryTargets[category];
        if (categoryActual !== categoryTarget) {
          context.addIssue({
            code: "custom",
            path: ["languagePacks"],
            message: `Language pack ${pack.language} declares ${categoryTarget} ${category} prompts but contains ${categoryActual}`,
          });
        }
      }
    }
  });

const SafeFileBaseSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "File base may contain lowercase letters, numbers, dots, underscores, and hyphens"
  );

export const RecordingBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: InternalIdSchema,
    title: z.string().min(1),
    language: z.string().min(2),
    speakerId: InternalIdSchema,
    outputDirectory: RelativeAudioPathSchema,
    items: z
      .array(
        z.object({
          promptId: InternalIdSchema,
          fileBase: SafeFileBaseSchema,
        })
      )
      .min(1),
  })
  .superRefine((batch, context) => {
    const duplicatePromptIds = duplicateIds(
      batch.items.map((item) => ({ id: item.promptId }))
    );
    for (const id of duplicatePromptIds) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: `Duplicate batch prompt ID: ${id}`,
      });
    }

    const fileBases = new Set<string>();
    batch.items.forEach((item, index) => {
      if (fileBases.has(item.fileBase)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "fileBase"],
          message: `Duplicate batch file base: ${item.fileBase}`,
        });
      }
      fileBases.add(item.fileBase);
    });
  });

export const VisualizationTargetSchema = z.object({
  id: InternalIdSchema,
  displayName: z.string().min(1),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  revision: z.string().min(1),
});

export const VisualizationAggregateSchema = z
  .object({
    targetId: InternalIdSchema,
    language: z.string().min(2),
    metricId: MetricIdSchema,
    value: z.number().finite().nonnegative(),
    eligibleCases: z.number().int().nonnegative(),
    totalCases: z.number().int().positive(),
  })
  .refine((aggregate) => aggregate.eligibleCases <= aggregate.totalCases, {
    message: "Eligible cases cannot exceed total cases",
  });

export const VisualizationLatencySchema = z.object({
  targetId: InternalIdSchema,
  language: z.string().min(2),
  medianMs: z.number().finite().nonnegative(),
  p95Ms: z.number().finite().nonnegative().optional(),
});

export const VisualizationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: Sha256Schema,
    generatedAt: z.string().datetime(),
    profileId: InternalIdSchema,
    corpusVersion: z.string().min(1),
    scoringGitCommit: z.string().regex(/^[a-f0-9]{40}$/),
    caseCount: z.number().int().positive(),
    runIds: z.array(InternalIdSchema).min(1),
    languages: z.array(z.string().min(2)).min(1),
    targets: z.array(VisualizationTargetSchema).min(1),
    aggregates: z.array(VisualizationAggregateSchema).min(1),
    latency: z.array(VisualizationLatencySchema).default([]),
  })
  .superRefine((snapshot, context) => {
    for (const id of duplicateIds(snapshot.targets)) {
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: `Duplicate visualization target ID: ${id}`,
      });
    }

    const targetIds = new Set(snapshot.targets.map((target) => target.id));
    const languages = new Set(snapshot.languages);
    if (languages.size !== snapshot.languages.length) {
      context.addIssue({
        code: "custom",
        path: ["languages"],
        message: "Visualization languages must be unique",
      });
    }
    if (new Set(snapshot.runIds).size !== snapshot.runIds.length) {
      context.addIssue({
        code: "custom",
        path: ["runIds"],
        message: "Visualization run IDs must be unique",
      });
    }
    const aggregateKeys = new Set<string>();
    snapshot.aggregates.forEach((aggregate, index) => {
      if (!targetIds.has(aggregate.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["aggregates", index, "targetId"],
          message: `Unknown visualization target: ${aggregate.targetId}`,
        });
      }
      if (!languages.has(aggregate.language)) {
        context.addIssue({
          code: "custom",
          path: ["aggregates", index, "language"],
          message: `Unknown visualization language: ${aggregate.language}`,
        });
      }
      if (
        !["wer", "cer"].includes(aggregate.metricId) &&
        aggregate.value > 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["aggregates", index, "value"],
          message: `${aggregate.metricId} scores must be between 0 and 1`,
        });
      }
      const key = `${aggregate.targetId}:${aggregate.language}:${aggregate.metricId}`;
      if (aggregateKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["aggregates", index],
          message: `Duplicate visualization aggregate: ${key}`,
        });
      }
      aggregateKeys.add(key);
    });

    const latencyKeys = new Set<string>();
    snapshot.latency.forEach((latency, index) => {
      if (!targetIds.has(latency.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["latency", index, "targetId"],
          message: `Unknown latency target: ${latency.targetId}`,
        });
      }
      if (!languages.has(latency.language)) {
        context.addIssue({
          code: "custom",
          path: ["latency", index, "language"],
          message: `Unknown latency language: ${latency.language}`,
        });
      }
      if (latency.p95Ms !== undefined && latency.p95Ms < latency.medianMs) {
        context.addIssue({
          code: "custom",
          path: ["latency", index, "p95Ms"],
          message: "P95 latency cannot be lower than median latency",
        });
      }
      const key = `${latency.targetId}:${latency.language}`;
      if (latencyKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["latency", index],
          message: `Duplicate visualization latency: ${key}`,
        });
      }
      latencyKeys.add(key);
    });
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
  runKitDigest: Sha256Schema,
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

export const ExternalRunBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifest: RunManifestSchema,
    results: z.array(ResultEventSchema).min(1),
  })
  .superRefine((bundle, context) => {
    const targetIds = new Set(bundle.manifest.targetIds);
    if (targetIds.size !== bundle.manifest.targetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "targetIds"],
        message: "Manifest target IDs must be unique",
      });
    }
    const resultKeys = new Set<string>();

    bundle.results.forEach((result, index) => {
      if (result.runId !== bundle.manifest.runId) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "runId"],
          message: `Result run ${result.runId} does not match manifest run ${bundle.manifest.runId}`,
        });
      }
      if (result.planId !== bundle.manifest.planId) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "planId"],
          message: "Result plan does not match manifest plan",
        });
      }
      if (!targetIds.has(result.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "targetId"],
          message: `Result target ${result.targetId} is absent from the manifest`,
        });
      }

      const key = `${result.targetId}:${result.caseId}:${result.trial}`;
      if (resultKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["results", index],
          message: `Duplicate result event: ${key}`,
        });
      }
      resultKeys.add(key);
    });

    for (const targetId of targetIds) {
      if (!bundle.results.some((result) => result.targetId === targetId)) {
        context.addIssue({
          code: "custom",
          path: ["results"],
          message: `Manifest target ${targetId} has no result events`,
        });
      }
    }
  });

export const RunKitTaskSchema = z.object({
  caseId: InternalIdSchema,
  trial: z.number().int().min(1),
  language: z.string().min(2),
  audio: z.object({
    path: RelativeAudioPathSchema,
    sha256: Sha256Schema,
  }),
});

export const RunKitSchema = z
  .object({
    schemaVersion: z.literal(1),
    runnerProtocol: z.literal("typewhisper-http-v1"),
    kitDigest: Sha256Schema,
    planId: Sha256Schema,
    profileId: InternalIdSchema,
    corpusVersion: z.string().min(1),
    gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
    targetId: InternalIdSchema,
    execution: z.object({
      engine: z.string().min(1),
      model: z.string().min(1),
      awaitDownload: z.boolean().default(false),
      applyCorrections: z.literal(false),
      normalizeNumbers: z.literal(false),
      useSelectedModel: z.boolean().default(false),
      warmup: z.boolean().default(true),
      expectedDictionaryTermsSha256: Sha256Schema.optional(),
      requireNoDictionaryTerms: z.boolean().default(false),
      requireNoCorrections: z.boolean().default(false),
      requiredActiveBackend: z.string().min(1).optional(),
    }),
    tasks: z.array(RunKitTaskSchema).min(1),
  })
  .superRefine((kit, context) => {
    const keys = new Set<string>();
    kit.tasks.forEach((task, index) => {
      const key = `${task.caseId}:${task.trial}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index],
          message: `Duplicate run-kit task: ${key}`,
        });
      }
      keys.add(key);
    });
  });

export type AdapterDefinition = z.infer<typeof AdapterDefinitionSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type TargetDefinition = z.infer<typeof TargetDefinitionSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type CorpusItem = z.infer<typeof CorpusItemSchema>;
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;
export type RecordingPrompt = z.infer<typeof RecordingPromptSchema>;
export type RecordingPlan = z.infer<typeof RecordingPlanSchema>;
export type RecordingBatch = z.infer<typeof RecordingBatchSchema>;
export type VisualizationSnapshot = z.infer<typeof VisualizationSnapshotSchema>;
export type BenchmarkProfile = z.infer<typeof BenchmarkProfileSchema>;
export type RunEnvironment = z.infer<typeof RunEnvironmentSchema>;
export type ResultEvent = z.infer<typeof ResultEventSchema>;
export type ExternalRunBundle = z.infer<typeof ExternalRunBundleSchema>;
export type RunKit = z.infer<typeof RunKitSchema>;
