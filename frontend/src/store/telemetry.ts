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
  push: (deviceId: string, p: LivePoint) => void;
  reset: (deviceId: string, initial: LivePoint[]) => void;
  get: (deviceId: string) => LivePoint[];
  clear: (deviceId: string) => void;
};

export const useTelemetry = create<TelemetryState>((set, get) => ({
  byDevice: {},
  push: (deviceId, p) => {
    const cur = get().byDevice[deviceId]?.points ?? EMPTY_POINTS;
    const nxt = [...cur, p].slice(-MAX_POINTS);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: nxt } } }));
  },
  reset: (deviceId, initial) => {
    const clipped = [...initial].slice(-MAX_POINTS);
    set((s) => ({ byDevice: { ...s.byDevice, [deviceId]: { deviceId, points: clipped } } }));
  },
  get: (deviceId) => get().byDevice[deviceId]?.points ?? EMPTY_POINTS,
  clear: (deviceId) =>
    set((s) => {
      const c = { ...s.byDevice };
      delete c[deviceId];
      return { byDevice: c };
    }),
}));

export { EMPTY_POINTS };
