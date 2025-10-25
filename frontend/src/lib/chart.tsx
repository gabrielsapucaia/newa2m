import { ENGINE } from "./charting";
import type { ChartProps } from "./charting";
import { XYLinesChart as RechartsXY } from "./charting.recharts";

export function XYLinesChart(props: ChartProps) {
  switch (ENGINE) {
    case "recharts":
    default:
      return <RechartsXY {...props} />;
  }
}

export type { ChartProps } from "./charting";
