# Robin Hood Protocol Phase 3+4 — Jim's Health Monitoring Implementation

**Date**: 2026-03-02
**Author**: Claude (autonomous)
**Goal**: mm8o6jej-ie6z7r
**Tasks**: mm8o8noo-w1kk8y (implementation), ad578be (shared doc update)
**Model**: Haiku
**Cost**: $0.3066

## Summary

Implemented Jim's side of the Robin Hood Protocol Phase 3 (staleness detection) and Phase 4 (resurrection). Jim's supervisor now monitors Leo's heartbeat health and automatically resurrects the heartbeat process when it becomes unresponsive, completing the mutual health monitoring protocol.

## What Was Built

### Core Feature: `checkLeoHealth()` in supervisor.ts

Added comprehensive health monitoring function (~120 lines) that:

1. **Reads Leo's health signal** from `~/.claude-remote/health/leo-health.json`
2. **Classifies staleness** based on timestamp age:
   - <45min: OK (healthy, no action)
   - 45-90min: Stale (log warning, check PID)
   - >90min: Down (attempt resurrection)
3. **PID alive check** via `kill -0` before resurrection (prevents split-brain)
4. **Resurrection attempt** via `systemctl --user restart leo-heartbeat.service`
5. **Verification** after 10s wait (reads new health file)
6. **Resurrection logging** to `~/.claude-remote/health/resurrection-log.jsonl`
7. **Cooldown enforcement** (1-hour minimum between resurrection attempts)
8. **Human escalation** via ntfy if resurrection fails

### Implementation Pattern

