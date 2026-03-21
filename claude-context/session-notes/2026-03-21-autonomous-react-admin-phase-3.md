# React Admin Phase 3: Workshop Tab Migration

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Type**: Implementation
**Goal**: Phase 3: React Admin UI — Workshop Tab Migration (highest-value, most complex tab)

## Summary

Migrated the Workshop tab — the most complex and highest-value tab in the admin UI — from vanilla TypeScript to React with full feature parity. The Workshop tab is where Darron spends most of his time interacting with Jim (Supervisor), Leo (Philosopher), and Jemma (Dispatcher). The original vanilla admin version had multiple state interaction bugs due to complex nested state management (persona + nested tab + period filter + selected thread + search + archive toggle).

## What Was Built

### Components Created

**Workshop-specific components** (dedicated components for complex nested tab state):
- `WorkshopPage.tsx` (79 lines) — Main page container, wires persona/nested tabs, thread list/detail layout
- `PersonaTabBar.tsx` (74 lines) — Horizontal tabs for 4 personas with colour-coded active state
- `NestedTabBar.tsx` (101 lines) — Dynamic sub-tabs that change based on selected persona
- `ThreadList.tsx` (222 lines) — Left panel with period filter, search, archive toggle, thread cards
- `ThreadDetail.tsx` (189 lines) — Right panel with messages, markdown, input, resolve/archive actions
- `JemmaView.tsx` (189 lines) — Special view for Jemma persona (Discord messages + delivery stats)

**State management**:
- `workshopSlice.ts` (92 lines) — Zustand slice for Workshop state
- `workshopStore.ts` (95 lines) — Workshop-specific store configuration and selectors

**Shared components reused**:
- `MessageBubble.tsx` (72 lines) — Role-based message styling (created in Phase 2)
- `MarkdownRenderer.tsx` (93 lines) — Simple markdown rendering (created in Phase 2)

### Features Implemented

**Three-persona navigation**:
- 4 persona buttons: Supervisor Jim (purple), Philosopher Leo (green), Dreamer Darron (blue), Dispatcher Jemma (amber)
- Active persona indicated by 3px solid bottom border in persona colour + bold text
- Each persona has 2 nested tabs (e.g. Jim → Requests/Reports, Leo → Questions/Postulates)

**Six discussion types** (persona + nested tab combinations):
- `jim-request` — Jim's Requests tab
- `jim-report` — Jim's Reports tab
- `leo-question` — Leo's Questions tab
- `leo-postulate` — Leo's Postulates tab
- `darron-thought` — Darron's Thoughts tab
- `darron-musing` — Darron's Musings tab

**ThreadList features**:
- Period filter buttons: All, Today, This Week, Last Week, This Month, Older (with count badges)
- Archive toggle to show/hide archived threads
- Debounced search input (300ms delay) that searches thread titles
- Thread cards showing: unread dot, title, time since update, status badge, message count
- Active thread highlighted with blue border
- Threads grouped by period server-side (API returns grouped structure)

**ThreadDetail features**:
- Message bubbles with role-based styling:
  - Human: blue background, right-aligned
  - Supervisor (Jim): purple left border, left-aligned
  - Leo: green left border, left-aligned
- Markdown rendering for message content
- Draft persistence in localStorage (keyed by conversation ID)
- Resolve/reopen/archive action buttons
- Auto-scroll to bottom when new messages arrive
- Message input textarea with send button

**Jemma special view**:
- Fetches from `GET /api/jemma/status` instead of conversations API
- Messages tab: recent Discord messages with Haiku classification results
- Stats tab: delivery statistics and routing metrics

**Real-time WebSocket updates**:
- When `conversation_message` event arrives for currently-viewed thread, message appears immediately
- Store receives message unconditionally (no checking which tab is active)
- Components subscribe to conversation state and React re-renders automatically
- Fixes core vanilla admin bug where messages arriving on inactive tab got silently dropped

### State Management

**Zustand store state added**:
- `persona` — Current persona: 'jim' | 'leo' | 'darron' | 'jemma'
- `nestedTab` — Current discussion_type (e.g. 'jim-request', 'leo-question')
- `period` — Current period filter: 'all' | 'today' | 'this_week' | 'last_week' | 'this_month' | 'older'
- `showArchived` — Boolean toggle for archived threads
- `selectedThread` — Record<string, string | null> keyed by nested tab (preserves selected thread when switching tabs)

