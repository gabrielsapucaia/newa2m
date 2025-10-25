import { useMemo } from "react";
import { XYLinesWithBrush } from "../lib/chart";
import type { LivePoint } from "../store/telemetry";

type Props = {
  data: LivePoint[];
  xDomain: [number, number];
  onBrush?: (range: [number, number]) => void;
  syncId?: string;
};

function computeIndices(data: LivePoint[], domain: [number, number]) {
  if (!data.length) return { startIndex: 0, endIndex: 0 };
  const [start, end] = domain;
  let startIndex = data.findIndex((item) => item.t >= start);
  if (startIndex === -1) startIndex = 0;
  let endIndex = data.findIndex((item) => item.t > end);
  if (endIndex === -1) endIndex = data.length - 1;
  else endIndex = Math.max(startIndex, endIndex - 1);
  return { startIndex, endIndex };
}

export default function TimeNavigator({ data, xDomain, onBrush, syncId = "imu" }: Props) {
  const lines = useMemo(() => [{ key: "speed", name: "Speed" }], []);
  const { startIndex, endIndex } = useMemo(() => computeIndices(data, xDomain), [data, xDomain]);

  const brushProps = useMemo(() => ({
    startIndex,
    endIndex,
    onChange: (range: { startIndex?: number; endIndex?: number }) => {
      if (!onBrush || !data.length) return;
      const sIndex = range.startIndex ?? startIndex;
      const eIndex = range.endIndex ?? endIndex;
      const safeStart = Math.max(0, Math.min(sIndex, data.length - 1));
      const safeEnd = Math.max(safeStart, Math.min(eIndex, data.length - 1));
      const startPoint = data[safeStart];
      const endPoint = data[safeEnd];
      if (!startPoint || !endPoint) return;
      onBrush([startPoint.t, endPoint.t]);
    },
  }), [data, startIndex, endIndex, onBrush]);

  return (
    <div className="mt-2">
      <XYLinesWithBrush data={data} lines={lines} height={120} xDomain={xDomain} syncId={syncId} brushProps={brushProps} />
      <div className="mt-1 text-[11px] text-slate-400">
        Arraste para revisar o passado; clique em “Ao vivo” para retomar.
      </div>
    </div>
  );
}
