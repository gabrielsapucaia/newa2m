export interface DeviceStatsRow {
  device_id: string;
  last_ts: string;
  total_points: number;
  last_lat?: number | null;
  last_lon?: number | null;
  last_speed?: number | null;
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
  imu_rms_x?: number | null;
  imu_rms_y?: number | null;
  imu_rms_z?: number | null;
  jerk_x?: number | null;
  jerk_y?: number | null;
  jerk_z?: number | null;
}

export interface SeriesPage {
  items: SeriesPoint[];
  nextCursor?: string | null;
}

export interface ImuSeriesPoint {
  ts: string;
  device_id: string;
  imu_rms_x: number | null;
  imu_rms_y: number | null;
  imu_rms_z: number | null;
  jerk_x: number | null;
  jerk_y: number | null;
  jerk_z: number | null;
}

export type ImuHotPoint = {
  ts: string;
  epochMs: number;
  rmsX: number | null;
  rmsY: number | null;
  rmsZ: number | null;
  jerkX: number | null;
  jerkY: number | null;
  jerkZ: number | null;
};

export type TelemetryMode = "live" | "history";
