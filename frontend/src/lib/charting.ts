export type XYPoint = Record<string, number | string | null | undefined>;

export type LineSpec = {
  key: string; // dataKey
  name?: string; // legenda
};

export type ChartProps = {
  data: XYPoint[];
  lines: LineSpec[];
  height?: number; // px
  xKey?: string; // default 'ts'
  yDomain?: [number | undefined, number | undefined];
  legend?: boolean;
};

export type ChartEngine = "recharts"; // futuro: "uplot", "echarts" etc

export const ENGINE: ChartEngine = "recharts";
