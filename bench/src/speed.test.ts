import { existsSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSpeedLock,
  foreignProcesses,
  isBenchProcess,
  isReferenceMachine,
  loadSpeedSet,
  parseProcessTable,
  speedLanguage,
  speedLockHolder,
  summarizeSpeed,
  type SpeedClipResult,
} from "./speed.js";
import type { STTProvider } from "./types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function clip(bucket: SpeedClipResult["bucket"], audioSeconds: number, wallMs: number[], engineMs = wallMs, wer: number | null = 0.1): SpeedClipResult {
  return { suite: "s", testId: `${bucket}-${audioSeconds}`, bucket, audioSeconds, wallMs, engineMs, wer };
}

describe("summarizeSpeed", () => {
  it("divides audio time by the sum of each clip's median time", () => {
    const summary = summarizeSpeed([
      clip("short", 4, [100, 400, 200]), // median 200
      clip("long", 16, [800, 790, 5000]), // median 800
    ]);
    // 20 s of audio in 1 s of processing
    expect(summary.speedFactor).toBe(20);
    expect(summary.buckets.short).toMatchObject({ clips: 1, audioSeconds: 4, medianMs: 200, speedFactor: 20 });
    expect(summary.buckets.long).toMatchObject({ clips: 1, medianMs: 800, speedFactor: 20 });
    expect(summary.buckets.medium.clips).toBe(0);
    expect(summary.wer).toBe(0.1);
  });

  it("reports the spread between pass totals", () => {
    const summary = summarizeSpeed([clip("short", 4, [100, 110, 120]), clip("short", 4, [100, 100, 100])]);
    // totals 200, 210, 220: (220 - 200) / 210
    expect(summary.passSpread).toBeCloseTo(0.0952, 3);
  });

  it("leaves the engine speed out when a runtime reports no time", () => {
    expect(summarizeSpeed([clip("short", 4, [100], [0])]).engineSpeedFactor).toBeNull();
    expect(summarizeSpeed([clip("short", 4, [100], [50])]).engineSpeedFactor).toBe(80);
  });

  it("drops the WER check for another language hint", () => {
    expect(summarizeSpeed([clip("short", 4, [100])], false).wer).toBeNull();
  });
});

describe("speedLanguage", () => {
  const provider = (languages: string[]) =>
    ({ supportsLanguage: (_model: string, language: string) => languages.includes(language) }) as unknown as STTProvider;

  it("prefers the set's language and falls back for models without it", () => {
    expect(speedLanguage(provider(["en", "de"]), "m", "en")).toBe("en");
    expect(speedLanguage(provider(["ru"]), "m", "en")).toBe("ru");
    expect(speedLanguage(provider([]), "m", "en")).toBeNull();
  });
});

describe("processes", () => {
  it("recognizes other benchmark runs and model workers", () => {
    expect(isBenchProcess("node --import loader.mjs /Users/x/typewhisper-benchmark/bench/src/cli.ts run")).toBe(true);
    expect(isBenchProcess("uv run --script /x/bench/scripts/mlx-audio-worker.py")).toBe(true);
    expect(isBenchProcess("/x/.build/release/FluidAudioWorker")).toBe(true);
    expect(isBenchProcess("/opt/homebrew/bin/llama-server -m x.gguf")).toBe(true);
    expect(isBenchProcess("node /other/project/src/cli.ts")).toBe(false);
    expect(isBenchProcess("/opt/homebrew/bin/bash -c pgrep -f 'typewhisper-benchmark.*src/cli.ts speed'")).toBe(false);
    expect(isBenchProcess("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).toBe(false);
  });

  it("ignores its own ancestors and workers but not siblings", () => {
    const rows = parseProcessTable(
      [
        "  1     0  0.0 /sbin/launchd",
        " 10     1  0.0 -bash",
        " 20    10  0.1 npm run bench -- speed",
        " 30    20  1.0 node src/cli.ts speed",
        " 40    30 90.0 uv run --script mlx-audio-worker.py",
        " 41    40 90.0 python mlx-audio-worker.py",
        " 50    10 80.0 /usr/bin/node typewhisper-benchmark/src/cli.ts run",
      ].join("\n")
    );
    expect(foreignProcesses(rows, 30).map((row) => row.pid)).toEqual([50]);
  });
});

describe("speed lock", () => {
  it("lets one run hold the lock and clears a stale one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "speed-lock-"));
    tempDirs.push(dir);
    const path = join(dir, "speed.lock");

    const release = await acquireSpeedLock(path);
    expect(await speedLockHolder(path)).toBe(process.pid);
    await expect(acquireSpeedLock(path)).rejects.toThrow(/Another speed run/);
    await release();
    expect(existsSync(path)).toBe(false);

    await writeFile(path, "999999999");
    expect(await speedLockHolder(path)).toBeNull();
    const again = await acquireSpeedLock(path);
    await again();
  });
});

describe("speed set", () => {
  it("has ten clips of each length, all on disk", async () => {
    const set = await loadSpeedSet();
    expect(set.clips).toHaveLength(30);
    for (const bucket of ["short", "medium", "long"]) {
      expect(set.clips.filter((entry) => entry.bucket === bucket)).toHaveLength(10);
    }
    expect(new Set(set.clips.map((entry) => entry.testId)).size).toBe(30);
    for (const entry of set.clips) expect(existsSync(join(__dirname, "..", "audio", entry.audioFile))).toBe(true);
  });
});

describe("isReferenceMachine", () => {
  it("accepts only the Mac mini M5 Pro with 48 GB", () => {
    expect(isReferenceMachine({ model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 48 })).toBe(true);
    expect(isReferenceMachine({ model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 64 })).toBe(false);
  });
});
