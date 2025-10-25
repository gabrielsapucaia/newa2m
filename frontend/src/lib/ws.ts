import { API } from "./api";

type Sub = { deviceId: string; onMsg: (payload: unknown) => void };

let ws: WebSocket | null = null;
let current: Sub | null = null;

function wsUrl() {
  return API.replace(/^http/, "ws") + "/ws/last";
}

function safeClose(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return;
  }

  if (socket.readyState === WebSocket.CONNECTING) {
    const handleOpen = () => {
      socket.removeEventListener("open", handleOpen);
      socket.close();
    };
    socket.addEventListener("open", handleOpen);
    return;
  }

  socket.close();
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
      safeClose(ws);
    } catch (error) {
      console.error("Erro ao encerrar WS", error);
    }
  }
  ws = null;
  current = null;
}
