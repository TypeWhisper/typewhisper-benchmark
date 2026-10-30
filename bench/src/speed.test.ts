import { spawn } from "child_process";
import { existsSync } from "fs";
import { createServer, type AddressInfo } from "net";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  acquireSpeedLock,
  foreignProcesses,
  isBenchProcess,
  isReferenceMachine,
  loadSpeedSet,
  sameMachine,
  SPEED_OTHER_RESULTS_DIR,
  SPEED_RESULTS_DIR,
  speedResultsDir,
  parseProcessTable,
  speedLanguage,
  speedLockHolder,
  summarizeSpeed,
  type SpeedClipResult,
} from "./speed.js";
import type { STTProvider } from "./types.js";

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
  // A free port for each test, so the tests never touch a real speed run's lock.
  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    return port;
  }

  it("lets one run hold the lock and frees it on release", async () => {
    const port = await freePort();
    expect(await speedLockHolder(port)).toBeNull();
    const release = await acquireSpeedLock(port);
    expect(await speedLockHolder(port)).toBe(process.pid);
    await expect(acquireSpeedLock(port)).rejects.toThrow(/Another speed run/);
    await release();
    expect(await speedLockHolder(port)).toBeNull();
    await (await acquireSpeedLock(port))();
  });

  it("gives the lock to exactly one of several runs that start at once", async () => {
    const port = await freePort();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => acquireSpeedLock(port)));
    const taken = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(taken).toHaveLength(1);
    await (taken[0] as PromiseFulfilledResult<() => Promise<void>>).value();
  });

  it("is free again as soon as the holding process is killed", async () => {
    const port = await freePort();
    const holder = spawn(
      process.execPath,
      ["-e", `require("net").createServer((s) => s.end("typewhisper-speed " + process.pid)).listen(${port}, "127.0.0.1", () => console.log("ready"))`],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    await new Promise((resolveReady) => holder.stdout!.once("data", resolveReady));
    expect(await speedLockHolder(port)).toBe(holder.pid);
    await expect(acquireSpeedLock(port)).rejects.toThrow(new RegExp(`pid ${holder.pid}`));
    const exited = new Promise((resolveExit) => holder.once("exit", resolveExit));
    holder.kill("SIGKILL");
    await exited;
    await (await acquireSpeedLock(port))();
  });

  it("does not take another program on the port for a speed run", async () => {
    const port = await freePort();
    const other = createServer((socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    await new Promise<void>((resolveListen) => other.listen(port, "127.0.0.1", () => resolveListen()));
    expect(await speedLockHolder(port)).toBeNull();
    await expect(acquireSpeedLock(port)).rejects.toThrow(/in use by another program/);
    await new Promise<void>((resolveClose) => other.close(() => resolveClose()));
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

  it("keeps results from other machines out of the published folder", () => {
    const laptop = { model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 24 };
    expect(speedResultsDir({ model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 48 })).toBe(SPEED_RESULTS_DIR);
    expect(speedResultsDir(laptop)).toBe(SPEED_OTHER_RESULTS_DIR);
    expect(sameMachine(laptop, { ...laptop })).toBe(true);
    expect(sameMachine(laptop, { ...laptop, chip: "Apple M5 Max" })).toBe(false);
  });
});
