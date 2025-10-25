import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ImuHotPoint } from "../../../types";
import { SimpleLineChart } from "./SimpleLineChart";

export interface ImuChartProps {
  data: ImuHotPoint[];
  height?: number;
}

export type ImuChartComponent = (props: ImuChartProps) => ReactElement | null;

const DefaultChartComponent: ImuChartComponent = (props) => <SimpleLineChart {...props} />;

const ImuChartEngineContext = createContext<ImuChartComponent>(DefaultChartComponent);

export interface ImuChartEngineProviderProps {
  engine?: ImuChartComponent;
  children: ReactNode;
}

export function ImuChartEngineProvider({ engine, children }: ImuChartEngineProviderProps) {
  return (
    <ImuChartEngineContext.Provider value={engine ?? DefaultChartComponent}>
      {children}
    </ImuChartEngineContext.Provider>
  );
}

export function useImuChartEngine(): ImuChartComponent {
  return useContext(ImuChartEngineContext);
}
