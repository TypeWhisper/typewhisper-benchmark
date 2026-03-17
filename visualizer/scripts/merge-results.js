#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, "..", "public", "data", "results");
const outFile = join(__dirname, "..", "public", "data", "benchmark-results.json");

if (!existsSync(resultsDir)) {
  mkdirSync(resultsDir, { recursive: true });
}

const files = readdirSync(resultsDir).filter((file) => file.endsWith(".json"));

function inferCategory(suiteId) {
  if (suiteId.startsWith("clean-speech-")) return "clean-speech";
  if (suiteId.startsWith("noisy-environment-")) return "noisy-environment";
  if (suiteId.startsWith("accented-speech-")) return "accented-speech";
  if (suiteId.startsWith("code-dictation-")) return "code-dictation";
  if (suiteId.startsWith("whispered-lowquality-")) return "low-quality-audio";
  if (suiteId.startsWith("code-switching-")) return "code-switching";
  if (suiteId.startsWith("punctuation-formatting-")) return "punctuation-formatting";
  if (suiteId.startsWith("number-formatting-")) return "number-formatting";
  if (suiteId.startsWith("long-form-speech-")) return "long-form-speech";
  if (suiteId.startsWith("hard-")) return "technical-jargon";
  return "clean-speech";
}

function inferLanguage(suiteId) {
  return suiteId.match(/-(de|en|auto)$/)?.[1] ?? "de";
}

function inferTier(suiteId, category) {
  if (
    suiteId.startsWith("hard-") ||
    category === "code-dictation" ||
    category === "code-switching"
  ) {
    return "diagnostic";
  }
  return "core";
}

function inferOrigin(suiteId, category) {
  if (
    suiteId.startsWith("clean-speech-") ||
    suiteId.startsWith("accented-speech-") ||
    category === "long-form-speech"
  ) {
    return "public";
  }
  return "synthetic";
}

function inferName(suiteId, language, category) {
  const langLabel = language === "de" ? "German" : language === "en" ? "English" : "Auto";
  switch (category) {
    case "clean-speech":
      return `Clean Speech (${langLabel})`;
    case "noisy-environment":
      return `Noisy Environment (${langLabel})`;
    case "accented-speech":
      return `Accented Speech (${langLabel})`;
    case "code-dictation":
      return `Code Dictation (${langLabel})`;
    case "code-switching":
      return language === "auto" ? "Code-Switching (auto-detect)" : "Code-Switching (DE hint)";
    case "punctuation-formatting":
      return `Punctuation & Formatting (${langLabel})`;
    case "number-formatting":
      return `Number Formatting (${langLabel})`;
    case "low-quality-audio":
      return `Low Quality Audio (${langLabel})`;
    case "long-form-speech":
      return `Long-form Speech (${langLabel})`;
    default:
      return suiteId.startsWith("hard-") ? `Hard Cases (${langLabel})` : suiteId;
  }
}

function normalizeSuiteMetadata(suiteMetadata, resultsBySuite) {
  const normalized = {};
  const suiteIds = new Set([
    ...Object.keys(resultsBySuite),
    ...Object.keys(suiteMetadata || {}),
  ]);

  for (const suiteId of suiteIds) {
    const existing = suiteMetadata?.[suiteId];
    const category = existing?.category || inferCategory(suiteId);
    const language = existing?.language || inferLanguage(suiteId);
    const results = resultsBySuite[suiteId] || [];
    normalized[suiteId] = {
      name: existing?.name || inferName(suiteId, language, category),
      description:
        existing?.description || `Legacy suite metadata inferred for ${suiteId}`,
      language,
      category,
      tier: existing?.tier || inferTier(suiteId, category),
      origin: existing?.origin || inferOrigin(suiteId, category),
      testCount:
        existing?.testCount ||
        new Set(results.map((result) => result.testId)).size,
    };
  }

  return normalized;
}

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function averageOptional(values) {
  const defined = values.filter((value) => value != null);
  return defined.length > 0 ? average(defined) : undefined;
}

