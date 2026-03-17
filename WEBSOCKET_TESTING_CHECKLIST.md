# WebSocket Real-Time Updates — Manual Testing Checklist

**Date**: 2026-03-17
**Goal**: Verify WebSocket broadcasts work correctly for all message sources and admin UI modules

## Pre-Test Setup

### 1. Verify Server Status
```bash
# Check main server is running
ps aux | grep "tsx.*server.ts" | grep -v grep

# Check port 3847 is listening
lsof -i :3847

# Check human agents are running
ps aux | grep -E "(leo-human|jim-human)" | grep -v grep
```

### 2. Access Admin UI
1. Open browser to `http://localhost:3847/admin`
2. Open DevTools Console (F12)
3. Verify WebSocket connection established:
   ```
   Look for: [WebSocket] Connected to wss://localhost:3847
   ```

### 3. Monitor Signal Directory
```bash
# In separate terminal, watch signals directory
watch -n 1 'ls -la ~/.han/signals/'
```

---

## Test Scenarios

### Scenario 1: Conversations Module (General Type)

**Path**: Admin → Conversations tab

#### 1A. Human Message from Admin UI
1. Select any conversation (or create new one via API)
2. Type a test message in the input field
3. Click "Send" button
4. **Expected**:
   - Message appears immediately in the message list
   - No page refresh needed
   - Message shows "You" as sender
5. **Check DevTools Console** for:
   ```
   [WebSocket] Received: conversation_message
   ```

#### 1B. Jim/Human Response
1. After sending human message in 1A, wait for Jim/Human agent to respond
2. **Expected**:
   - Jim's response appears in real-time (within 5-30 seconds)
   - "Waiting for response..." indicator disappears
   - No page refresh needed
   - Message shows "Jim" as sender
3. **Check DevTools Console** for:
   ```
   [WebSocket] Received: conversation_message
   ```

---

### Scenario 2: Memory Discussions Module

**Path**: Admin → Memory Discussions tab

#### 2A. Human Message to Memory Discussion
1. Select any memory discussion (or create one)
2. Type a test message
3. Click "Send"
4. **Expected**:
   - Message appears immediately
   - Properly tagged with discussion_type = 'memory'
5. **Check DevTools Console** for correct routing

#### 2B. Supervisor Response
1. Wait for supervisor agent to respond
2. **Expected**:
   - Response appears in real-time
   - No interference with Conversations module
3. **Verify isolation**: Check that message does NOT appear in Conversations tab

---

### Scenario 3: Workshop Module — All 6 Nested Tabs

**Path**: Admin → Workshop tab

Test EACH of the following tabs:

#### 3A. Jim Request Tab
**Persona**: Jim | **Tab**: jim-request | **discussion_type**: 'workshop-jim-request'

1. Select "Jim" persona at top
2. Click "Request" nested tab
3. Type test message: "Test request for Jim"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Jim Request tab
   - Does NOT appear in other 5 workshop tabs
   - Does NOT appear in Conversations or Memory Discussions
6. Wait for Jim/Human response
7. **Expected**: Response appears in real-time in THIS tab only

#### 3B. Jim Report Tab
**Persona**: Jim | **Tab**: jim-report | **discussion_type**: 'workshop-jim-report'

1. Select "Jim" persona
2. Click "Report" nested tab
3. Type test message: "Test report from Jim"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Jim Report tab
   - Isolated from other tabs
6. Wait for supervisor response
7. **Expected**: Response appears in real-time

#### 3C. Leo Question Tab
**Persona**: Leo | **Tab**: leo-question | **discussion_type**: 'workshop-leo-question'

1. Select "Leo" persona at top
2. Click "Question" nested tab
3. Type test message: "Test question for Leo"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Leo Question tab
   - Isolated from all Jim tabs and other Leo tabs
6. Wait for Leo/Human response
7. **Expected**: Response appears in real-time

#### 3D. Leo Postulate Tab
**Persona**: Leo | **Tab**: leo-postulate | **discussion_type**: 'workshop-leo-postulate'

1. Select "Leo" persona
2. Click "Postulate" nested tab
3. Type test message: "Test postulate from Leo"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Leo Postulate tab
   - Isolated from other tabs
6. Wait for Leo agent response
7. **Expected**: Response appears in real-time

#### 3E. Darron Thought Tab
**Persona**: Darron | **Tab**: darron-thought | **discussion_type**: 'workshop-darron-thought'

