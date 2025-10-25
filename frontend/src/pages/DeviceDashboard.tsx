import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import MapTrack from "../components/MapTrack";
import LiveIMUPanel from "../components/LiveIMUPanel";
import { useUI } from "../store/ui";

export default function DeviceDashboard() {
  const { id } = useParams<{ id: string }>();
  const { setDevice, setLive } = useUI();

  useEffect(() => {
    setDevice(id ?? null);
    setLive(true);
    return () => {
      setDevice(null);
      setLive(true);
    };
  }, [id, setDevice, setLive]);

  if (!id) {
    return <div className="p-3 text-sm text-slate-400">Device n\u00e3o informado</div>;
  }

  return (
    <div className="min-h-screen space-y-5 bg-slate-950 p-3 text-slate-100 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-sky-400 hover:underline">
          &#8592; Voltar
        </Link>
        <h2 className="text-xl font-semibold">Device: {id}</h2>
        <Link
          to={`/devices/${encodeURIComponent(id)}/deep`}
          className="text-xs uppercase tracking-wide text-sky-300 hover:text-sky-200"
        >
          Deep dive analítica
        </Link>
        <Link
          to={`/devices/${encodeURIComponent(id)}/plotlydeep`}
          className="text-xs uppercase tracking-wide text-sky-300 hover:text-sky-200"
        >
          Plotly experimental
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-2 shadow-lg md:p-3">
          <MapTrack deviceId={id} />
        </div>
        <LiveIMUPanel deviceId={id} />
      </div>
    </div>
  );
}


