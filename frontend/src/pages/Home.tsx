import DeviceClusterMap from "../components/DeviceClusterMap";

export default function Home() {
  return (
    <div className="p-3 space-y-3">
      <div>
        <h1 className="text-xl font-semibold">Visão geral (tablets)</h1>
        <p className="text-sm text-slate-500">
          Mapa agregado dos dispositivos conectados. Atualiza a cada 10 segundos.
        </p>
      </div>
      <DeviceClusterMap />
    </div>
  );
}