1. Select "Darron" persona at top
2. Click "Thought" nested tab
3. Type test message: "Test thought from Darron"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Darron Thought tab
   - Isolated from all Jim/Leo tabs
   - No agent response expected (Darron doesn't get automated replies)

#### 3F. Darron Musing Tab
**Persona**: Darron | **Tab**: darron-musing | **discussion_type**: 'workshop-darron-musing'

1. Select "Darron" persona
2. Click "Musing" nested tab
3. Type test message: "Test musing from Darron"
4. Click "Send"
5. **Expected**:
   - Message appears immediately in Darron Musing tab
   - Isolated from all other tabs
   - No agent response expected

---

### Scenario 4: Cross-Module Isolation

**Purpose**: Verify messages stay in their correct modules

1. Post message in Conversations (general)
2. Switch to Workshop → Jim Request tab
3. **Expected**: Message from step 1 does NOT appear here
4. Post message in Workshop → Leo Question
5. Switch to Memory Discussions
6. **Expected**: Message from step 4 does NOT appear here
7. Check DevTools Console for proper `discussion_type` routing:
   ```
   conversation_message with discussion_type: 'general'
   conversation_message with discussion_type: 'workshop-leo-question'
   conversation_message with discussion_type: 'memory'
   ```

---

### Scenario 5: Server Restart Resilience

**Purpose**: Verify reconnection and message delivery after server restart

1. Open admin UI with Conversations tab active
2. In terminal, restart server:
   ```bash
   cd ~/Projects/han/src/server
   pkill -f "tsx server.ts"
   nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &
   ```
3. **Expected in DevTools Console**:
   ```
   [WebSocket] Connection closed
   [WebSocket] Reconnecting in 2s...
   [WebSocket] Connected to wss://localhost:3847
   ```
4. Post a test message after reconnection
5. **Expected**: Message appears normally, broadcast works

---

### Scenario 6: Signal File Cleanup

**Purpose**: Verify signal files don't accumulate

1. Before test, check signals directory:
   ```bash
   ls -la ~/.han/signals/
   ```
   **Expected**: Empty or only recent files (< 5 seconds old)

2. Send 10 messages rapidly across different modules
3. Wait 10 seconds
4. Check signals directory again:
   ```bash
   ls -la ~/.han/signals/
   ```
   **Expected**: Still empty or only very recent files

5. If files accumulate, check server logs:
   ```bash
   tail -50 /tmp/han-server.log | grep -i signal
   ```

---

## Acceptance Criteria Summary

✅ **All 6 workshop tabs receive real-time updates**
- [ ] Jim Request
- [ ] Jim Report
- [ ] Leo Question
- [ ] Leo Postulate
- [ ] Darron Thought
- [ ] Darron Musing

✅ **Messages appear in correct modules only**
- [ ] General conversation stays in Conversations
- [ ] Memory discussions stay in Memory Discussions
- [ ] Workshop messages stay in their specific nested tabs

✅ **Real-time updates work**
- [ ] Human messages appear immediately after send
- [ ] Agent responses appear without page refresh
- [ ] "Waiting for response..." indicators removed correctly

✅ **No errors or disconnections**
- [ ] DevTools Console shows no WebSocket errors
- [ ] No 500 errors in Network tab
- [ ] No TypeScript errors in console

✅ **Signal files cleaned up**
- [ ] ~/.han/signals/ directory doesn't accumulate files
- [ ] Files are removed within 1-2 seconds of creation

---

## Debugging Tips

### WebSocket Not Connecting
```bash
# Check server logs
tail -100 /tmp/han-server.log | grep -i websocket

# Check if port 3847 is listening
lsof -i :3847

# Restart server if needed
cd ~/Projects/han/src/server
pkill -f "tsx server.ts"
nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &
```

### Messages Not Appearing
1. Check DevTools Console for WebSocket messages
2. Check Network tab for POST to `/api/conversations`
3. Verify `discussion_type` in request payload matches module
4. Check signal file is created:
   ```bash
   ls -la ~/.han/signals/ws-broadcast
   cat ~/.han/signals/ws-broadcast
   ```

### Signal Files Accumulating
1. Check server broadcast handler in admin.ts:292
2. Verify `fs.unlinkSync()` is called after reading signal
3. Check file permissions on ~/.han/signals/

### Cross-Contamination (messages in wrong modules)
1. Check `discussion_type` in WebSocket payload
2. Verify admin.ts:394 filters by `discussion_type`
3. Check conversations.ts:292 includes `discussion_type` in broadcast

---

## Test Results Log

**Tester**: _____________
**Date**: _____________
**Server Commit**: `git rev-parse HEAD` → _____________

| Scenario | Pass/Fail | Notes |
|----------|-----------|-------|
| 1A. Conversations - Human message | ☐ | |
| 1B. Conversations - Jim response | ☐ | |
| 2A. Memory - Human message | ☐ | |
| 2B. Memory - Supervisor response | ☐ | |
| 3A. Workshop - Jim Request | ☐ | |
| 3B. Workshop - Jim Report | ☐ | |
| 3C. Workshop - Leo Question | ☐ | |
| 3D. Workshop - Leo Postulate | ☐ | |
| 3E. Workshop - Darron Thought | ☐ | |
| 3F. Workshop - Darron Musing | ☐ | |
| 4. Cross-module isolation | ☐ | |
| 5. Server restart resilience | ☐ | |
| 6. Signal cleanup | ☐ | |

**Overall Result**: ☐ PASS | ☐ FAIL

**Issues Found**:
```
(List any bugs, errors, or unexpected behaviour)
```
