# Session Note — Jim-Wake Handler Guard Fix

**Date**: 2026-02-28
**Author**: Claude (autonomous)
**Type**: Bug fix
**Duration**: ~23 seconds (1 task in goal)

## Summary

Fixed critical bug in Jim's supervisor where the jim-wake signal handler fired deferred cycles without checking if the Opus slot was busy, causing cycle #882 to hang for 10+ hours on a dead API call. Added `isOpusSlotBusy()` guard before `runSupervisorCycle()` call to mirror the defensive pattern already used by the cli-active handler.

## What Was Built

### Files Changed
- `src/server/services/supervisor.ts` (lines 224-233)
  - Added `isOpusSlotBusy()` guard after 500ms delay, before cycle execution
  - Re-sets `deferredCyclePending = true` if Opus busy (stays deferred)
  - Early return with clear log message: "Wake signal but Opus busy — staying deferred"
  - Updated cleanup comment: "whether cycle ran or was skipped"

## Key Decisions

No new architectural decisions — this fix applies the existing defensive pattern from the cli-active handler (lines 196-208) to the jim-wake handler.

**Pattern consistency**: Both handlers now check resource availability before firing cycles:
- cli-active handler: checks `!isCliActive()` before running deferred cycle
- jim-wake handler: checks `isOpusSlotBusy()` before running deferred cycle

## Code Changes

### supervisor.ts (jim-wake handler)

**Before** (lines 221-229):
```typescript
try {
    // Small delay to let signal file fully write
    await new Promise(r => setTimeout(r, 500));
    await runSupervisorCycle();
} catch (err) {
    console.error('[Supervisor] Wake signal cycle error:', (err as Error).message);
} finally {
    // Clean up signal file
    try {
        fs.unlinkSync(path.join(SIGNALS_DIR, filename));
    } catch { /* file may already be cleaned */ }
}
```

**After** (lines 221-237):
```typescript
try {
    // Small delay to let signal file fully write
    await new Promise(r => setTimeout(r, 500));
    if (isOpusSlotBusy()) {
        console.log('[Supervisor] Wake signal but Opus busy — staying deferred');
        deferredCyclePending = true;
        return;
    }
    await runSupervisorCycle();
} catch (err) {
    console.error('[Supervisor] Wake signal cycle error:', (err as Error).message);
} finally {
    // Clean up signal file whether cycle ran or was skipped
    try {
        fs.unlinkSync(path.join(SIGNALS_DIR, filename));
    } catch { /* file may already be cleaned */ }
}
```

**Changes**:
1. Added 4-line guard block checking `isOpusSlotBusy()`
2. Log message when skipping cycle
3. Re-set `deferredCyclePending = true` to keep cycle deferred
4. Early `return` to skip cycle execution
5. Updated cleanup comment for clarity

## Next Steps

None — bug is fixed. The jim-wake signal handler now has full Opus slot protection.

## Related Work

- **DEC-023**: Deferred Cycle Pattern via fs.watch (Gary Model) — introduced jim-wake signals
- **Cycle #882**: The 10+ hour hang that prompted this fix
- **cli-active handler**: Lines 196-208 in supervisor.ts — reference implementation of the defensive pattern

## Impact

**Before**: jim-wake signals could fire supervisor cycles while Opus was already busy (e.g., Leo's CLI session), causing cycles to hang indefinitely on dead API calls.

**After**: jim-wake signals check Opus availability before firing cycles. If busy, the cycle stays deferred and the signal is cleaned up. This prevents hangs and ensures the deferred cycle waits for Opus to become truly available.

**Cost savings**: Prevents wasted API budget on hung cycles.

**Reliability**: Supervisor cycles no longer hang when wake signals fire during active CLI sessions.

---

**Session completed successfully** — 1 task, 1 commit (6cd1b35), 22.9 seconds, $0.1002 cost.
