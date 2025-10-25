import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EChartSeries from "./EChartSeries";
import type { LivePoint } from "../store/telemetry";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import { getSeries2 } from "../lib/api";
import { MINUTE_MS, debounce, throttle } from "../lib/timeutils";

type RawSample = Record<string, unknown>;
type LivePointT = LivePoint;

const WINDOW_MS = 10 * MINUTE_MS;
const FLUSH_MS = 1_000;
const TICK_MS = 100;
const MAX_WINDOW_MS = 60 * MINUTE_MS;
const BACKFILL_CHUNK_MS = 10 * MINUTE_MS;
const BACKFILL_THRESHOLD_MS = 30_000;

const FIELD_PATHS = {
  speed: ["speed", "gnss.speed"],
  cn0_avg: ["cn0_avg", "cn0", "gnss.cn0_avg", "gnss.cn0.p50"],
  sats_used: ["sats_used", "sats", "gnss.num_sats", "gnss.sats_used"],
  baro: ["baro", "pressure", "baro.pressure_hpa", "baro.altitude_m"],
  imu_acc_rms_x: ["imu_acc_rms_x", "imu_rms_x", "imu.acc.x.rms", "imu.linear_acc.x.rms"],
  imu_acc_rms_y: ["imu_acc_rms_y", "imu_rms_y", "imu.acc.y.rms", "imu.linear_acc.y.rms"],
  imu_acc_rms_z: ["imu_acc_rms_z", "imu_rms_z", "imu.acc.z.rms", "imu.linear_acc.z.rms"],
  imu_gyro_rms_x: ["imu_gyro_rms_x", "imu.gyro.x.rms", "imu.gyro.rms.x", "gyro_rms_x"],
  imu_gyro_rms_y: ["imu_gyro_rms_y", "imu.gyro.y.rms", "imu.gyro.rms.y", "gyro_rms_y"],
  imu_gyro_rms_z: ["imu_gyro_rms_z", "imu.gyro.z.rms", "imu.gyro.rms.z", "gyro_rms_z"],
  imu_gyro_norm: ["imu_gyro_norm", "imu.gyro.norm.rms", "imu.gyro.rms", "gyro_norm_rms"],
  imu_jerk_rms_x: ["imu_jerk_rms_x", "jerk_x", "imu.jerk.x.rms", "imu.jerk.rms.x"],
  imu_jerk_rms_y: ["imu_jerk_rms_y", "jerk_y", "imu.jerk.y.rms", "imu.jerk.rms.y"],
  imu_jerk_rms_z: ["imu_jerk_rms_z", "jerk_z", "imu.jerk.z.rms", "imu.jerk.rms.z"],
  shock_level: [
    "shock_level",
    "imu.motion.shock_score",
    "imu.motion.shock_level",
    "imu.motion.shock.score",
    "imu.shock.score",
    "shock_level_norm",
    "shock.score",
    "shock.level",
  ],
} as const;

const CARRY_FIELDS: (keyof LivePointT)[] = [
  "imu_gyro_rms_x",
  "imu_gyro_rms_y",
  "imu_gyro_rms_z",
  "shock_level",
  "baro",
];

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
  const gyroNorm = pickNumber(merged, FIELD_PATHS.imu_gyro_norm);
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
    imu_gyro_rms_x: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_x) ?? gyroNorm,
    imu_gyro_rms_y: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_y) ?? gyroNorm,
    imu_gyro_rms_z: pickNumber(merged, FIELD_PATHS.imu_gyro_rms_z) ?? gyroNorm,
    imu_jerk_rms_x: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_x),
    imu_jerk_rms_y: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_y),
    imu_jerk_rms_z: pickNumber(merged, FIELD_PATHS.imu_jerk_rms_z),
    shock_level: pickShockLevel(merged),
  };
}

