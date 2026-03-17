# WebSocket Broadcast Testing — Summary

**Date**: 2026-03-17
**Task**: Manual testing guide for real-time admin UI updates

---

## What Was Done

### 1. Fixed Missing Function (Commit 4f2a48a)
- **Issue**: leo-human.ts called `writeBroadcastSignal()` but didn't define it
- **Fix**: Added the function (copied from jim-human.ts)
- **Impact**: Now both jim-human.ts and leo-human.ts write signal files when posting messages

### 2. Created Testing Resources (Commit 9ca9c76)

Three documents to guide manual testing:

| File | Purpose | Time Required |
|------|---------|---------------|
| `QUICK_MANUAL_TEST.md` | Fast 5-minute smoke test | 5 min |
| `WEBSOCKET_TESTING_CHECKLIST.md` | Comprehensive test plan (all scenarios) | 20-30 min |
| `test-websocket-broadcasts.sh` | Automated plumbing test (API + signal structure) | 1 min |

---

## How Broadcasting Works (Two Paths)

### Path 1: Direct HTTP API → WebSocket
**Used when**: You post a message via admin UI

```
Admin UI (POST /api/conversations/:id/messages)
    ↓
conversations.ts:293 calls broadcast()
    ↓
ws.ts sends to all connected WebSocket clients
    ↓
Admin UI updates in real-time
```

**Files involved**:
- `src/server/routes/conversations.ts` (line 293)
- `src/server/ws.ts` (broadcast function)

---

### Path 2: Agent → Signal File → WebSocket
**Used when**: Jim/Leo agents respond to messages

```
jim-human.ts or leo-human.ts postMessage()
    ↓
Writes JSON to ~/.han/signals/ws-broadcast
    ↓
server.ts fs.watch() detects new file (line 294)
    ↓
processBroadcastSignal() reads + deletes file (line 265)
    ↓
Calls broadcast() to relay to WebSocket clients
    ↓
Admin UI updates in real-time
```

**Files involved**:
- `src/server/jim-human.ts` (writeBroadcastSignal at line 160)
- `src/server/leo-human.ts` (writeBroadcastSignal at line 142)
- `src/server/server.ts` (fs.watch at line 294, processBroadcastSignal at line 265)
- `src/server/ws.ts` (broadcast function)

**Why signal files?** Jim/Leo agents run in separate Node processes. Signal files provide cross-process IPC without requiring HTTP calls or shared memory.

---

## Critical Fields in Broadcast Payload

```json
{
  "type": "conversation_message",
  "conversation_id": "mmtu...",
  "discussion_type": "general",  ← CRITICAL for routing
  "message": {
    "id": "mmtu...",
    "role": "human",
    "content": "...",
    "created_at": "2026-03-17T..."
  }
}
```

**`discussion_type` values**:
- `general` → Conversations tab
- `memory` → Memory Discussions tab
- `workshop-jim-request` → Workshop → Jim → Request
- `workshop-jim-report` → Workshop → Jim → Report
- `workshop-leo-question` → Workshop → Leo → Question
- `workshop-leo-postulate` → Workshop → Leo → Postulate
- `workshop-darron-thought` → Workshop → Darron → Thought
- `workshop-darron-musing` → Workshop → Darron → Musing

Admin UI filters incoming WebSocket messages by `discussion_type` at `src/ui/admin.ts:394`.

---

## Testing Instructions

### Quick Test (5 minutes)
```bash
# Open admin UI
xdg-open http://localhost:3847/admin  # or just open in browser

# Follow QUICK_MANUAL_TEST.md
# - Post message to Conversations
# - Wait for Jim response
# - Post message to Workshop → Jim Request
# - Verify real-time updates and console logs
```

### Comprehensive Test (20-30 minutes)
```bash
# Follow WEBSOCKET_TESTING_CHECKLIST.md
# Tests all 6 workshop tabs, cross-module isolation,
# server restart resilience, and signal cleanup
```

