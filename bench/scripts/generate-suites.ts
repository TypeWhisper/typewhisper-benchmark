import { readFile, writeFile, readdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { TestSuite, TestCase } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

async function generateLibriSpeechSuite(): Promise<TestSuite | null> {
  const audioDir = "bench/audio/librispeech";
  if (!existsSync(audioDir)) {
    console.log("LibriSpeech not found. Run: bash bench/scripts/download-librispeech.sh");
    return null;
  }

  // LibriSpeech structure: speaker/chapter/speaker-chapter-utterance.flac
  // Transcripts: speaker/chapter/speaker-chapter.trans.txt
  const tests: TestCase[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".trans.txt")) {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.trim().split("\n");

        for (const line of lines) {
          const spaceIdx = line.indexOf(" ");
          if (spaceIdx === -1) continue;

          const uttId = line.slice(0, spaceIdx);
          const text = line.slice(spaceIdx + 1).trim();
          const wavFile = join(dir, `${uttId}.wav`).replace("bench/audio/", "");

          if (tests.length >= 20) return; // Limit to 20 tests per suite

          tests.push({
            id: `librispeech-${uttId}`,
            audioFile: wavFile,
            groundTruth: text,
            tags: ["clean", "read-speech"],
            source: "librispeech",
          });
        }
      }
    }
  }

  await scanDir(audioDir);

  if (tests.length === 0) {
    console.log("No LibriSpeech transcripts found.");
    return null;
  }

  return {
    id: "clean-speech-en",
    name: "Clean Speech (English)",
    description: "LibriSpeech test-clean: clear read speech, single speaker",
    language: "en",
    category: "clean-speech",
    tests,
  };
}

async function generateCommonVoiceSuite(): Promise<TestSuite | null> {
  const audioDir = "bench/audio/common-voice";
  const tsvPath = join(audioDir, "validated.tsv");

  if (!existsSync(tsvPath)) {
    console.log("Common Voice not found. Run: bash bench/scripts/download-common-voice.sh");
    return null;
  }

  const content = await readFile(tsvPath, "utf-8");
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");
  const pathIdx = header.indexOf("path");
  const sentenceIdx = header.indexOf("sentence");

  const tests: TestCase[] = [];

  for (let i = 1; i < lines.length && tests.length < 20; i++) {
    const cols = lines[i].split("\t");
    const mp3File = cols[pathIdx];
    const sentence = cols[sentenceIdx];
    if (!mp3File || !sentence) continue;

    const wavFile = `common-voice/clips/${mp3File.replace(".mp3", ".wav")}`;

    tests.push({
      id: `cv-de-${i}`,
      audioFile: wavFile,
      groundTruth: sentence,
      tags: ["clean", "read-speech"],
      source: "common-voice",
    });
  }

  if (tests.length === 0) {
    console.log("No Common Voice entries found.");
    return null;
  }

  return {
    id: "clean-speech-de",
    name: "Clean Speech (German)",
    description: "Mozilla Common Voice: read speech from volunteers",
    language: "de",
    category: "clean-speech",
    tests,
  };
}

interface SPSEntry {
  audioFile: string;
  transcription: string;
  durationMs: number;
  votes: number;
  prompt: string;
}

function parseSPSTsv(content: string): SPSEntry[] {
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");

  const audioFileIdx = header.indexOf("audio_file");
  const transcriptionIdx = header.indexOf("transcription");
  const durationIdx = header.indexOf("duration_ms");
  const votesIdx = header.indexOf("votes");
  const promptIdx = header.indexOf("prompt");

  if (audioFileIdx === -1 || transcriptionIdx === -1) return [];

  const entries: SPSEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const transcription = (cols[transcriptionIdx] || "").trim();
    if (!transcription) continue;

    entries.push({
      audioFile: cols[audioFileIdx] || "",
      transcription,
      durationMs: durationIdx !== -1 ? parseInt(cols[durationIdx] || "0", 10) : 0,
      votes: votesIdx !== -1 ? parseInt(cols[votesIdx] || "0", 10) : 0,
      prompt: promptIdx !== -1 ? (cols[promptIdx] || "").trim() : "",
    });
  }
  return entries;
}

