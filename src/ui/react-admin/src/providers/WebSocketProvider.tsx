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
  const reconnectTimeoutRef = useRef<number | null>(null);
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

      // On reconnect, fetch conversations to reconcile missed events
      try {
        const response = await fetch('/api/conversations', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.ok) {
          const conversations = await response.json();
          useStore.getState().setConversations(conversations);
        }
      } catch (error) {
        console.error('[WebSocket] Failed to reconcile conversations on reconnect:', error);
      }
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

    return () => {
      mountedRef.current = false;

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
