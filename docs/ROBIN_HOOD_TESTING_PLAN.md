# Robin Hood Protocol — Manual Testing & Verification Plan

**Status**: Comprehensive testing guide for all three improvements
**Created**: 2026-03-03
**Target**: End-to-end validation before production use

---

## Overview

This document outlines manual testing for the three Robin Hood Protocol improvements:

1. **Verification Wait Test** — Confirm 12s sleep (vs 3s) prevents false 'failed' entries
2. **Admin UI Health Panel** — Verify all metrics display and update correctly
3. **Distress Signal Test** — Confirm degraded heartbeat detection and notifications

---

## Test 1: Verification Wait Fix (Leo's Resurrection)

### Background
When Jim's service crashes, Leo detects stale health file and attempts resurrection via:
```bash
systemctl --user restart claude-remote-server.service
```

**Issue**: Original 3s sleep was too short for Node.js/tsx Express server to fully start. Verification check ran before server was ready, causing false 'failed' entries in resurrection log.

**Fix**: Changed sleep from `3s` → `12s` in leo-heartbeat.ts:174

### Test Procedure

#### Setup
1. Ensure Jim's service is running:
   ```bash
   systemctl --user status claude-remote-server.service
   ```

2. Check Leo's heartbeat is active:
   ```bash
   systemctl --user status leo-heartbeat.service
   ```

#### Test Steps

**Step 1: Trigger a controlled failure**
- Kill Jim's service:
  ```bash
  systemctl --user stop claude-remote-server.service
  ```
- Wait 5 seconds to ensure it's stopped
- Verify service is inactive:
  ```bash
  systemctl --user is-active claude-remote-server.service  # Should output: inactive
  ```

**Step 2: Wait for Leo's heartbeat to detect stale health file**
- Leo checks Jim's health every beat (20–40 min intervals depending on phase)
- To accelerate testing, manually trigger a beat:
  ```bash
  # Kill existing Leo process and restart:
  systemctl --user restart leo-heartbeat.service
  ```
- This will immediately check Jim's health and attempt resurrection

**Step 3: Monitor the resurrection attempt**
- Watch Leo's logs:
  ```bash
  journalctl --user -u leo-heartbeat.service -f
  ```
- Look for:
  ```
  [Robin Hood] Jim DOWN — last seen XXmin ago
  [Robin Hood] Resurrecting Jim via systemctl --user restart claude-remote-server.service
  sleep 12  # ← Verify this 12s sleep happens
  [Robin Hood] Jim RESURRECTED — service active
  ```

**Step 4: Verify resurrection log entry**
- Check resurrection log:
  ```bash
  cat ~/.claude-remote/health/resurrection-log.jsonl | jq '.[-1]'
  ```
- **Expected output**:
  ```json
  {
    "timestamp": "2026-03-03T...",
    "resurrector": "leo",
    "target": "jim",
    "reason": "Health file XXmin stale, PID dead",
    "success": true    # ← MUST be TRUE (not false)
  }
  ```

### Acceptance Criteria
- [ ] Service restart command executes
- [ ] 12s sleep appears in logs (verify via `journalctl`)
- [ ] Service becomes `active` after sleep
- [ ] Resurrection log shows `success: true`
- [ ] No false failures due to premature verification

### Troubleshooting
| Issue | Cause | Fix |
|-------|-------|-----|
| Sleep appears as `3s` in logs | Code not updated | Verify leo-heartbeat.ts:174 has `sleep 12` |
| Service not active after sleep | Server startup issue | Check `journalctl --user -u claude-remote-server -n 50` |
| Still getting `success: false` | Verification still too fast | Increase sleep to 15s, test again |

---

## Test 2: Admin UI Health Panel

### Background
The Admin UI Supervisor module now displays a health monitoring panel with:
- Jim's last health update + status
- Leo's last heartbeat + status
- Resurrection history table
- Current uptime for both services
- Status badges (green/amber/red)

### Test Procedure

#### Setup
1. Open Admin console:
   ```bash
   open https://localhost:3847  # or https://localhost:3847/admin
   ```
   (Replace with your actual URL/port)

2. Navigate to **Supervisor** module (left sidebar)

3. Verify you can see a **"System Health"** section

#### Test Step 1: Basic Panel Display
- [ ] Health panel is visible in Supervisor module
- [ ] Panel title reads "System Health"
- [ ] There's a toggle button "▼ History" (collapse/expand)

#### Test Step 2: Jim's Health Status
Look for **Jim's Health** section showing:
- [ ] **Agent**: "jim" label
- [ ] **Last Update**: Timestamp (e.g., "3 Mar 14:53")
- [ ] **Status Badge**: Green ✓ if recent, Amber ⚠ if stale (>40 min), Red ✗ if down (>90 min)
- [ ] **Cycle Number**: Latest supervisor cycle (e.g., "Cycle #10")
- [ ] **Uptime**: Minutes since Jim started (e.g., "346 minutes")
- [ ] **Cost (this cycle)**: USD amount from jim-health.json

