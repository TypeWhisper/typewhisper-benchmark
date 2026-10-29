import { copyFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, relative } from "path";
import { fileURLToPath } from "url";
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

  function suiteWith(count: number): TestSuite {
    return {
      id: "clean-speech-en",
      name: "Clean Speech (English)",
      description: "test",
      language: "en",
      category: "clean-speech",
      tests: Array.from({ length: count }, (_, i) => ({
        id: `t${i}`,
        audioFile: "samples-en/clean-01.wav",
        groundTruth: "The quick brown fox jumps over the lazy dog",
        tags: [],
        source: "custom",
      })),
    };
  }

  async function configWith(maxConcurrency: number): Promise<BenchmarkConfig> {
    return {
      runsPerModel: 1,
      maxConcurrency,
      timeoutSeconds: 1,
      staggerDelayMs: 0,
      outputDirectory: await createTempDir(),
      enableSemanticScoring: false,
    };
  }

  it("prepares each local model before its first clip and releases it after its last", async () => {
    const calls: string[] = [];
    const provider: STTProvider = {
      id: "mock-local",
      name: "Mock Local",
      type: "local",
      models: ["a", "b"],
      async prepare(model) {
        calls.push(`prepare ${model}`);
      },
      async release(model) {
        calls.push(`release ${model}`);
      },
      async transcribe(_audio, model) {
        calls.push(`transcribe ${model}`);
        return { text: "The quick brown fox jumps over the lazy dog", durationMs: 1, model };
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage() {
        return true;
      },
    };

    await runBenchmark({ suites: [suiteWith(2)], providers: [provider], config: await configWith(1), version: "t" });

    expect(calls).toEqual([
      "prepare a",
      "transcribe a",
      "transcribe a",
      "release a",
      "prepare b",
      "transcribe b",
      "transcribe b",
      "release b",
    ]);
  });

  it("gives a local provider one request at a time, so waiting does not count against the timeout", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const provider: STTProvider = {
      id: "mock-serial",
      name: "Mock Serial",
      type: "local",
      models: ["only"],
      async transcribe(_audio, model) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 400));
        inFlight -= 1;
        return { text: "The quick brown fox jumps over the lazy dog", durationMs: 400, model };
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage() {
        return true;
      },
    };

    // Three runner workers and three 400 ms requests: without the provider turn all three would run
    // inside the provider at once, and behind a queued worker the last would start its 1 s timer
    // 800 ms before the provider got to it.
    const summary = await runBenchmark({
      suites: [suiteWith(3)],
      providers: [provider],
      config: await configWith(3),
      version: "t",
    });

    expect(maxInFlight).toBe(1);
    expect(summary.rankings[0].errorCount).toBe(0);
  });

  it("releases a local model before preparing the next, also with several runner workers", async () => {
    const calls: string[] = [];
    const provider: STTProvider = {
      id: "mock-boundary",
      name: "Mock Boundary",
      type: "local",
      models: ["a", "b"],
      async prepare(model) {
        calls.push(`prepare ${model}`);
      },
      async release(model) {
        await new Promise((r) => setTimeout(r, 50));
        calls.push(`release ${model}`);
      },
      async transcribe(_audio, model) {
        await new Promise((r) => setTimeout(r, 100));
        calls.push(`transcribe ${model}`);
        return { text: "The quick brown fox jumps over the lazy dog", durationMs: 100, model };
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage() {
        return true;
      },
    };

    await runBenchmark({ suites: [suiteWith(3)], providers: [provider], config: await configWith(3), version: "t" });

    expect(calls.indexOf("release a")).toBeGreaterThan(calls.lastIndexOf("transcribe a"));
    expect(calls.indexOf("prepare b")).toBeGreaterThan(calls.indexOf("release a"));
    expect(calls.filter((call) => call === "transcribe b")).toHaveLength(3);
  });

  it("does not wait forever on a release that never answers", async () => {
    const provider: STTProvider = {
      id: "mock-stuck-release",
      name: "Mock Stuck Release",
      type: "local",
      models: ["a"],
      async prepare() {},
      release() {
        return new Promise<void>(() => {});
      },
      async transcribe(_audio, model) {
        return { text: "The quick brown fox jumps over the lazy dog", durationMs: 1, model };
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage() {
        return true;
      },
    };

    const summary = await runBenchmark({
      suites: [suiteWith(1)],
      providers: [provider],
      config: await configWith(1),
      version: "t",
    });
    expect(summary.rankings[0].errorCount).toBe(0);
  });

  it("does not reuse a cached transcript after the clip's audio changed", async () => {
    const audioDir = join(fileURLToPath(new URL("..", import.meta.url)), "audio");
    const dir = await createTempDir();
    const clip = join(dir, "clip.wav");
    await copyFile(join(audioDir, "samples-en/clean-01.wav"), clip);
    let calls = 0;
    const provider: STTProvider = {
      id: "mock-cache",
      name: "Mock Cache",
      type: "local",
      models: ["only"],
      async transcribe(_audio, model) {
        calls += 1;
        return { text: "The quick brown fox jumps over the lazy dog", durationMs: 1, model };
      },
      async isAvailable() {
        return true;
      },
      supportsLanguage() {
        return true;
      },
    };
    const suite = suiteWith(1);
    suite.tests[0].audioFile = relative(audioDir, clip);
    const config = await configWith(1);

    await runBenchmark({ suites: [suite], providers: [provider], config, version: "t" });
    await runBenchmark({ suites: [suite], providers: [provider], config, version: "t" });
    expect(calls).toBe(1);

    await copyFile(join(audioDir, "samples-en/clean-02.wav"), clip);
    await runBenchmark({ suites: [suite], providers: [provider], config, version: "t" });
    expect(calls).toBe(2);
  });
});
