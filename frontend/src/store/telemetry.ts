import { create } from "zustand";

export type LivePoint = {
  ts: string; // ISO
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
    const cur = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const merged = [...cur, ...incoming];
    const clipped = merged.slice(-MAX_POINTS);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  reset: (deviceId, initial) => {
    const clipped = [...initial].slice(-MAX_POINTS);
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
