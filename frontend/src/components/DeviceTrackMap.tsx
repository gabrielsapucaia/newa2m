import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { DeviceLastPoint, SeriesPoint, TelemetryMode } from "../types";
import { createSpeedIcon, getBoundsFromPoints } from "../lib/map";
import { getSpeedColor, metersPerSecondToKmH } from "../lib/api";
import { useAnimatedPosition } from "../hooks/useAnimatedPosition";

interface DeviceTrackMapProps {
  currentPoint: DeviceLastPoint | null;
  history: SeriesPoint[];
  mode: TelemetryMode;
  isLoadingHistory?: boolean;
}

const DEFAULT_CENTER: [number, number] = [-14.235, -51.9253];

const MapReady = ({ onReady }: { onReady: (map: Map) => void }) => {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
};

const DeviceTrackMap = ({ currentPoint, history, mode, isLoadingHistory }: DeviceTrackMapProps) => {
  const mapRef = useRef<Map | null>(null);

  const historyPositions = useMemo<[number, number][]>(() => {
    return history
      .filter((point) => point.lat !== null && point.lon !== null)
      .map((point) => [point.lat ?? 0, point.lon ?? 0] as [number, number]);
  }, [history]);

  const hasCurrentPoint = Boolean(currentPoint && currentPoint.lat !== null && currentPoint.lon !== null);
  const currentPosition = hasCurrentPoint
    ? ([currentPoint!.lat ?? 0, currentPoint!.lon ?? 0] as [number, number])
    : null;

  const animatedPosition = useAnimatedPosition(currentPosition, 800);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: [number, number][] =
      mode === "history" && historyPositions.length > 0
        ? historyPositions
        : currentPosition
        ? [currentPosition]
        : [];
    if (points.length === 0) return;
    const bounds = getBoundsFromPoints(points);
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [historyPositions, currentPosition, mode]);

  const mapCenter: [number, number] = currentPosition ?? historyPositions[0] ?? DEFAULT_CENTER;
  const markerIcon = createSpeedIcon(getSpeedColor(currentPoint?.speed ?? 0));
  const markerSpeed = metersPerSecondToKmH(currentPoint?.speed ?? 0);
  const handleMapReady = useCallback((map: Map) => {
    mapRef.current = map;
  }, []);

  return (
    <div className="relative h-full w-full">
      {mode === "history" && isLoadingHistory && (
        <div className="absolute inset-x-0 top-0 z-[999] flex justify-center p-2 text-xs text-slate-300">
          Carregando trajetoria...
        </div>
      )}
      <MapContainer center={mapCenter} zoom={13} className="h-full w-full">
        <MapReady onReady={handleMapReady} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {historyPositions.length > 1 && (
          <Polyline positions={historyPositions} pathOptions={{ color: "#38bdf8", weight: 3, opacity: 0.7 }} />
        )}
        {animatedPosition && (
          <Marker position={animatedPosition} icon={markerIcon}>
            <Popup>
              <div className="space-y-1 text-sm">
                <div className="font-semibold">Posicao ao vivo</div>
                <div>Velocidade: {markerSpeed.toFixed(1)} km/h</div>
                <div>Sat&eacute;lites: {currentPoint?.sats_used ?? "-"}</div>
                <div>Atualizado: {currentPoint ? new Date(currentPoint.ts).toLocaleString() : "-"}</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default DeviceTrackMap;
