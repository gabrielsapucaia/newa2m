import { create } from "zustand";

type UIState = {
  selectedDeviceId: string | null;
  liveMode: boolean;
  setDevice: (id: string | null) => void;
  setLive: (v: boolean) => void;
};

export const useUI = create<UIState>((set) => ({
  selectedDeviceId: null,
  liveMode: true,
  setDevice: (id) => set({ selectedDeviceId: id }),
  setLive: (v) => set({ liveMode: v }),
}));
