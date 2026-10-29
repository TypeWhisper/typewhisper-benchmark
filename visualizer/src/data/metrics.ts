/**
 * Metric definitions and pooling. These follow the PR tables (#10, #11):
 *
 * - WER/CER <lang>: mean over ok clips of the suites in scope for that language (default: core
 *   tier, accented-speech excluded). Pooled over clips, not averaged over suites.
 * - CV-EN fmt: formatting score on clean-speech-commonvoice-en.
 * - Punct <lang>: punctuation score on punctuation-formatting-<lang>.
 * - Digits <lang>: share of number-formatting-<lang> clips whose numbers all appear verbatim, as whole numbers.
 * - ms/clip and RTF: mean over all ok clips of the model, every suite.
 */
import type { AppState, Dir, Lang, Origin, Tier } from "../lib/url-state";
import { modelMeta, type ModelMeta } from "./model-meta";
import type { Cell, ModelRun, SuiteInfo, Summary } from "./types";

export type MetricKey = "wer" | "cer" | "punct" | "fmt" | "digits" | "ms" | "rtf" | "price";
export type Unit = "pct" | "ms" | "rtf" | "usd";

export interface MetricDef {
  key: MetricKey;
  label: string;
  name: string;
  better: "lower" | "higher";
  unit: Unit;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  wer: { key: "wer", label: "WER", name: "Word error rate", better: "lower", unit: "pct" },
  cer: { key: "cer", label: "CER", name: "Character error rate", better: "lower", unit: "pct" },
  punct: { key: "punct", label: "Punct", name: "Punctuation score", better: "higher", unit: "pct" },
  fmt: { key: "fmt", label: "Fmt", name: "Formatting score", better: "higher", unit: "pct" },
  digits: { key: "digits", label: "Digits", name: "Numbers written as digits", better: "higher", unit: "pct" },
  ms: { key: "ms", label: "ms/clip", name: "Time per clip", better: "lower", unit: "ms" },
  rtf: { key: "rtf", label: "RTF", name: "Real-time factor", better: "lower", unit: "rtf" },
  price: { key: "price", label: "$/h", name: "Price per audio hour", better: "lower", unit: "usd" },
};

export const LANGUAGE_ORDER = ["en", "de", "ru", "auto"];
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  ru: "Russian",
  auto: "Auto-detect",
};

export function langLabel(lang: string): string {
  return lang === "auto" ? "Auto" : lang.toUpperCase();
}

export function languageName(lang: string): string {
  return LANGUAGE_NAMES[lang] ?? lang.toUpperCase();
}

export const ACCENTED = "accented-speech";
export const CV_EN = "clean-speech-commonvoice-en";
export const punctSuite = (lang: string) => `punctuation-formatting-${lang}`;
export const numberSuite = (lang: string) => `number-formatting-${lang}`;

export const CATEGORY_NAMES: Record<string, string> = {
  "clean-speech": "Clean speech",
  "noisy-environment": "Noisy environment",
  "accented-speech": "Accented speech",
  "code-dictation": "Code dictation",
  "low-quality-audio": "Whispered and low quality",
  "code-switching": "Code-switching",
  "punctuation-formatting": "Punctuation and formatting",
  "number-formatting": "Number formatting",
  "long-form-speech": "Long-form speech",
  "technical-jargon": "Hard cases",
};

