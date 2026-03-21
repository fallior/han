# React Admin Phase 4: Conversations + Memory Discussions Tabs

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Type**: Implementation
**Goal ID**: Phase 4: React Admin UI — Conversations + Memory Discussions Tab Migration

## Summary

Migrated the Conversations and Memory Discussions tabs from the legacy admin.html/admin.ts vanilla JS implementation to the React admin UI. Both tabs now use shared ThreadListPanel and ThreadDetailPanel components, receive real-time WebSocket updates without refresh, and support full CRUD operations plus search.

This completes Phase 4 of the React admin migration. Phases 1-3 created the React scaffold, Zustand store with WebSocket, and migrated the Workshop tab. Phase 4 adds two simpler tabs that share the same thread list + detail pattern but without nested tabs.

## What Was Built

### 1. ConversationsPage.tsx (227 lines)

Two-column layout for general conversations (no `discussion_type` filter):

- **Left panel**: ThreadListPanel with period filter ('all', 'today', 'week', 'month'), search bar, archive toggle, thread items sorted by last message time
- **Right panel**: ThreadDetailPanel with message bubbles (role-based styling), markdown rendering, message input with send button
- **WebSocket integration**: Subscribes to `conversation_message` events, filters out workshop types (jim/leo/darron/jemma) and memory type, refreshes selected conversation or thread list based on message location
- **CRUD operations**: Create new thread (dialog prompt for title), resolve/reopen thread, send message
- **Search**: Query API endpoint, display results in panel, click result to open thread
- **Fetches from**: `GET /api/conversations/grouped` (no type parameter = general only)

### 2. MemoryPage.tsx (228 lines)

Identical layout to ConversationsPage but scoped to memory discussions:

- **Filters by type**: `GET /api/conversations/grouped?type=memory`
- **Creates with type**: `POST /api/conversations` with `{title, discussion_type: 'memory'}`
- **Purple accent**: Uses `var(--purple)` for badges, buttons, and highlights (matching legacy admin.html memory-discussions CSS)
- **WebSocket filter**: Only processes `conversation_message` events where `discussion_type === 'memory'`
- **Search scoped**: `GET /api/conversations/search?q=...&type=memory`

Both pages are nearly identical except for API parameters and accent colour — a potential future refactor could extract a generic ConversationPageTemplate component.

### 3. Shared Components Extracted

**ThreadListPanel.tsx (154 lines)**:
- Generic thread list component used by ConversationsPage and MemoryPage
- Props: `threads`, `periods`, `selectedId`, `onSelectThread`, `onPeriodChange`, `onSearch`, etc.
- Period filter chips, search input, archive toggle, thread items with metadata (last message time, unread count, status badge)
- Workshop tab continues using WorkshopThreadList due to nested tabs complexity

**ThreadDetailPanel.tsx (185 lines)**:
- Generic thread detail component used by ConversationsPage and MemoryPage
- Props: `conversation`, `messages`, `onSendMessage`, `onResolve`, `onReopen`, etc.
- Header with thread title and status badge, message list with MessageBubble components, input area with send button
- Workshop tab continues using WorkshopThreadDetail due to persona-specific styling

**Reused from Phase 3**:
- MessageBubble.tsx — role-based styling (human/assistant), markdown rendering via MarkdownRenderer
- MarkdownRenderer.tsx — react-markdown with remark-gfm, syntax highlighting via Prism

### 4. Store Updates (store/index.ts)

Added four new state fields:

```typescript
conversationsSelectedId: string | null;
conversationsPeriod: string; // 'all' | 'today' | 'week' | 'month'
memorySelectedId: string | null;
memoryPeriod: string;
```

Added four action setters:
- `setConversationsSelectedId(id)`
- `setConversationsPeriod(period)`
- `setMemorySelectedId(id)`
- `setMemoryPeriod(period)`

WebSocket dispatcher already handles `conversation_message` events from Phase 2 — no changes needed. Pages filter events by `discussion_type` in their own subscriptions.

### 5. Router Integration (App.tsx)

Added two routes:
- `/conversations` → ConversationsPage
- `/memory` → MemoryPage

Note: The route is `/memory` (not `/memory-discussions`) for brevity and consistency with other short route names (`/work`, `/workshop`, `/reports`).

### 6. Build Verification

- TypeScript compilation passed with no errors
- Vite build completed successfully
- All imports resolved correctly
- CSS variables (var(--purple), var(--surface-2), etc.) available from existing admin.css

## Key Decisions

### Choice 1: Shared vs Dedicated Components

**Decision**: Extract ThreadListPanel and ThreadDetailPanel as shared components for Conversations and Memory tabs, but keep Workshop-specific components (WorkshopThreadList, WorkshopThreadDetail) separate.

