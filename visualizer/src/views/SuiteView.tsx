import clsx from "clsx";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { MAX_COMPARE, withView, type Dir } from "../lib/url-state";
import { formatMetric, formatUnit, plural } from "../lib/format";
import {
  ACCENTED,
  allModelIds,
  betterFirst,
  buildRows,
  categoryName,
  chartMax,
  chartScale,
  languageName,
  matchesModelFilters,
  median,
  METRICS,
  resolveColumn,
  sortRows,
  type Column,
} from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import { hasKey } from "../data/links";
import { useClips } from "../data/load";
import { ClipStatus, type ClipFile, type Summary } from "../data/types";
import { FilterBar } from "../components/FilterBar";
import { ShareButton } from "../components/Header";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { RankedBars } from "../components/charts/RankedBars";
import { seriesColor } from "../lib/series";
import { DiffLegend, TranscriptLine } from "../components/Transcripts";
import { Direction, Loading, Notice, PageHead, Section } from "../components/ui";

function suiteColumns(summary: Summary, suite: string): Column[] {
  const info = summary.suites[suite];
  const fixed = (id: string, metric: Column["metric"], label: string, help: string): Column => ({
    id,
    metric,
    lang: metric === "ms" || metric === "rtf" ? null : info.language,
    label,
    suites: [suite],
    kind: "fixed",
    help,
  });
  const columns = [
    fixed("wer", "wer", "WER", "Word error rate on this suite, normalized. Lower is better."),
    fixed("cer", "cer", "CER", "Character error rate on this suite. Lower is better."),
  ];
  if (info.scores.includes("p")) columns.push(fixed("punct", "punct", "Punct", "Punctuation score on this suite. Higher is better."));
  if (info.scores.includes("f")) columns.push(fixed("fmt", "fmt", "Fmt", "Formatting score on this suite. Higher is better."));
  if (info.scores.includes("dg")) {
    columns.push(fixed("digits", "digits", "Digits", "Share of clips whose numbers all appear exactly as in the reference. Higher is better."));
  }
  columns.push(
    fixed("ms", "ms", "ms/clip", "Mean time per clip on this suite, measured inside each runtime. Lower is better."),
    fixed("rtf", "rtf", "RTF", "Processing time divided by audio length on this suite. Lower is better.")
  );
  return columns;
}

const PAGE = 15;

