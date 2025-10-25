import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import MapTrack from "../components/MapTrack";
import { ImuHotPanel } from "../components/imu/ImuHotPanel";
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
        <div className="inline-flex items-center gap-2 text-xs text-slate-400">
          Status:{" "}
          <span className={`font-semibold ${liveMode ? "text-emerald-300" : "text-amber-300"}`}>
            {liveMode ? "Ao vivo" : "Pausado"}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MapTrack deviceId={id} />
        <ImuHotPanel deviceId={id} />
      </div>
    </div>
  );
}