export function categoryName(category: string): string {
  return CATEGORY_NAMES[category] ?? category.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------------------------------ */
/* Scope                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface Scope {
  tier: Tier;
  cat: string | null;
  origin: Origin;
  acc: boolean;
}

export function scopeOf(state: Pick<AppState, "tier" | "cat" | "origin" | "acc">): Scope {
  return { tier: state.tier, cat: state.cat, origin: state.origin, acc: state.acc };
}

export function suiteMatches(suite: SuiteInfo, scope: Scope): boolean {
  if (scope.tier !== "all" && suite.tier !== scope.tier) return false;
  if (scope.cat && suite.category !== scope.cat) return false;
  if (scope.origin !== "all" && suite.origin !== scope.origin) return false;
  // Accented speech has mismatched references; leave it out unless asked for.
  if (!scope.acc && suite.category === ACCENTED && scope.cat !== ACCENTED) return false;
  return true;
}

function languageRank(lang: string): number {
  const index = LANGUAGE_ORDER.indexOf(lang);
  return index < 0 ? LANGUAGE_ORDER.length : index;
}

export function sortSuiteIds(summary: Summary, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const left = summary.suites[a];
    const right = summary.suites[b];
    return (
      languageRank(left.language) - languageRank(right.language) ||
      (left.tier === right.tier ? 0 : left.tier === "core" ? -1 : 1) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function scopedSuites(summary: Summary, scope: Scope, lang?: string | null): string[] {
  const ids = Object.entries(summary.suites)
    .filter(([, suite]) => (!lang || lang === "all" || suite.language === lang) && suiteMatches(suite, scope))
    .map(([id]) => id);
  return sortSuiteIds(summary, ids);
}

export function languagesWithSuites(summary: Summary, scope: Scope): string[] {
  const langs = new Set(scopedSuites(summary, scope).map((id) => summary.suites[id].language));
  return [...langs].sort((a, b) => languageRank(a) - languageRank(b) || a.localeCompare(b));
}

export function categoriesIn(summary: Summary): string[] {
  return [...new Set(Object.values(summary.suites).map((suite) => suite.category))].sort((a, b) =>
    categoryName(a).localeCompare(categoryName(b))
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Columns                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface Column {
  /** Stable id used in ?sort= and ?metric=, e.g. wer, wer-de, punct-en, ms. */
  id: string;
  metric: MetricKey;
  lang: string | null;
  label: string;
  /** Suites pooled. Empty for kind "all" (every suite of the model). */
  suites: string[];
  /** scoped: follows tier/category/audio filters; fixed: one suite; all: every clip of the model. */
  kind: "scoped" | "fixed" | "all";
  help: string;
}

function scopeText(scope: Scope): string {
  const tier = scope.tier === "all" ? "all" : scope.tier;
  const parts = [`${tier} suites`];
  if (scope.cat) parts.push(categoryName(scope.cat).toLowerCase());
  if (scope.origin === "public") parts.push("real recordings only");
  if (scope.origin === "synthetic") parts.push("synthetic clips only");
  if (!scope.acc && scope.cat !== ACCENTED) parts.push("accented speech excluded");
  return parts.join(", ");
}

function scopedColumn(summary: Summary, scope: Scope, metric: "wer" | "cer", lang: string, id: string, label: string): Column {
  const what = metric === "wer" ? "Word error rate" : "Character error rate";
  return {
    id,
    metric,
    lang,
    label,
    suites: scopedSuites(summary, scope, lang),
    kind: "scoped",
    help: `${what}, ${languageName(lang)}: mean over clips of the ${scopeText(scope)}. Normalized: case, punctuation and number spelling are forgiven. Lower is better.`,
  };
}

function fixedColumn(id: string, metric: MetricKey, lang: string, label: string, suite: string, help: string): Column {
  return { id, metric, lang, label, suites: [suite], kind: "fixed", help };
}

const PUNCT_HELP = (lang: string) =>
  `Punctuation score on Punctuation & Formatting (${languageName(lang)}): how much of the reference punctuation the transcript reproduces. Higher is better.`;
const FMT_HELP =
  "Formatting score on Common Voice English (real voices): case, punctuation and digits against the formatted references. Higher is better.";
const DIGITS_HELP = (lang: string) =>
  `Share of Number Formatting (${languageName(lang)}) clips in which every number of the reference ("2,400", "2:30", "15th") appears exactly as written, as a whole number. Higher is better.`;
const MS_HELP =
  "Mean time per clip over all of the model's clips. Measured inside each runtime (cloud APIs include the network), so compare across runtimes with care. Lower is better.";
