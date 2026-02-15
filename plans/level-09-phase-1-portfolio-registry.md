# Level 9 Phase 1: Portfolio Manager & Project Registry — Implementation Spec

> Status: Complete

## Context

Levels 7-8 delivered autonomous task execution and intelligent orchestration for a single project. Level 9 extends this to the entire Contempire portfolio — 13+ projects managed from one interface. Phase 1 lays the foundation: syncing the existing infrastructure registry into SQLite, computing aggregate stats per project, and providing a Portfolio tab in the mobile UI.

The infrastructure registry at `~/Projects/infrastructure/registry/services.toml` already had all 13 projects registered with paths, descriptions, and lifecycle status. No new data source was needed — just a sync pipeline.

## What Was Built

- `projects` SQLite table synced from infrastructure registry TOML on server startup
- Line-by-line TOML parser (no npm dependency — the registry format is flat)
- Aggregate query helpers computing task/goal/cost stats per project from existing tables
- 3 API endpoints: list portfolio, update priority, trigger re-sync
- Portfolio tab in task overlay with project cards, drill-down detail, priority controls
- `<datalist>` autocomplete on all project path inputs (task creation + goal creation)

## Architecture

```
infrastructure/registry/services.toml
        │
        ▼ (syncRegistry on startup)
   ┌──────────┐
   │ projects │ SQLite table
   │  table   │ (name, description, path, lifecycle, priority)
   └────┬─────┘
        │
        ▼ GET /api/portfolio
   ┌──────────────────┐
   │ Enrich with stats │ ← aggregate queries on tasks + goals tables
   └────────┬─────────┘
            │
            ▼
   ┌────────────────┐
   │ Portfolio tab   │ cards → drill-down → create task
   │ (mobile UI)     │
   └────────────────┘
```

Key pattern: **No denormalised cost tracking.** Stats are computed live from existing `tasks` and `goals` tables via GROUP BY queries. This avoids sync bugs and means portfolio stats are always accurate.

## Implementation Detail

### 1. Projects table + prepared statements
**File:** `src/server/server.js` (after project_memory table creation)

```sql
CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    description TEXT,
    path TEXT NOT NULL,
    lifecycle TEXT DEFAULT 'active',
    priority INTEGER DEFAULT 5,
    last_synced_at TEXT
)
```

Prepared statements (`portfolioStmts`):
- `upsert` — INSERT OR REPLACE (preserves user-set priority via ON CONFLICT)
- `list` — ORDER BY priority DESC, name ASC
- `get` — by name
- `updatePriority` — SET priority WHERE name

### 2. TOML parser + syncRegistry()
**File:** `src/server/server.js` (before first route definition)

`parseRegistryToml(content)` — line-by-line parser:
- Matches top-level sections `[name]` (not `[name.subsection]`)
- Skips `[meta]` section
- Extracts `description`, `path`, `lifecycle` from key-value pairs
- Expands `~` in paths to `$HOME`
- Returns array of `{ name, description, path, lifecycle }`

`syncRegistry()` — reads TOML file, upserts each project, logs count. Called once after `portfolioStmts` is initialised (ordering matters — was a bug on first deploy).

Registry path: `~/Projects/infrastructure/registry/services.toml`

### 3. Aggregate query helpers
**File:** `src/server/server.js` (after syncRegistry)

- `getProjectStats(projectPath)` — single-project stats via two prepared queries (tasks + goals)
- `getAllProjectStats()` — all projects via GROUP BY, returns `{ [path]: stats }` map

Stats shape: `{ tasks_total, tasks_completed, tasks_failed, tasks_running, tasks_pending, total_cost_usd, goals_total, goals_completed }`

### 4. Portfolio API endpoints
**File:** `src/server/server.js` (after goal endpoints, before orchestrator endpoints)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/portfolio` | GET | List all projects with enriched stats |
| `/api/portfolio/:name` | PUT | Update project priority (0-10) |
| `/api/portfolio/sync` | POST | Re-sync from TOML on demand |

### 5. Portfolio tab UI
**File:** `src/ui/index.html`

HTML: Portfolio tab button (`data-task-tab="portfolio"`), portfolio section with sync button and content div.

CSS: `.portfolio-card`, `.portfolio-stat`, `.portfolio-lifecycle`, `.portfolio-priority-select`, `.portfolio-detail-back`

JavaScript:
- `loadPortfolio()` — fetches GET /api/portfolio, stores in `portfolioData`, updates datalist
- `renderPortfolio()` — renders project cards with stats badges
- `renderProjectDetail(name)` — drill-down with stats summary, priority selector, "Create Task" button
- `updateProjectPriority(name, priority)` — PUT request
- `updateProjectPathsDatalist()` — populates `<datalist id="projectPaths">`
- Portfolio data pre-loaded on page load for datalist autocomplete

### 6. Datalist autocomplete
**File:** `src/ui/index.html`

`<datalist id="projectPaths">` populated from portfolio data. Wired via `list="projectPaths"` attribute on:
- `#goalProjectPath` input (Goals tab)
- `#taskPath` input (Create task tab)

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | Projects table, TOML parser, syncRegistry, aggregate queries, 3 API endpoints |
| `src/ui/index.html` | Portfolio tab (HTML + CSS + JS), datalist autocomplete |
| `~/Projects/infrastructure/registry/services.toml` | Source of truth for project registry (read-only) |

## Key Decisions

- **No npm TOML parser** — the registry format is flat enough for a 30-line custom parser
- **Live aggregate queries** — no denormalised cost/stats columns on the projects table; computed from tasks/goals tables on each request
- **Priority is user-controlled** — syncRegistry preserves priority via ON CONFLICT (only updates description, path, lifecycle, last_synced_at)
- **Datalist over dropdown** — allows both autocomplete and free-form paths for projects not in the registry

## Verification

1. Start server → console shows `[Portfolio] Synced 13 projects from registry`
2. `curl https://localhost:3847/api/portfolio` → returns 13 projects with stats
3. Open UI → Tasks overlay → Portfolio tab shows all projects as cards
4. Tap a project → drill-down shows stats, priority selector, "Create Task" button
5. Change priority → refreshes, project reorders in list
6. "Create Task" button → switches to Create tab with project path pre-filled
7. Create tab → project path input shows autocomplete from registry
8. Goals tab → project path input shows autocomplete from registry
9. `curl -X POST https://localhost:3847/api/portfolio/sync` → re-syncs, returns count
10. After running a task for a project, portfolio stats reflect updated counts/cost

## Drift Notes

- **syncRegistry() ordering bug**: Initially placed the `syncRegistry()` call before `portfolioStmts` was defined (line 230 vs line 1752). Fixed in `4b4aa7e` by moving the call after prepared statement initialisation. Lesson: in a single large file with hoisted functions but non-hoisted `const`, call order matters.

---

*Implementation spec — actionable for the task automator. Commits: `1f956d9`, `4b4aa7e`.*
