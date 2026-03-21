/**
 * Workshop Store Hook
 * Convenience hook to access workshop-specific state from the main store
 */

import { useStore } from './index';
import type { WorkshopSlice } from './workshopSlice';

/**
 * Hook to access workshop slice of the store
 * Returns workshop-related state and actions with cleaner naming
 */
export function useWorkshopStore() {
  return useStore((state) => ({
    // State (without workshop prefix for cleaner access)
    persona: state.workshopPersona,
    nestedTab: state.workshopNestedTab,
    workshopPeriod: state.workshopPeriod,
    workshopShowArchived: state.workshopShowArchived,
    selectedThreadId: state.workshopSelectedThread[state.workshopNestedTab] || null,
    workshopThreads: state.workshopThreads,
    workshopPeriods: state.workshopPeriods,
    currentThread: state.workshopCurrentThread,
    needsRefresh: state.workshopNeedsRefresh,

    // Actions (with set prefix for consistency)
    setPersona: state.setPersona,
    setNestedTab: state.setNestedTab,
    setWorkshopPeriod: state.setPeriod,
    setWorkshopShowArchived: state.toggleArchived,
    selectThread: state.selectThread,
    setThreads: state.setThreads,
    setCurrentThread: state.setCurrentThread,
    addMessageToCurrentThread: state.addMessageToCurrentThread,
    setNeedsRefresh: state.setNeedsRefresh,

    // Computed getters
    currentThreadId: state.currentThreadId,
  }));
}

// Re-export for convenience
export type { WorkshopPersona } from './workshopSlice';
export { workshopPersonaTabs, workshopNestedTabs } from './constants';
