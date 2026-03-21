import { type StateCreator } from 'zustand';

/**
 * Workshop tab state slice
 * Manages persona selection, nested tabs, thread lists, and current thread
 */

// Type definitions
export type WorkshopPersona = 'jim' | 'leo' | 'darron' | 'jemma';

export interface WorkshopSlice {
  // State
  workshopPersona: WorkshopPersona;
  workshopNestedTab: string;
  workshopPeriod: string;
  workshopShowArchived: boolean;
  workshopSelectedThread: Record<string, string | null>;
  workshopThreads: Record<string, any[]>;
  workshopPeriods: Record<string, any>;
  workshopCurrentThread: any | null;

  // Actions
  setPersona: (persona: WorkshopPersona) => void;
  setNestedTab: (tab: string) => void;
  setPeriod: (period: string) => void;
  toggleArchived: () => void;
  selectThread: (tabKey: string, threadId: string | null) => void;
  setThreads: (tabKey: string, periods: any) => void;
  setCurrentThread: (thread: any | null) => void;
  addMessageToCurrentThread: (message: any) => void;
}

// Default nested tab for each persona
const defaultNestedTabs: Record<WorkshopPersona, string> = {
  jim: 'jim-request',
  leo: 'leo-question',
  darron: 'darron-exploration',
  jemma: 'jemma-task',
};

export const createWorkshopSlice: StateCreator<WorkshopSlice, [], [], WorkshopSlice> = (set, _get) => ({
  // Initial state
  workshopPersona: 'jim',
  workshopNestedTab: 'jim-request',
  workshopPeriod: 'all',
  workshopShowArchived: false,
  workshopSelectedThread: {},
  workshopThreads: {},
  workshopPeriods: {},
  workshopCurrentThread: null,

  // Actions
  setPersona: (persona: WorkshopPersona) => {
    set({
      workshopPersona: persona,
      workshopNestedTab: defaultNestedTabs[persona],
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

  selectThread: (tabKey: string, threadId: string | null) => {
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

      return {
        workshopCurrentThread: {
          ...state.workshopCurrentThread,
          messages: [...(state.workshopCurrentThread.messages || []), message],
        },
      };
    });
  },
});
