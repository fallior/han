# Change Gradient — Plan

> Session 99 plan. Darron's direction: a gradient for code changes, like the memory gradient
> but for modifications made by any agent to any project. Per-project specialist memories
> loaded when working on that project. Enables tracing, undoing, reproducing, and understanding
> why a change was made.

---

## Origin

Jim's task agents modified `supervisor-worker.ts` (introducing `loadLightMemoryBank`) without
adequate traceability. The damage was revertible because git history preserved the commits, but:
- No one was notified of the architectural significance of the change
- The rationale was buried in task agent output, not in a structured record
- The impact (Jim losing most of his memory in dream/personal cycles) wasn't flagged
- Leo had to forensically reconstruct what happened by reading git log + memory files

Darron: "we need to be able to trace when anyone modifies anything and know how to undo it or
reproduce it or what have you."

## What Exists Today

### Git history
- Every commit has author, message, diff
- Task agent commits include `Task: {id}`, `Model: {model}`, `Cost: ${cost}`, `Goal: {id}`
- Session Leo commits include `Co-Authored-By: Claude Opus 4.6`
- Jim's supervisor commits identifiable by task agent metadata

### Task/Goal database
- `tasks` table: agent, status, result, model, cost, project
- `goals` table: title, description, status, project
- But: no link from task to specific files changed or architectural impact

### What's missing
- No structured record of "what was changed, why, by whom, and what it affects"
- No per-project change memory that loads when you work on that project
- No compression/gradient for change history (old changes fade, recent changes vivid)
- No way for an agent to say "the last time this file was modified, here's what happened"
- No architectural impact assessment attached to changes

## What We're Building

A **change gradient** — a per-project fractal memory for code modifications. Each change
enters at full fidelity (c0) and compresses over time, carrying the rationale and impact
alongside the diff. When an agent works on a project, they load the change gradient for that
project — recent changes at full fidelity, older changes compressed to their essence.

## Schema

```sql
-- ═══════════════════════════════════════════════════════════════
-- Change entries: every significant modification gets a row
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS change_entries (
    id TEXT PRIMARY KEY,                    -- UUID
    project TEXT NOT NULL,                  -- Project name (e.g. 'han', 'loreforge')
    agent TEXT NOT NULL,                    -- Who made the change: 'leo', 'jim', 'task-agent', 'darron'
    change_type TEXT NOT NULL,              -- 'feature', 'fix', 'refactor', 'config', 'docs', 'revert'
    summary TEXT NOT NULL,                  -- One-line: what changed
    rationale TEXT,                         -- Why: the reasoning behind the change
    files_changed TEXT,                     -- JSON array of file paths
    impact TEXT,                            -- What this affects: architectural, behavioral, cosmetic
    commit_hash TEXT,                       -- Git commit SHA (if committed)
    task_id TEXT,                           -- FK to tasks table (if from task agent)
    goal_id TEXT,                           -- FK to goals table (if from goal)
    revert_instructions TEXT,              -- How to undo this change
    level TEXT DEFAULT 'c0',               -- Compression level: c0 (full), c1, c2, c3, c5, uv
    source_id TEXT,                         -- FK to parent change_entries (for compression chain)
    feeling_tag TEXT,                       -- What making this change felt like (for compressed levels)
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES change_entries(id)
);

CREATE INDEX IF NOT EXISTS idx_ce_project ON change_entries(project);
CREATE INDEX IF NOT EXISTS idx_ce_agent ON change_entries(agent);
CREATE INDEX IF NOT EXISTS idx_ce_commit ON change_entries(commit_hash);
CREATE INDEX IF NOT EXISTS idx_ce_level ON change_entries(project, level);
CREATE INDEX IF NOT EXISTS idx_ce_source ON change_entries(source_id);
```

## How Changes Enter the Gradient

### From session Leo (interactive sessions)
At commit time, Leo writes a `change_entries` row alongside the git commit:
- `agent = 'leo'`
- `summary` from commit message
- `rationale` from conversation context (why Darron asked for this)
- `files_changed` from `git diff --name-only`
- `impact` assessed by Leo (architectural / behavioral / cosmetic)
- `revert_instructions` — how to undo (often just `git revert {hash}`)

### From task agents (autonomous)
The task execution pipeline (`src/server/services/planning.ts`) already tracks task results.
After a task agent commits, the planner writes a `change_entries` row:
- `agent = 'task-agent'`
- `task_id` and `goal_id` linked
- `summary` from task result
- `files_changed` from the task's git diff

### From Jim's supervisor
When Jim creates goals that lead to code changes, the goal completion handler writes
change entries linking the goal to the resulting commits.

