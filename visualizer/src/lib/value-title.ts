import { formatCount, formatMetric, listJoin } from "./format";
import { languageName, type Column, type Value } from "../data/metrics";
import type { Summary } from "../data/types";

/** Hover text of a table value: the number, its clip count and why it may not compare. */
export function valueTitle(summary: Summary, column: Column, value: Value): string {
  if (value.v == null) {
    return value.skipped ? "Skipped: the model does not support this language" : "Not run on these clips";
  }
  const parts = [`${formatMetric(column.metric, value.v)}`];
  if (value.n) parts.push(`${formatCount(value.n)} clips`);
  if (value.missing.length) {
    const names = value.missing.map((suite) => summary.suites[suite]?.name ?? suite);
    parts.push(`not run on ${listJoin(names)}, so not directly comparable`);
  }
  if (value.outside && column.lang) parts.push(`not trained for ${languageName(column.lang)}`);
  return parts.join(" · ");
}
