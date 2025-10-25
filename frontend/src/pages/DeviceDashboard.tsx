import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import MapTrack from "../components/MapTrack";
import { useUI } from "../store/ui";

export default function DeviceDashboard() {
  const { id } = useParams<{ id: string }>();
  const { liveMode, setLive, setDevice } = useUI();

  useEffect(() => {
    setDevice(id ?? null);
    setLive(true);
    return () => {
      setDevice(null);
      setLive(true);
    };
  }, [id, setDevice, setLive]);

  if (!id) {
    return <div className="p-4 text-sm text-slate-500">Device nao informado</div>;
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-sky-600 hover:underline">
          Voltar
        </Link>
        <h2 className="text-lg font-semibold text-slate-100">Device: {id}</h2>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden md:inline">Modo:</span>
          <button
            type="button"
            onClick={() => setLive(true)}
            className={`rounded px-3 py-1 ${
              liveMode ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Ao vivo
          </button>
          <button
            type="button"
            onClick={() => setLive(false)}
            className={`rounded px-3 py-1 ${
              !liveMode ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Historico
          </button>
        </div>
      </div>

      <MapTrack deviceId={id} />
    </div>
  );
}
