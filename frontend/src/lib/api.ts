import type { DeviceLastPoint, SeriesPage, StatsResponse } from "../types";

const DEFAULT_BASE_URL = "http://localhost:8080";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_BASE_URL;

function buildUrl(path: string, searchParams?: Record<string, string | number | undefined>) {
  const url = new URL(path, API_BASE_URL);
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

export async function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/stats");
}

export interface SeriesQueryOptions {
  cursor?: string;
  limit?: number;
}

export async function fetchDeviceSeries(deviceId: string, options: SeriesQueryOptions = {}): Promise<SeriesPage> {
  const limit = options.limit ?? 200;
  try {
    const page = await request<SeriesPage>(`/devices/${deviceId}/series2`, undefined, {
      cursor: options.cursor,
      limit,
    });
    return normalizeSeries(page);
  } catch (error) {
    const fallback = await request<Array<Record<string, unknown>>>(`/devices/${deviceId}/series`, undefined, {
      limit,
      bucket: "1s",
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

function normalizeSeries(page: SeriesPage): SeriesPage {
  return {
    items: page.items.map((item) => ({
      ts: String(item.ts),
      device_id: item.device_id,
      lat: safeNumber(item.lat),
      lon: safeNumber(item.lon),
      speed: safeNumber(item.speed),
      cn0_avg: safeNumber(item.cn0_avg),
      sats_used: safeNumber(item.sats_used),
    })),
    nextCursor: page.nextCursor ?? null,
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
  };
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

export { API_BASE_URL };
