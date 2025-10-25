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

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const FLUSH_MS = 5 * 1000; // 5 s
const TICK_MS = 500; // deslize da janela a cada 500 ms

export default function LiveIMUPanel({ deviceId }: { deviceId: string }) {
  const [isLive, setIsLive] = useState(true);
  const appendMany = useTelemetry((s) => s.appendMany);
  const reset = useTelemetry((s) => s.reset);
  const pointsRaw = useTelemetry((s) => s.byDevice[deviceId]?.points ?? EMPTY_POINTS);

  // adapt points para incluir 't' caso ainda n?o tenha (compat)
  const points = useMemo<LivePointT[]>(() => {
    if (!pointsRaw.length) return [];
    const first = pointsRaw[0] as any;
    if (typeof first.t === "number") return pointsRaw as any;
    return pointsRaw.map((p: any) => ({ ...p, t: Date.parse(p.ts) || Date.now() }));
  }, [pointsRaw]);

  // buffer de est?gio (recebe 1 Hz do WS; flush em lote)
  const stagingRef = useRef<LivePointT[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);

  // backfill inicial
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

  // WS: acumula em stagingRef (1 Hz)
  useEffect(() => {
    if (!isLive) {
      unsubscribeLastFrame();
      return;
    }
    function onMsg(m: any) {
      stagingRef.current.push(toPoint(m));
    }
    subscribeLastFrame(deviceId, onMsg);
    return () => {
      unsubscribeLastFrame();
    };
  }, [deviceId, isLive]);

  // Flush em lote a cada 5 s
  useEffect(() => {
    if (!isLive) {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      flushTimer.current = undefined;
      return;
    }
    flushTimer.current = window.setInterval(() => {
      const batch = stagingRef.current;
      if (batch.length) {
        appendMany(deviceId, batch);
        stagingRef.current = [];
      }
    }, FLUSH_MS) as unknown as number;

    return () => {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
      flushTimer.current = undefined;
    };
  }, [deviceId, isLive, appendMany]);

  // "deslizamento" da janela: atualiza apenas o dom?nio de X
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const xDomain: [number, number] = [nowMs - WINDOW_MS, nowMs];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setIsLive(true)} className="px-2 py-1 rounded-2xl border shadow-sm hover:bg-gray-50">
          Ao vivo
        </button>
        <button onClick={() => setIsLive(false)} className="px-2 py-1 rounded-2xl border shadow-sm hover:bg-gray-50">
          Pausar
        </button>
        <span className="text-xs text-gray-600">?ltimos ~10 min ? {points.length} pts</span>
      </div>

      <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
        <div className="text-sm font-semibold mb-1">Accel RMS (g)</div>
        <XYLinesChart
          data={points}
          xDomain={xDomain}
          lines={[
            { key: "imu_acc_rms_x", name: "Ax" },
            { key: "imu_acc_rms_y", name: "Ay" },
            { key: "imu_acc_rms_z", name: "Az" },
          ]}
          height={180}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
          <div className="text-sm font-semibold mb-1">Gyro RMS</div>
          <XYLinesChart
            data={points}
            xDomain={xDomain}
            lines={[
              { key: "imu_gyro_rms_x", name: "Gx" },
              { key: "imu_gyro_rms_y", name: "Gy" },
              { key: "imu_gyro_rms_z", name: "Gz" },
            ]}
            height={160}
          />
        </div>
        <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
          <div className="text-sm font-semibold mb-1">Jerk RMS</div>
          <XYLinesChart
            data={points}
            xDomain={xDomain}
            lines={[
              { key: "imu_jerk_rms_x", name: "Jx" },
              { key: "imu_jerk_rms_y", name: "Jy" },
              { key: "imu_jerk_rms_z", name: "Jz" },
            ]}
            height={160}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
          <div className="text-sm font-semibold mb-1">GNSS / Opera??o</div>
          <XYLinesChart
            data={points}
            xDomain={xDomain}
            lines={[
              { key: "speed", name: "Speed (km/h)" },
              { key: "cn0_avg", name: "CN0 (dB-Hz)" },
              { key: "sats_used", name: "#Sats" },
            ]}
            height={160}
          />
        </div>
        <div className="p-3 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
          <div className="text-sm font-semibold mb-1">Bar?metro / Choque</div>
          <XYLinesChart
            data={points}
            xDomain={xDomain}
            lines={[
              { key: "baro", name: "Baro" },
              { key: "shock_level", name: "Shock" },
            ]}
            height={160}
          />
        </div>
      </div>

      {/* Aplicar dom?nio de X via CSS trick: usamos style var e um observer? N?o necess?rio.
         Como o LineChart l? o XAxis do adapter, e ele usa domain auto,
         definimos domain global pelo rel?gio: re-render a cada 500ms d? a sensa??o de deslizamento.
         (Recharts refaz eixos; como n?o h? anima??o em linhas, ? est?vel.)
      */}
      <style>{`:root{--panel-bg:#fff}`}</style>
    </div>
  );
}
