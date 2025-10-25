import type {
  DeviceLastPoint,
  DeviceStatsRow,
  ImuSeriesPoint,
  SeriesPage,
  StatsResponse,
} from "../types";

const DEFAULT_BASE_URL = "http://localhost:8080";
const ENV_BASE_URL =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.VITE_API_BASE_URL as string | undefined);
export const API = ENV_BASE_URL ?? DEFAULT_BASE_URL;
const API_BASE_URL = API;

function buildUrl(path: string, searchParams?: Record<string, string | number | undefined>) {
  const url = path.startsWith("http") ? new URL(path) : new URL(path, API_BASE_URL);
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  searchParams?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = buildUrl(path, searchParams);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} ${res.statusText} - ${text}`);
  }

  return (await res.json()) as T;
}

export async function listDevices(): Promise<unknown> {
  return request(`${API_BASE_URL}/devices`);
}

export async function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>(`${API_BASE_URL}/stats`);
}

export async function getLast(deviceId: string): Promise<DeviceLastPoint> {
  return request<DeviceLastPoint>(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}/last`);
}

export async function getStatsWithFallback(): Promise<StatsResponse> {
  const stats = await getStats();
  const devices = stats?.devices ?? [];
  const enriched = await Promise.all(
    devices.map(async (device: DeviceStatsRow) => {
      const hasCoords = device.lat != null && device.lon != null;
      const hasSpeed = device.speed != null;

      if (hasCoords && hasSpeed) {
        return {
          ...device,
          last_lat: device.last_lat ?? device.lat ?? null,
          last_lon: device.last_lon ?? device.lon ?? null,
          last_speed: device.last_speed ?? device.speed ?? null,
        };
      }

      try {
        const last = await getLast(device.device_id);
        return {
          ...device,
          last_lat: last?.lat ?? device.last_lat ?? null,
          last_lon: last?.lon ?? device.last_lon ?? null,
          last_speed: last?.speed ?? device.last_speed ?? null,
        };
      } catch (error) {
        console.error(`fallback /last falhou para ${device.device_id}`, error);
        return {
          ...device,
          last_lat: device.last_lat ?? null,
          last_lon: device.last_lon ?? null,
          last_speed: device.last_speed ?? null,
        };
      }
    }),
  );
  return { ...stats, devices: enriched };
}

export interface Series2Response<T = Record<string, unknown>> {
  data: T[];
  cursor: string | null;
}

export async function getSeries2<T = Record<string, unknown>>(
  deviceId: string,
  params: Record<string, string | number>,
): Promise<Series2Response<T>> {
  return request<Series2Response<T>>(`/devices/${encodeURIComponent(deviceId)}/series2`, undefined, params);
}

export async function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/stats");
}

export interface SeriesQueryOptions {
  cursor?: string;
  limit?: number;
  bucket?: string;
  windowSec?: number;
}

export async function fetchDeviceSeries(deviceId: string, options: SeriesQueryOptions = {}): Promise<SeriesPage> {
  const limit = options.limit ?? 200;
  const bucket = options.bucket ?? "10s";
  try {
    const params: Record<string, string | number> = {
      limit,
      bucket,
    };
    if (options.cursor) params.cursor = options.cursor;
    if (options.windowSec) params.window_sec = options.windowSec;
    const page = await getSeries2(deviceId, params);
    return normalizeSeries(page);
  } catch (error) {
    const fallback = await request<Array<Record<string, unknown>>>(`/devices/${deviceId}/series`, undefined, {
      limit,
      bucket,
    });
    const items = fallback.map((row) => mapLegacySeriesRow(row));
    return {
      items,
      nextCursor: null,
    };
  }
}

export async function fetchDeviceLast(deviceId: string): Promise<DeviceLastPoint> {
  const data = await request<DeviceLastPoint>(`/devices/${deviceId}/last`);
  return normalizePoint(data);
}

export function normalizePoint(raw: DeviceLastPoint | Record<string, unknown>): DeviceLastPoint {
  const source = raw as Record<string, unknown>;
  const payload = (source.payload as Record<string, unknown> | undefined) ?? {};
  const lat = safeNumber(source.lat ?? payload.lat);
  const lon = safeNumber(source.lon ?? payload.lon);
  const speed = safeNumber(source.speed ?? payload.speed);
  const cn0 = safeNumber(source.cn0_avg ?? payload.cn0_avg);
  const sats = safeNumber(source.sats_used ?? payload.sats_used);
  return {
    ts: String(source.ts ?? payload.ts ?? new Date().toISOString()),
    device_id: String(source.device_id ?? payload.device_id ?? "unknown"),
    lat,
    lon,
    speed,
    cn0_avg: cn0,
    sats_used: sats !== null ? Math.round(sats) : null,
    heading: safeNumber(source.heading ?? payload.heading),
    altitude: safeNumber(source.altitude ?? payload.altitude),
    payload,
  };
}

function safeNumber(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function normalizeSeries(page: Series2Response): SeriesPage {
  return {
    items: page.data.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        ts: String(record.ts),
        device_id: String(record.device_id ?? "unknown"),
        lat: safeNumber(record.lat),
        lon: safeNumber(record.lon),
        speed: safeNumber(record.speed),
        cn0_avg: safeNumber(record.cn0_avg),
        sats_used: safeNumber(record.sats_used),
        imu_rms_x: safeNumber(record.imu_rms_x),
        imu_rms_y: safeNumber(record.imu_rms_y),
        imu_rms_z: safeNumber(record.imu_rms_z),
        jerk_x: safeNumber(record.jerk_x),
        jerk_y: safeNumber(record.jerk_y),
        jerk_z: safeNumber(record.jerk_z),
      };
    }),
    nextCursor: page.cursor ?? null,
  };
}

