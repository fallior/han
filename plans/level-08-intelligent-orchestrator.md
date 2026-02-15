# Level 8: Intelligent Orchestrator -- Implementation Spec

> Status: Complete

## Context

Level 7 gives you a task queue -- you create individual tasks, and Claude Code executes them. But you still have to decompose work into tasks yourself. Level 8 adds an intelligence layer: you describe a high-level goal ("Add search functionality to the API") and the orchestrator breaks it into ordered subtasks, classifies their complexity, routes them to appropriate models, retries on failure with adjusted strategies, and learns from outcomes via project memory.

The orchestrator uses a dual-backend design: Ollama (local model) preferred, Claude Haiku API as fallback. The local model handles routing and classification at zero marginal cost. The Anthropic API is only used when Ollama is unavailable.

## What Was Built

- Orchestrator module (`orchestrator.js`) with dual-backend LLM calls (Ollama local / Claude Haiku fallback)
- Ollama auto-detection at startup via `/api/tags` endpoint
- Task complexity classifier: simple/medium/complex mapped to haiku/sonnet/opus
- Goal decomposition: high-level goal + project context decomposed into ordered subtasks with dependencies
- Failure analysis with retry logic: up to 3 retries with adjusted descriptions and model escalation
- Project memory system: `project_memory` table tracking outcomes by model, success rates, costs
- Model selection informed by project history (escalates model if failure rate > 50%)
- Goals table and API endpoints (create, list, detail, retry, delete)
- Dependency-aware task picking (tasks with unsatisfied `depends_on` are skipped)
- Goal progress tracking: tasks_completed, tasks_failed, total_cost_usd, auto-status transitions
- Goals tab in mobile UI (create goals, view decomposition, retry failed goals)
- Orchestrator status endpoint and status badge in UI
- Project context reader (reads CLAUDE.md, CURRENT_STATUS.md, README.md from target project)

## Architecture

```
Phone (Mobile UI)                    Server (server.js)              Orchestrator (orchestrator.js)
     |                                      |                                |
     | POST /api/goals                      |                                |
     | { description, project_path }        |                                |
     |------------------------------------->|                                |
     |                                      | Create goal record (status: 'decomposing')
     |                                      |                                |
     |                                      | readProjectContext(project_path)
     |                                      |   - Reads CLAUDE.md, CURRENT_STATUS.md, README.md
     |                                      |   - Truncates each to 5000 chars
     |                                      |                                |
     |                                      | orchestrator.decomposeGoal()   |
     |                                      |------------------------------->|
     |                                      |                                | Try Ollama first
     |                                      |                                |   POST /api/generate
     |                                      |                                |   format: 'json'
     |                                      |                                |
     |                                      |                                | Fallback: Claude Haiku
     |                                      |                                |   POST /v1/messages
     |                                      |                                |   claude-haiku-4-5-20251001
     |                                      |                                |
     |                                      | <-- { subtasks: [...] }        |
     |                                      |                                |
     |                                      | For each subtask:
     |                                      |   - Create task in DB with goal_id
     |                                      |   - Resolve depends_on titles to task IDs
     |                                      |   - broadcastTaskUpdate()
     |                                      |
     |                                      | Update goal: decomposition JSON, task_count, status
     |                                      |
     |  WS: goal_decomposed                |
     |<-------------------------------------|
     |                                      |
     |                                      | Orchestrator loop picks tasks
     |                                      |   getNextPendingTask() filters on depends_on
     |                                      |   Executes via agentQuery() (Level 7 infrastructure)
     |                                      |
     |                                      | On task failure + goal_id + retries < max:
     |                                      |   orchestrator.analyseFailure()
     |                                      |   If shouldRetry: create retry task with
     |                                      |     adjusted description/model, retry_count + 1
     |                                      |
     |                                      | On all tasks done:
     |                                      |   updateGoalProgress() -> goal status 'done' or 'failed'
     |                                      |   recordTaskOutcome() -> project_memory table
     |                                      |
     |  WS: goal_update                    |
     |<-------------------------------------|
```