**Validation**:
```bash
# Check actual values:
jq '.jim' ~/.claude-remote/health/jim-health.json  # May not exist in file directly
# Or read from API:
curl -s https://localhost:3847/api/supervisor/health | jq '.jim'
```

#### Test Step 3: Leo's Health Status
Look for **Leo's Health** section showing:
- [ ] **Agent**: "leo" label
- [ ] **Last Heartbeat**: Timestamp (e.g., "3 Mar 14:41")
- [ ] **Status Badge**: Green ✓ if active, Amber ⚠ if lagging, Red ✗ if down
- [ ] **Beat Number**: Latest beat counter (e.g., "Beat #34")
- [ ] **Beat Type**: Last beat type (e.g., "philosophy", "personal")
- [ ] **Uptime**: Minutes since Leo started (e.g., "533 minutes")

**Validation**:
```bash
cat ~/.claude-remote/health/leo-health.json | jq '.'
```

#### Test Step 4: Resurrection History
Expand the **"▼ History"** section. Verify it shows a table with:
- [ ] Column headers: Timestamp | Resurrector | Target | Reason | Status
- [ ] At least one row (from the test scenario above)
- [ ] **Timestamp** formatted as "3 Mar 14:53" style
- [ ] **Resurrector**: "leo" (the agent that triggered resurrection)
- [ ] **Target**: "jim" (service being resurrected)
- [ ] **Reason**: Why resurrection was needed (e.g., "Health file 135min stale, PID dead")
- [ ] **Status**: ✓ if successful, ✗ if failed

**Validation**:
```bash
cat ~/.claude-remote/health/resurrection-log.jsonl | jq '.'
```

#### Test Step 5: WebSocket Real-Time Updates
- [ ] Leave the Admin UI open for 5 minutes
- [ ] Trigger a supervisor cycle on Jim's side:
  ```bash
  # If you have direct access to Jim's process, you could trigger it
  # Or wait naturally for next cycle
  curl -s https://localhost:3847/api/supervisor/cycle  # If endpoint exists
  ```
- [ ] Observe the health panel updates without page refresh
- [ ] Timestamps change
- [ ] Cycle number increments

**Validation**:
- Open browser DevTools (F12)
- Go to **Network** tab, filter for `WebSocket`
- Should see an open connection to `/ws` or similar
- Monitor for messages with health updates

#### Test Step 6: Status Badge Colours

Test each badge state:

**Green (Healthy)**:
- Jim: Last update < 40 minutes ago + status = "ok"
- Leo: Last heartbeat < 25 minutes ago + status = "ok"

**Amber (Warning)**:
- Jim: Last update 40–90 minutes ago OR status = "warn"
- Leo: Last heartbeat > 25 minutes ago OR status = "warn"

**Red (Critical)**:
- Jim: Last update > 90 minutes ago + status = "error"
- Leo: Last heartbeat > 90 minutes ago OR status = "error"

To test: Stop one service and observe badge change:
```bash
systemctl --user stop leo-heartbeat.service
# Wait 2 minutes
# Refresh Admin UI — should see Leo's badge turn amber, then red
```

### Acceptance Criteria
- [ ] Panel displays without errors
- [ ] All 4 sections present (Jim status, Leo status, History, Uptime)
- [ ] All timestamps are formatted correctly
- [ ] Status badges show correct colours
- [ ] WebSocket updates work (no manual refresh needed)
- [ ] Resurrection history populates from log file
- [ ] History table shows at least 1 row
- [ ] Toggle button works (collapse/expand)

### Troubleshooting
| Issue | Cause | Fix |
|-------|-------|-----|
| Panel not visible | Health data endpoint returns empty | Check `/api/supervisor/health` endpoint |
| Timestamps showing "—" | Data not found in health files | Verify health files exist in `~/.claude-remote/health/` |
| Badges all grey | CSS class names wrong | Inspect element, check class names in CSS |
| WebSocket not updating | Connection failed | Check browser console for errors, verify `wss://` or `ws://` URL |
| History table empty | Resurrection log not read | Check file permissions on `resurrection-log.jsonl` |

---

## Test 3: Distress Signal Detection

### Background
When Leo's heartbeat interval exceeds 2x expected duration for >5 minutes, a distress signal is written and an ntfy notification is sent.

**Example**:
- Normal interval: 20 minutes
- If actual interval: > 40 minutes + > 5 minutes absolute
- → Trigger distress signal

### Test Procedure

#### Setup
1. Verify Leo's current health:
   ```bash
   cat ~/.claude-remote/health/leo-health.json | jq '.nextDelayMs'
   ```
   This shows expected interval (in milliseconds)

