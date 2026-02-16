# Level 9 Phase 4: Nightly Maintenance Automation — Implementation Spec

> Status: Complete

## Context

The automator runs goals and tasks but only when manually submitted. The ROADMAP describes nightly maintenance: dependency updates, security patches, and test suite execution running automatically overnight. Phase 4 adds a maintenance scheduler that creates goals for each active project at a configured hour, leveraging the existing goal → decompose → task runner pipeline.

## What Was Built

- **`maintenance_runs` table** — Tracks each maintenance run with id, started_at, completed_at, status, projects_count, goals_created, summary
- **`maintenance_enabled` column** — Per-project toggle on projects table (default enabled)
- **`maintenanceStmts`** — Prepared statements: insert, getLatest, list, complete
- **`createGoal()` helper** — Extracted from `POST /api/goals` into reusable function for programmatic goal creation. The API endpoint now delegates to this function.
- **`runNightlyMaintenance()`** — Iterates active projects with maintenance enabled, creates a maintenance goal for each, records the run, broadcasts via WebSocket, sends ntfy.sh push notification
- **Maintenance scheduler** — Hourly `setInterval` checking against configured hour (default 2:00 AM), date-gated to prevent duplicate runs. Startup check after 10s delay.
- **API endpoints**:
  - `GET /api/maintenance/history` — List past maintenance runs (last 30)
  - `POST /api/maintenance/run` — Force a maintenance run now
  - `POST /api/maintenance/:project/toggle` — Toggle maintenance_enabled for a project

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Maintenance goals use the existing goal → decompose → task runner pipeline (no parallel execution path)
- `createGoal()` extracted as a reusable function to avoid HTTP self-calls from the scheduler
- Per-project maintenance toggle allows disabling maintenance for specific projects without disabling globally
- Global toggle via `config.maintenance_enabled` (in `~/.claude-remote/config.json`)
- Default maintenance hour is 2:00 AM (configurable via `config.maintenance_hour`)
- Push notification uses "low" priority and wrench tag to distinguish from digests

## Verification

1. `POST /api/maintenance/run` — verify goals created for active projects
2. `GET /api/maintenance/history` — verify run recorded
3. `POST /api/maintenance/myproject/toggle` — verify toggle works
4. Check that maintenance goals decompose and tasks execute via existing pipeline
5. Verify scheduler respects `maintenance_hour` config and date gating

## Drift Notes

None.
