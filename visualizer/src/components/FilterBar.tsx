import clsx from "clsx";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useAppState } from "../lib/app-state-context";
import { DEFAULT_STATE, type AppState, type Lang } from "../lib/url-state";
import { ACCENTED, categoriesIn, categoryName, langLabel, LANGUAGE_ORDER, languageName } from "../data/metrics";
import type { Summary } from "../data/types";

export type FilterControl = "lang" | "tier" | "cat" | "origin" | "acc" | "deploy" | "tw" | "q";

const FILTER_KEYS: Array<keyof AppState> = ["tier", "cat", "origin", "acc", "deploy", "tw", "q"];

function Select(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="select" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguageSwitch({ summary, allowAll = true }: { summary: Summary; allowAll?: boolean }) {
  const { state, navigate } = useAppState();
  const present = new Set(Object.values(summary.suites).map((suite) => suite.language));
  const langs = LANGUAGE_ORDER.filter((lang) => present.has(lang)) as Lang[];
  const options: Lang[] = allowAll ? ["all", ...langs] : langs;
  return (
    <div className="segmented" role="group" aria-label="Language">
      {options.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={state.lang === lang}
          title={lang === "all" ? "All languages side by side" : languageName(lang)}
          onClick={() => navigate((s) => ({ ...s, lang }), { replace: true })}
        >
          {lang === "all" ? "All languages" : langLabel(lang)}
        </button>
      ))}
    </div>
  );
}

function SearchBox() {
  const { state, navigate } = useAppState();
  const id = useId();
  const [text, setText] = useState(state.q);
  // Keep the box in step with back/forward.
  const [synced, setSynced] = useState(state.q);
  if (synced !== state.q) {
    setSynced(state.q);
    setText(state.q);
  }
  useEffect(() => {
    if (text === state.q) return;
    const timer = window.setTimeout(() => navigate((s) => ({ ...s, q: text }), { replace: true }), 200);
    return () => window.clearTimeout(timer);
  }, [text, state.q, navigate]);
  return (
    <div className="field min-w-0 flex-1 sm:max-w-64">
      <label htmlFor={id}>Search</label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="input w-full pl-8"
          placeholder="Search models"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </div>
  );
}

export function FilterBar({ summary, controls, trailing }: { summary: Summary; controls: FilterControl[]; trailing?: ReactNode }) {
  const { state, navigate } = useAppState();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const has = (control: FilterControl) => controls.includes(control);
  const set = (patch: Partial<AppState>) => navigate((s) => ({ ...s, ...patch }), { replace: true });

  const active = FILTER_KEYS.filter(
    (key) => has(key as FilterControl) && JSON.stringify(state[key]) !== JSON.stringify(DEFAULT_STATE[key])
  );

  const categories = categoriesIn(summary);
  const panel = (
    <>
      {has("tier") && (
        <Select
          label="Tier"
          value={state.tier}
          onChange={(value) => set({ tier: value as AppState["tier"] })}
          options={[
            { value: "core", label: "Core suites" },
            { value: "diagnostic", label: "Diagnostic suites" },
            { value: "all", label: "All suites" },
          ]}
        />
      )}
      {has("cat") && (
        <Select
          label="Category"
          value={state.cat ?? ""}
          onChange={(value) => set({ cat: value || null })}
          options={[{ value: "", label: "All categories" }, ...categories.map((value) => ({ value, label: categoryName(value) }))]}
        />
      )}
      {has("origin") && (
        <Select
          label="Audio"
          value={state.origin}
          onChange={(value) => set({ origin: value as AppState["origin"] })}
          options={[
            { value: "all", label: "All audio" },
            { value: "public", label: "Real recordings" },
            { value: "synthetic", label: "Synthetic (TTS)" },
          ]}
        />
      )}
      {has("deploy") && (
        <Select
          label="Runs on"
          value={state.deploy}
          onChange={(value) => set({ deploy: value as AppState["deploy"] })}
          options={[
            { value: "all", label: "Local and cloud" },
            { value: "local", label: "On device" },
            { value: "cloud", label: "Cloud API" },
          ]}
        />
      )}
      {has("tw") && (
        <Select
          label="TypeWhisper"
          value={state.tw}
          onChange={(value) => set({ tw: value as AppState["tw"] })}
          options={[
            { value: "all", label: "All models" },
            { value: "engine", label: "TypeWhisper engines" },
            { value: "candidate", label: "Candidates" },
          ]}
        />
      )}
      {has("acc") && state.cat !== ACCENTED && (
        <label className="check self-end" title="Their references do not match the audio, so every model scores about 90% WER there.">
          <input type="checkbox" checked={state.acc} onChange={(event) => set({ acc: event.target.checked })} />
          Include accented speech
        </label>
      )}
      {has("q") && <SearchBox />}
    </>
  );

  return (
    <div className="border-y border-hairline bg-surface/60">
      <div className="wrap flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {has("lang") && <LanguageSwitch summary={summary} />}
          <button
            type="button"
            className="btn md:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters{active.length ? ` (${active.length})` : ""}
          </button>
          {active.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost text-muted"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((key) => [key, DEFAULT_STATE[key]])) as Partial<AppState>)}
            >
              <X className="size-4" aria-hidden="true" />
              Reset filters
            </button>
          )}
          {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
        </div>
        <div id={panelId} className={clsx("flex-wrap items-end gap-3", open ? "flex" : "hidden md:flex")}>
          {panel}
        </div>
      </div>
    </div>
  );
}
