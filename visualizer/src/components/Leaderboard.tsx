import type { ModelRanking } from "../types";

export function Leaderboard({ rankings }: { rankings: ModelRanking[] }) {
  const hasPunctuation = rankings.some(r => r.avgPunctuationScore != null);
  const hasFormatting = rankings.some(r => r.avgFormattingScore != null);
  const hasSkips = rankings.some(r => r.skipCount > 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-400 border-b border-zinc-800">
            <th className="p-3">#</th>
            <th className="p-3">Model</th>
            <th className="p-3">Type</th>
            <th className="p-3 text-right">WER (norm)</th>
            <th className="p-3 text-right">CER</th>
            {hasPunctuation && <th className="p-3 text-right">Punct</th>}
            {hasFormatting && <th className="p-3 text-right">Format</th>}
            <th className="p-3 text-right">RTF</th>
            <th className="p-3 text-right">Cost/h</th>
            <th className="p-3 text-right">Tests</th>
            {hasSkips && <th className="p-3 text-right">Skips</th>}
            <th className="p-3 text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r, i) => (
            <tr
              key={`${r.providerId}/${r.model}`}
              className={`border-b border-zinc-800/50 ${
                i === 0 ? "text-green-400" : i === 1 ? "text-blue-400" : i === 2 ? "text-yellow-400" : "text-zinc-300"
              }`}
            >
              <td className="p-3 font-mono">{i + 1}</td>
              <td className="p-3 font-medium">{r.providerId}/{r.model}</td>
              <td className="p-3">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  r.providerType === "cloud" ? "bg-blue-500/20 text-blue-400"
                  : r.providerType === "local" ? "bg-green-500/20 text-green-400"
                  : "bg-purple-500/20 text-purple-400"
                }`}>
                  {r.providerType}
                </span>
              </td>
              <td className="p-3 text-right font-mono">{(r.avgWerNormalized * 100).toFixed(1)}%</td>
              <td className="p-3 text-right font-mono">{(r.avgCer * 100).toFixed(1)}%</td>
              {hasPunctuation && (
                <td className="p-3 text-right font-mono">
                  {r.avgPunctuationScore != null ? `${(r.avgPunctuationScore * 100).toFixed(1)}%` : "-"}
                </td>
              )}
              {hasFormatting && (
                <td className="p-3 text-right font-mono">
                  {r.avgFormattingScore != null ? `${(r.avgFormattingScore * 100).toFixed(1)}%` : "-"}
                </td>
              )}
              <td className="p-3 text-right font-mono">{r.avgRealtimeFactor.toFixed(3)}x</td>
              <td className="p-3 text-right font-mono">
                {r.costPerHourAudio != null ? `$${r.costPerHourAudio.toFixed(2)}` : "free"}
              </td>
              <td className="p-3 text-right">{r.totalTests}</td>
              {hasSkips && (
                <td className="p-3 text-right">
                  {r.skipCount > 0 ? <span className="text-amber-300">{r.skipCount}</span> : "0"}
                </td>
              )}
              <td className="p-3 text-right">
                {r.errorCount > 0 ? <span className="text-red-400">{r.errorCount}</span> : "0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
