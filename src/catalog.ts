import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  BenchmarkProfileSchema,
  CatalogSchema,
  CorpusManifestSchema,
  type BenchmarkProfile,
  type Catalog,
  type CorpusManifest,
} from "./schema.js";
import { contentDigest } from "./identity.js";

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read JSON from ${path}: ${message}`);
  }
}

async function digestFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function validateAudioFiles(
  workspaceRoot: string,
  corpus: CorpusManifest
): Promise<void> {
  const corpusRoot = resolve(workspaceRoot, "corpus");

  for (const item of corpus.items) {
    const audioPath = resolve(corpusRoot, item.audio.path);
    if (!audioPath.startsWith(`${corpusRoot}${sep}`)) {
      throw new Error(`Corpus item ${item.id} escapes the corpus directory`);
    }

    let actualDigest: string;
    try {
      actualDigest = await digestFile(audioPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read audio for corpus item ${item.id}: ${message}`);
    }

    if (actualDigest !== item.audio.sha256) {
      throw new Error(
        `Audio digest mismatch for ${item.id}: expected ${item.audio.sha256}, got ${actualDigest}`
      );
    }
  }
}

function validateProfileReferences(
  profiles: BenchmarkProfile[],
  corpus: CorpusManifest
): void {
  const caseIds = new Set(corpus.items.map((item) => item.id));
  const profileIds = new Set<string>();

  for (const profile of profiles) {
    if (profileIds.has(profile.id)) {
      throw new Error(`Duplicate profile ID: ${profile.id}`);
    }
    profileIds.add(profile.id);

    if (profile.corpusVersion !== corpus.corpusVersion) {
      throw new Error(
        `Profile ${profile.id} expects corpus ${profile.corpusVersion}, current corpus is ${corpus.corpusVersion}`
      );
    }

    for (const caseId of profile.caseIds) {
      if (!caseIds.has(caseId)) {
        throw new Error(`Profile ${profile.id} references unknown case ${caseId}`);
      }
    }
  }
}

export interface ValidatedWorkspace {
  root: string;
  catalog: Catalog;
  corpus: CorpusManifest;
  profiles: BenchmarkProfile[];
  catalogDigest: string;
  corpusDigest: string;
}

export async function loadWorkspace(
  workspaceRoot = process.cwd()
): Promise<ValidatedWorkspace> {
  const root = resolve(workspaceRoot);
  const catalog = CatalogSchema.parse(
    await readJson(resolve(root, "catalog", "catalog.json"))
  );
  const corpus = CorpusManifestSchema.parse(
    await readJson(resolve(root, "corpus", "manifest.json"))
  );

  const profilesDirectory = resolve(root, "profiles");
  const profileFiles = (await readdir(profilesDirectory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const profiles: BenchmarkProfile[] = [];
  for (const file of profileFiles) {
    profiles.push(
      BenchmarkProfileSchema.parse(await readJson(resolve(profilesDirectory, file)))
    );
  }

  validateProfileReferences(profiles, corpus);
  await validateAudioFiles(root, corpus);

  return {
    root,
    catalog,
    corpus,
    profiles,
    catalogDigest: contentDigest(catalog),
    corpusDigest: contentDigest(corpus),
  };
}
