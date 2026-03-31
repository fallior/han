// @ts-nocheck
import { create } from 'zustand';
import { createWorkshopSlice, type WorkshopSlice } from './workshopSlice';
import type { Conversation, Message } from '../types';

type WsListener = (data: any) => void;

// ── LocalStorage Keys ──────────────────────────────────────
const LAST_READ_KEY = 'han-react-admin-last-read';

// ── Helpers ────────────────────────────────────────────────

/**
 * Load last read timestamps from localStorage
 */
function _loadLastReadTimestamps(): Record<string, string> {
  try {
    const stored = localStorage.getItem(LAST_READ_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (err) {
    console.warn('Failed to load last read timestamps from localStorage:', err);
    return {};
  }
}

/**
 * Save last read timestamps to localStorage
 */
function _saveLastReadTimestamps(timestamps: Record<string, string>) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(timestamps));
  } catch (err) {
    console.warn('Failed to save last read timestamps to localStorage:', err);
  }
}

interface AppState extends WorkshopSlice {
  // WebSocket connection state
  wsConnected: boolean;

  // Supervisor state
  lastCycleAt: string | null;
  supervisorPaused: boolean;

  // Conversations data (keyed by ID for efficient lookups)
  conversations: Record<string, Conversation>;
  conversationMessages: Record<string, Message[]>;
  selectedConversationId: string | null;

  // Last read timestamps (persisted to localStorage)
  lastReadTimestamps: Record<string, string>;

  // Legacy tab state (to be migrated)
  conversationsSelectedId: string | null;
  conversationsPeriod: string;

  // Memory Discussions tab state
  memorySelectedId: string | null;
  memoryPeriod: string;

  // Supervisor tab state (legacy)
  supervisorStatus: any | null;
  supervisorCycles: any[];
  supervisorMemory: Record<string, string>;
  supervisorProposals: any[];
  supervisorHealth: any | null;

  // Work tab state
  goals: any[];
  archivedGoals: any[];
  tasks: any[];
  workFilters: { project: string; status: string; model: string };

  // Reports tab state
  latestDigest: any | null;
  digests: any[];
  latestWeekly: any | null;
  weeklies: any[];
  analytics: any | null;

  // Projects tab state
  projects: any[];
  portfolio: any[];
  selectedProject: string | null;

  // Products tab state
  products: any[];
  selectedProductId: string | null;
  selectedProduct: any | null;

  // WebSocket event subscribers
  wsListeners: Map<string, Set<WsListener>>;

  // Actions
  setConversationsSelectedId: (id: string | null) => void;
  setConversationsPeriod: (period: string) => void;
  setMemorySelectedId: (id: string | null) => void;
  setMemoryPeriod: (period: string) => void;
  setWsConnected: (connected: boolean) => void;

  // Supervisor actions
  setSupervisorPaused: (paused: boolean) => void;
  updateSupervisorStatus: (data: any) => void;
  setSupervisorStatus: (status: any | null) => void;
  setSupervisorCycles: (cycles: any[]) => void;
  setSupervisorMemory: (memory: Record<string, string>) => void;
  setSupervisorProposals: (proposals: any[]) => void;
  setSupervisorHealth: (health: any | null) => void;

  // Conversation actions
  setConversations: (conversations: Conversation[]) => void;
  setConversationMessages: (conversationId: string, messages: Message[]) => void;
  addConversationMessage: (conversationId: string, message: Message) => void;
  selectConversation: (conversationId: string | null) => void;
  markAsRead: (conversationId: string) => void;
  hasUnread: (conversationId: string) => boolean;

  // Work actions
  setGoals: (goals: any[]) => void;
  setArchivedGoals: (goals: any[]) => void;
  setTasks: (tasks: any[]) => void;
  setWorkFilters: (filters: { project: string; status: string; model: string }) => void;

  // Reports actions
  setLatestDigest: (digest: any | null) => void;
  setDigests: (digests: any[]) => void;
  setLatestWeekly: (weekly: any | null) => void;
  setWeeklies: (weeklies: any[]) => void;
  setAnalytics: (analytics: any | null) => void;

  // Projects actions
  setProjects: (projects: any[]) => void;
  setPortfolio: (portfolio: any[]) => void;
  setSelectedProject: (project: string | null) => void;

  // Products actions
  setProducts: (products: any[]) => void;
  setSelectedProductId: (id: string | null) => void;
  setSelectedProduct: (product: any | null) => void;

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
  lastCycleAt: null,
  supervisorPaused: false,
  conversations: {},
  conversationMessages: {},
  selectedConversationId: null,
  lastReadTimestamps: _loadLastReadTimestamps(),

