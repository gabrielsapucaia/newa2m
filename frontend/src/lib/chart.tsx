import { ENGINE } from "./charting";
import type { ChartProps } from "./charting";
import { XYLinesChart as RechartsXY, XYLinesWithBrush as RechartsXYBrush } from "./charting.recharts";

export function XYLinesChart(props: ChartProps) {
  switch (ENGINE) {
    case "recharts":
    default:
      return <RechartsXY {...props} />;
  }
}

export function XYLinesWithBrush(props: ChartProps & { brush?: boolean }) {
  switch (ENGINE) {
    case "recharts":
    default:
      return <RechartsXYBrush {...props} />;
  }
}

export type { ChartProps } from "./charting";
