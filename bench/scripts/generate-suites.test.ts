import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateCodeSwitchingSuites,
  generateLongFormSuite,
  generateNumberFormattingSuite,
  generatePunctuationFormattingSuite,
} from "./generate-suites.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");

const createdFiles: string[] = [];
const createdDirs: string[] = [];

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    createdDirs.push(path);
    await mkdir(path, { recursive: true });
  }
}

async function writeFixture(path: string, content: string): Promise<void> {
  createdFiles.push(path);
  await writeFile(path, content, "utf-8");
}

afterEach(async () => {
  for (const file of createdFiles.splice(0)) {
    await rm(file, { force: true });
  }
  for (const dir of createdDirs.splice(0).reverse()) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("generate-suites", () => {
  it("builds eight additional suite definitions with expected sizes", async () => {
    const voxDeDir = join(BENCH_ROOT, "audio", "datasets", "voxpopuli-de");
    const voxEnDir = join(BENCH_ROOT, "audio", "datasets", "voxpopuli-en");
    await ensureDir(voxDeDir);
    await ensureDir(voxEnDir);

    const curatedEntries = JSON.stringify(
      Array.from({ length: 20 }, (_, index) => ({
        id: `vox-${index + 1}`,
        audioFile: `samples-longform-de/vox-${index + 1}.wav`,
        groundTruth: `Long form utterance ${index + 1}`,
        speakerId: `speaker-${index + 1}`,
        tags: ["long-form", "public-speech"],
      })),
      null,
      2
    );
    const curatedEntriesEn = JSON.stringify(
      Array.from({ length: 20 }, (_, index) => ({
        id: `vox-en-${index + 1}`,
        audioFile: `samples-longform-en/vox-en-${index + 1}.wav`,
        groundTruth: `English long form utterance ${index + 1}`,
        speakerId: `speaker-en-${index + 1}`,
        tags: ["long-form", "public-speech"],
      })),
      null,
      2
    );

    await writeFixture(join(voxDeDir, "curated.json"), `${curatedEntries}\n`);
    await writeFixture(join(voxEnDir, "curated.json"), `${curatedEntriesEn}\n`);

    const codeSwitching = await generateCodeSwitchingSuites();
    const punctDe = await generatePunctuationFormattingSuite("de");
    const punctEn = await generatePunctuationFormattingSuite("en");
    const numberDe = await generateNumberFormattingSuite("de");
    const numberEn = await generateNumberFormattingSuite("en");
    const longDe = await generateLongFormSuite("de");
    const longEn = await generateLongFormSuite("en");

    expect(codeSwitching).toHaveLength(2);
    expect(codeSwitching.every((suite) => suite.tests.length === 25)).toBe(true);
    expect(codeSwitching.every((suite) => suite.benchmarkTier === "diagnostic")).toBe(true);

    expect(punctDe?.tests.length).toBe(25);
    expect(punctEn?.tests.length).toBe(25);
    expect(numberDe?.tests.length).toBe(25);
    expect(numberEn?.tests.length).toBe(25);
    expect(punctDe?.benchmarkTier).toBe("core");
    expect(numberEn?.benchmarkTier).toBe("core");

    expect(longDe?.tests.length).toBe(20);
    expect(longEn?.tests.length).toBe(20);
    expect(longDe?.tests[0].source).toBe("voxpopuli");
    expect(longEn?.benchmarkTier).toBe("core");
  });
});
