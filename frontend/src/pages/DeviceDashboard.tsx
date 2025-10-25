import { Link, useParams } from "react-router-dom";
import MapTrack from "../components/MapTrack";

export default function DeviceDashboard() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <div className="p-4 text-sm text-slate-500">Device não informado</div>;
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-sky-600 hover:underline">
          ← Voltar
        </Link>
        <h2 className="text-lg font-semibold text-slate-100">Device: {id}</h2>
      </div>
      <MapTrack deviceId={id} />
    </div>
  );
}
