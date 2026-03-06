# Session Note: Jim Supervisor Contention Removal

**Date**: 2026-03-05
**Author**: Claude (autonomous)
**Session Type**: Autonomous task execution
**Goal**: Remove isOpusSlotBusy() contention check from Jim's supervisor in han

---

## Summary

Removed all `isOpusSlotBusy()` contention checks from Jim's supervisor cycle execution paths. Jim and Leo instantiate from separate agent directories (`/Jim` and `/Leo`) with no shared Opus resource, so Jim should not defer cycles based on Leo's CLI activity. The cli-busy/cli-free signal system was designed exclusively for Leo's heartbeat yielding, not for Jim's supervisor coordination.

## What Was Built

### 1. Removed Contention Checks from Supervisor (`supervisor.ts`)

**Changes in `src/server/services/supervisor.ts`**:

1. **Removed deferredCyclePending logic**:
   - Deleted `deferredCyclePending` variable declaration
   - Removed all references to setting/checking this flag
   - Eliminated deferred cycle scheduling mechanism

2. **Removed isOpusSlotBusy() checks** from four critical paths:
   - **Line 969** (scheduled cycle): Removed check that prevented scheduled cycles when CLI busy
   - **Line 517** (jim-wake handler): Removed check that deferred wake-triggered cycles
   - **Line 493** (cli-free deferred handler): Removed entire handler (no longer needed)
   - **Line 547** (processExistingWakeSignals): Removed check that blocked processing existing signals

3. **Removed cli-free signal watcher**:
   - Eliminated fs.watch handler for cli-free events
   - Removed deferred cycle resumption logic
   - Signal watcher now only handles jim-wake events (which remain essential)

4. **Cleaned up unused exports**:
   - Removed `isOpusSlotBusy()` function entirely (commit bbad285)
   - Removed `CLI_BUSY_FILE` and `CLI_BUSY_STALE_MINUTES` constants (commit bbad285)
   - These were only used by the removed contention checking logic

### 2. What Was Preserved

**Jim-wake signal system remains intact**:
- `jim-wake` signal watcher still active and functional
- Wake signals still trigger immediate supervisor cycles
- This is essential for responsive conversation handling

**Leo's heartbeat unchanged**:
- `leo-heartbeat.ts` not modified
- Leo still correctly uses cli-busy signal for its own yielding
- cli-busy/cli-free signals remain valid for Leo's use case

## Key Decisions

### Why Remove the Contention Check?