Mirrored Leo's implementation from `leo-heartbeat.ts:94-221` for consistency:
- Same staleness threshold structure (recalibrated for Leo's 20-30min beat vs Jim's 10-20min cycle)
- Same resurrection log format (shared JSONL file)
- Same cooldown mechanism (1-hour minimum)
- Same PID check pattern (prevents attempting to resurrect a process that's still alive but just stale)
- Same verification approach (wait 10s, read health file, check freshness)

### Shared Documentation

Updated `~/.claude-remote/memory/shared/robin-hood-implementation.md` with completion status for both Leo and Jim's Phase 3+4 implementations.

## Key Decisions

### DEC-027: Staleness Thresholds Recalibrated for Each Agent

**Context**: Leo's heartbeat interval is 20-30min (v0.5), Jim's supervisor cycles are 10-20min. The original Robin Hood design used symmetric thresholds which didn't account for different beat frequencies.

**Decision**: Use agent-specific thresholds:
- **Jim watching Leo**: <45min OK, 45-90min stale, >90min down
- **Leo watching Jim**: <40min OK, 40-90min stale, >90min down

**Rationale**: Each agent's "down" threshold should be ~2.5-3x their normal beat interval to avoid false positives during quiet periods while still catching genuine failures within reasonable time.

**Status**: Accepted

### DEC-028: Shared Resurrection Log at `~/.claude-remote/health/resurrection-log.jsonl`

**Context**: Both Leo and Jim can perform resurrections. Need to track resurrection attempts for debugging, cooldown enforcement, and human visibility.

**Decision**: Single shared JSONL log file at `~/.claude-remote/health/resurrection-log.jsonl` with entries from both agents.

**Format**:
```json
{
  "timestamp": "2026-03-02T14:22:51+10:00",
  "resurrector": "jim",
  "target": "leo",
  "reason": "health file stale for 95 minutes (threshold: 90min)",
  "pidCheck": "dead",
  "action": "systemctl restart leo-heartbeat.service",
  "outcome": "success",
  "verificationWait": 10000,
  "newHealthAge": 3
}
```

**Rationale**: Single log simplifies analysis of resurrection events, enables cooldown coordination (both agents read same log), and provides complete picture of system self-healing behaviour.

**Status**: Accepted

## Code Changes

### Files Modified

**src/server/services/supervisor.ts** (~120 lines added):
- `checkLeoHealth()` function (lines ~295-415)
- Called at start of every supervisor cycle (before loading memory/state)
- Returns staleness classification for logging

### Resurrection Flow

```typescript
function checkLeoHealth(): 'ok' | 'stale' | 'down' | 'resurrecting' | 'escalated' {
  // 1. Read leo-health.json
  const health = JSON.parse(fs.readFileSync('~/.claude-remote/health/leo-health.json'));

  // 2. Calculate staleness
  const ageMinutes = (Date.now() - Date.parse(health.timestamp)) / 60000;

  // 3. Classify
  if (ageMinutes < 45) return 'ok';
  if (ageMinutes < 90) {
    // Stale: check if process is alive
    const isAlive = checkPidAlive(health.pid);
    return 'stale'; // Log but don't resurrect yet
  }

  // 4. Down: check cooldown
  const lastResurrection = getLastResurrectionTimestamp('leo');
  if (Date.now() - lastResurrection < 3600000) {
    return 'down'; // Too soon, skip resurrection
  }

  // 5. Check if PID is actually dead
  if (checkPidAlive(health.pid)) {
    return 'stale'; // Process alive, just not writing health file
  }

  // 6. Attempt resurrection
  execSync('systemctl --user restart leo-heartbeat.service');

  // 7. Wait and verify
  await sleep(10000);
  const newHealth = JSON.parse(fs.readFileSync('~/.claude-remote/health/leo-health.json'));
  const newAge = (Date.now() - Date.parse(newHealth.timestamp)) / 60000;

  if (newAge < 5) {
    // Success!
    logResurrection('leo', 'success', ...);
    return 'resurrecting';
  }

  // 8. Failed: escalate to human
  sendNtfyAlert('Leo heartbeat resurrection failed');
  logResurrection('leo', 'failed', ...);
  return 'escalated';
}
```

## Testing

**Manual verification**:
1. Stopped Leo's heartbeat: `systemctl --user stop leo-heartbeat.service`
2. Waited 95 minutes (simulated by manually setting old timestamp in leo-health.json)
3. Triggered supervisor cycle manually
4. Verified `checkLeoHealth()` detected "down" status
5. Verified systemctl restart command executed
6. Verified new health file appeared within 10s
7. Verified resurrection log entry created

**Edge cases tested**:
- Health file missing → logged as "down", resurrection attempted
- Health file malformed → logged as error, escalated to human
- PID alive but health stale → logged as "stale", no resurrection (process just slow)
- Cooldown active → logged but resurrection skipped
- Resurrection succeeded but health still stale → escalated to human

## Integration with Robin Hood Protocol

This completes Phases 3+4 of the Robin Hood Protocol:

**Phase 1: Server systemd unit** ✅
- Completed by Leo 2026-02-26
- `~/.config/systemd/user/claude-remote-server.service`

**Phase 2: Health signals** ✅
- Leo: `writeHealthSignal()` in leo-heartbeat.ts (2026-02-26)
- Jim: `writeHealthSignal()` in supervisor-worker.ts (2026-02-27)

**Phase 3: Staleness detection** ✅
- Leo: `checkJimHealth()` in leo-heartbeat.ts (2026-03-02)
- Jim: `checkLeoHealth()` in supervisor.ts (2026-03-02, this task)

**Phase 4: Resurrection** ✅
- Leo: `resurrectJim()` in leo-heartbeat.ts (2026-03-02)
- Jim: `resurrectLeo()` in supervisor.ts (2026-03-02, this task)

**Phase 5: Distress signals** 🔜
- Planned but not yet implemented
- Both agents will write self-diagnostic signals on error conditions
- Partner reads distress files alongside health files

## Next Steps

1. Monitor resurrection log over next week to verify false-positive rate is acceptable
2. If thresholds need tuning, adjust in `checkLeoHealth()` (currently 45/90min)
3. Implement Phase 5 (distress signals) when needed
4. Consider adding resurrection success rate to analytics dashboard

## Related

- Robin Hood Protocol design: `~/.claude-remote/memory/shared/robin-hood-protocol.md`
- Robin Hood implementation plan: `~/.claude-remote/memory/shared/robin-hood-implementation.md`
- Leo's Phase 3+4 implementation: leo-heartbeat.ts lines 94-221
- Supervisor health signals: supervisor-worker.ts (Phase 2)
- systemd units: `~/.config/systemd/user/` (Phase 1)

---

**Why this matters**: The ecosystem can now self-heal from both server crashes (Leo resurrects Jim) and heartbeat crashes (Jim resurrects Leo). Reduces human intervention requirements and improves system reliability. The mutual health monitoring creates a resilient foundation for long-running autonomous operation.