### Dual-Backend Pattern

```
callLLM(systemPrompt, userPrompt)
        |
        v
  Ollama available?
   /          \
  YES          NO
   |            |
   v            v
POST           POST
/api/generate  /v1/messages
Ollama         Anthropic API
(local)        (claude-haiku-4-5-20251001)
   |            |
   v            v
{ response, backend: 'ollama', model }
{ response, backend: 'anthropic', model }
```

Both backends return structured JSON. Ollama uses `format: 'json'` parameter. Anthropic Haiku returns text that may be wrapped in markdown code fences -- the module extracts JSON from ````json ... ``` `` blocks if present.

## Implementation Detail

### Orchestrator Module

**File:** `src/server/orchestrator.js` (299 lines)

**Configuration:**
```javascript
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';
let ollamaAvailable = false;
```

**Exported functions:**

#### `initialize()` -> `Promise<Status>`

Called at server startup. Checks Ollama availability via `checkOllamaStatus()`. Logs which backend will be used.

```javascript
orchestrator.initialize().then(status => {
    console.log('[Orchestrator] Initialized:', status);
});
```

#### `checkOllamaStatus()` -> `Promise<boolean>`

Fetches `{OLLAMA_URL}/api/tags` with a 2-second timeout. Parses the response to check if the configured model name (prefix match on `OLLAMA_MODEL.split(':')[0]`) is available in the model list. Returns `true` if model found, `false` otherwise.

#### `callLLM(systemPrompt, userPrompt, options)` -> `Promise<{ response, backend, model }>`

Core LLM call function. Tries Ollama first, falls back to Claude Haiku.

**Ollama path:**
```javascript
fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: systemPrompt,
        prompt: userPrompt,
        stream: false,
        format: 'json'
    }),
    signal: AbortSignal.timeout(timeout)
});
```

**Anthropic path:**
```javascript
fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
    }),
    signal: AbortSignal.timeout(timeout)
});
```

Anthropic response parsing includes JSON extraction from markdown code blocks:
```javascript
const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/);
if (jsonMatch) jsonText = jsonMatch[1];
```

Throws if neither backend is available (`'No ANTHROPIC_API_KEY available and Ollama is not working'`).

#### `classifyTask(description, projectPath)` -> `Promise<Classification>`

**Timeout:** 15 seconds

**System prompt instructs the model to classify as:**
- `simple` (single-file change, docs, config) -> suggest `haiku`
- `medium` (multi-file feature, refactor) -> suggest `sonnet`
- `complex` (architecture design, multi-system) -> suggest `opus`

**Returns:**
```javascript
{
    complexity: 'simple' | 'medium' | 'complex',
    suggestedModel: 'haiku' | 'sonnet' | 'opus',
    estimatedTurns: number,
    reasoning: 'brief explanation',
    backend: 'ollama' | 'anthropic' | 'fallback',
    model: string
}
```

**Fallback on error:** `{ complexity: 'medium', suggestedModel: 'sonnet', estimatedTurns: 50 }`

#### `decomposeGoal(goal, projectContext)` -> `Promise<Decomposition>`

**Timeout:** 120 seconds (2 minutes -- decomposition can take time with large context)

**System prompt instructs the model to produce:**
```json
{
    "subtasks": [
        {
            "title": "Brief title (50 chars max)",
            "description": "Detailed task description",
            "priority": 5,
            "model": "haiku|sonnet|opus",
            "dependsOn": ["title of dependency task"]
        }
    ]
}
```

**Returns:**
```javascript
{
    subtasks: [...],
    backend: 'ollama' | 'anthropic',
    model: string
}
```

**Throws on failure** (does not provide a fallback -- goal creation fails).

#### `analyseFailure(task, error, attemptNumber)` -> `Promise<Recovery>`

**Timeout:** 15 seconds

**System prompt rules:**
- Retry simple failures (missing dependencies, transient errors)
- Don't retry fundamental issues (invalid syntax, wrong approach)
- Can escalate model: haiku -> sonnet -> opus
- Can adjust task description

**Returns:**
```javascript
{
    shouldRetry: boolean,
    adjustedDescription: string | null,  // null = keep original
    adjustedModel: string | null,        // null = keep original
    reasoning: 'brief explanation',
    backend: string,
    model: string
}
```

**Fallback on error:** `{ shouldRetry: false }` (safe default -- don't retry if analysis fails)

#### `selectModel(complexity, projectHistory)` -> `string`

Synchronous function. Maps complexity to model:
- `simple` -> `'haiku'`
- `medium` -> `'sonnet'`
- `complex` -> `'opus'`

Checks `projectHistory[model].failureRate` -- if > 0.5, escalates:
- `haiku` -> `sonnet`
- `sonnet` -> `opus`
- `opus` -> `opus` (no further escalation)

#### `getStatus()` -> `Status`

Returns current orchestrator state:
```javascript
{
    ollamaAvailable: boolean,
    ollamaUrl: string,
    ollamaModel: string,
    backend: 'ollama' | 'anthropic',
    hasApiKey: boolean
}
```

### Goals Table Schema

**File:** `src/server/server.js` (lines 136--151)

```sql
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    project_path TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    decomposition TEXT,
    task_count INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    orchestrator_backend TEXT,
    orchestrator_model TEXT
)
```

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT | PK | Unique ID (same format as tasks) |
| `description` | TEXT | NOT NULL | The high-level goal text |
| `project_path` | TEXT | NOT NULL | Target project directory |
| `status` | TEXT | `'pending'` | `pending` / `decomposing` / `active` / `done` / `failed` |
| `created_at` | TEXT | `datetime('now')` | ISO timestamp |
| `completed_at` | TEXT | NULL | Set when all tasks finish |
| `decomposition` | TEXT | NULL | Full JSON decomposition result from orchestrator |
| `task_count` | INTEGER | `0` | Total number of subtasks created |
| `tasks_completed` | INTEGER | `0` | Number of subtasks with status `done` |
| `tasks_failed` | INTEGER | `0` | Number of subtasks with status `failed` |
| `total_cost_usd` | REAL | `0` | Sum of all subtask costs |
| `orchestrator_backend` | TEXT | NULL | `'ollama'` or `'anthropic'` -- which backend decomposed this goal |
| `orchestrator_model` | TEXT | NULL | Model name used for decomposition |

**Status transitions:**
```
pending -> decomposing -> active -> done
                |           |
                v           v
              failed      failed
