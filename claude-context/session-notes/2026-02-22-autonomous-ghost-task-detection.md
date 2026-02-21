# Session Note: Ghost Task Detection and Recovery

**Date:** 2026-02-22
**Author:** Claude (autonomous)
**Session Type:** Autonomous goal execution
**Goal:** Add ghost task detection and recovery for tasks stuck in 'running' status with no active agent process

## Summary

Implemented automated ghost task detection to identify and recover tasks that are stuck in 'running' status despite having no active agent process. This prevents tasks from being permanently stuck when the agent crashes, server restarts mid-task, or other failure scenarios occur. Enhanced supervisor's cancel_task action to handle ghost-running tasks, enabling autonomous recovery without manual intervention.

## What Was Built

### 1. Ghost Task Detection Function (398ee8a)
- **Implementation:** `detectAndRecoverGhostTasks()` in `planning.ts` (lines ~900-940)
- **Detection criteria:** Tasks with:
  - status = 'running'
  - turns = 0 (never made progress)
  - started_at > 15 minutes ago
- **Recovery logic:**
  - Resets task status to 'pending'
  - Increments retry_count
  - Triggers escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human escalation)
  - Clears started_at timestamp
- **Return value:** Count of ghost tasks detected and reset
- **Query:**
  ```sql
  SELECT * FROM tasks
  WHERE status = 'running'
  AND turns = 0
  AND started_at < (now - 15 minutes)
  ```

### 2. Enhanced Supervisor cancel_task (1b88b67)
- **Three scenarios supported:**
  1. **Pending tasks:** Cancel directly in DB (existing behaviour)
  2. **Running tasks with live agent:** Import `getAbortForTask()`, abort agent via AbortController, then cancel in DB
  3. **Running tasks without agent (ghost):** Cancel directly in DB without abort attempt
- **Clear logging:**
  - "(was pending)" — task was waiting in queue
  - "(aborted live agent)" — killed an active agent process
  - "(was ghost-running)" — cancelled a ghost task with no agent
- **Supervisor system prompt update:** Reflects that cancel_task now works for both pending and running tasks
- **Task existence validation:** Checks task exists before attempting cancellation

### 3. Server Startup Integration (d6abbf0)
- **Startup ghost detection:**
  - `detectAndRecoverGhostTasks()` runs on server startup in `server.ts`
  - Catches orphaned tasks from crashes, manual restarts, or system reboots
  - Logged: "Checked for ghost tasks on startup: N detected and reset"
- **Periodic check:**
  - `setInterval` runs ghost detection every 5 minutes
  - Provides ongoing protection against new ghost tasks
  - Logged: "Checked for ghost tasks: N detected and reset"
- **Cost savings:** Prevents supervisor from spending budget monitoring tasks that will never complete

## Code Changes

| File | Changes | Purpose |
|------|---------|---------|
| `src/server/services/planning.ts` | +85 lines | detectAndRecoverGhostTasks() function with 15-min threshold and retry ladder integration |
| `src/server/services/supervisor.ts` | +34 lines | Enhanced cancel_task to detect and handle ghost-running tasks |
| `src/server/server.ts` | +17 lines | Ghost detection on startup + 5-minute periodic check via setInterval |

## Key Decisions

### DEC-019: Ghost Task Detection with Periodic Check

**Context:** Tasks can get stuck in 'running' status with no agent process when:
- Agent crashes mid-execution
- Server restarts during task execution
- Network issues disconnect agent
- System kills process due to resource constraints

The supervisor would monitor these stuck tasks indefinitely, wasting API budget observing tasks that would never complete.

**Options Considered:**

1. **Manual detection and cleanup**
   - ✅ Simple — no code needed
   - ❌ Requires human intervention every time
   - ❌ Doesn't prevent recurrence
   - ❌ Tasks stay stuck until human notices

2. **Detect only when supervisor observes**
   - ✅ Minimal overhead — only runs during supervisor cycles
   - ❌ Supervisor must be running to detect ghosts
   - ❌ Doesn't help if supervisor is disabled
   - ❌ Detection delayed until next supervisor cycle

3. **Detect in orchestrator loop before picking next task**
   - ✅ Runs frequently (every 5 seconds)
   - ❌ Couples ghost detection to task execution
   - ❌ Adds overhead to critical path
   - ❌ Doesn't run if no tasks are pending

4. **Periodic check at fixed intervals + startup check**
   - ✅ Runs independently of supervisor/orchestrator
   - ✅ Catches ghosts from crashes/restarts via startup check
   - ✅ Ongoing protection via periodic check
   - ✅ Clear separation of concerns
   - ✅ Deterministic intervals (predictable behaviour)
   - ❌ Small overhead every 5 minutes

**Decision:** Implemented **periodic check at 5-minute intervals + startup check** because:
- Independence: doesn't require supervisor or orchestrator to be active
- Crash recovery: startup check catches orphaned tasks immediately
- Ongoing protection: periodic check prevents new ghosts from accumulating
- Low overhead: 5 minutes is frequent enough to catch issues quickly without excessive queries
- Predictable: deterministic intervals make debugging easier

**Consequences:**
- Small query overhead every 5 minutes (1 SELECT query)
- Ghost tasks auto-reset to 'pending' and trigger retry ladder
- Supervisor can cancel ghost tasks via enhanced cancel_task action
- Prevents API cost waste on monitoring stuck tasks
- System self-heals from agent crashes and server restarts

**Implementation:**
- `detectAndRecoverGhostTasks()` runs on server startup
- `setInterval(..., 5 * 60 * 1000)` runs periodic check every 5 minutes
- Returns count of ghosts detected (logged for visibility)
- Supervisor's cancel_task checks `getAbortForTask()` to distinguish live agents from ghosts

## Testing

Verified via server logs and supervisor cycles:
- ✅ Ghost detection runs on server startup
- ✅ Periodic check runs every 5 minutes
- ✅ Ghost tasks correctly identified (status='running', turns=0, started_at > 15 min)
- ✅ Ghost tasks reset to 'pending' with retry_count incremented
- ✅ Supervisor cancel_task can cancel ghost-running tasks
- ✅ Clear logging distinguishes pending/live/ghost scenarios

## Next Steps

- Monitor ghost detection logs to understand failure patterns
- Consider shorter interval (2-3 minutes) if ghosts accumulate too quickly
- Add metrics: ghost tasks detected per day, common causes
- Investigate root causes of frequent ghost tasks (crashes, resource issues)

## Files Modified

```
src/server/services/planning.ts   | +85 lines (detectAndRecoverGhostTasks)
src/server/services/supervisor.ts | +34 lines (enhanced cancel_task)
src/server/server.ts               | +17 lines (startup + periodic check)
```

## Commits

- `398ee8a` — feat: Add ghost task detection and recovery
- `1b88b67` — feat: Enhance supervisor cancel_task to handle running tasks
- `d6abbf0` — refactor: Complete ghost task detection integration

## Cost Impact

**Savings:** Prevents supervisor from wasting budget on tasks that will never complete. A single ghost task could cost $0.10-$0.50 per supervisor cycle monitoring it indefinitely. This system eliminates that waste.

**Overhead:** ~1 SQL query every 5 minutes. Negligible cost compared to savings.

**ROI:** Very positive — prevents runaway costs from stuck tasks while adding minimal overhead.