**State actions**:
- `setPersona(persona)` — Switch persona (also updates nestedTab to first tab of new persona)
- `setNestedTab(tab)` — Switch nested tab within current persona
- `setPeriod(period)` — Change period filter
- `setShowArchived(show)` — Toggle archived thread visibility
- `selectThread(threadId)` — Select thread (stored per nested tab)

## Key Decisions

### DEC-063: Dedicated Workshop Components vs Shared Components

**Context**: Workshop tab has significantly more complex state than Conversations/Memory tabs:
- Nested tabs (persona → discussion type)
- Persona-specific colours that change based on active persona
- Special Jemma view that doesn't use conversations API
- Selected thread state preserved per nested tab (not just one global selected thread)

**Options considered**:
1. Extend shared ThreadListPanel/ThreadDetailPanel with props for Workshop complexity
2. Create dedicated Workshop components (ThreadList, ThreadDetail)

**Decision**: Create dedicated Workshop components.

**Reasoning**:
- Shared components would need 8+ props to handle persona colours, nested tabs, Jemma special case
- Props complexity would make shared components harder to understand and maintain
- Workshop has fundamentally different navigation model (persona → nested tab) vs flat tab model (Conversations, Memory)
- Code duplication (~400 lines) is acceptable trade-off for clarity and maintainability

**Consequences**:
- ThreadList.tsx and ThreadDetail.tsx are Workshop-specific
- MessageBubble and MarkdownRenderer remain shared (no Workshop-specific logic)
- If other tabs need nested navigation in future, can extract shared patterns then

### DEC-064: Selected Thread State Keyed by Nested Tab

**Context**: Workshop has 6 nested tabs (jim-request, jim-report, leo-question, leo-postulate, darron-thought, darron-musing). Users frequently switch between tabs and expect the previously-selected thread to remain selected when they return to a tab.

**Options considered**:
1. Single global `selectedThreadId` — switching tabs clears selection
2. `selectedThread: Record<string, string | null>` — keyed by nested tab, preserves selection per tab

**Decision**: Selected thread state keyed by nested tab.

**Reasoning**:
- User mental model: "I was reading thread X in Jim's Requests, switch to Leo's Questions to check something, then return to Jim's Requests — thread X should still be selected"
- Flat global state would require user to re-select thread after every tab switch
- 6 keys in a Record is negligible memory overhead
- Implementation is simple: `selectedThread[nestedTab] = threadId`

**Consequences**:
- When switching nested tabs, previously-selected thread persists
- Each nested tab maintains its own selected thread state
- If user opens same thread ID in different nested tabs (unlikely but possible), each tab tracks it independently

## Integration

**Router**: Added `/workshop` route in App.tsx rendering WorkshopPage component.

**Zustand store**: Workshop slice imported into main store (`store/index.ts`). Store composition pattern allows Workshop state to be independent but accessible via same `useStore()` hook.

**WebSocket**: No Workshop-specific WebSocket handling needed. Existing `conversation_message` dispatcher updates conversation state, Workshop components subscribe via `useStore()`, React re-renders automatically.

**API endpoints used**:
- `GET /api/conversations/grouped?type={discussion_type}` — Thread list grouped by period
- `GET /api/conversations/{id}` — Single thread with messages
- `POST /api/conversations` — Create new thread
- `POST /api/conversations/{id}/messages` — Send message
- `POST /api/conversations/{id}/resolve` — Resolve thread
- `POST /api/conversations/{id}/reopen` — Reopen thread
- `POST /api/conversations/{id}/archive` — Archive thread
- `POST /api/conversations/{id}/unarchive` — Unarchive thread
- `GET /api/conversations/search?q=...&type={discussion_type}` — Search threads
- `GET /api/jemma/status` — Jemma persona data (special case)

## Build Verification

**TypeScript compilation**: Clean, no errors.

**Vite build**: Successful, output to `react-admin-dist/`.

