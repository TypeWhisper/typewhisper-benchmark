import clsx from "clsx";
import { useState } from "react";
import { Link } from "../../lib/app-state";
import { withView } from "../../lib/url-state";

export interface BarDatum {
  id: string;
  label: string;
  v: number;
  /** Accent for TypeWhisper engines, quiet gray for the rest. Ignored when `color` is set. */
  emphasis?: boolean;
  /** Fixed fill, e.g. a compare color. */
  color?: string;
  /** Small dot before the label (the model's compare color). */
  swatch?: string;
  /** Picked for comparison: bold label. */
  picked?: boolean;
  /** Muted: e.g. a language the model is not trained for. */
  muted?: boolean;
  /** Ran on fewer suites than the others: the value gets an asterisk. */
  partial?: boolean;
  note?: string;
}

interface Props {
  data: BarDatum[];
  format: (value: number) => string;
  /** "log" draws a dot on a log axis instead of a bar (for times that span 1000x). */
  scale?: "linear" | "log";
  /** Fixed upper bound for linear bars, e.g. 1 for percentages. */
  max?: number;
  limit?: number;
  ariaLabel: string;
  /** Rank numbers in front of each row. */
  ranked?: boolean;
}

export function RankedBars({ data, format, scale = "linear", max, limit, ariaLabel, ranked = true }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = limit && !showAll ? data.slice(0, limit) : data;
  const values = data.map((datum) => datum.v).filter((v) => v > 0);
  // Bars start at zero; the scale ends at the largest value shown, so the visible rows use the width.
  const top = max ?? Math.max(...visible.map((datum) => datum.v), 1e-9) * 1.04;
  const logMin = values.length ? Math.log10(Math.min(...values) / 1.5) : 0;
  const logMax = values.length ? Math.log10(Math.max(...values) * 1.1) : 1;

  const position = (value: number) =>
    scale === "log"
      ? value > 0
        ? (Math.log10(value) - logMin) / (logMax - logMin || 1)
        : 0
      : Math.min(1, Math.max(0, value / top));

  return (
    <div>
      <ol aria-label={ariaLabel} className="flex flex-col">
        {visible.map((datum, index) => {
          const fraction = position(datum.v);
          const fill = datum.color ?? (datum.emphasis ? "var(--mark)" : "var(--mark-quiet)");
          return (
            <li key={datum.id}>
              <Link
                to={(state) => withView(state, "model", { model: datum.id })}
                className={clsx(
                  "group grid items-center gap-x-3 rounded-md py-[5px] text-[0.8125rem] hover:bg-surface",
                  ranked
                    ? "grid-cols-[1.5rem_minmax(7rem,10rem)_1fr_4rem] sm:grid-cols-[1.5rem_minmax(8.5rem,11.5rem)_1fr_4.25rem]"
                    : "grid-cols-[minmax(7rem,10rem)_1fr_4rem] pl-1 sm:grid-cols-[minmax(8rem,13rem)_1fr_4.25rem]"
                )}
                title={datum.note ? `${datum.label}: ${format(datum.v)} (${datum.note})` : `${datum.label}: ${format(datum.v)}`}
              >
                {ranked && <span className="meta pl-1 text-right tabular-nums">{index + 1}</span>}
                <span className={clsx("truncate", datum.picked && "font-semibold", datum.muted && "text-muted")}>
                  {(datum.swatch ?? datum.color) && (
                    <span className="swatch mr-1.5 align-[-1px]" style={{ background: datum.swatch ?? datum.color }} aria-hidden="true" />
                  )}
                  {datum.label}
                </span>
                <span className="relative h-3" aria-hidden="true">
                  {scale === "log" ? (
                    <>
                      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--grid)]" />
                      <span
                        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[color:var(--background)]"
                        style={{ left: `${fraction * 100}%`, background: fill, opacity: datum.muted ? 0.5 : 1 }}
                      />
                    </>
                  ) : (
                    <span
                      className="absolute inset-y-0 left-0 rounded-r-[4px]"
                      style={{
                        width: `max(2px, ${fraction * 100}%)`,
                        background: fill,
                        opacity: datum.muted ? 0.45 : 1,
                      }}
                    />
                  )}
                </span>
                <span className={clsx("text-right tabular-nums", datum.picked ? "font-semibold" : "font-medium", datum.muted && "text-muted")}>
                  {format(datum.v)}
                  {datum.partial && <sup className="text-muted">*</sup>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {limit && data.length > limit && (
        <button type="button" className="btn btn-ghost mt-2 -ml-3 text-accent" onClick={() => setShowAll((value) => !value)}>
          {showAll ? `Show top ${limit}` : `Show all ${data.length}`}
        </button>
      )}
    </div>
  );
}
