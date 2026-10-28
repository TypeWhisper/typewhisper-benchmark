/**
 * Every view of the visualizer is described by query parameters on the one index.html, so any
 * screen can be shared as a link and GitHub Pages never needs a server-side route.
 *
 * Schema (all optional; a default is never written to the URL):
 *
 *   view    leaderboard | compare | model | suite | models | suites | about   (default leaderboard)
 *   models  comma-separated model ids to compare or highlight, max 6
 *           e.g. fluidaudio:parakeet-ultra,crispasr:cohere-transcribe-q5_0
 *   model   one model id (view=model)
 *   suite   suite id, e.g. clean-speech-mls-de (view=suite, transcript explorers)
 *   clip    clip (test) id inside the suite, e.g. de-clean-01
 *   lang    all | en | de | ru | auto                                       (default all)
 *   tier    core | diagnostic | all                                         (default core)
 *   cat     suite category, e.g. noisy-environment                          (default: every category)
 *   origin  all | public | synthetic   (real recordings vs. TTS clips)      (default all)
 *   acc     1 = include the accented-speech suites (their references are mismatched)
 *   deploy  all | local | cloud                                             (default all)
 *   tw      all | engine | candidate   (TypeWhisper status)                 (default all)
 *   q       model search text
 *   metric  metric of the ranked chart, e.g. wer, punct, digits, ms, wer-de
 *   sort    table column, e.g. wer, punct, ms, wer-de
 *   dir     asc | desc (only written when it differs from the column's "better first" order)
 *   group   suite | category   (breakdown in the compare view)              (default suite)
 *
 * Model ids are `<providerId>:<model>`, the same pair the runner writes into each result file
 * name (`<providerId>_<model>.json`). Unknown values fall back to defaults; unknown model ids
 * are dropped by the views once the data is loaded.
 */

export const VIEWS = ["leaderboard", "compare", "model", "suite", "models", "suites", "about"] as const;
export const LANGS = ["all", "en", "de", "ru", "auto"] as const;
export const TIERS = ["core", "diagnostic", "all"] as const;
export const ORIGINS = ["all", "public", "synthetic"] as const;
export const DEPLOYS = ["all", "local", "cloud"] as const;
export const TW_FILTERS = ["all", "engine", "candidate"] as const;
export const GROUPS = ["suite", "category"] as const;
export const DIRS = ["asc", "desc"] as const;

export const MAX_COMPARE = 6;

export type View = (typeof VIEWS)[number];
export type Lang = (typeof LANGS)[number];
export type Tier = (typeof TIERS)[number];
export type Origin = (typeof ORIGINS)[number];
export type Deploy = (typeof DEPLOYS)[number];
export type TwFilter = (typeof TW_FILTERS)[number];
export type Group = (typeof GROUPS)[number];
export type Dir = (typeof DIRS)[number];

export interface AppState {
  view: View;
  models: string[];
  model: string | null;
  suite: string | null;
  clip: string | null;
  lang: Lang;
  tier: Tier;
  cat: string | null;
  origin: Origin;
  acc: boolean;
  deploy: Deploy;
  tw: TwFilter;
  q: string;
  metric: string | null;
  sort: string | null;
  dir: Dir | null;
  group: Group;
}

export const DEFAULT_STATE: Readonly<AppState> = Object.freeze({
  view: "leaderboard",
  models: [],
  model: null,
  suite: null,
  clip: null,
  lang: "all",
  tier: "core",
  cat: null,
  origin: "all",
  acc: false,
  deploy: "all",
  tw: "all",
  q: "",
  metric: null,
  sort: null,
  dir: null,
  group: "suite",
}) as AppState;

/** Order in which keys are written, so equal states always give the same URL. */
const KEY_ORDER: Array<keyof AppState> = [
  "view",
  "model",
  "suite",
  "models",
  "lang",
  "tier",
  "cat",
  "origin",
  "acc",
  "deploy",
  "tw",
  "q",
  "metric",
  "sort",
  "dir",
  "group",
  "clip",
];

/** Ids of models, suites, clips, categories and columns: letters, digits and . _ : - */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  const normalized = value?.trim().toLowerCase();
  return normalized && (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

function id(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseModelList(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const modelId = id(part);
    if (modelId && !seen.has(modelId)) seen.add(modelId);
    if (seen.size === MAX_COMPARE) break;
  }
  return [...seen];
}

function parseBoolean(value: string | null): boolean {
  return value != null && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseState(search: string): AppState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const model = id(params.get("model"));
  const suite = id(params.get("suite"));
  // `models` may also arrive as repeated parameters (models=a&models=b).
  const models = parseModelList(params.getAll("models").join(","));

  const explicitView = params.get("view");
  let view = pick(explicitView, VIEWS, DEFAULT_STATE.view);
  if (!explicitView) {
    // Short links: ?model=… opens the model, ?suite=… the suite.
    if (model) view = "model";
    else if (suite) view = "suite";
  }

  return {
    view,
    models,
    model,
    suite,
    clip: id(params.get("clip")),
    lang: pick(params.get("lang"), LANGS, DEFAULT_STATE.lang),
    tier: pick(params.get("tier"), TIERS, DEFAULT_STATE.tier),
    cat: id(params.get("cat")),
    origin: pick(params.get("origin"), ORIGINS, DEFAULT_STATE.origin),
    acc: parseBoolean(params.get("acc")),
    deploy: pick(params.get("deploy"), DEPLOYS, DEFAULT_STATE.deploy),
    tw: pick(params.get("tw"), TW_FILTERS, DEFAULT_STATE.tw),
    q: (params.get("q") ?? "").slice(0, 80),
    metric: id(params.get("metric")),
    sort: id(params.get("sort")),
    dir: params.has("dir") ? pick(params.get("dir"), DIRS, "asc") : null,
    group: pick(params.get("group"), GROUPS, DEFAULT_STATE.group),
  };
}

/** encodeURIComponent, but ':' and ',' stay readable (both are legal in a query, RFC 3986). */
export function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}

function serializeValue(key: keyof AppState, state: AppState): string | null {
  const value = state[key];
  const fallback = DEFAULT_STATE[key];
  if (key === "models") {
    const list = (value as string[]).slice(0, MAX_COMPARE);
    return list.length ? list.join(",") : null;
  }
  if (key === "acc") return value ? "1" : null;
  if (key === "q") {
    const text = (value as string).trim();
    return text ? text : null;
  }
  if (value == null || value === fallback) return null;
  return String(value);
}

/** Query string without the leading '?'; empty for the default state. */
export function serializeState(state: AppState): string {
  const parts: string[] = [];
  for (const key of KEY_ORDER) {
    const value = serializeValue(key, state);
    if (value != null) parts.push(`${key}=${encodeValue(value)}`);
  }
  return parts.join("&");
}

export function hrefFor(state: AppState): string {
  const query = serializeState(state);
  return query ? `?${query}` : "./";
}

/**
 * Fields that belong to one view. Switching views clears them unless the patch sets them,
 * so a link from the compare view to a model page does not carry the compare sort along.
 */
const VIEW_SCOPED: Array<keyof AppState> = ["model", "suite", "clip", "metric", "sort", "dir"];

export function withView(state: AppState, view: View, patch: Partial<AppState> = {}): AppState {
  const next: AppState = { ...state, view };
  if (view !== state.view) {
    for (const key of VIEW_SCOPED) (next as unknown as Record<string, unknown>)[key] = DEFAULT_STATE[key];
  }
  return { ...next, ...patch };
}
