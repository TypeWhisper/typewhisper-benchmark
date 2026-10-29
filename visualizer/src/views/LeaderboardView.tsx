import { useId, useMemo } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { MAX_COMPARE, withView, type Dir } from "../lib/url-state";
import { formatCount, formatDate, formatMetric, formatUnit, listJoin, plural } from "../lib/format";
import {
  allModelIds,
  betterFirst,
  latestRun,
  buildColumns,
  buildRows,
  languageName,
  matchesModelFilters,
  METRICS,
  resolveColumn,
  sortRows,
  type Column,
} from "../data/metrics";
import type { Summary } from "../data/types";
import { FilterBar } from "../components/FilterBar";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { RankedBars } from "../components/charts/RankedBars";
import { Scatter } from "../components/charts/Scatter";
import { ScopeNote } from "../components/ScopeNote";
import { runtimeShort, seriesColor } from "../lib/series";
import { Direction, PageHead, Section } from "../components/ui";

export function SpeedCaveat() {
  return (
    <p className="note max-w-3xl">
      Speed is measured inside each runtime: the FluidAudio and MLX workers time the model call, whisper.cpp starts
      whisper-cli for every clip, and CrispASR and the cloud APIs include an HTTP round trip (cloud: over the internet).
      Read speed gaps between runtimes as rough orders of magnitude.
    </p>
  );
}

