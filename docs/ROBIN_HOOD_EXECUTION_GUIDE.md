# Robin Hood Protocol — Test Execution Guide

**Quick Start**: Follow these steps to test all three improvements in sequence.

---

## Prerequisites

Before testing, ensure:

```bash
# 1. Both services are running
systemctl --user status leo-heartbeat.service         # Should be active
systemctl --user status han-server.service  # Should be active

# 2. Health directory exists and is writable
mkdir -p ~/.han/health
ls -la ~/.han/health/

# 3. Admin server is running
curl -sk https://localhost:3847/api/supervisor/health | jq '.success'
# Should output: true

# 4. Config has ntfy topic (for distress notifications)
cat ~/.han/config.json | jq '.ntfy_topic'
```

---

## Quick Verification (5 minutes)

Run the automated test script:

```bash
cd ~/Projects/han
./scripts/test-robin-hood.sh all
```

**Expected output**:
- ✓ Code contains 'sleep 12' (correct)
- ✓ Leo heartbeat service is active
- ✓ Jim service is active
- ✓ Health files exist
- ✓ Admin server is reachable
- ✓ Health data in API response
- ✓ All services healthy

**If any tests fail**, see [Troubleshooting](#troubleshooting) section.

---

## Manual Test 1: Verification Wait (15–20 minutes)

### Objective
Verify that Leo waits 12 seconds before checking if Jim's service restarted (not 3 seconds).

### Prerequisites
- [ ] Leo heartbeat running: `systemctl --user status leo-heartbeat.service`
- [ ] Jim service running: `systemctl --user status han-server.service`

### Step 1: Stop Jim's Service
```bash
systemctl --user stop han-server.service

# Verify it stopped
sleep 2
systemctl --user is-active han-server.service  # Should output: inactive
```

### Step 2: Trigger Leo's Heartbeat (2 options)

**Option A: Wait for natural beat** (20–40 minutes depending on phase)
```bash
# Watch logs to see when Leo runs next
journalctl --user -u leo-heartbeat.service -f
```

**Option B: Force a beat immediately**
```bash
# Restart Leo to trigger immediate beat
systemctl --user restart leo-heartbeat.service

# Watch the resurrection attempt
journalctl --user -u leo-heartbeat.service -f
```

### Step 3: Monitor the Resurrection
Watch Leo's logs for the Robin Hood flow:

```bash
# In one terminal, watch logs:
journalctl --user -u leo-heartbeat.service -f

# You should see:
# [Robin Hood] Jim DOWN — last seen XXmin ago
# [Robin Hood] Resurrecting Jim via systemctl...
# [Robin Hood] Jim RESURRECTED — service active
```

**Critical check**: Look for the sleep duration in logs. One of these should appear:
- ✓ `sleep 12` (correct, this is the fix)
- ✗ `sleep 3` (old code, needs updating)

### Step 4: Verify Service is Active
While watching logs, also verify the service actually came up:

```bash
# In another terminal:
sleep 13  # Wait a bit longer than the sleep
systemctl --user is-active han-server.service  # Should be: active
```

### Step 5: Check the Resurrection Log
```bash
cat ~/.han/health/resurrection-log.jsonl | tail -1 | jq '.'
```

**Expected output**:
```json
{
  "timestamp": "2026-03-03T...",
  "resurrector": "leo",
  "target": "jim",
  "reason": "Health file XXmin stale, PID dead",
  "success": true      # ← MUST be true
}
```

### ✓ Test Passes If
- [ ] Logs show `sleep 12` (or similar, not `sleep 3`)
- [ ] Service becomes `active` after the sleep
- [ ] Resurrection log shows `success: true`
- [ ] Logs show "Jim RESURRECTED"

### ✗ Test Fails If
- [ ] Logs show `sleep 3` (old code)
- [ ] Service remains `inactive` after restart attempt
- [ ] Resurrection log shows `success: false`
- [ ] Logs show verification failed

---

## Manual Test 2: Admin UI Health Panel (10 minutes)

### Objective
Verify the Admin UI displays health data with correct status badges and auto-updates via WebSocket.

### Step 1: Open Admin Console
```bash
# Open in browser:
open https://localhost:3847  # or https://localhost:3847/admin

# Or use curl to test API:
curl -sk https://localhost:3847/api/supervisor/health | jq '.'
```

### Step 2: Navigate to Supervisor Module
- Look for left sidebar menu
- Click **Supervisor**
- Scroll down to find **System Health** section

### Step 3: Verify Jim's Health Display
You should see:
```
Jim's Health
━━━━━━━━━━━━━━
● Jim  (green badge)
Last Update:  3 Mar 14:53  (5 minutes ago)
Cycle #10
Uptime:  346 minutes
Status:  OK
```

Check each field:
- [ ] Agent label shows "Jim"
- [ ] Timestamp is recent (within 2 hours)
- [ ] Status badge is GREEN ✓ (not grey or red)
- [ ] Cycle number is present
- [ ] Uptime is > 0 minutes

### Step 4: Verify Leo's Health Display
You should see:
```
Leo's Health
━━━━━━━━━━━━━━
● Leo  (green badge)
Last Heartbeat:  3 Mar 14:41  (15 minutes ago)
Beat #34 (philosophy)
Uptime:  533 minutes
Status:  OK
```

Check each field:
- [ ] Agent label shows "Leo"
- [ ] Timestamp is recent (within 1 hour)
- [ ] Status badge is GREEN ✓
- [ ] Beat number and type are present
- [ ] Uptime is > 0 minutes

### Step 5: Check Resurrection History
- [ ] Find the "▼ History" toggle button
- [ ] Click it to expand
- [ ] Verify a table appears with columns:
  ```
  Timestamp  │ Resurrector │ Target │ Reason              │ Status
  ───────────┼─────────────┼────────┼─────────────────────┼────────
  3 Mar 14:00│ leo         │ jim    │ Health file stale...│ ✓
  ```

- [ ] Each row shows recent resurrection attempts
- [ ] Timestamps are formatted correctly
- [ ] Success/failure indicator is present

### Step 6: Verify WebSocket Updates
With the panel still open:

1. Wait 5 minutes
2. Watch the **Last Update** timestamp on Jim's section
3. Does it change without refreshing the page?

Expected:
- [ ] Timestamps update in real-time
- [ ] No manual page refresh needed
- [ ] Status badges change colour if state changes

**To verify WebSocket is active**:
```bash
# In browser DevTools (F12):
# → Network tab
# → Filter: "WS"
# Should see an open WebSocket connection
```

### ✓ Test Passes If
- [ ] Panel displays without console errors
- [ ] Both Jim and Leo sections visible
- [ ] All data fields populated (not showing "—")
- [ ] Status badges are coloured correctly
- [ ] Timestamps update without manual refresh
- [ ] History table shows at least 1 entry

### ✗ Test Fails If
- [ ] Panel not visible or 404 error
- [ ] Fields show "—" (missing data)
- [ ] Timestamps don't update after 5 minutes
- [ ] History table is empty
- [ ] WebSocket shows as closed

---

## Manual Test 3: Distress Signal Detection (15–20 minutes)

### Objective
Verify Leo detects when heartbeat intervals exceed 2× expected duration and sends notifications.

### Setup
Check current configuration:

```bash
# What's the expected heartbeat interval?
cat ~/.han/health/leo-health.json | jq '.nextDelayMs'
# Example: 1200000 (= 20 minutes)

# Is ntfy configured?
cat ~/.han/config.json | jq '.ntfy_topic'
# Example: "your-topic"
```

### Option A: Quick Simulation (Recommended for Testing)

**Step 1: Edit leo-heartbeat.ts temporarily**

Add a test delay around line 1215 (after `lastHeartbeatStartMs = beatStartMs;`):

```typescript
// TEMPORARY TEST CODE — remove after testing
if (beatCounter === 1) {  // Only on first beat
    console.log('[Leo] [TEST] Simulating slow beat...');
    const delay = Math.random() * 60000 + 60000;  // 1–2 minute delay
    await new Promise(r => setTimeout(r, delay));
}
```

**Step 2: Restart Leo**
```bash
systemctl --user restart leo-heartbeat.service
journalctl --user -u leo-heartbeat.service -f
```

**Step 3: Watch for distress signal**
In logs, look for:
```
[Leo] Distress signal written: expected 20min, actual YYmin
```

### Option B: Manual Delay (More Realistic)

**Step 1: Stop Leo's heartbeat**
```bash
systemctl --user stop leo-heartbeat.service
```

**Step 2: Wait longer than 2× expected interval**

If normal interval = 20 minutes:
- Wait > 40 minutes before restarting
- Or use `sleep` to simulate:
  ```bash
  sleep 2700  # 45 minutes
  systemctl --user start leo-heartbeat.service
  ```

**Step 3: Watch for distress signal**
```bash
journalctl --user -u leo-heartbeat.service -f
```

### Step 4: Verify Distress Signal File
```bash
cat ~/.han/health/leo-distress.json | jq '.'
```

Expected structure:
```json
{
  "agent": "leo",
  "timestamp": "2026-03-03T...",
  "type": "slow_beat",
  "expectedIntervalMs": 1200000,
  "actualIntervalMs": 2700000,
  "phase": "work",
  "reason": "Beat interval exceeded 2x expected duration"
}
```

Check:
- [ ] File exists and is readable
- [ ] `actualIntervalMs` > 2× `expectedIntervalMs`
- [ ] `agent` is "leo"
- [ ] `timestamp` is recent

### Step 5: Verify ntfy Notification (if configured)
If you have ntfy subscribed:

1. Check for a notification with:
   - Title: "Leo Distress Signal"
   - Message: "Leo heartbeat degraded: expected 20min interval, actual YYmin..."
   - Priority: High (⬆️)

2. Or check logs:
   ```bash
   journalctl --user -u leo-heartbeat.service | grep ntfy
   # Should see: "Distress signal notification sent via ntfy"
   ```

### Step 6: Verify Admin UI Shows Distress

Return to Admin UI:

1. Go to Supervisor module
2. Look for a distress warning banner (red/orange)
3. Banner should show:
   ```
   ⚠ Leo's heartbeat is degraded
   Expected: 20min | Actual: 45min
   ```

4. Verify the banner disappears after normal beats resume

**Check API directly**:
```bash
curl -sk https://localhost:3847/api/supervisor/health | jq '.distress'
# Should show distress object or null
```

### Step 7: Clear Distress by Resuming Normal Beats

**Step 7a: Remove test code** (if using Option A)
```bash
# Delete the temporary delay code from leo-heartbeat.ts
```

**Step 7b: Restart Leo**
```bash
systemctl --user restart leo-heartbeat.service
```

**Step 7c: Verify distress clears**
```bash
# Wait for next beat (1–2 minutes)
journalctl --user -u leo-heartbeat.service -f

# Should NOT see another distress signal
# Admin UI banner should disappear
```

### ✓ Test Passes If
- [ ] Distress signal file created when interval > 2× expected
- [ ] File contains all required fields
- [ ] ntfy notification sent (if configured)
- [ ] Admin UI shows distress banner
- [ ] Banner displays correct intervals
- [ ] Distress clears after normal beats resume
- [ ] No false positives during normal operation

### ✗ Test Fails If
- [ ] Distress signal never created despite long delay
- [ ] ntfy not sent (but config has topic)
- [ ] Admin UI doesn't show banner
- [ ] Distress never clears
- [ ] False positives during normal CI/long jobs

---

## Full Integration Test (30 minutes)

### Scenario: Complete Failure & Recovery Cycle

This combines all three tests into a realistic failure scenario.

### Step 1: Healthy Baseline
```bash
# Verify both services running
systemctl --user status leo-heartbeat.service      # ✓ active
systemctl --user status han-server.service  # ✓ active

# Check Admin UI shows both green
curl -sk https://localhost:3847/api/supervisor/health | jq '.jim.status, .leo.status'
# Should output: "ok" and "ok"
```

### Step 2: Introduce Failure
```bash
# Kill Jim's service
systemctl --user stop han-server.service

# Verify it's down
sleep 2
systemctl --user is-active han-server.service  # inactive
```

### Step 3: Leo Detects Stale Health
Wait for Leo's next heartbeat (or trigger immediately):

```bash
systemctl --user restart leo-heartbeat.service
journalctl --user -u leo-heartbeat.service -f | grep "Robin Hood"
```

You should see:
```
[Robin Hood] Jim DOWN — last seen XXmin ago
[Robin Hood] Resurrecting Jim...
```

### Step 4: Resurrection Succeeds
Monitor for:
```
[Robin Hood] Jim RESURRECTED — service active
```

And verify:
```bash
sleep 13  # Wait for 12s sleep + buffer
systemctl --user is-active han-server.service  # active
```

### Step 5: Check Admin UI Updates
```bash
curl -sk https://localhost:3847/api/supervisor/health | jq '.jim.status'
# Should return: "ok"
```

And in the browser:
- [ ] Jim's status badge returns to GREEN
- [ ] Resurrection history shows new entry
- [ ] No distress signals (recovery was fast)

### Step 6: Verify Log Accuracy
```bash
cat ~/.han/health/resurrection-log.jsonl | jq '.[-1]'
# success should be: true
```

### ✓ Integration Test Passes If
- [ ] Service restarts successfully
- [ ] Verification succeeds (not false negative)
- [ ] Resurrection log shows `success: true`
- [ ] Admin UI reflects recovery in real-time
- [ ] No distress signals during recovery
- [ ] All three systems work together correctly

---

## Troubleshooting

### Problem: Services won't start
```bash
# Check systemd errors
journalctl --user -xe

# Try manual start with debug output
cd ~/Projects/han/src/server
npx tsx leo-heartbeat.ts  # Run in foreground to see errors
```

### Problem: Health files showing "—"
```bash
# Check if files exist and are readable
ls -la ~/.han/health/

# Verify file content
cat ~/.han/health/leo-health.json | jq '.'

# Check file permissions
chmod 644 ~/.han/health/*.json
```

### Problem: Admin UI not accessible
```bash
# Check if server is running
curl -sk https://localhost:3847/api/supervisor/health

# Check for port conflicts
lsof -i :3847

# Verify HTTPS/SSL setup
curl -v https://localhost:3847 2>&1 | head -20
```

### Problem: WebSocket not updating
```bash
# Check WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
    https://localhost:3847/ws 2>&1 | head -10

# Check browser console (F12) for errors
# Look for "WebSocket connection failed" messages
```

### Problem: Distress signal never triggers
```bash
# Check the interval calculation
cat ~/.han/health/leo-health.json | jq '.nextDelayMs'

# Verify your delay is > 2× this value AND > 300000 (5 min)
# Example: if nextDelayMs=1200000, delay must be > 2400000

# Check Leo's logs for distress check
journalctl --user -u leo-heartbeat.service | grep -i distress
```

### Problem: ntfy notifications not received
```bash
# Test ntfy directly
curl -d "Test message" https://ntfy.sh/your-topic

# Check if topic is in config
cat ~/.han/config.json | grep ntfy_topic

# Verify curl has internet access
curl -s https://ntfy.sh &>/dev/null && echo "OK" || echo "No internet"

# Check logs for ntfy send error
journalctl --user -u leo-heartbeat.service | grep ntfy
```

---

## Test Report Template

Save this report after completing all tests:

```markdown
# Robin Hood Protocol Test Report

**Date**: ________________
**Tester**: ________________
**Environment**: OS ________, Node ________, CLI version ________

## Test Results

### Test 1: Verification Wait
- Code check (12s sleep):  ☐ PASS  ☐ FAIL
- Service restart:         ☐ PASS  ☐ FAIL
- Resurrection success:    ☐ PASS  ☐ FAIL

Issues: _____________

### Test 2: Admin UI Health Panel
- Panel displays:          ☐ PASS  ☐ FAIL
- Jim status shown:        ☐ PASS  ☐ FAIL
- Leo status shown:        ☐ PASS  ☐ FAIL
- Resurrection history:    ☐ PASS  ☐ FAIL
- WebSocket updates:       ☐ PASS  ☐ FAIL

Issues: _____________

### Test 3: Distress Signal
- Signal file created:     ☐ PASS  ☐ FAIL
- ntfy notification:       ☐ PASS  ☐ FAIL
- Admin UI banner:         ☐ PASS  ☐ FAIL
- Signal clears:           ☐ PASS  ☐ FAIL

Issues: _____________

### Integration Test
- Full cycle:              ☐ PASS  ☐ FAIL
- All systems sync:        ☐ PASS  ☐ FAIL

Issues: _____________

## Summary

Total Tests: 16
- Passed: ____
- Failed: ____

Production Ready: ☐ YES  ☐ NO

Comments:
_____________

Tester Signature: ________________  Date: ________________
```

---

## Next Steps

1. ✓ Run quick verification (`./scripts/test-robin-hood.sh all`)
2. ✓ Complete all three manual tests
3. ✓ Fill out test report
4. ✓ Fix any issues found
5. ✓ Get sign-off from Darron
6. ✓ Enable monitoring (watch for issues in production)

---

**Document Version**: 1.0
**Last Updated**: 2026-03-03
**Maintainer**: Leo (Autonomous Agent)