```

- `pending`: goal created but not yet decomposing
- `decomposing`: orchestrator is breaking down the goal into subtasks
- `active`: subtasks created and being executed
- `done`: all subtasks completed successfully (or cancelled)
- `failed`: decomposition failed, or any subtask failed

### Project Memory Table Schema

**File:** `src/server/server.js` (lines 163--174)

```sql
CREATE TABLE IF NOT EXISTS project_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT NOT NULL,
    task_type TEXT,
    model_used TEXT,
    success INTEGER,
    cost_usd REAL,
    turns INTEGER,
    duration_seconds REAL,
    error_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing PK |
| `project_path` | TEXT | Project this outcome belongs to |
| `task_type` | TEXT | Complexity classification (`simple`/`medium`/`complex`/`unknown`) |
| `model_used` | TEXT | Model that executed the task (`haiku`/`sonnet`/`opus`) |
| `success` | INTEGER | 1 for success, 0 for failure |
| `cost_usd` | REAL | Cost of this task execution |
| `turns` | INTEGER | Number of agent turns used |
| `duration_seconds` | REAL | Wall-clock execution time |
| `error_summary` | TEXT | Error message if failed, NULL if successful |
| `created_at` | TEXT | ISO timestamp |

**Purpose:** Feeds back into `selectModel()` to inform model routing. If a particular model has > 50% failure rate on a project, the orchestrator escalates to a more capable model.

### Goal API Endpoints

