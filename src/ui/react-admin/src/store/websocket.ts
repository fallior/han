import type { StoreApi } from 'zustand';

interface AppState {
  setWsConnected: (connected: boolean) => void;
  dispatchWsEvent: (data: any) => void;
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000; // Start at 1 second
const maxReconnectDelay = 30000; // Max 30 seconds
const reconnectMultiplier = 1.5;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket(store: StoreApi<AppState>) {
  // Clean up existing connection
  if (ws) {
    ws.close();
    ws = null;
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Build WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const token = localStorage.getItem('authToken') || '';
  const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      store.getState().setWsConnected(true);
      // Reset reconnect delay on successful connection
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        store.getState().dispatchWsEvent(data);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error, event.data);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected:', event.code, event.reason);
      store.getState().setWsConnected(false);
      ws = null;

      // Schedule reconnect with exponential backoff
      console.log(`[WebSocket] Reconnecting in ${reconnectDelay}ms...`);
      reconnectTimeout = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * reconnectMultiplier, maxReconnectDelay);
        connectWebSocket(store);
      }, reconnectDelay);
    };
  } catch (error) {
    console.error('[WebSocket] Failed to create connection:', error);
    store.getState().setWsConnected(false);

    // Schedule reconnect
    reconnectTimeout = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * reconnectMultiplier, maxReconnectDelay);
      connectWebSocket(store);
    }, reconnectDelay);
  }
}

// Cleanup function for when the app unmounts (optional, for testing)
export function disconnectWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }
}
