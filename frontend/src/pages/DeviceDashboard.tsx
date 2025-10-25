import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import MapTrack from "../components/MapTrack";

export default function DeviceDashboard() {
  const { id } = useParams<{ id: string }>();
  const [liveMode, setLiveMode] = useState(true);

  if (!id) {
    return <div className="p-4 text-sm text-slate-500">Device não informado</div>;
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-sky-600 hover:underline">
          ← Voltar
        </Link>
        <h2 className="text-lg font-semibold text-slate-100">Device: {id}</h2>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden md:inline">Modo:</span>
          <button
            type="button"
            onClick={() => setLiveMode(true)}
            className={`rounded px-3 py-1 ${
              liveMode ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Ao vivo
          </button>
          <button
            type="button"
            onClick={() => setLiveMode(false)}
            className={`rounded px-3 py-1 ${
              !liveMode ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Histórico
          </button>
        </div>
      </div>

      <MapTrack deviceId={id} liveMode={liveMode} />
    </div>
  );
}
