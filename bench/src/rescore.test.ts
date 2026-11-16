import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { rescoreResultFiles } from "./rescore.js";
import type { TestResult, TestSuite } from "./types.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const suite: TestSuite = {
  id: "punctuation-formatting-de",
  name: "Punctuation (German)",
  description: "test",
  language: "de",
  category: "punctuation-formatting",
  tests: [
    {
      id: "p1",
      audioFile: "x.wav",
      groundTruth: "Professor Müller arbeitet in München",
      formattedGroundTruth: "Professor Müller arbeitet in München.",
      tags: [],
      source: "custom",
    },
  ],
};

function result(suiteId: string, transcription: string, werNormalized: number, testId = "p1"): TestResult {
  return {
    testId,
    suiteId,
    providerId: "mock",
    model: "m",
    run: 1,
    status: "ok",
    transcription,
    werRaw: werNormalized,
    werNormalized,
    cer: 0,
    durationMs: 10,
    realtimeFactor: 0.01,
    audioDurationMs: 1000,
    timestamp: "2026-10-29T00:00:00.000Z",
  } as TestResult;
}

async function writeModelFile(dir: string, name: string, providerId: string, resultsBySuite: Record<string, TestResult[]>) {
  const file = {
    ranking: { providerId, providerType: "local", model: "m" },
    suiteMetadata: {},
    resultsBySuite,
  };
  await writeFile(join(dir, name), JSON.stringify(file, null, 2) + "\n");
}

describe("rescoreResultFiles", () => {
  it("recomputes metrics against the current references and rebuilds the ranking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rescore-"));
    dirs.push(dir);
    // Scored against an older reference that spelled the umlauts in ASCII.
    await writeModelFile(dir, "mock_m.json", "mock", {
      "punctuation-formatting-de": [result("punctuation-formatting-de", "Professor Müller arbeitet in München.", 0.4)],
    });

    const reports = await rescoreResultFiles(dir, [suite]);
    expect(reports).toEqual([{ file: "mock_m.json", changed: 1, refreshed: ["punctuation-formatting-de"], dropped: [], pruned: 0 }]);
    const data = JSON.parse(await readFile(join(dir, "mock_m.json"), "utf-8"));
    expect(data.resultsBySuite["punctuation-formatting-de"][0].werNormalized).toBe(0);
    expect(data.ranking.avgWerNormalized).toBe(0);
    expect(data.suiteMetadata["punctuation-formatting-de"].name).toBe("Punctuation (German)");

    // A second pass has nothing left to change and leaves the file alone.
    expect(await rescoreResultFiles(dir, [suite])).toEqual([]);
  });

  it("removes results whose test is no longer in the suite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rescore-"));
    dirs.push(dir);
    await writeModelFile(dir, "mock_m.json", "mock", {
      "punctuation-formatting-de": [
        result("punctuation-formatting-de", "Professor Müller arbeitet in München.", 0),
        result("punctuation-formatting-de", "ganz falsch", 1, "removed"),
      ],
    });
    const reports = await rescoreResultFiles(dir, [suite]);
    expect(reports).toEqual([{ file: "mock_m.json", changed: 1, refreshed: ["punctuation-formatting-de"], dropped: [], pruned: 1 }]);
    const data = JSON.parse(await readFile(join(dir, "mock_m.json"), "utf-8"));
    expect(data.resultsBySuite["punctuation-formatting-de"].map((r: TestResult) => r.testId)).toEqual(["p1"]);
    expect(data.ranking.avgWerNormalized).toBe(0);

    // Pruning alone is a change worth writing.
    data.resultsBySuite["punctuation-formatting-de"].push(result("punctuation-formatting-de", "ganz falsch", 1, "removed"));
    await writeFile(join(dir, "mock_m.json"), JSON.stringify(data, null, 2) + "\n");
    expect(await rescoreResultFiles(dir, [suite])).toEqual([
      { file: "mock_m.json", changed: 0, refreshed: [], dropped: [], pruned: 1 },
    ]);
    const again = JSON.parse(await readFile(join(dir, "mock_m.json"), "utf-8"));
    expect(again.resultsBySuite["punctuation-formatting-de"].map((r: TestResult) => r.testId)).toEqual(["p1"]);
  });

  it("refuses to write a file without results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rescore-"));
    dirs.push(dir);
    await writeModelFile(dir, "mock_m.json", "mock", {
      "punctuation-formatting-de": [result("punctuation-formatting-de", "ganz falsch", 1, "removed")],
    });
    await expect(rescoreResultFiles(dir, [suite])).rejects.toThrow("mock_m.json: no results left");
  });

  it("drops suites only from the named providers' files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rescore-"));
    dirs.push(dir);
    const noisy = { "noisy-environment-en": [result("noisy-environment-en", "hello", 0)] };
    const punct = { "punctuation-formatting-de": [result("punctuation-formatting-de", "Professor Müller arbeitet in München.", 0)] };
    await writeModelFile(dir, "cloud_m.json", "cloud", { ...noisy, ...punct });
    await writeModelFile(dir, "local_m.json", "local", { ...noisy });

    const reports = await rescoreResultFiles(dir, [], {
      dropSuites: ["noisy-environment-en"],
      dropProviders: ["cloud"],
    });
    expect(reports).toEqual([{ file: "cloud_m.json", changed: 0, refreshed: [], dropped: ["noisy-environment-en"], pruned: 0 }]);
    const cloud = JSON.parse(await readFile(join(dir, "cloud_m.json"), "utf-8"));
    const local = JSON.parse(await readFile(join(dir, "local_m.json"), "utf-8"));
    expect(cloud.resultsBySuite["noisy-environment-en"]).toBeUndefined();
    expect(local.resultsBySuite["noisy-environment-en"]).toHaveLength(1);
  });
});
