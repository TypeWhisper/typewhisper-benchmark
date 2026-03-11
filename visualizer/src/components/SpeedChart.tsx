import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import type { ModelRanking } from "../types";

const COLORS = ["#22c55e", "#3b82f6", "#eab308", "#a1a1aa", "#a1a1aa", "#a1a1aa", "#a1a1aa", "#a1a1aa"];

export function SpeedChart({ rankings }: { rankings: ModelRanking[] }) {
  const sorted = [...rankings].sort((a, b) => a.avgRealtimeFactor - b.avgRealtimeFactor);
  const data = sorted.map((r) => ({
    name: `${r.providerId}/${r.model}`,
    rtf: +r.avgRealtimeFactor.toFixed(3),
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Real-time Factor - lower is faster</h2>
      <p className="text-zinc-400 text-sm mb-4">RTF &lt; 1.0 = faster than real-time</p>
      <ResponsiveContainer width="100%" height={Math.max(400, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 200, right: 40 }}>
          <XAxis type="number" tick={{ fill: "#a1a1aa" }} />
          <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} width={190} />
          <Tooltip
            contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
            labelStyle={{ color: "#fff" }}
          />
          <ReferenceLine x={1} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "Real-time", fill: "#ef4444" }} />
          <Bar dataKey="rtf" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[Math.min(i, COLORS.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