function withCarry(point: LivePointT, previous?: LivePointT | null): LivePointT {
  if (!previous) return point;
  let mutated = false;
  const next: LivePointT = { ...point };
  for (const field of CARRY_FIELDS) {
    const key = field as keyof LivePointT;
    const currentValue = next[key];
    const prevValue = previous[key];
    if ((currentValue ?? null) === null && (prevValue ?? null) !== null) {
      (next as Record<string, unknown>)[key as string] = prevValue;
      mutated = true;
    }
  }
  return mutated ? next : point;
}

function carrySeries(points: LivePointT[], seed?: LivePointT | null): { series: LivePointT[]; last: LivePointT | null } {
  if (!points.length) return { series: [], last: seed ?? null };
  const out: LivePointT[] = [];
  let prev = seed ?? null;
  for (const p of points) {
    const filled = withCarry(p, prev);
    out.push(filled);
    prev = filled;
  }
  return { series: out, last: prev };
}

function normalise(points: LivePointT[]): LivePointT[] {
  if (points.length === 0) return [];
  const sorted = [...points]
    .map((p) => {
      if (typeof p.t === "number" && Number.isFinite(p.t)) return p;
      const parsed = Date.parse(p.ts);
      const t = Number.isFinite(parsed) ? parsed : Date.now();
      return { ...p, t };
    })
    .sort((a, b) => a.t - b.t);

  const dedup: LivePointT[] = [];
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

  if (dedup.length === 0) return [];

  const latest = dedup[dedup.length - 1].t;
  const cutoff = latest - MAX_WINDOW_MS;
  return dedup.filter((sample) => sample.t >= cutoff);
}

