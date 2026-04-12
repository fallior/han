import { type StateCreator } from 'zustand';
import { type PersonaApiEntry, buildPersonaTabs, buildNestedTabs, buildRoleMap, workshopPersonaTabs, workshopNestedTabs } from './constants';

/**
 * Workshop tab state slice
 * Manages persona selection, nested tabs, thread lists, and current thread
 * Persona data loaded dynamically from /api/village/personas
 */

// WorkshopPersona is now a string — any persona name from the registry
export type WorkshopPersona = string;

export interface WorkshopSlice {
  // State
  workshopPersona: WorkshopPersona;
  workshopNestedTab: string;
  workshopPeriod: string;
  workshopShowArchived: boolean;
  workshopSelectedThread: Record<string, number | string | null>;
  workshopThreads: Record<string, any[]>;
  workshopPeriods: Record<string, any>;
  workshopCurrentThread: any | null;
  workshopNeedsRefresh: boolean;

  // Dynamic persona data (loaded from API)
  personaTabs: Record<string, { label: string; color: string }>;
  nestedTabs: Record<string, Array<{ key: string; label: string }>>;
  roleMap: Record<string, { label: string; color: string }>;
  personasLoaded: boolean;

  // Actions
  setPersona: (persona: WorkshopPersona) => void;
  setNestedTab: (tab: string) => void;
  setPeriod: (period: string) => void;
  toggleArchived: () => void;
  selectThread: (tabKey: string, threadId: number | string | null) => void;
  setThreads: (tabKey: string, periods: any) => void;
  setCurrentThread: (thread: any | null) => void;
  addMessageToCurrentThread: (message: any) => void;
  setNeedsRefresh: (needsRefresh: boolean) => void;
  loadPersonas: (personas: PersonaApiEntry[]) => void;

  // Computed getters
  currentThreadId: () => number | string | null;
}

export const createWorkshopSlice: StateCreator<WorkshopSlice, [], [], WorkshopSlice> = (set, get) => ({
  // Initial state — uses hardcoded fallbacks until API loads
  workshopPersona: 'jim',
  workshopNestedTab: 'jim-request',
  workshopPeriod: 'all',
  workshopShowArchived: false,
  workshopSelectedThread: {},
  workshopThreads: {},
  workshopPeriods: {},
  workshopCurrentThread: null,
  workshopNeedsRefresh: false,

  // Persona data — starts with fallbacks, replaced by API data
  personaTabs: workshopPersonaTabs,
  nestedTabs: workshopNestedTabs,
  roleMap: {
    human: { label: 'Darron', color: 'blue' },
    supervisor: { label: 'Jim', color: 'purple' },
    leo: { label: 'Leo', color: 'green' },
  },
  personasLoaded: false,

  // Actions
  setPersona: (persona: WorkshopPersona) => {
    const state = get();
    const tabs = state.nestedTabs[persona];
    const defaultTab = tabs?.[0]?.key || `${persona}-notes`;
    set({
      workshopPersona: persona,
      workshopNestedTab: defaultTab,
    });
  },

  setNestedTab: (tab: string) => {
    set({ workshopNestedTab: tab });
  },

  setPeriod: (period: string) => {
    set({ workshopPeriod: period });
  },

  toggleArchived: () => {
    set((state) => ({
      workshopShowArchived: !state.workshopShowArchived,
    }));
  },

  selectThread: (tabKey: string, threadId: number | string | null) => {
    set((state) => ({
      workshopSelectedThread: {
        ...state.workshopSelectedThread,
        [tabKey]: threadId,
      },
    }));
  },

  setThreads: (tabKey: string, periods: any) => {
    set((state) => ({
      workshopThreads: {
        ...state.workshopThreads,
        [tabKey]: periods.threads || [],
      },
      workshopPeriods: {
        ...state.workshopPeriods,
        [tabKey]: periods,
      },
    }));
  },

  setCurrentThread: (thread: any | null) => {
    set({ workshopCurrentThread: thread });
  },

  addMessageToCurrentThread: (message: any) => {
    set((state) => {
      if (!state.workshopCurrentThread) return state;
      const existing = state.workshopCurrentThread.messages || [];
      if (existing.some((m: any) => m.id === message.id)) return state;
      return {
        workshopCurrentThread: {
          ...state.workshopCurrentThread,
          messages: [...existing, message],
        },
      };
    });
  },

  setNeedsRefresh: (needsRefresh: boolean) => {
    set({ workshopNeedsRefresh: needsRefresh });
  },

  /** Load persona data from API — replaces hardcoded tabs/colors */
  loadPersonas: (personas: PersonaApiEntry[]) => {
    const tabs = buildPersonaTabs(personas);
    const nested = buildNestedTabs(personas);
    const roles = buildRoleMap(personas);
    set({
      personaTabs: Object.keys(tabs).length > 0 ? tabs : workshopPersonaTabs,
      nestedTabs: Object.keys(nested).length > 0 ? nested : workshopNestedTabs,
      roleMap: {
        // Keep hardcoded human/supervisor role mappings as base
        human: { label: 'Darron', color: 'blue' },
        supervisor: { label: 'Jim', color: 'purple' },
        ...roles,
      },
      personasLoaded: true,
    });
  },

  // Computed getters
  currentThreadId: () => {
    const state = get();
    return state.workshopCurrentThread?.id || null;
  },
});
