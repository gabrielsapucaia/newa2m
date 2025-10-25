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
    return <div className="p-3 text-sm text-slate-400">Device não informado</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-3 md:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-sky-400 hover:underline">
          ← Voltar
        </Link>
        <h2 className="text-xl font-semibold">Device: {id}</h2>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-2 md:p-3 shadow-lg">
          <MapTrack deviceId={id} />
        </div>
        <LiveIMUPanel deviceId={id} />
      </div>
    </div>
  );
}
