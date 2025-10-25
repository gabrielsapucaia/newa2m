import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLngTuple, Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import { getSeries2, metersPerSecondToKmH } from "../lib/api";
import { subscribeLastFrame, unsubscribeLastFrame } from "../lib/ws";
import SpeedLegend from "./SpeedLegend";
import MapStyleToggle from "./MapStyleToggle";
import { useUI } from "../store/ui";
import { MAP_LAYERS } from "../lib/mapLayers";

import "leaflet/dist/leaflet.css";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DEFAULT_CENTER: LatLngTuple = [-10, -48];
const MAX_POINTS = 20000;

type Pt = { ts: string; lat: number; lon: number; speed?: number | null };

type Series2Response = {
  data?: Array<Record<string, unknown>>;
};

function pointKey(point: Pt) {
  return `${point.ts}-${point.lat}-${point.lon}`;
}

function FitBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p[0], p[1]]));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [points, map]);
  return null;
}

function speedColor(speed?: number | null) {
  if (speed == null) return "#808080";
  if (speed < 5) return "#2563eb";
  if (speed < 40) return "#16a34a";
  if (speed < 45) return "#f59e0b";
  return "#dc2626";
}

function parseSeries(series?: Array<Record<string, unknown>>): Pt[] {
  if (!series) return [];
  return series
    .map((item) => ({
      ts: String(item.ts ?? new Date().toISOString()),
      lat: Number(item.lat),
      lon: Number(item.lon),
      speed: item.speed != null ? Number(item.speed) : null,
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

export default function MapTrack({ deviceId }: { deviceId: string }) {
  const [points, setPoints] = useState<Pt[]>([]);
  const [livePoint, setLivePoint] = useState<Pt | null>(null);
  const loadingRef = useRef(false);
  const markerRef = useRef<LeafletMarker | null>(null);
  const animRef = useRef<number | null>(null);
  const { liveMode: isLive, mapStyle, setMapStyle } = useUI();

  useEffect(() => {
    let cancelled = false;
    const fetchInitial = async () => {
      loadingRef.current = true;
      try {
        const resp = (await getSeries2(deviceId, { bucket: "10s", window_sec: 1800 })) as Series2Response;
        if (cancelled) return;
        const parsed = parseSeries(resp?.data);
        setPoints(parsed);
      } catch (error) {
        console.error("Erro ao carregar series", error);
      } finally {
        loadingRef.current = false;
      }
    };

    fetchInitial();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (isLive) {
      setPoints([]);
    }
  }, [isLive]);

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const resp = (await getSeries2(deviceId, { bucket: "10s", window_sec: 1800 })) as Series2Response;
        if (cancelled) return;
        const parsed = parseSeries(resp?.data);
        setPoints((prev) => {
          const merged = new Map<string, Pt>();
          [...prev, ...parsed].forEach((pt) => {
            merged.set(pointKey(pt), pt);
          });
          return Array.from(merged.values())
            .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
            .slice(-MAX_POINTS);
        });
      } catch (error) {
        console.error("Erro ao atualizar serie ao vivo", error);
      }
    };

    const interval = window.setInterval(refresh, 10000);
    void refresh();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deviceId, isLive]);


  useEffect(() => {
    if (!isLive) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      unsubscribeLastFrame();
      return () => {
        if (animRef.current) cancelAnimationFrame(animRef.current);
        unsubscribeLastFrame();
      };
    }

    function handle(message: unknown) {
      const payload = message as Record<string, unknown>;
      const lat = payload?.lat != null ? Number(payload.lat) : null;
      const lon = payload?.lon != null ? Number(payload.lon) : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const point: Pt = {
        ts: String(payload.ts ?? new Date().toISOString()),
        lat: lat as number,
        lon: lon as number,
        speed: payload.speed != null ? Number(payload.speed) : null,
      };
      setLivePoint(point);
      setPoints((prev) => [...prev, point].slice(-MAX_POINTS));

      const marker = markerRef.current;
      if (marker) {
        const start = marker.getLatLng();
        const end = L.latLng(point.lat, point.lon);
        const duration = 1200;
        const startTime = performance.now();
        if (animRef.current) cancelAnimationFrame(animRef.current);

        const step = (time: number) => {
          const progress = Math.min(1, (time - startTime) / duration);
          const latInterpolated = start.lat + (end.lat - start.lat) * progress;
          const lngInterpolated = start.lng + (end.lng - start.lng) * progress;
          marker.setLatLng([latInterpolated, lngInterpolated]);
          if (progress < 1) {
            animRef.current = requestAnimationFrame(step);
          }
        };
        animRef.current = requestAnimationFrame(step);
      }
    }

    if (!isLive) {
      return () => {
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }

    subscribeLastFrame(deviceId, handle);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      unsubscribeLastFrame();
    };
  }, [deviceId, isLive]);

  const polylinePoints: LatLngTuple[] = useMemo(
    () => points.map((pt) => [pt.lat, pt.lon] as LatLngTuple),
    [points],
  );

  const segments = useMemo(() => {
    const segs: Array<{ positions: [LatLngTuple, LatLngTuple]; color: string }> = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      segs.push({
        positions: [
          [a.lat, a.lon] as LatLngTuple,
          [b.lat, b.lon] as LatLngTuple,
        ],
        color: speedColor(b.speed ?? a.speed ?? null),
      });
    }
    return segs;
  }, [points]);

  const latestPoint: LatLngTuple = useMemo(() => {
    if (isLive && livePoint) return [livePoint.lat, livePoint.lon];
    if (polylinePoints.length > 0) return polylinePoints[polylinePoints.length - 1];
    return DEFAULT_CENTER;
  }, [isLive, livePoint, polylinePoints]);

  const recentPoints = useMemo(() => {
    const seen = new Set<string>();
    const unique: Pt[] = [];
    for (let i = points.length - 1; i >= 0 && unique.length < 100; i -= 1) {
      const pt = points[i];
      const key = `${pt.ts}|${pt.lat}|${pt.lon}`;
      if (!seen.has(key)) {
        unique.push(pt);
        seen.add(key);
      }
    }
    return unique;
  }, [points]);

  const layer = MAP_LAYERS[mapStyle];

  return (
    <div className="space-y-3">
      <div className="relative h-[70vh] w-full overflow-hidden rounded border border-slate-800 bg-slate-900/80">
        <MapContainer center={latestPoint} zoom={13} scrollWheelZoom className="h-full w-full">
          <TileLayer key={layer.key} attribution={layer.attribution} url={layer.url} />
          {polylinePoints.length > 0 && <FitBounds points={polylinePoints} />}
          {segments.map((segment, index) => (
            <Polyline
              key={`${segment.positions[0][0]}-${segment.positions[0][1]}-${index}`}
              positions={segment.positions}
              pathOptions={{ color: segment.color, weight: 3 }}
            />
          ))}
          <Marker
            position={latestPoint}
            icon={markerIcon}
            ref={(instance) => {
              markerRef.current = instance ?? null;
            }}
          />
        </MapContainer>

        <div className="absolute top-2 left-2 z-[1000] flex items-center gap-2 rounded bg-slate-900/80 px-3 py-1 text-xs text-slate-200 shadow">
          {isLive && livePoint?.speed != null && (
            <span>Speed: {metersPerSecondToKmH(livePoint.speed ?? 0).toFixed(1)} km/h</span>
          )}
        </div>

        {!isLive && (
          <div className="absolute top-14 right-2 z-[1000] rounded bg-amber-500/80 px-3 py-1 text-xs font-semibold text-slate-900 shadow">
            Ao vivo pausado
          </div>
        )}

        <SpeedLegend className="absolute bottom-3 right-3" />
        <MapStyleToggle value={mapStyle} onChange={setMapStyle} className="absolute top-2 right-2 z-[1000]" />
      </div>

      <div className="h-48 overflow-y-auto rounded border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
        <div className="mb-2 flex items-center justify-between text-slate-400">
          <span>Historico recente (max 100 pontos)</span>
          <span>Total armazenado: {points.length}</span>
        </div>
        {recentPoints.length === 0 ? (
          <p className="text-slate-500">Nenhum ponto carregado ainda.</p>
        ) : (
          <ul className="space-y-1">
            {recentPoints.map((point, index) => {
              const kmh = metersPerSecondToKmH(point.speed ?? 0);
              return (
                <li
                  key={`${point.ts}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-1 last:border-b-0"
                >
                  <span className="font-mono text-slate-400">{new Date(point.ts).toLocaleString()}</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: speedColor(point.speed ?? null) }}
                      />
                      <span>{kmh.toFixed(1)} km/h</span>
                    </span>
                    <span className="font-mono text-slate-500">
                      {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
