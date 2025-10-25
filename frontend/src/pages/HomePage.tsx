import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import DevicesMap from "../components/DevicesMap";
import { fetchDeviceLast, fetchStats } from "../lib/api";
import type { DeviceLastPoint, DeviceStatsRow } from "../types";

const HomePage = () => {
  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 10000,
  });

  const deviceIds = statsQuery.data?.devices ?? [];

  const deviceQueries = useQueries({
    queries: deviceIds.map((device: DeviceStatsRow) => ({
      queryKey: ["device-last", device.device_id],
      queryFn: () => fetchDeviceLast(device.device_id),
      refetchInterval: 10000,
      staleTime: 10000,
      enabled: deviceIds.length > 0,
    })),
  }) as UseQueryResult<DeviceLastPoint>[];

  const devices = useMemo(() => {
    return deviceQueries
      .map((query) => query.data)
      .filter((value): value is DeviceLastPoint => Boolean(value && value.lat !== null && value.lon !== null));
  }, [deviceQueries]);

  const isLoading = statsQuery.isLoading || deviceQueries.some((query) => query.isLoading);
  const isError = statsQuery.isError || deviceQueries.some((query) => query.isError);
  const lastUpdated = statsQuery.data?.devices[0]?.last_ts;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Visao geral</h1>
          <p className="text-sm text-slate-400">
            Clusters de tablets atualizados a cada 10s.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Total de pontos: {statsQuery.data?.db_total_points ?? "-"}
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 bg-slate-900/60">
          {isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
              <p>Falha ao carregar telemetria.</p>
              <button
                type="button"
                className="rounded bg-sky-500 px-3 py-1 text-sm text-white hover:bg-sky-600"
                onClick={() => statsQuery.refetch()}
              >
                Tentar novamente
              </button>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              {isLoading ? "Carregando mapa de telemetria..." : "Nenhum dispositivo com posicao valida."}
            </div>
          ) : (
            <DevicesMap devices={devices} isLoading={isLoading} lastUpdated={lastUpdated} />
          )}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