const RTF_HELP = "Real-time factor: processing time divided by audio length, over all clips. Lower is better.";
const PRICE_HELP = "API cost per hour of audio, from the costs the runner recorded. Local models cost nothing to run.";

export function msColumn(): Column {
  return { id: "ms", metric: "ms", lang: null, label: "ms/clip", suites: [], kind: "all", help: MS_HELP };
}

export function rtfColumn(): Column {
  return { id: "rtf", metric: "rtf", lang: null, label: "RTF", suites: [], kind: "all", help: RTF_HELP };
}

export function priceColumn(): Column {
  return { id: "price", metric: "price", lang: null, label: "$/audio h", suites: [], kind: "all", help: PRICE_HELP };
}

/** Columns of the leaderboard and the compare table for the current language and scope. */
export function buildColumns(summary: Summary, state: Pick<AppState, "lang" | "tier" | "cat" | "origin" | "acc">): Column[] {
  const scope = scopeOf(state);
  const has = (suite: string) => suite in summary.suites;
  const columns: Column[] = [];

  if (state.lang === "all") {
    for (const lang of languagesWithSuites(summary, scope)) {
      columns.push(scopedColumn(summary, scope, "wer", lang, `wer-${lang}`, `WER ${langLabel(lang)}`));
    }
    if (has(CV_EN)) columns.push(fixedColumn("fmt-en", "fmt", "en", "CV-EN fmt", CV_EN, FMT_HELP));
    for (const lang of ["en", "de"]) {
      if (has(punctSuite(lang))) {
        columns.push(fixedColumn(`punct-${lang}`, "punct", lang, `Punct ${langLabel(lang)}`, punctSuite(lang), PUNCT_HELP(lang)));
      }
    }
    for (const lang of ["en", "de"]) {
      if (has(numberSuite(lang))) {
        columns.push(fixedColumn(`digits-${lang}`, "digits", lang, `Digits ${langLabel(lang)}`, numberSuite(lang), DIGITS_HELP(lang)));
      }
    }
    columns.push(msColumn());
    return columns;
  }

  const lang = state.lang;
  columns.push(scopedColumn(summary, scope, "wer", lang, "wer", "WER"));
  columns.push(scopedColumn(summary, scope, "cer", lang, "cer", "CER"));
  if (has(punctSuite(lang))) columns.push(fixedColumn("punct", "punct", lang, "Punct", punctSuite(lang), PUNCT_HELP(lang)));
  if (lang === "en" && has(CV_EN)) columns.push(fixedColumn("fmt", "fmt", "en", "CV fmt", CV_EN, FMT_HELP));
  if (has(numberSuite(lang))) columns.push(fixedColumn("digits", "digits", lang, "Digits", numberSuite(lang), DIGITS_HELP(lang)));
  columns.push(msColumn(), rtfColumn());
  return columns;
}

/**
 * Finds the column for a ?sort= or ?metric= value. Accepts the language-qualified form in the
 * per-language view (wer-de with lang=de -> wer) and the bare form in the all-languages view
 * (wer -> wer-en). Falls back to the first column.
 */
export function resolveColumn(columns: Column[], id: string | null, lang: Lang, filter?: (column: Column) => boolean): Column {
  const pool = filter ? columns.filter(filter) : columns;
  const fallback = pool[0] ?? columns[0];
  if (!id) return fallback;
  const exact = pool.find((column) => column.id === id);
  if (exact) return exact;
  const [metric, suffix] = id.split("-");
  if (lang !== "all" && suffix === lang) {
    const bare = pool.find((column) => column.id === metric);
    if (bare) return bare;
  }
  return pool.find((column) => column.metric === metric) ?? fallback;
}

export function betterFirst(column: Column): Dir {
  return METRICS[column.metric].better === "lower" ? "asc" : "desc";
}

/* ------------------------------------------------------------------------------------------ */
/* Values                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface Value {
  v: number | null;
  /** Clips behind the value. */
  n: number;
  /** Suites in the column's scope the model has no ok clips for (not counting skipped ones). */
  missing: string[];
  /** The model skipped the suites, usually because it does not support the language. */
  skipped: boolean;
  /** The model is not trained for the column's language. */
  outside: boolean;
}

