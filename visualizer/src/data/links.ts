import type { AppState } from "../lib/url-state";
import { categoriesIn, languageName } from "./metrics";
import { modelMeta, splitModelId } from "./model-meta";
import type { Summary } from "./types";

/** Own keys only: ids come from links, and names such as "constructor" exist on every object. */
export function hasKey(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * Accepts the canonical id (fluidaudio:parakeet-ultra), the result file stem
 * (fluidaudio_parakeet-ultra) or a model name that only one provider uses (parakeet-ultra).
 */
export function resolveModelId(summary: Summary, raw: string): string | null {
  if (hasKey(summary.models, raw)) return raw;
  const lower = raw.toLowerCase();
  const ids = Object.keys(summary.models);
  const exact = ids.find((id) => id.toLowerCase() === lower);
  if (exact) return exact;
  const byFile = ids.find((id) => summary.models[id].file.replace(/\.json$/, "").toLowerCase() === lower);
  if (byFile) return byFile;
  const byModel = ids.filter((id) => splitModelId(id).model.toLowerCase() === lower);
  return byModel.length === 1 ? byModel[0] : null;
}

/** Rewrites ids from a link to their canonical form and drops what the data does not know. */
export function canonicalize(summary: Summary, state: AppState): { state: AppState; dropped: string[] } {
  const dropped: string[] = [];
  const models: string[] = [];
  for (const raw of state.models) {
    const id = resolveModelId(summary, raw);
    if (id && !models.includes(id)) models.push(id);
    else if (!id) dropped.push(raw);
  }
  // An unknown model page keeps its id, so the page can say what was not found.
  const model = state.model ? (resolveModelId(summary, state.model) ?? state.model) : null;
  const suite = state.suite && hasKey(summary.suites, state.suite) ? state.suite : state.view === "suite" ? state.suite : null;
  const cat = state.cat && categoriesIn(summary).includes(state.cat) ? state.cat : null;
  return { state: { ...state, models, model, suite, cat }, dropped };
}

export function documentTitle(summary: Summary, state: AppState): string {
  const name = (id: string) => modelMeta(id, summary.models[id].type).short;
  const lang = state.lang !== "all" ? ` · ${languageName(state.lang)}` : "";
  switch (state.view) {
    case "compare": {
      const ids = state.models.filter((id) => hasKey(summary.models, id));
      return ids.length ? `${ids.map(name).join(" vs. ")}${lang}` : "Compare models";
    }
    case "model":
      return state.model && hasKey(summary.models, state.model) ? modelMeta(state.model, summary.models[state.model].type).name : "Model";
    case "suite":
      return state.suite && hasKey(summary.suites, state.suite) ? summary.suites[state.suite].name : "Suite";
    case "models":
      return "Models";
    case "suites":
      return "Suites";
    case "about":
      return "Method";
    default:
      return `Speech-to-text leaderboard${lang}`;
  }
}