**File:** `src/server/server.js` (lines 1253--1476)

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| `POST` | `/api/goals` | `{ description, project_path, auto_execute? }` | `{ goal, message }` | Create goal and start async decomposition |
| `GET` | `/api/goals` | -- | `{ goals: [...] }` | List all goals (newest first) |
| `GET` | `/api/goals/:id` | -- | `{ goal, tasks: [...] }` | Get goal detail with associated tasks |
| `POST` | `/api/goals/:id/retry` | -- | `{ retriedTasks }` | Reset failed tasks to pending, reactivate goal |
| `DELETE` | `/api/goals/:id` | -- | `{ success }` | Delete goal and its tasks (not if active/decomposing) |

**`POST /api/goals` detail:**

1. Validates `description` and `project_path` (path must exist on disk)
2. Creates goal record with `status: 'decomposing'`
3. Records orchestrator backend info (`orchestrator_backend`, `orchestrator_model`)
4. Broadcasts `goal_update` via WebSocket
5. Starts async decomposition (non-blocking -- returns 200 immediately):
   a. Reads project context files (CLAUDE.md, CURRENT_STATUS.md, README.md, max 5000 chars each)
   b. Calls `orchestrator.decomposeGoal(description, projectContext)`
   c. Creates task records for each subtask with `goal_id` set
   d. Resolves `dependsOn` titles to task IDs using a `titleToId` map
   e. Stores `depends_on` as JSON array of task IDs
   f. Updates goal: `decomposition` JSON, `task_count`, status `'active'` (or `'pending'` if `auto_execute: false`)
   g. Broadcasts `goal_decomposed` with goal and tasks
6. On decomposition failure: sets goal status to `'failed'`

**`POST /api/goals/:id/retry` detail:**

1. Validates goal exists and is in `'failed'` status
2. Finds all tasks with `goal_id` matching and `status: 'failed'`
3. Resets each failed task to `status: 'pending'`
4. Sets goal status to `'active'`
5. Broadcasts updates -- orchestrator loop will pick up the reset tasks

### Orchestrator Status Endpoint

**File:** `src/server/server.js` (lines 1536--1543)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/orchestrator/status` | `{ ollamaAvailable, ollamaUrl, ollamaModel, backend, hasApiKey }` |

### Project Memory Endpoint

**File:** `src/server/server.js` (lines 1548--1585)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/orchestrator/memory/:project` | `{ projectPath, recordCount, byModel: { model: { total, successes, failures, failureRate, successRate, totalCost } }, recentRecords }` |

The `:project` parameter is URL-encoded project path. Response includes per-model success/failure statistics and the 20 most recent outcome records.

### Retry Logic

**File:** `src/server/server.js` (lines 2367--2412, inside `runNextTask()` catch block)

When a task fails:
1. Check `retry_count < max_retries` (default max: 3) AND `task.goal_id` exists
2. Call `orchestrator.analyseFailure(task, error, retryCount + 1)`
3. If `shouldRetry`:
   a. Create new task with `retry_count + 1`, `parent_task_id` set to original task ID
   b. Use `adjustedDescription` if provided (otherwise keep original)
   c. Use `adjustedModel` if provided (model escalation)
   d. Bump priority by 1 (retry tasks get slightly higher priority)
   e. Preserve `goal_id`, `depends_on`, `gate_mode`, `allowed_tools`
4. Broadcast new retry task via WebSocket

### Goal Progress Tracking

**File:** `src/server/server.js` (lines 1618--1692)

**`updateGoalProgress(goalId)`:**

1. Gets all tasks for the goal via `taskStmts.getByGoal`
2. Counts: completed (`done`), failed, total cost
3. Checks `allDone` (every task is `done`, `cancelled`, or `failed`)
4. Sets goal status: `done` (all done, none failed), `failed` (all done, some failed), `active` (still running)
5. Records task outcomes in project_memory via `recordTaskOutcome()`
6. Broadcasts `goal_update` via WebSocket

**`recordTaskOutcome(task)`:**

Inserts into `project_memory` table with: project_path, task_type (complexity), model_used, success (0/1), cost_usd, turns, duration_seconds, error_summary.

### Prepared Statements

**File:** `src/server/server.js` (lines 1735--1755)

