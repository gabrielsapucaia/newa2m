import L, { type DivIcon } from "leaflet";
import icon2x from "leaflet/dist/images/marker-icon-2x.png";
import icon from "leaflet/dist/images/marker-icon.png";
import shadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: icon2x,
  iconUrl: icon,
  shadowUrl: shadow,
});

export function createSpeedIcon(color: string): DivIcon {
  return L.divIcon({
    className: "speed-marker",
    html: `<div style="background:${color};" class="h-4 w-4 rounded-full border border-white shadow"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function getBoundsFromPoints(points: Array<[number, number]>) {
  if (!points.length) return null;
  return L.latLngBounds(points);
}
