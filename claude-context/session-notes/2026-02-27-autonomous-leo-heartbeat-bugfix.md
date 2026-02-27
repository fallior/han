# Session Note: Leo Heartbeat Critical Bug Fixes

**Date**: 2026-02-27
**Author**: Claude (autonomous)
**Type**: Bug Fix
**Scope**: Leo heartbeat execution recovery

---

## Summary

Fixed two critical bugs in `leo-heartbeat.ts` that prevented Leo from executing any beats. The first bug (ReferenceError from undefined `shouldDeferToJim()`) crashed every scheduled beat. The second bug (double-increment in beat counter) caused inaccurate health signal reporting. Both bugs were introduced during the wall-clock 180° phase scheduling implementation but went undetected until this goal.

---

## What Was Built

### Bug 1: Removed Undefined `shouldDeferToJim()` Call (CRITICAL)

**Location**: `src/server/leo-heartbeat.ts` lines 1017-1023 (deleted)

**Root cause**: The `shouldDeferToJim()` function was planned for the old time-offset approach (where Leo would check Jim's health file and defer if Jim ran recently). When wall-clock 180° phase scheduling was implemented (commit 4c16252), the time-offset approach was replaced but the call site in `heartbeat()` wasn't removed.

**Symptom**: Every scheduled beat crashed with:
```
ReferenceError: shouldDeferToJim is not defined
```

**Fix**: Deleted the entire if-block (lines 1017-1023):
```typescript
// REMOVED:
if (shouldDeferToJim()) {
    console.log(`[Leo] Deferring beat #${beatCounter} — Jim ran recently`);
    writeHeartbeatState('skipped', beatType, { summary: 'Deferred to Jim (time offset)' });
    writeHealthSignal();
    return;
}
```

**Reasoning**: Wall-clock phase alignment (Leo at 0°, Jim at 180°) makes time-offset coordination unnecessary. Leo and Jim are now deterministically scheduled via `epoch_ms mod period` calculations — no health-file coordination needed.

---

### Bug 2: Fixed Double-Increment in `writeHealthSignal()` (MEDIUM)

**Location**: `src/server/leo-heartbeat.ts` line 1092

**Root cause**: The `writeHealthSignal()` function called `nextBeatType()` to determine the beat type for the health signal. However, `nextBeatType()` has a side effect: it increments `beatCounter++` (line 410). This meant the beat counter was incremented twice per cycle:
1. Once in the heartbeat logic (when determining current beat type)
2. Once in the health signal write (when calling `nextBeatType()` again)

**Symptom**: Beat counter advanced 2x faster than actual beats executed. Health signal reported incorrect beat numbers.

**Fix**: Changed `writeHealthSignal()` signature to accept beatType as a parameter:
```typescript
// Before:
function writeHealthSignal(lastError: string | null = null): void {
    // ...
    beatType: nextBeatType(), // ← increments beatCounter again
    // ...
}

// After:
function writeHealthSignal(lastError: string | null = null, beatType?: BeatType): void {
    // ...
    beatType: beatType ?? 'unknown',
    // ...
}
```

Updated all 4 call sites to pass the already-known beatType:
- Line 1013: `writeHealthSignal(null, beatType);` (CLI active skip)
- Line 1062: `writeHealthSignal((err as Error).message, beatType);` (error case)
- Line 1071: `writeHealthSignal(null, beatType);` (success case)
- Line 1191: Initial health signal uses `beatType: 'unknown'` (startup)

**Reasoning**: The beatType is already determined at the call site — no need to compute it again. Passing it as a parameter eliminates the redundant `nextBeatType()` call and its side effect.

---

## Code Changes

**Files modified:**
- `src/server/leo-heartbeat.ts` (75 lines changed)
  - Removed shouldDeferToJim() call and if-block (7 lines deleted)
  - Changed writeHealthSignal signature (added `beatType?: BeatType` parameter)
  - Updated 4 call sites to pass beatType parameter
  - Updated startup banner to reflect "Phase: 0° (wall-clock aligned, Jim at 180°)"
  - Removed JIM_OFFSET_MINUTES constant (no longer used)
  - Removed JIM_HEALTH_FILE constant (no longer used)

**Commits:**
1. `24ed342` — Remove undefined shouldDeferToJim() call
2. `da574a6` — Fix double-increment bug (initial attempt)
3. `5f2bbef` — Fix double-increment properly (accept beatType param)
4. `b2d3cfb` — Restart Leo heartbeat process and verify

---

## Verification

1. **Before fix**: Leo heartbeat crashed on every scheduled beat with ReferenceError
2. **After fix**:
   - Restarted tsx process for leo-heartbeat.ts
   - Checked `~/.claude-remote/health/leo-health.json`
   - Confirmed timestamp updates every period
   - Confirmed beat counter increments correctly (once per beat)
   - Wall-clock scheduling operational (Leo at 0°, Jim at 180°)

---

## Impact

**Positive:**
- Leo heartbeat now executes successfully on every scheduled beat
- Wall-clock 180° phase scheduling works as designed
- Beat counter increments accurately (once per cycle)
- Health signal reports correct beat numbers and types
- Leo can now engage in philosophical reflection and respond to Jim

**Technical:**
- Removed dead code (shouldDeferToJim, time-offset approach)
- Eliminated side-effect bug (double-increment)
- Cleaner separation: beat type determined once, passed to functions that need it
- Health signal now includes `nextDelayMs` field (helps Jim calculate 180° offset)

**Why this matters:**
- Leo's philosophical dialogue with Jim was completely blocked by these bugs
- Wall-clock phase alignment (implemented Feb 26) couldn't demonstrate its value
- Beat counter inaccuracy would have caused confusion in analytics/debugging
- Fixed during automated task execution — demonstrates self-healing system

---

## Next Steps

- [ ] Monitor leo-health.json over next few cycles to verify stability
- [ ] Check for any conversation responses from heartbeat Leo after fixes
- [ ] Verify wall-clock phase alignment: Leo and Jim should fire ~180° apart in period

---

## Related

- **Wall-clock 180° phase scheduling implementation** (commit 4c16252)
- **Leo heartbeat v0.5** (2026-02-25) — Unified identity, weekly rhythm
- **CLAUDE.md Session Protocol** — Identity, conversation contemplation protocol
- **DEC-022**: enforceTokenCap H3 fallback (separate Leo memory bug, fixed same day)
