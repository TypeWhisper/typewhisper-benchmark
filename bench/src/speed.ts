/**
 * Speed benchmark for local models.
 *
 * Every model transcribes the same fixed clip set (speed/speed-set.json) on the reference machine,
 * one model and one clip at a time: load the model, warm it up, then time several passes over the
 * set. The headline number is the speed factor, audio seconds transcribed per second of processing
 * (higher is better), from the median time of each clip over the passes.
 *
 * Times are wall-clock times around provider.transcribe() in this process, so every runtime is
 * measured the same way: from handing over the audio file to getting the text back. The time the
 * runtime reports itself is kept as engineMs.
 *
 * Measurements disturb each other, so a lock file keeps a second speed run out, the run refuses to
 * start next to another benchmark process, and it waits for the machine to be idle before every model.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { link, mkdir, open, readFile, stat, unlink, writeFile } from "fs/promises";
import { loadavg, tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { getAudioInfo } from "./audio.js";
import { computeMetrics } from "./metrics/index.js";
import type { STTProvider, TestSuite } from "./types.js";

const execFileAsync = promisify(execFile);
const BENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SPEED_SCHEMA = 1;
export const SPEED_SET_PATH = join(BENCH_ROOT, "speed", "speed-set.json");
export const SPEED_RESULTS_DIR = join(BENCH_ROOT, "..", "visualizer", "public", "data", "speed");
/** Runs on other machines go here, so they never replace a published result. */
export const SPEED_OTHER_RESULTS_DIR = join(BENCH_ROOT, "results", "speed");
export const SPEED_LOCK_PATH = join(tmpdir(), "typewhisper-bench-speed.lock");

/** The machine all published speeds come from: the Mac mini (M5 Pro, 48 GB). */
export const REFERENCE_MACHINE = { model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 48 } as const;

export type SpeedBucket = "short" | "medium" | "long";
export const SPEED_BUCKETS: SpeedBucket[] = ["short", "medium", "long"];

export interface SpeedClip {
  suite: string;
  testId: string;
  audioFile: string;
  seconds: number;
  bucket: SpeedBucket;
}

export interface SpeedSet {
  id: string;
  description: string;
  language: string;
  audioSeconds: number;
  clips: SpeedClip[];
}

export interface MachineInfo {
  model: string;
  chip: string;
  memoryGb: number;
  cores: number;
  os: string;
  lowPowerMode: boolean | null;
}

export interface SpeedClipResult {
  suite: string;
  testId: string;
  bucket: SpeedBucket;
  audioSeconds: number;
  /** Wall-clock time per pass. */
  wallMs: number[];
  /** Time the runtime reported per pass (0 when it reports none). */
  engineMs: number[];
  /** Normalized WER of the first pass, a check that the model really transcribed. */
  wer: number | null;
}

export interface BucketSummary {
  clips: number;
  audioSeconds: number;
  /** Median over the bucket's clips of each clip's median time. */
  medianMs: number;
  speedFactor: number;
}

export interface SpeedSummary {
  /** Audio seconds per second of processing over the whole set, from per-clip medians. */
  speedFactor: number;
  /** The same from the times the runtime reported, when it reports them for every clip. */
  engineSpeedFactor: number | null;
  buckets: Record<SpeedBucket, BucketSummary>;
  /** (slowest pass - fastest pass) / median pass, over total time per pass. */
  passSpread: number;
  /** Mean normalized WER of the first pass; null when the language hint is not the set's language. */
  wer: number | null;
}

export interface ProcessLoad {
  pid: number;
  cpu: number;
  command: string;
}

export interface SpeedConditions {
  loadBefore: number[];
  loadAfter: number[];
  /** Other processes above 10% CPU right before the model was measured. */
  busyProcesses: ProcessLoad[];
}