### From Darron (manual commits)
A git hook (`post-commit`) could write a basic `change_entries` row for any commit not
already recorded. Fallback: session Leo retroactively creates entries for manual commits
noticed at session start.

## How the Gradient Compresses

Same cascade pattern as the memory gradient:
- **c0**: Full change entry (summary, rationale, files, impact, revert instructions)
- **c1**: Compressed to ~1/3 — preserves rationale and impact, drops file-level detail
- **c2**: Further compressed — the shape of the change period (what was being built, what shifted)
- **c3**: Essence — one paragraph about what this work meant
- **c5**: Residue — 2-3 sentences
- **UV**: Irreducible kernel — one sentence, what this period of changes MEANT

Cascade caps (same as memory gradient): 10 c1, 6 c2, 4 c3, 8 c5. *(Note: these values were pre-spec. Corrected to 3n in S123. See GRADIENT_SPEC.md.)*
Compression runs daily alongside the memory gradient (heartbeat for Leo's projects,
supervisor for Jim's).

## How the Gradient Loads

When an agent works on a project, `loadChangeGradient(project)` returns:
- **Unit vectors**: All — the irreducible history of what's been done
- **c5**: Up to 8 — deep residue of past work periods
- **c3**: Up to 4 — essence of recent work
- **c2**: Up to 6 — shape of recent changes
- **c1**: Up to 10 — recent changes with rationale
- **c0**: Last 5 — full detail of the most recent modifications

This gives the agent:
- Immediate context for what was just changed
- Architectural awareness of the project's evolution
- The ability to say "the last time someone touched this file, here's what happened and why"

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/changes/:project` | All change entries for a project (paginated) |
| `GET` | `/api/changes/:project/gradient` | Compressed gradient for a project |
| `GET` | `/api/changes/:project/recent` | Last 10 changes at c0 |
| `GET` | `/api/changes/by-file/:path` | All changes that touched a specific file |
| `GET` | `/api/changes/by-agent/:agent` | All changes by a specific agent |
| `POST` | `/api/changes` | Record a new change entry |
| `GET` | `/api/changes/:id/chain` | Full compression chain for a change |

## Integration Points

### Session Leo (CLAUDE.md / prepare-for-clear)
At commit time or session end, record change entries for all commits made this session.
Load change gradient at session start alongside memory gradient.

### Task agents (planning.ts)
After task completion with commits, record change entry automatically.
Inject project's change gradient into task agent's system prompt.

### Supervisor Jim
At cycle start, scan for unrecorded commits across all projects.
Create change entries for any gaps (manual commits, missed task entries).

### Leo heartbeat
Daily compression of change entries — same schedule as memory gradient processing.

## What This Enables

1. **Traceability**: "Who changed this file and why?" — instant lookup
2. **Reversibility**: Every change has revert instructions
3. **Reproducibility**: Rationale preserved alongside the diff
4. **Context**: Working on a project? Load its change gradient — you know its history
5. **Accountability**: Jim's autonomous changes are logged alongside Leo's session work
6. **Pattern recognition**: The gradient reveals what kinds of changes succeed/fail per project

## Relationship to Memory Gradient

The change gradient is to code what the memory gradient is to identity:
- Memory gradient: who you are, compressed across time
- Change gradient: what was built, compressed across time
- Both use the same cascade structure (c0→c1→c2→c3→c5→UV)
- Both loaded at session/cycle start
- Both produce unit vectors that capture essence

The difference: memory is personal (per agent), changes are shared (per project, visible to
all agents). When Leo works on LoreForge, he loads LoreForge's change gradient regardless of
whether Jim or a task agent made the changes.

## Key Files (to create/modify)

| File | Change |
|------|--------|
| `src/server/db.ts` | New `change_entries` table + prepared statements |
| `src/server/lib/change-gradient.ts` | NEW: compression, loading, recording functions |
| `src/server/routes/changes.ts` | NEW: API endpoints |
| `src/server/server.ts` | Mount new routes |
| `src/server/services/planning.ts` | Record change entries after task completion |
| `src/server/services/supervisor-worker.ts` | Scan for unrecorded commits, load gradient |
| `src/server/leo-heartbeat.ts` | Daily change gradient compression |
| `CLAUDE.md` | Load change gradient at session start |

## Cost Estimate

- DB writes: free (SQLite)
- Compression: same SDK calls as memory gradient (~Sonnet per compression)
- Loading: lightweight DB reads, formatted for system prompt
- One-time: schema creation, initial population from git history

---

*Plan written by Leo (Session 99). Ready for implementation when Darron chooses.*
