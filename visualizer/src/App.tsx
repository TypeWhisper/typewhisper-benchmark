import { useState, useEffect } from "react";
import type { BenchmarkSummary } from "./types";
import { Leaderboard } from "./components/Leaderboard";
import { AccuracyChart } from "./components/AccuracyChart";
import { SpeedChart } from "./components/SpeedChart";
import { CostChart } from "./components/CostChart";

const TABS = ["Leaderboard", "Accuracy", "Speed", "Cost"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [data, setData] = useState<BenchmarkSummary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Leaderboard");

  useEffect(() => {
    fetch("data/benchmark-results.json")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  if (!data) return <div className="min-h-screen bg-zinc-950 text-white p-8">Loading...</div>;

  if (data.rankings.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white p-8">
        <h1 className="text-2xl font-bold">TypeWhisper STT Benchmark</h1>
        <p className="text-zinc-400 mt-2">No results yet. Run the benchmark first.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-2xl font-bold">TypeWhisper STT Benchmark</h1>
        <p className="text-zinc-400 text-sm mt-1">
          {data.metadata.totalModels} models | {data.metadata.totalTests} tests |{" "}
          {data.metadata.languages.join(", ").toUpperCase()}
        </p>
      </header>

      <nav className="flex gap-1 px-6 py-3 border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {activeTab === "Leaderboard" && <Leaderboard rankings={data.rankings} />}
        {activeTab === "Accuracy" && <AccuracyChart rankings={data.rankings} />}
        {activeTab === "Speed" && <SpeedChart rankings={data.rankings} />}
        {activeTab === "Cost" && <CostChart rankings={data.rankings} />}
      </main>
    </div>
  );
}
