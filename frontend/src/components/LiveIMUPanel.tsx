import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { XYLinesChart } from "../lib/chart";
import { useTelemetry, EMPTY_POINTS, type LivePoint } from "../store/telemetry";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import { getSeries2 } from "../lib/api";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Brush } from "recharts";

type RawSample = Record<string, unknown>;

const VIEW_WINDOW_MS = 10 * 60 * 1000; // 10 minutes visible by default
const FLUSH_MS = 1_000; // apply WS points every second
const TICK_MS = 100; // slide domain every 100 ms
const BACKFILL_WINDOW_SEC = 600; // 10 minutes per backfill request
const BACKFILL_THRESHOLD_MS = 5_000; // trigger backfill when viewport nears oldest sample
const MIN_BRUSH_SPAN_MS = 10_000; // avoid zero-width selections

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

function pickShockLevel(source: RawSample): number | null {
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

function toPoint(raw: RawSample): LivePoint {
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
  const shock = pickShockLevel(merged);

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

function formatTime(value: number): string {
  try {
    return new Date(value).toLocaleTimeString("pt-BR", { hour12: false });
  } catch {
    return String(value);
  }
}

function computeBrushBounds(data: LivePoint[], domain: [number, number]) {
  if (!data.length) return { startIndex: 0, endIndex: 0 };
  const [start, end] = domain;
  let startIndex = data.findIndex((item) => item.t >= start);
  if (startIndex === -1) startIndex = 0;
  let endIndex = data.findIndex((item) => item.t > end);
  if (endIndex === -1) endIndex = data.length - 1;
  else endIndex = Math.max(startIndex, endIndex - 1);
  return { startIndex, endIndex };
}

function clampDomain(domain: [number, number]): [number, number] {
  const [start, end] = domain;
  if (end - start < MIN_BRUSH_SPAN_MS) {
    return [end - MIN_BRUSH_SPAN_MS, end];
  }
  return domain;
}

function GnssChart({
  data,
  domain,
  brushStartIndex,
  brushEndIndex,
  onBrushChange,
}: {
  data: LivePoint[];
  domain: [number, number];
  brushStartIndex: number;
  brushEndIndex: number;
  onBrushChange: (range: { startIndex?: number; endIndex?: number }) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
      <div className="mb-1 text-sm font-semibold text-slate-200">GNSS / Operacao</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="t"
            type="number"
            tickFormatter={formatTime}
            domain={domain}
            allowDataOverflow
            minTickGap={20}
            stroke="#94a3b8"
          />
          <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
          <Tooltip labelFormatter={(value) => formatTime(value as number)} />
          <Legend />
          <Line type="monotone" dot={false} isAnimationActive={false} dataKey="speed" name="Speed (km/h)" stroke="#38bdf8" />
          <Line type="monotone" dot={false} isAnimationActive={false} dataKey="cn0_avg" name="CN0 (dB-Hz)" stroke="#f97316" />
          <Line type="monotone" dot={false} isAnimationActive={false} dataKey="sats_used" name="#Sats" stroke="#22c55e" />
          <Brush
            dataKey="t"
            stroke="#38bdf8"
            travellerWidth={12}
            startIndex={brushStartIndex}
            endIndex={brushEndIndex}
            height={24}
            onChange={onBrushChange}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [isLive, setIsLive] = useState(true);
  const appendMany = useTelemetry((state) => state.appendMany);
  const reset = useTelemetry((state) => state.reset);
  const pointsRaw = useTelemetry((state) => state.byDevice[deviceId]?.points ?? EMPTY_POINTS);

  const points = useMemo<LivePoint[]>(() => {
    if (!pointsRaw.length) return EMPTY_POINTS;
    return [...pointsRaw].sort((a, b) => a.t - b.t);
  }, [pointsRaw]);

  const stagingRef = useRef<LivePoint[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);
  const brushDebounceRef = useRef<number | undefined>(undefined);
  const requestedEndsRef = useRef<Set<number>>(new Set());
  const backfillPendingRef = useRef(false);
  const lastBackfillTsRef = useRef(0);

  const [manualDomain, setManualDomain] = useState<[number, number] | null>(null);

  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      const attempt = async (bucket: { bucket: string; window_sec: number; end?: string }) => {
        const seed = await getSeries2(deviceId, bucket);
        const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
        if (!mounted) return;
        reset(deviceId, rows.map(toPoint));
      };

      try {
        await attempt({ bucket: "1s", window_sec: BACKFILL_WINDOW_SEC });
      } catch {
        try {
          await attempt({ bucket: "10s", window_sec: BACKFILL_WINDOW_SEC });
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
  }, [deviceId, reset]);

  useEffect(() => {
    return () => {
      unsubscribeLastFrame();
    };
  }, []);

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

  useEffect(() => {
    if (isLive) {
      setManualDomain(null);
    }
  }, [isLive]);

  const latestSampleTs = points.length ? points[points.length - 1].t : nowMs;
  const defaultDomain: [number, number] = [Math.max(latestSampleTs - VIEW_WINDOW_MS, latestSampleTs - VIEW_WINDOW_MS), latestSampleTs];
  const activeDomain = clampDomain(manualDomain ?? [defaultDomain[0], Math.max(nowMs, defaultDomain[1])]);

  const { startIndex: brushStartIndex, endIndex: brushEndIndex } = useMemo(
    () => computeBrushBounds(points, activeDomain),
    [points, activeDomain],
  );

  const requestBackfill = useCallback(
    async (endMs: number) => {
      if (endMs <= 0) return;
      if (backfillPendingRef.current) return;
      const now = Date.now();
      if (now - lastBackfillTsRef.current < 1_000) return;
      const bucketKey = Math.floor(endMs / 1_000);
      if (requestedEndsRef.current.has(bucketKey)) return;

      backfillPendingRef.current = true;
      lastBackfillTsRef.current = now;
      requestedEndsRef.current.add(bucketKey);

      try {
        const seed = await getSeries2(deviceId, {
          bucket: "1s",
          window_sec: BACKFILL_WINDOW_SEC,
          end: new Date(endMs).toISOString(),
        });
        const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
        if (rows.length) {
          appendMany(deviceId, rows.map(toPoint));
        }
      } catch (error) {
        console.error("[LiveIMUPanel] backfill incremental falhou", error);
      } finally {
        backfillPendingRef.current = false;
      }
    },
    [appendMany, deviceId],
  );

  const earliestTs = points.length ? points[0].t : null;
  useEffect(() => {
    if (!manualDomain || earliestTs === null) return;
    const [start] = manualDomain;
    if (start <= earliestTs + BACKFILL_THRESHOLD_MS) {
      void requestBackfill(earliestTs - 1);
    }
  }, [manualDomain, earliestTs, requestBackfill]);

  useEffect(() => {
    return () => {
      if (brushDebounceRef.current) window.clearTimeout(brushDebounceRef.current);
    };
  }, []);

  const handleBrushChange = useCallback(
    (range: { startIndex?: number; endIndex?: number }) => {
      const { startIndex, endIndex } = range;
      if (startIndex === undefined || endIndex === undefined) return;
      if (!points.length) return;
      const safeStart = Math.max(0, Math.min(startIndex, points.length - 1));
      const safeEnd = Math.max(safeStart, Math.min(endIndex, points.length - 1));
      const startPoint = points[safeStart];
      const endPoint = points[safeEnd];
      if (!startPoint || !endPoint) return;
      const nextDomain = clampDomain([startPoint.t, endPoint.t]);

      if (brushDebounceRef.current) window.clearTimeout(brushDebounceRef.current);
      brushDebounceRef.current = window.setTimeout(() => {
        setIsLive(false);
        setManualDomain(nextDomain);
      }, 150) as unknown as number;
    },
    [points],
  );

  const handleGoLive = () => {
    setIsLive(true);
    setManualDomain(null);
  };

  const handlePause = () => {
    setIsLive(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={handleGoLive} className={`px-2 py-1 rounded-2xl border border-slate-700 ${isLive ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-100 hover:bg-slate-800"}`}>
          Ao vivo
        </button>
        <button onClick={handlePause} className={`px-2 py-1 rounded-2xl border border-slate-700 ${!isLive ? "bg-sky-600 text-white" : "bg-slate-900 text-slate-100 hover:bg-slate-800"}`}>
          Pausar
        </button>
        <span className="text-xs text-slate-400">Ultimos ~10 min • {points.length} pts</span>
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
        />
      </div>

      <GnssChart
        data={points}
        domain={activeDomain}
        brushStartIndex={brushStartIndex}
        brushEndIndex={brushEndIndex}
        onBrushChange={handleBrushChange}
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
        <div className="mb-1 text-sm font-semibold text-slate-200">Barometro / Choque</div>
        <XYLinesChart
          data={points}
          lines={[
            { key: "baro", name: "Baro" },
            { key: "shock_level", name: "Shock" },
          ]}
          height={160}
          xDomain={activeDomain}
        />
      </div>
    </div>
  );
}
