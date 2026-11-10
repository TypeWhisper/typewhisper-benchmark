/**
 * Scores hypothesis files from any platform against the set's references and writes one report
 * per engine to visualizer/public/data/diarization/<platform>/<engineId>.json.
 */
import { createHash } from "crypto";
import { createReadStream, existsSync } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { computeDer, parseRttm, parseUem, poolDer, type Region, type Turn } from "./der.js";
import {
  DIARIZATION_GROUPS,
  DIARIZATION_REFERENCES,
  DIARIZATION_HYPOTHESIS_SCHEMA,
  DIARIZATION_PLATFORMS,
  DIARIZATION_REPORT_SCHEMA,
  type DiarizationGroupSummary,
  type DiarizationHypothesisFile,
  type DiarizationItemReport,
  type DiarizationReport,
  type DiarizationReferenceId,
  type DiarizationScore,
  type DiarizationScores,
  type DiarizationSet,
  type DiarizationSetItem,
} from "./types.js";

const BENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIARIZATION_DIR = join(BENCH_ROOT, "diarization");
export const DIARIZATION_SET_PATH = join(DIARIZATION_DIR, "diarization-set.json");
export const DIARIZATION_REFERENCES_DIR = join(DIARIZATION_DIR, "references");
export const DIARIZATION_HYPOTHESES_DIR = join(DIARIZATION_DIR, "hypotheses");
export const DIARIZATION_AUDIO_DIR = join(BENCH_ROOT, "audio", "datasets", "diarization");
export const DIARIZATION_REPORTS_DIR = join(BENCH_ROOT, "..", "visualizer", "public", "data", "diarization");

export async function loadDiarizationSet(path = DIARIZATION_SET_PATH): Promise<DiarizationSet> {
  return JSON.parse(await readFile(path, "utf8")) as DiarizationSet;
}

export interface LoadedReference {
  /** Turns per reference convention, in the set's order; the first is the primary one. */
  turns: [DiarizationReferenceId, Turn[]][];
  uem: Region[] | null;
}

export async function loadReference(item: DiarizationSetItem, root = DIARIZATION_REFERENCES_DIR): Promise<LoadedReference> {
  const turns: [DiarizationReferenceId, Turn[]][] = [];
  for (const [id, path] of Object.entries(item.references) as [DiarizationReferenceId, string][]) {
    turns.push([id, parseRttm(await readFile(join(root, path), "utf8"))]);
  }
  if (!turns.length) throw new Error(`${item.id} has no reference`);
  const uem = item.uem ? parseUem(await readFile(join(root, item.uem), "utf8")) : null;
  return { turns, uem };
}

