# React Admin UI — Phase 2: WebSocket Provider + Zustand State Store

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Goal**: Phase 2: React Admin UI — WebSocket Provider + Zustand State Store

## Summary

Built the real-time data layer for the React admin UI migration. This phase solves the core bug that motivated the migration: WebSocket messages arriving while the user isn't on the right tab get silently dropped, requiring manual refresh. With React + Zustand, WebSocket messages update the store regardless of which tab is active. Components subscribe to their slice of state and re-render automatically when data changes.

## What Was Built

### 1. WebSocket Provider (`providers/WebSocketProvider.tsx`, 141 lines)

A React context provider that manages the WebSocket connection:
- Connects to `wss://host/ws` (or `ws://` for non-HTTPS)
- Includes auth token from localStorage as query param: `/ws?token=...`
- Auto-reconnects on close with exponential backoff (start 1s, max 30s)
- Passes received messages to the Zustand store dispatcher
- Provides connection status (connected/disconnected/reconnecting) via context
- On reconnect, triggers a state reconciliation (re-fetch current data)

WebSocket URL pattern matches the existing admin.ts (lines 350-356):
```typescript
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const token = localStorage.getItem('han-auth-token');
const wsUrl = token ? `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}` : `${protocol}//${location.host}/ws`;
```

### 2. Zustand Store (`store/index.ts`, 316 lines)

A single Zustand store with slices for each data domain. The store is the single source of truth — components read from it, WebSocket events write to it.

**Store shape:**
```typescript
interface AppState {
  // WebSocket connection
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  // Supervisor state
  lastCycleAt: string | null;
  supervisorPaused: boolean;
  updateSupervisorStatus: (data: any) => void;

  // Conversations (all types)
  conversations: Record<string, Conversation>; // keyed by ID
  conversationMessages: Record<string, Message[]>; // keyed by conversation ID
  addConversationMessage: (conversationId: string, message: Message) => void;
  setConversationMessages: (conversationId: string, messages: Message[]) => void;
  setConversations: (conversations: Conversation[]) => void;

  // Active UI state
  selectedConversationId: string | null;
  selectConversation: (id: string | null) => void;

