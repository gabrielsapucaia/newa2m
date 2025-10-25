import { create } from "zustand";

type UIState = {
  selectedDeviceId: string | null;
  liveMode: boolean;
  mapStyle: "street" | "satellite";
  setDevice: (id: string | null) => void;
  setLive: (v: boolean) => void;
  setMapStyle: (style: "street" | "satellite") => void;
};

export const useUI = create<UIState>((set) => ({
  selectedDeviceId: null,
  liveMode: true,
  mapStyle: "satellite",
  setDevice: (id) => set({ selectedDeviceId: id }),
  setLive: (v) => set({ liveMode: v }),
  setMapStyle: (style) => set({ mapStyle: style }),
}));
