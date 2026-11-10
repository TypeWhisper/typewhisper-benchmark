/**
 * Runs the macOS diarization engines over the set and writes one hypothesis file per engine to
 * bench/diarization/hypotheses/macos/<engineId>.json. Windows and iOS write the same file with
 * their own tools; `diarization-score` scores all of them.
 *
 * Engines run one at a time and files one at a time, so the processing times are comparable
 * within this machine. Times include reading the audio file, as the apps hand the diarizer a file.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { JsonLineWorker } from "../providers/json-line-worker.js";
import { machineInfo } from "../speed.js";
import { checkDiarizationAudio } from "./build-set.js";
import { DIARIZATION_AUDIO_DIR, DIARIZATION_HYPOTHESES_DIR, loadDiarizationSet } from "./score.js";
import {
  DIARIZATION_HYPOTHESIS_SCHEMA,
  type DiarizationHypothesisFile,
  type DiarizationHypothesisItem,
  type DiarizationMachine,
} from "./types.js";

const execFileAsync = promisify(execFile);
const WORKERS = {
  app: {
    label: "FluidAudio 0.17.5",
    runtime: "FluidAudio 0.17.5",
    package: fileURLToPath(new URL("../../fluidaudio-worker", import.meta.url)),
    binary: "FluidAudioWorker",
  },
  next: {
    label: "FluidAudio 0.18",
    runtime: "FluidAudio 0.18.0",
    package: fileURLToPath(new URL("../../fluidaudio-next-worker", import.meta.url)),
    binary: "FluidAudioNextWorker",
  },
} as const;

export interface MacDiarizationEngine {
  engineId: string;
  engineName: string;
  worker: keyof typeof WORKERS;
  model: string;
  shipped: boolean;
  /** Fields sent with every request besides id, model, load and diarize. */
  request: Record<string, string | number | boolean>;
  settings: DiarizationHypothesisFile["settings"];
}

const nemotron = (preset: string, note: string): MacDiarizationEngine => ({
  engineId: `nemotron3-${preset}`,
  engineName: `Nemotron 3 Diarization (${preset})`,
  worker: "next",
  model: `FluidInference/nemotron-3-diarization-coreml ${preset} (NVIDIA GA weights 2026-09-23)`,
  shipped: false,
  request: { model: "nemotron3-diarization", preset, computeUnits: "all" },
  settings: { preset, computeUnits: "all", threshold: 0.5, minTurnSeconds: 0.2, note },
});

export const MAC_DIARIZATION_ENGINES: MacDiarizationEngine[] = [
  {
    engineId: "fluidaudio-offline-0.7",
    engineName: "FluidAudio offline diarizer (TypeWhisper today)",
    worker: "app",
    model: "pyannote community-1 segmentation and embeddings, VBx clustering",
    shipped: true,
    request: { model: "offline-diarizer", threshold: 0.7 },
    settings: { clusteringThreshold: 0.7, dropUnbackedSegments: true },
  },
  nemotron("offline", "30.4 s latency, GPU, recorded files"),
  nemotron("fast128", "10.56 s latency"),
  nemotron("fast32", "2.88 s latency, FluidAudio's recommended default"),
  nemotron("low", "1.04 s latency, live"),
  nemotron("c128-split-w8a8", "10.56 s latency, 95 MB, ANE only"),
  nemotron("fast32-split-w8a8", "2.88 s latency, 95 MB, ANE only, FluidAudio's iPhone pick"),
];

async function macMachine(): Promise<DiarizationMachine> {
  const m = await machineInfo();
  return { model: m.model, chip: m.chip, memoryGb: m.memoryGb, os: m.os };
}

function makeWorker(kind: keyof typeof WORKERS): JsonLineWorker {
  const w = WORKERS[kind];
  return new JsonLineWorker(w.label, async () => {
    await execFileAsync("swift", ["build", "-c", "release", "--package-path", w.package], { maxBuffer: 64 * 1024 * 1024 });
    return { file: join(w.package, ".build", "release", w.binary), args: [] };
  });
}

