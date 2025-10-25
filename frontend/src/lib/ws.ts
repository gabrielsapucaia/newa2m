import { API } from "./api";

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

export type LastFramePayload = Record<string, unknown>;
export type LastFrameUnsubscribe = () => void;

let activeSocket: WebSocket | undefined;
let activeUnsubscribe: LastFrameUnsubscribe | undefined;

export function subscribeLastFrame(deviceId: string, onMsg: (payload: LastFramePayload) => void): LastFrameUnsubscribe {
  unsubscribeLastFrame();

  const socket = new WebSocket(`${wsUrl()}?device_id=${encodeURIComponent(deviceId)}`);

  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as LastFramePayload;
      onMsg(parsed);
    } catch (error) {
      console.error("Falha ao decodificar mensagem WS", error);
    }
  };

  socket.onclose = () => {
    if (activeSocket === socket) {
      activeSocket = undefined;
      activeUnsubscribe = undefined;
    }
  };

  const unsubscribe = () => {
    try {
      safeClose(socket);
    } catch (error) {
      console.error("Erro ao encerrar WS", error);
    } finally {
      if (activeSocket === socket) {
        activeSocket = undefined;
        activeUnsubscribe = undefined;
      }
    }
  };

  activeSocket = socket;
  activeUnsubscribe = unsubscribe;

  return unsubscribe;
}

export function unsubscribeLastFrame() {
  if (activeUnsubscribe) {
    try {
      activeUnsubscribe();
    } finally {
      activeUnsubscribe = undefined;
      activeSocket = undefined;
    }
  }
}
