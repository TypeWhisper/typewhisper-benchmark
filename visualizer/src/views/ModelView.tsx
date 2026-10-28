import clsx from "clsx";
import { ArrowRight, ExternalLink, FileJson, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { MAX_COMPARE, withView } from "../lib/url-state";
import { formatCount, formatMetric, formatUnit, plural } from "../lib/format";
import {
  allModelIds,
  buildColumns,
  buildRows,
  categoryName,
  defaultTranscriptSuite,
  languageName,
  METRICS,
  rankOf,
  rtfColumn,
  scopedSuites,
  sortSuiteIds,
  suiteMatches,
  suiteStanding,
  type SuiteStanding,
} from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import { RESULTS_BASE } from "../data/load";
import type { Summary } from "../data/types";
import { ShareButton } from "../components/Header";
import { DeployBadge, TwBadge } from "../components/model-bits";
import { Transcripts } from "../components/Transcripts";
import { Notice, PageHead, Section } from "../components/ui";

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="border-t border-hairline py-2.5">
      <dt className="meta uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

/** Field range on one suite: best to worst model, the median tick, this model's dot. */
function FieldStrip({ standing, max }: { standing: SuiteStanding; max: number }) {
  const x = (value: number) => `${Math.min(100, (value / max) * 100)}%`;
  return (
    <div className="relative h-4 w-full min-w-[8rem]" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--grid)]" />
      <span
        className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[color:var(--mark-quiet)] opacity-60"
        style={{ left: x(standing.best), width: `calc(${x(standing.worst)} - ${x(standing.best)})` }}
      />
      <span className="absolute top-0.5 h-3 w-px bg-[color:var(--muted-foreground)]" style={{ left: x(standing.median) }} />
      <span
        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--mark)] ring-2 ring-[color:var(--background)]"
        style={{ left: x(standing.v) }}
      />
      {standing.v > max && <span className="absolute -top-0.5 right-0 text-[10px] text-muted">▶</span>}
    </div>
  );
}

