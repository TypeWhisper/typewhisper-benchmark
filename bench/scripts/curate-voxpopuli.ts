import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

const LANGS = ["de", "en"] as const;
const TARGET = 20;

interface RawVoxPopuliEntry {
  id: string;
  sourcePath: string;
  groundTruth: string;
  speakerId: string;
  durationSeconds: number;
  split: string;
}

interface CuratedVoxPopuliEntry {
  id: string;
  audioFile: string;
  groundTruth: string;
  speakerId: string;
  tags: string[];
}

function convertToWav(inputPath: string, outputPath: string): boolean {
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 "${outputPath}" -loglevel error`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

function selectDiverse(entries: RawVoxPopuliEntry[]): RawVoxPopuliEntry[] {
  const groups = new Map<string, RawVoxPopuliEntry[]>();

  for (const entry of entries) {
    const bucket = groups.get(entry.speakerId) ?? [];
    bucket.push(entry);
    groups.set(entry.speakerId, bucket);
  }

  for (const bucket of groups.values()) {
    bucket.sort((left, right) => {
      if (left.durationSeconds !== right.durationSeconds) {
        return left.durationSeconds - right.durationSeconds;
      }
      return left.id.localeCompare(right.id);
    });
  }

  const speakers = [...groups.keys()].sort();
  const selected: RawVoxPopuliEntry[] = [];
  const used = new Map<string, number>();
  let index = 0;

  while (selected.length < TARGET && speakers.length > 0) {
    const speakerId = speakers[index % speakers.length];
    const bucket = groups.get(speakerId) ?? [];
    const offset = used.get(speakerId) ?? 0;

    if (offset < bucket.length) {
      selected.push(bucket[offset]);
      used.set(speakerId, offset + 1);
    }

    if (offset + 1 >= bucket.length) {
      speakers.splice(speakers.indexOf(speakerId), 1);
      if (speakers.length === 0) break;
      index %= speakers.length;
    } else {
      index++;
    }
  }

  return selected;
}

async function curateLanguage(lang: (typeof LANGS)[number]): Promise<void> {
  const datasetDir = join(BENCH_ROOT, "audio", "datasets", `voxpopuli-${lang}`);
  const manifestPath = join(datasetDir, "manifest.ndjson");
  if (!existsSync(manifestPath)) {
    console.log(`Manifest missing for ${lang.toUpperCase()}: ${manifestPath}`);
    return;
  }

  const lines = (await readFile(manifestPath, "utf-8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = lines
    .map((line) => JSON.parse(line) as RawVoxPopuliEntry)
    .filter((entry) => {
      const words = entry.groundTruth.split(/\s+/).length;
      return (
        entry.durationSeconds >= 30 &&
        entry.durationSeconds <= 90 &&
        words >= 20 &&
        words <= 140 &&
        !!entry.speakerId
      );
    })
    .sort((left, right) => {
      if (left.split !== right.split) return left.split.localeCompare(right.split);
      return left.id.localeCompare(right.id);
    });

  const selected = selectDiverse(entries);
  const outputDir = join(BENCH_ROOT, "audio", `samples-longform-${lang}`);
  mkdirSync(outputDir, { recursive: true });

  const curated: CuratedVoxPopuliEntry[] = [];

  for (const entry of selected) {
    const inputPath = resolve(BENCH_ROOT, entry.sourcePath);
    const outputPath = join(outputDir, `${entry.id}.wav`);
    if (!existsSync(inputPath)) continue;
    if (!existsSync(outputPath) && !convertToWav(inputPath, outputPath)) continue;

    curated.push({
      id: entry.id,
      audioFile: `samples-longform-${lang}/${entry.id}.wav`,
      groundTruth: entry.groundTruth,
      speakerId: entry.speakerId,
      tags: ["long-form", "public-speech", `split:${entry.split}`],
    });
  }

  const outPath = join(datasetDir, "curated.json");
  await writeFile(outPath, JSON.stringify(curated, null, 2) + "\n", "utf-8");
  console.log(`Written ${curated.length} curated ${lang.toUpperCase()} entries to ${outPath}`);
}

async function main(): Promise<void> {
  for (const lang of LANGS) {
    await curateLanguage(lang);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
