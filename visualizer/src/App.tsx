import { useEffect, useState } from "react";
import { Leaderboard } from "./components/Leaderboard";
import { AccuracyChart } from "./components/AccuracyChart";
import { SpeedChart } from "./components/SpeedChart";
import { CostChart } from "./components/CostChart";
import {
  getScopeOptions,
  getViewHeading,
  getViewRankings,
  getVisibleTestCount,
  normalizeSummary,
  type LanguageFilter,
  type NormalizedBenchmarkSummary,
  type OriginFilter,
  type Scope,
  type TierFilter,
} from "./benchmark-data";

const TABS = ["Leaderboard", "Accuracy", "Speed", "Cost"] as const;
const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: "global", label: "Global" },
  { value: "category", label: "Category" },
  { value: "suite", label: "Suite" },
  { value: "slice", label: "Slice" },
];

type Tab = (typeof TABS)[number];

function SelectField(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-40 flex-col gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
      {props.label}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-600"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function App() {
  const [data, setData] = useState<NormalizedBenchmarkSummary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Leaderboard");
  const [scope, setScope] = useState<Scope>("global");
  const [scopeValue, setScopeValue] = useState("");
  const [tier, setTier] = useState<TierFilter>("core");
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");

  useEffect(() => {
    fetch("data/benchmark-results.json")
      .then((response) => response.json())
      .then((summary) => setData(normalizeSummary(summary)))
      .catch(console.error);
  }, []);

  const scopeOptions = data
    ? getScopeOptions(data, { tier, language, origin })
    : { categories: [], suites: [], slices: [] };
  const currentScopeOptions =
    scope === "category"
      ? scopeOptions.categories
      : scope === "suite"
        ? scopeOptions.suites
        : scope === "slice"
          ? scopeOptions.slices
          : [];

  useEffect(() => {
    if (scope === "global") {
      if (scopeValue !== "") setScopeValue("");
      return;
    }

    if (currentScopeOptions.length === 0) {
      if (scopeValue !== "") setScopeValue("");
      return;
    }

    if (!currentScopeOptions.some((option) => option.value === scopeValue)) {
      setScopeValue(currentScopeOptions[0].value);
    }
  }, [scope, scopeValue, currentScopeOptions]);

  if (!data) {
    return <div className="min-h-screen bg-zinc-950 px-8 py-12 text-white">Loading...</div>;
  }

  const rankings = getViewRankings(data, {
    scope,
    scopeValue,
    tier,
    language,
    origin,
  });
  const heading = getViewHeading(data, {
    scope,
    scopeValue,
    tier,
    language,
    origin,
  });
  const visibleTestCount = getVisibleTestCount(data, { tier, language, origin });

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-900 bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.2),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_30%),#09090b] px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            TypeWhisper STT Benchmark
          </p>
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{heading.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                {heading.description}
              </p>
            </div>
            <div className="grid gap-2 text-sm text-zinc-300 md:text-right">
              <span>{data.metadata.totalModels} models tracked</span>
              <span>{visibleTestCount} benchmark tests in current filter</span>
              <span>Languages: {language === "all" ? "DE, EN, AUTO" : language.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="border-b border-zinc-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {SCOPES.map((item) => (
              <button
                key={item.value}
                onClick={() => setScope(item.value)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  scope === item.value
                    ? "bg-white text-zinc-950"
                    : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <SelectField
              label="Tier"
              value={tier}
              options={[
                { value: "core", label: "Core" },
                { value: "diagnostic", label: "Diagnostic" },
                { value: "all", label: "All" },
              ]}
              onChange={(value) => setTier(value as TierFilter)}
            />
            <SelectField
              label="Language"
              value={language}
              options={[
                { value: "all", label: "All" },
                { value: "de", label: "DE" },
                { value: "en", label: "EN" },
                { value: "auto", label: "Auto" },
              ]}
              onChange={(value) => setLanguage(value as LanguageFilter)}
            />
            <SelectField
              label="Origin"
              value={origin}
              options={[
                { value: "all", label: "All" },
                { value: "public", label: "Public" },
                { value: "synthetic", label: "Synthetic" },
              ]}
              onChange={(value) => setOrigin(value as OriginFilter)}
            />
            {scope !== "global" && (
              <SelectField
                label={scope}
                value={scopeValue}
                options={currentScopeOptions}
                onChange={setScopeValue}
              />
            )}
          </div>
        </div>
      </section>

      <nav className="border-b border-zinc-900 px-6 py-3">
        <div className="mx-auto flex max-w-7xl gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                activeTab === tab
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-6 py-6">
        <div className="mx-auto max-w-7xl">
          {rankings.length === 0 ? (
            <div className="rounded-3xl border border-zinc-900 bg-zinc-950 px-6 py-10 text-center">
              <h2 className="text-lg font-semibold">No results for this view</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Adjust the filters or run benchmarks for the missing suites first.
              </p>
            </div>
          ) : (
            <>
              {activeTab === "Leaderboard" && <Leaderboard rankings={rankings} />}
              {activeTab === "Accuracy" && <AccuracyChart rankings={rankings} />}
              {activeTab === "Speed" && <SpeedChart rankings={rankings} />}
              {activeTab === "Cost" && <CostChart rankings={rankings} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
