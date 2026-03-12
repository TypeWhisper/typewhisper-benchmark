/**
 * Curate spontaneous speech samples from Mozilla Common Voice
 * Spontaneous Speech corpus for accented-speech benchmark suites.
 *
 * Prerequisites:
 * - Download Spontaneous Speech datasets manually (license requires acceptance)
 * - Place EN dataset in: bench/audio/datasets/common-voice-en/
 * - Place DE dataset in: bench/audio/datasets/common-voice-de/
 * - Each should contain ss-corpus-{lang}.tsv and audios/ directory
 *
 * Usage: npx tsx bench/scripts/curate-common-voice.ts
 */

import { readFile, writeFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { TestSuite, TestCase } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

interface SPSEntry {
  audioFile: string;
  transcription: string;
  durationMs: number;
  votes: number;
  prompt: string;
  split: string;
}

function parseSPSTsv(content: string): SPSEntry[] {
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");

  const audioFileIdx = header.indexOf("audio_file");
  const transcriptionIdx = header.indexOf("transcription");
  const durationIdx = header.indexOf("duration_ms");
  const votesIdx = header.indexOf("votes");
  const promptIdx = header.indexOf("prompt");
  const splitIdx = header.indexOf("split");

  if (audioFileIdx === -1 || transcriptionIdx === -1) {
    throw new Error("TSV missing required columns: audio_file, transcription");
  }

  const entries: SPSEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const transcription = (cols[transcriptionIdx] || "").trim();
    if (!transcription) continue; // Skip entries without transcriptions

    entries.push({
      audioFile: cols[audioFileIdx] || "",
      transcription,
      durationMs: durationIdx !== -1 ? parseInt(cols[durationIdx] || "0", 10) : 0,
      votes: votesIdx !== -1 ? parseInt(cols[votesIdx] || "0", 10) : 0,
      prompt: promptIdx !== -1 ? (cols[promptIdx] || "").trim() : "",
      split: splitIdx !== -1 ? (cols[splitIdx] || "").trim() : "",
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

async function curateSpontaneousSuite(
  lang: "en" | "de",
  datasetDir: string,
  targetSamples: number = 25
): Promise<TestSuite | null> {
  const tsvPath = join(datasetDir, `ss-corpus-${lang}.tsv`);

  if (!existsSync(tsvPath)) {
    console.log(`  Spontaneous Speech ${lang.toUpperCase()} not found at ${tsvPath}`);
    return null;
  }

  console.log(`Processing Spontaneous Speech ${lang.toUpperCase()}...`);

  const content = await readFile(tsvPath, "utf-8");
  const entries = parseSPSTsv(content);

  console.log(`  ${entries.length} entries with transcriptions`);

  // Filter: reasonable length (3-30s), non-negative votes, transcript > 10 chars
  const quality = entries.filter(
    (e) =>
      e.votes >= 0 &&
      e.transcription.length > 10 &&
      e.durationMs >= 3000 &&
      e.durationMs <= 30000
  );

  console.log(`  ${quality.length} pass quality filter`);

  // Sort: prefer shorter entries with positive votes for benchmark efficiency
  quality.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.durationMs - b.durationMs;
  });

  // Diversify by selecting from different prompts
  const byPrompt = new Map<string, SPSEntry[]>();
  for (const entry of quality) {
    const group = byPrompt.get(entry.prompt) || [];
    group.push(entry);
    byPrompt.set(entry.prompt, group);
  }

  // Round-robin across prompts to get diverse samples
  const selected: SPSEntry[] = [];
  const promptKeys = [...byPrompt.keys()];
  let promptIdx = 0;
  const usedPerPrompt = new Map<string, number>();

  while (selected.length < targetSamples && promptKeys.length > 0) {
    const prompt = promptKeys[promptIdx % promptKeys.length];
    const used = usedPerPrompt.get(prompt) || 0;
    const group = byPrompt.get(prompt)!;

    if (used < group.length) {
      selected.push(group[used]);
      usedPerPrompt.set(prompt, used + 1);
    }

    promptIdx++;
    // Remove exhausted prompts
    if (used + 1 >= group.length) {
      const idx = promptKeys.indexOf(prompt);
      if (idx !== -1) promptKeys.splice(idx, 1);
      if (promptKeys.length === 0) break;
      promptIdx = promptIdx % promptKeys.length;
    }
  }

  console.log(`  Selected ${selected.length} diverse samples from ${byPrompt.size} prompts`);

  const audioOutDir = join(BENCH_ROOT, "audio", `samples-accent-${lang}`);
  mkdirSync(audioOutDir, { recursive: true });

  const tests: TestCase[] = [];

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];
    const sampleNum = (i + 1).toString().padStart(2, "0");

    const mp3Path = join(datasetDir, "audios", entry.audioFile);
    const wavFilename = `${lang}-accent-${sampleNum}.wav`;
    const wavPath = join(audioOutDir, wavFilename);

    if (!existsSync(mp3Path)) {
      console.log(`  Warning: ${entry.audioFile} not found, skipping`);
      continue;
    }

    if (!existsSync(wavPath)) {
      console.log(`  Converting: ${wavFilename} (${entry.durationMs}ms)`);
      if (!convertToWav(mp3Path, wavPath)) {
        console.log(`  Error converting ${entry.audioFile}`);
        continue;
      }
    } else {
      console.log(`  Exists: ${wavFilename}`);
    }

    tests.push({
      id: `${lang}-accent-${sampleNum}`,
      audioFile: `samples-accent-${lang}/${wavFilename}`,
      groundTruth: entry.transcription,
      tags: ["spontaneous-speech", "common-voice"],
      source: "common-voice",
      metadata: {
        speaker: entry.prompt ? `prompt:${entry.prompt.slice(0, 40)}` : undefined,
      },
    });
  }

  if (tests.length === 0) {
    console.log(`  No usable samples for ${lang.toUpperCase()}.`);
    return null;
  }

  const langName = lang === "en" ? "English" : "German";
  return {
    id: `accented-speech-${lang}`,
    name: `Accented Speech (${langName})`,
    description: `Spontaneous speech from diverse speakers (Common Voice Spontaneous Speech corpus)`,
    language: lang,
    category: "accented-speech",
    tests,
  };
}

async function main() {
  console.log("Curating spontaneous speech samples...\n");

  const enDataset = join(BENCH_ROOT, "audio", "datasets", "common-voice-en");
  const deDataset = join(BENCH_ROOT, "audio", "datasets", "common-voice-de");

  const enSuite = await curateSpontaneousSuite("en", enDataset);
  if (enSuite) {
    const outPath = join(BENCH_ROOT, "tests", "accented-speech-en.json");
    await writeFile(outPath, JSON.stringify(enSuite, null, 2), "utf-8");
    console.log(`\nWritten ${enSuite.tests.length} tests to ${outPath}`);
  }

  const deSuite = await curateSpontaneousSuite("de", deDataset, 25);
  if (deSuite) {
    const outPath = join(BENCH_ROOT, "tests", "accented-speech-de.json");
    await writeFile(outPath, JSON.stringify(deSuite, null, 2), "utf-8");
    console.log(`\nWritten ${deSuite.tests.length} tests to ${outPath}`);
  }

  if (!enSuite && !deSuite) {
    console.log("\nNo datasets found.");
    console.log("Download Spontaneous Speech corpus from commonvoice.mozilla.org");
    console.log(`  EN -> ${enDataset}/`);
    console.log(`  DE -> ${deDataset}/`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
