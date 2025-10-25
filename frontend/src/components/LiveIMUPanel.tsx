import { useEffect, useMemo, useRef, useState } from "react";
import { XYLinesChart } from "../lib/chart";
import { useTelemetry, EMPTY_POINTS } from "../store/telemetry";
import type { LivePoint } from "../store/telemetry";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import { getSeries2 } from "../lib/api";

type RawSample = Record<string, unknown>;
type LivePointT = LivePoint & { t: number };

const WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const FLUSH_MS = 1_000; // 1 segundo
const TICK_MS = 100; // domínio desliza a cada 100 ms

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readPath(source: RawSample, path: string): unknown {
  if (!path) return undefined;
  if (path in source) return (source as Record<string, unknown>)[path];
  if (!path.includes(".")) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function mergePayload(raw: RawSample): RawSample {
  const payload = raw.payload;
  if (payload && typeof payload === "object") {
    return { ...(payload as RawSample), ...raw };
  }
  return raw;
}

function pickNumber(source: RawSample, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = safeNumber(readPath(source, key));
    if (value !== null) return value;
  }
  return null;
}

function pickShock(source: RawSample): number | null {
  const numeric = pickNumber(source, ["shock_level", "imu.motion.shock_score"]);
  if (numeric !== null) return numeric;
  const raw = readPath(source, "imu.motion.shock_level") ?? readPath(source, "shock_level");
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (normalized === "low") return 1;
    if (normalized === "medium") return 2;
    if (normalized === "high") return 3;
  }
  return null;
}

function toMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function toPoint(raw: RawSample): LivePointT {
  const merged = mergePayload(raw);
  const tsCandidate =
    readPath(merged, "ts") ??
    readPath(merged, "timestamp") ??
    readPath(merged, "ts_epoch") ??
    readPath(merged, "gnss.ts") ??
    readPath(merged, "payload.ts");

  const t = toMillis(tsCandidate);
  const speedMs = pickNumber(merged, ["speed", "gnss.speed"]);
  const cn0 = pickNumber(merged, ["cn0_avg", "cn0", "gnss.cn0_avg", "gnss.cn0.p50"]);
  const sats = pickNumber(merged, ["sats_used", "sats", "gnss.num_sats", "gnss.sats_used"]);
  const baro = pickNumber(merged, ["baro", "pressure", "baro.pressure_hpa", "baro.altitude_m"]);
  const accX = pickNumber(merged, ["imu_acc_rms_x", "imu_rms_x", "imu.acc.x.rms", "imu.linear_acc.x.rms"]);
  const accY = pickNumber(merged, ["imu_acc_rms_y", "imu_rms_y", "imu.acc.y.rms", "imu.linear_acc.y.rms"]);
  const accZ = pickNumber(merged, ["imu_acc_rms_z", "imu_rms_z", "imu.acc.z.rms", "imu.linear_acc.z.rms"]);
  const gyroX = pickNumber(merged, ["imu_gyro_rms_x", "imu.gyro.x.rms"]);
  const gyroY = pickNumber(merged, ["imu_gyro_rms_y", "imu.gyro.y.rms"]);
  const gyroZ = pickNumber(merged, ["imu_gyro_rms_z", "imu.gyro.z.rms"]);
  const jerkX = pickNumber(merged, ["imu_jerk_rms_x", "jerk_x", "imu.jerk.x.rms"]);
  const jerkY = pickNumber(merged, ["imu_jerk_rms_y", "jerk_y", "imu.jerk.y.rms"]);
  const jerkZ = pickNumber(merged, ["imu_jerk_rms_z", "jerk_z", "imu.jerk.z.rms"]);
  const shock = pickShock(merged);

  return {
    ts: new Date(t).toISOString(),
    t,
    speed: speedMs !== null ? Number((speedMs * 3.6).toFixed(3)) : null,
    cn0_avg: cn0,
    sats_used: sats,
    baro,
    imu_acc_rms_x: accX,
    imu_acc_rms_y: accY,
    imu_acc_rms_z: accZ,
    imu_gyro_rms_x: gyroX,
    imu_gyro_rms_y: gyroY,
    imu_gyro_rms_z: gyroZ,
    imu_jerk_rms_x: jerkX,
    imu_jerk_rms_y: jerkY,
    imu_jerk_rms_z: jerkZ,
    shock_level: shock,
  };
}

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [isLive, setIsLive] = useState(true);
  const appendMany = useTelemetry((s) => s.appendMany);
  const reset = useTelemetry((s) => s.reset);
  const pointsRaw = useTelemetry((s) => s.byDevice[deviceId]?.points ?? EMPTY_POINTS);

  const points = useMemo<LivePointT[]>(() => {
    if (!pointsRaw.length) return [];
    return pointsRaw
      .map((p) => {
        const candidate = p as LivePointT;
        if (typeof candidate.t === "number") return candidate;
        const t = toMillis(p.ts);
        return { ...p, t };
      })
      .sort((a, b) => a.t - b.t);
  }, [pointsRaw]);

  const stagingRef = useRef<LivePointT[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      const attempt = async (bucket: { bucket: string; window_sec: number }) => {
        const seed = await getSeries2(deviceId, bucket);
        const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
        const mapped = rows.map((row) => toPoint(row));
        if (mounted) reset(deviceId, mapped);
      };
      try {
        await attempt({ bucket: "1s", window_sec: 300 });
      } catch {
        try {
          await attempt({ bucket: "10s", window_sec: 600 });
        } catch (error) {
          if (mounted) reset(deviceId, []);
          console.error("[LiveIMUPanel] backfill falhou", error);
        }
      }
    };
    void hydrate();
    return () => {
      mounted = false;
    };
  }, [deviceId, reset]);

  useEffect(() => {
    if (!isLive) {
      unsubscribeLastFrame();
      stagingRef.current = [];
      return;
    }
    const onMessage = (payload: RawSample) => {
      stagingRef.current.push(toPoint(payload));
    };
    const stop = subscribeLastFrame(deviceId, onMessage);
    return () => {
      stop();
      stagingRef.current = [];
    };
  }, [deviceId, isLive]);

  useEffect(() => {
    const flush = () => {
      if (!stagingRef.current.length) return;
      const batch = stagingRef.current.splice(0, stagingRef.current.length);
      appendMany(deviceId, batch);
    };

    if (!isLive) {
      flush();
      return;
    }

    flushTimer.current = window.setInterval(flush, FLUSH_MS) as unknown as number;

    return () => {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      flush();
    };
  }, [deviceId, isLive, appendMany]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const xDomain: [number, number] = [nowMs - WINDOW_MS, nowMs];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setIsLive(true)} className="px-2 py-1 rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-sm hover:bg-slate-800">
          Ao vivo
        </button>
        <button onClick={() => setIsLive(false)} className="px-2 py-1 rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-sm hover:bg-slate-800">
          Pausar
        </button>
        <span className="text-xs text-slate-400">Últimos ~10 min • {points.length} pts</span>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
        <div className="mb-1 text-sm font-semibold text-slate-200">Accel RMS (g)</div>
        <XYLinesChart
          data={points}
          lines={[
            { key: "imu_acc_rms_x", name: "Ax" },
            { key: "imu_acc_rms_y", name: "Ay" },
            { key: "imu_acc_rms_z", name: "Az" },
          ]}
          height={180}
          xDomain={xDomain}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
          <div className="mb-1 text-sm font-semibold text-slate-200">Gyro RMS</div>
          <XYLinesChart
            data={points}
            lines={[
              { key: "imu_gyro_rms_x", name: "Gx" },
              { key: "imu_gyro_rms_y", name: "Gy" },
              { key: "imu_gyro_rms_z", name: "Gz" },
            ]}
            height={160}
            xDomain={xDomain}
          />
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
          <div className="mb-1 text-sm font-semibold text-slate-200">Jerk RMS</div>
          <XYLinesChart
            data={points}
            lines={[
              { key: "imu_jerk_rms_x", name: "Jx" },
              { key: "imu_jerk_rms_y", name: "Jy" },
              { key: "imu_jerk_rms_z", name: "Jz" },
            ]}
            height={160}
            xDomain={xDomain}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
          <div className="mb-1 text-sm font-semibold text-slate-200">GNSS / Operação</div>
          <XYLinesChart
            data={points}
            lines={[
              { key: "speed", name: "Speed (km/h)" },
              { key: "cn0_avg", name: "CN0 (dB-Hz)" },
              { key: "sats_used", name: "#Sats" },
            ]}
            height={160}
            xDomain={xDomain}
          />
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
          <div className="mb-1 text-sm font-semibold text-slate-200">Barômetro / Choque</div>
          <XYLinesChart
            data={points}
            lines={[
              { key: "baro", name: "Baro" },
              { key: "shock_level", name: "Shock" },
            ]}
            height={160}
            xDomain={xDomain}
          />
        </div>
      </div>
    </div>
  );
}
