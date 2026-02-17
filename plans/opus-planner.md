# Opus Planner — Implementation Spec

> Status: Complete

## Context

The orchestrator's `decomposeGoal()` uses Ollama 7B (or Anthropic Haiku fallback) to break goals into tasks. This produces poor quality plans and frequently times out on long prompts. The user manually drives Claude Code (Opus) for all real planning — the orchestrator should do the same.

## What Was Built

- **`planGoal()`** in `server.js` — Agent SDK call with Opus that explores a project with real tools (Read, Glob, Grep, Bash), understands the codebase, and outputs a structured JSON plan via `outputFormat: { type: 'json_schema' }`
- **Refactored `createGoal()`** — replaces `orchestrator.decomposeGoal()` with `planGoal()`, adds `planningModel` parameter
- **Planning session logging** — each planning session writes to `_logs/planning_*.md` with assistant text, tool uses, and cost
- **Planning cost tracking** — `planning_cost_usd` and `planning_log_file` columns on goals table
- **Configurable planning model** — defaults to Opus; pipeline child goals and maintenance use Sonnet for cost savings
- **Deprecated** `decomposeGoal()` and `classifyTask()` in orchestrator.js

## Architecture

```
Goal arrives (API, pipeline, maintenance)
    ↓
planGoal() — Agent SDK session with Opus
    ├── Explores: Read, Glob, Grep, Bash (read-only)
    ├── Outputs: structured JSON (subtasks, models, deps)
    └── Logs to: _logs/planning_*.md
    ↓
createGoal() — parses plan, creates tasks in DB
    ├── Memory-based model override (recommendModel)
    ├── Dependency mapping (title → task ID)
    └── WebSocket broadcast (goal_decomposed)
    ↓
runNextTask() — existing executor (unchanged)
    ├── Agent SDK with Haiku/Sonnet/Opus per task
    ├── Git checkpoints, commits, cost tracking
    └── Failure analysis + retry (unchanged)
```

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | `planGoal()`, refactored `createGoal()`, DB migration, API updates |
| `src/server/orchestrator.js` | Deprecated `decomposeGoal()`, `classifyTask()` |

## Key Decisions

- **Agent SDK over CLI**: SDK provides streaming, cost tracking, `canUseTool` callback, `AbortController` — CLI pipe mode lacks all of these (DEC-007)
- **JSON schema output**: SDK's `outputFormat` enforces plan structure server-side, no regex/parsing needed. `structured_output` on result contains parsed object.
- **Read-only planning**: `tools: ['Read', 'Glob', 'Grep', 'Bash']` — planner explores but doesn't modify. Bash needed for `git log`, `ls`, etc.
- **Sonnet for pipeline/maintenance**: Pre-scoped goals (pipeline subagents, nightly maintenance) use Sonnet planning to save cost. User-created goals default to Opus.
- **Keep Ollama for failure analysis**: `analyseFailure()` still uses `callLLM()` (Ollama/Haiku) for quick retry decisions. No need for Opus on a 15-second classification call.

## Post-build

- [ ] Restart server: `kill $(cat ~/.claude-remote/server.pid) && cd src/server && node server.js &`
- [ ] Test with: `curl -sk -X POST https://localhost:3847/api/goals -H 'Content-Type: application/json' -d '{"description":"Add a README.md","project_path":"/tmp/test"}'`

## Verification

1. `node -c src/server/server.js` — syntax check
2. `POST /api/goals` — verify Opus planning starts (check server logs)
3. Verify planning log created in `_logs/planning_*.md`
4. Verify tasks created with correct models, priorities, dependencies
5. `GET /api/orchestrator/status` — verify `planningBackend: 'agent_sdk'`
6. Verify pipeline child goals use Sonnet planning
7. Check `planning_cost_usd` stored on goal record

## Drift Notes

None — clean implementation.
