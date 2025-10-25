import { useMemo } from "react";
import type { ImuHotPoint } from "../../../types";
import type { ImuChartProps } from "./ChartEngineContext";

const WIDTH = 600;

type AxisKey = "rmsX" | "rmsY" | "rmsZ";

const SERIES: Array<{ key: AxisKey; color: string; label: string }> = [
  { key: "rmsX", color: "#f97316", label: "RMS X" },
  { key: "rmsY", color: "#22c55e", label: "RMS Y" },
  { key: "rmsZ", color: "#3b82f6", label: "RMS Z" },
];

function buildPath(data: ImuHotPoint[], accessor: AxisKey, height: number, min: number, max: number): string {
  if (data.length === 0 || min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) {
    return "";
  }

  const range = max - min || 1;
  return data
    .map((point, index) => {
      const value = point[accessor];
      if (value === null || value === undefined) {
        return null;
      }
      const x = (index / Math.max(1, data.length - 1)) * WIDTH;
      const y = height - ((value - min) / range) * height;
      const command = index === 0 ? "M" : "L";
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function formatTimestamp(point: ImuHotPoint | null): string {
  if (!point) return "--";
  try {
    return new Date(point.ts).toLocaleTimeString();
  } catch (error) {
    return point.ts;
  }
}

export function SimpleLineChart({ data, height = 200 }: ImuChartProps) {
  const filtered = useMemo(
    () => data.filter((point) => point.rmsX !== null || point.rmsY !== null || point.rmsZ !== null),
    [data],
  );

  const { min, max } = useMemo(() => {
    const values = filtered.flatMap((point) =>
      SERIES.map(({ key }) => {
        const value = point[key];
        return value === null || value === undefined ? null : value;
      }).filter((value): value is number => value !== null),
    );
    if (!values.length) {
      return { min: 0, max: 1 };
    }
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [filtered]);

  const paths = useMemo(
    () =>
      SERIES.map(({ key, color }) => ({
        key,
        color,
        d: buildPath(filtered, key, height, min, max),
      })),
    [filtered, height, min, max],
  );

  const latest = filtered.length > 0 ? filtered[filtered.length - 1] : null;

  if (!filtered.length) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center text-xs text-slate-500">
        Sem dados IMU disponíveis nos últimos minutos.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <svg
        role="img"
        aria-label="Séries IMU (RMS)"
        className="w-full flex-1 rounded border border-slate-800 bg-slate-950/50"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="imu-grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(148, 163, 184, 0.1)" />
            <stop offset="100%" stopColor="rgba(148, 163, 184, 0.02)" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={WIDTH} height={height} fill="url(#imu-grid)" />
        {paths.map(({ key, d, color }) =>
          d ? <path key={key} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" /> : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-300">
        <div className="flex items-center gap-3">
          {SERIES.map(({ key, color, label }) => (
            <span key={key} className="inline-flex items-center gap-1 uppercase tracking-wide">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="text-slate-400">Último ponto: {formatTimestamp(latest)}</div>
      </div>
    </div>
  );
}
