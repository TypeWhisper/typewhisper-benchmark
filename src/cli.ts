import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspace } from "./catalog.js";
import { buildExecutionPlan } from "./plan.js";

function usage(): void {
  console.log(`TypeWhisper Benchmark V2

Usage:
  npm run benchmark -- validate [workspace]
  npm run benchmark -- plan <profile-id> [target-id ...]

Execution is intentionally unavailable until the corpus and metric contracts
have been reviewed.`);
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

  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
