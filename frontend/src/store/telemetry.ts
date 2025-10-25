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

const BUFFER_MS = 60 * 60 * 1000; // 60 minutos
const MAX_POINTS = Math.ceil(BUFFER_MS / 1000) + 600; // margem para lotes irregulares
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
  const cutoff = latest - BUFFER_MS;
  const clipped = dedup.filter((sample) => sample.t >= cutoff);
  if (clipped.length > MAX_POINTS) {
    return clipped.slice(-MAX_POINTS);
  }
  return clipped;
}

type TelemetryState = {
  byDevice: Record<string, Series>;
  appendMany: (deviceId: string, points: LivePoint[]) => void;
  reset: (deviceId: string, initial: LivePoint[]) => void;
  clear: (deviceId: string) => void;
};

export const useTelemetry = create<TelemetryState>((set, get) => ({
  byDevice: {},
  appendMany: (deviceId, incoming) => {
    if (incoming.length === 0) return;
    const current = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = normalise([...current, ...incoming]);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: merged } } }));
  },
  reset: (deviceId, initial) => {
    const clipped = normalise(initial);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  clear: (deviceId) =>
    set((s) => {
      const copy = { ...s.byDevice };
      delete copy[deviceId];
      return { byDevice: copy };
    }),
}));

export { EMPTY_POINTS };