export function ModelView({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const id = state.model;
  const run = id ? summary.models[id] : undefined;
  const { tier, cat, origin, acc } = state;

  const all = useMemo(() => {
    const columns = [...buildColumns(summary, { lang: "all", tier, cat, origin, acc }), rtfColumn()];
    return { columns, rows: buildRows(summary, allModelIds(summary), columns) };
  }, [summary, tier, cat, origin, acc]);

  if (!id || !run) {
    return (
      <div className="wrap py-16">
        <p className="label">Model</p>
        <h1 className="mt-3 text-3xl font-semibold">No results for {id ? <code className="font-mono">{id}</code> : "this model"}.</h1>
        <p className="mt-3 text-muted">The link may name a model that was renamed or not benchmarked yet.</p>
        <Link to={(s) => withView(s, "models")} className="btn mt-6">
          See all models <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const meta = modelMeta(id, run.type);
  const cells = summary.cells[id] ?? {};
  const row = all.rows.find((candidate) => candidate.id === id);
  const scope = { tier, cat, origin, acc };
  const picked = state.models.includes(id);

  // Standing on every suite the model ran; strengths and weaknesses from the suites in scope.
  const suiteIds = sortSuiteIds(summary, Object.keys(cells));
  const standings = suiteIds
    .map((suite) => suiteStanding(summary, id, suite))
    .filter((standing): standing is SuiteStanding => standing !== null);
  const trained = (suite: string) => !meta.trainedFor || meta.trainedFor.includes(summary.suites[suite].language);
  const ranked = standings.filter((standing) => suiteMatches(summary.suites[standing.suite], scope) && trained(standing.suite) && standing.of >= 5);
  // A strength beats the field median and most models; ties at 0% say nothing about anyone.
  const strengths = ranked
    .filter((s) => s.v < s.median && s.behindShare >= 0.6)
    .sort((a, b) => b.behindShare - a.behindShare || b.median - b.v - (a.median - a.v))
    .slice(0, 3);
  const weaknesses = ranked
    .filter((s) => s.v > s.median && s.aheadShare >= 0.5)
    .sort((a, b) => b.aheadShare - a.aheadShare || b.v - b.median - (a.v - a.median))
    .slice(0, 3);
  const stripMax = Math.max(0.3, ...standings.filter((s) => summary.suites[s.suite].category !== "accented-speech").map((s) => Math.min(s.median * 2.5, 1)));

  const transcriptSuites = scopedSuites(summary, { ...scope, tier: "all", cat: null, origin: "all", acc: true }).filter((suite) => cells[suite]);
  const transcriptSuite =
    state.suite && transcriptSuites.includes(state.suite)
      ? state.suite
      : defaultTranscriptSuite(summary, transcriptSuites.filter((suite) => suiteMatches(summary.suites[suite], scope)), meta.trainedFor?.[0] ?? "en") ??
        transcriptSuites[0];

  const totalClips = Object.values(cells).reduce((sum, cell) => sum + cell.n, 0);
  const totalErrors = Object.values(cells).reduce((sum, cell) => sum + (cell.err ?? 0), 0);
  const links = [
    ...(meta.links ?? []),
    ...(meta.pr ? [{ label: `PR #${meta.pr}`, href: `https://github.com/TypeWhisper/typewhisper-benchmark/pull/${meta.pr}` }] : []),
  ];

  const togglePick = () =>
    navigate(
      (s) => ({ ...s, models: picked ? s.models.filter((model) => model !== id) : [...s.models, id].slice(0, MAX_COMPARE) }),
      { replace: true }
    );

  return (
    <>
      <PageHead
        label={`${meta.org} · ${meta.family}`}
        title={meta.name}
        lede={meta.tw.note ?? (meta.derived ? "No description yet: this model's result file is new. Name and maker are derived from its id." : undefined)}
        meta={
          <>
            <span className="text-fg">{id}</span>
            <span aria-hidden="true">·</span>
            <span>{plural(totalClips, "result")}</span>
            {totalErrors > 0 && <span>· {plural(totalErrors, "error")}</span>}
            {run.lastRun && <span>· last run {run.lastRun}</span>}
          </>
        }
        actions={
          <>
            <button type="button" className={clsx("btn", !picked && "btn-primary")} onClick={togglePick} disabled={!picked && state.models.length >= MAX_COMPARE}>
              <Plus className={clsx("size-4", picked && "rotate-45")} aria-hidden="true" />
              {picked ? "Remove from comparison" : "Add to comparison"}
            </button>
            <ShareButton />
          </>
        }
      >
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <TwBadge meta={meta} />
          <DeployBadge meta={meta} />
          {meta.tw.plugin && <span className="badge">Plugin: {meta.tw.plugin}</span>}
        </div>
      </PageHead>

      <div className="wrap grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <h2 className="visually-hidden">Headline numbers</h2>
          <ul className="grid grid-cols-2 border-t border-hairline sm:grid-cols-3 xl:grid-cols-5">
            {all.columns.map((column) => {
              const value = row?.values[column.id];
              const rank = rankOf(all.rows, column, id);
              return (
                <li key={column.id} className="border-b border-hairline py-4 pr-4" title={column.help}>
                  <p className="meta uppercase">{column.label}</p>
                  <p className={clsx("mt-1 text-[1.625rem] leading-none font-semibold tracking-[-0.02em]", value?.outside && "text-muted")}>
                    {value?.v != null ? formatMetric(column.metric, value.v) : <span className="text-muted">–</span>}
                  </p>
                  <p className="meta mt-1.5">
                    {value?.v != null && rank ? (
                      <>
                        #{rank.rank} of {rank.of} · {METRICS[column.metric].better === "lower" ? "↓" : "↑"} better
                      </>
                    ) : value?.skipped ? (
                      "not supported"
                    ) : (
                      "not run"
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="meta mt-3">
            Ranks count the models with results for that column. WER uses the {tier === "all" ? "core and diagnostic" : tier} suites
            {acc ? ", accented speech included" : ", accented speech excluded"}.
          </p>

          {(strengths.length > 0 || weaknesses.length > 0) && (
            <div className="mt-10 grid gap-8 sm:grid-cols-2">
              {[
                { title: "Strongest relative to the field", items: strengths },
                { title: "Weakest relative to the field", items: weaknesses },
              ].map((group) => (
                <div key={group.title}>
                  <h2 className="text-[0.9375rem] font-semibold">{group.title}</h2>
                  {group.items.length ? (
                    <ul className="mt-3 border-t border-hairline">
                      {group.items.map((standing) => (
                        <li key={standing.suite} className="border-b border-hairline py-2.5">
                          <Link
                            to={(s) => withView(s, "suite", { suite: standing.suite })}
                            className="text-sm font-medium hover:text-accent hover:underline"
                          >
                            {summary.suites[standing.suite].name}
                          </Link>
                          <p className="meta mt-0.5">
                            {formatMetric("wer", standing.v)} WER · #{standing.rank} of {standing.of} · field median{" "}
                            {formatMetric("wer", standing.median)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Nothing stands out.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside aria-label="Model facts">
          <dl>
            <Fact label="Made by" value={meta.org} />
            <Fact label="Parameters" value={meta.params} />
            <Fact label="Download" value={meta.size} />
            <Fact label="Precision" value={meta.quant} />
            <Fact label="License" value={meta.license} />
            <Fact label="Languages" value={meta.languages} />
            <Fact label="Runtime in this benchmark" value={meta.runtime} />
            <Fact label="Runs on" value={meta.deployment === "cloud" ? "Cloud API" : "On device"} />
            <Fact label="Runs per clip" value={run.runs} />
          </dl>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {links.map((link) => (
              <li key={link.href}>
                <a className="link inline-flex items-center gap-1.5" href={link.href}>
                  {link.label}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
            <li>
              <a className="link inline-flex items-center gap-1.5" href={`${RESULTS_BASE}${run.file}`}>
                Raw results (JSON)
                <FileJson className="size-3.5" aria-hidden="true" />
              </a>
            </li>
          </ul>
        </aside>
      </div>

      <Section
        id="suites"
        title="Every suite"
        lede="The bar spans the field from best to worst model, the tick marks the median, the dot is this model. Lower is better."
      >
        <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
          <table className="data-table min-w-[48rem]">
            <caption className="visually-hidden">{meta.name} on every suite</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky-col">
                  Suite
                </th>
                <th scope="col" className="w-[30%]">
                  Against the field
                </th>
                <th scope="col" className="num">
                  WER
                </th>
                <th scope="col" className="num">
                  Rank
                </th>
                <th scope="col" className="num">
                  CER
                </th>
                <th scope="col" className="num" title="Punctuation, formatting or Digits, where the suite scores them">
                  Extra
                </th>
                <th scope="col" className="num">
                  ms/clip
                </th>
                <th scope="col" className="num">
                  Clips
                </th>
              </tr>
            </thead>
            <tbody>
              {suiteIds.map((suite) => {
                const info = summary.suites[suite];
                const cell = cells[suite];
                const standing = standings.find((candidate) => candidate.suite === suite);
                const extra =
                  cell.dg != null
                    ? `Digits ${formatUnit("pct", cell.dg)}`
                    : cell.p != null
                      ? `Punct ${formatUnit("pct", cell.p)}`
                      : cell.f != null
                        ? `Fmt ${formatUnit("pct", cell.f)}`
                        : "";
                const outOfScope = !suiteMatches(info, scope);
                return (
                  <tr key={suite} className={clsx(outOfScope && "text-muted")}>
                    <th scope="row" className="sticky-col font-sans text-[0.875rem] font-medium tracking-normal normal-case">
                      <Link to={(s) => withView(s, "suite", { suite })} className="hover:text-accent hover:underline">
                        {info.name}
                      </Link>
                      <span className="meta block font-normal">
                        {languageName(info.language)} · {categoryName(info.category).toLowerCase()}
                        {info.tier === "diagnostic" ? " · diagnostic" : ""}
                      </span>
                    </th>
                    <td>{standing ? <FieldStrip standing={standing} max={stripMax} /> : null}</td>
                    <td className="num font-medium">{cell.ok ? formatMetric("wer", cell.wer) : "–"}</td>
                    <td className="num">{standing ? `${standing.rank}/${standing.of}` : "–"}</td>
                    <td className="num">{cell.ok ? formatMetric("cer", cell.cer) : "–"}</td>
                    <td className="num">{extra}</td>
                    <td className="num">{cell.ok ? formatMetric("ms", cell.ms) : "–"}</td>
                    <td className="num meta" title={`${cell.ok} ok · ${cell.err ?? 0} errors · ${cell.skip ?? 0} skipped`}>
                      {cell.skip === cell.n ? "skipped" : `${formatCount(cell.ok)}${cell.err ? ` +${cell.err} err` : ""}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="meta mt-3">Grey rows are outside the current filters (tier, category, audio or accented speech).</p>
      </Section>

      <Section id="transcripts" title="Transcripts" lede="The reference and what this model wrote, clip by clip.">
        {transcriptSuite ? (
          <Transcripts summary={summary} suite={transcriptSuite} suiteOptions={transcriptSuites} models={[{ id }]} mode="model" />
        ) : (
          <Notice>No transcripts for this model.</Notice>
        )}
      </Section>
    </>
  );
}