export async function runMacDiarization(options: {
  engines?: string[];
  items?: string[];
  outDir?: string;
  skipChecksums?: boolean;
  /** Keep the files an earlier run of the engine finished and run only the others. */
  resume?: boolean;
  log?: (line: string) => void;
}): Promise<string[]> {
  const log = options.log ?? console.log;
  const set = await loadDiarizationSet();
  if (!options.skipChecksums) {
    const problems = await checkDiarizationAudio(set);
    if (problems.length) {
      throw new Error(`Audio does not match the set (run bench/scripts/download-diarization-set.sh):\n  ${problems.join("\n  ")}`);
    }
  }
  const engines = options.engines?.length
    ? MAC_DIARIZATION_ENGINES.filter((e) => options.engines!.includes(e.engineId))
    : MAC_DIARIZATION_ENGINES;
  if (options.engines?.length && engines.length !== options.engines.length) {
    const known = MAC_DIARIZATION_ENGINES.map((e) => e.engineId).join(", ");
    throw new Error(`Unknown engine in ${options.engines.join(", ")}; known: ${known}`);
  }
  const items = options.items?.length ? set.items.filter((i) => options.items!.some((p) => i.id.startsWith(p))) : set.items;
  const machine = await macMachine();
  const outDir = options.outDir ?? join(DIARIZATION_HYPOTHESES_DIR, "macos");
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  // Build the workers first, so the timed load below does not include compiling them.
  for (const kind of new Set(engines.map((e) => e.worker))) {
    log(`building ${WORKERS[kind].label} worker`);
    await execFileAsync("swift", ["build", "-c", "release", "--package-path", WORKERS[kind].package], { maxBuffer: 64 * 1024 * 1024 });
  }

  for (const engine of engines) {
    const path = join(outDir, `${engine.engineId}.json`);
    const earlier = new Map<string, DiarizationHypothesisItem>();
    if (options.resume && existsSync(path)) {
      const file = JSON.parse(await readFile(path, "utf8")) as DiarizationHypothesisFile;
      if (file.machine.model !== machine.model || file.machine.chip !== machine.chip) {
        throw new Error(`${path} was measured on ${file.machine.model}; resume only on the same machine`);
      }
      for (const item of file.items) if (!item.error) earlier.set(item.id, item);
    }
    const todo = items.filter((item) => !earlier.has(item.id));
    if (!todo.length) {
      log(`${engine.engineId}: all ${items.length} files done`);
      written.push(path);
      continue;
    }
    // A fresh worker per engine, so one engine's loaded models do not slow the next.
    const worker = makeWorker(engine.worker);
    try {
      log(`${engine.engineId}: loading`);
      const loadStart = performance.now();
      const loaded = await worker.request({ ...engine.request, load: true }, 30 * 60_000);
      if (loaded.error) throw new Error(`${engine.engineId} failed to load: ${loaded.error}`);
      const prepareMs = performance.now() - loadStart;

      const results = new Map(earlier);
      for (const item of todo) {
        // Generous: AMI meetings run up to 50 minutes and the slowest engine runs at ~30x.
        const timeoutMs = Math.max(120_000, item.seconds * 1000);
        const res = (await worker.request(
          { ...engine.request, diarize: join(DIARIZATION_AUDIO_DIR, item.audio) },
          timeoutMs
        )) as { error?: string; durationMs?: number; turns?: [number, number, string][] };
        if (res.error || !res.turns) {
          results.set(item.id, { id: item.id, turns: [], processingMs: 0, error: res.error ?? "no turns" });
          log(`  ${item.id}: ERROR ${res.error}`);
          continue;
        }
        const turns = res.turns.map(([s, e, spk]) => [round(s), round(e), String(spk)] as [number, number, string]);
        results.set(item.id, { id: item.id, turns, processingMs: round(res.durationMs ?? 0, 1) });
        const speakers = new Set(turns.map((t) => t[2])).size;
        log(`  ${item.id}: ${speakers}/${item.speakers} speakers, ${(item.seconds / ((res.durationMs ?? 1) / 1000)).toFixed(0)}x`);
      }

      const file: DiarizationHypothesisFile = {
        schema: DIARIZATION_HYPOTHESIS_SCHEMA,
        setId: set.id,
        platform: "macos",
        engineId: engine.engineId,
        engineName: engine.engineName,
        runtime: WORKERS[engine.worker].runtime,
        model: engine.model,
        shipped: engine.shipped,
        settings: engine.settings,
        machine,
        measuredAt: new Date().toISOString(),
        prepareMs: round(prepareMs, 1),
        // Set order, so a resumed file reads the same as one from a single run.
        items: set.items.filter((i) => results.has(i.id)).map((i) => results.get(i.id)!),
      };
      await writeFile(path, JSON.stringify(file) + "\n");
      written.push(path);
      log(`${engine.engineId}: wrote ${path}`);
    } finally {
      worker.dispose();
    }
  }
  return written;
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
