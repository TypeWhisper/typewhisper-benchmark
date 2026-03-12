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

interface CVEntry {
  path: string;
  sentence: string;
  upVotes: number;
  downVotes: number;
  accent: string;
}

function parseCVTsv(content: string): CVEntry[] {
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");

  const pathIdx = header.indexOf("path");
  const sentenceIdx = header.indexOf("sentence");
  const upIdx = header.indexOf("up_votes");
  const downIdx = header.indexOf("down_votes");
  const accentIdx = header.indexOf("accents") !== -1
    ? header.indexOf("accents")
    : header.indexOf("accent");

  if (pathIdx === -1 || sentenceIdx === -1) return [];

  const entries: CVEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    entries.push({
      path: cols[pathIdx] || "",
      sentence: cols[sentenceIdx] || "",
      upVotes: upIdx !== -1 ? parseInt(cols[upIdx] || "0", 10) : 0,
      downVotes: downIdx !== -1 ? parseInt(cols[downIdx] || "0", 10) : 0,
      accent: accentIdx !== -1 ? (cols[accentIdx] || "").trim() : "",
    });
  }
  return entries;
}

async function generateAccentedSpeechSuite(
  lang: "en" | "de"
): Promise<TestSuite | null> {
  const datasetDir = join(BENCH_ROOT, "audio", "datasets", `common-voice-${lang}`);
  const tsvPath = join(datasetDir, "validated.tsv");

  if (!existsSync(tsvPath)) {
    console.log(`Common Voice ${lang.toUpperCase()} not found at ${datasetDir}`);
    console.log("Download from commonvoice.mozilla.org and place dataset there.");
    return null;
  }

  console.log(`Processing Common Voice ${lang.toUpperCase()} for accented speech...`);

  const content = await readFile(tsvPath, "utf-8");
  const entries = parseCVTsv(content);

  // Filter for quality
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

  const targetAccents =
    lang === "en"
      ? ["indian", "india", "chinese", "china", "german", "germany", "hispanic", "spanish"]
      : ["austrian", "austria", "swiss", "switzerland", "bavarian"];

  const audioOutDir = join(BENCH_ROOT, "audio", `samples-accent-${lang}`);
  mkdirSync(audioOutDir, { recursive: true });

  const tests: TestCase[] = [];
  let sampleIdx = 0;
  const samplesPerAccent = 6;

  for (const target of targetAccents) {
    let matched: CVEntry[] = [];
    for (const [accent, group] of accentGroups) {
      if (accent.includes(target) || target.includes(accent)) {
        matched.push(...group);
      }
    }

    if (matched.length === 0) continue;
    matched.sort((a, b) => b.upVotes - a.upVotes);
    const selected = matched.slice(0, samplesPerAccent);

    for (const entry of selected) {
      sampleIdx++;
      const mp3Path = join(datasetDir, "clips", entry.path);
      const wavFilename = `${lang}-accent-${sampleIdx.toString().padStart(2, "0")}.wav`;
      const wavPath = join(audioOutDir, wavFilename);

      if (!existsSync(mp3Path)) continue;

      if (!existsSync(wavPath)) {
        try {
          execSync(
            `ffmpeg -y -i "${mp3Path}" -ar 16000 -ac 1 "${wavPath}" -loglevel error`,
            { stdio: "pipe" }
          );
        } catch {
          continue;
        }
      }

      tests.push({
        id: `${lang}-accent-${sampleIdx.toString().padStart(2, "0")}`,
        audioFile: `samples-accent-${lang}/${wavFilename}`,
        groundTruth: entry.sentence,
        tags: ["accented-speech", target],
        source: "common-voice",
        metadata: { accent: target },
      });
    }
  }

  if (tests.length === 0) {
    console.log(`  No accented samples found for ${lang.toUpperCase()}.`);
    return null;
  }

  return {
    id: `accented-speech-${lang}`,
    name: `Accented Speech (${lang === "en" ? "English" : "German"})`,
    description: "Speech with various accents from Mozilla Common Voice",
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