const VALUE_KEYS: Record<Exclude<MetricKey, "price">, [keyof Cell, keyof Cell]> = {
  wer: ["wer", "ok"],
  cer: ["cer", "ok"],
  ms: ["ms", "ok"],
  rtf: ["rtf", "ok"],
  punct: ["p", "pn"],
  fmt: ["f", "fn"],
  digits: ["dg", "dn"],
};

/** Pools a metric over suites, weighting each suite mean by its own count. */
export function pool(cells: Record<string, Cell> | undefined, suites: string[], metric: MetricKey): { v: number | null; n: number } {
  if (!cells) return { v: null, n: 0 };
  if (metric === "price") {
    let usd = 0;
    let seconds = 0;
    for (const suite of suites) {
      const cell = cells[suite];
      if (!cell?.ok) continue;
      usd += cell.usd ?? 0;
      seconds += (cell.sec ?? 0) * cell.ok;
    }
    return usd > 0 && seconds > 0 ? { v: (usd / seconds) * 3600, n: 0 } : { v: null, n: 0 };
  }
  const [valueKey, countKey] = VALUE_KEYS[metric];
  let sum = 0;
  let n = 0;
  for (const suite of suites) {
    const cell = cells[suite];
    const value = cell?.[valueKey];
    const count = cell?.[countKey];
    if (!cell?.ok || value == null || !count) continue;
    sum += (value as number) * (count as number);
    n += count as number;
  }
  return { v: n > 0 ? sum / n : null, n };
}

