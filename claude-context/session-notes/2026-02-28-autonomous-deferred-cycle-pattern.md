# Session Note: Deferred Cycle Pattern Complete (Gary Model)

**Date**: 2026-02-28
**Author**: Claude (autonomous)
**Session Type**: Autonomous task execution
**Goal**: Implement the Gary Model fs.watch for Jim's supervisor — complete the deferred cycle pattern

---

## Summary

Implemented the deferred cycle resumption pattern for Jim's supervisor, mirroring the fs.watch approach Leo's heartbeat already uses (the "Gary Model"). Jim now detects when Leo's CLI session stops and immediately runs deferred cycles, eliminating up to 20-minute waits for Darron's messages in conversation threads.

## What Was Built

### 1. Signal Watcher in Supervisor (`supervisor.ts`)

**Function: `startSupervisorSignalWatcher()`** (lines 191-240)
- Watches `~/.han/signals/` directory using `fs.watch()`
- Two detection patterns:
  1. **CLI stop detection**: When `cli-active` file is removed (rename event, file no longer exists)
     - Checks `deferredCyclePending` flag
     - Waits 3 seconds for CLI to fully release
     - Runs deferred supervisor cycle via `await runSupervisorCycle()`
     - Resets `deferredCyclePending = false`
  2. **Wake signal detection**: When `jim-wake-{timestamp}` file appears
     - Immediately triggers deferred cycle
     - Cleans up signal file after processing
     - Belt-and-suspenders approach for reliability

**Integration**:
- Called from `initSupervisor()` (line 565) during worker process initialisation
- Runs independently in the background — no blocking calls
- Error handling with try/catch and logging

**Exported function**:
- `isOpusSlotBusy()`: Exported from supervisor.ts for use in conversations.ts
- Checks if Opus slot is currently occupied (either CLI active or session active)

### 2. Wake Signal Writing (`conversations.ts`)

**Enhancement in `POST /api/conversations/:id/messages`** (lines 261-273):
- Imported `isOpusSlotBusy()` from supervisor.ts
- When human message arrives:
  1. Check if Opus slot is busy via `isOpusSlotBusy()`
  2. If busy, write timestamped signal file: `jim-wake-{timestamp}`
  3. Signal file triggers immediate deferred cycle when Jim's watcher detects it
- Error handling: logs failure but doesn't block message creation
- Location: `~/.han/signals/jim-wake-{timestamp}`

## Key Decisions

### Why fs.watch instead of polling?
- **Event-driven**: Immediate response when CLI stops (no polling delay)
- **Resource-efficient**: No CPU/memory overhead from polling loop
- **Pattern proven**: Leo's heartbeat already uses this approach successfully
- **Gary Model**: Named after the fs.watch pattern Leo developed

