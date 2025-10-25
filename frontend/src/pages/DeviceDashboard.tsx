import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { InfiniteData, QueryFunctionContext } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import DeviceTrackMap from "../components/DeviceTrackMap";
import { useLiveDevice } from "../hooks/useLiveDevice";
import { fetchDeviceLast, fetchDeviceSeries, metersPerSecondToKmH } from "../lib/api";
import type { DeviceLastPoint, SeriesPage, SeriesPoint, TelemetryMode } from "../types";

const DeviceDashboard = () => {
  const { id } = useParams<{ id: string }>();
  const deviceId = id ?? null;
  const [mode, setMode] = useState<TelemetryMode>("live");

  const lastQuery = useQuery({
    queryKey: ["device-last", deviceId],
    queryFn: () => fetchDeviceLast(deviceId!),
    enabled: !!deviceId,
    refetchInterval: mode === "live" ? 10000 : false,
  });

  const livePoint = useLiveDevice({ deviceId, mode });
  const activePoint: DeviceLastPoint | null = useMemo(() => {
    if (mode === "live") {
      return livePoint ?? lastQuery.data ?? null;
    }
    return lastQuery.data ?? null;
  }, [livePoint, lastQuery.data, mode]);

  const seriesQuery = useInfiniteQuery<SeriesPage, Error, SeriesPage, [string, string | undefined], string | undefined>({
    queryKey: ["device-series", deviceId],
    queryFn: ({ pageParam }: QueryFunctionContext<[string, string | undefined], string | undefined>) =>
      fetchDeviceSeries(deviceId!, { cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: mode === "history" && !!deviceId,
  });

  const pages = (seriesQuery.data as InfiniteData<SeriesPage> | undefined)?.pages ?? [];

  const historyPoints: SeriesPoint[] = useMemo(() => {
    return pages.flatMap((page) =>
      page.items.filter((point) => point.lat !== null && point.lon !== null),
    );
  }, [pages]);

  const speedKmH = metersPerSecondToKmH(activePoint?.speed ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-3">
        <div>
          <p className="text-xs text-slate-400">
            <Link to="/" className="text-sky-400 hover:underline">
              Visao geral
            </Link>
            {" / "}
            <span className="text-slate-200">{deviceId}</span>
          </p>
          <h1 className="text-xl font-semibold text-slate-100">Dispositivo {deviceId}</h1>
          <p className="text-sm text-slate-400">Trajetoria historica e posicao ao vivo.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("live")}
            className={`rounded px-3 py-1 text-sm ${
              mode === "live"
                ? "bg-sky-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Ao vivo
          </button>
          <button
            type="button"
            onClick={() => setMode("history")}
            className={`rounded px-3 py-1 text-sm ${
              mode === "history"
                ? "bg-sky-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Historico
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex-1 bg-slate-900/60">
          {deviceId ? (
            <DeviceTrackMap
              currentPoint={activePoint}
              history={historyPoints}
              mode={mode}
              isLoadingHistory={seriesQuery.isFetchingNextPage || seriesQuery.isLoading}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              Selecione um dispositivo valido.
            </div>
          )}
        </div>

        <aside className="flex w-full flex-col border-t border-slate-800 bg-slate-950/60 lg:w-80 lg:border-l lg:border-t-0">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Resumo</h2>
            {activePoint ? (
              <dl className="mt-2 space-y-1 text-sm text-slate-300">
                <div className="flex justify-between">
                  <dt>Ultimo registro</dt>
                  <dd>{new Date(activePoint.ts).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Velocidade</dt>
                  <dd>{speedKmH.toFixed(1)} km/h</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Sat&eacute;lites</dt>
                  <dd>{activePoint.sats_used ?? "-"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Coordenadas</dt>
                  <dd>
                    {activePoint.lat?.toFixed(5) ?? "-"}, {activePoint.lon?.toFixed(5) ?? "-"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Sem dados recentes.</p>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span>{mode === "history" ? "Historico carregado" : "Stream ao vivo"}</span>
            {mode === "history" && seriesQuery.hasNextPage && (
              <button
                type="button"
                className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => seriesQuery.fetchNextPage()}
                disabled={seriesQuery.isFetchingNextPage}
              >
                {seriesQuery.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto px-4 py-3 text-sm text-slate-300">
            {mode === "history" ? (
              historyPoints.length > 0 ? (
                <ul className="space-y-2">
                  {historyPoints.map((point) => (
                    <li key={point.ts} className="rounded border border-slate-800 bg-slate-900/50 p-2">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>{new Date(point.ts).toLocaleString()}</span>
                        <span>{metersPerSecondToKmH(point.speed ?? 0).toFixed(1)} km/h</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {point.lat?.toFixed(5) ?? "-"}, {point.lon?.toFixed(5) ?? "-"}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : seriesQuery.isLoading ? (
                <p>Carregando historico...</p>
              ) : (
                <p>Nenhum ponto historico carregado.</p>
              )
            ) : (
              <p>Modo ao vivo ativo. Clique em "Historico" para navegar pelos dados passados.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default DeviceDashboard;