export function columnValue(summary: Summary, modelId: string, column: Column, meta = modelMeta(modelId)): Value {
  const cells = summary.cells[modelId] ?? {};
  const suites = column.kind === "all" ? Object.keys(cells) : column.suites;
  const missing: string[] = [];
  const skipped: string[] = [];
  if (column.kind !== "all") {
    for (const suite of suites) {
      const cell = cells[suite];
      if (cell?.ok) continue;
      if (cell && cell.skip && cell.skip === cell.n) skipped.push(suite);
      else missing.push(suite);
    }
  }
  const { v, n } = pool(cells, suites, column.metric);
  const outside = Boolean(column.lang && meta.trainedFor && !meta.trainedFor.includes(column.lang));
  return {
    v,
    n,
    // A value that leaves out some of the column's suites, run or skipped, is incomplete.
    missing: column.kind === "scoped" && v != null ? [...missing, ...skipped] : [],
    skipped: v == null && skipped.length > 0,
    outside,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Rows                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export interface Row {
  id: string;
  meta: ModelMeta;
  run: ModelRun;
  values: Record<string, Value>;
}

/** Date of the most recent benchmark run in the data. */
export function latestRun(summary: Summary): string | undefined {
  return Object.values(summary.models)
    .map((run) => run.lastRun)
    .filter((date): date is string => Boolean(date))
    .sort()
    .pop();
}

export function allModelIds(summary: Summary): string[] {
  return Object.keys(summary.models);
}

export function isLocal(summary: Summary, id: string): boolean {
  return modelMeta(id, summary.models[id]?.type).deployment === "local";
}

export function matchesModelFilters(summary: Summary, id: string, state: Pick<AppState, "deploy" | "tw" | "q">): boolean {
  const meta = modelMeta(id, summary.models[id]?.type);
  if (state.deploy !== "all" && meta.deployment !== state.deploy) return false;
  if (state.tw !== "all" && meta.tw.status !== state.tw) return false;
  const query = state.q.trim().toLowerCase();
  if (query) {
    const haystack = [id, meta.name, meta.short, meta.org, meta.family, meta.runtime, meta.tw.plugin ?? ""]
      .join(" ")
      .toLowerCase();
    if (!query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

export function buildRows(summary: Summary, ids: string[], columns: Column[]): Row[] {
  return ids.map((id) => {
    const run = summary.models[id];
    const meta = modelMeta(id, run?.type);
    const values: Record<string, Value> = {};
    for (const column of columns) values[column.id] = columnValue(summary, id, column, meta);
    return { id, meta, run, values };
  });
}

export function sortRows(rows: Row[], column: Column, dir: Dir): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left.values[column.id]?.v;
    const b = right.values[column.id]?.v;
    if (a == null && b == null) return left.meta.name.localeCompare(right.meta.name);
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * sign || left.meta.name.localeCompare(right.meta.name);
  });
}

/** Best value in a column among rows, honoring the metric's direction. Partial coverage cannot win. */
export function bestValue(rows: Row[], column: Column): number | null {
  const values = rows
    .map((row) => row.values[column.id])
    .filter((value) => value?.v != null && !value.missing.length)
    .map((value) => value.v as number);
  if (!values.length) return null;
  return METRICS[column.metric].better === "lower" ? Math.min(...values) : Math.max(...values);
}

/* ------------------------------------------------------------------------------------------ */
/* Per-suite field                                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface FieldEntry {
  id: string;
  v: number;
}

/** Every model's value on one suite, best first. */
export function suiteField(summary: Summary, suiteId: string, metric: MetricKey = "wer", ids?: string[]): FieldEntry[] {
  const better = METRICS[metric].better;
  const entries: FieldEntry[] = [];
  for (const id of ids ?? allModelIds(summary)) {
    const { v } = pool(summary.cells[id], [suiteId], metric);
    if (v != null) entries.push({ id, v });
  }
  return entries.sort((a, b) => (better === "lower" ? a.v - b.v : b.v - a.v));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface SuiteStanding {
  suite: string;
  v: number;
  rank: number;
  of: number;
  best: number;
  median: number;
  worst: number;
  /** 0 = best of the field, 1 = worst. */
  position: number;
  /** Share of the other models that are strictly better / strictly worse. */
  aheadShare: number;
  behindShare: number;
}

export function suiteStanding(summary: Summary, modelId: string, suiteId: string): SuiteStanding | null {
  const field = suiteField(summary, suiteId);
  const index = field.findIndex((entry) => entry.id === modelId);
  if (index < 0) return null;
  const values = field.map((entry) => entry.v);
  // Ties share the better rank.
  const v = field[index].v;
  const rank = field.findIndex((entry) => entry.v === v) + 1;
  return {
    suite: suiteId,
    v,
    rank,
    of: field.length,
    best: values[0],
    median: median(values) ?? v,
    worst: values[values.length - 1],
    position: field.length > 1 ? (rank - 1) / (field.length - 1) : 0,
    aheadShare: field.length > 1 ? values.filter((value) => value < v).length / (field.length - 1) : 0,
    behindShare: field.length > 1 ? values.filter((value) => value > v).length / (field.length - 1) : 0,
  };
}

/** Rank of a value among rows (1 = best), ties share the better rank. */
/** Rank among the models with a complete value; a model that ran fewer suites gets none. */
export function rankOf(rows: Row[], column: Column, id: string): { rank: number; of: number } | null {
  const sorted = sortRows(
    rows.filter((row) => row.values[column.id]?.v != null && !row.values[column.id].missing.length),
    column,
    betterFirst(column)
  );
  const index = sorted.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const v = sorted[index].values[column.id].v;
  const rank = sorted.findIndex((row) => row.values[column.id].v === v) + 1;
  return { rank, of: sorted.length };
}

/** Default transcript suite: real recordings of the chosen language first. */
export function defaultTranscriptSuite(summary: Summary, options: string[], lang: string): string | null {
  const preferred = options.filter((id) => summary.suites[id].origin === "public" && summary.suites[id].category === "clean-speech");
  const inLang = (ids: string[]) => ids.filter((id) => lang === "all" || summary.suites[id].language === lang);
  return (
    inLang(preferred).find((id) => id.includes("commonvoice")) ??
    inLang(preferred)[0] ??
    preferred.find((id) => summary.suites[id].language === "en") ??
    options[0] ??
    null
  );
}