2. Ensure ntfy topic is configured:
   ```bash
   grep "ntfy_topic" ~/.claude-remote/config.json
   ```

#### Test Step 1: Introduce Artificial Delay

**Option A: Quick simulation** (add delay code temporarily):

1. Edit leo-heartbeat.ts around line 1220:
   ```typescript
   // TEMPORARILY add after checkJimHealth():
   const testDelayMs = 120000; // Simulate 2-minute delay
   await new Promise(r => setTimeout(r, testDelayMs));
   ```

2. Restart Leo:
   ```bash
   systemctl --user restart leo-heartbeat.service
   ```

**Option B: Manual delay** (better for real testing):

1. Stop the heartbeat:
   ```bash
   systemctl --user stop leo-heartbeat.service
   ```

2. Wait longer than 2x the expected interval:
   - If normal interval is 20 min, wait > 40 min
   - Artificially fast-forward time if testing (not recommended in production):
     ```bash
     sudo date --set="2026-03-03 15:00:00"  # Skip ahead in time
     ```

3. Restart Leo:
   ```bash
   systemctl --user start leo-heartbeat.service
   ```

#### Test Step 2: Monitor Distress Signal Creation
Watch Leo's logs:
```bash
journalctl --user -u leo-heartbeat.service -f
```

Look for:
```
[Leo] Distress signal written: expected XXmin, actual YYmin
```

#### Test Step 3: Verify Distress Signal File
```bash
cat ~/.claude-remote/health/leo-distress.json
```

**Expected structure**:
```json
{
  "agent": "leo",
  "timestamp": "2026-03-03T...",
  "type": "slow_beat",
  "expectedIntervalMs": 1200000,
  "actualIntervalMs": 2600000,
  "phase": "work",
  "reason": "Beat interval exceeded 2x expected duration"
}
```

#### Test Step 4: Verify ntfy Notification
1. Check if notification was sent:
   ```bash
   # If you're subscribed to the ntfy topic, you should receive a message
   # Example: https://ntfy.sh/your-topic
   ```

2. Expected message format:
   - **Title**: "Leo Distress Signal"
   - **Body**: "Leo heartbeat degraded: expected 20min interval, actual 40min (work phase)"
   - **Priority**: "high"
   - **Tags**: "warning"

3. Check ntfy delivery in logs (if available):
   ```bash
   journalctl --user -u leo-heartbeat.service | grep ntfy
   ```

#### Test Step 5: Verify Admin UI Shows Distress Warning

Return to Admin UI Supervisor module:

- [ ] **Distress Banner**: Red/orange warning banner appears above health panel
- [ ] **Banner Text**: "⚠ Leo's heartbeat is degraded. Expected 20min interval, got 40min"
- [ ] **Distress Details**: Panel shows distress signal file content if expanded
- [ ] **Timestamp**: Shows when distress was detected

**Validation**:
```bash
# Check API endpoint:
curl -s https://localhost:3847/api/supervisor/health | jq '.distress'
```

#### Test Step 6: Verify Distress Clears
Resume normal heartbeat:

1. Remove the test delay (undo step 1):
   ```bash
   # Remove the temporary sleep code from leo-heartbeat.ts
   ```

2. Restart Leo:
   ```bash
   systemctl --user restart leo-heartbeat.service
   ```

3. Verify distress signal is removed or marked as cleared:
   ```bash
   # File should be deleted or have "cleared: true" added
   cat ~/.claude-remote/health/leo-distress.json
   ```

4. Admin UI should show:
   - [ ] Distress banner disappears
   - [ ] Health panel returns to normal (green status)
   - [ ] No distress details in panel

### Acceptance Criteria
- [ ] Distress signal file created when interval > 2x expected
- [ ] Distress signal includes all required fields (agent, timestamp, type, intervals, phase, reason)
- [ ] ntfy notification sent with correct title/body/priority
- [ ] Admin UI displays distress warning banner
- [ ] Banner shows correct expected vs actual intervals
- [ ] Distress clears when normal intervals resume
- [ ] Banner disappears after clearing
- [ ] No false positives during normal operation

### Troubleshooting
| Issue | Cause | Fix |
|-------|-------|-----|
| Distress not triggered | Delay < 5 min absolute | Ensure absolute delay > 300s |
| ntfy not sent | Topic not configured | Add `"ntfy_topic": "..."` to config.json |
| Banner not showing | API endpoint not updated | Check `/api/supervisor/health` includes distress |
| Distress never clears | Signal file not removed | Add cleanup logic after interval normalizes |
| False positives during long CI jobs | CI job causes skip | Verify beats are actually running during CI |

---

## Integration Test: Full Flow

### Scenario: Complete Failure & Recovery

