import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import L from "leaflet";
import { getStats } from "../lib/api";
import type { StatsResponse } from "../types";

const baseIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DEFAULT_CENTER: [number, number] = [-10, -48];

function speedColor(speed?: number | null) {
  if (speed == null) return "gray";
  if (speed < 5) return "blue";
  if (speed < 40) return "green";
  if (speed < 45) return "gold";
  return "red";
}

export default function DeviceClusterMap() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    refetchInterval: 10000,
  });

  const devices = useMemo(() => (data as StatsResponse | undefined)?.devices ?? [], [data]);

  const markers = useMemo(() => {
    return devices.map((device, idx) => {
      // Distribui marcadores de forma determin?stica ao redor do centro
      const lat = DEFAULT_CENTER[0] + idx * 0.05;
      const lon = DEFAULT_CENTER[1] + idx * 0.05;
      return { device, position: [lat, lon] as [number, number] };
    });
  }, [devices]);

  return (
    <div className="relative h-[80vh] w-full overflow-hidden rounded border border-slate-800">
      {isLoading && (
        <div className="absolute inset-x-0 top-0 z-[999] flex justify-center bg-slate-900/70 py-2 text-xs text-slate-200">
          Carregando telemetria...
        </div>
      )}
      {isError && (
        <div className="absolute inset-0 z-[999] flex flex-col items-center justify-center gap-2 bg-slate-900/80 text-sm text-slate-200">
          <span>Falha ao carregar dispositivos.</span>
          <button onClick={() => refetch()} className="rounded bg-sky-500 px-3 py-1 text-xs text-white">
            Tentar novamente
          </button>
        </div>
      )}
      <MapContainer center={DEFAULT_CENTER} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MarkerClusterGroup chunkedLoading>
          {markers.map(({ device, position }) => (
            <Marker key={device.device_id} position={position} icon={baseIcon}>
              <Popup minWidth={220}>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{device.device_id}</div>
                  <div className="text-xs text-slate-500">?ltimo registro: {device.last_ts ?? "--"}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: speedColor(device.speed) }} />
                    <span>Speed: {device.speed != null ? `${Number(device.speed).toFixed(1)} km/h` : "--"}</span>
                  </div>
                  <Link
                    to={`/device/${encodeURIComponent(device.device_id)}`}
                    className="inline-flex text-xs text-sky-600 hover:underline"
                  >
                    Abrir dashboard
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
