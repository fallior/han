# Level 10 Phase E: Feedback Loop — Implementation Spec

> Status: Complete

## Context

The automator records task outcomes in `project_memory` (model, success, cost, turns, duration) but never uses this data for decisions. Phase E closes the feedback loop: memory-based model routing chooses the cheapest model with proven success, analytics provide visibility into performance and cost, and a bug fix ensures outcomes are recorded exactly once.

## What Was Built

- **Bug fix** — `recordTaskOutcome()` moved from `updateGoalProgress()` (where it duplicated records N times) into `runNextTask()` success/failure paths (exactly once per task). Also fixes standalone tasks never being recorded.
- **`recommendModel()`** — Pure function in orchestrator.js that queries `project_memory` for cheapest model with acceptable success rate. Falls back from task-type-specific to project-wide stats when data is sparse. Configurable thresholds (minSampleSize: 5, minSuccessRate: 0.7).
- **Model routing integration** — Goal decomposition checks `recommendModel()` before assigning models. Only downgrades (cheaper), never upgrades. Logs overrides.
- **Analytics API** — `GET /api/analytics` returns global stats, per-model breakdown, per-project breakdown, 7-day velocity with trend, and cost optimisation suggestions (model downgrade opportunities).

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | Bug fix, analytics endpoint, model routing wiring |
| `src/server/orchestrator.js` | `recommendModel()` function |

## Key Decisions

- `recommendModel()` is a pure function (no LLM call) — queries SQLite directly for fast, deterministic, zero-cost recommendations
- Only downgrade, never upgrade — memory-based recommendation can suggest cheaper model but never more expensive than LLM's suggestion
- Minimum sample size of 5 prevents premature optimisation from lucky single runs
- Falls back from task_type-specific to project-wide stats since most goal tasks have `task_type = 'unknown'`

## Verification

1. Run a standalone task — verify exactly 1 record in `project_memory`
2. `GET /api/analytics` — verify global, byModel, byProject, velocity, suggestions structure
3. Submit a multi-task goal — check server logs for model recommendation messages
4. `GET /api/orchestrator/memory/:project` — verify existing API still works

## Drift Notes

None.
