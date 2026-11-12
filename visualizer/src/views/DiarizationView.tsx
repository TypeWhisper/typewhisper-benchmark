import clsx from "clsx";
import { useAppState } from "../lib/app-state-context";
import {
  DIARIZATION_REFS,
  DIARIZATION_SETS,
  PLATFORMS,
  type DiarizationRef,
  type DiarizationSetKey,
  type Platform,
} from "../lib/url-state";
import {
  GROUP_INFO,
  PLATFORM_NAMES,
  REFERENCE_INFO,
  percent,
  rankEntries,
  referenceFor,
  share,
  useDiarization,
  type DiarizationEntry,
  type DiarizationGroup,
  type DiarizationReferenceId,
} from "../data/diarization";
import { Direction, Loading, Notice, PageHead, Section } from "../components/ui";

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  name: (value: T) => string;
  title?: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="meta">{props.label}</span>
      <div className="segmented" role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={props.value === option}
            title={props.title?.(option)}
            onClick={() => props.onChange(option)}
          >
            {props.name(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function engineLabel(entry: DiarizationEntry) {
  return (
    <>
      <span className="font-medium text-fg">{entry.engineName}</span>
      {entry.shipped && <span className="badge badge-accent ml-2 align-middle">In TypeWhisper</span>}
      <span className="meta block font-normal">
        {PLATFORM_NAMES[entry.platform]} · {entry.runtime}
      </span>
    </>
  );
}

function RankTable({ entries, group, reference }: { entries: DiarizationEntry[]; group: DiarizationGroup; reference: DiarizationReferenceId }) {
  return (
    <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
      <table className="data-table min-w-[60rem]">
        <thead>
          <tr>
            <th scope="col" className="sticky-col">
              Engine
            </th>
            <th scope="col" className="num" title="Diarization error rate: missed speech + false alarm + speaker confusion, over reference speech">
              DER <Direction better="lower" short />
            </th>
            <th scope="col" className="num" title="Reference speech the engine gave to the wrong person">
              Confusion
            </th>
            <th scope="col" className="num" title="Reference speech the engine did not mark as speech">
              Missed
            </th>
            <th scope="col" className="num" title="Speech the engine marked where nobody spoke">
              False alarm
            </th>
            <th scope="col" className="num" title="DER without 0.25 s on each side of every reference boundary">
              DER ±0.25 s
            </th>
            <th scope="col" className="num" title="Files whose number of speakers the engine got exactly right">
              Speaker count
            </th>
            <th scope="col" className="num" title="Audio seconds per second of processing on the machine below; compare within one machine">
              Speed
            </th>
            <th scope="col">Machine</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const summary = entry.summary[group];
            const scores = summary.scores[reference]!;
            const c = scores.collar0;
            return (
              <tr key={entry.id}>
                <th scope="row" className="sticky-col font-sans text-[0.875rem] tracking-normal normal-case">
                  {engineLabel(entry)}
                </th>
                <td className="num font-medium">{percent(c.der)}</td>
                <td className="num">{percent(share(c.confusion, c.total))}</td>
                <td className="num">{percent(share(c.missed, c.total))}</td>
                <td className="num">{percent(share(c.falseAlarm, c.total))}</td>
                <td className="num">{percent(scores.collar25.der)}</td>
                <td className="num">
                  {Math.round(summary.speakerCountAccuracy * summary.files)}/{summary.files}
                </td>
                <td className="num">{summary.speedFactor ? `${Math.round(summary.speedFactor)}×` : "–"}</td>
                <td className="meta normal-case">
                  {entry.machine.chip}
                  {entry.machine.accelerator ? ` · ${entry.machine.accelerator}` : ""}
                  {summary.failed ? <span className="block text-[color:var(--squiggle)]">{summary.failed} failed</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FileTable({ entries, group, reference }: { entries: DiarizationEntry[]; group: DiarizationGroup; reference: DiarizationReferenceId }) {
  const files = entries[0]?.items.filter((item) => item.group === group) ?? [];
  const byEntry = new Map(entries.map((entry) => [entry.id, new Map(entry.items.map((item) => [item.id, item]))]));
  return (
    <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
      <table className="data-table" style={{ minWidth: `${16 + entries.length * 8}rem` }}>
        <thead>
          <tr>
            <th scope="col" className="sticky-col">
              File
            </th>
            {entries.map((entry) => (
              <th key={entry.id} scope="col" className="num max-w-40 whitespace-normal" title={`${entry.engineName} · ${PLATFORM_NAMES[entry.platform]}`}>
                {entry.engineName}
                <span className="meta block font-normal">{PLATFORM_NAMES[entry.platform]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const values = entries.map((entry) => byEntry.get(entry.id)?.get(file.id));
            const ders = values.map((item) => item?.scores[reference]?.collar0.der ?? Infinity);
            const best = Math.min(...ders);
            return (
              <tr key={file.id}>
                <th scope="row" className="sticky-col font-sans text-[0.875rem] tracking-normal normal-case">
                  {file.id.replace(/^(ami|synthetic)\//, "").replace(/\/(array|headset)$/, "")}
                  <span className="meta block font-normal">
                    {(file.audioSeconds / 60).toFixed(1)} min · {file.speakers.reference} speakers · {file.language}
                  </span>
                </th>
                {values.map((item, index) => {
                  const score = item?.scores[reference]?.collar0;
                  return (
                    <td key={entries[index].id} className={clsx("num", ders[index] === best && "font-semibold text-accent")}>
                      {item?.error ? (
                        <span className="text-[color:var(--squiggle)]" title={item.error}>
                          failed
                        </span>
                      ) : (
                        <>
                          {percent(score?.der)}
                          <span
                            className={clsx("meta block font-normal", item && item.speakers.found !== item.speakers.reference && "text-[color:var(--squiggle)]")}
                            title="Speakers found / in the reference"
                          >
                            {item ? `${item.speakers.found}/${item.speakers.reference} spk` : "–"}
                          </span>
                        </>
                      )}
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

export function DiarizationView() {
  const { state, navigate } = useAppState();
  const data = useDiarization();
  const group = state.dset as DiarizationGroup;
  const reference = referenceFor(group, state.dref);

  const controls = (
    <div className="mt-6 flex flex-wrap items-end gap-4">
      <Segmented<DiarizationSetKey>
        label="Audio"
        value={state.dset}
        options={DIARIZATION_SETS}
        name={(value) => GROUP_INFO[value].short}
        title={(value) => GROUP_INFO[value].name}
        onChange={(dset) => navigate((s) => ({ ...s, dset }), { replace: true })}
      />
      {group !== "synthetic" && (
        <Segmented<DiarizationRef>
          label="AMI reference"
          value={state.dref}
          options={DIARIZATION_REFS}
          name={(value) => REFERENCE_INFO[value].name}
          title={(value) => REFERENCE_INFO[value].about}
          onChange={(dref) => navigate((s) => ({ ...s, dref }), { replace: true })}
        />
      )}
      <Segmented<Platform>
        label="Platform"
        value={state.os}
        options={PLATFORMS}
        name={(value) => (value === "all" ? "All" : PLATFORM_NAMES[value])}
        onChange={(os) => navigate((s) => ({ ...s, os }), { replace: true })}
      />
    </div>
  );

  let body;
  if (data.status === "loading") body = <div className="wrap"><Loading label="Loading diarization results" /></div>;
  else if (data.status === "error") body = <div className="wrap"><Notice tone="warn">Could not load the diarization results: {data.error}</Notice></div>;
  else {
    const entries = rankEntries(
      data.data.reports.filter((entry) => state.os === "all" || entry.platform === state.os),
      group,
      reference
    );
    body = entries.length ? (
      <>
        <Section
          id="diarization-rank"
          title={GROUP_INFO[group].name}
          lede={
            <>
              {GROUP_INFO[group].about} Scored against the {REFERENCE_INFO[reference].name.toLowerCase()} reference: {REFERENCE_INFO[reference].about}
            </>
          }
        >
          <RankTable entries={entries} group={group} reference={reference} />
        </Section>
        <Section id="diarization-files" title="Per file" lede="DER per file, best value highlighted; below it the speakers found and in the reference.">
          <FileTable entries={entries} group={group} reference={reference} />
        </Section>
      </>
    ) : (
      <div className="wrap">
        <Notice>No diarization results for this selection yet.</Notice>
      </div>
    );
  }

  return (
    <>
      <PageHead
        label="Speaker diarization"
        title="Who spoke when."
        lede="Diarization engines that TypeWhisper ships or could ship, on macOS, Windows and iOS, run over the same meetings and conversations and scored by the same code. Speaker confusion matters most for a transcript: it is the speech given to the wrong person."
      >
        {controls}
      </PageHead>
      {body}
      <Section id="diarization-method" title="Method">
        <div className="prose-sm max-w-3xl space-y-3 text-muted">
          <p>
            DER as in pyannote.metrics: overlapping speech counts, only the annotated region (UEM) of an AMI meeting is scored, speakers are mapped one to one for the most
            shared time. A group pools its files: summed error time over summed reference speech. A failed file counts as all speech missed.
          </p>
          <p>
            AMI has two reference conventions, and an engine trained on one scores better on it, so both are shown. Speed is audio seconds per second of processing on that
            platform's machine and only compares engines on one machine. The set, the hypothesis files of every platform and the scorer are in{" "}
            <a className="underline hover:text-fg" href="https://github.com/TypeWhisper/typewhisper-benchmark/tree/main/bench/diarization">
              bench/diarization
            </a>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
