import { useEffect, useState } from "react";
import type { DeviceLastPoint, TelemetryMode } from "../types";
import { liveClient } from "../lib/liveClient";

interface UseLiveDeviceOptions {
  deviceId?: string;
  mode: TelemetryMode;
}

export function useLiveDevice({ deviceId, mode }: UseLiveDeviceOptions) {
  const [point, setPoint] = useState<DeviceLastPoint | null>(null);

  useEffect(() => {
    if (!deviceId || mode !== "live") {
      return;
    }
    const unsubscribe = liveClient.subscribeToDevice(deviceId, (payload) => {
      setPoint(payload);
    });
    return () => unsubscribe();
  }, [deviceId, mode]);

  return point;
}
