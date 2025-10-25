import { API } from "./api";

type Sub = { deviceId: string; onMsg: (payload: unknown) => void };

let ws: WebSocket | null = null;
let current: Sub | null = null;

function wsUrl() {
  return API.replace(/^http/, "ws") + "/ws/last";
}

export function subscribeLastFrame(deviceId: string, onMsg: (payload: unknown) => void) {
  unsubscribeLastFrame();

  current = { deviceId, onMsg };
  ws = new WebSocket(`${wsUrl()}?device_id=${encodeURIComponent(deviceId)}`);

  ws.onmessage = (event) => {
    try {
      current?.onMsg(JSON.parse(event.data));
    } catch (error) {
      console.error("Falha ao decodificar mensagem WS", error);
    }
  };

  ws.onclose = () => {
    // opcional: reconectar dependendo da necessidade futura
  };
}

export function unsubscribeLastFrame() {
  if (ws) {
    try {
      ws.close();
    } catch (error) {
      console.error("Erro ao encerrar WS", error);
    }
  }
  ws = null;
  current = null;
}
