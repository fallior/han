# Level 10 Phase D: Community Awareness — Implementation Spec

> Status: Complete

## Context

The automator sees a flat list of sister projects (name, lifecycle, throttle). Phase D enriches this with port allocations from the infrastructure registry, per-project task queue state, and cross-project dependency documentation. This gives agents practical awareness to avoid port conflicts and understand workload distribution.

## What Was Built

- **Port extraction** — `parseRegistryToml()` enhanced to parse sub-sections and extract port allocations as `subsection.key` format (e.g., `app.web_port`, `supabase.db_port`)
- **Ports column** — `ports TEXT` on projects table (JSON object), synced from registry
- **Registry sync update** — `syncRegistry()` stores port JSON, upsert includes ports column
- **Enhanced ecosystem summary** — `getEcosystemSummary()` now shows ports, task queue counts (running/pending/done), throttle/priority flags per project
- **Ecosystem API** — `GET /api/ecosystem` returns structured JSON with per-project ports, task stats, budget data, plus summary text
- **Cross-project deps note** — context injection tells agents about `depends_on` cross-project task dependencies and port allocation awareness
- **Bug fix** — `getProjectStats()` and `getAllProjectStats()` fixed from `status = 'completed'` to `status = 'done'` (was returning 0 for all completed counts)

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Port display filtered to web/api/port keys only for brevity in context injection
- Full port data available via `/api/ecosystem` for programmatic access
- `getAllProjectStats()` called inside `getEcosystemSummary()` — acceptable since it's used infrequently (task context building)

## Verification

1. `GET /api/ecosystem` — verify ports populated for projects with port allocations
2. Check ecosystem summary text includes `[web:PORT, api:PORT]` format
3. Verify `getAllProjectStats()` returns correct completed counts (was broken before fix)
4. Submit a test task and check injected context includes ports in ecosystem section

## Drift Notes

None.
