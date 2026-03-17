import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runBenchmark, type RunnerEvent } from "./runner.js";
import type { BenchmarkConfig, STTProvider, TestSuite } from "./types.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stt-bench-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("runBenchmark", () => {
  it("marks unsupported auto-language runs as skipped instead of errors", async () => {
    const events: RunnerEvent[] = [];
    const provider: STTProvider = {
      id: "mock-skip",
      name: "Mock Skip",
      type: "cloud",
      models: ["baseline"],
      async transcribe() {
        throw new Error("should not be called");
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage(_model, language) {
        return language !== "auto";
      },
    };

    const suite: TestSuite = {
      id: "code-switching-auto",
      name: "Code-Switching (auto-detect)",
      description: "Auto detect",
      language: "auto",
      category: "code-switching",
      benchmarkTier: "diagnostic",
      tests: [
        {
          id: "cs-tech-01",
          audioFile: "samples-en/clean-01.wav",
          groundTruth: "hello world",
          tags: ["tech-talk"],
          source: "custom",
        },
      ],
    };

    const config: BenchmarkConfig = {
      runsPerModel: 1,
      maxConcurrency: 1,
      timeoutSeconds: 1,
      staggerDelayMs: 0,
      outputDirectory: await createTempDir(),
      enableSemanticScoring: false,
    };

    const summary = await runBenchmark({
      suites: [suite],
      providers: [provider],
      config,
      version: "2026-03-16",
      onEvent: (event) => events.push(event),
    });

    expect(events.some((event) => event.type === "skip")).toBe(true);
    expect(summary.rankings).toHaveLength(1);
    expect(summary.rankings[0].skipCount).toBe(1);
    expect(summary.rankings[0].errorCount).toBe(0);
    expect(summary.resultsBySuite["code-switching-auto"][0].status).toBe("skipped");
  });
});
