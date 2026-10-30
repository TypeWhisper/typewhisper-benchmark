#!/usr/bin/env node
/**
 * Builds the data the visualizer loads, from the runner's result files.
 *
 * Input (not changed here):
 *   public/data/results/<providerId>_<model>.json   one file per model, written by bench/src/runner.ts
 *   ../bench/tests/<suiteId>.json                    references (groundTruth) for transcripts and Digits
 *
 *   public/data/speed/<providerId>_<model>.json     speed runs of local models, written by `npm run bench -- speed`
 *
 * Output (gitignored, regenerated on every build and dev start):
 *   public/data/generated/summary.json               per model x suite aggregates, loaded on first paint
 *   public/data/generated/clips/<suiteId>.json       per-clip transcripts, loaded only by transcript views
 *
 * The aggregates keep means together with their counts, so the browser can pool any set of suites
 * the same way the PR tables do (mean over clips, not mean of suite means).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** "ok" also covers legacy rows from before the runner wrote a status. */
export function rowStatus(row) {
  if (row.status === "skipped") return "skip";
  if (row.status === "error" || row.error) return "err";
  return "ok";
}

/**
 * Number tokens of a reference: whitespace-separated tokens that contain a digit, without
 * trailing sentence punctuation ("2,400", "2:30", "15th", "$99.99", "15." -> "15").
 */
export function numberTokens(reference) {
  return reference
    .split(/\s+/)
    .filter((token) => /\d/.test(token))
    .map((token) => token.replace(/[.,;:!?]+$/, ""))
    .filter(Boolean);
}

/**
 * Runs of adjacent number tokens in a reference ("0171 345 6789", "+49 171 234 56"). A transcript
 * may write a run without its spaces; trailing punctuation ends a run.
 */