function scoreAgainst(ref: LoadedReference, hypothesis: Turn[]): Partial<Record<DiarizationReferenceId, DiarizationScores>> {
  const scores: Partial<Record<DiarizationReferenceId, DiarizationScores>> = {};
  for (const [id, turns] of ref.turns) {
    scores[id] = {
      collar0: score(computeDer(turns, hypothesis, { uem: ref.uem })),
      collar25: score(computeDer(turns, hypothesis, { uem: ref.uem, collar: 0.25 })),
    };
  }
  return scores;
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function score(components: { total: number; missed: number; falseAlarm: number; confusion: number }): DiarizationScore {
  const errors = components.missed + components.falseAlarm + components.confusion;
  return {
    total: round(components.total),
    missed: round(components.missed),
    falseAlarm: round(components.falseAlarm),
    confusion: round(components.confusion),
    der: components.total > 0 ? round(errors / components.total, 5) : 0,
  };
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Checks the fields every platform must fill, so a bad file fails with a clear message. */
export function validateHypothesis(file: DiarizationHypothesisFile, set: DiarizationSet): string[] {
  const problems: string[] = [];
  if (file.schema !== DIARIZATION_HYPOTHESIS_SCHEMA) problems.push(`schema ${file.schema}, expected ${DIARIZATION_HYPOTHESIS_SCHEMA}`);
  if (file.setId !== set.id) problems.push(`setId ${file.setId}, expected ${set.id}`);
  if (!DIARIZATION_PLATFORMS.includes(file.platform)) problems.push(`unknown platform ${file.platform}`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(file.engineId ?? "")) problems.push(`engineId must be lower-case [a-z0-9._-]: ${file.engineId}`);
  for (const key of ["engineName", "runtime", "model", "measuredAt"] as const) {
    if (typeof file[key] !== "string" || !file[key]) problems.push(`missing ${key}`);
  }
  if (!file.machine?.model || !file.machine?.chip || !file.machine?.os) problems.push("machine needs model, chip and os");
  const ids = new Set(set.items.map((i) => i.id));
  const seen = new Set<string>();
  for (const item of file.items ?? []) {
    if (!ids.has(item.id)) problems.push(`unknown item ${item.id}`);
    if (seen.has(item.id)) problems.push(`duplicate item ${item.id}`);
    seen.add(item.id);
    if (!item.error) {
      if (!Array.isArray(item.turns)) problems.push(`${item.id}: no turns`);
      else if (item.turns.some((t) => !(Number.isFinite(t[0]) && Number.isFinite(t[1]) && t[1] >= t[0] && typeof t[2] === "string")))
        problems.push(`${item.id}: turns must be [start, end, speaker] with end >= start`);
      if (!(item.processingMs > 0)) problems.push(`${item.id}: processingMs must be > 0`);
    }
  }
  return problems;
}

export async function scoreHypothesis(
  file: DiarizationHypothesisFile,
  set: DiarizationSet,
  references: Map<string, LoadedReference>
): Promise<DiarizationReport> {
  const problems = validateHypothesis(file, set);
  if (problems.length) throw new Error(`${file.platform}/${file.engineId}: ${problems.join("; ")}`);
  const byId = new Map(file.items.map((i) => [i.id, i]));
  const items: DiarizationItemReport[] = [];
  for (const setItem of set.items) {
    const hyp = byId.get(setItem.id);
    const ref = references.get(setItem.id)!;
    const refSpeakers = new Set(ref.turns[0][1].map((t) => t.speaker)).size;
    if (!hyp || hyp.error) {
      // A missing or failed file scores as all speech missed, so failures cannot improve a score.
      items.push({
        id: setItem.id,
        group: setItem.group,
        language: setItem.language,
        audioSeconds: setItem.seconds,
        processingMs: 0,
        peakMemoryMb: null,
        speakers: { reference: refSpeakers, found: 0 },
        scores: scoreAgainst(ref, []),
        error: hyp?.error ?? "not run",
      });
      continue;
    }
    const turns: Turn[] = hyp.turns.map(([start, end, speaker]) => ({ start, end, speaker }));
    items.push({
      id: setItem.id,
      group: setItem.group,
      language: setItem.language,
      audioSeconds: setItem.seconds,
      processingMs: round(hyp.processingMs, 1),
      peakMemoryMb: hyp.peakMemoryMb ?? null,
      speakers: { reference: refSpeakers, found: new Set(turns.filter((t) => t.end > t.start).map((t) => t.speaker)).size },
      scores: scoreAgainst(ref, turns),
    });
  }

  const summary = {} as Record<(typeof DIARIZATION_GROUPS)[number], DiarizationGroupSummary>;
  for (const group of DIARIZATION_GROUPS) summary[group] = summarize(items.filter((i) => i.group === group));

  return {
    schema: DIARIZATION_REPORT_SCHEMA,
    setId: file.setId,
    platform: file.platform,
    engineId: file.engineId,
    engineName: file.engineName,
    runtime: file.runtime,
    model: file.model,
    shipped: file.shipped,
    settings: file.settings,
    machine: file.machine,
    measuredAt: file.measuredAt,
    prepareMs: round(file.prepareMs, 1),
    scoring: {
      overlap: "included",
      collars: [0, 0.25],
      references: DIARIZATION_REFERENCES.filter((id) => items.some((i) => i.scores[id])),
    },
    summary,
    items,
  };
}

export function summarize(items: DiarizationItemReport[]): DiarizationGroupSummary {
  const ok = items.filter((i) => !i.error);
  const processingSeconds = ok.reduce((s, i) => s + i.processingMs, 0) / 1000;
  const okAudio = ok.reduce((s, i) => s + i.audioSeconds, 0);
  return {
    files: items.length,
    failed: items.length - ok.length,
    audioSeconds: round(items.reduce((s, i) => s + i.audioSeconds, 0), 1),
    scores: poolScores(items),
    speakerCountAccuracy: items.length ? round(items.filter((i) => i.speakers.found === i.speakers.reference).length / items.length, 4) : 0,
    speedFactor: processingSeconds > 0 ? round(okAudio / processingSeconds, 1) : 0,
  };
}

function poolScores(items: DiarizationItemReport[]): Partial<Record<DiarizationReferenceId, DiarizationScores>> {
  const scores: Partial<Record<DiarizationReferenceId, DiarizationScores>> = {};
  for (const id of DIARIZATION_REFERENCES) {
    const scored = items.filter((i) => i.scores[id]);
    if (!scored.length) continue;
    scores[id] = {
      collar0: score(poolDer(scored.map((i) => i.scores[id]!.collar0))),
      collar25: score(poolDer(scored.map((i) => i.scores[id]!.collar25))),
    };
  }
  return scores;
}

/** All hypothesis files below bench/diarization/hypotheses/<platform>/. */
export async function listHypothesisFiles(root = DIARIZATION_HYPOTHESES_DIR): Promise<string[]> {
  const files: string[] = [];
  for (const platform of DIARIZATION_PLATFORMS) {
    const dir = join(root, platform);
    if (!existsSync(dir)) continue;
    for (const name of (await readdir(dir)).sort()) if (name.endsWith(".json")) files.push(join(dir, name));
  }
  return files;
}

export async function loadReferences(set: DiarizationSet): Promise<Map<string, LoadedReference>> {
  const references = new Map<string, LoadedReference>();
  for (const item of set.items) references.set(item.id, await loadReference(item));
  return references;
}

/** Scores every hypothesis file and writes the reports. Returns the written paths. */
export async function scoreAll(options: { files?: string[]; outDir?: string } = {}): Promise<DiarizationReport[]> {
  const set = await loadDiarizationSet();
  const references = await loadReferences(set);
  const files = options.files ?? (await listHypothesisFiles());
  const reports: DiarizationReport[] = [];
  for (const path of files) {
    const file = JSON.parse(await readFile(path, "utf8")) as DiarizationHypothesisFile;
    const report = await scoreHypothesis(file, set, references);
    const outDir = join(options.outDir ?? DIARIZATION_REPORTS_DIR, report.platform);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${report.engineId}.json`), JSON.stringify(report, null, 2) + "\n");
    reports.push(report);
  }
  return reports;
}
