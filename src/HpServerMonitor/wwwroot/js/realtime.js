import { getSession } from './api.js';

export class Realtime {
  constructor({ onSnapshot, onStatus, onAuthError } = {}) {
    this.onSnapshot = onSnapshot || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onAuthError = onAuthError || (() => {});
    this.socket = null;
    this.retry = 0;
    this.stopped = true;
    this.connected = false;
    this.lastMessageAt = 0;
    this.reconnectTimer = 0;
    this.heartbeatTimer = 0;
    this.manualClose = false;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._connect();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try { this.socket.send(JSON.stringify({ type: 'ping' })); } catch { }
      }
    }, 20_000);
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.heartbeatTimer);
    this.reconnectTimer = 0;
    this.heartbeatTimer = 0;
    this._closeSocket();
    this._emitStatus();
  }

  reconnectNow() {
    if (this.stopped) {
      this.start();
      return;
    }
    this.retry = 0;
    this._closeSocket();
    this._connect();
  }

  _closeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    this.manualClose = true;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(1000, 'reconnect'); } catch { }
    this.manualClose = false;
  }

  _connect() {
    if (this.stopped) return;
    const session = getSession();
    if (!session) {
      this.onAuthError();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws`;

    let socket;
    try {
      socket = new WebSocket(url, ['hpmon', session.token]);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this._emitStatus();
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'snapshot' && message.data) {
        this.lastMessageAt = Date.now();
        this.onSnapshot(message.data);
        this._emitStatus();
      }
    };

    socket.onerror = () => {
      // onclose 统一处理重连
    };

    socket.onclose = (event) => {
      this.connected = false;
      this.socket = null;
      this._emitStatus();

      if (event.code === 1008 || event.code === 4001 || event.code === 4401) {
        this.onAuthError();
        return;
      }
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(10_000, 1000 * Math.pow(2, this.retry)) + Math.random() * 300;
    this.retry = Math.min(this.retry + 1, 4);
    this.reconnectTimer = window.setTimeout(() => this._connect(), delay);
  }

  _emitStatus() {
    this.onStatus({
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      retry: this.retry
    });
  }
}
