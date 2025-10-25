import { useMemo } from "react";
import { useImuHotStream } from "../../hooks/useImuHotStream";
import { useUI } from "../../store/ui";
import type { ImuHotPoint } from "../../types";
import { useImuChartEngine } from "./chart/ChartEngineContext";

type Props = {
  deviceId: string;
};

function formatMetric(value: number | null | undefined, fractionDigits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(fractionDigits);
}

function MetricItem({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  accent: string;
}) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${accent}`}>
        {formatMetric(value)} {unit}
      </div>
    </div>
  );
}

function computePeak(points: ImuHotPoint[], key: keyof ImuHotPoint): number | null {
  const values = points
    .map((point) => point[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.max(...values);
}

export function ImuHotPanel({ deviceId }: Props) {
  const { liveMode: isLive, setLive } = useUI();
  const { points, latest, loading, error } = useImuHotStream(deviceId, isLive);
  const ChartEngine = useImuChartEngine();

  const peaks = useMemo(
    () => ({
      rms: computePeak(points, "rmsX"),
      jerk: computePeak(points, "jerkX"),
    }),
    [points],
  );

  return (
    <div className="flex h-full flex-col rounded border border-slate-800 bg-slate-900/80 p-3 text-slate-100 shadow">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Hot IMU</h3>
          <p className="text-xs text-slate-400">Atualização de aceleração / jerk em tempo real (~10 min)</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${isLive ? "bg-green-400 animate-pulse" : "bg-slate-600"}`}
            aria-hidden
          />
          <span>{isLive ? "Transmitindo" : "Pausado"}</span>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setLive(true)}
          className={`rounded px-3 py-1 transition ${
            isLive ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Ao vivo
        </button>
        <button
          type="button"
          onClick={() => setLive(false)}
          className={`rounded px-3 py-1 transition ${
            !isLive ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Pausar
        </button>
      </div>

      <div className="flex-1">
        {error ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-xs text-red-400">
            <span>Falha ao carregar dados IMU.</span>
            <span className="text-slate-500">{error}</span>
          </div>
        ) : (
          <ChartEngine data={points} height={200} />
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        <MetricItem label="RMS X" value={latest?.rmsX} unit="m/s²" accent="text-amber-300" />
        <MetricItem label="RMS Y" value={latest?.rmsY} unit="m/s²" accent="text-emerald-300" />
        <MetricItem label="RMS Z" value={latest?.rmsZ} unit="m/s²" accent="text-sky-300" />
        <MetricItem label="Jerk X" value={latest?.jerkX} unit="m/s³" accent="text-amber-400" />
        <MetricItem label="Jerk Y" value={latest?.jerkY} unit="m/s³" accent="text-emerald-400" />
        <MetricItem label="Jerk Z" value={latest?.jerkZ} unit="m/s³" accent="text-sky-400" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div>
          <span className="font-semibold text-slate-300">Pico RMS (x)</span>: {formatMetric(peaks.rms)}
        </div>
        <div>
          <span className="font-semibold text-slate-300">Pico Jerk (x)</span>: {formatMetric(peaks.jerk)}
        </div>
        <div>
          Última amostra:{" "}
          {latest ? new Date(latest.ts).toLocaleTimeString() : loading ? "carregando..." : "não disponível"}
        </div>
        <div>Total armazenado: {points.length}</div>
      </div>
    </div>
  );
}