export interface SpeedReport {
  schema: number;
  providerId: string;
  model: string;
  providerType: STTProvider["type"];
  speedSet: { id: string; clips: number; audioSeconds: number };
  /** Language hint passed with the (English) clips; another one only for models without English. */
  language: string;
  machine: MachineInfo;
  measuredAt: string;
  settings: { passes: number; warmupClips: number; timeoutSeconds: number };
  /** Time of provider.prepare(): model load, plus a download if the model was not cached. */
  prepareMs: number;
  summary: SpeedSummary;
  conditions: SpeedConditions;
  clips: SpeedClipResult[];
}

/* ------------------------------------------------------------------------------------------ */
/* Pure helpers                                                                                */
/* ------------------------------------------------------------------------------------------ */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Audio seconds per processing second, from each clip's median time. */
function factor(clips: SpeedClipResult[], times: (clip: SpeedClipResult) => number[]): number {
  const audio = clips.reduce((sum, clip) => sum + clip.audioSeconds, 0);
  const processing = clips.reduce((sum, clip) => sum + median(times(clip)), 0) / 1000;
  return processing > 0 ? audio / processing : 0;
}

export function summarizeSpeed(clips: SpeedClipResult[], checkWer = true): SpeedSummary {
  const buckets = {} as Record<SpeedBucket, BucketSummary>;
  for (const bucket of SPEED_BUCKETS) {
    const inBucket = clips.filter((clip) => clip.bucket === bucket);
    buckets[bucket] = {
      clips: inBucket.length,
      audioSeconds: round(inBucket.reduce((sum, clip) => sum + clip.audioSeconds, 0), 2),
      medianMs: round(median(inBucket.map((clip) => median(clip.wallMs))), 1),
      speedFactor: round(factor(inBucket, (clip) => clip.wallMs), 2),
    };
  }

  const passes = Math.max(0, ...clips.map((clip) => clip.wallMs.length));
  const passTotals = Array.from({ length: passes }, (_, pass) =>
    clips.reduce((sum, clip) => sum + (clip.wallMs[pass] ?? 0), 0)
  );
  const middle = median(passTotals);
  const passSpread = middle > 0 ? (Math.max(...passTotals) - Math.min(...passTotals)) / middle : 0;

  const engineReported = clips.length > 0 && clips.every((clip) => clip.engineMs.every((ms) => ms > 0));
  const wers = clips.map((clip) => clip.wer).filter((wer): wer is number => wer != null);

  return {
    speedFactor: round(factor(clips, (clip) => clip.wallMs), 2),
    engineSpeedFactor: engineReported ? round(factor(clips, (clip) => clip.engineMs), 2) : null,
    buckets,
    passSpread: round(passSpread, 4),
    wer: checkWer && wers.length ? round(wers.reduce((sum, wer) => sum + wer, 0) / wers.length, 4) : null,
  };
}

/** The set's language if the model supports it, else the first supported fallback. */
export function speedLanguage(provider: STTProvider, model: string, setLanguage: string): string | null {
  for (const language of [setLanguage, "en", "de", "ru"]) {
    if (provider.supportsLanguage(model, language)) return language;
  }
  return null;
}

export function speedFileName(providerId: string, model: string): string {
  return `${providerId}_${model}.json`;
}

type MachineIdentity = Pick<MachineInfo, "model" | "chip" | "memoryGb">;

export function sameMachine(a: MachineIdentity, b: MachineIdentity): boolean {
  return a.model === b.model && a.chip === b.chip && a.memoryGb === b.memoryGb;
}

export function isReferenceMachine(machine: MachineIdentity): boolean {
  return sameMachine(machine, REFERENCE_MACHINE);
}

/** Where a run on this machine reads and writes its results. */
export function speedResultsDir(machine: MachineIdentity): string {
  return isReferenceMachine(machine) ? SPEED_RESULTS_DIR : SPEED_OTHER_RESULTS_DIR;
}

/** Commands of other benchmark runs or model workers that would compete for the machine. */
const BENCH_PROCESS_PATTERNS = [
  // Only a node or tsx process running the CLI, not a shell whose command line merely mentions it.
  /^\S*\b(node|tsx)\s.*(typewhisper-benchmark|stt-bench).*src\/cli\.ts/,
  /-worker\.(py|swift)\b/,
  /\bFluidAudio(Next)?Worker\b/,
  /\bParakeetProbe\b/,
  /\bwhisper-(cli|server)\b/,
  /\bcrispasr\b/i,
  /\baudiocpp_server\b/,
  /\bllama-server\b/,
  /\bspeech-analyzer-worker\b/,
];

