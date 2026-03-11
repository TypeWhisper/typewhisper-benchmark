import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ModelRanking } from "../types";

const COLORS = ["#22c55e", "#3b82f6", "#eab308", "#a1a1aa", "#a1a1aa", "#a1a1aa", "#a1a1aa", "#a1a1aa"];

export function AccuracyChart({ rankings }: { rankings: ModelRanking[] }) {
  const data = rankings.map((r) => ({
    name: `${r.providerId}/${r.model}`,
    wer: +(r.avgWerNormalized * 100).toFixed(1),
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Word Error Rate (normalized) - lower is better</h2>
      <ResponsiveContainer width="100%" height={Math.max(400, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 200, right: 40 }}>
          <XAxis type="number" domain={[0, "auto"]} tick={{ fill: "#a1a1aa" }} unit="%" />
          <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} width={190} />
          <Tooltip
            contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
            labelStyle={{ color: "#fff" }}
          />
          <Bar dataKey="wer" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[Math.min(i, COLORS.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
