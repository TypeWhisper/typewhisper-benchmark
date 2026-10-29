import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { MAX_COMPARE, type Dir } from "../lib/url-state";
import { formatMetric } from "../lib/format";
import { valueTitle } from "../lib/value-title";
import { bestValue, METRICS, type Column, type Row, type Value } from "../data/metrics";
import type { Summary } from "../data/types";
import { ModelCell } from "./model-bits";

export function ValueText({ summary, column, value, best }: { summary: Summary; column: Column; value: Value; best?: boolean }) {
  if (value.v == null) {
    return (
      <span className="text-muted" title={valueTitle(summary, column, value)}>
        –
      </span>
    );
  }
  return (
    <span
      title={valueTitle(summary, column, value)}
      className={clsx(best && "font-semibold text-accent", value.outside && !best && "text-muted")}
    >
      {formatMetric(column.metric, value.v)}
      {value.missing.length > 0 && (
        <sup className="ml-0.5 text-muted" aria-label="ran on fewer suites">
          *
        </sup>
      )}
    </span>
  );
}

export function SortHeader({
  column,
  active,
  dir,
  onSort,
}: {
  column: Column;
  active: boolean;
  dir: Dir;
  onSort: (column: Column) => void;
}) {
  const better = METRICS[column.metric].better;
  return (
    <th
      scope="col"
      className="num"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      title={column.help}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={clsx("inline-flex flex-col items-end gap-0.5 rounded uppercase", active ? "text-fg" : "hover:text-fg")}
      >
        <span className="inline-flex items-center gap-1">
          {active && (dir === "asc" ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />)}
          {column.label}
        </span>
        <span className="text-[0.625rem] tracking-normal normal-case opacity-80">
          <span aria-hidden="true">{better === "lower" ? "↓" : "↑"} better</span>
          <span className="visually-hidden">, {better} is better</span>
        </span>
      </button>
    </th>
  );
}

interface Props {
  summary: Summary;
  rows: Row[];
  columns: Column[];
  sortColumn: Column;
  dir: Dir;
  onSort: (column: Column) => void;
  picked: string[];
  onTogglePick: (id: string) => void;
  caption: string;
}

export function LeaderboardTable({ summary, rows, columns, sortColumn, dir, onSort, picked, onTogglePick, caption }: Props) {
  const best = Object.fromEntries(columns.map((column) => [column.id, bestValue(rows, column)]));
  const full = picked.length >= MAX_COMPARE;
  const ranks: Array<number | null> = [];
  let counter = 0;
  for (const row of rows) {
    if (row.values[sortColumn.id]?.v != null) {
      counter += 1;
      ranks.push(counter);
    } else ranks.push(null);
  }
  return (
    <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
      <table className="data-table sm:min-w-[56rem]">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-10 pr-0 text-right">
              #
            </th>
            <th scope="col" className="sticky-col w-[11rem] max-w-[11rem] sm:w-auto sm:max-w-none sm:min-w-[15rem]">
              Model
            </th>
            {columns.map((column) => (
              <SortHeader key={column.id} column={column} active={column.id === sortColumn.id} dir={dir} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rank = ranks[index];
            const isPicked = picked.includes(row.id);
            return (
              <tr key={row.id} className={clsx(isPicked && "bg-[color-mix(in_srgb,var(--mark)_7%,transparent)]")}>
                <td className="meta w-10 pr-0 text-right tabular-nums">{rank ?? "–"}</td>
                <td className={clsx("sticky-col max-w-[11rem] sm:max-w-none", isPicked && "bg-[color-mix(in_srgb,var(--mark)_7%,var(--background))]")}>
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 flex-none accent-[color:var(--primary)]"
                      checked={isPicked}
                      disabled={!isPicked && full}
                      onChange={() => onTogglePick(row.id)}
                      aria-label={`Compare ${row.meta.name}`}
                      title={!isPicked && full ? `Up to ${MAX_COMPARE} models` : `Add ${row.meta.name} to the comparison`}
                    />
                    <ModelCell id={row.id} meta={row.meta} />
                  </div>
                </td>
                {columns.map((column) => {
                  const value = row.values[column.id];
                  return (
                    <td key={column.id} className={clsx("num", column.id === sortColumn.id && "bg-[color:var(--grid)]/40")}>
                      <ValueText summary={summary} column={column} value={value} best={value.v != null && value.v === best[column.id]} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
