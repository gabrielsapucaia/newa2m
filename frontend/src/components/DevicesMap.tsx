import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { Map } from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import type { DeviceLastPoint } from "../types";
import { createSpeedIcon, getBoundsFromPoints } from "../lib/map";
import { getSpeedColor, metersPerSecondToKmH } from "../lib/api";

interface DevicesMapProps {
  devices: DeviceLastPoint[];
  isLoading?: boolean;
  lastUpdated?: string;
}

const DEFAULT_CENTER: [number, number] = [-14.235, -51.9253];

const DevicesMap = ({ devices, isLoading, lastUpdated }: DevicesMapProps) => {
  const mapRef = useRef<Map | null>(null);

  const markers = useMemo(() => {
    return devices
      .filter((device) => device.lat !== null && device.lon !== null)
      .map((device) => {
        const position: [number, number] = [device.lat ?? 0, device.lon ?? 0];
        const speedColor = getSpeedColor(device.speed ?? 0);
        return {
          device,
          position,
          icon: createSpeedIcon(speedColor),
          speedKmH: metersPerSecondToKmH(device.speed ?? 0),
        };
      });
  }, [devices]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markers.length === 0) return;
    const bounds = getBoundsFromPoints(markers.map((marker) => marker.position));
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [markers]);

  const center = markers[0]?.position ?? DEFAULT_CENTER;

  return (
    <div className="relative h-full w-full">
      {isLoading && (
        <div className="absolute inset-x-0 top-0 z-[999] flex justify-center p-2 text-xs text-slate-300">
          Atualizando telemetria...
        </div>
      )}
      <MapContainer
        center={center}
        zoom={5}
        className="h-full w-full"
        ref={(mapInstance) => {
          if (mapInstance) {
            mapRef.current = mapInstance;
          }
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MarkerClusterGroup chunkedLoading>
          {markers.map(({ device, position, icon, speedKmH }) => (
            <Marker key={device.device_id} position={position} icon={icon}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{device.device_id}</div>
                  <div>Velocidade: {speedKmH.toFixed(1)} km/h</div>
                  <div>Sat&eacute;lites: {device.sats_used ?? "-"}</div>
                  <div>Atualizado: {new Date(device.ts).toLocaleString()}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
      {lastUpdated && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
          Ultima atualizacao: {lastUpdated}
        </div>
      )}
    </div>
  );
};

export default DevicesMap;
