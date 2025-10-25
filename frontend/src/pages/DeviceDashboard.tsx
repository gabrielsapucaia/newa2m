import { useParams, Link } from "react-router-dom";
import MapTrack from "../components/MapTrack";
import LiveIMUPanel from "../components/LiveIMUPanel";

export default function DeviceDashboard(){
  const { id } = useParams<{id:string}>();
  if(!id) return <div className="p-3">Device não informado</div>;
  return (
    <div className="p-3 md:p-5 space-y-4 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-blue-600 underline">← Voltar</Link>
        <h2 className="text-xl font-semibold">Device: {id}</h2>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="xl:col-span-1 p-2 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100">
          <MapTrack deviceId={id} />
        </div>
        <div className="xl:col-span-1">
          <LiveIMUPanel deviceId={id} />
        </div>
      </div>
    </div>
  );
}
