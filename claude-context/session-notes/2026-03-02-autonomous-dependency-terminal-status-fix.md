# Dependency Ghost-Task Blocker Fix

**Date**: 2026-03-02
**Author**: Claude (autonomous)
**Goal**: mm8tjx46-fdxbs6
**Task**: mm8tl5xt-fjgwet
**Model**: Sonnet
**Cost**: $0.2188

## Summary

Fixed a critical bug in the orchestrator's dependency resolution logic where tasks with status 'failed' (retry-exhausted) would permanently block their dependents from executing. This 2-line change treats 'failed' as a terminal status alongside 'done' and 'cancelled', eliminating goal pipeline stalls caused by ghost tasks.

## What Was Built

### Bug Description

The orchestrator's `planning.ts` had two dependency check functions that determined whether a task's dependencies were satisfied:

1. **`getNextPendingTask()` at line 1497** — Selects next task for execution
2. **`getNextHighPriorityTask()` at line 1880** — Selects high-priority tasks

Both functions checked if dependencies were in a terminal state using:

```typescript
return dep && (dep.status === 'done' || dep.status === 'cancelled');
```

**The problem**: Tasks with `status === 'failed'` (after exhausting all retry attempts) were NOT considered terminal. Their dependents would never become eligible for execution, permanently stalling the goal pipeline.

### The Fix

Added `|| dep.status === 'failed'` to both dependency checks:

**Line 1497** (in `getNextPendingTask`):
```typescript
// Before
return dep && (dep.status === 'done' || dep.status === 'cancelled');

// After
return dep && (dep.status === 'done' || dep.status === 'cancelled' || dep.status === 'failed');
```

**Line 1883** (in `getNextHighPriorityTask`):
```typescript
// Before
return dep && (dep.status === 'done' || dep.status === 'cancelled');

// After
return dep && (dep.status === 'done' || dep.status === 'cancelled' || dep.status === 'failed');
```

### Consistency with Existing Code

This change aligns these two locations with the terminal-status pattern already used elsewhere in `planning.ts`:

- **Line 643**: Task archival logic uses `status === 'done' || status === 'cancelled' || status === 'failed'`
- **Line 702**: Dependency satisfaction check uses same pattern

The bug fix brings all dependency checks into consistency.

## Impact

### Before This Fix

1. Task A exhausts all retries → status becomes 'failed'
2. Task B depends on Task A
3. Task B never becomes eligible for execution (dependency not satisfied)
4. Goal containing Task B stalls permanently
5. Human intervention required: manually cancel Task A OR Task B

**Every retry-exhausted task became a ghost-task blocker.**

### After This Fix

1. Task A exhausts all retries → status becomes 'failed'
2. Task B depends on Task A
3. Orchestrator recognises 'failed' as terminal → Task B eligible for execution
4. Goal pipeline continues making progress
5. No human intervention required

**Failed tasks behave the same as cancelled tasks: they unblock their dependents.**

## Code Changes

### Files Modified

**src/server/services/planning.ts** (2 lines changed):
- Line 1497: Added `|| dep.status === 'failed'` to `getNextPendingTask()` dependency check
- Line 1883: Added `|| dep.status === 'failed'` to `getNextHighPriorityTask()` dependency check

### Implementation Details

The fix used `replace_all: true` with the Edit tool to update both occurrences in a single operation, ensuring consistency.

## Testing

No explicit test cases were added (this was a straightforward bug fix), but the fix:

1. **Prevents future stalls**: Failed tasks will no longer block dependents
2. **Matches existing patterns**: Aligns with terminal-status checks at lines 643 and 702
3. **Semantic correctness**: A failed task IS terminal — it won't change state again

The autonomous agent verified both locations were updated correctly before committing.

## Why This Matters

This was a **critical orchestrator bug** that undermined the entire autonomous task execution system. Every task that exhausted retries created a permanent bottleneck requiring manual intervention. The orchestrator's escalating retry ladder (Haiku → Sonnet → Opus) was designed to handle difficult tasks autonomously, but the ghost-task blocker meant failures still required human cleanup.

With this fix, the orchestrator can truly operate autonomously:
- Failed tasks are terminal, just like cancelled tasks
- Dependents proceed despite upstream failures
- Goals complete even when individual tasks fail
- Human intervention only needed for genuine blockers (not retry exhaustion)

## Next Steps

1. Monitor goal completion rates over the next week to verify the fix eliminates ghost-task stalls
2. Consider adding explicit tests for dependency resolution with all three terminal statuses
3. Review other locations in the codebase for similar terminal-status patterns that might be inconsistent

## Related

- **planning.ts lines 643, 702**: Existing terminal-status patterns that this fix now matches
- **Escalating retry ladder** (L017): Failed tasks are the outcome of exhausted retry attempts
- **Orchestrator design**: Goal decomposition and dependency resolution (Level 8)

---

**Why this matters**: A 2-line fix that eliminates a systemic bottleneck in autonomous task execution. Every ghost task previously required manual supervisor intervention — now they're handled automatically, making the orchestrator truly autonomous.
