import { useEffect, useRef, useState } from "react";
import { XYLinesChart } from "../lib/chart";
import { getSeries2 } from "../lib/api";
import { subscribeLastFrame } from "../lib/ws";
import { useTelemetry, type LivePoint, EMPTY_POINTS, LIVE_WINDOW_MS } from "../store/telemetry";

type RawSample = Record<string, unknown>;

const PRIMARY_BUCKET = { bucket: "1s", window_sec: 300 } as const;
const FALLBACK_BUCKET = { bucket: "10s", window_sec: 600 } as const;
const SLIDE_INTERVAL_MS = 500;
const FLUSH_INTERVAL_MS = 5000;

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toMillis(value: unknown): number {
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  return Date.now();
}

function readValue(source: RawSample, key: string): unknown {
  if (key in source) {
    return source[key];
  }
  return undefined;
}

function pickNumber(source: RawSample, keys: string[]): number | null {
  for (const key of keys) {
    const numeric = safeNumber(readValue(source, key));
    if (numeric !== null) return numeric;
  }
  return null;
}

function pickShockLevel(source: RawSample): number | null {
  const numeric = pickNumber(source, ["shock_level", "imu.motion.shock_score"]);
  if (numeric !== null) return numeric;
  const raw = readValue(source, "imu.motion.shock_level") ?? readValue(source, "shock_level");
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (normalized === "low") return 1;
    if (normalized === "medium") return 2;
    if (normalized === "high") return 3;
  }
  return null;
}

function mergeSource(raw: RawSample): RawSample {
  const payload = raw.payload;
  if (payload && typeof payload === "object") {
    return { ...(payload as RawSample), ...raw };
  }
  return raw;
}

function toPoint(raw: RawSample): LivePoint {
  const merged = mergeSource(raw);
  const tsValue =
    readValue(merged, "ts") ??
    readValue(merged, "timestamp") ??
    readValue(merged, "ts_epoch") ??
    readValue(merged, "gnss.ts") ??
    readValue(merged, "payload.ts");

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
  const shockLevel = pickShockLevel(merged);

  const t = toMillis(tsValue);

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
    shock_level: shockLevel,
  };
}

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [isLive, setIsLive] = useState(true);
  const pushMany = useTelemetry((state) => state.pushMany);
  const reset = useTelemetry((state) => state.reset);
  const clear = useTelemetry((state) => state.clear);
  const trimBefore = useTelemetry((state) => state.trimBefore);
  const points = useTelemetry((state) => state.byDevice[deviceId]?.points ?? EMPTY_POINTS);
  const pendingRef = useRef<LivePoint[]>([]);

  useEffect(() => {
    setIsLive(true);
    pendingRef.current = [];
    return () => {
      clear(deviceId);
      pendingRef.current = [];
    };
  }, [clear, deviceId]);

  useEffect(() => {
    let cancelled = false;

    const attempt = async (params: { bucket: string; window_sec: number }) => {
      const seed = await getSeries2(deviceId, params);
      const payload = Array.isArray(seed?.data) ? (seed?.data as RawSample[]) : [];
      const mapped = payload.map((row) => toPoint(row));
      if (!cancelled) {
        reset(deviceId, mapped);
        trimBefore(deviceId, Date.now() - LIVE_WINDOW_MS);
      }
    };

    const load = async () => {
      try {
        await attempt(PRIMARY_BUCKET);
      } catch (error) {
        try {
          await attempt(FALLBACK_BUCKET);
        } catch (fallbackError) {
          if (!cancelled) {
            reset(deviceId, []);
          }
          console.error("LiveIMUPanel backfill falhou", error, fallbackError);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [deviceId, reset, trimBefore]);

  useEffect(() => {
    if (!isLive) return;

    const tick = () => {
      const cutoff = Date.now() - LIVE_WINDOW_MS;
      trimBefore(deviceId, cutoff);
    };

    tick();
    const id = window.setInterval(tick, SLIDE_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [deviceId, isLive, trimBefore]);

  useEffect(() => {
    if (!isLive) return;

    pendingRef.current = [];

    const stop = subscribeLastFrame(deviceId, (message) => {
      pendingRef.current.push(toPoint(message as RawSample));
    });

    const flush = () => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current.splice(0, pendingRef.current.length);
      pushMany(deviceId, batch);
      trimBefore(deviceId, Date.now() - LIVE_WINDOW_MS);
    };

    const intervalId = window.setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      if (pendingRef.current.length) {
        flush();
      }
      stop();
      window.clearInterval(intervalId);
    };
  }, [deviceId, isLive, pushMany, trimBefore]);

  const liveButtonClasses = isLive
    ? "border-sky-600 bg-sky-500 text-white shadow-sm"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100";

  const pauseButtonClasses = !isLive
    ? "border-sky-600 bg-sky-500 text-white shadow-sm"
    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setIsLive(true)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${liveButtonClasses}`}
        >
          Ao vivo
        </button>
        <button
          type="button"
          onClick={() => setIsLive(false)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${pauseButtonClasses}`}
        >
          Pausar
        </button>
        <span className="text-xs text-slate-500">Ultimos ~10 min | {points.length} pts</span>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">Accel RMS (g)</div>
        <XYLinesChart
          data={points}
          xKey="t"
          lines={[
            { key: "imu_acc_rms_x", name: "Ax" },
            { key: "imu_acc_rms_y", name: "Ay" },
            { key: "imu_acc_rms_z", name: "Az" },
          ]}
          height={190}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">Gyro RMS</div>
          <XYLinesChart
            data={points}
            xKey="t"
            lines={[
              { key: "imu_gyro_rms_x", name: "Gx" },
              { key: "imu_gyro_rms_y", name: "Gy" },
              { key: "imu_gyro_rms_z", name: "Gz" },
            ]}
            height={170}
          />
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">Jerk RMS</div>
          <XYLinesChart
            data={points}
            xKey="t"
            lines={[
              { key: "imu_jerk_rms_x", name: "Jx" },
              { key: "imu_jerk_rms_y", name: "Jy" },
              { key: "imu_jerk_rms_z", name: "Jz" },
            ]}
            height={170}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">GNSS / Operacao</div>
          <XYLinesChart
            data={points}
            xKey="t"
            lines={[
              { key: "speed", name: "Speed (km/h)" },
              { key: "cn0_avg", name: "CN0 (dB-Hz)" },
              { key: "sats_used", name: "#Sats" },
            ]}
            height={170}
          />
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-700">Barometro / Choque</div>
          <XYLinesChart
            data={points}
            xKey="t"
            lines={[
              { key: "baro", name: "Baro" },
              { key: "shock_level", name: "Shock" },
            ]}
            height={170}
          />
        </div>
      </div>
    </div>
  );
}