function buildRankings(results, providerTypeMap) {
  const grouped = new Map();

  for (const result of results) {
    const key = `${result.providerId}/${result.model}`;
    const group = grouped.get(key) || [];
    group.push(result);
    grouped.set(key, group);
  }

  const rankings = [];

  for (const [key, group] of grouped) {
    const [providerId, model] = key.split("/");
    const valid = group.filter(
      (result) => result.status !== "skipped" && result.status !== "error" && !result.error
    );
    const errors = group.filter(
      (result) => result.status === "error" || !!result.error
    );
    const skips = group.filter((result) => result.status === "skipped");
    const attempted = group.length - skips.length;

    if (valid.length === 0) {
      rankings.push({
        providerId,
        model,
        providerType: providerTypeMap.get(providerId) || "cloud",
        avgWerNormalized: 1,
        avgCer: 1,
        avgRealtimeFactor: 0,
        avgDurationMs: 0,
        totalTests: group.length,
        errorCount: errors.length,
        errorRate: attempted > 0 ? errors.length / attempted : 0,
        skipCount: skips.length,
      });
      continue;
    }

    const totalAudioMs = valid.reduce(
      (sum, result) => sum + result.audioDurationMs,
      0
    );
    const totalCost = valid.reduce((sum, result) => sum + (result.costUsd || 0), 0);

    rankings.push({
      providerId,
      model,
      providerType: providerTypeMap.get(providerId) || "cloud",
      avgWerNormalized: average(valid.map((result) => result.werNormalized)),
      avgCer: average(valid.map((result) => result.cer)),
      avgPunctuationScore: averageOptional(
        valid.map((result) => result.punctuationScore)
      ),
      avgFormattingScore: averageOptional(
        valid.map((result) => result.formattingScore)
      ),
      avgRealtimeFactor: average(valid.map((result) => result.realtimeFactor)),
      avgDurationMs: average(valid.map((result) => result.durationMs)),
      costPerHourAudio:
        totalAudioMs > 0 ? (totalCost / totalAudioMs) * 3600000 : undefined,
      totalTests: group.length,
      errorCount: errors.length,
      errorRate: attempted > 0 ? errors.length / attempted : 0,
      skipCount: skips.length,
    });
  }

  rankings.sort((left, right) => left.avgWerNormalized - right.avgWerNormalized);
  return rankings;
}

function groupResults(results, getKey) {
  const grouped = {};
  for (const result of results) {
    const key = getKey(result);
    if (!key) continue;
    (grouped[key] ||= []).push(result);
  }
  return grouped;
}

function buildGroupRankings(groups, providerTypeMap) {
  return Object.fromEntries(
    Object.entries(groups).map(([key, group]) => [
      key,
      buildRankings(group, providerTypeMap),
    ])
  );
}

function sliceMatches(sliceId, result) {
  if (sliceId === "fast-speech") return /(^|-)fast-/.test(result.testId);
  if (sliceId === "numbers-dates") return /(^|-)numbers-/.test(result.testId);
  if (sliceId === "technical-jargon") return /(^|-)tech-/.test(result.testId);
  if (sliceId === "proper-nouns") return /(^|-)names-/.test(result.testId);
  return false;
}

const providerTypeMap = new Map();
const resultsBySuite = {};
const suiteMetadata = {};

for (const file of files) {
  try {
    const data = JSON.parse(readFileSync(join(resultsDir, file), "utf-8"));
    if (data.ranking?.providerId && data.ranking?.providerType) {
      providerTypeMap.set(data.ranking.providerId, data.ranking.providerType);
    }
    if (data.suiteMetadata) {
      Object.assign(suiteMetadata, data.suiteMetadata);
    }
    if (data.resultsBySuite) {
      for (const [suiteId, results] of Object.entries(data.resultsBySuite)) {
        (resultsBySuite[suiteId] ||= []).push(...results);
      }
    }
  } catch {
    // Skip malformed files
  }
}

const normalizedSuiteMetadata = normalizeSuiteMetadata(suiteMetadata, resultsBySuite);
const allResults = Object.values(resultsBySuite).flat();
const rankings = buildRankings(allResults, providerTypeMap);
const rankingsBySuite = buildGroupRankings(resultsBySuite, providerTypeMap);
const rankingsByCategory = buildGroupRankings(
  groupResults(allResults, (result) => normalizedSuiteMetadata[result.suiteId]?.category),
  providerTypeMap
);
const rankingsBySlice = buildGroupRankings(
  Object.fromEntries(
    ["fast-speech", "numbers-dates", "technical-jargon", "proper-nouns"].map(
      (sliceId) => [sliceId, allResults.filter((result) => sliceMatches(sliceId, result))]
    )
  ),
  providerTypeMap
);

const suites = Object.keys(normalizedSuiteMetadata);
const merged = {
  rankings,
  suiteMetadata: normalizedSuiteMetadata,
  rankingsBySuite,
  rankingsByCategory,
  rankingsBySlice,
  metadata: {
    timestamp: new Date().toISOString(),
    version: new Date().toISOString().slice(0, 10),
    totalModels: rankings.length,
    totalTests: suites.reduce(
      (sum, suiteId) => sum + normalizedSuiteMetadata[suiteId].testCount,
      0
    ),
    suites,
    languages: [...new Set(suites.map((suiteId) => normalizedSuiteMetadata[suiteId].language))],
    categories: [...new Set(suites.map((suiteId) => normalizedSuiteMetadata[suiteId].category))],
  },
  resultsBySuite,
};

writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");
console.log(`Merged ${files.length} result file(s) into benchmark-results.json`);
