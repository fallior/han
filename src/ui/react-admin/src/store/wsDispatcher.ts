import type { useStore } from './index';

/**
 * WebSocket message dispatcher.
 *
 * THIS IS THE FIX FOR THE TAB-SWITCHING BUG:
 * - Updates Zustand store UNCONDITIONALLY (no tab checking)
 * - Messages arriving while user is on a different tab are NOT dropped
 * - When user switches back, view is already up-to-date (React re-renders from store)
 *
 * Replaces vanilla JS admin.ts:379-431 handleWsMessage() which checked `currentModule`
 * before updating, causing silent message loss.
 */
export function dispatchWsMessage(
  data: any,
  store: ReturnType<typeof useStore.getState>
) {
  switch (data.type) {
    case 'supervisor_cycle':
    case 'supervisor_action':
      // Update supervisor status in store
      store.updateSupervisorStatus(data);
      break;

    case 'conversation_message':
      // CRITICAL: message is NESTED in data.message, not flat
      // Server broadcasts from conversations.ts:407-412:
      // {
      //   type: 'conversation_message',
      //   conversation_id: number,
      //   discussion_type: string,
      //   message: {
      //     id: number,
      //     conversation_id: number,
      //     role: 'user' | 'assistant' | 'system',
      //     content: string,
      //     created_at: string
      //   }
      // }
      const msg = data.message;
      if (msg) {
        store.addConversationMessage(data.conversation_id, {
          id: msg.id,
          conversation_id: msg.conversation_id || data.conversation_id,
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at || new Date().toISOString()
        });
      }
      break;

    case 'task_update':
    case 'goal_update':
      // Placeholder for Phase 3 (Tasks) and Phase 4 (Goals)
      // These will call store.updateTask() / store.updateGoal() when implemented
      break;

    default:
      // Unknown message type — ignore silently
      // (Could log to console in development for debugging)
      break;
  }
}
