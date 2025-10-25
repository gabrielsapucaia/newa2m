import type { DeviceLastPoint } from "../types";
import { API_BASE_URL, normalizePoint } from "./api";

const WS_BASE_URL = API_BASE_URL.replace(/^http/i, (match) => (match.toLowerCase() === "https" ? "wss" : "ws"));
const WS_URL = `${WS_BASE_URL}/live`;

type Listener = (payload: DeviceLastPoint) => void;

type Topic = string;

class LiveClient {
  private socket: WebSocket | null = null;
  private listeners: Map<Topic, Set<Listener>> = new Map();
  private reconnectTimeout: number | null = null;

  subscribeToDevice(deviceId: string, listener: Listener) {
    const topic = `last/${deviceId}`;
    this.addListener(topic, listener);
    this.ensureSocket();
    return () => {
      this.removeListener(topic, listener);
    };
  }

  private addListener(topic: Topic, listener: Listener) {
    const existing = this.listeners.get(topic) ?? new Set<Listener>();
    existing.add(listener);
    this.listeners.set(topic, existing);
  }

  private removeListener(topic: Topic, listener: Listener) {
    const existing = this.listeners.get(topic);
    if (!existing) return;
    existing.delete(listener);
    if (existing.size === 0) {
      this.listeners.delete(topic);
    }
  }

  private ensureSocket() {
    if (this.socket || this.reconnectTimeout !== null) {
      return;
    }
    try {
      this.socket = new WebSocket(WS_URL);
      this.socket.onopen = () => {
        // conexao estabelecida
      };
      this.socket.onmessage = (event) => this.handleMessage(event);
      this.socket.onclose = () => this.scheduleReconnect();
      this.socket.onerror = () => this.scheduleReconnect();
    } catch (error) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket = null;
    }
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
    }
    // Apenas reconectar se ainda existirem listeners
    if (this.listeners.size === 0) {
      return;
    }
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.ensureSocket();
    }, 3000);
  }

  private handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data) as { topic: string; payload: Record<string, unknown> };
      const { topic, payload } = data;
      const listeners = this.listeners.get(topic);
      if (!listeners || listeners.size === 0) {
        return;
      }
      const point = normalizePoint({
        ...payload,
        device_id: topic.split("/")[1],
        payload,
      } as DeviceLastPoint);
      listeners.forEach((listener) => listener(point));
    } catch (error) {
      console.error("Erro ao processar mensagem WS", error);
    }
  }
}

export const liveClient = new LiveClient();
