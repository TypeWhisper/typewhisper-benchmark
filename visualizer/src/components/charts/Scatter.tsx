import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { paretoFrontier } from "./pareto";
import { useElementWidth } from "./use-element-width";

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  /** TypeWhisper engines carry the accent; everything else stays quiet. */
  emphasis: boolean;
  /** Models picked for comparison: always labeled, ringed in their compare color. */
  color?: string;
  /** Labeled when there is room, e.g. TypeWhisper's default engines. */
  pin?: boolean;
  detail?: string;
}

interface Props {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** Formats exact values in the tooltip; defaults to the tick formatters. */
  formatXValue?: (value: number) => string;
  formatYValue?: (value: number) => string;
  onOpen?: (id: string) => void;
  ariaLabel: string;
}

const MARGIN = { top: 18, right: 18, bottom: 46, left: 56 };
const LABEL_FONT = 11;
const CHAR_WIDTH = 6.3;

function niceCeil(value: number): number {
  if (value <= 0) return 0.05;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function linearTicks(max: number): number[] {
  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 1000; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent += 1) {
    for (const factor of [1, 3]) {
      const value = factor * 10 ** exponent;
      if (value >= min && value <= max) ticks.push(value);
    }
  }
  return ticks;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function Scatter({ points, xLabel, yLabel, formatX, formatY, formatXValue = formatX, formatYValue = formatY, onOpen, ariaLabel }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const hintId = useId();
  const svgRef = useRef<SVGSVGElement>(null);

  const height = Math.round(Math.min(440, Math.max(300, width * 0.62)));
  const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const layout = useMemo(() => {
    const usable = points.filter((point) => point.x > 0 && Number.isFinite(point.y));
    if (!usable.length || width === 0) return null;
    const xs = usable.map((point) => point.x);
    const ys = usable.map((point) => point.y).sort((a, b) => a - b);
    const xMin = 10 ** Math.floor(Math.log10(Math.min(...xs) / 1.2));
    const xMax = 10 ** Math.ceil(Math.log10(Math.max(...xs) * 1.2));
    // Keep the crowd readable: a few outliers (English-only models on German, say) sit on the
    // top edge instead of squashing everyone else into the bottom of the chart.
    const cap = ys[Math.floor(0.85 * (ys.length - 1))] * 1.45;
    const yMax = niceCeil(Math.max(0.02, Math.min(ys[ys.length - 1] * 1.05, cap)));
    const sx = (value: number) => MARGIN.left + ((Math.log10(value) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotW;
    const sy = (value: number) => MARGIN.top + plotH - (Math.min(value, yMax) / yMax) * plotH;

    const placed = usable.map((point) => ({ ...point, px: sx(point.x), py: sy(point.y), clipped: point.y > yMax }));
    const frontier = paretoFrontier(usable);
    const frontierIds = new Set(frontier.map((point) => point.id));

    // Labels: picked models first, then the frontier, then the most accurate few.
    const byAccuracy = [...placed].sort((a, b) => a.y - b.y).slice(0, 3).map((point) => point.id);
    const wanted = [
      ...placed.filter((point) => point.color).map((point) => point.id),
      ...frontier.map((point) => point.id),
      ...byAccuracy,
      ...placed.filter((point) => point.pin).map((point) => point.id),
    ];
    const boxes: Box[] = placed.map((point) => ({ x: point.px - 6, y: point.py - 6, w: 12, h: 12 }));
    const labels: Array<{ id: string; x: number; y: number; anchor: "start" | "end"; text: string }> = [];
    const seen = new Set<string>();
    for (const id of wanted) {
      if (seen.has(id)) continue;
      seen.add(id);
      const point = placed.find((candidate) => candidate.id === id);
      if (!point) continue;
      const w = point.label.length * CHAR_WIDTH + 4;
      const h = LABEL_FONT + 3;
      const options: Array<{ box: Box; x: number; y: number; anchor: "start" | "end" }> = [
        { box: { x: point.px + 8, y: point.py - h / 2, w, h }, x: point.px + 9, y: point.py + 4, anchor: "start" },
        { box: { x: point.px - 8 - w, y: point.py - h / 2, w, h }, x: point.px - 9, y: point.py + 4, anchor: "end" },
        { box: { x: point.px - w / 2, y: point.py - 8 - h, w, h }, x: point.px - w / 2 + 2, y: point.py - 10, anchor: "start" },
        { box: { x: point.px - w / 2, y: point.py + 8, w, h }, x: point.px - w / 2 + 2, y: point.py + 8 + LABEL_FONT, anchor: "start" },
      ];
      const fit = options.find(
        (option) =>
          option.box.x >= MARGIN.left - 4 &&
          option.box.x + option.box.w <= MARGIN.left + plotW + 4 &&
          option.box.y >= MARGIN.top - 4 &&
          option.box.y + option.box.h <= MARGIN.top + plotH + 2 &&
          !boxes.some((box) => overlaps(box, option.box))
      );
      if (!fit) continue;
      boxes.push(fit.box);
      labels.push({ id, x: fit.x, y: fit.y, anchor: fit.anchor, text: point.label });
    }

    let frontierPath = "";
    frontier.forEach((point, index) => {
      const x = sx(point.x);
      const y = sy(point.y);
      frontierPath += index === 0 ? `M${x},${y}` : `H${x}V${y}`;
    });

    return {
      placed,
      frontierIds,
      frontierPath,
      labels,
      xTicks: logTicks(xMin, xMax),
      yTicks: linearTicks(yMax),
      sx,
      sy,
      yMax,
      clippedCount: placed.filter((point) => point.clipped).length,
      order: [...placed].sort((a, b) => a.x - b.x).map((point) => point.id),
    };
  }, [points, width, plotW, plotH]);

  const activePoint = layout?.placed.find((point) => point.id === active) ?? null;

  const nearest = (event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>): string | null => {
    if (!layout || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: string | null = null;
    let bestDistance = 28 * 28;
    for (const point of layout.placed) {
      const distance = (point.px - x) ** 2 + (point.py - y) ** 2;
      if (distance < bestDistance) {
        best = point.id;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse") setActive(nearest(event));
  };

  // Mouse: the hovered point opens. Touch: the first tap shows the point, the second opens it.
  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const id = nearest(event);
    if (!id) return setActive(null);
    if (id === active) onOpen?.(id);
    else setActive(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!layout) return;
    const order = layout.order;
    const index = active ? order.indexOf(active) : -1;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setActive(order[Math.min(order.length - 1, index + 1)]);
    } else if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setActive(order[Math.max(0, index < 0 ? 0 : index - 1)]);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(order[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(order[order.length - 1]);
    } else if (event.key === "Enter" && active) {
      onOpen?.(active);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const tooltipLeft = activePoint ? Math.min(Math.max(activePoint.px + 14, 8), Math.max(8, width - 230)) : 0;
  const tooltipFlip = activePoint && activePoint.px > width - 250;

  return (
    <div className="relative">
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative rounded-lg"
      >
        <span id={hintId} className="visually-hidden">
          Arrow keys step through the models from fastest to slowest; Enter opens the model. The table below lists every value.
        </span>
        {layout && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="block touch-pan-y select-none"
            onPointerMove={onPointerMove}
            onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
            onClick={onClick}
            style={{ cursor: active ? "pointer" : "default" }}
            aria-hidden="true"
          >
            {layout.yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={layout.sy(tick)} y2={layout.sy(tick)} stroke="var(--grid)" />
                <text x={MARGIN.left - 8} y={layout.sy(tick) + 3.5} textAnchor="end" className="fill-[color:var(--muted-foreground)] text-[11px] tabular-nums">
                  {formatY(tick)}
                </text>
              </g>
            ))}
            {layout.xTicks.map((tick) => (
              <g key={`x${tick}`}>
                <line x1={layout.sx(tick)} x2={layout.sx(tick)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--grid)" />
                <text x={layout.sx(tick)} y={MARGIN.top + plotH + 16} textAnchor="middle" className="fill-[color:var(--muted-foreground)] text-[11px] tabular-nums">
                  {formatX(tick)}
                </text>
              </g>
            ))}
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH} stroke="var(--axis)" />
            <text x={MARGIN.left + plotW / 2} y={height - 6} textAnchor="middle" className="fill-[color:var(--muted-foreground)] text-[11px]">
              {xLabel}
            </text>
            <text
              transform={`translate(13 ${MARGIN.top + plotH / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-[color:var(--muted-foreground)] text-[11px]"
            >
              {yLabel}
            </text>

            <path d={layout.frontierPath} fill="none" stroke="var(--mark)" strokeWidth={1.5} strokeOpacity={0.45} strokeLinejoin="round" />

            {/* Quiet points first, so emphasized and picked ones sit on top. */}
            {[...layout.placed]
              .sort((a, b) => Number(a.emphasis) - Number(b.emphasis) || Number(Boolean(a.color)) - Number(Boolean(b.color)))
              .map((point) => {
                const isActive = point.id === active;
                const fill = point.emphasis ? "var(--mark)" : "var(--mark-quiet)";
                const r = isActive ? 6.5 : point.color ? 5.5 : 4.5;
                return (
                  <g key={point.id}>
                    {point.clipped ? (
                      <path
                        d={`M${point.px},${point.py - 1} l5,8 h-10 z`}
                        transform={`translate(0 ${-1})`}
                        fill={fill}
                        stroke="var(--background)"
                        strokeWidth={2}
                        paintOrder="stroke"
                      />
                    ) : (
                      <circle cx={point.px} cy={point.py} r={r} fill={fill} stroke="var(--background)" strokeWidth={2} />
                    )}
                    {point.color && (
                      <circle cx={point.px} cy={point.py} r={r + 3.5} fill="none" stroke={point.color} strokeWidth={2} />
                    )}
                    {isActive && <circle cx={point.px} cy={point.py} r={r + 7} fill="none" stroke="var(--foreground)" strokeOpacity={0.35} />}
                  </g>
                );
              })}
            {layout.labels.map((label) => (
              <text
                key={`l${label.id}`}
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                className="fill-[color:var(--foreground)] text-[11px] font-medium"
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {label.text}
              </text>
            ))}
          </svg>
        )}
        {activePoint && (
          <div
            className="tooltip fade-in"
            style={{
              left: tooltipFlip ? undefined : tooltipLeft,
              right: tooltipFlip ? Math.max(8, width - activePoint.px + 14) : undefined,
              top: Math.max(4, activePoint.py - 40),
            }}
          >
            <div className="font-semibold">{activePoint.label}</div>
            <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 tabular-nums">
              <span className="text-muted">{yLabel.split(" (")[0]}</span>
              <span className="text-right font-medium">{formatYValue(activePoint.y)}</span>
              <span className="text-muted">{xLabel.split(" (")[0]}</span>
              <span className="text-right font-medium">{formatXValue(activePoint.x)} ms</span>
            </div>
            {activePoint.detail && <div className="meta mt-1.5">{activePoint.detail}</div>}
            {layout?.frontierIds.has(activePoint.id) && (
              <div className="mt-1.5 text-xs text-accent">On the frontier: nothing is both faster and more accurate.</div>
            )}
          </div>
        )}
      </div>
      {layout && layout.clippedCount > 0 && (
        <p className="note mt-2">
          ▲ {layout.clippedCount} {layout.clippedCount === 1 ? "model sits" : "models sit"} above {formatY(layout.yMax)} and{" "}
          {layout.clippedCount === 1 ? "is" : "are"} pinned to the top edge.
        </p>
      )}
    </div>
  );
}
