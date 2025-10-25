import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Brush } from "recharts";
import type { ChartProps } from "./charting";

const fmtX = (v: any) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Date(n).toLocaleTimeString("pt-BR", { hour12: false });
};

const fmtTick = (v: any) => fmtX(v);

export function XYLinesChart({ data, lines, height = 160, xKey = "t", yDomain, legend = true, xDomain, syncId, syncMethod = "value" }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} syncId={syncId} syncMethod={syncMethod}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          type="number"
          tickFormatter={fmtTick}
          domain={xDomain ?? ["auto", "auto"]}
          allowDataOverflow
          minTickGap={20}
        />
        <YAxis domain={yDomain as any} />
        <Tooltip labelFormatter={(v) => fmtTick(v as any)} />
        {legend && <Legend />}
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dot={false} isAnimationActive={false} dataKey={l.key} name={l.name ?? l.key} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function XYLinesWithBrush({ brush = true, brushProps, ...rest }: ChartProps) {
  const xKey = rest.xKey ?? "t";
  return (
    <ResponsiveContainer width="100%" height={rest.height ?? 180}>
      <LineChart data={rest.data} syncId={rest.syncId} syncMethod={rest.syncMethod ?? "value"}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          type="number"
          tickFormatter={fmtTick}
          domain={rest.xDomain ?? ["auto", "auto"]}
          allowDataOverflow
          minTickGap={20}
        />
        <YAxis domain={rest.yDomain as any} />
        <Tooltip labelFormatter={(v) => fmtTick(v as any)} />
        <Legend />
        {rest.lines.map((l) => (
          <Line key={l.key} type="monotone" dot={false} isAnimationActive={false} dataKey={l.key} name={l.name ?? l.key} />
        ))}
        {brush && <Brush travellerWidth={12} height={24} dataKey={xKey} {...(brushProps as Record<string, unknown>)} />}
      </LineChart>
    </ResponsiveContainer>
  );
}