### Why both cli-active and jim-wake signals?
- **Belt-and-suspenders reliability**:
  - `cli-active` removal catches normal CLI stop (Leo's session ending)
  - `jim-wake` signals catch explicit wake requests (human messages while Opus busy)
- Different triggering contexts:
  - CLI stop: Leo's session-end protocol removes cli-active
  - Wake signal: Conversations route writes explicit wake when human posts message
- Both lead to same outcome: deferred cycle runs immediately

### Why 3-second delay after CLI stop?
- Mirrors Leo's pattern (gives CLI time to fully release resources)
- Prevents race conditions with CLI shutdown
- Short enough to feel instant, long enough to be safe

## Code Changes

### Files Modified
1. **`src/server/services/supervisor.ts`**:
   - Added `startSupervisorSignalWatcher()` function (49 lines)
   - Exported `isOpusSlotBusy()` function for use in other modules
   - Called watcher from `initSupervisor()`
   - Total additions: ~55 lines

2. **`src/server/routes/conversations.ts`**:
   - Imported `isOpusSlotBusy` from supervisor.ts
   - Added jim-wake signal writing logic (13 lines)
   - Wrapped in try/catch with logging

### Commits
1. `3eb3248` — feat: Add jim-wake signal writing in conversations.ts
2. `ad687c6` — feat: Implement startSupervisorSignalWatcher for deferred cycle resumption
3. `a6dc046` — feat: Implement startSupervisorSignalWatcher function in supervisor.ts
4. `1cb629f` — chore: Call startSupervisorSignalWatcher from initSupervisor
5. `fe87e2b` — test: Test and verify deferred cycle resumption

## Testing

### Manual Verification
1. Started supervisor worker process
2. Verified `deferredCyclePending` set when cycle runs while Opus busy
3. Removed cli-active file manually
4. Confirmed watcher fired deferred cycle within 3 seconds
5. Checked signal file cleanup (jim-wake files removed after processing)

### Integration Testing
- Deferred cycle pattern now works end-to-end:
  1. Darron posts message to conversation thread while Leo's CLI is active
  2. Supervisor tries to run cycle → detects Opus busy → sets `deferredCyclePending = true`
  3. Conversations route writes `jim-wake-{timestamp}` signal
  4. Leo's session ends → cli-active removed OR jim-wake signal detected
  5. Watcher triggers deferred cycle immediately
  6. Jim processes Darron's message without 20-minute wait

## Impact

### Before This Implementation
- `deferredCyclePending` was set when Opus busy (supervisor.ts line 577)
- But no watcher to detect CLI stop
- Deferred cycles waited for next scheduled cycle (up to 20 minutes)
- Darron's messages sat unanswered until next natural cycle

### After This Implementation
- CLI stop detected immediately via fs.watch
- Deferred cycle runs within 3 seconds of CLI stopping
- Human messages trigger explicit wake signals
- Response time reduced from "up to 20 minutes" to "~3 seconds"
- Pattern matches Leo's heartbeat (symmetric design)

## Pattern: The Gary Model

This implementation is named the "Gary Model" after the fs.watch pattern Leo's heartbeat developed. Key characteristics:

1. **Event-driven signal detection**: fs.watch instead of polling
2. **Deferred action resumption**: Work deferred when resource busy, resumed when available
3. **Multiple trigger sources**: Both implicit (file removal) and explicit (wake signals)
4. **3-second grace period**: Short delay for resource release
5. **Cleanup after processing**: Remove signal files after handling

Leo's heartbeat uses this for detecting CLI starts/stops. Jim's supervisor now uses it for deferred cycle resumption.

## Next Steps

### Possible Future Enhancements
- [ ] Add deferred cycle metrics (how often cycles are deferred, average wait time)
- [ ] Consider abort logic for mid-cycle CLI starts (like Leo's heartbeat has)
- [ ] Track jim-wake signal frequency (how often explicit wakes are needed)

### Observability
- Logs: `[Supervisor] CLI stopped — running deferred cycle now`
- Logs: `[Supervisor] Wake signal detected: {filename} — running deferred cycle now`
- Health signal includes cycle count and status

## Learnings

### What Worked Well
- Mirroring Leo's pattern made implementation straightforward
- fs.watch is reliable for file-based signalling
- Belt-and-suspenders (two trigger paths) provides robustness

### What Could Be Improved
- Could add metrics on deferred cycle frequency
- Could track time saved vs previous behaviour
- Could add health check for watcher running status

## Reference Implementation

Leo's version in `leo-heartbeat.ts` (lines 1130-1140):
```typescript
fs.watch(SIGNALS_DIR, async (event, filename) => {
    if (event === 'rename' && filename === 'cli-active') {
        if (fs.existsSync(path.join(SIGNALS_DIR, 'cli-active'))) {
            // CLI started — abort current beat
        } else if (deferredBeatPending) {
            await sleep(3000);
            deferredBeatPending = false;
            // run deferred beat
        }
    }
});
```

Jim's version mirrors this pattern with supervisor-specific logic.

---

## Related Documentation

- **CURRENT_STATUS.md**: Updated with recent changes entry
- **ARCHITECTURE.md**: Will be updated to document signal watcher system
- **DECISIONS.md**: May add decision record for deferred cycle pattern choice

## Conclusion

The deferred cycle pattern is now complete. Jim's supervisor immediately resumes deferred cycles when Leo's CLI stops, eliminating long waits for conversation responses. The implementation mirrors Leo's proven fs.watch pattern, providing symmetric design across both agents.

The "Gary Model" is now a shared pattern between Leo and Jim for event-driven resource availability detection.
