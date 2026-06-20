import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { dispatchWsMessage } from '../store/wsDispatcher';

// ============================================================================
// Types
// ============================================================================

export interface WebSocketContextValue {
  connected: boolean;
  reconnecting: boolean;
}

// ============================================================================
// Context
// ============================================================================

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  reconnecting: false,
});

export function useWebSocket() {
  return useContext(WebSocketContext);
}

// ============================================================================
// Provider
// ============================================================================

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000); // Start at 1s
  const mountedRef = useRef(true);

  // ============================================================================
  // Connection management
  // ============================================================================

  const connect = () => {
    if (!mountedRef.current) return;

    // Build WebSocket URL matching admin.ts:350-356
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('han-auth-token');
    const wsUrl = token
      ? `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', async () => {
      if (!mountedRef.current) return;

      console.log('[WebSocket] Connected');
      setConnected(true);
      setReconnecting(false);
      useStore.getState().setWsConnected(true);
      reconnectDelayRef.current = 1000; // Reset backoff

      // Application-level keepalive — sends {"type":"ping"} every 20s.
      // Browser WebSocket handles protocol-level pong automatically, but
      // this is belt-and-braces: the server also accepts app-level pings
      // and resets its missed-ping counter. Keeps the connection alive
      // across Tailscale, mobile sleep, and network blips.
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
      // Store ref for cleanup
      (ws as any)._pingInterval = pingInterval;

      // ⛔ EMBARGO (2026-06-20, Darron-directed, thread mppj72fx-wt0u1p): the on-reconnect
      // conversations refetch + the ws_reconnected dispatch are DISABLED. The WebSocket
      // flaps every ~15-30s (Safari/Tailscale wss, 1006 "network connection lost"), and
      // EACH reconnect was doing a wholesale setConversations replace (fresh fetch → all-new
      // object identities → heavy master/detail re-render → snaps back to the thread list,
      // cancelling audio playback and wiping the compose box). Darron, driving: "put an
      // embargo — I'll do a manual refresh." Both actions removed so a flap is now a no-op on
      // the UI. RESTORE deliberately once the flap root is fixed — and when restored, use a
      // stable-merge (preserve identities for unchanged threads), never a wholesale replace,
      // and gate it on an actual missed-event, not on every reconnect.
    });

    ws.addEventListener('message', (event) => {
      if (!mountedRef.current) return;

      try {
        const data = JSON.parse(event.data);
        dispatchWsMessage(data, useStore.getState());
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    });

    ws.addEventListener('close', () => {
      if (!mountedRef.current) return;

      console.log('[WebSocket] Disconnected');
      setConnected(false);
      useStore.getState().setWsConnected(false);
      if ((ws as any)._pingInterval) clearInterval((ws as any)._pingInterval);
      wsRef.current = null;

      // Schedule reconnect with exponential backoff (matching admin.ts:348,366)
      setReconnecting(true);
      const delay = reconnectDelayRef.current;
      console.log(`[WebSocket] Reconnecting in ${delay}ms`);

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 1.5, 30000); // Max 30s
        connect();
      }, delay);
    });

    ws.addEventListener('error', (error) => {
      console.error('[WebSocket] Error:', error);
    });
  };

  // ============================================================================
  // Lifecycle
  // ============================================================================

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Reconnect immediately when device wakes from sleep/hibernate.
    // Browser timers pause during sleep — the scheduled reconnect might
    // not fire for minutes. visibilitychange fires instantly on wake.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Page visible, connection dead — reconnecting now');
          // Cancel any pending delayed reconnect
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          reconnectDelayRef.current = 1000; // Reset backoff
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);

      // Cleanup
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // ============================================================================
  // Context value
  // ============================================================================

  const value: WebSocketContextValue = {
    connected,
    reconnecting,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
