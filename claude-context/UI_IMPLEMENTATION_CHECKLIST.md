# UI Implementation Checklist — Archive & Modify-Title Features

**Backend Status:** ✅ Complete
**Frontend Status:** ⏳ Ready for implementation

This checklist guides implementation of the archive and modify-title UI features in the Workshop module's admin interface.

## Backend API Reference

All endpoints are at `/api/conversations/...`

### Modify Title
```
PATCH /api/conversations/:id
Content-Type: application/json

{
  "title": "New Title"
}

Response: { success: true, conversation: {...} }
```

### Archive Thread
```
POST /api/conversations/:id/archive

Response: { success: true, conversation: { ..., archived_at: "2026-03-01T12:45:00Z" } }
```

### Unarchive Thread
```
POST /api/conversations/:id/unarchive

Response: { success: true, conversation: { ..., archived_at: null } }
```

### List Conversations (with archive filter)
```
GET /api/conversations                      # Excludes archived by default
GET /api/conversations?include_archived=true  # Includes archived

Response: { success: true, conversations: [...] }
```

### List Grouped (with archive filter)
```
GET /api/conversations/grouped                      # Excludes archived by default
GET /api/conversations/grouped?include_archived=true  # Includes archived

Response: { success: true, periods: { today: {...}, this_week: {...}, ... } }
```

### Send Message (auto-reactivates archived)
```
POST /api/conversations/:id/messages
Content-Type: application/json

{
  "content": "Message text",
  "role": "human"  # Optional, defaults to 'human'
}

Response: { success: true, message: {...} }

Note: If conversation has archived_at set, it will be automatically cleared
```

## UI Components to Implement

### 1. Thread Header Modifications

**Location:** Workshop module thread detail view (admin.ts)

#### Add Inline Title Editor
- [ ] Click title to enter edit mode
- [ ] Textbox appears with current title
- [ ] Enter key saves (calls PATCH endpoint)
- [ ] Escape cancels edit
- [ ] Display loading state while saving
- [ ] Show error toast if PATCH fails

```typescript
// Pseudo-code
async function updateThreadTitle(conversationId: string, newTitle: string) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });

    if (!response.ok) {
      throw new Error(`Failed to update title: ${response.statusText}`);
    }

    const data = await response.json();
    // Update local state with new conversation
    updateConversation(data.conversation);
  } catch (error) {
    showError(`Failed to update title: ${error.message}`);
  }
}
```

#### Add Archive Button
- [ ] Button in thread header (next to existing actions)
- [ ] Calls POST /api/conversations/:id/archive
- [ ] Shows loading state
- [ ] Hides thread from active list after success
- [ ] Optional: Show confirmation dialog before archiving

```typescript
// Pseudo-code
async function archiveThread(conversationId: string) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}/archive`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Failed to archive: ${response.statusText}`);
    }

    const data = await response.json();
    // Remove from active list
    removeFromThreadList(conversationId);
    showSuccess('Thread archived');
  } catch (error) {
    showError(`Failed to archive: ${error.message}`);
  }
}
```

### 2. Thread List UI Modifications

**Location:** Workshop module main thread list (admin.ts)

#### Add "View All" Toggle
- [ ] Toggle button near thread list header
- [ ] Label: "Show Archived" or similar
- [ ] When OFF (default): Only show active threads (archived_at IS NULL)
  - Call: `GET /api/conversations/grouped`
- [ ] When ON: Show all threads including archived
  - Call: `GET /api/conversations/grouped?include_archived=true`
- [ ] Preserve toggle state in component state or localStorage

```typescript
// Pseudo-code
const [showArchived, setShowArchived] = useState(false);

async function refreshThreadList() {
  try {
    const url = showArchived
      ? `/api/conversations/grouped?include_archived=true`
      : `/api/conversations/grouped`;

    const response = await fetch(url);
    const data = await response.json();

    // Update threads grouped by period
    updateGroupedConversations(data.periods);
  } catch (error) {
    showError(`Failed to load threads: ${error.message}`);
  }
}
```

#### Visual Distinction for Archived Threads
- [ ] Different background color or opacity (e.g., greyed out)
- [ ] Different text styling (e.g., italic, dimmed)
- [ ] Optional: "Archived" badge or label
- [ ] Optional: Show archived_at timestamp on hover

```css
/* Pseudo-code */
.thread-item.archived {
  opacity: 0.6;
  color: #666;
  font-style: italic;
}

.thread-item.archived::after {
  content: ' (archived)';
  color: #999;
  font-size: 0.85em;
}
```