export function numberRuns(reference) {
  const runs = [];
  let run = [];
  for (const raw of reference.split(/\s+/)) {
    const token = /\d/.test(raw) ? raw.replace(/[.,;:!?]+$/, "") : "";
    if (token) run.push(token);
    if (!token || token !== raw) {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A pattern that matches only as a whole number: "4322" not inside "43220", "15" not inside "115" or "15,000". */
function wholeNumber(pattern) {
  return new RegExp(`(?<!\\d)(?<!\\d[.,:])${pattern}(?!\\d)(?![.,:]\\d)`);
}

export function containsNumber(transcript, token) {
  return wholeNumber(escapeRegExp(token)).test(transcript);
}

/**
 * Digits: every number of the reference appears verbatim, as a whole number, in the transcript.
 * A run of adjacent numbers also counts when written without the spaces between them.
 */
export function digitsHit(reference, transcript) {
  const runs = numberRuns(reference);
  if (runs.length === 0) return null;
  const text = transcript ?? "";
  return runs.every(
    (run) =>
      run.every((token) => containsNumber(text, token)) ||
      wholeNumber(run.map(escapeRegExp).join("\\s*")).test(text)
  );
}

const CATEGORY_PREFIXES = [
  ["clean-speech-", "clean-speech"],
  ["noisy-environment-", "noisy-environment"],
  ["accented-speech-", "accented-speech"],
  ["code-dictation-", "code-dictation"],
  ["whispered-lowquality-", "low-quality-audio"],
  ["code-switching-", "code-switching"],
  ["punctuation-formatting-", "punctuation-formatting"],
  ["number-formatting-", "number-formatting"],
  ["long-form-speech-", "long-form-speech"],
  ["hard-", "technical-jargon"],
];

export function inferCategory(suiteId) {
  return CATEGORY_PREFIXES.find(([prefix]) => suiteId.startsWith(prefix))?.[1] ?? "other";
}

export function inferLanguage(suiteId) {
  return suiteId.match(/-(de|en|ru|auto)$/)?.[1] ?? "other";
}

function inferTier(suiteId, category) {
  return suiteId.startsWith("hard-") || category === "code-dictation" || category === "code-switching"
    ? "diagnostic"
    : "core";
}

function inferOrigin(suiteId, category) {
  return suiteId.startsWith("clean-speech-") || category === "accented-speech" || category === "long-form-speech"
    ? "public"
    : "synthetic";
}

function titleCase(id) {
  return id
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Running sums for one model on one suite. */
function emptyAccumulator() {
  return {
    n: 0, ok: 0, err: 0, skip: 0,
    wer: 0, cer: 0, ms: 0, rtf: 0, audioMs: 0, cost: 0,
    p: 0, pn: 0, f: 0, fn: 0, dg: 0, dn: 0,
  };
}

export function accumulate(acc, row, reference) {
  acc.n += 1;
  const status = rowStatus(row);
  if (status === "skip") {
    acc.skip += 1;
    return acc;
  }
  if (status === "err") {
    acc.err += 1;
    return acc;
  }
  acc.ok += 1;
  acc.wer += row.werNormalized ?? 0;
  acc.cer += row.cer ?? 0;
  acc.ms += row.durationMs ?? 0;
  acc.rtf += row.realtimeFactor ?? 0;
  acc.audioMs += row.audioDurationMs ?? 0;
  acc.cost += row.costUsd ?? 0;
  if (row.punctuationScore != null) {
    acc.p += row.punctuationScore;
    acc.pn += 1;
  }
  if (row.formattingScore != null) {
    acc.f += row.formattingScore;
    acc.fn += 1;
  }
  if (reference != null) {
    const hit = digitsHit(reference, row.transcription);
    if (hit != null) {
      acc.dg += hit ? 1 : 0;
      acc.dn += 1;
    }
  }
  return acc;
}

/** Turns sums into the compact cell written to summary.json (means + the counts behind them). */
export function finalizeCell(acc) {
  const cell = { n: acc.n, ok: acc.ok };
  if (acc.err) cell.err = acc.err;
  if (acc.skip) cell.skip = acc.skip;
  if (acc.ok > 0) {
    cell.wer = round(acc.wer / acc.ok, 5);
    cell.cer = round(acc.cer / acc.ok, 5);
    cell.ms = round(acc.ms / acc.ok, 1);
    cell.rtf = round(acc.rtf / acc.ok, 6);
    cell.sec = round(acc.audioMs / acc.ok / 1000, 2);
    if (acc.cost > 0) cell.usd = round(acc.cost, 6);
  }
  if (acc.pn > 0) Object.assign(cell, { p: round(acc.p / acc.pn, 5), pn: acc.pn });
  if (acc.fn > 0) Object.assign(cell, { f: round(acc.f / acc.fn, 5), fn: acc.fn });
  if (acc.dn > 0) Object.assign(cell, { dg: round(acc.dg / acc.dn, 5), dn: acc.dn });
  return cell;
}

/** Speeds are published only from this machine, so they stay comparable (bench/src/speed.ts). */
export const SPEED_REFERENCE = { model: "Mac17,16", chip: "Apple M5 Pro", memoryGb: 48 };

/** The compact speed entry of summary.json, or null for a run from another machine. */
export function speedEntry(report) {
  const machine = report?.machine;
  const summary = report?.summary;
  if (!summary?.speedFactor || !machine) return null;
  if (machine.model !== SPEED_REFERENCE.model || machine.chip !== SPEED_REFERENCE.chip || machine.memoryGb !== SPEED_REFERENCE.memoryGb) {
    return null;
  }
  const entry = {
    x: summary.speedFactor,
    short: summary.buckets?.short?.medianMs,
    medium: summary.buckets?.medium?.medianMs,
    long: summary.buckets?.long?.medianMs,
    clips: report.speedSet?.clips,
    passes: report.settings?.passes,
    spread: summary.passSpread,
    at: report.measuredAt?.slice(0, 10),
  };
  if (report.language && report.language !== "en") entry.lang = report.language;
  return entry;
}

function loadSpeed(speedDir, models) {
  const speed = {};
  if (!speedDir || !existsSync(speedDir)) return speed;
  for (const file of readdirSync(speedDir).filter((name) => name.endsWith(".json")).sort()) {
    let report;
    try {
      report = readJson(join(speedDir, file));
    } catch {
      report = null;
    }
    if (typeof report?.providerId !== "string" || typeof report?.model !== "string") {
      console.warn(`build-data: skipped malformed speed file ${file}`);
      continue;
    }
    const modelId = `${report.providerId}:${report.model}`;
    const entry = speedEntry(report);
    if (!entry) {
      console.warn(`build-data: skipped speed file ${file}, not measured on the reference machine`);
    } else if (!models[modelId]) {
      console.warn(`build-data: skipped speed file ${file}, ${modelId} has no accuracy results`);
    } else {
      speed[modelId] = entry;
    }
  }
  return speed;
}

/* ------------------------------------------------------------------------------------------ */
/* Build                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** References by suite id, from bench/tests (the runner's suite definitions). */
function loadReferences(testsDir) {
  const suites = new Map();
  if (!existsSync(testsDir)) return suites;
  for (const file of readdirSync(testsDir).filter((name) => name.endsWith(".json"))) {
    try {
      const suite = readJson(join(testsDir, file));
      if (!suite?.id || !Array.isArray(suite.tests)) continue;
      suites.set(suite.id, suite);
    } catch {
      console.warn(`build-data: skipped unreadable suite file ${file}`);
    }
  }
  return suites;
}

const STATUS_CODE = { ok: 0, err: 1, skip: 2 };

export function buildData({ resultsDir, testsDir, speedDir }) {
  const suiteDefinitions = loadReferences(testsDir);
  const referenceById = new Map();
  for (const suite of suiteDefinitions.values()) {
    for (const test of suite.tests) referenceById.set(`${suite.id}\u0000${test.id}`, test);
  }

  const files = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((name) => name.endsWith(".json")).sort()
    : [];

  const suiteMetadata = {};
  const models = {};
  const accumulators = {};
  /** suiteId -> modelId -> testId -> chosen row (first ok run, else first row) */
  const clipRows = {};
  /** suiteId -> ordered test ids seen in results */
  const seenTests = {};

  for (const file of files) {
    let data;
    try {
      data = readJson(join(resultsDir, file));
    } catch {
      console.warn(`build-data: skipped malformed result file ${file}`);
      continue;
    }
    const resultsBySuite = data?.resultsBySuite ?? {};
    const firstRow = Object.values(resultsBySuite).flat()[0];
    const providerId = data?.ranking?.providerId ?? firstRow?.providerId;
    const model = data?.ranking?.model ?? firstRow?.model;
    if (!providerId || !model) {
      console.warn(`build-data: skipped ${file}, no provider or model id`);
      continue;
    }
    const modelId = `${providerId}:${model}`;
    if (models[modelId]) console.warn(`build-data: ${file} repeats ${modelId}; later file wins`);

    for (const [suiteId, meta] of Object.entries(data.suiteMetadata ?? {})) {
      suiteMetadata[suiteId] = { ...suiteMetadata[suiteId], ...meta };
    }

    let maxRun = 1;
    let lastRun = "";
    const cells = {};
    for (const [suiteId, rows] of Object.entries(resultsBySuite)) {
      const acc = emptyAccumulator();
      const chosen = {};
      const order = (seenTests[suiteId] ||= []);
      const orderSet = new Set(order);
      for (const row of rows) {
        const definition = referenceById.get(`${suiteId}\u0000${row.testId}`);
        const isNumberSuite = suiteId.startsWith("number-formatting-");
        accumulate(acc, row, isNumberSuite ? definition?.groundTruth : undefined);
        maxRun = Math.max(maxRun, row.run ?? 1);
        if (row.timestamp && row.timestamp > lastRun) lastRun = row.timestamp;
        if (!orderSet.has(row.testId)) {
          order.push(row.testId);
          orderSet.add(row.testId);
        }
        const current = chosen[row.testId];
        const better =
          !current ||
          (rowStatus(current) !== "ok" && rowStatus(row) === "ok") ||
          (rowStatus(current) === rowStatus(row) && (row.run ?? 1) < (current.run ?? 1));
        if (better) chosen[row.testId] = row;
      }
      cells[suiteId] = finalizeCell(acc);
      (clipRows[suiteId] ||= {})[modelId] = chosen;
    }

    accumulators[modelId] = cells;
    models[modelId] = {
      provider: providerId,
      model,
      type: data?.ranking?.providerType ?? "local",
      file,
      runs: maxRun,
      lastRun: lastRun.slice(0, 10) || undefined,
    };
  }

  /* Suite metadata: runner metadata first, then the suite definition, then inference. */
  // Suite definitions count too, so a new suite appears before any model has run it.
  const suiteIds = new Set([...Object.keys(suiteMetadata), ...Object.keys(clipRows), ...suiteDefinitions.keys()]);
  const suites = {};
  for (const suiteId of [...suiteIds].sort()) {
    const fromResults = suiteMetadata[suiteId] ?? {};
    const definition = suiteDefinitions.get(suiteId);
    const category = fromResults.category ?? definition?.category ?? inferCategory(suiteId);
    const language = fromResults.language ?? definition?.language ?? inferLanguage(suiteId);
    const testIds = definition?.tests?.map((test) => test.id) ?? seenTests[suiteId] ?? [];
    const hasScores = (key) =>
      Object.values(accumulators).some((cells) => cells[suiteId]?.[key] != null);
    suites[suiteId] = {
      name: fromResults.name ?? definition?.name ?? titleCase(suiteId),
      description: fromResults.description ?? definition?.description ?? "",
      language,
      category,
      tier: fromResults.tier ?? definition?.benchmarkTier ?? inferTier(suiteId, category),
      origin: fromResults.origin ?? inferOrigin(suiteId, category),
      clips: fromResults.testCount ?? testIds.length,
      scores: ["p", "f", "dg"].filter(hasScores),
      references: Boolean(definition),
    };
  }

  /* Per-suite clip files. */
  const clipFiles = {};
  for (const suiteId of Object.keys(suites)) {
    const definition = suiteDefinitions.get(suiteId);
    const definedIds = definition?.tests?.map((test) => test.id) ?? [];
    const order = [...definedIds, ...(seenTests[suiteId] ?? []).filter((id) => !definedIds.includes(id))];
    const clips = order.map((testId) => {
      const test = referenceById.get(`${suiteId}\u0000${testId}`);
      const sample = Object.values(clipRows[suiteId] ?? {}).map((rows) => rows[testId]).find(Boolean);
      const clip = { id: testId };
      if (test?.groundTruth != null) clip.ref = test.groundTruth;
      if (test?.formattedGroundTruth && test.formattedGroundTruth !== test.groundTruth) {
        clip.fref = test.formattedGroundTruth;
      }
      const tags = test?.tags ?? sample?.testTags;
      if (tags?.length) clip.tags = tags;
      if (sample?.audioDurationMs) clip.sec = round(sample.audioDurationMs / 1000, 1);
      return clip;
    });
    const results = {};
    for (const [modelId, rows] of Object.entries(clipRows[suiteId] ?? {})) {
      results[modelId] = order.map((testId) => {
        const row = rows[testId];
        if (!row) return null;
        const status = rowStatus(row);
        const text = status === "ok" ? row.transcription ?? "" : row.error ?? row.skipReason ?? "";
        const tuple = [text, round(row.werNormalized ?? 0, 4), round(row.cer ?? 0, 4), Math.round(row.durationMs ?? 0), STATUS_CODE[status]];
        if (row.punctuationScore != null || row.formattingScore != null) {
          tuple.push(row.punctuationScore != null ? round(row.punctuationScore, 4) : null);
          tuple.push(row.formattingScore != null ? round(row.formattingScore, 4) : null);
        }
        return tuple;
      });
    }
    clipFiles[suiteId] = { suite: suiteId, clips, results };
  }

  const speed = loadSpeed(speedDir, models);
  const body = { schema: SCHEMA_VERSION, suites, models, cells: accumulators, speed };
  // The clip files are fetched with this version as their cache key, so their content counts too.
  const version = createHash("sha1").update(JSON.stringify(body)).update(JSON.stringify(clipFiles)).digest("hex").slice(0, 10);
  const summary = { ...body, version, generatedAt: new Date().toISOString() };
  return { summary, clipFiles, fileCount: files.length };
}

export function writeData({ resultsDir, testsDir, speedDir, outDir }) {
  const { summary, clipFiles, fileCount } = buildData({ resultsDir, testsDir, speedDir });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "clips"), { recursive: true });
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary));
  for (const [suiteId, file] of Object.entries(clipFiles)) {
    writeFileSync(join(outDir, "clips", `${suiteId}.json`), JSON.stringify(file));
  }
  return { summary, fileCount, clipFileCount: Object.keys(clipFiles).length };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const { summary, fileCount, clipFileCount } = writeData({
    resultsDir: join(root, "public", "data", "results"),
    testsDir: join(root, "..", "bench", "tests"),
    speedDir: join(root, "public", "data", "speed"),
    outDir: join(root, "public", "data", "generated"),
  });
  const size = Buffer.byteLength(JSON.stringify(summary));
  console.log(
    `build-data: ${fileCount} result files -> ${Object.keys(summary.models).length} models, ` +
      `${Object.keys(summary.suites).length} suites, ${Object.keys(summary.speed).length} speeds; summary.json ${(size / 1024).toFixed(0)} KB, ` +
      `${clipFileCount} clip files (version ${summary.version})`
  );
}
