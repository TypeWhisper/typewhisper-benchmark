import type { MetricKey, Unit } from "../data/metrics";
import { METRICS } from "../data/metrics";

export function formatUnit(unit: Unit, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  switch (unit) {
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "ms":
      return value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-US");
    case "rtf":
      return value < 0.01 ? value.toFixed(4) : value < 1 ? value.toFixed(3) : value.toFixed(2);
    case "usd":
      return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`;
  }
}

export function formatMetric(metric: MetricKey, value: number | null | undefined): string {
  return formatUnit(METRICS[metric].unit, value);
}

/** Difference between two values of a metric, e.g. "+1.2 pts" or "×3.4". */
export function formatGap(metric: MetricKey, value: number, reference: number): string {
  const unit = METRICS[metric].unit;
  if (unit === "pct") {
    const points = (value - reference) * 100;
    return `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts`;
  }
  if (reference > 0) return `×${(value / reference).toFixed(value / reference >= 10 ? 0 : 1)}`;
  return "";
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** "a, b and c" */
export function listJoin(items: string[], last = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}