### 3. Message Input Modifications

**Location:** Thread detail message input (admin.ts)

#### Allow Messaging to Archived Threads
- [ ] Keep message input enabled for archived threads
- [ ] No visual indication needed (backend handles auto-reactivate)
- [ ] After sending message:
  - Thread should be removed from archived section
  - Thread should reappear in active section (if showing active list)
  - Thread updated_at should be current timestamp

```typescript
// Pseudo-code
async function sendMessage(conversationId: string, content: string) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, role: 'human' })
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    // Refresh thread (if archived, it will be unarchived)
    const threadResponse = await fetch(`/api/conversations/${conversationId}`);
    const threadData = await threadResponse.json();

    // Re-sort threads list (archived thread is now active)
    refreshThreadList();
  } catch (error) {
    showError(`Failed to send message: ${error.message}`);
  }
}
```

### 4. Optional: Unarchive Button

**Location:** Archived thread header (only visible when viewing archived)

#### Add Unarchive Action
- [ ] Button to explicitly unarchive (alternative to message)
- [ ] Calls POST /api/conversations/:id/unarchive
- [ ] Moves thread back to active list
- [ ] Updates timestamp to current

```typescript
// Pseudo-code
async function unarchiveThread(conversationId: string) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}/unarchive`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Failed to unarchive: ${response.statusText}`);
    }

    const data = await response.json();
    // Update local state
    updateConversation(data.conversation);
    refreshThreadList();
    showSuccess('Thread unarchived');
  } catch (error) {
    showError(`Failed to unarchive: ${error.message}`);
  }
}
```

## Implementation Order

1. **Phase 1: Basic Archive Functionality**
   - [ ] Add archive button to thread header
   - [ ] Wire up POST /api/conversations/:id/archive
   - [ ] Remove archived threads from active list
   - [ ] Test archiving works

2. **Phase 2: Title Editing**
   - [ ] Add inline title editor to thread header
   - [ ] Wire up PATCH /api/conversations/:id
   - [ ] Test title updates work
   - [ ] Test error handling

3. **Phase 3: Archived Thread Management**
   - [ ] Add "Show Archived" toggle
   - [ ] Wire up ?include_archived=true query param
   - [ ] Style archived threads visually
   - [ ] Test filtering works

4. **Phase 4: Auto-Reactivation**
   - [ ] Test that messaging archived thread unarchives it
   - [ ] Verify thread moves back to active list
   - [ ] Optional: Add unarchive button

5. **Phase 5: Polish & Edge Cases**
   - [ ] Add confirmation dialogs
   - [ ] Improve error messages
   - [ ] Handle network failures gracefully
   - [ ] Add loading skeletons
   - [ ] Preserve scroll position

## Testing Checklist

- [ ] Can archive an active thread
- [ ] Archived thread disappears from default list
- [ ] Archived thread appears when "Show Archived" is ON
- [ ] Can modify thread title
- [ ] Title change persists on reload
- [ ] Can send message to archived thread
- [ ] Archived thread auto-reactivates after message
- [ ] Can unarchive a thread (if implemented)
- [ ] Archive/unarchive works with real network latency
- [ ] Error messages are shown on API failures
- [ ] Works across browser navigation

## Edge Cases to Handle

- [ ] What if archive request fails? (Show error, keep thread visible)
- [ ] What if title is empty? (Reject with validation error)
- [ ] What if thread is deleted while archived? (Show 404 error)
- [ ] What if network is slow? (Show loading state, disable buttons)
- [ ] What if user archives then immediately messages? (Both requests queue)
- [ ] What if thread is archived while viewing it? (Refresh thread detail)

## Performance Notes

- Archive/unarchive should be instant UI feedback (optimistic update optional)
- Title editing should debounce (optional: show unsaved indicator)
- Archive filter should work smoothly even with 1000+ threads
- Consider pagination if thread lists get very large
- WebSocket updates (if using real-time features) should handle archive state

## Accessibility Notes

- [ ] Archive button should have aria-label
- [ ] Title editor should have proper keyboard navigation (Enter/Escape)
- [ ] "Show Archived" toggle should be announced to screen readers
- [ ] Loading states should be announced
- [ ] Error messages should be accessible (color + icon + text)

## Documentation References

- API documentation: `claude-context/IMPLEMENTATION_SUMMARY.md`
- Database schema: `src/server/db.ts` (search for "conversations")
- Route handlers: `src/server/routes/conversations.ts`
- Test script: `test-archive-feature.sh` (for manual testing)
