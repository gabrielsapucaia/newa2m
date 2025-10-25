import { useEffect, useRef, useState, useMemo } from "react";
import { XYLinesChart } from "../lib/chart";
import { useTelemetry, EMPTY_POINTS } from "../store/telemetry";
import type { LivePoint } from "../store/telemetry";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import { getSeries2 } from "../lib/api";

type LivePointT = LivePoint & { t: number };

function toMs(ts: any): number {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : Date.now();
}

function toPoint(r: any): LivePointT {
  const ts = r.ts ?? r.time ?? new Date().toISOString();
  return {
    ts,
    t: toMs(ts),
    speed: r.speed ?? null,
    cn0_avg: r.cn0_avg ?? r.cn0 ?? null,
    sats_used: r.sats_used ?? r.sats ?? null,
    baro: r.baro ?? r.pressure ?? null,
    imu_acc_rms_x: r.imu_acc_rms_x ?? null,
    imu_acc_rms_y: r.imu_acc_rms_y ?? null,
    imu_acc_rms_z: r.imu_acc_rms_z ?? null,
    imu_gyro_rms_x: r.imu_gyro_rms_x ?? null,
    imu_gyro_rms_y: r.imu_gyro_rms_y ?? null,
    imu_gyro_rms_z: r.imu_gyro_rms_z ?? null,
    imu_jerk_rms_x: r.imu_jerk_rms_x ?? null,
    imu_jerk_rms_y: r.imu_jerk_rms_y ?? null,
    imu_jerk_rms_z: r.imu_jerk_rms_z ?? null,
    shock_level: r.shock_level ?? null,
  };
}

const WINDOW_MS = 10 * 60 * 1000; // 10 min visíveis
const FLUSH_MS = 1 * 1000; // 1 s
const TICK_MS = 100; // deslize de eixo a cada 100 ms

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [isLive, setIsLive] = useState(true);
  const appendMany = useTelemetry((s) => s.appendMany);
  const reset = useTelemetry((s) => s.reset);
  const pointsRaw = useTelemetry((s) => s.byDevice[deviceId]?.points ?? EMPTY_POINTS);

  const points = useMemo<LivePointT[]>(() => {
    if (!pointsRaw.length) return [];
    const first = pointsRaw[0] as any;
    if (typeof first.t === "number") return pointsRaw as any;
    return pointsRaw.map((p: any) => ({ ...p, t: Date.parse(p.ts) || Date.now() }));
  }, [pointsRaw]);

  const stagingRef = useRef<LivePointT[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seed = await getSeries2(deviceId, { bucket: "1s", window_sec: 300 });
        const arr = (seed?.data ?? []).map((r: any) => toPoint(r));
        if (mounted) reset(deviceId, arr);
      } catch {
        try {
          const seed = await getSeries2(deviceId, { bucket: "10s", window_sec: 600 });
          const arr = (seed?.data ?? []).map((r: any) => toPoint(r));
          if (mounted) reset(deviceId, arr);
        } catch {}
      }
    })();
    return () => {
      mounted = false;
    };
  }, [deviceId, reset]);

  useEffect(() => {
    if (!isLive) {
      unsubscribeLastFrame();
      return;
    }
    const onMsg = (m: any) => {
      stagingRef.current.push(toPoint(m));
    };
    const stop = subscribeLastFrame(deviceId, onMsg);
    return () => {
      stop();
    };
  }, [deviceId, isLive]);

  useEffect(() => {
    const doFlush = () => {
      const batch = stagingRef.current;
      if (batch.length) {
        appendMany(deviceId, batch);
        stagingRef.current = [];
      }
    };
    if (!isLive) {
      doFlush();
      return;
    }
    flushTimer.current = window.setInterval(doFlush, FLUSH_MS) as unknown as number;
    return () => {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      doFlush();
    };
  }, [deviceId, isLive, appendMany]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const xDomain: [number, number] = [nowMs - WINDOW_MS, nowMs];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setIsLive(true)} className="px-2 py-1 rounded-2xl border shadow-sm hover:bg-gray-800">
          Ao vivo
        </button>
        <button onClick={() => setIsLive(false)} className="px-2 py-1 rounded-2xl border shadow-sm hover:bg-gray-800">
          Pausar
        </button>
        <span className="text-xs text-gray-400">Últimos ~10 min • {points.length} pts</span>
      </div>

      <div className="p-3 bg-neutral-900 rounded-2xl shadow-sm ring-1 ring-neutral-800">
        <div className="text-sm font-semibold mb-1 text-neutral-200">Accel RMS (g)</div>
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
        <div className="p-3 bg-neutral-900 rounded-2xl shadow-sm ring-1 ring-neutral-800">
          <div className="text-sm font-semibold mb-1 text-neutral-200">Gyro RMS</div>
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
        <div className="p-3 bg-neutral-900 rounded-2xl shadow-sm ring-1 ring-neutral-800">
          <div className="text-sm font-semibold mb-1 text-neutral-200">Jerk RMS</div>
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
        <div className="p-3 bg-neutral-900 rounded-2xl shadow-sm ring-1 ring-neutral-800">
          <div className="text-sm font-semibold mb-1 text-neutral-200">GNSS / Operação</div>
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
        <div className="p-3 bg-neutral-900 rounded-2xl shadow-sm ring-1 ring-neutral-800">
          <div className="text-sm font-semibold mb-1 text-neutral-200">Barômetro / Choque</div>
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
