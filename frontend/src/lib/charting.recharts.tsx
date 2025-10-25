import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import type { ChartProps } from "./charting";

const fmtX = (v: any) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Date(n).toLocaleTimeString("pt-BR", { hour12: false });
};

export function XYLinesChart({ data, lines, height = 160, xKey = "t", yDomain, legend = true }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          type="number"
          tickFormatter={fmtX}
          domain={["auto", "auto"]}
          allowDataOverflow
          minTickGap={20}
        />
        <YAxis domain={yDomain as any} />
        <Tooltip labelFormatter={(v) => fmtX(v as any)} />
        {legend && <Legend />}
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dot={false}
            isAnimationActive={false}
            dataKey={l.key}
            name={l.name ?? l.key}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
