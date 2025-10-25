import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import L from "leaflet";
import { getStatsWithFallback, metersPerSecondToKmH } from "../lib/api";
import SpeedLegend from "./SpeedLegend";
import MapStyleToggle from "./MapStyleToggle";
import type { DeviceStatsRow, StatsResponse } from "../types";
import { MAP_LAYERS } from "../lib/mapLayers";
import { useUI } from "../store/ui";

const DEFAULT_CENTER: [number, number] = [-10, -48];
const iconCache = new Map<string, L.DivIcon>();

function getMarkerIcon(color: string) {
  if (iconCache.has(color)) {
    return iconCache.get(color)!;
  }
  const icon = L.divIcon({
    className: "device-marker",
    html: `<span style="background:${color}" class="inline-block h-3 w-3 rounded-full border border-white shadow"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  iconCache.set(color, icon);
  return icon;
}

function speedColor(speedKmH: number | null | undefined) {
  if (speedKmH == null) return "#6b7280";
  if (speedKmH < 5) return "#2563eb";
  if (speedKmH < 40) return "#16a34a";
  if (speedKmH < 45) return "#f59e0b";
  return "#dc2626";
}

export default function DeviceClusterMap() {
  const { data, isLoading, isError, refetch } = useQuery<StatsResponse>({
    queryKey: ["stats", "with-fallback"],
    queryFn: getStatsWithFallback,
    refetchInterval: 10000,
  });
  const { mapStyle, setMapStyle } = useUI();

  const devices = useMemo<DeviceStatsRow[]>(() => data?.devices ?? [], [data]);

  const enriched = useMemo(() => {
    return devices
      .map((device) => {
        const lat = device.lat ?? device.last_lat ?? null;
        const lon = device.lon ?? device.last_lon ?? null;
        if (lat == null || lon == null) {
          return null;
        }
        const speedMs = device.speed ?? device.last_speed ?? null;
        const speedKmH = speedMs != null ? metersPerSecondToKmH(speedMs) : null;
        const lastTs = device.last_ts ?? null;
        return {
          deviceId: device.device_id,
          position: [lat, lon] as [number, number],
          speedMs,
          speedKmH,
          lastTs,
        };
      })
      .filter(Boolean) as Array<{ deviceId: string; position: [number, number]; speedMs: number | null; speedKmH: number | null; lastTs: string | null }>;
  }, [devices]);

  const center = enriched[0]?.position ?? DEFAULT_CENTER;
  const layer = MAP_LAYERS[mapStyle];

  return (
    <div className="relative h-[80vh] w-full overflow-hidden rounded border border-slate-800 bg-slate-900/80">
      {isLoading && (
        <div className="absolute inset-x-0 top-0 z-[999] flex justify-center bg-slate-900/70 py-2 text-xs text-slate-200">
          Carregando telemetria...
        </div>
      )}
      {isError && (
        <div className="absolute inset-0 z-[999] flex flex-col items-center justify-center gap-2 bg-slate-900/80 text-sm text-slate-200">
          <span>Falha ao carregar dispositivos.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded bg-sky-500 px-3 py-1 text-xs text-white hover:bg-sky-600"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <MapContainer center={center} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer key={layer.key} attribution={layer.attribution} url={layer.url} />
        <MarkerClusterGroup chunkedLoading>
          {enriched.map(({ deviceId, position, speedMs, speedKmH, lastTs }) => {
            const icon = getMarkerIcon(speedColor(speedKmH));
            return (
              <Marker key={deviceId} position={position} icon={icon}>
                <Popup minWidth={220}>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{deviceId}</div>
                    <div className="text-xs text-slate-500">Ultimo registro: {lastTs ?? "--"}</div>
                    <div className="text-xs text-slate-500">
                      Speed: {speedMs != null && speedKmH != null ? `${speedKmH.toFixed(1)} km/h` : "--"}
                    </div>
                    <Link
                      to={`/device/${encodeURIComponent(deviceId)}`}
                      className="inline-flex text-xs text-sky-600 hover:underline"
                    >
                      Abrir dashboard
                    </Link>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      <SpeedLegend className="absolute bottom-3 right-3" />
      <MapStyleToggle value={mapStyle} onChange={setMapStyle} className="absolute top-3 right-3 z-[1000]" />
    </div>
  );
}