function clampDomain([start, end]: [number, number]): [number, number] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    const now = Date.now();
    return [now - WINDOW_MS, now];
  }
  if (end <= start) {
    return [end - 1_000, end + 1_000];
  }
  if (end - start > MAX_WINDOW_MS) {
    return [end - MAX_WINDOW_MS, end];
  }
  return [start, end];
}

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [series, setSeries] = useState<LivePointT[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [xDomain, setXDomain] = useState<[number, number]>(() => {
    const now = Date.now();
    return [now - WINDOW_MS, now];
  });
  const [oldestTs, setOldestTs] = useState(() => Date.now());

  const stagingRef = useRef<LivePointT[]>([]);
  const lastKnownRef = useRef<LivePointT | null>(null);
  const ignoreZoomRef = useRef(false);
  const requestedEndsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    return () => {
      unsubscribeLastFrame();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    stagingRef.current = [];
    requestedEndsRef.current.clear();
    lastKnownRef.current = null;
    setSeries([]);
    const now = Date.now();
    setIsLive(true);
    setNowMs(now);
    ignoreZoomRef.current = true;
    setXDomain(clampDomain([now - WINDOW_MS, now]));
    setOldestTs(now);

    const hydrate = async () => {
      try {
        const seed = await getSeries2(deviceId, { bucket: "1s", window_sec: BACKFILL_CHUNK_MS / 1000 });
        if (cancelled) return;
        const rows = Array.isArray(seed?.data) ? (seed.data as RawSample[]) : [];
        const mapped = rows.map(toPoint);
        const carried = carrySeries(mapped);
        const initial = normalise(carried.series);
        setSeries(initial);
        if (initial.length) {
          setOldestTs(initial[0].t);
          lastKnownRef.current = carried.last ?? initial[initial.length - 1];
        }
      } catch (error) {
        console.error("[LiveIMUPanel] backfill inicial falhou", error);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    const stop = subscribeLastFrame(deviceId, (payload: RawSample) => {
      const prev = stagingRef.current[stagingRef.current.length - 1] ?? lastKnownRef.current ?? undefined;
      const point = withCarry(toPoint(payload), prev);
      stagingRef.current.push(point);
      lastKnownRef.current = point;
    });

    return () => {
      stop();
      stagingRef.current = [];
    };
  }, [deviceId]);

  useEffect(() => {
    const flush = () => {
      if (!stagingRef.current.length) return;
      const batch = stagingRef.current.splice(0, stagingRef.current.length);
      setSeries((prev) => {
        const merged = normalise([...prev, ...batch]);
        if (merged.length) {
          setOldestTs(merged[0].t);
          lastKnownRef.current = merged[merged.length - 1];
        }
        return merged;
      });
    };

    const id = window.setInterval(flush, FLUSH_MS) as unknown as number;
    return () => {
      window.clearInterval(id);
      flush();
    };
  }, []);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS) as unknown as number;
    return () => {
      window.clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const liveDomain: [number, number] = [nowMs - WINDOW_MS, nowMs];
    ignoreZoomRef.current = true;
    setXDomain(clampDomain(liveDomain));
  }, [isLive, nowMs]);

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
          const carried = carrySeries(rows.map(toPoint));
          setSeries((prev) => {
            const merged = normalise([...carried.series, ...prev]);
            if (merged.length) {
              setOldestTs(merged[0].t);
              lastKnownRef.current = merged[merged.length - 1];
            }
            return merged;
          });
        } catch (error) {
          console.error("[LiveIMUPanel] backfill incremental falhou", error);
        }
      }, 1_000),
    [deviceId],
  );

  useEffect(() => {
    const leftEdge = xDomain[0];
    if (leftEdge - oldestTs <= BACKFILL_THRESHOLD_MS) {
      fetchBackfill(Math.max(oldestTs - 1, 0));
    }
  }, [xDomain, oldestTs, fetchBackfill]);

  const handleRangeChange = useMemo(
    () =>
      debounce((range: [number, number]) => {
        if (ignoreZoomRef.current) {
          ignoreZoomRef.current = false;
          return;
        }
        const next = clampDomain(range);
        setIsLive(false);
        setXDomain(next);
        if (next[0] - oldestTs <= BACKFILL_THRESHOLD_MS) {
          fetchBackfill(Math.max(oldestTs - 1, 0));
        }
      }, 150),
    [oldestTs, fetchBackfill],
  );

  const resumeLive = useCallback(() => {
    const now = Date.now();
    setIsLive(true);
    setNowMs(now);
    ignoreZoomRef.current = true;
    setXDomain(clampDomain([now - WINDOW_MS, now]));
  }, []);

  const pauseLive = useCallback(() => {
    setIsLive(false);
  }, []);

  const points = series;
  const activeDomain = xDomain;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={resumeLive}
          className={`px-2 py-1 rounded-2xl border ${isLive ? "border-emerald-400 bg-emerald-900/40" : "border-slate-700 bg-slate-900"} text-slate-100 hover:bg-slate-800`}
        >
          Ao vivo
        </button>
        <button
          onClick={pauseLive}
          className="px-2 py-1 rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
        >
          Pausar
        </button>
        <span className="text-xs text-slate-400">
          Janela {new Date(activeDomain[0]).toLocaleTimeString("pt-BR", { hour12: false })} -{" "}
          {new Date(activeDomain[1]).toLocaleTimeString("pt-BR", { hour12: false })}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
        <div className="mb-1 text-sm font-semibold text-slate-200">Accel RMS (g)</div>
        <EChartSeries
          id="imu-acc"
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
        <EChartSeries
          id="imu-gyro"
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
        <EChartSeries
          id="imu-jerk"
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

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
        <div className="mb-1 text-sm font-semibold text-slate-200">GNSS / Operacao</div>
        <EChartSeries
          id="imu-gnss"
          data={points}
          lines={[
            { key: "speed", name: "Speed (km/h)" },
            { key: "cn0_avg", name: "CN0 (dB-Hz)" },
            { key: "sats_used", name: "#Sats" },
          ]}
          height={160}
          xDomain={activeDomain}
        />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-lg">
        <div className="mb-1 text-sm font-semibold text-slate-200">Barometro / Choque</div>
        <EChartSeries
          id="imu-baro"
          data={points}
          lines={[
            { key: "baro", name: "Baro" },
            { key: "shock_level", name: "Shock" },
          ]}
          height={160}
          xDomain={activeDomain}
          showDataZoom
          onRangeChange={handleRangeChange}
        />
      </div>
    </div>
  );
}
