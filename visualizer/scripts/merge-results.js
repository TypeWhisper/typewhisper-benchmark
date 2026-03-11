#!/usr/bin/env node
/**
 * Merges per-model result files from public/data/results/ into
 * public/data/benchmark-results.json for the visualizer.
 * Runs as a prebuild step — no bench dependencies needed.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, "..", "public", "data", "results");
const outFile = join(__dirname, "..", "public", "data", "benchmark-results.json");

if (!existsSync(resultsDir)) {
  mkdirSync(resultsDir, { recursive: true });
}

const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
const rankings = [];
const resultsBySuite = {};
const suites = new Set();
const languages = new Set();
const categories = new Set();

for (const file of files) {
  try {
    const data = JSON.parse(readFileSync(join(resultsDir, file), "utf-8"));
    if (data.ranking) rankings.push(data.ranking);
    if (data.resultsBySuite) {
      for (const [suiteId, results] of Object.entries(data.resultsBySuite)) {
        (resultsBySuite[suiteId] ||= []).push(...results);
        suites.add(suiteId);
        const lang = suiteId.split("-").pop();
        if (lang && lang.length === 2) languages.add(lang);
        const category = suiteId.replace(/-[a-z]{2}$/, "");
        if (category) categories.add(category);
      }
    }
  } catch {
    // Skip malformed files
  }
}

rankings.sort((a, b) => a.avgWerNormalized - b.avgWerNormalized);

const merged = {
  rankings,
  metadata: {
    timestamp: new Date().toISOString(),
    version: new Date().toISOString().slice(0, 10),
    totalModels: rankings.length,
    totalTests: Object.values(resultsBySuite).reduce((sum, r) => sum + r.length, 0),
    suites: [...suites],
    languages: [...languages],
    categories: [...categories],
  },
  resultsBySuite,
};

writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");
console.log(`Merged ${files.length} result file(s) into benchmark-results.json`);
