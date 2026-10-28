import clsx from "clsx";
import { X } from "lucide-react";
import { useId, useMemo } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { MAX_COMPARE, withView, type AppState, type Dir, type Lang } from "../lib/url-state";
import { formatGap, formatMetric, formatUnit } from "../lib/format";
import {
  betterFirst,
  buildColumns,
  buildRows,
  categoryName,
  defaultTranscriptSuite,
  langLabel,
  languageName,
  METRICS,
  pool,
  priceColumn,
  resolveColumn,
  rtfColumn,
  scopedSuites,
  sortRows,
  suiteField,
  type Column,
  type Row,
} from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import type { Summary } from "../data/types";
import { FilterBar } from "../components/FilterBar";
import { ShareButton } from "../components/Header";
import { ModelLink, TwBadge } from "../components/model-bits";
import { seriesColor } from "../lib/series";
import { ModelPicker } from "../components/ModelPicker";
import { RankedBars } from "../components/charts/RankedBars";
import { ScopeNote } from "../components/ScopeNote";
import { Transcripts } from "../components/Transcripts";
import { ValueText } from "../components/LeaderboardTable";
import { Direction, PageHead, Section } from "../components/ui";
import { SpeedCaveat } from "./LeaderboardView";

interface Preset {
  label: string;
  description: string;
  models: string[];
  lang?: Lang;
}

const PRESETS: Preset[] = [
  {
    label: "TypeWhisper's local defaults",
    description: "The default model of the Parakeet, Cohere and Granite plugins",
    models: ["fluidaudio:parakeet-ultra", "crispasr:cohere-transcribe-q5_0", "mlx-audio:granite-speech-5.0-470m-turboctc"],
  },
  {
    label: "German dictation",
    description: "Parakeet Ultra, Cohere, Granite 5.0 2B and Whisper large-v3-turbo on German",
    models: ["fluidaudio:parakeet-ultra", "crispasr:cohere-transcribe-q5_0", "mlx-audio:granite-speech-5.0-2b", "whisper-cpp:large-v3-turbo"],
    lang: "de",
  },
  {
    label: "Parakeet family",
    description: "v2, v3, Ultra and Fluid Speech Mini on FluidAudio",
    models: ["fluidaudio:parakeet-ultra", "fluidaudio:parakeet-tdt-0.6b-v3", "fluidaudio:parakeet-tdt-0.6b-v2", "fluidaudio:fluid-speech-mini"],
    lang: "en",
  },
  {
    label: "Whisper sizes",
    description: "tiny to large-v3 through whisper.cpp",
    models: ["whisper-cpp:tiny", "whisper-cpp:base", "whisper-cpp:small", "whisper-cpp:medium", "whisper-cpp:large-v3", "whisper-cpp:large-v3-turbo"],
  },
  {
    label: "Cloud APIs",
    description: "OpenAI and Groq against the best local engine",
    models: ["openai:gpt-4o-transcribe", "openai:gpt-4o-mini-transcribe", "openai:whisper-1", "groq:whisper-large-v3", "fluidaudio:parakeet-ultra"],
  },
  {
    label: "Russian",
    description: "GigaAM v3 with punctuation against Parakeet, Whisper and GPT-4o",
    models: ["sherpa-onnx:gigaam-v3-rnnt-punct", "fluidaudio:parakeet-ultra", "whisper-cpp:large-v3", "openai:gpt-4o-transcribe"],
    lang: "ru",
  },
];