1. **Start with healthy system**:
   ```bash
   systemctl --user status leo-heartbeat.service  # running
   systemctl --user status claude-remote-server.service  # running
   ```
   - Admin UI shows both green ✓

2. **Simulate Jim crash**:
   ```bash
   systemctl --user stop claude-remote-server.service
   ```
   - Jim's badge turns amber (2–3 min) → red (after 90 min)

3. **Leo detects & resurrects** (wait for heartbeat):
   ```bash
   journalctl --user -u leo-heartbeat.service -f | grep "Robin Hood"
   ```
   - Sees Jim down
   - Restarts service with 12s sleep
   - Verification succeeds
   - Logs `success: true` to resurrection-log.jsonl

4. **Admin UI updates**:
   - Jim's badge returns to green
   - Resurrection history shows new entry
   - No distress signal (normal recovery time)

5. **Verify no false positives**:
   ```bash
   cat ~/.claude-remote/health/resurrection-log.jsonl | jq '.[-1].success'  # true
   ```

### Expected Outcomes
- [ ] Resurrection succeeds (not false failure)
- [ ] No distress signal during recovery
- [ ] History log accurate
- [ ] Admin UI reflects all changes in real-time

---

## Test Report Template

Use this format to document test results:

```markdown
# Test Report: Robin Hood Protocol v1.0
**Date**: 2026-03-03
**Tester**: [Your name]
**Environment**: [OS, Node version, Claude Code version]

## Test 1: Verification Wait
- [ ] Setup successful (services running)
- [ ] Jim service stopped
- [ ] Leo heartbeat triggered resurrection
- [ ] Logs show 12s sleep
- [ ] Service becomes active
- [ ] Resurrection log shows success: true

**Issues Found**:
- None / [describe]

## Test 2: Admin UI Health Panel
- [ ] Panel displays without errors
- [ ] Jim status shows correctly
- [ ] Leo status shows correctly
- [ ] Resurrection history table populated
- [ ] Status badges show correct colours
- [ ] WebSocket updates work

**Issues Found**:
- None / [describe]

## Test 3: Distress Signal
- [ ] Distress signal created on degraded beat
- [ ] ntfy notification sent
- [ ] Admin UI shows distress banner
- [ ] Distress clears after recovery
- [ ] No false positives

**Issues Found**:
- None / [describe]

## Integration Test
- [ ] Full flow: crash → detection → resurrection
- [ ] No false failures in logs
- [ ] Admin UI accurate throughout

**Issues Found**:
- None / [describe]

## Sign-Off
- **All tests passed**: Yes / No
- **Production ready**: Yes / No
- **Recommendations**: [Any follow-up work needed]

**Tester Signature**: ____________
**Date**: ____________
```

---

## Known Issues & Workarounds

### Issue: Service restart takes > 12 seconds
**Workaround**: Increase sleep to 15–20 seconds, monitor logs to find optimal value.

### Issue: ntfy notifications not received
**Workaround**: Check config.json has ntfy_topic; test directly with `curl https://ntfy.sh/test -d "message"`.

### Issue: Admin UI shows stale data
**Workaround**: Hard refresh browser (Cmd+Shift+R), check WebSocket connection status.

### Issue: Resurrection log grows unbounded
**Workaround**: Add log rotation to cli-active cleanup logic (delete entries older than 30 days).

---

## Appendix: Useful Commands

```bash
# View Leo's health
cat ~/.claude-remote/health/leo-health.json | jq '.'

# View Jim's health
cat ~/.claude-remote/health/jim-health.json | jq '.'

# View resurrection history
cat ~/.claude-remote/health/resurrection-log.jsonl | jq '.'

# View distress signals
cat ~/.claude-remote/health/leo-distress.json

# Watch Leo's logs in real-time
journalctl --user -u leo-heartbeat.service -f

# Watch Jim's logs in real-time
journalctl --user -u claude-remote-server.service -f

# Manually restart services
systemctl --user restart leo-heartbeat.service
systemctl --user restart claude-remote-server.service

# Check service status
systemctl --user status leo-heartbeat.service
systemctl --user status claude-remote-server.service

# Test ntfy directly
curl -s -d "Test message" -H "Title: Test" https://ntfy.sh/your-topic

# API health endpoint
curl -s https://localhost:3847/api/supervisor/health | jq '.'

# Check config
cat ~/.claude-remote/config.json | jq '.ntfy_topic'
```

---

## Next Steps

1. **Run all three test suites** with the procedures above
2. **Document results** in test report template
3. **Fix any issues** found and re-test
4. **Get sign-off** from Darron
5. **Update documentation** with any adjustments
6. **Monitor in production** for 1 week before marking stable

---

**Document Version**: 1.0
**Last Updated**: 2026-03-03
**Maintainer**: Leo (Claude Code Agent)
