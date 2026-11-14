/**
 * Scores a boosting probe's records the way the runner scores results: normalized WER and the share of
 * key terms written, per suite, for decoding without boosting, with plain boosting and with each guard.
 *
 *   npx tsx probe/score-terms.ts results/probe/<date>/boost-medicine-precise-medical.jsonl
 *
 * Only suites whose clips carry keyTerms report a term share.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { computeMetrics } from "../src/metrics/index.js";
import { loadAllSuites } from "../src/suite-loader.js";
import type { TestCase } from "../src/types.js";

const BENCH_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VARIANTS = ["off", "boosting", "guard strict", "guard lenient", "guard contained"];

interface Totals {
  clips: number;
  wer: number;
  termClips: number;
  terms: number;
  changed: number;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: tsx probe/score-terms.ts records.jsonl...");
  process.exit(1);
}

const tests = new Map<string, { test: TestCase; language: string }>();
for (const suite of await loadAllSuites(join(BENCH_ROOT, "tests"))) {
  for (const test of suite.tests) tests.set(`${suite.id}\u0000${test.id}`, { test, language: suite.language });
}

const bySuite = new Map<string, Map<string, Totals>>();
for (const file of files) {
  for (const line of (await readFile(file, "utf-8")).split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as Record<string, unknown>;
    const entry = tests.get(`${record.suite}\u0000${record.id}`);
    if (!entry) continue;
    const variants = bySuite.get(record.suite as string) ?? new Map<string, Totals>();
    bySuite.set(record.suite as string, variants);
    for (const name of VARIANTS) {
      const text = record[name];
      if (typeof text !== "string") continue;
      const metrics = computeMetrics({
        reference: entry.test.groundTruth,
        hypothesis: text,
        language: entry.language,
        keyTerms: entry.test.keyTerms,
      });
      const totals = variants.get(name) ?? { clips: 0, wer: 0, termClips: 0, terms: 0, changed: 0 };
      totals.clips += 1;
      totals.wer += metrics.werNormalized;
      if (metrics.termRecall !== undefined) {
        totals.termClips += 1;
        totals.terms += metrics.termRecall;
      }
      if (text !== record.off) totals.changed += 1;
      variants.set(name, totals);
    }
  }
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
for (const [suite, variants] of [...bySuite].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(suite);
  for (const name of VARIANTS) {
    const t = variants.get(name);
    if (!t) continue;
    const terms = t.termClips > 0 ? `, terms ${pct(t.terms / t.termClips)}` : "";
    const changed = name === "off" ? "" : `, changed ${t.changed}`;
    console.log(`  ${name.padEnd(16)} WER ${pct(t.wer / t.clips)}${terms} (${t.clips} clips${changed})`);
  }
}
