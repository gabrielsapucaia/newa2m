import { useMemo, useEffect, useRef } from "react";
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
    return lines.map((l) => ({
      name: l.name ?? l.key,
      type: "line",
      showSymbol: false,
      smooth: true,
      emphasis: { focus: "series" },
      data: arr.map((p: any) => [Number(p.t ?? Date.parse(p.ts)), p[l.key] ?? null]),
    }));
  }, [data, lines]);

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
            { type: "inside", throttle: 50, zoomOnMouseWheel: "shift" },
            { type: "slider", height: 22, bottom: 4 },
          ]
        : undefined,
    }),
    [series, xDomain, showDataZoom],
  );

  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst || !onRangeChange) return;
    const handler = (evt: any) => {
      const payload = Array.isArray(evt?.batch) && evt.batch.length ? evt.batch[0] : evt;
      const start = Number(payload?.startValue ?? payload?.start);
      const end = Number(payload?.endValue ?? payload?.end);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        onRangeChange([start, end]);
        return;
      }
      const opt = inst.getOption?.();
      const axis = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : undefined;
      const min = Number(axis?.min);
      const max = Number(axis?.max);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        onRangeChange([min, max]);
      }
    };
    inst.on("dataZoom", handler);
    return () => {
      inst.off("dataZoom", handler);
    };
  }, [onRangeChange]);

  return <ReactECharts ref={chartRef} theme="aura-dark" option={option} style={{ width: "100%", height }} notMerge />;
}
