# Session Note: Dependency Resolution Bug Fix

**Date**: 2026-02-22
**Author**: Claude (autonomous)
**Type**: Bug fix
**Duration**: ~15 minutes

## Summary

Fixed critical bug in task dependency resolution where cancelled tasks did not satisfy dependencies, causing all downstream tasks to remain permanently blocked even after correct ghost task recovery.

## Problem

The task dependency system in `planning.ts:getNextPendingTask()` only considered `status='done'` as satisfying a dependency. When ghost tasks were correctly cancelled by `detectAndRecoverGhostTasks()`, their dependent tasks remained blocked indefinitely.

**Manifestation**: In goal mlxo5qjq-hdl2l5 (Conversation Catalogue), two ghost tasks were correctly detected and cancelled in supervisor cycle #343, but all 9 downstream tasks stayed in 'pending' status and were never scheduled because their cancelled dependencies weren't considered satisfied.

## Root Cause

Line 1472 in `src/server/services/planning.ts`:
```typescript
return dep && dep.status === 'done';
```

This meant:
- Cancelled dependencies → dependency NOT satisfied → downstream tasks blocked forever
- Ghost task recovery (detect → cancel) created orphaned tasks that would never run
- Recovery pipeline incomplete: detect ✅ → cancel ✅ → unblock ❌

## Solution

Changed dependency check to accept both 'done' and 'cancelled' as terminal states:

```typescript
return dep && (dep.status === 'done' || dep.status === 'cancelled');
```

**Reasoning**: A cancelled dependency is resolved — the dependency relationship has been examined and the task is terminal (no longer pending/running). Whether it completed successfully or was cancelled, the scheduler doesn't judge the outcome, only whether the dependency is resolved.

## Code Changes

| File | Lines Changed | Description |
|------|---------------|-------------|
| `src/server/services/planning.ts` | Line 1472 (1 line) | Changed dependency satisfaction check to include 'cancelled' |

## Verification

After deploying the fix:
1. Restarted server
2. Checked task queue for goal mlxo5qjq-hdl2l5
3. **Result**: All 9 downstream tasks immediately transitioned from "blocked by cancelled dependency" to "pending (schedulable)"
4. Orchestrator can now pick them up for execution

Affected tasks:
- mlxo8wdh-gahwz9 (was blocked by cancelled mlxo8wdf-s5zext)
- mlxo8wdh-eg06bs (was blocked by cancelled mlxo8wdg-v92287)
- 7 additional tasks in the dependency chain

## Impact

**Positive:**
- Ghost task recovery pipeline now works end-to-end
- No more orphaned tasks stuck forever due to cancelled dependencies
- Downstream work can proceed after ghost task cancellation
- System fully recovers from agent crashes and ghost tasks

**Why this is critical:**
- Ghost task detection (DEC-019) runs every 5 minutes
- Cancelling ghost tasks is the correct recovery action
- Without this fix, every ghost task created a cascade of permanently blocked downstream tasks
- This would have caused task queue gridlock over time

## Documentation

- **DEC-020**: Added to DECISIONS.md with status "Settled"
  - Documented context, options considered, decision, consequences
  - Marked "Settled" because this completes a critical recovery mechanism
  - Changing this would require redesigning the entire ghost recovery strategy
- **CURRENT_STATUS.md**: Added to "Recent Changes" section
- **Session note**: This file

## Related Work

- **DEC-019**: Ghost Task Detection with Periodic Check (2026-02-22)
  - This fix completes the recovery pipeline introduced in DEC-019
- **DEC-016**: Automated Phantom Goal Cleanup (2026-02-20)
  - Similar self-healing approach for goals instead of tasks

## Commits

1. `d7afaa3` — fix: allow cancelled tasks to satisfy dependencies (initial fix)
2. `dcba76e` — fix: Fix dependency resolution to treat cancelled tasks as satisfied (clean implementation)
3. `863b7d1` — fix: Verify fix by restarting server and checking task schedulability
4. `5ff9e30` — docs: Document DEC-020 — Cancelled Tasks Satisfy Dependencies
5. `82a53df` — fix: Document the fix in DECISIONS.md or session notes

## Key Insights

1. **Recovery pipelines must be complete**: A recovery mechanism that detects and cancels stuck tasks is useless if cancellation creates new blocks downstream.
2. **Semantic meaning of 'cancelled'**: Cancelled doesn't mean "failed" or "blocked" — it means "this dependency is resolved by being deliberately removed from the workflow". Downstream work can proceed.
3. **Test recovery end-to-end**: The ghost detection system was tested in isolation, but the interaction with dependency resolution created a new failure mode. Integration testing would have caught this.

## Next Steps

- Monitor task queue over next 24 hours to verify no regression
- If ghost tasks continue to appear, investigate root causes (why are agents crashing?)
- Consider adding dependency graph visualisation to admin UI for debugging

---

**Status**: ✅ Complete
**Verification**: ✅ Passed (9 tasks unblocked in mlxo5qjq-hdl2l5)
**Documentation**: ✅ Complete (DECISIONS.md, CURRENT_STATUS.md, session note)