function EmptyCompare({ summary, known }: { summary: Summary; known: string[] }) {
  const { navigate } = useAppState();
  const presets = PRESETS.map((preset) => ({ ...preset, models: preset.models.filter((id) => summary.models[id]) })).filter(
    (preset) => preset.models.length >= 2
  );
  return (
    <>
      <PageHead
        label="Compare"
        title="Put two to six models side by side."
        lede="Pick models here or tick them in the leaderboard. The page address keeps the selection, so you can send the comparison as a link."
      />
      <div className="wrap">
        <div className="flex flex-wrap items-center gap-3">
          {known.map((id) => (
            <span key={id} className="badge py-1 text-[0.8125rem] text-fg">
              {modelMeta(id).short}
            </span>
          ))}
          <ModelPicker
            summary={summary}
            exclude={known}
            onPick={(id) => navigate((s) => ({ ...s, models: [...s.models, id].slice(0, MAX_COMPARE) }), { replace: true })}
          />
        </div>
        <h2 className="section-title mt-12">Or start from a common question</h2>
        <ul className="mt-5 grid gap-x-8 border-t border-hairline sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => (
            <li key={preset.label} className="border-b border-hairline">
              <Link
                to={(s) => withView(s, "compare", { models: preset.models, lang: preset.lang ?? "all" })}
                className="group block py-4"
              >
                <span className="font-medium group-hover:text-accent">{preset.label}</span>
                <span className="mt-1 block text-sm text-muted">{preset.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function HeadlineTable({
  summary,
  rows,
  columns,
  colors,
}: {
  summary: Summary;
  rows: Row[];
  columns: Column[];
  colors: Record<string, string>;
}) {
  return (
    <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
      <table className="data-table min-w-[36rem]">
        <caption className="visually-hidden">Headline metrics of the compared models</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky-col min-w-[9rem]">
              Metric
            </th>
            {rows.map((row) => (
              <th key={row.id} scope="col" className="num min-w-[8.5rem] align-bottom normal-case tracking-normal">
                <span className="inline-flex items-center gap-1.5 font-sans text-[0.8125rem] font-semibold text-fg">
                  <span className="swatch" style={{ background: colors[row.id] }} aria-hidden="true" />
                  {row.meta.short}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => {
            const better = METRICS[column.metric].better;
            const values = rows.map((row) => row.values[column.id]?.v).filter((v): v is number => v != null);
            // A value from fewer suites cannot be the best one.
            const complete = rows
              .map((row) => row.values[column.id])
              .filter((value) => value?.v != null && !value.missing.length)
              .map((value) => value.v as number);
            const best = complete.length ? (better === "lower" ? Math.min(...complete) : Math.max(...complete)) : null;
            return (
              <tr key={column.id}>
                <th scope="row" className="sticky-col font-sans text-[0.8125rem] font-medium tracking-normal text-fg normal-case" title={column.help}>
                  <span className="block">{column.label}</span>
                  <Direction better={better} short />
                </th>
                {rows.map((row) => {
                  const value = row.values[column.id];
                  const isBest = value?.v != null && value.v === best && values.length > 1;
                  return (
                    <td key={row.id} className="num">
                      <ValueText summary={summary} column={column} value={value} best={isBest} />
                      <span className="meta block min-h-4">
                        {value?.v != null && best != null && !isBest && values.length > 1
                          ? formatGap(column.metric, value.v, best)
                          : isBest
                            ? "best"
                            : ""}
                      </span>
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

interface BreakdownRow {
  key: string;
  label: string;
  sub: string;
  suites: string[];
  link?: (s: AppState) => AppState;
}

function Breakdown({ summary, rows, colors }: { summary: Summary; rows: Row[]; colors: Record<string, string> }) {
  const { state, navigate } = useAppState();
  const scope = { tier: state.tier, cat: state.cat, origin: state.origin, acc: state.acc };
  const suites = scopedSuites(summary, scope, state.lang).filter((suite) => rows.some((row) => summary.cells[row.id]?.[suite]));

  const groups: BreakdownRow[] =
    state.group === "category"
      ? [
          ...new Map(
            suites.map((suite) => {
              const info = summary.suites[suite];
              const key = `${info.category}:${info.language}`;
              return [key, { key, info }];
            })
          ).values(),
        ].map(({ key, info }) => ({
          key,
          label: categoryName(info.category),
          sub: languageName(info.language),
          suites: suites.filter((suite) => summary.suites[suite].category === info.category && summary.suites[suite].language === info.language),
        }))
      : suites.map((suite) => ({
          key: suite,
          label: summary.suites[suite].name,
          sub: `${summary.suites[suite].clips} clips · ${summary.suites[suite].origin === "public" ? "real recordings" : "synthetic"}${summary.suites[suite].tier === "diagnostic" ? " · diagnostic" : ""}`,
          suites: [suite],
          link: (s: AppState) => withView(s, "suite", { suite }),
        }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="segmented" role="group" aria-label="Group by">
          <button type="button" aria-pressed={state.group === "suite"} onClick={() => navigate((s) => ({ ...s, group: "suite" }), { replace: true })}>
            By suite
          </button>
          <button
            type="button"
            aria-pressed={state.group === "category"}
            onClick={() => navigate((s) => ({ ...s, group: "category" }), { replace: true })}
          >
            By category
          </button>
        </div>
        <p className="meta flex items-center gap-2">
          WER, lower is better. Shading: points behind the best of these models
          <span className="inline-flex overflow-hidden rounded-sm" aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((level) => (
              <span key={level} className="h-3 w-4" style={{ background: `rgba(var(--heat), ${level * 0.42})` }} />
            ))}
          </span>
          0 → 10+
        </p>
      </div>
      <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
        <table className="data-table min-w-[40rem]">
          <caption className="visually-hidden">WER per {state.group}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky-col min-w-[13rem]">
                {state.group === "suite" ? "Suite" : "Category"}
              </th>
              {rows.map((row) => (
                <th key={row.id} scope="col" className="num normal-case tracking-normal">
                  <span className="inline-flex items-center gap-1.5 font-sans text-[0.8125rem] font-semibold text-fg">
                    <span className="swatch" style={{ background: colors[row.id] }} aria-hidden="true" />
                    {row.meta.short}
                  </span>
                </th>
              ))}
              <th scope="col" className="num">
                Best of all
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const values = rows.map((row) => pool(summary.cells[row.id], group.suites, "wer").v);
              const present = values.filter((v): v is number => v != null);
              const best = present.length ? Math.min(...present) : null;
              const field = group.suites.length === 1 ? suiteField(summary, group.suites[0])[0] : null;
              return (
                <tr key={group.key}>
                  <th scope="row" className="sticky-col font-sans text-[0.875rem] font-medium tracking-normal text-fg normal-case">
                    {group.link ? (
                      <Link to={group.link} className="hover:text-accent hover:underline">
                        {group.label}
                      </Link>
                    ) : (
                      group.label
                    )}
                    <span className="meta block font-normal">{group.sub}</span>
                  </th>
                  {values.map((v, index) => {
                    const gap = v != null && best != null ? v - best : 0;
                    const isBest = v != null && v === best && present.length > 1;
                    return (
                      <td
                        key={rows[index].id}
                        className={clsx("num", isBest && "font-semibold text-accent")}
                        style={{ background: v != null ? `rgba(var(--heat), ${Math.min(1, gap / 0.1) * 0.42})` : undefined }}
                        title={v != null ? `${rows[index].meta.name}: ${formatMetric("wer", v)}${gap > 0 ? ` (${formatGap("wer", v, best ?? v)})` : ""}` : "Not run"}
                      >
                        {v != null ? formatMetric("wer", v) : <span className="text-muted">–</span>}
                      </td>
                    );
                  })}
                  <td className="num text-muted">
                    {field ? (
                      <Link
                        to={(s) => withView(s, "model", { model: field.id })}
                        className="hover:text-accent hover:underline"
                        title={modelMeta(field.id).name}
                      >
                        {formatMetric("wer", field.v)}
                        <span className="meta ml-1.5 hidden 2xl:inline">{modelMeta(field.id).short}</span>
                      </Link>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CompareView({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const sortSelectId = useId();
  const { lang, tier, cat, origin, acc } = state;
  const known = state.models.filter((id) => summary.models[id]);

  const columns = useMemo(() => {
    const base = buildColumns(summary, { lang, tier, cat, origin, acc });
    const extra = lang === "all" ? [rtfColumn()] : [];
    const hasCloud = known.some((id) => modelMeta(id, summary.models[id].type).deployment === "cloud");
    return [...base, ...extra, ...(hasCloud ? [priceColumn()] : [])];
  }, [summary, lang, tier, cat, origin, acc, known]);

  const rows = useMemo(() => buildRows(summary, known, columns), [summary, known, columns]);
  const sortColumn = resolveColumn(columns, state.sort, lang);
  const dir: Dir = state.dir ?? betterFirst(sortColumn);
  const ordered = useMemo(() => sortRows(rows, sortColumn, dir), [rows, sortColumn, dir]);

  // Colors follow the selection order, never the sorted order.
  const colors = Object.fromEntries(known.map((id) => [id, seriesColor(state.models.indexOf(id))]));

  if (known.length < 2) return <EmptyCompare summary={summary} known={known} />;

  const scope = { tier, cat, origin, acc };
  const transcriptSuites = scopedSuites(summary, scope, lang).filter((suite) => known.some((id) => summary.cells[id]?.[suite]));
  const transcriptSuite =
    state.suite && transcriptSuites.includes(state.suite) ? state.suite : defaultTranscriptSuite(summary, transcriptSuites, lang);

  const chartColumns = columns.filter((column) => column.metric !== "cer" && column.metric !== "price" && column.metric !== "rtf");
  const scopeText = [
    lang === "all" ? "All languages" : languageName(lang),
    tier === "all" ? "all suites" : `${tier} suites`,
    cat ? categoryName(cat).toLowerCase() : null,
    acc ? "accented speech included" : "accented speech excluded",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHead
        label="Compare"
        compact
        title={
          <>
            {ordered.map((row, index) => (
              <span key={row.id}>
                {index > 0 && <span className="font-normal text-muted"> vs. </span>}
                {row.meta.short}
              </span>
            ))}
          </>
        }
        lede={scopeText}
        actions={<ShareButton label="Copy link to this comparison" className="btn-primary" />}
      >
        <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center">
          <ul className="flex flex-wrap gap-2" aria-label="Compared models">
            {known.map((id) => {
              const meta = modelMeta(id, summary.models[id].type);
              return (
                <li key={id} className="flex items-center gap-2 rounded-full border border-hairline-strong py-1 pr-1 pl-3 text-sm">
                  <span className="swatch" style={{ background: colors[id] }} aria-hidden="true" />
                  <ModelLink id={id} meta={meta} className="text-sm" />
                  <TwBadge meta={meta} compact />
                  <button
                    type="button"
                    className="rounded-full p-1 text-muted hover:bg-surface hover:text-fg"
                    aria-label={`Remove ${meta.name}`}
                    onClick={() => navigate((s) => ({ ...s, models: s.models.filter((model) => model !== id) }), { replace: true })}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <ModelPicker
            summary={summary}
            exclude={known}
            disabled={known.length >= MAX_COMPARE}
            onPick={(id) => navigate((s) => ({ ...s, models: [...s.models, id].slice(0, MAX_COMPARE) }), { replace: true })}
          />
        </div>
      </PageHead>

      <FilterBar
        summary={summary}
        controls={["lang", "tier", "cat", "origin", "acc"]}
        trailing={
          <div className="field">
            <label htmlFor={sortSelectId}>Order by</label>
            <select
              id={sortSelectId}
              className="select"
              value={sortColumn.id}
              onChange={(event) => navigate((s) => ({ ...s, sort: event.target.value, dir: null }), { replace: true })}
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label} ({METRICS[column.metric].better} is better)
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="wrap pt-4">
        <ScopeNote />
      </div>

      <Section id="headline" title="Headline numbers" lede="Blue bold is the best of these models. Below each other value: how far it is from the best.">
        <HeadlineTable summary={summary} rows={ordered} columns={columns} colors={colors} />
      </Section>

      <Section id="glance" title="At a glance" lede="Same order in every chart, so a model keeps its row.">
        <div className={clsx("grid gap-x-12 gap-y-9 md:grid-cols-2", chartColumns.length > 4 && "xl:grid-cols-3")}>
          {chartColumns.map((column) => {
            const unit = METRICS[column.metric].unit;
            const data = ordered
              .filter((row) => row.values[column.id]?.v != null)
              .map((row) => ({
                id: row.id,
                label: row.meta.short,
                v: row.values[column.id].v as number,
                color: colors[row.id],
                muted: row.values[column.id].outside,
              }));
            return (
              <figure key={column.id} className="min-w-0">
                <figcaption className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[0.9375rem] font-semibold" title={column.help}>
                    {column.label}
                    {column.lang && lang !== "all" ? ` ${langLabel(column.lang)}` : ""}
                  </span>
                  <Direction better={METRICS[column.metric].better} />
                </figcaption>
                {data.length ? (
                  <RankedBars
                    data={data}
                    ranked={false}
                    format={(value) => formatUnit(unit, value)}
                    scale={unit === "ms" ? "log" : "linear"}
                    max={column.metric === "wer" ? undefined : 1}
                    ariaLabel={column.label}
                  />
                ) : (
                  <p className="text-sm text-muted">None of these models ran it.</p>
                )}
              </figure>
            );
          })}
        </div>
        <div className="mt-8">
          <SpeedCaveat />
        </div>
      </Section>

      <Section id="breakdown" title="Where they differ" lede="WER per suite or category. Click a suite for every model's result on it.">
        <Breakdown summary={summary} rows={ordered} colors={colors} />
      </Section>

      <Section
        id="transcripts"
        title="Same clip, every transcript"
        lede="The reference, then what each model wrote. Clip ids are links you can share."
      >
        {transcriptSuite ? (
          <Transcripts
            summary={summary}
            suite={transcriptSuite}
            suiteOptions={transcriptSuites}
            models={ordered.map((row) => ({ id: row.id, color: colors[row.id] }))}
            mode="compare"
          />
        ) : (
          <p className="text-sm text-muted">No suite in this scope has results for these models.</p>
        )}
      </Section>
    </>
  );
}
