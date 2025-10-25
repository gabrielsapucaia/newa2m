import { MAP_LAYERS, type MapStyle } from "../lib/mapLayers";

type Props = {
  value: MapStyle;
  onChange: (style: MapStyle) => void;
  className?: string;
};

export default function MapStyleToggle({ value, onChange, className = "" }: Props) {
  return (
    <div
      className={`flex items-center gap-1 rounded border border-slate-700 bg-slate-900/90 px-2 py-1 text-xs text-slate-200 shadow ${className}`}
    >
      {Object.values(MAP_LAYERS).map((layer) => {
        const active = layer.key === value;
        return (
          <button
            key={layer.key}
            type="button"
            onClick={() => onChange(layer.key)}
            className={`rounded px-2 py-1 transition ${
              active ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {layer.name}
          </button>
        );
      })}
    </div>
  );
}
