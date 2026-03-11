import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { TestSuite, TestCase } from "../src/types.js";

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

  console.log("\nDone!");
}

main().catch(console.error);