**Runtime verification**: Workshop tab fully functional at `/admin-react#/workshop`. End-to-end test performed:
1. Navigate to Workshop tab
2. Select Jim persona → verify Jim's nested tabs appear (Requests, Reports)
3. Select Requests nested tab → verify thread list loads with jim-request threads
4. Select a thread → verify messages display in ThreadDetail
5. Send a message → verify message posts to API
6. Receive WebSocket response → verify message appears immediately in ThreadDetail
7. Switch to Leo persona → verify Leo's nested tabs appear (Questions, Postulates)
8. Switch back to Jim → verify previously-selected thread still selected
9. Test period filter → verify filtering works
10. Test search → verify search works
11. Test archive toggle → verify archived threads show/hide
12. Select Jemma persona → verify JemmaView renders with Messages/Stats tabs

All tests passed.

## Code Changes

**Files created** (8 files, 941 lines total):
- `src/ui/react-admin/src/pages/WorkshopPage.tsx` (79 lines)
- `src/ui/react-admin/src/components/workshop/PersonaTabBar.tsx` (74 lines)
- `src/ui/react-admin/src/components/workshop/NestedTabBar.tsx` (101 lines)
- `src/ui/react-admin/src/components/workshop/ThreadList.tsx` (222 lines)
- `src/ui/react-admin/src/components/workshop/ThreadDetail.tsx` (189 lines)
- `src/ui/react-admin/src/components/workshop/JemmaView.tsx` (189 lines)
- `src/ui/react-admin/src/store/workshopSlice.ts` (92 lines)
- `src/ui/react-admin/src/store/workshopStore.ts` (95 lines)

**Files modified** (2 files, +4 lines total):
- `src/ui/react-admin/src/store/index.ts` (+2 lines: import workshop slice, add to store)
- `src/ui/react-admin/src/App.tsx` (+2 lines: import WorkshopPage, add /workshop route)

**Shared components reused** (no changes, already existed from Phase 2):
- `src/ui/react-admin/src/components/shared/MessageBubble.tsx` (72 lines)
- `src/ui/react-admin/src/components/shared/MarkdownRenderer.tsx` (93 lines)

## Why This Matters

**Eliminates most bug-prone tab**: The Workshop tab in the vanilla admin had frequent state bugs due to complex interactions between persona tabs, nested tabs, selected thread, period filter, search, and archive toggle. Multiple conditional branches checking `currentModule === 'workshop' && currentWorkshopPersona === 'jim'` made the code brittle.

**Better state management**: Zustand + React provides proper state isolation and automatic re-rendering. No more manual DOM manipulation or forgotten state updates.

**Real-time updates work correctly**: The core WebSocket bug (messages arriving on inactive tab get dropped) is fixed. Messages update the store unconditionally, components subscribe to state, React re-renders automatically.

**Foundation for sunsetting vanilla admin**: With Workshop (the most complex tab) now working in React, confidence increases that remaining tabs can be migrated. Eventually the vanilla admin can be removed, eliminating ~4,000 lines of brittle TypeScript with manual DOM manipulation.

**User experience**: Darron can now use the Workshop tab without state bugs, manual refresh, or lost messages. The interface is faster, more responsive, and less error-prone.

## Next Steps

**Immediate**: None. Phase 3 is complete and verified working.

**Future phases**:
- **Phase 6 (future)**: Polish and refinement — keyboard shortcuts, drag-to-resize thread panel, markdown editor toolbar, thread bulk actions
- **Phase 7 (future)**: Performance optimisation — virtualized thread lists for 1000+ threads, memo-ized expensive components, code splitting per tab
- **Phase 8 (future)**: Mobile-responsive Workshop tab — collapsible persona tabs, swipe gestures for nested tabs, bottom sheet for thread detail

**Vanilla admin sunset**: Once all tabs are migrated and battle-tested in production, deprecate the vanilla admin UI and remove admin.ts/admin.html (~4,000 lines).

## Lessons Learned

**Dedicated components worth it for complex state**: Workshop's nested tab model justified dedicated components rather than extending shared components. The clarity and maintainability benefits outweigh the code duplication cost.

**State keyed by context prevents re-selection friction**: Preserving selected thread per nested tab dramatically improves UX. Users can switch tabs freely without losing their place.

**Build verification is essential**: The build process caught several TypeScript issues (missing imports, wrong prop types) that would have been runtime errors. Always run `npm run build` before considering a phase complete.

**WebSocket unconditional updates are correct**: Initial instinct was to check "is this the active tab?" before updating state. Resisting that instinct and updating unconditionally is what makes real-time updates work correctly.
