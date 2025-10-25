import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDeviceImuSeries } from "../lib/api";
import { subscribeLastFrame, type LastFramePayload } from "../lib/ws";
import type { ImuHotPoint, ImuSeriesPoint } from "../types";

const MAX_POINTS = 600;
const HISTORY_BUCKET = "1s";
const HISTORY_WINDOW_SEC = 600;

function safeNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEpoch(timestamp: string | number | null | undefined): { iso: string; epochMs: number } {
  if (typeof timestamp === "string") {
    const ms = Date.parse(timestamp);
    if (Number.isFinite(ms)) {
      return { iso: new Date(ms).toISOString(), epochMs: ms };
    }
  }
  if (typeof timestamp === "number") {
    const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    return { iso: new Date(ms).toISOString(), epochMs: ms };
  }
  const now = Date.now();
  return { iso: new Date(now).toISOString(), epochMs: now };
}

function mapSeriesPoint(point: ImuSeriesPoint): ImuHotPoint {
  const { iso, epochMs } = toEpoch(point.ts);
  return {
    ts: iso,
    epochMs,
    rmsX: safeNumber(point.imu_rms_x),
    rmsY: safeNumber(point.imu_rms_y),
    rmsZ: safeNumber(point.imu_rms_z),
    jerkX: safeNumber(point.jerk_x),
    jerkY: safeNumber(point.jerk_y),
    jerkZ: safeNumber(point.jerk_z),
  };
}

function lookupValue(source: Record<string, unknown>, dottedKey: string): unknown {
  if (dottedKey in source) {
    return source[dottedKey];
  }

  const segments = dottedKey.split(".");
  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = lookupValue(source, key);
    const numeric = safeNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function extractHotPoint(raw: LastFramePayload): ImuHotPoint | null {
  const payload = (raw.payload as Record<string, unknown> | undefined) ?? (raw as Record<string, unknown>);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const { iso, epochMs } = toEpoch(
    (payload.ts as string | number | undefined) ??
      (raw.ts as string | number | undefined) ??
      (payload.timestamp as string | number | undefined) ??
      (payload.ts_epoch as number | undefined) ??
      (raw.ts_epoch as number | undefined),
  );

  const rmsX = pickNumber(payload, ["imu_rms_x", "imu.acc.x.rms", "imu.linear_acc.x.rms"]);
  const rmsY = pickNumber(payload, ["imu_rms_y", "imu.acc.y.rms", "imu.linear_acc.y.rms"]);
  const rmsZ = pickNumber(payload, ["imu_rms_z", "imu.acc.z.rms", "imu.linear_acc.z.rms"]);
  const jerkX = pickNumber(payload, ["jerk_x", "imu.jerk.x.rms"]);
  const jerkY = pickNumber(payload, ["jerk_y", "imu.jerk.y.rms"]);
  const jerkZ = pickNumber(payload, ["jerk_z", "imu.jerk.z.rms"]);

  if (rmsX === null && rmsY === null && rmsZ === null && jerkX === null && jerkY === null && jerkZ === null) {
    return null;
  }

  return {
    ts: iso,
    epochMs,
    rmsX,
    rmsY,
    rmsZ,
    jerkX,
    jerkY,
    jerkZ,
  };
}

function mergePoints(existing: ImuHotPoint[], incoming: ImuHotPoint): ImuHotPoint[] {
  const map = new Map<number, ImuHotPoint>();
  for (const point of existing) {
    map.set(point.epochMs, point);
  }
  map.set(incoming.epochMs, incoming);
  const sorted = Array.from(map.values()).sort((a, b) => a.epochMs - b.epochMs);
  if (sorted.length > MAX_POINTS) {
    return sorted.slice(sorted.length - MAX_POINTS);
  }
  return sorted;
}

export function useImuHotStream(deviceId: string | null, isLive: boolean) {
  const [points, setPoints] = useState<ImuHotPoint[]>([]);
  const [latest, setLatest] = useState<ImuHotPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setPoints([]);
    setLatest(null);
    setError(null);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      return;
    }
    let cancelled = false;
    const loadHistory = async () => {
      setLoading(true);
      try {
        const history = await fetchDeviceImuSeries(deviceId, {
          bucket: HISTORY_BUCKET,
          limit: MAX_POINTS,
          windowSec: HISTORY_WINDOW_SEC,
        });
        if (cancelled) return;
        const mapped = history.map(mapSeriesPoint).filter(Boolean);
        mapped.sort((a, b) => a.epochMs - b.epochMs);
        setPoints(mapped.slice(-MAX_POINTS));
        if (mapped.length > 0) {
          setLatest(mapped[mapped.length - 1]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar histórico IMU");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    wsCleanupRef.current?.();
    wsCleanupRef.current = null;
    if (!deviceId || !isLive) {
      return undefined;
    }

    wsCleanupRef.current = subscribeLastFrame(deviceId, (payload) => {
      const sample = extractHotPoint(payload);
      if (!sample) return;
      setLatest(sample);
      setPoints((prev) => mergePoints(prev, sample));
    });

    return () => {
      wsCleanupRef.current?.();
      wsCleanupRef.current = null;
    };
  }, [deviceId, isLive]);

  return useMemo(
    () => ({
      points,
      latest,
      loading,
      error,
    }),
    [points, latest, loading, error],
  );
}
