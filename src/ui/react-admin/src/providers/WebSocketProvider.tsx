import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

// ============================================================================
// Types
// ============================================================================

export interface WebSocketContextValue {
  connected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError: string | null;
}

interface WebSocketMessage {
  type: string;
  data: any;
}

interface ConversationMessageEvent {
  conversation_id: string;
  message: {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: string;
    metadata?: Record<string, any>;
  };
}

// ============================================================================
// Context
// ============================================================================

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error'
  >('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef(1000); // Start with 1s delay
  const mountedRef = useRef(true);

  const store = useStore();

  // ============================================================================
  // Connection management
  // ============================================================================

  const connect = () => {
    if (!mountedRef.current) return;

    const token = localStorage.getItem('han-auth-token');
    if (!token) {
      setConnectionStatus('error');
      setLastError('No authentication token');
      return;
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

    setConnectionStatus('connecting');
    setLastError(null);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.log('[WebSocket] Connected');
        setConnected(true);
        setConnectionStatus('connected');
        setLastError(null);
        // Reset reconnect delay on successful connection
        reconnectDelayRef.current = 1000;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        if (!mountedRef.current) return;
        console.error('[WebSocket] Error:', error);
        setConnectionStatus('error');
        setLastError('WebSocket error');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        console.log('[WebSocket] Disconnected');
        setConnected(false);
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // Schedule reconnection with exponential backoff
        scheduleReconnect();
      };
    } catch (err) {
      console.error('[WebSocket] Connection failed:', err);
      setConnectionStatus('error');
      setLastError(err instanceof Error ? err.message : 'Connection failed');
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (!mountedRef.current) return;

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const delay = reconnectDelayRef.current;
    console.log(`[WebSocket] Reconnecting in ${delay}ms`);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect();
        // Exponential backoff: 1s → 1.5s → 2.25s → ... (capped at 30s)
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 1.5, 30000);
      }
    }, delay);
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
    setConnectionStatus('disconnected');
  };

  // ============================================================================
  // Message handling
  // ============================================================================

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'conversation_message':
        handleConversationMessage(message.data as ConversationMessageEvent);
        break;

      case 'ping':
        // Respond to ping if needed
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'pong' }));
        }
        break;

      default:
        console.log('[WebSocket] Unknown message type:', message.type);
    }
  };

  const handleConversationMessage = (data: ConversationMessageEvent) => {
    console.log('[WebSocket] Conversation message:', data);

    // Always add the message to the store if it's for the current thread
    const currentThreadId = store.getState().currentThreadId();
    if (data.conversation_id === currentThreadId) {
      store.getState().addMessageToCurrentThread(data.message);
    }

    // Set flag so thread list knows to refresh
    // Note: This will be handled by the store's needsRefresh flag
    store.getState().setNeedsRefresh(true);
  };

  // ============================================================================
  // Lifecycle
  // ============================================================================

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, []);

  // ============================================================================
  // Context value
  // ============================================================================

  const value: WebSocketContextValue = {
    connected,
    connectionStatus,
    lastError,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