export function LeaderboardView({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const { lang, tier, cat, origin, acc, deploy, tw, q } = state;
  const metricSelectId = useId();

  const columns = useMemo(() => buildColumns(summary, { lang, tier, cat, origin, acc }), [summary, lang, tier, cat, origin, acc]);
  const rows = useMemo(() => {
    const ids = allModelIds(summary).filter((id) => matchesModelFilters(summary, id, { deploy, tw, q }));
    return buildRows(summary, ids, columns);
  }, [summary, columns, deploy, tw, q]);

  const sortColumn = resolveColumn(columns, state.sort, lang);
  const dir: Dir = state.dir ?? betterFirst(sortColumn);
  const sorted = useMemo(() => sortRows(rows, sortColumn, dir), [rows, sortColumn, dir]);

  // The charts follow ?metric=, else the sorted column.
  const chartColumn = resolveColumn(columns, state.metric ?? state.sort, lang);
  const werColumns = columns.filter((column) => column.metric === "wer");
  const scatterColumn = werColumns.find((column) => column.lang === chartColumn.lang) ?? werColumns[0];
  const msColumn = columns.find((column) => column.metric === "ms");

  const picked = state.models;
  const togglePick = (id: string) =>
    navigate(
      (s) => ({
        ...s,
        models: s.models.includes(id) ? s.models.filter((model) => model !== id) : [...s.models, id].slice(0, MAX_COMPARE),
      }),
      { replace: true }
    );

  const onSort = (column: Column) => {
    const preferred = betterFirst(column);
    if (column.id === sortColumn.id) {
      const next: Dir = dir === "asc" ? "desc" : "asc";
      navigate((s) => ({ ...s, sort: column.id, dir: next === preferred ? null : next }), { replace: true });
    } else {
      navigate((s) => ({ ...s, sort: column.id, dir: null, metric: null }), { replace: true });
    }
  };

  const openModel = (id: string) => navigate((s) => withView(s, "model", { model: id }));

  const scatterPoints =
    scatterColumn && msColumn
      ? rows
          .filter((row) => row.values[scatterColumn.id]?.v != null && (row.values[msColumn.id]?.v ?? 0) > 0)
          .map((row) => ({
            id: row.id,
            label: row.meta.short,
            x: row.values[msColumn.id].v as number,
            y: row.values[scatterColumn.id].v as number,
            emphasis: row.meta.tw.status === "engine",
            color: picked.includes(row.id) ? seriesColor(picked.indexOf(row.id)) : undefined,
            pin: Boolean(row.meta.tw.isDefault),
            partial: row.values[scatterColumn.id].missing.length > 0,
            faint: row.values[scatterColumn.id].outside,
            detail: `${row.meta.org} · ${runtimeShort(row.id, row.meta)}`,
          }))
      : [];

  const barData = sortRows(rows, chartColumn, betterFirst(chartColumn))
    .filter((row) => row.values[chartColumn.id]?.v != null)
    .map((row) => ({
      id: row.id,
      label: row.meta.short,
      v: row.values[chartColumn.id].v as number,
      emphasis: row.meta.tw.status === "engine",
      picked: picked.includes(row.id),
      swatch: picked.includes(row.id) ? seriesColor(picked.indexOf(row.id)) : undefined,
      muted: row.values[chartColumn.id].outside,
      partial: row.values[chartColumn.id].missing.length > 0,
      note: row.values[chartColumn.id].outside
        ? "not trained for this language"
        : row.values[chartColumn.id].missing.length
          ? "ran on fewer suites"
          : undefined,
    }));

  // Leaders: the most accurate model per language under the current filters.
  const leaders = werColumns
    .map((column) => {
      const best = sortRows(rows, column, "asc").find((row) => row.values[column.id]?.v != null && !row.values[column.id].missing.length);
      return best ? { column, row: best } : null;
    })
    .filter((leader): leader is NonNullable<typeof leader> => leader !== null);

  const modelCount = Object.keys(summary.models).length;
  const clipCount = Object.values(summary.suites).reduce((sum, suite) => sum + suite.clips, 0);
  const languages = [...new Set(Object.values(summary.suites).map((suite) => suite.language))].filter((l) => l !== "auto");
  const chartUnit = METRICS[chartColumn.metric].unit;
  const scatterLang = scatterColumn?.lang ? languageName(scatterColumn.lang) : "";

  return (
    <>
      <PageHead
        label="Speech-to-text benchmark"
        title="Speech models, measured for dictation."
        lede={
          <>
            {modelCount} models on the same {formatCount(clipCount)} clips in {listJoin(languages.map(languageName))}: word
            errors, punctuation, numbers and speed. Open any model or suite to read the transcripts behind the scores.
          </>
        }
        meta={
          <>
            <span>Latest run {formatDate(latestRun(summary))}</span>
            <span aria-hidden="true">·</span>
            <span>{plural(modelCount, "result file")}</span>
            <span aria-hidden="true">·</span>
            <a className="link" href="https://github.com/TypeWhisper/typewhisper-benchmark/tree/main/visualizer/public/data/results">
              Raw results on GitHub
            </a>
          </>
        }
      />

      <FilterBar summary={summary} controls={["lang", "tier", "cat", "origin", "acc", "deploy", "tw", "q"]} />

      <div className="wrap pt-4">
        <ScopeNote />
      </div>

      {leaders.length > 0 && (
        <div className="wrap mt-8">
          <ul className="grid grid-cols-1 border-t border-hairline sm:grid-cols-2 lg:grid-cols-4" aria-label="Most accurate per language">
            {leaders.map(({ column, row }) => (
              <li key={column.id} className="border-b border-hairline py-4 sm:pr-6 lg:border-b-0">
                <p className="meta uppercase">Lowest WER · {column.lang ? languageName(column.lang) : ""}</p>
                <p className="mt-1.5 text-[1.75rem] leading-none font-semibold tracking-[-0.02em]">
                  {formatMetric("wer", row.values[column.id].v)}
                </p>
                <Link
                  to={(s) => withView(s, "model", { model: row.id })}
                  className="mt-1.5 inline-block text-sm text-muted hover:text-accent hover:underline"
                >
                  {row.meta.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="wrap py-16 text-center">
          <p className="text-lg font-semibold">No model matches these filters.</p>
          <p className="mt-2 text-sm text-muted">Clear the search or pick another runtime or TypeWhisper filter.</p>
        </div>
      ) : (
        <>
          <Section
            id="charts"
            title="Accuracy and speed"
            lede={
              <>
                Each dot is a model. Blue dots are engines TypeWhisper ships; the line joins the models that nothing beats
                on both accuracy and speed.
              </>
            }
          >
            <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <figure className="min-w-0">
                <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="block text-[0.9375rem] font-semibold">
                      WER{scatterLang ? ` (${scatterLang})` : ""} against time per clip
                    </span>
                    <span className="note">Bottom left is better: fewer errors, less time.</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="swatch" style={{ background: "var(--mark)" }} aria-hidden="true" />
                      TypeWhisper engine
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="swatch" style={{ background: "var(--mark-quiet)" }} aria-hidden="true" />
                      Other model
                    </span>
                    {scatterPoints.some((point) => point.partial) && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="swatch border-[1.75px] border-[color:var(--mark-quiet)] bg-transparent" aria-hidden="true" />
                        Fewer suites
                      </span>
                    )}
                    {picked.length > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="swatch border-2 border-[color:var(--s1)] bg-transparent" aria-hidden="true" />
                        Picked
                      </span>
                    )}
                  </span>
                </figcaption>
                {scatterColumn && msColumn ? (
                  <Scatter
                    points={scatterPoints}
                    xLabel="ms per clip (log scale) · lower is better"
                    yLabel={`WER ${scatterColumn.lang?.toUpperCase() ?? ""} · lower is better`}
                    formatX={(value) => (value >= 1000 ? `${value / 1000} s` : `${value} ms`)}
                    formatY={(value) => formatUnit("pct", value).replace(".0%", "%")}
                    formatXValue={(value) => formatUnit("ms", value)}
                    formatYValue={(value) => formatUnit("pct", value)}
                    onOpen={openModel}
                    ariaLabel={`WER in ${scatterLang} against milliseconds per clip for ${scatterPoints.length} models`}
                  />
                ) : (
                  <p className="text-sm text-muted">No WER suites in this scope.</p>
                )}
                <div className="mt-4">
                  <SpeedCaveat />
                </div>
              </figure>

              <figure className="min-w-0">
                <figcaption className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div className="field">
                    <label htmlFor={metricSelectId}>Ranked by</label>
                    <select
                      id={metricSelectId}
                      className="select"
                      value={chartColumn.id}
                      onChange={(event) => navigate((s) => ({ ...s, metric: event.target.value }), { replace: true })}
                    >
                      {columns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.label}
                          {column.lang && lang !== "all" ? ` (${column.lang.toUpperCase()})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Direction better={METRICS[chartColumn.metric].better} />
                </figcaption>
                <p className="note mb-4">{chartColumn.help}</p>
                <RankedBars
                  data={barData}
                  format={(value) => formatUnit(chartUnit, value)}
                  scale={chartUnit === "ms" || chartUnit === "rtf" ? "log" : "linear"}
                  max={chartColumn.metric === "wer" || chartColumn.metric === "cer" ? undefined : 1}
                  limit={15}
                  ariaLabel={`Models ranked by ${chartColumn.label}`}
                />
                {(barData.some((datum) => datum.partial) || barData.some((datum) => datum.muted)) && (
                  <p className="note mt-3">
                    {barData.some((datum) => datum.partial) && "* Ran on fewer of these suites, so not directly comparable. "}
                    {barData.some((datum) => datum.muted) && "Faded: not trained for this language."}
                  </p>
                )}
              </figure>
            </div>
          </Section>

          <Section
            id="table"
            title="All models"
            lede={
              <>
                Sort by any column. Tick models to compare them side by side. Blue bold marks the best value in a column.
              </>
            }
          >
            <LeaderboardTable
              summary={summary}
              rows={sorted}
              columns={columns}
              sortColumn={sortColumn}
              dir={dir}
              onSort={onSort}
              picked={picked}
              onTogglePick={togglePick}
              caption={`Speech-to-text models sorted by ${sortColumn.label}`}
            />
            <div className="note mt-4 flex flex-col gap-1">
              <p>* Ran on fewer of the suites in scope than other models, so the value is not directly comparable.</p>
              <p>Grey values: the model is not trained for that language. – : skipped (language not supported) or not run.</p>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