```javascript
const goalStmts = {
    list:                // SELECT * ORDER BY created_at DESC
    get:                 // SELECT * WHERE id = ?
    insert:              // INSERT (id, description, project_path, status, created_at, orchestrator_backend, orchestrator_model)
    updateStatus:        // UPDATE status WHERE id = ?
    updateProgress:      // UPDATE tasks_completed, tasks_failed, total_cost_usd, status, completed_at WHERE id = ?
    updateDecomposition: // UPDATE decomposition, task_count, status WHERE id = ?
    del:                 // DELETE WHERE id = ?
};

const memoryStmts = {
    insert:       // INSERT INTO project_memory (project_path, task_type, model_used, success, cost_usd, turns, duration_seconds, error_summary, created_at)
    getByProject: // SELECT * WHERE project_path = ? ORDER BY created_at DESC LIMIT 100
};
```

### WebSocket Messages (Level 8 additions)

| Message Type | Payload | When |
|-------------|---------|------|
| `goal_update` | `{ goal, tasks }` | Goal status changes (created, decomposed, active, done, failed) |
| `goal_decomposed` | `{ goal, tasks }` | Decomposition completes with full subtask list |

### Goals Tab in Mobile UI

**File:** `src/ui/index.html`

The Goals tab is a section within the task board overlay. It provides:
- **Goal creation form**: description textarea, project path input, submit button
- **Goal list**: cards showing goal description, status badge, task progress (N/M completed), cost, orchestrator backend badge
- **Goal detail**: expands to show subtasks with their statuses
- **Retry button**: appears on failed goals, calls `POST /api/goals/:id/retry`
- **Orchestrator status badge**: shows "Ollama" (green) or "Anthropic" (blue) based on `/api/orchestrator/status`

### Orchestrator Initialisation

**File:** `src/server/server.js` (lines 2533--2538)

```javascript
orchestrator.initialize().then(status => {
    console.log('[Orchestrator] Initialized:', status);
}).catch(err => {
    console.error('[Orchestrator] Initialization failed:', err);
});
```

Called once at server startup, before the server begins listening. Sets `ollamaAvailable` flag that determines which backend `callLLM` uses.

## Key Files

| File | Role |
|------|------|
| `src/server/orchestrator.js` | Dual-backend LLM module -- Ollama/Haiku, classify, decompose, analyse failure, model selection |
| `src/server/server.js` | Goal endpoints, goal progress tracking, project memory recording, retry logic, WebSocket broadcasting |
| `src/ui/index.html` | Goals tab UI -- create goals, view decomposition, retry failed, orchestrator status badge |
| `~/.claude-remote/tasks.db` | SQLite database -- `goals` and `project_memory` tables added in Level 8 |

## Key Decisions

- **Dual-backend (Ollama + Haiku)**: Local model preferred for zero-cost orchestration; Haiku as reliable fallback. No decision record -- this was part of the ROADMAP's hybrid approach (Option C).
- **`qwen2.5-coder:7b` as default Ollama model**: Small enough to run on CPU (4.7GB), good enough for task classification and decomposition. Tested end-to-end with goal decomposition.
- **Claude Haiku 4.5 for API fallback**: Cheapest Anthropic model, sufficient for classification and decomposition tasks.
- **2-minute timeout for decomposition**: Goal decomposition requires the model to read project context and produce multiple structured subtasks -- 15 seconds is too short, 2 minutes is adequate even for slow local models.
- **JSON output format**: Ollama uses `format: 'json'` parameter; Anthropic Haiku instructed to return JSON, with fallback regex extraction from markdown code fences.
- **Dependency resolution via title mapping**: During decomposition, subtasks reference dependencies by title. The server resolves these to task IDs using a `titleToId` map built during task creation. This means dependency titles must exactly match other subtask titles in the same decomposition.
- **3 max retries**: Configurable per-task via `max_retries` column. Default 3. Retry tasks get bumped priority and may have adjusted description/model.
- **Project memory limited to 100 records**: `getByProject` query returns last 100 records. Sufficient for model routing decisions without unbounded growth.

