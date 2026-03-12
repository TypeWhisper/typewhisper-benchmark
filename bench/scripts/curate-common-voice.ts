/**
 * Curate accented speech samples from Mozilla Common Voice.
 *
 * Prerequisites:
 * - Download Common Voice datasets manually (license requires acceptance)
 * - Place EN dataset in: bench/audio/datasets/common-voice-en/
 * - Place DE dataset in: bench/audio/datasets/common-voice-de/
 * - Each should contain validated.tsv and clips/ directory
 *
 * Usage: npx tsx bench/scripts/curate-common-voice.ts
 */

import { readFile, writeFile, copyFile, readdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { TestSuite, TestCase } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

interface CVEntry {
  path: string;
  sentence: string;
  upVotes: number;
  downVotes: number;
  accent: string;
}

function parseTSV(content: string): CVEntry[] {
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");

  const pathIdx = header.indexOf("path");
  const sentenceIdx = header.indexOf("sentence");
  const upIdx = header.indexOf("up_votes");
  const downIdx = header.indexOf("down_votes");
  const accentIdx = header.indexOf("accents") !== -1
    ? header.indexOf("accents")
    : header.indexOf("accent");

  if (pathIdx === -1 || sentenceIdx === -1) {
    throw new Error("TSV missing required columns: path, sentence");
  }

  const entries: CVEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const upVotes = upIdx !== -1 ? parseInt(cols[upIdx] || "0", 10) : 0;
    const downVotes = downIdx !== -1 ? parseInt(cols[downIdx] || "0", 10) : 0;

    entries.push({
      path: cols[pathIdx] || "",
      sentence: cols[sentenceIdx] || "",
      upVotes,
      downVotes,
      accent: accentIdx !== -1 ? (cols[accentIdx] || "").trim() : "",
    });
  }

  return entries;
}

function convertToWav(mp3Path: string, wavPath: string): boolean {
  try {
    execSync(
      `ffmpeg -y -i "${mp3Path}" -ar 16000 -ac 1 "${wavPath}" -loglevel error`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

async function curateAccentedSuite(
  lang: "en" | "de",
  datasetDir: string,
  targetSamplesPerAccent: number = 6
): Promise<TestSuite | null> {
  const tsvPath = join(datasetDir, "validated.tsv");

  if (!existsSync(tsvPath)) {
    console.log(`  Common Voice ${lang.toUpperCase()} not found at ${datasetDir}`);
    console.log(`  Download from commonvoice.mozilla.org and place dataset there.`);
    return null;
  }

  console.log(`Processing Common Voice ${lang.toUpperCase()}...`);

  const content = await readFile(tsvPath, "utf-8");
  const entries = parseTSV(content);

  // Filter for quality (more upvotes than downvotes)
  const quality = entries.filter(
    (e) => e.upVotes > e.downVotes && e.sentence.length > 10
  );

  // Group by accent
  const accentGroups = new Map<string, CVEntry[]>();
  for (const entry of quality) {
    if (!entry.accent) continue;
    const accents = entry.accent.split(",").map((a) => a.trim().toLowerCase());
    for (const accent of accents) {
      if (!accent) continue;
      const group = accentGroups.get(accent) || [];
      group.push(entry);
      accentGroups.set(accent, group);
    }
  }

  // Target accent groups
  const targetAccents =
    lang === "en"
      ? ["indian", "india", "chinese", "china", "german", "germany", "hispanic", "spanish", "mexican"]
      : ["austrian", "austria", "swiss", "switzerland", "bavarian", "bayern"];

  const audioOutDir = join(BENCH_ROOT, "audio", `samples-accent-${lang}`);
  mkdirSync(audioOutDir, { recursive: true });

  const tests: TestCase[] = [];
  let sampleIdx = 0;

  // For each target accent group, pick the best samples
  const usedAccents = new Set<string>();

  for (const target of targetAccents) {
    // Find matching accent group
    let matched: CVEntry[] = [];
    for (const [accent, group] of accentGroups) {
      if (accent.includes(target) || target.includes(accent)) {
        matched.push(...group);
        usedAccents.add(accent);
      }
    }

    if (matched.length === 0) continue;

    // Sort by quality (most upvotes)
    matched.sort((a, b) => b.upVotes - a.upVotes);

    // Take top N
    const selected = matched.slice(0, targetSamplesPerAccent);
    const accentLabel = target;

    for (const entry of selected) {
      sampleIdx++;

      const mp3Path = join(datasetDir, "clips", entry.path);
      const wavFilename = `${lang}-accent-${sampleIdx.toString().padStart(2, "0")}.wav`;
      const wavPath = join(audioOutDir, wavFilename);

      // Check if source MP3 exists
      if (!existsSync(mp3Path)) {
        console.log(`  Warning: ${mp3Path} not found, skipping`);
        continue;
      }

      // Convert to WAV if not already done
      if (!existsSync(wavPath)) {
        console.log(`  Converting: ${wavFilename} (accent=${accentLabel})`);
        if (!convertToWav(mp3Path, wavPath)) {
          console.log(`  Error converting ${mp3Path}`);
          continue;
        }
      }

      tests.push({
        id: `${lang}-accent-${sampleIdx.toString().padStart(2, "0")}`,
        audioFile: `samples-accent-${lang}/${wavFilename}`,
        groundTruth: entry.sentence,
        tags: ["accented-speech", accentLabel],
        source: "common-voice",
        metadata: {
          accent: accentLabel,
        },
      });
    }
  }

  if (tests.length === 0) {
    console.log(`  No accented samples found for ${lang.toUpperCase()}.`);
    console.log(`  Available accents: ${[...accentGroups.keys()].slice(0, 20).join(", ")}`);
    return null;
  }

  console.log(`  Selected ${tests.length} samples with accents: ${[...usedAccents].join(", ")}`);

  return {
    id: `accented-speech-${lang}`,
    name: `Accented Speech (${lang === "en" ? "English" : "German"})`,
    description: `Speech with various accents from Mozilla Common Voice`,
    language: lang,
    category: "accented-speech",
    tests,
  };
}

async function main() {
  console.log("Curating accented speech samples from Common Voice...\n");

  const enDataset = join(BENCH_ROOT, "audio", "datasets", "common-voice-en");
  const deDataset = join(BENCH_ROOT, "audio", "datasets", "common-voice-de");

  const enSuite = await curateAccentedSuite("en", enDataset);
  if (enSuite) {
    const outPath = join(BENCH_ROOT, "tests", "accented-speech-en.json");
    await writeFile(outPath, JSON.stringify(enSuite, null, 2), "utf-8");
    console.log(`\nWritten ${enSuite.tests.length} tests to ${outPath}`);
  }

  const deSuite = await curateAccentedSuite("de", deDataset);
  if (deSuite) {
    const outPath = join(BENCH_ROOT, "tests", "accented-speech-de.json");
    await writeFile(outPath, JSON.stringify(deSuite, null, 2), "utf-8");
    console.log(`\nWritten ${deSuite.tests.length} tests to ${outPath}`);
  }

  if (!enSuite && !deSuite) {
    console.log("\nNo Common Voice datasets found.");
    console.log("To use this script:");
    console.log("  1. Download English CV from commonvoice.mozilla.org");
    console.log(`  2. Extract to: ${enDataset}/`);
    console.log("  3. Download German CV from commonvoice.mozilla.org");
    console.log(`  4. Extract to: ${deDataset}/`);
    console.log("  5. Re-run this script");
  }

  console.log("\nDone!");
}

main().catch(console.error);
