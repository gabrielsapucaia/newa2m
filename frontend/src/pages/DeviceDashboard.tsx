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
    return <div className="p-3 text-sm text-slate-500">Device não informado</div>;
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-sky-600 hover:underline">
          ← Voltar
        </Link>
        <h2 className="text-lg font-semibold text-slate-100">Device: {id}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="xl:col-span-1">
          <MapTrack deviceId={id} />
        </div>
        <div className="xl:col-span-1">
          <LiveIMUPanel deviceId={id} />
        </div>
      </div>
    </div>
  );
}
