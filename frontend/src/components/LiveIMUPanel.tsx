import { useEffect, useMemo, useRef, useState } from "react";
import { XYLinesChart } from "../lib/chart";
import TimeNavigator from "./TimeNavigator";
import { useTelemetry, type LivePoint, EMPTY_POINTS } from "../store/telemetry";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import { getSeries2 } from "../lib/api";
import { debounce, throttle, MINUTE_MS } from "../lib/timeutils";

type RawSample = Record<string, unknown>;

type LivePointT = LivePoint & { t: number };

const WINDOW_MS = 10 * MINUTE_MS; // 10 minutos visíveis
const FLUSH_MS = 1_000; // aplica lote WS a cada 1 s
const TICK_MS = 100; // deslize suave do eixo
const BACKFILL_CHUNK_MS = 10 * MINUTE_MS; // 10 min por requisição
const BACKFILL_THRESHOLD_MS = 30_000; // quando a janela encosta em 30 s do ponto mais antigo

const FIELD_PATHS = {
  speed: ["speed", "gnss.speed"],
  cn0_avg: ["cn0_avg", "cn0", "gnss.cn0_avg", "gnss.cn0.p50"],
  sats_used: ["sats_used", "sats", "gnss.num_sats", "gnss.sats_used"],
  baro: ["baro", "pressure", "baro.pressure_hpa", "baro.altitude_m"],
  imu_acc_rms_x: ["imu_acc_rms_x", "imu_rms_x", "imu.acc.x.rms", "imu.linear_acc.x.rms"],
  imu_acc_rms_y: ["imu_acc_rms_y", "imu_rms_y", "imu.acc.y.rms", "imu.linear_acc.y.rms"],
  imu_acc_rms_z: ["imu_acc_rms_z", "imu_rms_z", "imu.acc.z.rms", "imu.linear_acc.z.rms"],
  imu_gyro_rms_x: ["imu_gyro_rms_x", "imu.gyro.x.rms"],
  imu_gyro_rms_y: ["imu_gyro_rms_y", "imu.gyro.y.rms"],
  imu_gyro_rms_z: ["imu_gyro_rms_z", "imu.gyro.z.rms"],
  imu_jerk_rms_x: ["imu_jerk_rms_x", "jerk_x", "imu.jerk.x.rms"],
  imu_jerk_rms_y: ["imu_jerk_rms_y", "jerk_y", "imu.jerk.y.rms"],
  imu_jerk_rms_z: ["imu_jerk_rms_z", "jerk_z", "imu.jerk.z.rms"],
  shock_level: ["shock_level", "imu.motion.shock_score", "imu.motion.shock_level"],
};

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

function pickNumber(source: RawSample, candidates: readonly string[]): number | null {
  for (const key of candidates) {
    const value = safeNumber(readPath(source, key));
    if (value !== null) return value;
  }
  return null;
}

function pickShockLevel(source: RawSample): number | null {
  const numeric = pickNumber(source, FIELD_PATHS.shock_level);
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
    readPath(merged, "payload.ts") ??
    new Date().toISOString();

  const t = toMillis(tsCandidate);
  return {
    ts: new Date(t).toISOString(),
    t,
    speed: pickNumber(merged, FIELD_PATHS.speed),
    cn0_avg: pickNumber(merged, FIELD_PATHS.cn0_avg),
    sats_used: pickNumber(merged, FIELD_PATHS.sats_used),
    baro: pickNumber(merged, FIELD_PATHS.baro),
    imu_acc_rms_x: pickNumber(merged, FIELD_PATHS.imu_acc_rms_x),
    imu_acc_rms_y: pickNumber(merged, FIELD_PATHS.imu_acc_rms_y),
    imu_acc_rms_z: pickNumber(merged, FIELD_PATHS.imu_acc_rms_z),
    imu_gyro_rms_x: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_x),
    imu_gyro_rms_y: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_y),
    imu_gyro_rms_z: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_z),
    imu_jerk_rms_x: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_x),
    imu_jerk_rms_y: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_y),
    imu_jerk_rms_z: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_z),
    shock_level: pickShockLevel(merged),
  };
}