### Automated Plumbing Test (1 minute)
```bash
./test-websocket-broadcasts.sh

# This verifies:
# - Server is running and listening on port 3847
# - Can create conversations via API
# - Can post messages via API
# - discussion_type is included in responses
# - (Does NOT test agent responses — requires manual testing)
```

---

## What to Look For

### ✅ Success Indicators

1. **In Browser DevTools Console**:
   ```
   [WebSocket] Connected to wss://localhost:3847
   [WebSocket] Received message: { type: 'conversation_message', ... }
   ```

2. **In Admin UI**:
   - Messages appear immediately after clicking "Send"
   - Agent responses arrive without page refresh (10-30 seconds)
   - "Waiting for response..." indicator disappears when response arrives

3. **In Signals Directory**:
   ```bash
   ls -la ~/.han/signals/
   # Should be empty or only very recent files (< 5 seconds old)
   ```

4. **In Server Logs** (when agent responds):
   ```bash
   tail -f /tmp/han-server.log
   # Look for:
   [Server] Broadcast signal relayed: conversation_message for mmtu...
   ```

---

### ❌ Failure Indicators

1. **WebSocket not connecting**:
   - Console shows: `WebSocket connection failed`
   - Fix: Restart server, check port 3847

2. **Messages not appearing in real-time**:
   - Page refresh required to see new messages
   - Check: WebSocket connected? Console errors?

3. **Signal files accumulating**:
   ```bash
   ls -la ~/.han/signals/
   # Many ws-broadcast files (> 10)
   ```
   - Means server isn't reading/deleting them
   - Check server logs for fs.watch errors

4. **Cross-contamination**:
   - Message in Workshop → Jim Request appears in Conversations tab
   - OR message in Conversations appears in Memory Discussions
   - Means `discussion_type` filtering broken at admin.ts:394

---

## Files Changed (Git History)

```bash
git log --oneline -10

4f2a48a fix: Add writeBroadcastSignal function to leo-human.ts
d90f602 feat: Add WebSocket broadcast signal to jim-human.ts postMessage()
28c8ebf feat: Implement signal-based broadcast trigger in main server
b07e03c chore: Design cross-process broadcast mechanism for human agents
37f22f5 chore: Normalize supervisor-worker.ts broadcast shape to match conversations.ts
```

**Key changes**:
- jim-human.ts: Added `writeBroadcastSignal()` at postMessage
- leo-human.ts: Added `writeBroadcastSignal()` at postMessage (this commit)
- server.ts: Added `fs.watch()` on signals directory + `processBroadcastSignal()`
- conversations.ts: Already had `broadcast()` call at line 293 (includes `discussion_type`)
- supervisor-worker.ts: Normalized broadcast payload shape

---

## Next Steps

1. **Run Quick Manual Test** (QUICK_MANUAL_TEST.md) — 5 minutes
2. **If issues found**: Check server logs, WebSocket console, signal files
3. **If all works**: Run full checklist (WEBSOCKET_TESTING_CHECKLIST.md) — 20-30 minutes
4. **Optional**: Run automated test (`./test-websocket-broadcasts.sh`) for regression testing

---

## Architecture Notes

**Why two broadcast paths?**
- Path 1 (direct HTTP→WS) is fast for user-initiated messages
- Path 2 (signal files) enables cross-process communication for agents
- Both converge on the same `broadcast()` function in ws.ts

**Signal file lifecycle**:
1. Agent writes JSON to `~/.han/signals/ws-broadcast`
2. fs.watch() fires (within 100ms typically)
3. Server reads file, calls broadcast(), deletes file
4. Total latency: < 200ms from agent write to WebSocket send

**Fallback polling**: Even if fs.watch() fails, server polls signals directory every 5 seconds (line 305 in server.ts).

**Debouncing**: 100ms debounce on fs.watch (line 299) prevents double-fires from file write + chmod events.

---

## Contact

If you find issues during manual testing:
- Check server logs: `tail -100 /tmp/han-server.log`
- Check signals: `ls -la ~/.han/signals/`
- Check agent processes: `ps aux | grep -E "(jim-human|leo-human)"`

**Task completed**: Testing guides created, ready for manual verification.
