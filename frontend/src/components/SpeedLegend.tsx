const SPEED_STOPS = [
  { label: "< 5 km/h", color: "#2563eb" },
  { label: "5 ? 40 km/h", color: "#16a34a" },
  { label: "40 ? 45 km/h", color: "#f59e0b" },
  { label: "> 45 km/h", color: "#dc2626" },
];

export default function SpeedLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded border border-slate-800 bg-slate-900/85 px-3 py-2 text-xs text-slate-200 ${className}`}>
      <div className="mb-1 font-semibold text-slate-100">Velocidade (km/h)</div>
      <ul className="space-y-1">
        {SPEED_STOPS.map((stop) => (
          <li key={stop.label} className="flex items-center gap-2">
            <span className="h-2 w-4 rounded" style={{ background: stop.color }} />
            <span>{stop.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
