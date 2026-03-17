import { readFile, writeFile, readdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type {
  BenchmarkTier,
  TestCase,
  TestCaseMetadata,
  TestSuite,
} from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

const CLEAN_TARGET = 25;
const ACCENT_TARGET = 25;
const LONGFORM_TARGET = 20;

function toLangLabel(lang: string): string {
  if (lang === "de") return "German";
  if (lang === "en") return "English";
  return "Auto";
}

function safeReadJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function buildSuite(options: {
  id: string;
  name: string;
  description: string;
  language: string;
  category: TestSuite["category"];
  benchmarkTier: BenchmarkTier;
  tests: TestCase[];
}): TestSuite {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    language: options.language,
    category: options.category,
    benchmarkTier: options.benchmarkTier,
    tests: options.tests,
  };
}

async function writeSuiteFile(suite: TestSuite): Promise<void> {
  const outPath = join(BENCH_ROOT, "tests", `${suite.id}.json`);
  await writeFile(outPath, JSON.stringify(suite, null, 2) + "\n", "utf-8");
  console.log(`Written ${suite.tests.length} tests to ${outPath}`);
}

function convertToWav(inputPath: string, wavPath: string): boolean {
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 "${wavPath}" -loglevel error`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

async function ensureWav(
  inputPath: string,
  wavPath: string
): Promise<boolean> {
  if (existsSync(wavPath)) return true;
  return convertToWav(inputPath, wavPath);
}

interface CommonVoiceEntry {
  clientId: string;
  path: string;
  sentence: string;
  upVotes: number;
  downVotes: number;
}

function parseTabular(content: string): Array<Record<string, string>> {
  const lines = content.trim().split("\n");
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return Object.fromEntries(
      header.map((column, index) => [column, cols[index] || ""])
    );
  });
}

function pickRoundRobin<T>(
  entries: T[],
  target: number,
  getBucket: (entry: T) => string
): T[] {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const key = getBucket(entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }

  const selected: T[] = [];
  const keys = [...groups.keys()].sort();
  const usedPerBucket = new Map<string, number>();
  let index = 0;

  while (selected.length < target && keys.length > 0) {
    const key = keys[index % keys.length];
    const used = usedPerBucket.get(key) ?? 0;
    const bucket = groups.get(key) ?? [];

    if (used < bucket.length) {
      selected.push(bucket[used]);
      usedPerBucket.set(key, used + 1);
    }

    if (used + 1 >= bucket.length) {
      const keyIndex = keys.indexOf(key);
      keys.splice(keyIndex, 1);
      if (keys.length === 0) break;
      index %= keys.length;
    } else {
      index++;
    }
  }

  return selected;
}

async function generateLibriSpeechSuite(): Promise<TestSuite | null> {
  const audioDir = join(BENCH_ROOT, "audio", "librispeech");
  if (!existsSync(audioDir)) {
    console.log(
      "LibriSpeech not found. Run: bash bench/scripts/download-librispeech.sh"
    );
    return null;
  }

  const candidates: TestCase[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
        continue;
      }

      if (!entry.name.endsWith(".trans.txt")) continue;

      const content = await readFile(fullPath, "utf-8");
      const lines = content
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();

      for (const line of lines) {
        const separator = line.indexOf(" ");
        if (separator === -1) continue;

        const uttId = line.slice(0, separator);
        const text = line.slice(separator + 1).trim();
        if (!text) continue;

        const wavFile = join(dir, `${uttId}.wav`).replace(
          `${BENCH_ROOT}/audio/`,
          ""
        );

        candidates.push({
          id: `librispeech-${uttId}`,
          audioFile: wavFile,
          groundTruth: text,
          tags: ["clean", "read-speech"],
          source: "librispeech",
        });
      }
    }
  }

  await scanDir(audioDir);
  if (candidates.length === 0) {
    console.log("No LibriSpeech transcripts found.");
    return null;
  }

  const tests = candidates
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, CLEAN_TARGET);

  return buildSuite({
    id: "clean-speech-en",
    name: "Clean Speech (English)",
    description: "LibriSpeech test-clean: clear read speech, single speaker",
    language: "en",
    category: "clean-speech",
    benchmarkTier: "core",
    tests,
  });
}

async function generateCommonVoiceSuite(): Promise<TestSuite | null> {
  const audioDir = join(BENCH_ROOT, "audio", "common-voice");
  const tsvPath = join(audioDir, "validated.tsv");

  if (!existsSync(tsvPath)) {
    console.log(
      "Common Voice not found. Run: bash bench/scripts/download-common-voice.sh"
    );
    return null;
  }

  const rows = parseTabular(await readFile(tsvPath, "utf-8"));
  const entries: CommonVoiceEntry[] = rows
    .map((row) => ({
      clientId: row.client_id || row.speaker_id || "unknown",
      path: row.path || "",
      sentence: (row.sentence || "").trim(),
      upVotes: parseInt(row.up_votes || "0", 10),
      downVotes: parseInt(row.down_votes || "0", 10),
    }))
    .filter(
      (entry) =>
        entry.path &&
        entry.sentence &&
        entry.sentence.length >= 25 &&
        entry.sentence.length <= 180
    )
    .sort((left, right) => {
      if (right.upVotes !== left.upVotes) return right.upVotes - left.upVotes;
      if (left.downVotes !== right.downVotes) return left.downVotes - right.downVotes;
      if (left.sentence.length !== right.sentence.length) {
        return left.sentence.length - right.sentence.length;
      }
      return left.path.localeCompare(right.path);
    });

  const selected = pickRoundRobin(entries, CLEAN_TARGET, (entry) => entry.clientId);
  const tests: TestCase[] = [];

  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    const mp3Path = join(audioDir, "clips", entry.path);
    const wavFilename = entry.path.replace(/\.mp3$/i, ".wav");
    const wavPath = join(audioDir, "clips", wavFilename);

    if (!existsSync(mp3Path)) continue;
    if (!(await ensureWav(mp3Path, wavPath))) continue;

    tests.push({
      id: `cv-de-${String(index + 1).padStart(2, "0")}`,
      audioFile: join("common-voice", "clips", wavFilename),
      groundTruth: entry.sentence,
      tags: ["clean", "read-speech"],
      source: "common-voice",
      metadata: { speaker: entry.clientId },
    });
  }

  if (tests.length === 0) {
    console.log("No Common Voice entries could be curated.");
    return null;
  }

  return buildSuite({
    id: "clean-speech-de",
    name: "Clean Speech (German)",
    description: "Mozilla Common Voice: curated read speech from diverse speakers",
    language: "de",
    category: "clean-speech",
    benchmarkTier: "core",
    tests,
  });
}

interface SPSEntry {
  audioFile: string;
  transcription: string;
  durationMs: number;
  votes: number;
  prompt: string;
}

function parseSPSTsv(content: string): SPSEntry[] {
  return parseTabular(content)
    .map((row) => ({
      audioFile: row.audio_file || "",
      transcription: (row.transcription || "").trim(),
      durationMs: parseInt(row.duration_ms || "0", 10),
      votes: parseInt(row.votes || "0", 10),
      prompt: (row.prompt || "").trim(),
    }))
    .filter((entry) => !!entry.audioFile && !!entry.transcription);
}

async function generateAccentedSpeechSuite(
  lang: "en" | "de"
): Promise<TestSuite | null> {
  const datasetDir = join(BENCH_ROOT, "audio", "datasets", `common-voice-${lang}`);
  const tsvPath = join(datasetDir, `ss-corpus-${lang}.tsv`);

  if (!existsSync(tsvPath)) {
    console.log(
      `Spontaneous Speech ${lang.toUpperCase()} not found at ${datasetDir}`
    );
    return null;
  }

  console.log(`Processing Spontaneous Speech ${lang.toUpperCase()}...`);
  const entries = parseSPSTsv(await readFile(tsvPath, "utf-8"))
    .filter(
      (entry) =>
        entry.votes >= 0 &&
        entry.transcription.length > 10 &&
        entry.durationMs >= 3000 &&
        entry.durationMs <= 30000
    )
    .sort((left, right) => {
      if (right.votes !== left.votes) return right.votes - left.votes;
      if (left.durationMs !== right.durationMs) {
        return left.durationMs - right.durationMs;
      }
      return left.audioFile.localeCompare(right.audioFile);
    });

  const selected = pickRoundRobin(entries, ACCENT_TARGET, (entry) => entry.prompt || entry.audioFile);
  const audioOutDir = join(BENCH_ROOT, "audio", `samples-accent-${lang}`);
  mkdirSync(audioOutDir, { recursive: true });

  const tests: TestCase[] = [];

  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    const sampleNum = String(index + 1).padStart(2, "0");
    const mp3Path = join(datasetDir, "audios", entry.audioFile);
    const wavFilename = `${lang}-accent-${sampleNum}.wav`;
    const wavPath = join(audioOutDir, wavFilename);

    if (!existsSync(mp3Path)) continue;
    if (!(await ensureWav(mp3Path, wavPath))) continue;

    tests.push({
      id: `${lang}-accent-${sampleNum}`,
      audioFile: `samples-accent-${lang}/${wavFilename}`,
      groundTruth: entry.transcription,
      tags: ["spontaneous-speech", "common-voice"],
      source: "common-voice",
      metadata: {
        speaker: entry.prompt ? `prompt:${entry.prompt.slice(0, 60)}` : undefined,
      },
    });
  }

  if (tests.length === 0) return null;

  return buildSuite({
    id: `accented-speech-${lang}`,
    name: `Accented Speech (${toLangLabel(lang)})`,
    description:
      "Spontaneous speech from diverse speakers (Common Voice Spontaneous Speech corpus)",
    language: lang,
    category: "accented-speech",
    benchmarkTier: "core",
    tests,
  });
}

interface ManifestCodeSwitchingEntry {
  id: string;
  segments: Array<{ text: string; voice: string; lang: string }>;
  groundTruth: string;
  tags: string[];
}

interface ManifestPunctuationEntry {
  id: string;
  text: string;
  formattedGroundTruth: string;
  tags: string[];
  voice: string;
}

interface ManifestNumberEntry {
  id: string;
  text: string;
  groundTruth: string;
  alternativeGroundTruths?: string[];
  tags: string[];
  metadata?: { numberType?: TestCaseMetadata["numberType"] };
  voice: string;
}

async function loadManifest(): Promise<Record<string, unknown[]>> {
  const manifestPath = join(BENCH_ROOT, "scripts", "tts-manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf-8"));
}

export async function generateCodeSwitchingSuites(): Promise<TestSuite[]> {
  const manifest = await loadManifest();
  const entries = (manifest["code-switching"] || []) as ManifestCodeSwitchingEntry[];

  if (entries.length === 0) {
    console.log("No code-switching entries in manifest.");
    return [];
  }

  const tests: TestCase[] = entries.map((entry) => ({
    id: entry.id,
    audioFile: `samples-codeswitching/${entry.id}.wav`,
    groundTruth: entry.groundTruth,
    tags: entry.tags,
    source: "custom",
  }));

  return [
    buildSuite({
      id: "code-switching-de",
      name: "Code-Switching (DE hint)",
      description: "Mixed German-English sentences with German language hint",
      language: "de",
      category: "code-switching",
      benchmarkTier: "diagnostic",
      tests,
    }),
    buildSuite({
      id: "code-switching-auto",
      name: "Code-Switching (auto-detect)",
      description: "Mixed German-English sentences with auto language detection",
      language: "auto",
      category: "code-switching",
      benchmarkTier: "diagnostic",
      tests,
    }),
  ];
}

export async function generatePunctuationFormattingSuite(
  lang: "de" | "en"
): Promise<TestSuite | null> {
  const manifest = await loadManifest();
  const key = `punctuation-formatting-${lang}`;
  const dirName = lang === "de" ? "samples-punct-de" : "samples-punct-en";
  const entries = (manifest[key] || []) as ManifestPunctuationEntry[];

  if (entries.length === 0) {
    console.log(`No ${key} entries in manifest.`);
    return null;
  }

  return buildSuite({
    id: key,
    name: `Punctuation & Formatting (${toLangLabel(lang)})`,
    description: `Punctuation, capitalization, and formatting accuracy for ${toLangLabel(lang)}`,
    language: lang,
    category: "punctuation-formatting",
    benchmarkTier: "core",
    tests: entries.map((entry) => ({
      id: entry.id,
      audioFile: `${dirName}/${entry.id}.wav`,
      groundTruth: entry.text,
      formattedGroundTruth: entry.formattedGroundTruth,
      tags: entry.tags,
      source: "custom",
    })),
  });
}

export async function generateNumberFormattingSuite(
  lang: "de" | "en"
): Promise<TestSuite | null> {
  const manifest = await loadManifest();
  const key = `number-formatting-${lang}`;
  const dirName = lang === "de" ? "samples-numfmt-de" : "samples-numfmt-en";
  const entries = (manifest[key] || []) as ManifestNumberEntry[];

  if (entries.length === 0) {
    console.log(`No ${key} entries in manifest.`);
    return null;
  }

  return buildSuite({
    id: key,
    name: `Number Formatting (${toLangLabel(lang)})`,
    description: `Intelligent number, date, time, and currency formatting for ${toLangLabel(lang)}`,
    language: lang,
    category: "number-formatting",
    benchmarkTier: "core",
    tests: entries.map((entry) => ({
      id: entry.id,
      audioFile: `${dirName}/${entry.id}.wav`,
      groundTruth: entry.groundTruth,
      alternativeGroundTruths: entry.alternativeGroundTruths,
      tags: entry.tags,
      source: "custom",
      metadata: entry.metadata?.numberType
        ? { numberType: entry.metadata.numberType }
        : undefined,
    })),
  });
}

interface VoxPopuliCuratedEntry {
  id: string;
  audioFile: string;
  groundTruth: string;
  speakerId?: string;
  tags?: string[];
}

export async function generateLongFormSuite(
  lang: "de" | "en"
): Promise<TestSuite | null> {
  const manifestPath = join(
    BENCH_ROOT,
    "audio",
    "datasets",
    `voxpopuli-${lang}`,
    "curated.json"
  );
  const entries = safeReadJson<VoxPopuliCuratedEntry[]>(manifestPath);

  if (!entries || entries.length === 0) {
    console.log(
      `VoxPopuli curated manifest missing for ${lang.toUpperCase()}. Run: bash bench/scripts/download-voxpopuli.sh`
    );
    return null;
  }

  return buildSuite({
    id: `long-form-speech-${lang}`,
    name: `Long-form Speech (${toLangLabel(lang)})`,
    description: `Long-form public speech from VoxPopuli for ${toLangLabel(lang)}`,
    language: lang,
    category: "long-form-speech",
    benchmarkTier: "core",
    tests: entries.slice(0, LONGFORM_TARGET).map((entry) => ({
      id: entry.id,
      audioFile: entry.audioFile,
      groundTruth: entry.groundTruth,
      tags: entry.tags ?? ["long-form", "public-speech"],
      source: "voxpopuli",
      metadata: entry.speakerId ? { speaker: entry.speakerId } : undefined,
    })),
  });
}

async function main() {
  console.log("Generating test suites from available datasets...\n");

  const staticSuites = await Promise.all([
    generateLibriSpeechSuite(),
    generateCommonVoiceSuite(),
    generateAccentedSpeechSuite("en"),
    generateAccentedSpeechSuite("de"),
    generatePunctuationFormattingSuite("de"),
    generatePunctuationFormattingSuite("en"),
    generateNumberFormattingSuite("de"),
    generateNumberFormattingSuite("en"),
    generateLongFormSuite("de"),
    generateLongFormSuite("en"),
  ]);

  for (const suite of staticSuites) {
    if (suite) await writeSuiteFile(suite);
  }

  for (const suite of await generateCodeSwitchingSuites()) {
    await writeSuiteFile(suite);
  }

  console.log("\nDone!");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