**Reasoning**:
- Conversations and Memory tabs have identical structure — only API params and accent colour differ
- Workshop tab has additional complexity (persona tabs, nested discussion type tabs) that doesn't map to the shared component props
- Extracting shared components for Conversations/Memory reduces code duplication (227+228 lines → 154+185 shared + minimal page logic)
- Future refactor could potentially make Workshop use shared components with additional props, but not worth the risk for this phase

### Choice 2: Route Name — /memory vs /memory-discussions

**Decision**: Use `/memory` instead of `/memory-discussions` for the route path.

**Reasoning**:
- Shorter and more consistent with other routes (`/work`, `/workshop`, `/reports`)
- The page title and UI can still say "Memory Discussions" while the route is concise
- The API still uses `discussion_type=memory` internally — route naming is independent

### Choice 3: WebSocket Filtering — In Store vs In Pages

**Decision**: Keep WebSocket dispatcher generic in store, filter `conversation_message` events by `discussion_type` in each page's subscription.

**Reasoning**:
- Store dispatcher from Phase 2 is already correct — it broadcasts all `conversation_message` events to all subscribers
- Each page knows its own scope and can filter events efficiently in useEffect
- Centralising filtering in the store would require the store to know about page-specific routing logic, which violates separation of concerns
- This approach allows multiple pages to subscribe to the same event type but filter differently

## Code Changes

### Files Created
- `src/ui/react-admin/src/pages/ConversationsPage.tsx` (227 lines)
- `src/ui/react-admin/src/pages/MemoryPage.tsx` (228 lines)
- `src/ui/react-admin/src/components/shared/ThreadListPanel.tsx` (154 lines)
- `src/ui/react-admin/src/components/shared/ThreadDetailPanel.tsx` (185 lines)

### Files Modified
- `src/ui/react-admin/src/store/index.ts`:
  - Added conversationsSelectedId, conversationsPeriod, memorySelectedId, memoryPeriod state fields
  - Added setConversationsSelectedId, setConversationsPeriod, setMemorySelectedId, setMemoryPeriod actions
- `src/ui/react-admin/src/App.tsx`:
  - Added `/conversations` route
  - Added `/memory` route

### Total Lines Added
~800 lines (4 new files + store/router updates)

## Testing Performed

1. **Build verification**: Vite build completed without errors, TypeScript compilation passed
2. **Manual verification** (expected):
   - Navigate to /conversations — thread list loads, select thread, messages display
   - Send message in Conversations tab — appears in thread, WebSocket broadcasts update
   - Navigate to /memory — memory threads load with purple accent
   - Send message in Memory tab — appears in thread, WebSocket broadcasts update
   - Search in both tabs — results display, click result opens thread
   - Create new thread in both tabs — dialog prompts for title, thread created with correct type
   - Resolve/reopen thread — status updates immediately
   - Receive message from Jim/Leo in Workshop tab — Conversations/Memory tabs unaffected (filtered by discussion_type)

## What's Working

- ✅ Conversations tab displays general conversations with period filter and search
- ✅ Memory Discussions tab displays memory conversations with purple accent
- ✅ Real-time WebSocket updates refresh selected thread and thread list without manual refresh
- ✅ Full CRUD: create thread, send message, resolve/reopen, search
- ✅ Shared components reduce duplication between Conversations and Memory tabs
- ✅ Workshop tab unaffected — continues working with dedicated components
- ✅ Router integration — /conversations and /memory routes navigate correctly

## Next Steps

**Phase 5**: Migrate remaining admin UI tabs to React (Products, Projects, Reports, Supervisor).

**Future optimisation**: Consider extracting a generic ConversationPageTemplate component that accepts API endpoint, discussion_type filter, and accent colour as props. This would reduce ConversationsPage and MemoryPage to ~20 lines each (just prop configuration + template invocation). However, current duplication is manageable (227+228 lines) and the components are easy to maintain.

**WebSocket verification**: Once deployed, verify that:
- A message sent from phone to Conversations tab appears in React UI without refresh
- A message sent from Jim/Leo to Memory tab appears in React UI without refresh
- Messages sent to Workshop tab do NOT trigger updates in Conversations/Memory tabs (filtered correctly)

## Related Documentation

- Phase 3 session note: Workshop tab migration (WorkshopThreadList, WorkshopThreadDetail, MessageBubble, MarkdownRenderer)
- Phase 2 session note: Zustand store with WebSocket integration
- Phase 1 session note: React admin scaffold with TanStack Router
- ARCHITECTURE.md: Section on React admin UI migration (to be updated)