  // Supervisor initial state
  supervisorStatus: null,
  supervisorCycles: [],
  supervisorMemory: {},
  supervisorProposals: [],
  supervisorHealth: null,

  // Work initial state
  goals: [],
  archivedGoals: [],
  tasks: [],
  workFilters: { project: 'all', status: 'all', model: 'all' },

  // Reports initial state
  latestDigest: null,
  digests: [],
  latestWeekly: null,
  weeklies: [],
  analytics: null,

  // Projects initial state
  projects: [],
  portfolio: [],
  selectedProject: null,

  // Products initial state
  products: [],
  selectedProductId: null,
  selectedProduct: null,

  // Conversations actions
  setConversationsSelectedId: (id) => set({ conversationsSelectedId: id }),
  setConversationsPeriod: (period) => set({ conversationsPeriod: period }),

  // Memory Discussions actions
  setMemorySelectedId: (id) => set({ memorySelectedId: id }),
  setMemoryPeriod: (period) => set({ memoryPeriod: period }),

  // WebSocket connection action
  setWsConnected: (connected) => set({ wsConnected: connected }),

  // Supervisor actions
  setSupervisorPaused: (paused) => set({ supervisorPaused: paused }),

  updateSupervisorStatus: (data) => {
    set({ lastCycleAt: new Date().toISOString() });
  },

  setSupervisorStatus: (status) => set({ supervisorStatus: status }),
  setSupervisorCycles: (cycles) => set({ supervisorCycles: cycles }),
  setSupervisorMemory: (memory) => set({ supervisorMemory: memory }),
  setSupervisorProposals: (proposals) => set({ supervisorProposals: proposals }),
  setSupervisorHealth: (health) => set({ supervisorHealth: health }),

  // Conversation actions
  setConversations: (conversations) => {
    // Guard: API may return { conversations: [...] } instead of an array
    const convArray = Array.isArray(conversations)
      ? conversations
      : ((conversations as any)?.conversations || []);
    const conversationsById = convArray.reduce((acc: Record<string, Conversation>, conv: Conversation) => {
      acc[conv.id] = conv;
      return acc;
    }, {} as Record<string, Conversation>);
    set({ conversations: conversationsById });
  },

  setConversationMessages: (conversationId, messages) => {
    set((state) => ({
      conversationMessages: {
        ...state.conversationMessages,
        [conversationId]: messages,
      },
    }));
  },

  addConversationMessage: (conversationId, message) => {
    set((state) => {
      const existing = state.conversationMessages[conversationId] || [];
      // Deduplicate — the same message can arrive via both HTTP broadcast and signal file
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        conversationMessages: {
          ...state.conversationMessages,
          [conversationId]: [...existing, message],
        },
      };
    });
  },

  selectConversation: (conversationId) => {
    set({ selectedConversationId: conversationId });
  },

  markAsRead: (conversationId) => {
    const now = new Date().toISOString();
    set((state) => {
      const updated = {
        ...state.lastReadTimestamps,
        [conversationId]: now,
      };
      _saveLastReadTimestamps(updated);
      return { lastReadTimestamps: updated };
    });
  },

  hasUnread: (conversationId) => {
    const state = get();
    const messages = state.conversationMessages[conversationId];
    if (!messages || messages.length === 0) return false;

    const latestMessage = messages[messages.length - 1];
    const lastRead = state.lastReadTimestamps[conversationId];

    if (!lastRead) return true; // Never read
    return latestMessage.created_at > lastRead;
  },

  // Work actions
  setGoals: (goals) => set({ goals }),
  setArchivedGoals: (goals) => set({ archivedGoals: goals }),
  setTasks: (tasks) => set({ tasks }),
  setWorkFilters: (filters) => set({ workFilters: filters }),

  // Reports actions
  setLatestDigest: (digest) => set({ latestDigest: digest }),
  setDigests: (digests) => set({ digests }),
  setLatestWeekly: (weekly) => set({ latestWeekly: weekly }),
  setWeeklies: (weeklies) => set({ weeklies }),
  setAnalytics: (analytics) => set({ analytics }),

  // Projects actions
  setProjects: (projects) => set({ projects }),
  setPortfolio: (portfolio) => set({ portfolio }),
  setSelectedProject: (project) => set({ selectedProject: project }),

  // Products actions
  setProducts: (products) => set({ products }),
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  setSelectedProduct: (product) => set({ selectedProduct: product }),

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

// Note: WebSocket connection is now managed by the WebSocketProvider component
// (no longer initialized here to avoid dual connections)

// Re-export types and constants for convenience
export type { WorkshopPersona, WorkshopSlice } from './workshopSlice';
export { workshopPersonaTabs, workshopNestedTabs } from './constants';
export type { PersonaTabConfig, NestedTabConfig } from './constants';