async function generateAccentedSpeechSuite(
  lang: "en" | "de"
): Promise<TestSuite | null> {
  const datasetDir = join(BENCH_ROOT, "audio", "datasets", `common-voice-${lang}`);
  const tsvPath = join(datasetDir, `ss-corpus-${lang}.tsv`);

  if (!existsSync(tsvPath)) {
    console.log(`Spontaneous Speech ${lang.toUpperCase()} not found at ${datasetDir}`);
    return null;
  }

  console.log(`Processing Spontaneous Speech ${lang.toUpperCase()}...`);

  const content = await readFile(tsvPath, "utf-8");
  const entries = parseSPSTsv(content);

  const quality = entries.filter(
    (e) => e.votes >= 0 && e.transcription.length > 10 && e.durationMs >= 3000 && e.durationMs <= 30000
  );

  // Diversify by prompt via round-robin
  const byPrompt = new Map<string, SPSEntry[]>();
  for (const entry of quality) {
    const group = byPrompt.get(entry.prompt) || [];
    group.push(entry);
    byPrompt.set(entry.prompt, group);
  }

  const selected: SPSEntry[] = [];
  const promptKeys = [...byPrompt.keys()];
  let pIdx = 0;
  const usedPerPrompt = new Map<string, number>();

  while (selected.length < 25 && promptKeys.length > 0) {
    const prompt = promptKeys[pIdx % promptKeys.length];
    const used = usedPerPrompt.get(prompt) || 0;
    const group = byPrompt.get(prompt)!;

    if (used < group.length) {
      selected.push(group[used]);
      usedPerPrompt.set(prompt, used + 1);
    }
    pIdx++;
    if (used + 1 >= group.length) {
      const idx = promptKeys.indexOf(prompt);
      if (idx !== -1) promptKeys.splice(idx, 1);
      if (promptKeys.length === 0) break;
      pIdx = pIdx % promptKeys.length;
    }
  }

  const audioOutDir = join(BENCH_ROOT, "audio", `samples-accent-${lang}`);
  mkdirSync(audioOutDir, { recursive: true });

  const tests: TestCase[] = [];
  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];
    const sampleNum = (i + 1).toString().padStart(2, "0");
    const mp3Path = join(datasetDir, "audios", entry.audioFile);
    const wavFilename = `${lang}-accent-${sampleNum}.wav`;
    const wavPath = join(audioOutDir, wavFilename);

    if (!existsSync(mp3Path)) continue;

    if (!existsSync(wavPath)) {
      try {
        execSync(`ffmpeg -y -i "${mp3Path}" -ar 16000 -ac 1 "${wavPath}" -loglevel error`, { stdio: "pipe" });
      } catch { continue; }
    }

    tests.push({
      id: `${lang}-accent-${sampleNum}`,
      audioFile: `samples-accent-${lang}/${wavFilename}`,
      groundTruth: entry.transcription,
      tags: ["spontaneous-speech", "common-voice"],
      source: "common-voice",
    });
  }

  if (tests.length === 0) return null;

  return {
    id: `accented-speech-${lang}`,
    name: `Accented Speech (${lang === "en" ? "English" : "German"})`,
    description: "Spontaneous speech from diverse speakers (Common Voice Spontaneous Speech corpus)",
    language: lang,
    category: "accented-speech",
    tests,
  };
}

async function main() {
  console.log("Generating test suites from downloaded datasets...\n");

  const libriSuite = await generateLibriSpeechSuite();
  if (libriSuite) {
    const outPath = "bench/tests/clean-speech-en.json";
    await writeFile(outPath, JSON.stringify(libriSuite, null, 2), "utf-8");
    console.log(`Written ${libriSuite.tests.length} tests to ${outPath}`);
  }

  const cvSuite = await generateCommonVoiceSuite();
  if (cvSuite) {
    const outPath = "bench/tests/clean-speech-de.json";
    await writeFile(outPath, JSON.stringify(cvSuite, null, 2), "utf-8");
    console.log(`Written ${cvSuite.tests.length} tests to ${outPath}`);
  }

  // Accented speech suites (requires Common Voice dataset download)
  for (const lang of ["en", "de"] as const) {
    const accentSuite = await generateAccentedSpeechSuite(lang);
    if (accentSuite) {
      const outPath = `bench/tests/accented-speech-${lang}.json`;
      await writeFile(outPath, JSON.stringify(accentSuite, null, 2), "utf-8");
      console.log(`Written ${accentSuite.tests.length} tests to ${outPath}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
