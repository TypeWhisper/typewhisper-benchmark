import clsx from "clsx";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { wordDiff, normalizeWord } from "../lib/diff";
import { formatMetric } from "../lib/format";
import { useClips } from "../data/load";
import { ACCENTED } from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import { ClipStatus, type ClipFile, type ClipInfo, type ClipResult, type Summary } from "../data/types";
import { Loading, Notice } from "./ui";

export function WordDiff({ reference, hypothesis }: { reference: string; hypothesis: string }) {
  const ops = useMemo(() => wordDiff(reference, hypothesis), [reference, hypothesis]);
  return (
    <>
      {ops.map((op, index) => (
        <Fragment key={index}>
          {index > 0 && " "}
          {(op.type === "eq" || op.type === "sym") && op.hyp}
          {op.type === "sub" && (
            <span className="w-wrong" title={`Reference: ${op.ref}`}>
              {op.hyp}
              <span className="visually-hidden"> (reference: {op.ref})</span>
            </span>
          )}
          {op.type === "ins" && (
            <span className="w-wrong" title="Extra word">
              {op.hyp}
              <span className="visually-hidden"> (extra word)</span>
            </span>
          )}
          {op.type === "del" && (
            <del className="w-missing" title={`Missing: ${op.ref}`}>
              <span className="visually-hidden">missing: </span>
              {op.ref}
            </del>
          )}
        </Fragment>
      ))}
    </>
  );
}

export function DiffLegend() {
  return (
    <p className="note">
      <span className="w-wrong text-fg">wavy</span> wrong or extra word · <del className="w-missing">struck</del> missing word.
      Words are compared after lowercasing and removing punctuation; the WER score also forgives number spelling and
      a few other differences, so it can count fewer errors than marked.
    </p>
  );
}

export function TranscriptLine({ clip, result }: { clip: ClipInfo; result: ClipResult | null | undefined }) {
  if (!result) return <span className="text-muted">Not run</span>;
  const [text, , , , status] = result;
  if (status === ClipStatus.Skipped) return <span className="text-muted">Skipped (language not supported)</span>;
  if (status === ClipStatus.Error) return <span className="text-muted">Error: {text || "no transcript"}</span>;
  if (!text) return <span className="text-muted italic">Empty transcript</span>;
  return clip.ref != null ? <WordDiff reference={clip.ref} hypothesis={text} /> : <>{text}</>;
}

function okWer(result: ClipResult | null | undefined): number | null {
  return result && result[4] === ClipStatus.Ok ? result[1] : null;
}

function sameText(results: Array<ClipResult | null | undefined>): boolean {
  const texts = results
    .filter((result): result is ClipResult => Boolean(result && result[4] === ClipStatus.Ok))
    .map((result) => result[0].split(/\s+/).map(normalizeWord).filter(Boolean).join(" "));
  return texts.every((text) => text === texts[0]);
}

export interface ExplorerModel {
  id: string;
  color?: string;
}

interface Props {
  summary: Summary;
  suite: string;
  suiteOptions: string[];
  models: ExplorerModel[];
  mode: "compare" | "model";
}

const PAGE = 12;

export function Transcripts({ summary, suite, suiteOptions, models, mode }: Props) {
  const { state, navigate } = useAppState();
  const clips = useClips(suite, summary.version);
  const selectId = useId();
  const [sort, setSort] = useState<"spread" | "order">("spread");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const info = summary.suites[suite];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="field min-w-0">
          <label htmlFor={selectId}>Suite</label>
          <select
            id={selectId}
            className="select max-w-full"
            value={suite}
            onChange={(event) => {
              setLimit(PAGE);
              navigate((s) => ({ ...s, suite: event.target.value, clip: null }), { replace: true });
            }}
          >
            {suiteOptions.map((id) => (
              <option key={id} value={id}>
                {summary.suites[id]?.name ?? id}
              </option>
            ))}
          </select>
        </div>
        <div className="segmented" role="group" aria-label="Order">
          <button type="button" aria-pressed={sort === "spread"} onClick={() => setSort("spread")}>
            {mode === "compare" ? "Biggest gap first" : "Most errors first"}
          </button>
          <button type="button" aria-pressed={sort === "order"} onClick={() => setSort("order")}>
            Suite order
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />
          {mode === "compare" ? "Only where transcripts differ" : "Only clips with errors"}
        </label>
      </div>

      {info?.category === ACCENTED && (
        <div className="mb-5">
          <Notice tone="warn">
            This suite's references do not match its audio (see PR #6), so every model looks wrong here. The marks below say
            little about the models.
          </Notice>
        </div>
      )}

      {!clips || clips.status === "loading" ? (
        <Loading label="Loading transcripts…" />
      ) : clips.status === "error" ? (
        <Notice tone="warn">Could not load the transcripts ({clips.error}).</Notice>
      ) : (
        <ClipList
          file={clips.data}
          summary={summary}
          models={models}
          mode={mode}
          sort={sort}
          onlyDiff={onlyDiff}
          limit={limit}
          onMore={() => setLimit((value) => value + PAGE)}
          linkedClip={state.clip}
        />
      )}
    </div>
  );
}