function mapLegacySeriesRow(row: Record<string, unknown>) {
  return {
    ts: String(row.ts ?? new Date().toISOString()),
    device_id: String(row.device_id ?? "unknown"),
    lat: safeNumber(row.lat),
    lon: safeNumber(row.lon),
    speed: safeNumber(row.speed),
    cn0_avg: safeNumber(row.cn0_avg),
    sats_used: safeNumber(row.sats_used),
    imu_rms_x: safeNumber(row.imu_rms_x),
    imu_rms_y: safeNumber(row.imu_rms_y),
    imu_rms_z: safeNumber(row.imu_rms_z),
    jerk_x: safeNumber(row.jerk_x),
    jerk_y: safeNumber(row.jerk_y),
    jerk_z: safeNumber(row.jerk_z),
  };
}

export interface ImuSeriesQueryOptions {
  windowSec?: number;
  limit?: number;
  bucket?: string;
}

function mapImuRow(row: Record<string, unknown>): ImuSeriesPoint {
  return {
    ts: String(row.ts ?? new Date().toISOString()),
    device_id: String(row.device_id ?? "unknown"),
    imu_rms_x: safeNumber(row.imu_rms_x),
    imu_rms_y: safeNumber(row.imu_rms_y),
    imu_rms_z: safeNumber(row.imu_rms_z),
    jerk_x: safeNumber(row.jerk_x),
    jerk_y: safeNumber(row.jerk_y),
    jerk_z: safeNumber(row.jerk_z),
  };
}

export async function fetchDeviceImuSeries(
  deviceId: string,
  options: ImuSeriesQueryOptions = {},
): Promise<ImuSeriesPoint[]> {
  const bucket = options.bucket ?? "1s";
  const windowSec = options.windowSec ?? 600;
  const limit = options.limit ?? 600;
  const response = await getSeries2<Record<string, unknown>>(deviceId, {
    bucket,
    window_sec: windowSec,
    limit,
  });
  return response.data.map(mapImuRow);
}

export interface RawTelemetryPoint {
  ts: string;
  seq_id: number | null;
  gnss: {
    lat: number | null;
    lon: number | null;
    speed: number | null;
    heading: number | null;
    alt: number | null;
    accuracy_m: number | null;
    cn0_avg: number | null;
    num_sats: number | null;
    sats_used: number | null;
    speed_accuracy_mps?: number | null;
  };
  imu: {
    pitch_deg: number | null;
    roll_deg: number | null;
    yaw_deg: number | null;
    yaw_rate_deg_s?: number | null;
    acc_norm_rms: number | null;
    gyro_norm_rms: number | null;
    jerk_x_rms: number | null;
    jerk_y_rms: number | null;
    jerk_z_rms: number | null;
    jerk_norm_rms: number | null;
    shock_score: number | null;
    shock_level: string | null;
    acc_x_rms?: number | null;
    acc_y_rms?: number | null;
    acc_z_rms?: number | null;
    gyro_x_rms?: number | null;
    gyro_y_rms?: number | null;
    gyro_z_rms?: number | null;
    mag_field_uT?: number | null;
  };
  power: {
    battery_percent: number | null;
    charging: boolean | null;
  };
  network: {
    wifi_ssid: string | null;
    wifi_strength_dbm: number | null;
  };
  meta: {
    operator_id: string | null;
    equipment_tag: string | null;
    schema_version: string | null;
    app_version: string | null;
    hardware: string | null;
    uptime_s: number | null;
  };
  raw_payload: Record<string, unknown> | null;
}

export interface RawTelemetryStats {
  speed_max: number | null;
  shock_score_p95: number | null;
  shock_score_max: number | null;
  jerk_norm_rms_p95: number | null;
  battery_min: number | null;
  battery_max: number | null;
}

export interface RawTelemetryResponse {
  device_id: string;
  from_ts: string | null;
  to_ts: string | null;
  points: RawTelemetryPoint[];
  stats: RawTelemetryStats | null;
  next_page_after_ts: string | null;
}

export interface RawTelemetryQuery {
  from_ts?: string;
  to_ts?: string;
  page_after_ts?: string;
  limit?: number;
}

export async function fetchRawTelemetry(
  deviceId: string,
  { from_ts, to_ts, page_after_ts, limit }: RawTelemetryQuery = {},
): Promise<RawTelemetryResponse> {
  return request<RawTelemetryResponse>(`/devices/${encodeURIComponent(deviceId)}/raw`, undefined, {
    from_ts,
    to_ts,
    page_after_ts,
    limit,
  });
}

export function metersPerSecondToKmH(value: number | null | undefined): number {
  if (!value) return 0;
  return Number((value * 3.6).toFixed(2));
}

export function getSpeedColor(speedMs: number | null | undefined): string {
  const speed = metersPerSecondToKmH(speedMs ?? 0);
  if (speed < 5) return "#1d4ed8";
  if (speed < 40) return "#22c55e";
  if (speed < 45) return "#eab308";
  return "#ef4444";
}
