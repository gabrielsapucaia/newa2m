import { useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";

type LineSpec = { key: string; name?: string };
type Props = {
  data: any[];
  lines: LineSpec[];
  xDomain: [number, number];
  height?: number;
  onRangeChange?: (range: [number, number]) => void;
  showDataZoom?: boolean;
};

export default function EChartSeries({ data, lines, xDomain, height = 180, onRangeChange, showDataZoom = false }: Props) {
  const chartRef = useRef<ReactECharts>(null);

  const series = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    return lines.map((l) => {
      const lineData: [number, number][] = [];
      for (const sample of arr) {
        const ts = Number(sample.t ?? Date.parse(sample.ts));
        if (!Number.isFinite(ts)) {
          continue;
        }
        const raw = sample[l.key];
        const value = Number(raw);
        if (Number.isFinite(value)) {
          lineData.push([ts, value]);
        }
      }
      return {
        name: l.name ?? l.key,
        type: "line",
        showSymbol: false,
        smooth: true,
        emphasis: { focus: "series" },
        connectNulls: true,
        data: lineData,
      };
    });
  }, [data, lines, xDomain]);

  const option = useMemo(
    () => ({
      darkMode: true,
      animation: false,
      grid: { left: 40, right: 10, top: 20, bottom: showDataZoom ? 60 : 30 },
      xAxis: {
        type: "time",
        min: xDomain[0],
        max: xDomain[1],
        axisLabel: { color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#374151" } },
        axisPointer: { show: true },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#9ca3af" },
        axisLine: { lineStyle: { color: "#374151" } },
        splitLine: { lineStyle: { color: "#1f2937" } },
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: any) => (typeof v === "number" ? v.toFixed(3) : String(v)),
      },
      legend: { top: 0, textStyle: { color: "#e5e7eb" } },
      series,
      dataZoom: showDataZoom
        ? [
            {
              type: "inside",
              throttle: 50,
              zoomOnMouseWheel: "shift",
              moveOnMouseMove: true,
              moveOnMouseWheel: true,
            },
          ]
        : undefined,
    }),
    [series, xDomain, showDataZoom],
  );

  const onEvents = useMemo(() => {
    if (!onRangeChange) return undefined;
    const span = xDomain[1] - xDomain[0] || 1;
    const resolveValue = (value: unknown, percentFallback: unknown) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const pct = Number(percentFallback);
      if (Number.isFinite(pct)) {
        return xDomain[0] + (span * pct) / 100;
      }
      return null;
    };
    return {
      dataZoom: (evt: any) => {
        const payload = Array.isArray(evt?.batch) && evt.batch.length ? evt.batch[0] : evt;
        const start = resolveValue(payload?.startValue, payload?.start ?? payload?.startPercent);
        const end = resolveValue(payload?.endValue, payload?.end ?? payload?.endPercent);
        if (start !== null && end !== null) {
          onRangeChange([start, end]);
        }
      },
    };
  }, [onRangeChange, xDomain]);

  return (
    <ReactECharts
      ref={chartRef}
      theme="aura-dark"
      option={option}
      onEvents={onEvents}
      style={{ width: "100%", height }}
      notMerge={false}
      lazyUpdate
    />
  );
}
