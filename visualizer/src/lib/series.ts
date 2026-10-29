import { PROVIDERS, splitModelId, type ModelMeta } from "../data/model-meta";

/** Compare colors, in fixed order; a model keeps its color while it stays selected. */
export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Short runtime name for table rows: the provider's name. */
export function runtimeShort(id: string, meta: ModelMeta): string {
  const { provider } = splitModelId(id);
  return PROVIDERS[provider]?.name ?? meta.runtime;
}