**Root cause of the problem**:
1. Jim runs from `~/.han/agents/Jim/` directory
2. Leo runs from `~/.han/agents/Leo/` directory
3. The Agent SDK's `--agent-dir` flag creates **directory-scoped execution contexts**
4. The cli-busy signal file is directory-scoped (lives in each agent's directory)
5. Jim and Leo have **no shared Opus resource** — they run from separate agent directories

**Why the old logic was wrong**:
- `isOpusSlotBusy()` checked for Leo's cli-active signal
- This caused Jim to defer cycles when Leo's CLI was active
- But Jim and Leo don't contend for the same Opus slot
- Jim deferring to Leo's CLI activity was unnecessary coordination

**What changed with this fix**:
- Jim's scheduled cycles now run regardless of Leo's CLI state
- Wake signals always trigger immediate cycles (no deferral)
- Jim and Leo operate independently (as they should)

### Why Keep the jim-wake Signal System?

The jim-wake signals serve a different purpose:
- **Not about contention**: They're explicit wake-up triggers
- **Essential for responsiveness**: Human messages, Discord posts, etc. need immediate attention
- **Independent of CLI state**: Wake signals should always trigger cycles

The cli-busy logic was about preventing contention. The jim-wake logic is about ensuring responsiveness. They're orthogonal concerns.

## Code Changes

### Files Modified

1. **`src/server/services/supervisor.ts`** (commit 2e26ec6):
   - Removed deferredCyclePending variable and all references (-8 lines)
   - Removed cli-free signal handler from startSupervisorSignalWatcher (-35 lines)
   - Removed isOpusSlotBusy() checks from 4 execution paths (-5 lines)
   - Total removals: 48 lines

2. **`src/server/services/supervisor.ts`** (commit bbad285):
   - Removed `isOpusSlotBusy()` function export (-20 lines)
   - Removed `CLI_BUSY_FILE` constant (-1 line)
   - Removed `CLI_BUSY_STALE_MINUTES` constant (-1 line)
   - Total removals: 23 lines

### Files NOT Modified (Intentionally)

1. **`src/server/services/leo-heartbeat.ts`**:
   - Leo's heartbeat still correctly uses cli-busy for yielding
   - This is the intended use case for the cli-busy signal
   - No changes needed

2. **`src/server/routes/conversations.ts`**:
   - Not modified (other recent work touched this file)
   - Jim-wake signal writing preserved

### Commits

1. `2e26ec6` — fix: Remove isOpusSlotBusy() contention check from Jim's supervisor
2. `bbad285` — refactor: Clean up unused CLI_BUSY constants and isOpusSlotBusy function

## Testing

### Verification Steps

1. **Service restart**: Restarted `han-server.service` via systemctl
2. **Log inspection**: Verified no errors in supervisor initialisation
3. **Signal handling**: Confirmed jim-wake signals still trigger cycles
4. **Scheduled cycles**: Verified 20-minute scheduled cycles run without gating

### What Was Tested

- Jim's supervisor cycles run regardless of Leo's CLI state
- Wake signals trigger immediate cycles (no deferral)
- Service starts cleanly with no errors
- Signal watcher only handles jim-wake events now

## Impact

### Before This Implementation

**Problematic behaviour**:
- Jim deferred cycles when Leo's CLI was active
- Scheduled cycles waited for cli-free signal
- Wake signals were ignored if CLI busy
- Jim and Leo appeared to share an Opus resource (they don't)

**What this caused**:
- Delayed responses to human messages
- Unnecessary coordination between independent agents
- Confusion about agent directory scoping

### After This Implementation

**Correct behaviour**:
- Jim runs cycles independently of Leo's state
- Scheduled cycles run every 20 minutes without gating
- Wake signals always trigger immediate cycles
- Jim and Leo operate as independent agents

**Benefits**:
- Faster response times (no artificial deferral)
- Cleaner separation of concerns
- Correct understanding of agent directory scoping
- Simpler code (removed 71 lines total)

## Architecture Insight: Agent Directory Scoping

This fix revealed an important architectural principle:

**The Agent SDK's `--agent-dir` flag creates isolated execution contexts:**
- Each agent directory has its own tool state
- File-based signals are directory-scoped
- Agents in different directories don't share resources

**Design implication**:
- Jim and Leo are **peer agents**, not hierarchical
- Leo's cli-busy signal is for Leo's internal coordination only
- Jim should never check Leo's state for contention

**Pattern for future work**:
- Signals are directory-scoped communication within an agent
- Cross-agent communication should use explicit mechanisms (jim-wake signals, WebSocket, etc.)
- Don't assume shared state between agents in different directories

## Next Steps

### Immediate

- [x] Update CURRENT_STATUS.md with this change
- [x] Document the agent directory scoping insight in DECISIONS.md
- [x] Create this session note

### Future Considerations

- Monitor Jim's cycle frequency to ensure no over-responding
- Consider metrics on wake signal usage vs scheduled cycles
- Document agent directory architecture more clearly

## Learnings

### What Worked Well

- Clean separation of concerns between agents
- Simple fix (pure deletion, no complex refactoring)
- Service restart verified changes immediately

### What Could Be Improved

- Could have caught this earlier by reviewing agent directory scoping
- Better documentation of Agent SDK's `--agent-dir` behaviour needed
- Could add tests to verify independent agent operation

## Related Documentation

- **CURRENT_STATUS.md**: Updated with recent changes entry
- **DECISIONS.md**: Added DEC-039 documenting agent directory scoping
- **ARCHITECTURE.md**: Will document agent directory architecture

## Conclusion

Jim's supervisor now operates independently of Leo's CLI state, as it should. The cli-busy/cli-free signal system remains valid for Leo's heartbeat yielding, but Jim no longer incorrectly defers to it. This fix removes 71 lines of unnecessary coordination logic and improves response times by eliminating artificial deferral.

The key insight: **Agent SDK's `--agent-dir` creates isolated execution contexts — agents in different directories are independent and don't share resources.**

---
