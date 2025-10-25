import { create } from "zustand";

export type LivePoint = {
  ts: string; // ISO
  t: number; // epoch millis
  speed?: number | null;
  cn0_avg?: number | null;
  sats_used?: number | null;
  baro?: number | null;
  imu_acc_rms_x?: number | null;
  imu_acc_rms_y?: number | null;
  imu_acc_rms_z?: number | null;
  imu_gyro_rms_x?: number | null;
  imu_gyro_rms_y?: number | null;
  imu_gyro_rms_z?: number | null;
  imu_jerk_rms_x?: number | null;
  imu_jerk_rms_y?: number | null;
  imu_jerk_rms_z?: number | null;
  shock_level?: number | null;
};

type Series = { deviceId: string; points: LivePoint[] };

const MAX_POINTS = 600; // ~10 min a 1 Hz
const EMPTY_POINTS: LivePoint[] = [];
export const LIVE_WINDOW_MS = 10 * 60 * 1000;

type TelemetryState = {
  byDevice: Record<string, Series>;
  push: (deviceId: string, p: LivePoint) => void;
  pushMany: (deviceId: string, points: LivePoint[]) => void;
  reset: (deviceId: string, initial: LivePoint[]) => void;
  get: (deviceId: string) => LivePoint[];
  clear: (deviceId: string) => void;
  trimBefore: (deviceId: string, cutoff: number) => void;
};

export const useTelemetry = create<TelemetryState>((set, get) => ({
  byDevice: {},
  push: (deviceId, p) => {
    const cur = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = [...cur, p].filter((item) => Number.isFinite(item.t));
    merged.sort((a, b) => a.t - b.t);
    const cutoff = Date.now() - LIVE_WINDOW_MS;
    const trimmed = merged.filter((item) => item.t >= cutoff);
    const clipped = trimmed.slice(-MAX_POINTS);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  pushMany: (deviceId, incoming) => {
    if (incoming.length === 0) return;
    const cur = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = [...cur, ...incoming].filter((item) => Number.isFinite(item.t));
    merged.sort((a, b) => a.t - b.t);
    const cutoff = Date.now() - LIVE_WINDOW_MS;
    const trimmed = merged.filter((item) => item.t >= cutoff);
    const clipped = trimmed.slice(-MAX_POINTS);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  reset: (deviceId, initial) => {
    const clipped = [...initial]
      .filter((item) => Number.isFinite(item.t))
      .slice(-MAX_POINTS);
    clipped.sort((a, b) => a.t - b.t);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  get: (deviceId) => get().byDevice[deviceId]?.points ?? EMPTY_POINTS,
  clear: (deviceId) =>
    set((s) => {
      const c = { ...s.byDevice };
      delete c[deviceId];
      return { byDevice: c };
    }),
  trimBefore: (deviceId, cutoff) =>
    set((s) => {
      const series = s.byDevice[deviceId];
      if (!series) return s;
      const filtered = series.points.filter((item) => item.t >= cutoff);
      if (filtered.length === series.points.length) return s;
      return {
        byDevice: {
          ...s.byDevice,
          [deviceId]: { deviceId, points: filtered },
        },
      };
    }),
}));

export { EMPTY_POINTS };
