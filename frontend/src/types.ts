export interface DeviceStatsRow {
  device_id: string;
  last_ts: string;
  total_points: number;
  lat?: number | null;
  lon?: number | null;
  speed?: number | null;
}

export interface StatsResponse {
  devices: DeviceStatsRow[];
  db_total_points: number;
}

export interface DeviceLastPoint {
  ts: string;
  device_id: string;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  cn0_avg?: number | null;
  sats_used?: number | null;
  heading?: number | null;
  altitude?: number | null;
  payload?: Record<string, unknown>;
}

export interface SeriesPoint {
  ts: string;
  device_id: string;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  cn0_avg?: number | null;
  sats_used?: number | null;
}

export interface SeriesPage {
  items: SeriesPoint[];
  nextCursor?: string | null;
}

export type TelemetryMode = "live" | "history";