function ClipList(props: {
  file: ClipFile;
  summary: Summary;
  models: ExplorerModel[];
  mode: "compare" | "model";
  sort: "spread" | "order";
  onlyDiff: boolean;
  limit: number;
  onMore: () => void;
  linkedClip: string | null;
}) {
  const { file, summary, models, mode, sort, onlyDiff, limit, onMore, linkedClip } = props;
  const linkedRef = useRef<HTMLElement>(null);

  const entries = useMemo(() => {
    let list = file.clips.map((clip, index) => {
      const results = models.map((model) => file.results[model.id]?.[index]);
      const wers = results.map(okWer).filter((v): v is number => v != null);
      const spread = mode === "compare" ? (wers.length ? Math.max(...wers) - Math.min(...wers) : 0) : (wers[0] ?? 0);
      return { clip, index, results, spread, differs: mode === "compare" ? !sameText(results) : (wers[0] ?? 0) > 0 };
    });
    if (onlyDiff) list = list.filter((entry) => entry.differs || entry.clip.id === linkedClip);
    if (sort === "spread") list = [...list].sort((a, b) => b.spread - a.spread || a.index - b.index);
    // A linked clip always comes first.
    const linked = list.findIndex((entry) => entry.clip.id === linkedClip);
    if (linked > 0) list = [list[linked], ...list.slice(0, linked), ...list.slice(linked + 1)];
    return list;
  }, [file, models, mode, sort, onlyDiff, linkedClip]);

  useEffect(() => {
    if (linkedClip && linkedRef.current) linkedRef.current.scrollIntoView({ block: "center" });
    // Only when the link or the file changes, not on every re-sort.
  }, [linkedClip, file]);

  const hasRefs = file.clips.some((clip) => clip.ref != null);
  const visible = entries.slice(0, limit);

  return (
    <div>
      {hasRefs ? <DiffLegend /> : <p className="meta">No references for this suite, so transcripts are shown without marks.</p>}
      <p className="meta mt-1">
        {entries.length} of {file.clips.length} clips · transcripts from the first run
        {models.some((model) => (summary.models[model.id]?.runs ?? 1) > 1) ? " (some models ran each clip 3 times)" : ""}
      </p>
      {visible.length === 0 && <p className="py-6 text-sm text-muted">No clip matches. Clear the checkbox to see all clips.</p>}
      <ol className="mt-4">
        {visible.map(({ clip, results }) => {
          const isLinked = clip.id === linkedClip;
          const reference = clip.fref ?? clip.ref;
          return (
            <li
              key={clip.id}
              ref={isLinked ? (node) => void (linkedRef.current = node) : undefined}
              className={clsx(
                "border-t border-hairline py-5",
                isLinked && "-mx-3 rounded-xl border-transparent bg-[color-mix(in_srgb,var(--mark)_8%,transparent)] px-3"
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  to={(s) => ({ ...s, suite: file.suite, clip: clip.id })}
                  replace
                  className="meta text-accent hover:underline"
                  title="Link to this clip"
                >
                  {clip.id}
                </Link>
                <span className="meta">
                  {[clip.sec ? `${clip.sec.toFixed(1)} s` : null, ...(clip.tags ?? [])].filter(Boolean).join(" · ")}
                </span>
              </div>
              {reference != null && (
                <p className="mt-2 font-mono text-[0.875rem] leading-relaxed text-muted">
                  <span className="mr-2 text-[0.6875rem] tracking-[0.08em] uppercase">Reference</span>
                  <span className="text-fg">{reference}</span>
                </p>
              )}
              <ul className="mt-3 flex flex-col gap-2.5">
                {models.map((model, index) => {
                  const result = results[index];
                  const meta = modelMeta(model.id, summary.models[model.id]?.type);
                  const wer = okWer(result);
                  return (
                    <li
                      key={model.id}
                      className={clsx(
                        "grid gap-x-4 gap-y-1",
                        mode === "compare" ? "sm:grid-cols-[minmax(9rem,13rem)_1fr_4.5rem]" : "sm:grid-cols-[1fr_4.5rem]"
                      )}
                    >
                      {mode === "compare" && (
                        <span className="flex items-baseline gap-2 text-[0.8125rem] font-medium">
                          {model.color && <span className="swatch translate-y-[1px]" style={{ background: model.color }} aria-hidden="true" />}
                          <span className="truncate">{meta.short}</span>
                        </span>
                      )}
                      <p className="font-mono text-[0.875rem] leading-relaxed break-words">
                        <TranscriptLine clip={clip} result={result} />
                      </p>
                      <span className="text-[0.8125rem] tabular-nums sm:text-right" title="Word error rate on this clip">
                        <span className="text-muted sm:hidden">WER </span>
                        {wer != null ? formatMetric("wer", wer) : "–"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
      {entries.length > limit && (
        <button type="button" className="btn mt-4" onClick={onMore}>
          Show {Math.min(PAGE, entries.length - limit)} more clips
        </button>
      )}
    </div>
  );
}