function clampDomain(domain: [number, number]): [number, number] {
  const [start, end] = domain;
  if (end - start < MINUTE_MS) {
    return [end - MINUTE_MS, end];
  }
  return domain;
}

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const appendMany = useTelemetry((state) => state.appendMany);
  const prependMany = useTelemetry((state) => state.prependMany);
  const reset = useTelemetry((state) => state.reset);
  const setOldest = useTelemetry((state) => state.setOldest);
  const setXDomain = useTelemetry((state) => state.setXDomain);
  const series = useTelemetry((state) => state.byDevice[deviceId]);

  const pointsRaw = series?.points ?? EMPTY_POINTS;
  const points = useMemo<LivePointT[]>(() => pointsRaw as LivePointT[], [pointsRaw]);
  const storedDomain = series?.xDomain ?? null;
  const oldestLoaded = series?.oldest ?? (points.length ? points[0].t : Date.now());

  const [isLive, setIsLive] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const liveDomain: [number, number] = [nowMs - WINDOW_MS, nowMs];
  const baseDomain = storedDomain ?? liveDomain;
  const safeXDomain: [number, number] =
    Array.isArray(baseDomain) &&
    Number.isFinite(baseDomain[0]) &&
    Number.isFinite(baseDomain[1])
      ? baseDomain
      : [Date.now() - MINUTE_MS, Date.now()];
  const activeDomain: [number, number] = clampDomain(isLive ? liveDomain : safeXDomain);

  const liveDomainRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (!isLive) return;
    const domain: [number, number] = [liveDomain[0], liveDomain[1]];
    const last = liveDomainRef.current;
    if (!last || Math.abs(domain[0] - last[0]) > 500 || Math.abs(domain[1] - last[1]) > 500) {
      liveDomainRef.current = domain;
      setXDomain(deviceId, domain);
    }
  }, [deviceId, liveDomain[0], liveDomain[1], isLive, setXDomain]);

  const stagingRef = useRef<LivePointT[]>([]);

  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      const attempt = async (params: { bucket: string; window_sec: number; end?: string }) => {
        const seed = await getSeries2(deviceId, params);
        if (!mounted) return;
        const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
        const mapped = rows.map(toPoint);
        reset(deviceId, mapped);
        if (mapped.length) {
          const oldest = Math.min(...mapped.map((p) => p.t));
          setOldest(deviceId, oldest);
          setXDomain(deviceId, liveDomain);
        }
      };

      try {
        await attempt({ bucket: "1s", window_sec: BACKFILL_CHUNK_MS / 1000 });
      } catch {
        try {
          await attempt({ bucket: "10s", window_sec: BACKFILL_CHUNK_MS / 1000 });
        } catch (error) {
          if (mounted) reset(deviceId, []);
          console.error("[LiveIMUPanel] backfill inicial falhou", error);
        }
      }
    };

    void hydrate();

    return () => {
      mounted = false;
    };
  }, [deviceId, reset, setOldest, setXDomain, liveDomain]);

  useEffect(() => {
    if (!isLive) {
      unsubscribeLastFrame();
      stagingRef.current = [];
      return;
    }

    const handleMessage = (payload: RawSample) => {
      stagingRef.current.push(toPoint(payload));
    };

    const stop = subscribeLastFrame(deviceId, handleMessage);

    return () => {
      stop();
    };
  }, [deviceId, isLive]);

  useEffect(() => {
    const flush = () => {
      if (!stagingRef.current.length) return;
      const batch = stagingRef.current.splice(0, stagingRef.current.length);
      appendMany(deviceId, batch);
    };

    const id = window.setInterval(flush, FLUSH_MS) as unknown as number;
    return () => {
      window.clearInterval(id);
      flush();
    };
  }, [deviceId, appendMany]);

  useEffect(() => {
    return () => {
      unsubscribeLastFrame();
    };
  }, []);

  const requestedEndsRef = useRef<Set<number>>(new Set());
  const fetchBackfill = useMemo(
    () =>
      throttle(async (endMs: number) => {
        const bucketKey = Math.floor(endMs / 1_000);
        if (requestedEndsRef.current.has(bucketKey)) return;
        requestedEndsRef.current.add(bucketKey);
        try {
          const seed = await getSeries2(deviceId, {
            bucket: "1s",
            window_sec: BACKFILL_CHUNK_MS / 1000,
            end: new Date(endMs).toISOString(),
          });
          const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
          if (!rows.length) return;
          const mapped = rows.map(toPoint);
          prependMany(deviceId, mapped);
          const newestOld = Math.min(...mapped.map((p) => p.t));
          setOldest(deviceId, newestOld);
        } catch (error) {
          console.error("[LiveIMUPanel] backfill incremental falhou", error);
        }
      }, 1_000),
    [deviceId, prependMany, setOldest],
  );

  useEffect(() => {
    const leftEdge = activeDomain[0];
    if (leftEdge - oldestLoaded <= BACKFILL_THRESHOLD_MS) {
      fetchBackfill(Math.max(oldestLoaded - 1, 0));
    }
  }, [activeDomain, oldestLoaded, fetchBackfill]);

  const handleBrushRange = useMemo(
    () =>
      debounce((range: [number, number]) => {
        setIsLive(false);
        setXDomain(deviceId, clampDomain(range));
      }, 150),
    [deviceId, setXDomain],
  );

  const goLive = () => {
    setIsLive(true);
    setXDomain(deviceId, liveDomain);
  };

  const pauseLive = () => {
    setIsLive(false);
  };

  const syncId = `imu-${deviceId}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={goLive} className={`px-2 py-1 rounded-2xl border border-slate-700 ${isLive ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-100 hover:bg-slate-800"}`}>
          Ao vivo
        </button>
        <button onClick={pauseLive} className={`px-2 py-1 rounded-2xl border border-slate-700 ${!isLive ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-100 hover:bg-slate-800"}`}>
          Pausar
        </button>
        <span className="text-xs text-slate-400">Janela {new Date(activeDomain[0]).toLocaleTimeString("pt-BR", { hour12: false })} ? {new Date(activeDomain[1]).toLocaleTimeString("pt-BR", { hour12: false })}</span>
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
          height={170}
          xDomain={activeDomain}
          syncId={syncId}
          syncMethod="value"
        />
      </div>

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
          xDomain={activeDomain}
          syncId={syncId}
          syncMethod="value"
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
          xDomain={activeDomain}
          syncId={syncId}
          syncMethod="value"
        />
      </div>

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
          xDomain={activeDomain}
          syncId={syncId}
          syncMethod="value"
        />
        <TimeNavigator data={points} xDomain={activeDomain} onBrush={handleBrushRange} syncId={syncId} />
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
          xDomain={activeDomain}
          syncId={syncId}
          syncMethod="value"
        />
      </div>
    </div>
  );
}



