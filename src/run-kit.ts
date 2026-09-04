import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecutionPlan } from "./plan.js";
import { contentDigest } from "./identity.js";
import {
  RunKitSchema,
  type BenchmarkProfile,
  type Catalog,
  type CorpusManifest,
  type RunKit,
} from "./schema.js";

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function ensureEmptyDirectory(path: string): Promise<void> {
  try {
    const existing = await readdir(path);
    if (existing.length > 0) {
      throw new Error(`Run-kit output directory is not empty: ${path}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function stringParameter(
  parameters: Record<string, unknown>,
  name: string
): string {
  const value = parameters[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Target parameter ${name} must be a non-empty string`);
  }
  return value;
}

function booleanParameter(
  parameters: Record<string, unknown>,
  name: string,
  fallback: boolean
): boolean {
  const value = parameters[name];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`Target parameter ${name} must be a boolean`);
  }
  return value;
}

export function runKitDigest(kit: Omit<RunKit, "kitDigest">): string {
  return contentDigest(kit);
}

export async function prepareTypeWhisperRunKit(options: {
  catalog: Catalog;
  corpus: CorpusManifest;
  corpusRoot: string;
  profile: BenchmarkProfile;
  targetId: string;
  gitCommit: string;
  outputDirectory: string;
  runnerSource?: string;
}): Promise<{ kit: RunKit; manifestPath: string }> {
  const target = options.catalog.targets.find(
    (candidate) => candidate.id === options.targetId
  );
  if (!target) throw new Error(`Unknown target: ${options.targetId}`);
  if (target.adapterId !== "typewhisper-http") {
    throw new Error(
      `Target ${target.id} uses ${target.adapterId}; prepare-kit currently supports typewhisper-http`
    );
  }

  const plan = buildExecutionPlan({
    catalog: options.catalog,
    corpus: options.corpus,
    profile: options.profile,
    targetIds: [target.id],
  });
  const outputDirectory = resolve(options.outputDirectory);
  const audioDirectory = resolve(outputDirectory, "audio");
  await ensureEmptyDirectory(outputDirectory);
  await mkdir(audioDirectory, { recursive: true, mode: 0o700 });

  const items = new Map(options.corpus.items.map((item) => [item.id, item]));
  const converted = new Map<string, { path: string; sha256: string }>();

  for (const caseId of options.profile.caseIds) {
    const item = items.get(caseId);
    if (!item) throw new Error(`Profile references unknown case ${caseId}`);
    const source = resolve(options.corpusRoot, item.audio.path);
    const corpusRoot = resolve(options.corpusRoot);
    if (!source.startsWith(`${corpusRoot}${sep}`)) {
      throw new Error(`Audio for ${caseId} escapes the corpus root`);
    }
    if ((await sha256(source)) !== item.audio.sha256) {
      throw new Error(`Source audio digest mismatch for ${caseId}`);
    }

    const relativePath = `audio/${caseId}.wav`;
    const destination = resolve(outputDirectory, relativePath);
    await run("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-map_metadata",
      "-1",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      destination,
    ]);
    await chmod(destination, 0o600);
    converted.set(caseId, { path: relativePath, sha256: await sha256(destination) });
  }

  const kitContent = {
    schemaVersion: 1,
    runnerProtocol: "typewhisper-http-v1",
    planId: plan.planId,
    profileId: options.profile.id,
    corpusVersion: options.corpus.corpusVersion,
    gitCommit: options.gitCommit,
    targetId: target.id,
    execution: {
      engine: stringParameter(target.parameters, "typewhisperEngine"),
      model: stringParameter(target.parameters, "typewhisperModel"),
      awaitDownload: booleanParameter(target.parameters, "awaitDownload", false),
      applyCorrections: false,
      normalizeNumbers: false,
    },
    tasks: plan.tasks.map((task) => {
      const item = items.get(task.caseId)!;
      const audio = converted.get(task.caseId)!;
      return {
        caseId: task.caseId,
        trial: task.trial,
        language: item.language,
        audio,
      };
    }),
  } as const;
  const kit = RunKitSchema.parse({
    ...kitContent,
    kitDigest: runKitDigest(kitContent),
  });

  const manifestPath = resolve(outputDirectory, "run-kit.json");
  await writeFile(manifestPath, `${JSON.stringify(kit, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  const defaultRunnerSource = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../portable/typewhisper-runner.py"
  );
  const runnerDestination = resolve(outputDirectory, "typewhisper-runner.py");
  await copyFile(options.runnerSource ?? defaultRunnerSource, runnerDestination);
  await chmod(runnerDestination, 0o700);

  const outputStat = await stat(outputDirectory);
  if ((outputStat.mode & 0o077) !== 0) {
    throw new Error(`Run-kit directory must not be group/world accessible: ${outputDirectory}`);
  }

  return { kit, manifestPath };
}