## Verification

```bash
# 1. Check orchestrator status
curl http://localhost:3847/api/orchestrator/status
# Expected (no Ollama): { "success": true, "ollamaAvailable": false, "backend": "anthropic", "hasApiKey": true }
# Expected (with Ollama): { "success": true, "ollamaAvailable": true, "backend": "ollama", "ollamaModel": "qwen2.5-coder:7b" }

# 2. Create a goal (requires ANTHROPIC_API_KEY or Ollama running)
curl -X POST http://localhost:3847/api/goals \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "Add a health check endpoint that returns server uptime and memory usage",
    "project_path": "/tmp/test-project"
  }'
# Expected: { "success": true, "goal": { "id": "...", "status": "decomposing" }, "message": "Goal created, decomposition in progress" }

# 3. Wait a few seconds, then check goal status
curl http://localhost:3847/api/goals
# Expected: { "success": true, "goals": [{ "status": "active", "task_count": 3, ... }] }

# 4. Get goal detail with tasks
curl http://localhost:3847/api/goals/GOAL_ID
# Expected: { "goal": { ... }, "tasks": [{ "title": "...", "depends_on": "[...]", ... }] }

# 5. Watch tasks execute via WebSocket
# Connect to ws://localhost:3847/ws
# Expected messages: goal_update, goal_decomposed, task_update, task_progress

# 6. Check project memory after tasks complete
curl http://localhost:3847/api/orchestrator/memory/$(python3 -c "import urllib.parse; print(urllib.parse.quote('/tmp/test-project'))")
# Expected: { "recordCount": 3, "byModel": { "sonnet": { "total": 2, "successes": 2, ... } } }

# 7. Test goal retry (if a goal failed)
curl -X POST http://localhost:3847/api/goals/GOAL_ID/retry
# Expected: { "success": true, "retriedTasks": 1 }

# 8. Delete a completed/failed goal
curl -X DELETE http://localhost:3847/api/goals/GOAL_ID
# Expected: { "success": true }

# 9. Test with Ollama running
ollama pull qwen2.5-coder:7b
ollama serve  # in another terminal
# Restart server -- should see:
# [Orchestrator] Using Ollama (qwen2.5-coder:7b) at http://localhost:11434

# 10. Test task classification (indirect -- via goal decomposition)
# The orchestrator classifies each subtask during decomposition
# Check the tasks created: each should have a model assigned based on complexity

# 11. Test orchestrator setup endpoint (placeholder)
curl -X POST http://localhost:3847/api/orchestrator/setup \
  -H 'Content-Type: application/json' \
  -d '{ "model": "qwen2.5-coder:7b" }'
# Expected: { "success": true, "message": "Starting pull of qwen2.5-coder:7b", "note": "This endpoint is a placeholder..." }
```

## Drift Notes

- The `classifyTask()` function exists in the orchestrator module but is not currently called during goal decomposition. The decomposition prompt instructs the model to suggest a model per subtask directly. Classification could be used as a second pass for validation, but this was not implemented.
- The `selectModel()` function checks `projectHistory` for failure rates, but the caller must query project_memory and build the history object manually. The memory endpoint (`/api/orchestrator/memory/:project`) calculates `byModel` stats, but this is not yet wired into the task execution loop for automatic model selection.
- The `auto_model` column on tasks (set to 1 for goal-decomposed tasks) is stored but not used for any conditional logic yet. It was added to distinguish manually-created tasks from orchestrator-generated ones.
- The `POST /api/orchestrator/setup` endpoint is a placeholder -- it returns a message suggesting to use `ollama pull` directly. A future improvement would add actual model pull progress streaming.
- The `readProjectContext()` function reads from the project root. It does not check subdirectories like `claude-context/` where CURRENT_STATUS.md actually lives in this project. Projects that follow a different structure may get minimal context.
- The `projects` table (for Level 9 portfolio management) and `portfolioStmts` were built during the Level 8 session but are architecturally part of Level 9. They are documented here as schema context but belong to the next level's spec.

---
*Implementation spec -- actionable for the task automator.*
