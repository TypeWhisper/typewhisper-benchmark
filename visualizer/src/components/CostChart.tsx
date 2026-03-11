import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ModelRanking } from "../types";

const COLORS = ["#22c55e", "#3b82f6", "#eab308", "#a1a1aa"];

export function CostChart({ rankings }: { rankings: ModelRanking[] }) {
  const sorted = [...rankings].sort((a, b) =>
    (a.costPerHourAudio ?? 0) - (b.costPerHourAudio ?? 0)
  );
  const data = sorted.map((r) => ({
    name: `${r.providerId}/${r.model}`,
    cost: r.costPerHourAudio != null ? +r.costPerHourAudio.toFixed(2) : 0,
    isFree: r.costPerHourAudio == null || r.costPerHourAudio === 0,
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Cost per Hour of Audio (USD)</h2>
      <ResponsiveContainer width="100%" height={Math.max(400, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 200, right: 40 }}>
          <XAxis type="number" tick={{ fill: "#a1a1aa" }} unit="$" />
          <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} width={190} />
          <Tooltip
            contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
            labelStyle={{ color: "#fff" }}
            formatter={(value, _name, props) => {
              const payload = props?.payload as { isFree?: boolean } | undefined;
              const numValue = Number(value);
              return payload?.isFree ? "Free (local)" : `$${numValue.toFixed(2)}`;
            }}
          />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.isFree ? "#22c55e" : COLORS[Math.min(i, COLORS.length - 1)]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
