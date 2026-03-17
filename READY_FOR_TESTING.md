# Ready for Manual Testing ✓

**Date**: 2026-03-17 10:05 AEST
**Status**: All components verified and running with latest code

---

## ✅ Pre-Flight Checks Complete

### 1. Code Changes Committed
```bash
git log --oneline -5
```
```
8ec38d9 docs: Add WebSocket broadcast testing summary and architecture
9ca9c76 docs: Add comprehensive WebSocket broadcast testing guides
4f2a48a fix: Add writeBroadcastSignal function to leo-human.ts
d90f602 feat: Add WebSocket broadcast signal to jim-human.ts postMessage()
28c8ebf feat: Implement signal-based broadcast trigger in main server
```

### 2. Server Running ✓
- Main server (PID 3693819): Listening on port 3847 (HTTPS)
- fs.watch() monitoring `~/.han/signals/` for broadcast signals
- Polling fallback active (every 5 seconds)

### 3. Human Agents Running ✓
- **leo-human.ts**: Running with today's code (started 10:04:50)
- **jim-human.ts**: Running with today's code (started 10:05:17)
- Both have `writeBroadcastSignal()` function defined

### 4. Signal Directory Ready ✓
```bash
ls -la ~/.han/signals/
# Empty — ready to receive signal files
```

### 5. Testing Documentation Available ✓
- `QUICK_MANUAL_TEST.md` — 5-minute smoke test
- `WEBSOCKET_TESTING_CHECKLIST.md` — Comprehensive 20-30 min test plan
- `TESTING_SUMMARY.md` — Architecture and debugging reference
- `test-websocket-broadcasts.sh` — Automated plumbing test

---

## 🚀 Start Testing

### Option 1: Quick Test (5 minutes)
```bash
# Open admin UI in browser
xdg-open http://localhost:3847/admin

# Follow instructions in QUICK_MANUAL_TEST.md
```

### Option 2: Comprehensive Test (20-30 minutes)
```bash
# Follow WEBSOCKET_TESTING_CHECKLIST.md
# Tests all 6 workshop tabs, cross-module isolation, etc.
```

### Option 3: Automated Plumbing Test (1 minute)
```bash
./test-websocket-broadcasts.sh
```

---

## 📋 What You're Testing

Two broadcast mechanisms working together:

### Path 1: Direct HTTP → WebSocket
When YOU post a message in admin UI:
```
POST /api/conversations/:id/messages
    ↓
conversations.ts calls broadcast() (line 293)
    ↓
WebSocket clients receive update
    ↓
Message appears in real-time
```

### Path 2: Agent → Signal File → WebSocket
When Jim/Leo responds:
```
jim-human.ts or leo-human.ts calls postMessage()
    ↓
Writes to ~/.han/signals/ws-broadcast
    ↓
server.ts fs.watch() detects file (line 294)
    ↓
processBroadcastSignal() reads and broadcasts (line 265)
    ↓
WebSocket clients receive update
    ↓
Response appears in real-time
```

---

## 🔍 What to Verify

1. **Real-time updates**: Messages appear without page refresh
2. **discussion_type routing**: Messages stay in correct modules
3. **Signal cleanup**: Files at `~/.han/signals/` don't accumulate
4. **Cross-module isolation**: Workshop messages don't leak to Conversations
5. **WebSocket stability**: No disconnections or errors in console
6. **All 6 workshop tabs**: Each receives only its own messages

---

## 🐛 If Issues Found

### WebSocket Not Connecting
```bash
# Check server
lsof -i :3847

# Restart if needed
cd ~/Projects/han/src/server
pkill -f "tsx server.ts"
nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &
```

### Messages Not Real-Time
```bash
# Check browser DevTools Console for errors
# Check server logs
tail -50 /tmp/han-server.log

# Verify agents running
ps aux | grep -E "(jim-human|leo-human)" | grep -v grep
```

### Signal Files Accumulating
```bash
# Check signals directory
ls -la ~/.han/signals/

# Should be empty or only very recent files
# If accumulating, check server logs:
tail -100 /tmp/han-server.log | grep -i signal
```

---

## 📊 Expected Results

### In Browser DevTools Console:
```
[WebSocket] Connected to wss://localhost:3847
[WebSocket] Received message: {
  "type": "conversation_message",
  "conversation_id": "mmtu...",
  "discussion_type": "general",
  "message": { ... }
}
```

### In Admin UI:
- ✅ Your message appears immediately after "Send"
- ✅ Agent response appears 10-30 seconds later (no refresh)
- ✅ "Waiting for response..." disappears when response arrives
- ✅ Messages stay in correct tabs (no cross-contamination)

### In Server Logs (when agent responds):
```bash
tail -f /tmp/han-server.log
# Look for:
[Server] Broadcast signal relayed: conversation_message for mmtu...
```

---

## 📝 Test Log Template

Copy this into your testing notes:

```
=== WebSocket Broadcast Manual Test ===
Date: 2026-03-17
Tester: Darron
Server Commit: 8ec38d9

[ ] Quick test (QUICK_MANUAL_TEST.md)
    [ ] Conversations module - human message
    [ ] Conversations module - Jim response
    [ ] Workshop - Jim Request message
    [ ] Workshop - Jim Request response

[ ] Comprehensive test (WEBSOCKET_TESTING_CHECKLIST.md)
    [ ] All 6 workshop tabs
    [ ] Cross-module isolation
    [ ] Server restart resilience
    [ ] Signal cleanup

Issues found:
(none / list below)

```

---

## ✨ You're All Set!

Open the admin UI and start testing. The system is ready:
- ✅ Code deployed
- ✅ Server running
- ✅ Agents running
- ✅ Signals directory clean
- ✅ Documentation available

**Next action**: Open `http://localhost:3847/admin` and follow `QUICK_MANUAL_TEST.md`