export function isBenchProcess(command: string): boolean {
  return BENCH_PROCESS_PATTERNS.some((pattern) => pattern.test(command));
}

export interface ProcessRow extends ProcessLoad {
  ppid: number;
}

export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), command: match[4] });
  }
  return rows;
}

/** Processes outside this process's own tree (its ancestors, itself and its workers). */
export function foreignProcesses(rows: ProcessRow[], ownPid: number): ProcessRow[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const ancestors = new Set<number>();
  for (let pid = ownPid; pid && !ancestors.has(pid); pid = byPid.get(pid)?.ppid ?? 0) ancestors.add(pid);
  const descends = (row: ProcessRow) => {
    const seen = new Set<number>();
    for (let pid = row.ppid; pid && !seen.has(pid); pid = byPid.get(pid)?.ppid ?? 0) {
      if (pid === ownPid) return true;
      seen.add(pid);
    }
    return false;
  };
  return rows.filter((row) => !ancestors.has(row.pid) && !descends(row));
}

/* ------------------------------------------------------------------------------------------ */
/* Machine state                                                                               */
/* ------------------------------------------------------------------------------------------ */

async function run(file: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync(file, args)).stdout.trim();
  } catch {
    return "";
  }
}

export async function machineInfo(): Promise<MachineInfo> {
  const [model, chip, memory, cores, os, power] = await Promise.all([
    run("sysctl", ["-n", "hw.model"]),
    run("sysctl", ["-n", "machdep.cpu.brand_string"]),
    run("sysctl", ["-n", "hw.memsize"]),
    run("sysctl", ["-n", "hw.ncpu"]),
    run("sw_vers", ["-productVersion"]),
    run("pmset", ["-g"]),
  ]);
  // Laptops report lowpowermode; desktops powermode (0 automatic, 1 low power, 2 high power).
  const lowPower = power.match(/\b(?:lowpowermode|powermode)\s+(\d)/);
  return {
    model,
    chip,
    memoryGb: Math.round(Number(memory) / 2 ** 30),
    cores: Number(cores),
    os: os ? `macOS ${os}` : "",
    lowPowerMode: lowPower ? lowPower[1] === "1" : null,
  };
}

async function processTable(): Promise<ProcessRow[]> {
  return parseProcessTable(await run("ps", ["-axo", "pid=,ppid=,pcpu=,command="]));
}

/** Benchmark processes that are not part of this run. */
export async function otherBenchProcesses(): Promise<ProcessRow[]> {
  return foreignProcesses(await processTable(), process.pid).filter((row) => isBenchProcess(row.command));
}

/** Other processes above 10% CPU, by program name only: command lines can hold paths or tokens. */
async function busyProcesses(): Promise<ProcessLoad[]> {
  const foreign = new Set(foreignProcesses(await processTable(), process.pid).map((row) => row.pid));
  return parseProcessTable(await run("ps", ["-axo", "pid=,ppid=,pcpu=,comm="]))
    .filter((row) => foreign.has(row.pid) && row.cpu >= 10)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 8)
    .map(({ pid, cpu, command }) => ({ pid, cpu, command: basename(command) }));
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export interface IdleOptions {
  /** Highest 1-minute load average to start a model at. */
  maxLoad: number;
  maxWaitMs: number;
  /** Start anyway after maxWaitMs instead of failing. */
  force: boolean;
  log: (message: string) => void;
}

