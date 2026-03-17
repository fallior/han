# Quick Manual WebSocket Broadcast Test

**5-Minute Verification Guide**

## Setup (30 seconds)

1. Open browser: `http://localhost:3847/admin`
2. Open DevTools Console (F12)
3. Look for: `[WebSocket] Connected to wss://localhost:3847`

---

## Test 1: Conversations Module (2 minutes)

### Step 1: Post Human Message
1. Click **Conversations** tab
2. Select any conversation (or create new via "+" button)
3. Type: `Hey Jim, this is a WebSocket broadcast test`
4. Click "Send"

**Expected:**
- Message appears immediately in the list
- Shows "You" as sender
- Console shows: `[WebSocket] Received: conversation_message`

### Step 2: Wait for Agent Response
1. Wait 10-30 seconds
2. Jim/Human agent will respond (runs in background)

**Expected:**
- Jim's response appears automatically WITHOUT page refresh
- "Waiting for response..." indicator disappears
- Console shows: `[WebSocket] Received: conversation_message`
- Signal file created at `~/.han/signals/ws-broadcast` then deleted

---

## Test 2: Workshop Module (2 minutes)

### Step 1: Post to Jim Request Tab
1. Click **Workshop** tab
2. Select **Jim** persona at top
3. Click **Request** nested tab
4. Type: `Test request for signal-based broadcast`
5. Click "Send"

**Expected:**
- Message appears immediately in Jim Request tab
- Does NOT appear in other workshop tabs
- Console shows `discussion_type: 'workshop-jim-request'`

### Step 2: Wait for Jim Response
1. Wait 10-30 seconds

**Expected:**
- Response appears in real-time
- Only in this tab (Jim Request)
- Console confirms broadcast with correct `discussion_type`

---

## Test 3: Cross-Module Isolation (30 seconds)

1. After posting message in Workshop → Jim Request
2. Switch to **Conversations** tab (general)

**Expected:**
- Workshop message does NOT appear here
- Only general conversations shown

3. Switch to **Workshop** → **Leo** → **Question** tab

**Expected:**
- Jim Request message does NOT appear here
- Clean separation between tabs

---

## Verification Checklist

✅ Messages appear immediately after sending (no page refresh)
✅ Agent responses arrive in real-time
✅ WebSocket console logs show `conversation_message` events
✅ `discussion_type` routing works (messages stay in correct modules)
✅ No JavaScript errors in console
✅ Signal files at `~/.han/signals/` don't accumulate (check with `ls -la ~/.han/signals/`)

---

## Debugging

### No WebSocket Connection
```bash
# Restart server
cd ~/Projects/han/src/server
pkill -f "tsx server.ts"
nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &

# Refresh browser
```

### Messages Don't Appear in Real-Time
1. Check Console for WebSocket messages
2. Check server logs: `tail -50 /tmp/han-server.log`
3. Verify jim-human/leo-human are running:
   ```bash
   ps aux | grep -E "(jim-human|leo-human)" | grep -v grep
   ```

### Signal Files Accumulating
```bash
# Check signals directory
ls -la ~/.han/signals/

# Should be empty or only recent files (< 5 seconds old)
# If accumulating, check server logs for fs.watch errors
```

---

## What You're Testing

**Two broadcast paths:**

1. **Direct HTTP API → WebSocket** (line 293 in conversations.ts)
   - Used when YOU post a message via admin UI
   - Calls `broadcast()` directly from Express route

2. **Agent → Signal File → fs.watch → WebSocket** (jim-human.ts, leo-human.ts)
   - Used when Jim/Leo post responses
   - Writes to `~/.han/signals/ws-broadcast`
   - Server watches directory and relays to WebSocket clients

Both should result in real-time updates in the admin UI!

---

## Expected Console Output

```
[WebSocket] Connected to wss://localhost:3847
[WebSocket] Received message: {
  "type": "conversation_message",
  "conversation_id": "mmtu...",
  "discussion_type": "general",
  "message": {
    "id": "mmtu...",
    "role": "human",
    "content": "...",
    "created_at": "2026-03-17T..."
  }
}
```

When jim-human or leo-human responds, you'll see another `conversation_message` with `role: "jim"` or `role: "leo"`.
