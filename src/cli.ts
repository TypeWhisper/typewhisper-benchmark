import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { loadWorkspace } from "./catalog.js";
import { buildExecutionPlan } from "./plan.js";
import { prepareTypeWhisperRunKit } from "./run-kit.js";
import { createVisualizationSnapshot } from "./scoring.js";
import {
  BenchmarkProfileSchema,
  CatalogSchema,
  CorpusManifestSchema,
  ExternalRunBundleSchema,
  RunKitSchema,
} from "./schema.js";

const execFileAsync = promisify(execFile);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function exactGitCommit(): Promise<string> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"]),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  if (status.trim() !== "") {
    throw new Error("Refusing to prepare a run kit from an uncommitted worktree");
  }
  return commit.trim();
}

function usage(): void {
  console.log(`TypeWhisper Benchmark V2

Usage:
  npm run benchmark -- validate [workspace]
  npm run benchmark -- plan <profile-id> [target-id ...]
  npm run benchmark -- prepare-kit <catalog.json> <corpus.json> <profile.json> <target-id> <output-dir> [corpus-root]
  npm run benchmark -- score <catalog.json> <corpus.json> <profile.json> <output.json> <kit.json> <bundle.json> [<kit.json> <bundle.json> ...]`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "validate") {
    const workspace = await loadWorkspace(resolve(rest[0] ?? process.cwd()));
    console.log("Benchmark workspace is valid.");
    console.log(`  adapters: ${workspace.catalog.adapters.length}`);
    console.log(`  models:   ${workspace.catalog.models.length}`);
    console.log(`  targets:  ${workspace.catalog.targets.length}`);
    console.log(`  cases:    ${workspace.corpus.items.length}`);
    console.log(`  prompts:  ${workspace.recordingPlan.prompts.length}`);
    console.log(`  batches:  ${workspace.recordingBatches.length}`);
    console.log(`  profiles: ${workspace.profiles.length}`);
    console.log(`  catalog:  ${workspace.catalogDigest}`);
    console.log(`  corpus:   ${workspace.corpusDigest}`);
    console.log(`  rec-plan: ${workspace.recordingPlanDigest}`);
    return;
  }

  if (command === "plan") {
    const [profileId, ...targetIds] = rest;
    if (!profileId) throw new Error("plan requires a profile ID");

    const workspace = await loadWorkspace();
    const profile = workspace.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);

    const plan = buildExecutionPlan({
      catalog: workspace.catalog,
      corpus: workspace.corpus,
      profile,
      ...(targetIds.length > 0 ? { targetIds } : {}),
    });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === "prepare-kit") {
    const [catalogPath, corpusPath, profilePath, targetId, outputDirectory, corpusRoot] = rest;
    if (!catalogPath || !corpusPath || !profilePath || !targetId || !outputDirectory) {
      throw new Error("prepare-kit requires catalog, corpus, profile, target, and output paths");
    }
    const catalog = CatalogSchema.parse(await readJson(catalogPath));
    const corpus = CorpusManifestSchema.parse(await readJson(corpusPath));
    const profile = BenchmarkProfileSchema.parse(await readJson(profilePath));
    const prepared = await prepareTypeWhisperRunKit({
      catalog,
      corpus,
      profile,
      targetId,
      gitCommit: await exactGitCommit(),
      outputDirectory,
      corpusRoot: resolve(corpusRoot ?? dirname(resolve(corpusPath))),
    });
    console.log(`Prepared ${prepared.kit.tasks.length} tasks.`);
    console.log(`  plan: ${prepared.kit.planId}`);
    console.log(`  kit:  ${prepared.kit.kitDigest}`);
    console.log(`  path: ${prepared.manifestPath}`);
    return;
  }

  if (command === "score") {
    const [catalogPath, corpusPath, profilePath, outputPath, ...runPaths] = rest;
    if (!catalogPath || !corpusPath || !profilePath || !outputPath || runPaths.length === 0) {
      throw new Error("score requires catalog, corpus, profile, output, and run-kit/bundle pairs");
    }
    if (runPaths.length % 2 !== 0) {
      throw new Error("score expects each run kit followed by its bundle");
    }
    const catalog = CatalogSchema.parse(await readJson(catalogPath));
    const corpus = CorpusManifestSchema.parse(await readJson(corpusPath));
    const profile = BenchmarkProfileSchema.parse(await readJson(profilePath));
    const runs = [];
    for (let index = 0; index < runPaths.length; index += 2) {
      runs.push({
        kit: RunKitSchema.parse(await readJson(runPaths[index]!)),
        bundle: ExternalRunBundleSchema.parse(await readJson(runPaths[index + 1]!)),
      });
    }
    const snapshot = createVisualizationSnapshot({
      catalog,
      corpus,
      profile,
      runs,
      scoringGitCommit: await exactGitCommit(),
    });
    await writeFile(resolve(outputPath), `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`Scored ${snapshot.runIds.length} reviewed run(s).`);
    console.log(`  snapshot: ${snapshot.snapshotId}`);
    console.log(`  path:     ${resolve(outputPath)}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