  // Unread tracking (persisted to localStorage)
  lastReadTimestamps: Record<string, string>;
  markAsRead: (conversationId: string) => void;
  hasUnread: (conversationId: string) => boolean;
}
```

**Key insight**: The store has ALL the data. No checking `currentModule` to decide whether to update. WebSocket events write unconditionally, React components that subscribe will re-render.

### 3. WebSocket Message Dispatcher (`store/wsDispatcher.ts`, 59 lines)

A function that takes a WebSocket message and updates the correct store slice:

```typescript
function dispatchWsMessage(data: any, store: AppState) {
  switch (data.type) {
    case 'supervisor_cycle':
    case 'supervisor_action':
      store.updateSupervisorStatus(data);
      break;
    case 'conversation_message':
      // ALWAYS update store, regardless of which tab is active
      store.addConversationMessage(data.conversation_id, {
        id: data.message_id || crypto.randomUUID(),
        conversation_id: data.conversation_id,
        role: data.role,
        content: data.content,
        created_at: data.created_at || new Date().toISOString()
      });
      break;
    case 'task_update':
    case 'goal_update':
      // Store for later phases
      break;
  }
}
```

The key insight: `conversation_message` events update the store unconditionally. No checking currentModule. No conditional rendering. The store has the data. React components that subscribe to that data will re-render.

### 4. Visibility-Aware Sync Hook (`hooks/useVisibilitySync.ts`, 71 lines)

A custom hook that:
- Uses `document.addEventListener('visibilitychange', ...)`
- When the page becomes visible after being hidden, re-fetches the currently selected conversation from the API to reconcile any missed WebSocket events
- This is the belt-and-suspenders approach: WebSocket handles real-time, visibility sync catches anything missed during long periods of inactivity

```typescript
export function useVisibilitySync(conversationId: string | null) {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && conversationId) {
        // Re-fetch the conversation to reconcile any missed WebSocket events
        fetch(`/api/conversations/${conversationId}`)
          .then(res => res.json())
          .then(data => {
            // Update store with latest messages
          });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [conversationId]);
}
```

### 5. TypeScript Types (`types/index.ts`, 180 lines)

Core types defined:
```typescript
interface Conversation {
  id: string;
  title: string;
  discussion_type: string | null;
  status: 'open' | 'resolved';
  message_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  summary?: string;
  topics?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'human' | 'supervisor' | 'leo';
  content: string;
  created_at: string;
}
```

### 6. Wiring

- Wrapped App component with WebSocketProvider in `App.tsx`
- Updated `StatusBar.tsx` to read `wsConnected` and `lastCycleAt` from the store instead of local state
- Updated `ConversationsPage.tsx` with basic store integration test (displays number of conversations in store)
- Ran Vite build and verified output works at `/admin-react/`
- StatusBar shows real-time connection status

## The Bug This Solves

In the vanilla JS admin (`src/ui/admin.ts` lines 379-431), the WebSocket handler `handleWsMessage()` checks `currentModule` to decide whether to re-render:

```typescript
function handleWsMessage(data: any) {
  if (data.type === 'conversation_message') {
    if (currentModule === 'conversations') {
      // Re-render conversations list
    } else {
      // Message silently dropped — user must refresh
    }
  }
}
```

If a `conversation_message` arrives while the user is on a different tab, the message is ignored. When the user navigates back, the view is stale. This is the bug Darron reported — Jim's Discord replies went to the database but never appeared in the UI because the WebSocket event arrived while Darron was on a different tab.

With React + Zustand:
```typescript
function dispatchWsMessage(data: any) {
  if (data.type === 'conversation_message') {
    // ALWAYS update store, no checking currentModule
    store.addConversationMessage(data.conversation_id, message);
    // React components subscribed to this conversation will re-render automatically
  }
}
```

## Key Decisions

### DEC-062: WebSocket Provider Architecture

**Context**: Need a way to manage WebSocket connection lifecycle in React and ensure all components can access real-time data.

**Options Considered**:
1. **React Context Provider** — Wrap app with provider, components access via useContext
   - ✅ Standard React pattern for global state
   - ✅ Connection lifecycle managed in one place
   - ✅ Easy to test (mock context)
   - ❌ Additional wrapper layer
2. **Direct Zustand integration** — WebSocket logic inside Zustand store
   - ✅ Fewer layers
   - ❌ Harder to test WebSocket logic
   - ❌ Violates separation of concerns (store should be data, not I/O)
3. **useEffect in App.tsx** — Setup WebSocket in App component
   - ✅ Simplest implementation
   - ❌ Harder to share connection status with components
   - ❌ Re-mounts on hot reload lose connection

**Decision**: Use React Context Provider pattern. WebSocket connection managed by `WebSocketProvider`, status exposed via context, messages dispatched to Zustand store. Clean separation: provider handles I/O, store handles data, components subscribe to store slices.

**Consequences**:
- WebSocket lifecycle centralized in one provider
- Connection status accessible to all components via `useWebSocket()` hook
- Easy to mock for testing (mock the context)
- Store remains pure data with no I/O logic

## Code Changes

### Files Created

1. `src/ui/react-admin/src/providers/WebSocketProvider.tsx` (141 lines) — WebSocket connection manager with auto-reconnect
2. `src/ui/react-admin/src/store/index.ts` (316 lines) — Zustand store with slices for all data domains
3. `src/ui/react-admin/src/store/wsDispatcher.ts` (59 lines) — Routes WebSocket messages to correct store slice
4. `src/ui/react-admin/src/types/index.ts` (180 lines) — TypeScript types for Conversation, Message, etc.
5. `src/ui/react-admin/src/hooks/useVisibilitySync.ts` (71 lines) — Visibility-aware sync hook

### Files Modified

1. `src/ui/react-admin/src/App.tsx` — Wrapped with WebSocketProvider, imported store
2. `src/ui/react-admin/src/components/StatusBar.tsx` — Read `wsConnected` and `lastCycleAt` from store
3. `src/ui/react-admin/src/pages/ConversationsPage.tsx` — Basic store integration test

### Build Output

- Vite build successful
- Output at `react-admin-dist/` works at `/admin-react/`
- StatusBar shows real-time connection status
- ~200KB gzipped total

## Next Steps

Phase 3 will port the remaining placeholder modules to match feature parity with the original admin:
- Work tab (tasks + goals)
- Projects tab (portfolio)
- Supervisor tab (cycles + proposals)
- Reports tab (digests + analytics)
- Products tab (product factory)

All modules will read from the central Zustand store created in this phase.

## Documentation

- **CURRENT_STATUS.md** updated with Phase 2 completion
- **DECISIONS.md** updated with DEC-062 (WebSocket provider architecture)
- **ARCHITECTURE.md** will be updated in next phase (no structural changes yet, just new files)
- This session note created

## Cost

- Implementation: ~$0 (file creation, no LLM usage for implementation)
- Documentation task: ~$0.20 (Sonnet)
- Total: ~$0.20
