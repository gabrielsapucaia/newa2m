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
  xDomain?: [number, number];
  yDomain?: [number | undefined, number | undefined];
  legend?: boolean;
  syncId?: string;
  syncMethod?: "value" | "index";
  brush?: boolean;
  brushProps?: Record<string, unknown>;
};

export type ChartEngine = "recharts"; // futuro: "uplot", "echarts" etc

export const ENGINE: ChartEngine = "recharts";
