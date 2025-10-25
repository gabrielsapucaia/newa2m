import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import type { ChartProps } from "./charting";

const fmtX = (ts: any) => {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour12: false });
  } catch (error) {
    return String(ts);
  }
};

export function XYLinesChart({ data, lines, height = 160, xKey = "ts", yDomain, legend = true }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={fmtX} minTickGap={20} />
        <YAxis domain={yDomain as any} />
        <Tooltip />
        {legend && <Legend />}
        {lines.map((line) => (
          <Line key={line.key} type="monotone" dot={false} dataKey={line.key} name={line.name ?? line.key} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
