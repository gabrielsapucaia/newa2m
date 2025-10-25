import { create } from "zustand";
import { MINUTE_MS } from "../lib/timeutils";

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

type Series = { deviceId: string; points: LivePoint[]; oldest?: number; xDomain?: [number, number] };

const MAX_WINDOW_MS = 60 * MINUTE_MS;
const MAX_POINTS = Math.ceil(MAX_WINDOW_MS / 1000) + 600; // margem extra
const EMPTY_POINTS: LivePoint[] = [];

function normalise(points: LivePoint[]): LivePoint[] {
  if (points.length === 0) return EMPTY_POINTS;
  const sorted = [...points]
    .map((p) => {
      if (typeof p.t === "number" && Number.isFinite(p.t)) return p;
      const parsed = Date.parse(p.ts);
      const t = Number.isFinite(parsed) ? parsed : Date.now();
      return { ...p, t };
    })
    .sort((a, b) => a.t - b.t);

  const dedup: LivePoint[] = [];
  let lastT: number | undefined;
  for (const sample of sorted) {
    if (!Number.isFinite(sample.t)) continue;
    if (lastT === sample.t) {
      dedup[dedup.length - 1] = sample;
    } else {
      dedup.push(sample);
      lastT = sample.t;
    }
  }

  if (dedup.length === 0) return EMPTY_POINTS;

  const latest = dedup[dedup.length - 1].t;
  const cutoff = latest - MAX_WINDOW_MS;
  const clipped = dedup.filter((sample) => sample.t >= cutoff);
  if (clipped.length > MAX_POINTS) {
    return clipped.slice(-MAX_POINTS);
  }
  return clipped;
}

type TelemetryState = {
  byDevice: Record<string, Series>;
  appendMany: (deviceId: string, points: LivePoint[]) => void;
  prependMany: (deviceId: string, points: LivePoint[]) => void;
  reset: (deviceId: string, initial: LivePoint[]) => void;
  setOldest: (deviceId: string, tsMs: number) => void;
  setXDomain: (deviceId: string, domain: [number, number]) => void;
  clear: (deviceId: string) => void;
};

export const useTelemetry = create<TelemetryState>((set, get) => ({
  byDevice: {},
  appendMany: (deviceId, incoming) => {
    if (incoming.length === 0) return;
    const current = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = normalise([...current, ...incoming]);
    set((s) => ({
      byDevice: {
        ...s.byDevice,
        [deviceId]: { ...(s.byDevice[deviceId] ?? { deviceId }), deviceId, points: merged },
      },
    }));
  },
  prependMany: (deviceId, incoming) => {
    if (!incoming?.length) return;
    const current = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = normalise([...incoming, ...current]);
    set((s) => ({
      byDevice: {
        ...s.byDevice,
        [deviceId]: { ...(s.byDevice[deviceId] ?? { deviceId }), deviceId, points: merged },
      },
    }));
  },
  reset: (deviceId, initial) => {
    const clipped = normalise(initial);
    set((s) => ({
      byDevice: {
        ...s.byDevice,
        [deviceId]: { ...(s.byDevice[deviceId] ?? { deviceId }), deviceId, points: clipped },
      },
    }));
  },
  setOldest: (deviceId, tsMs) => {
    set((s) => ({
      byDevice: {
        ...s.byDevice,
        [deviceId]: { ...(s.byDevice[deviceId] ?? { deviceId }), deviceId, oldest: tsMs },
      },
    }));
  },
  setXDomain: (deviceId, domain) => {
    set((s) => ({
      byDevice: {
        ...s.byDevice,
        [deviceId]: { ...(s.byDevice[deviceId] ?? { deviceId }), deviceId, xDomain: domain },
      },
    }));
  },
  clear: (deviceId) =>
    set((s) => {
      const copy = { ...s.byDevice };
      delete copy[deviceId];
      return { byDevice: copy };
    }),
}));

export { EMPTY_POINTS };