function SuiteClips({ summary, file, modelIds }: { summary: Summary; file: ClipFile; modelIds: string[] }) {
  const { state } = useAppState();
  const [order, setOrder] = useState<"hard" | "order">("hard");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(() => new Set(state.clip ? [state.clip] : []));
  const [onlyPicked, setOnlyPicked] = useState(false);
  // A clip opened through a link opens its transcripts too.
  const [lastClip, setLastClip] = useState(state.clip);
  if (state.clip !== lastClip) {
    setLastClip(state.clip);
    if (state.clip) setOpen((current) => new Set(current).add(state.clip as string));
  }
  const linkedRef = useRef<HTMLLIElement | null>(null);
  const pickedHere = state.models.filter((id) => file.results[id]);
  const shownIds = onlyPicked && pickedHere.length ? pickedHere : modelIds;

  const entries = useMemo(() => {
    let list = file.clips.map((clip, index) => {
      const wers = shownIds
        .map((id) => file.results[id]?.[index])
        .filter((result) => result && result[4] === ClipStatus.Ok)
        .map((result) => result![1]);
      return {
        clip,
        index,
        best: wers.length ? Math.min(...wers) : null,
        median: median(wers),
        worst: wers.length ? Math.max(...wers) : null,
        perfect: wers.filter((wer) => wer === 0).length,
        count: wers.length,
      };
    });
    if (order === "hard") list = [...list].sort((a, b) => (b.median ?? 0) - (a.median ?? 0) || a.index - b.index);
    const linked = list.findIndex((entry) => entry.clip.id === state.clip);
    if (linked > 0) list = [list[linked], ...list.slice(0, linked), ...list.slice(linked + 1)];
    return list;
  }, [file, shownIds, order, state.clip]);

  useEffect(() => {
    if (state.clip && linkedRef.current) linkedRef.current.scrollIntoView({ block: "start" });
    // Scroll once per linked clip.
  }, [state.clip, file]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="segmented" role="group" aria-label="Order">
          <button type="button" aria-pressed={order === "hard"} onClick={() => setOrder("hard")}>
            Hardest first
          </button>
          <button type="button" aria-pressed={order === "order"} onClick={() => setOrder("order")}>
            Suite order
          </button>
        </div>
        {pickedHere.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={onlyPicked} onChange={(event) => setOnlyPicked(event.target.checked)} />
            Only the {pickedHere.length} picked {pickedHere.length === 1 ? "model" : "models"}
          </label>
        )}
      </div>
      {file.clips.some((clip) => clip.ref != null) && <DiffLegend />}
      <ol className="mt-4">
        {entries.slice(0, limit).map((entry) => {
          const { clip, index } = entry;
          const isOpen = open.has(clip.id);
          const reference = clip.fref ?? clip.ref;
          const results = shownIds
            .map((id) => ({ id, result: file.results[id]?.[index] }))
            .filter((item) => item.result)
            .sort((a, b) => {
              const left = a.result![4] === ClipStatus.Ok ? a.result![1] : 2;
              const right = b.result![4] === ClipStatus.Ok ? b.result![1] : 2;
              return left - right;
            });
          return (
            <li
              key={clip.id}
              ref={clip.id === state.clip ? linkedRef : undefined}
              className={clsx(
                "border-t border-hairline py-4",
                clip.id === state.clip && "-mx-3 rounded-xl border-transparent bg-[color-mix(in_srgb,var(--mark)_8%,transparent)] px-3"
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link to={(s) => ({ ...s, clip: clip.id })} replace className="meta text-accent hover:underline" title="Link to this clip">
                  {clip.id}
                </Link>
                <span className="meta">{[clip.sec ? `${clip.sec.toFixed(1)} s` : null, ...(clip.tags ?? [])].filter(Boolean).join(" · ")}</span>
              </div>
              {reference != null && <p className="mt-1.5 font-mono text-[0.875rem] leading-relaxed">{reference}</p>}
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1.5 rounded text-[0.8125rem] text-muted hover:text-fg"
                aria-expanded={isOpen}
                onClick={() => toggle(clip.id)}
              >
                <ChevronDown className={clsx("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                {entry.count > 0 ? (
                  <span className="tabular-nums">
                    {entry.perfect} of {entry.count} models perfect · median WER {formatMetric("wer", entry.median)} · worst{" "}
                    {formatMetric("wer", entry.worst)}
                  </span>
                ) : (
                  "No transcripts"
                )}
              </button>
              {isOpen && (
                <ul className="mt-3 flex flex-col gap-2">
                  {results.map(({ id, result }) => {
                    const meta = modelMeta(id, summary.models[id]?.type);
                    const pickIndex = state.models.indexOf(id);
                    return (
                      <li key={id} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(9rem,13rem)_1fr_4rem]">
                        <Link
                          to={(s) => withView(s, "model", { model: id, suite: file.suite, clip: clip.id })}
                          className="flex items-baseline gap-2 truncate text-[0.8125rem] font-medium hover:text-accent"
                        >
                          {pickIndex >= 0 && <span className="swatch" style={{ background: seriesColor(pickIndex) }} aria-hidden="true" />}
                          {meta.short}
                        </Link>
                        <p className="font-mono text-[0.8125rem] leading-relaxed break-words">
                          <TranscriptLine clip={clip} result={result} />
                        </p>
                        <span className="text-[0.8125rem] tabular-nums sm:text-right">
                          {result![4] === ClipStatus.Ok ? formatMetric("wer", result![1]) : "–"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {entries.length > limit && (
        <button type="button" className="btn mt-4" onClick={() => setLimit((value) => value + PAGE)}>
          Show {Math.min(PAGE, entries.length - limit)} more clips
        </button>
      )}
    </div>
  );
}

export function SuiteView({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const suite = state.suite;
  const info = suite && hasKey(summary.suites, suite) ? summary.suites[suite] : undefined;
  const metricId = useId();
  const { deploy, tw, q, lang } = state;

  const columns = useMemo(() => (suite && info ? suiteColumns(summary, suite) : []), [summary, suite, info]);
  const rows = useMemo(() => {
    if (!suite) return [];
    const ids = allModelIds(summary).filter((id) => summary.cells[id]?.[suite] && matchesModelFilters(summary, id, { deploy, tw, q }));
    return buildRows(summary, ids, columns);
  }, [summary, suite, columns, deploy, tw, q]);
  const clips = useClips(info ? suite : null, summary.version);

  if (!suite || !info) {
    return (
      <div className="wrap py-16">
        <p className="label">Suite</p>
        <h1 className="mt-3 text-3xl font-semibold">No suite {suite ? <code className="font-mono">{suite}</code> : "picked"}.</h1>
        <Link to={(s) => withView(s, "suites")} className="btn mt-6">
          See all suites <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const sortColumn = resolveColumn(columns, state.sort, lang);
  const dir: Dir = state.dir ?? betterFirst(sortColumn);
  const sorted = sortRows(rows, sortColumn, dir);
  const chartColumn = resolveColumn(columns, state.metric ?? state.sort, lang);
  const chartUnit = METRICS[chartColumn.metric].unit;
  const withResults = rows.filter((row) => row.values.wer?.v != null);
  const skipped = rows.filter((row) => row.values.wer?.skipped).length;

  const onSort = (column: Column) => {
    const preferred = betterFirst(column);
    if (column.id === sortColumn.id) {
      const next: Dir = dir === "asc" ? "desc" : "asc";
      navigate((s) => ({ ...s, sort: column.id, dir: next === preferred ? null : next }), { replace: true });
    } else {
      navigate((s) => ({ ...s, sort: column.id, dir: null, metric: null }), { replace: true });
    }
  };

  return (
    <>
      <PageHead
        label={`${languageName(info.language)} · ${categoryName(info.category)} · ${info.tier}`}
        title={info.name}
        lede={info.description}
        meta={
          <>
            <span className="text-fg">{suite}</span>
            <span aria-hidden="true">·</span>
            <span>{plural(info.clips, "clip")}</span>
            <span aria-hidden="true">·</span>
            <span>{info.origin === "public" ? "real recordings" : "synthetic (TTS, some with mixed-in noise)"}</span>
            <span aria-hidden="true">·</span>
            <span>
              {plural(withResults.length, "model")}
              {skipped ? `, ${skipped} skipped` : ""}
            </span>
          </>
        }
        actions={<ShareButton />}
      />
      {info.category === ACCENTED && (
        <div className="wrap mb-6">
          <Notice tone="warn">
            The references of this suite do not match its audio (see PR #6): every model scores about 90% WER. The leaderboard
            leaves this suite out unless you include it.
          </Notice>
        </div>
      )}
      <FilterBar summary={summary} controls={["deploy", "tw", "q"]} />

      <Section
        id="ranking"
        title="Ranking"
        aside={
          <div className="flex items-end gap-3">
            <div className="field">
              <label htmlFor={metricId}>Ranked by</label>
              <select
                id={metricId}
                className="select"
                value={chartColumn.id}
                onChange={(event) => navigate((s) => ({ ...s, metric: event.target.value }), { replace: true })}
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
            </div>
            <Direction better={METRICS[chartColumn.metric].better} />
          </div>
        }
      >
        <div className="max-w-3xl">
          <RankedBars
            data={sortRows(rows, chartColumn, betterFirst(chartColumn))
              .filter((row) => row.values[chartColumn.id]?.v != null)
              .map((row) => ({
                id: row.id,
                label: row.meta.short,
                v: row.values[chartColumn.id].v as number,
                emphasis: row.meta.tw.status === "engine",
                picked: state.models.includes(row.id),
                swatch: state.models.includes(row.id) ? seriesColor(state.models.indexOf(row.id)) : undefined,
                muted: row.values[chartColumn.id].outside,
              }))}
            format={(value) => formatUnit(chartUnit, value)}
            scale={chartScale(chartUnit)}
            max={chartMax(chartColumn.metric)}
            limit={20}
            ariaLabel={`Models ranked by ${chartColumn.label} on ${info.name}`}
          />
        </div>
      </Section>

      <Section id="table" title="All results" lede="Speed here is this suite's clips only.">
        <LeaderboardTable
          summary={summary}
          rows={sorted}
          columns={columns}
          sortColumn={sortColumn}
          dir={dir}
          onSort={onSort}
          picked={state.models}
          onTogglePick={(id) =>
            navigate(
              (s) => ({ ...s, models: s.models.includes(id) ? s.models.filter((m) => m !== id) : [...s.models, id].slice(0, MAX_COMPARE) }),
              { replace: true }
            )
          }
          caption={`Results on ${info.name}`}
        />
      </Section>

      <Section id="clips" title="Clips" lede="Open a clip to read every model's transcript, best first.">
        {!clips || clips.status === "loading" ? (
          <Loading label="Loading transcripts…" />
        ) : clips.status === "error" ? (
          <Notice tone="warn">Could not load the transcripts ({clips.error}).</Notice>
        ) : (
          <SuiteClips summary={summary} file={clips.data} modelIds={sorted.map((row) => row.id)} />
        )}
      </Section>
    </>
  );
}