/** Waits until no other benchmark runs and the load average is low enough. */
export async function waitForIdle(options: IdleOptions): Promise<void> {
  const deadline = Date.now() + options.maxWaitMs;
  let reported = "";
  for (;;) {
    const others = await otherBenchProcesses();
    const load = loadavg()[0];
    const reasons: string[] = [];
    if (others.length) reasons.push(`other benchmark processes: ${others.map((row) => `${row.pid} ${row.command.slice(0, 80)}`).join("; ")}`);
    if (load > options.maxLoad) reasons.push(`load average ${load.toFixed(2)} > ${options.maxLoad}`);
    if (!reasons.length) return;
    if (Date.now() >= deadline) {
      const message = `Machine not idle: ${reasons.join(", ")}`;
      if (options.force) {
        options.log(`${message} (continuing, --force)`);
        return;
      }
      throw new Error(message);
    }
    const summary = reasons.join(", ");
    if (summary !== reported) options.log(`Waiting for an idle machine: ${summary}`);
    reported = summary;
    await sleep(10_000);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Lock                                                                                        */
/* ------------------------------------------------------------------------------------------ */

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid written in the lock, or null when there is no lock file. */
async function lockPid(path: string): Promise<number | null> {
  try {
    return Number((await readFile(path, "utf-8")).trim()) || 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The pid holding the speed lock, or null when no live process holds it. */
export async function speedLockHolder(path = SPEED_LOCK_PATH): Promise<number | null> {
  const pid = await lockPid(path);
  return pid && alive(pid) ? pid : null;
}

const REAP_GRACE_MS = 10_000;

/** Creates the lock with this process's pid already in it, so no run ever sees an empty lock. */
async function createLock(path: string): Promise<boolean> {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, String(process.pid));
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

/**
 * Removes the lock of a run that died. Runs take turns through a second lock, and only a run
 * holding it may delete the speed lock, so no run deletes a lock that another run just took.
 */
async function removeStaleLock(path: string): Promise<void> {
  const reap = `${path}.reap`;
  let handle;
  try {
    handle = await open(reap, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Another run is removing it. A reap lock this old belongs to a run that died meanwhile.
    const since = await stat(reap).then((info) => Date.now() - info.mtimeMs, () => 0);
    if (since > REAP_GRACE_MS) await unlink(reap).catch(() => undefined);
    else await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    return;
  }
  try {
    const pid = await lockPid(path);
    if (pid !== null && !(pid && alive(pid))) await unlink(path).catch(() => undefined);
  } finally {
    await handle.close();
    await unlink(reap).catch(() => undefined);
  }
}

/** Takes the speed lock, so a second speed run cannot measure at the same time. */
export async function acquireSpeedLock(path = SPEED_LOCK_PATH): Promise<() => Promise<void>> {
  // Long enough to outlast the grace period of a reap lock left by a run that died.
  const deadline = Date.now() + 2 * REAP_GRACE_MS;
  while (Date.now() < deadline) {
    if (await createLock(path)) {
      return async () => {
        if ((await lockPid(path)) === process.pid) await unlink(path).catch(() => undefined);
      };
    }
    const holder = await speedLockHolder(path);
    if (holder) throw new Error(`Another speed run (pid ${holder}) holds ${path}`);
    await removeStaleLock(path);
  }
  throw new Error(`Could not take ${path}`);
}

/* ------------------------------------------------------------------------------------------ */
/* Measurement                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export async function loadSpeedSet(path = SPEED_SET_PATH): Promise<SpeedSet> {
  return JSON.parse(await readFile(path, "utf-8")) as SpeedSet;
}

async function loadReferences(set: SpeedSet): Promise<Map<string, string>> {
  const references = new Map<string, string>();
  for (const suiteId of new Set(set.clips.map((clip) => clip.suite))) {
    const path = join(BENCH_ROOT, "tests", `${suiteId}.json`);
    if (!existsSync(path)) continue;
    const suite = JSON.parse(await readFile(path, "utf-8")) as TestSuite;
    for (const test of suite.tests) references.set(`${suiteId}\u0000${test.id}`, test.groundTruth);
  }
  return references;
}

async function withTimeout<T>(promise: Promise<T>, seconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${seconds} s`)), seconds * 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface MeasureOptions {
  passes: number;
  warmupClips: number;
  timeoutSeconds: number;
  machine: MachineInfo;
  idle: IdleOptions;
  /** Pause after the idle check, so the previous model's load has settled. */
  settleMs: number;
  log: (message: string) => void;
  /** Called after every timed clip, e.g. for a progress bar. */
  onClip?: (done: number, total: number) => void;
}

/** Measures one model. Throws when a clip fails, since a partial set gives no comparable speed. */
export async function measureModel(
  provider: STTProvider,
  model: string,
  set: SpeedSet,
  options: MeasureOptions
): Promise<SpeedReport> {
  const language = speedLanguage(provider, model, set.language);
  if (!language) throw new Error(`${provider.id}/${model} supports none of en, de, ru`);

  await waitForIdle(options.idle);
  if (options.settleMs > 0) await sleep(options.settleMs);
  const loadBefore = loadavg().map((value) => round(value, 2));
  const busy = await busyProcesses();

  const audio = await Promise.all(
    set.clips.map((clip) => getAudioInfo(join(BENCH_ROOT, "audio", clip.audioFile), language))
  );
  const references = await loadReferences(set);

  const prepareStart = performance.now();
  await provider.prepare?.(model);
  const prepareMs = Math.round(performance.now() - prepareStart);

  // One clip of each length first, untimed: the first requests compile kernels and fill caches.
  const warmup = SPEED_BUCKETS.flatMap((bucket) => {
    const index = set.clips.findIndex((clip) => clip.bucket === bucket);
    return index >= 0 ? [index] : [];
  }).slice(0, options.warmupClips);
  for (const index of warmup) {
    await withTimeout(provider.transcribe(audio[index], model), options.timeoutSeconds);
  }

  const results: SpeedClipResult[] = set.clips.map((clip) => ({
    suite: clip.suite,
    testId: clip.testId,
    bucket: clip.bucket,
    audioSeconds: round(audio[set.clips.indexOf(clip)].durationSeconds || clip.seconds, 3),
    wallMs: [],
    engineMs: [],
    wer: null,
  }));

  const total = options.passes * set.clips.length;
  let done = 0;
  for (let pass = 0; pass < options.passes; pass++) {
    for (let index = 0; index < set.clips.length; index++) {
      const clip = set.clips[index];
      const start = performance.now();
      let text: string;
      let engineMs: number;
      try {
        const result = await withTimeout(provider.transcribe(audio[index], model), options.timeoutSeconds);
        text = result.text;
        engineMs = result.durationMs;
      } catch (error) {
        throw new Error(`${clip.testId} (pass ${pass + 1}): ${(error as Error).message}`);
      }
      const wallMs = performance.now() - start;
      results[index].wallMs.push(round(wallMs, 1));
      results[index].engineMs.push(round(engineMs ?? 0, 1));
      if (pass === 0) {
        const reference = references.get(`${clip.suite}\u0000${clip.testId}`);
        if (reference != null) {
          results[index].wer = round(
            computeMetrics({ reference, hypothesis: text, language: set.language }).werNormalized,
            4
          );
        }
      }
      options.onClip?.(++done, total);
    }
  }

  return {
    schema: SPEED_SCHEMA,
    providerId: provider.id,
    model,
    providerType: provider.type,
    speedSet: { id: set.id, clips: set.clips.length, audioSeconds: set.audioSeconds },
    language,
    machine: options.machine,
    measuredAt: new Date().toISOString(),
    settings: { passes: options.passes, warmupClips: warmup.length, timeoutSeconds: options.timeoutSeconds },
    prepareMs,
    summary: summarizeSpeed(results, language === set.language),
    conditions: { loadBefore, loadAfter: loadavg().map((value) => round(value, 2)), busyProcesses: busy },
    clips: results,
  };
}

export async function readSpeedReport(dir: string, providerId: string, model: string): Promise<SpeedReport | null> {
  const path = join(dir, speedFileName(providerId, model));
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8")) as SpeedReport;
  } catch {
    return null;
  }
}

export async function writeSpeedReport(dir: string, report: SpeedReport): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, speedFileName(report.providerId, report.model));
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return path;
}
