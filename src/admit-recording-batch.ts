import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { contentDigest } from "./identity.js";
import {
  CorpusManifestSchema,
  RecordingBatchSchema,
  RecordingPlanSchema,
  type CorpusItem,
  type CorpusManifest,
} from "./schema.js";

const execFileAsync = promisify(execFile);
const AUDIO_FORMATS = new Set(["flac", "m4a", "mp3", "ogg", "wav", "webm"]);

export interface AudioMetadata {
  sampleRateHz: number;
  channels: number;
  durationMs: number;
}

export interface AdmissionOptions {
  workspaceRoot: string;
  storageRoot: string;
  batchId: string;
  reviewer: string;
  reviewedAt: string;
  device: string;
  environment: string;
}

interface AdmissionDependencies {
  probeAudio?: (path: string) => Promise<AudioMetadata>;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function probeAudio(path: string): Promise<AudioMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels:packet=pts_time,duration_time",
    "-show_streams",
    "-show_packets",
    "-of",
    "json",
    path,
  ]);
  const decoded = JSON.parse(stdout) as {
    streams?: Array<{ sample_rate?: string; channels?: number }>;
    packets?: Array<{ pts_time?: string; duration_time?: string }>;
  };
  const stream = decoded.streams?.[0];
  const lastPacket = decoded.packets?.at(-1);
  const sampleRateHz = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  const durationMs = Math.round(
    (Number(lastPacket?.pts_time) + Number(lastPacket?.duration_time)) * 1000
  );
  if (
    !Number.isInteger(sampleRateHz) ||
    sampleRateHz <= 0 ||
    !Number.isInteger(channels) ||
    channels <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new Error(`Cannot determine complete audio metadata for ${basename(path)}`);
  }
  return { sampleRateHz, channels, durationMs };
}

async function loadExistingManifest(corpusRoot: string): Promise<CorpusManifest> {
  try {
    return CorpusManifestSchema.parse(
      await readJson(resolve(corpusRoot, "manifest.json"))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      corpusVersion: "local-empty",
      status: "draft",
      items: [],
    };
  }
}

async function findSingleTake(
  inboxDirectory: string,
  fileBase: string
): Promise<string> {
  const pattern = new RegExp(
    `^${escapeRegExp(fileBase)}(?:-take-\\d{2})?\\.(flac|m4a|mp3|ogg|wav|webm)$`
  );
  const matches = (await readdir(inboxDirectory))
    .filter((file) => pattern.test(file))
    .sort();
  if (matches.length !== 1) {
    throw new Error(
      `${fileBase} requires exactly one approved take, found ${matches.length}`
    );
  }
  return resolve(inboxDirectory, matches[0]!);
}

async function copyImmutable(source: string, destination: string): Promise<void> {
  await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  try {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await sha256(source)) !== (await sha256(destination))) {
      throw new Error(`Admitted audio already exists with different bytes: ${destination}`);
    }
  }
  await chmod(destination, 0o600);
}

export async function admitRecordingBatch(
  options: AdmissionOptions,
  dependencies: AdmissionDependencies = {}
) {
  const workspaceRoot = resolve(options.workspaceRoot);
  const storageRoot = resolve(options.storageRoot);
  const corpusRoot = resolve(storageRoot, "corpus");
  const batch = RecordingBatchSchema.parse(
    await readJson(
      resolve(workspaceRoot, "corpus", "recording-batches", `${options.batchId}.json`)
    )
  );
  if (batch.id !== options.batchId) {
    throw new Error(`Batch file declares ${batch.id}, expected ${options.batchId}`);
  }
  const plan = RecordingPlanSchema.parse(
    await readJson(resolve(workspaceRoot, "corpus", "recording-plan.v1.json"))
  );
  const prompts = new Map(plan.prompts.map((prompt) => [prompt.id, prompt]));
  const inboxRoot = resolve(corpusRoot, "inbox");
  const inboxDirectory = resolve(storageRoot, batch.outputDirectory);
  if (!isInside(inboxRoot, inboxDirectory)) {
    throw new Error("Batch inbox directory escapes persistent corpus storage");
  }

  const inspectAudio = dependencies.probeAudio ?? probeAudio;
  const admittedItems: CorpusItem[] = [];
  for (const batchItem of batch.items) {
    const prompt = prompts.get(batchItem.promptId);
    if (!prompt) throw new Error(`Unknown prompt ${batchItem.promptId}`);
    const sourcePath = await findSingleTake(inboxDirectory, batchItem.fileBase);
    const format = extname(sourcePath).slice(1).toLowerCase();
    if (!AUDIO_FORMATS.has(format)) throw new Error(`Unsupported format: ${format}`);
    const metadata = await inspectAudio(sourcePath);
    const digest = await sha256(sourcePath);
    const relativeAudioPath = `audio/${batch.language}/${batch.id}/${prompt.id}.${format}`;
    const destination = resolve(corpusRoot, relativeAudioPath);
    if (!isInside(resolve(corpusRoot, "audio"), destination)) {
      throw new Error(`Audio destination escapes private corpus: ${relativeAudioPath}`);
    }
    await copyImmutable(sourcePath, destination);

    admittedItems.push({
      id: prompt.id,
      audio: {
        path: relativeAudioPath,
        sha256: digest,
        format: format as CorpusItem["audio"]["format"],
        ...metadata,
      },
      language: prompt.language,
      tags: [prompt.category, "self-recorded", batch.id],
      references: {
        verbatim: prompt.spokenText,
        alternatives: [],
        formatted: prompt.formattedReference,
      },
      expectations: prompt.expectations,
      source: {
        kind: "self-recorded",
        name: "TypeWhisper benchmark recording",
        rights: {
          license: "Project-owned",
          redistributable: false,
        },
      },
      recording: {
        device: options.device,
        environment: options.environment,
        speakerId: batch.speakerId,
      },
      review: {
        status: "verified",
        reviewedBy: options.reviewer,
        reviewedAt: options.reviewedAt,
      },
    });
  }

  const existing = await loadExistingManifest(corpusRoot);
  if (existing.status === "published") {
    throw new Error("Published local corpus manifests are immutable");
  }
  const replacedIds = new Set(admittedItems.map((item) => item.id));
  const items = [
    ...existing.items.filter((item) => !replacedIds.has(item.id)),
    ...admittedItems,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const corpusVersion = `local-${contentDigest({
    schemaVersion: 1,
    status: "draft",
    items,
  }).slice(0, 16)}`;
  const manifest = CorpusManifestSchema.parse({
    schemaVersion: 1,
    corpusVersion,
    status: "draft",
    items,
  });
  await mkdir(corpusRoot, { recursive: true, mode: 0o700 });
  const manifestPath = resolve(corpusRoot, "manifest.json");
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.part`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return {
    batchId: batch.id,
    corpusVersion,
    manifestPath,
    admittedCount: admittedItems.length,
    totalCount: manifest.items.length,
  };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const batchId = args[0];
  const storageRoot = optionValue(args, "--storage");
  const reviewer = optionValue(args, "--reviewer");
  const device = optionValue(args, "--device");
  const environment = optionValue(args, "--environment");
  if (!batchId || !storageRoot || !reviewer || !device || !environment) {
    throw new Error(
      "Usage: npm run admit:recordings -- <batch-id> --storage <path> --reviewer <id> --device <description> --environment <description>"
    );
  }
  const result = await admitRecordingBatch({
    workspaceRoot: process.cwd(),
    storageRoot,
    batchId,
    reviewer,
    device,
    environment,
    reviewedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
