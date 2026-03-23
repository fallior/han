/**
 * Workshop Store Hook
 * Convenience hook to access workshop-specific state from the main store
 *
 * Uses useShallow to prevent infinite re-render loops — without it,
 * the object selector creates a new reference every render, which Zustand
 * interprets as "state changed", triggering another render (React error #185).
 */

import { useShallow } from 'zustand/react/shallow';
import { useStore } from './index';

/**
 * Hook to access workshop slice of the store
 * Returns workshop-related state and actions with cleaner naming
 */
export function useWorkshopStore() {
  return useStore(useShallow((state) => ({
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
  })));
}

// Re-export for convenience
export type { WorkshopPersona } from './workshopSlice';
export { workshopPersonaTabs, workshopNestedTabs } from './constants';
