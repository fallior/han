import { useEffect } from 'react';
import { useStore } from '../store';

/**
 * Belt-and-suspenders visibility sync hook.
 *
 * When the page becomes visible after being hidden (user switches back to the tab),
 * re-fetch conversation data to catch anything missed during long inactivity.
 *
 * This complements the WebSocket provider's reconnect reconciliation by handling
 * cases where:
 * - User was away for a very long time
 * - WebSocket was disconnected during inactivity
 * - Browser throttled background tab WebSocket activity
 */
export function useVisibilitySync() {
  const selectedConversationId = useStore((state) => state.selectedConversationId);
  const setConversations = useStore((state) => state.setConversations);
  const setConversationMessages = useStore((state) => state.setConversationMessages);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      // Only act when page becomes visible (not when it becomes hidden)
      if (document.visibilityState !== 'visible') {
        return;
      }

      console.log('[VisibilitySync] Page became visible, re-fetching data');

      const token = localStorage.getItem('han-auth-token');
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      try {
        // Re-fetch conversation list
        const conversationsResponse = await fetch('/api/conversations', { headers });
        if (conversationsResponse.ok) {
          const conversations = await conversationsResponse.json();
          setConversations(conversations);
        }

        // If a conversation is selected, re-fetch its messages
        if (selectedConversationId) {
          const messagesResponse = await fetch(`/api/conversations/${selectedConversationId}`, {
            headers,
          });
          if (messagesResponse.ok) {
            const conversation = await messagesResponse.json();
            setConversationMessages(selectedConversationId, conversation.messages || []);
          }
        }
      } catch (error) {
        console.error('[VisibilitySync] Failed to re-fetch data:', error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedConversationId, setConversations, setConversationMessages]);
}
