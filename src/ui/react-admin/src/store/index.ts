import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import { connectWebSocket } from './websocket';
import { createWorkshopSlice, type WorkshopSlice } from './workshopSlice';

type WsListener = (data: any) => void;

interface AppState extends WorkshopSlice {
  // WebSocket connection state
  wsConnected: boolean;

  // Conversations tab state
  conversationsSelectedId: string | null;
  conversationsPeriod: string;

  // Memory Discussions tab state
  memorySelectedId: string | null;
  memoryPeriod: string;

  // WebSocket event subscribers
  wsListeners: Map<string, Set<WsListener>>;

  // Actions
  setConversationsSelectedId: (id: string | null) => void;
  setConversationsPeriod: (period: string) => void;
  setMemorySelectedId: (id: string | null) => void;
  setMemoryPeriod: (period: string) => void;
  setWsConnected: (connected: boolean) => void;

  // WebSocket event management
  subscribeWs: (type: string, callback: WsListener) => () => void;
  dispatchWsEvent: (data: any) => void;
}

export const useStore = create<AppState>((set, get, api) => ({
  // Spread workshop slice
  ...createWorkshopSlice(set, get, api),

  // Initial state
  wsConnected: false,
  conversationsSelectedId: null,
  conversationsPeriod: 'all',
  memorySelectedId: null,
  memoryPeriod: 'all',
  wsListeners: new Map(),

  // Conversations actions
  setConversationsSelectedId: (id) => set({ conversationsSelectedId: id }),
  setConversationsPeriod: (period) => set({ conversationsPeriod: period }),

  // Memory Discussions actions
  setMemorySelectedId: (id) => set({ memorySelectedId: id }),
  setMemoryPeriod: (period) => set({ memoryPeriod: period }),

  // WebSocket connection action
  setWsConnected: (connected) => set({ wsConnected: connected }),

  // WebSocket event subscription
  subscribeWs: (type, callback) => {
    const { wsListeners } = get();

    if (!wsListeners.has(type)) {
      wsListeners.set(type, new Set());
    }

    wsListeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = get().wsListeners.get(type);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          get().wsListeners.delete(type);
        }
      }
    };
  },

  // WebSocket event dispatch
  dispatchWsEvent: (data) => {
    const { wsListeners } = get();
    const listeners = wsListeners.get(data.type);

    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in WebSocket listener for type "${data.type}":`, error);
        }
      });
    }
  },
}));

// Initialize WebSocket connection
// We need to get the store API to pass to connectWebSocket
const storeApi = useStore as unknown as StoreApi<AppState>;
connectWebSocket(storeApi);

// Re-export types and constants for convenience
export type { WorkshopPersona, WorkshopSlice } from './workshopSlice';
export { workshopPersonaTabs, workshopNestedTabs } from './constants';
export type { PersonaTabConfig, NestedTabConfig } from './constants';
