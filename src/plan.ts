import { contentDigest } from "./identity.js";
import type {
  BenchmarkProfile,
  Catalog,
  CorpusItem,
  CorpusManifest,
  TargetDefinition,
} from "./schema.js";

export interface PlanTask {
  targetId: string;
  caseId: string;
  trial: number;
}

export interface ExecutionPlan {
  schemaVersion: 1;
  planId: string;
  profileId: string;
  targetIds: string[];
  tasks: PlanTask[];
}

function supportsLanguage(languages: "*" | string[], language: string): boolean {
  return languages === "*" || languages.includes(language);
}

function selectCases(
  profile: BenchmarkProfile,
  corpus: CorpusManifest
): CorpusItem[] {
  if (profile.corpusVersion !== corpus.corpusVersion) {
    throw new Error(
      `Profile ${profile.id} expects corpus ${profile.corpusVersion}, current corpus is ${corpus.corpusVersion}`
    );
  }

  const items = new Map(corpus.items.map((item) => [item.id, item]));
  return profile.caseIds.map((caseId) => {
    const item = items.get(caseId);
    if (!item) throw new Error(`Profile ${profile.id} references unknown case ${caseId}`);
    return item;
  });
}

function selectTargets(
  catalog: Catalog,
  profile: BenchmarkProfile,
  cases: CorpusItem[],
  requestedTargetIds?: string[]
): TargetDefinition[] {
  const allTargets = new Map(catalog.targets.map((target) => [target.id, target]));
  const candidates = requestedTargetIds
    ? requestedTargetIds.map((targetId) => {
        const target = allTargets.get(targetId);
        if (!target) throw new Error(`Unknown target: ${targetId}`);
        return target;
      })
    : catalog.targets.filter((target) => target.mode === profile.mode);

  if (candidates.length === 0) {
    throw new Error(`No targets selected for profile ${profile.id}`);
  }

  const models = new Map(catalog.models.map((model) => [model.id, model]));
  for (const target of candidates) {
    if (target.mode !== profile.mode) {
      throw new Error(
        `Target ${target.id} uses ${target.mode}, profile ${profile.id} requires ${profile.mode}`
      );
    }
    const model = models.get(target.modelId);
    if (!model) throw new Error(`Target ${target.id} references unknown model ${target.modelId}`);

    const unsupported = [...new Set(cases.map((item) => item.language))].filter(
      (language) => !supportsLanguage(model.languages, language)
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Target ${target.id} does not support required languages: ${unsupported.join(", ")}`
      );
    }
  }

  return candidates;
}

export function buildExecutionPlan(options: {
  catalog: Catalog;
  corpus: CorpusManifest;
  profile: BenchmarkProfile;
  targetIds?: string[];
}): ExecutionPlan {
  const cases = selectCases(options.profile, options.corpus);
  const targets = selectTargets(
    options.catalog,
    options.profile,
    cases,
    options.targetIds
  );
  const adapters = new Map(
    options.catalog.adapters.map((adapter) => [adapter.id, adapter])
  );
  const models = new Map(options.catalog.models.map((model) => [model.id, model]));

  const identity = {
    schemaVersion: 1,
    profile: options.profile,
    cases,
    targets: targets.map((target) => ({
      target,
      adapter: adapters.get(target.adapterId),
      model: models.get(target.modelId),
    })),
  };

  const tasks: PlanTask[] = [];
  for (const target of targets) {
    for (const item of cases) {
      for (let trial = 1; trial <= options.profile.trialsPerCase; trial++) {
        tasks.push({ targetId: target.id, caseId: item.id, trial });
      }
    }
  }

  return {
    schemaVersion: 1,
    planId: contentDigest(identity),
    profileId: options.profile.id,
    targetIds: targets.map((target) => target.id),
    tasks,
  };
}
