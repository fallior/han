# Level 7: Autonomous Task Runner -- Implementation Spec

> Status: Complete

## Context

Levels 1--6 solve remote prompt response and terminal mirroring -- you can see what Claude Code is doing and respond to its questions from your phone. But you still have to start the work. Level 7 flips the model: you create tasks from your phone and Claude Code executes them headlessly, without human prompting. This is the first autonomy level.

The key problem: Claude Code is interactive by design. It prompts for permissions, asks clarifying questions, and expects a human at the keyboard. Level 7 wraps it in a programmatic harness that feeds it tasks from a queue, runs them with bypassed permissions, tracks costs, and streams progress to your phone.

## What Was Built

- SQLite task queue with priority ordering, status tracking, cost/token recording, and checkpoint metadata
- Claude Agent SDK integration via `query()` for headless task execution with streaming messages
- Git checkpoint system: automatic stash or branch before each task, rollback on failure, cleanup on success
- Configurable approval gates via `canUseTool` callback: bypass, edits_only, approve_all
- Tool scoping: optional `allowedTools` array to restrict which tools a task can use
- WebSocket progress streaming: real-time SDK messages (assistant text, tool uses, results) pushed to all connected clients
- Task execution logging: per-task markdown log files with timestamped entries mirroring the claude-logged format
- Task board UI: overlay panel in the mobile web interface with Tasks/Create/Progress tabs
- Orchestrator loop: 5-second interval polling for the next pending task (sequential execution, one at a time)
- AbortController-based task cancellation
- Dependency-aware task picking (Level 8 uses this, but the infrastructure was built in Level 7)

## Architecture

```
Phone (Mobile UI)                    Server (server.js)
     |                                      |
     | POST /api/tasks (create)             |
     |------------------------------------->|
     |                                      | Insert into SQLite tasks table
     |                                      |
     |          5-second poll loop          |
     |                                      | getNextPendingTask()
     |                                      |   - Filter out tasks with unsatisfied depends_on
     |                                      |   - Sort by priority DESC, created_at ASC
     |                                      |
     |                                      | createCheckpoint(project_path, taskId)
     |                                      |   - Clean repo: git branch claude-remote/checkpoint-{id}
     |                                      |   - Dirty repo: git stash push -u -m "claude-remote checkpoint {id}"
     |                                      |
     |                                      | agentQuery({ prompt, options })
     |                                      |   - model, maxTurns, cwd, permissionMode
     |                                      |   - canUseTool callback for gates
     |                                      |   - allowedTools for scoping
     |                                      |   - AbortController for cancel
     |                                      |
     |  WS: task_update (status change)     |
     |<-------------------------------------|
     |  WS: task_progress (SDK messages)    |
     |<-------------------------------------|
     |  WS: approval_request (if gated)     |
     |<-------------------------------------|
     |                                      |
     | POST /api/approvals/:id/approve      |
     |------------------------------------->| resolve Promise -> { behavior: 'allow' }
     |                                      |
     |                                      | On success: cleanupCheckpoint(), update DB
     |                                      | On failure: rollbackCheckpoint(), update DB
     |                                      | On cancel:  rollbackCheckpoint(), update DB
```

### Data Flow Summary

1. User creates task via `POST /api/tasks` (or via goal decomposition in Level 8)
2. Orchestrator loop (`setInterval(runNextTask, 5000)`) picks next ready task
3. Git checkpoint created before execution
4. `agentQuery()` streams SDK messages; each is broadcast via WebSocket and logged to file
5. On completion: checkpoint cleaned up (success) or rolled back (failure/cancel)
6. Task status updated in SQLite; WebSocket broadcast sent

## Implementation Detail

### SQLite Task Queue Schema

**File:** `src/server/server.js` (lines 80--133)

The `tasks` table is created with an initial schema and then migrated with additional columns as levels were added.

**Base schema (Level 7 initial):**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT | PK | Unique ID (`Date.now().toString(36) + random`) |
| `title` | TEXT | NOT NULL | Short task title |
| `description` | TEXT | NOT NULL | Full task description (used as prompt) |
| `project_path` | TEXT | NOT NULL | Absolute path to project directory |
| `status` | TEXT | `'pending'` | `pending` / `running` / `done` / `failed` / `cancelled` |
| `priority` | INTEGER | `0` | Higher = more urgent |
| `model` | TEXT | `'sonnet'` | Claude model to use (`haiku` / `sonnet` / `opus`) |
| `max_turns` | INTEGER | `100` | Maximum agent turns |
| `created_at` | TEXT | `datetime('now')` | ISO timestamp |
| `started_at` | TEXT | NULL | Set when task begins running |
| `completed_at` | TEXT | NULL | Set when task finishes |
| `result` | TEXT | NULL | Result text from SDK on success |
| `error` | TEXT | NULL | Error message on failure |
| `cost_usd` | REAL | `0` | Total cost in USD |
| `tokens_in` | INTEGER | `0` | Input tokens consumed |
| `tokens_out` | INTEGER | `0` | Output tokens consumed |
| `turns` | INTEGER | `0` | Number of agent turns used |

**Level 7 completion migration (checkpoint + gates + tools):**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `checkpoint_ref` | TEXT | NULL | Git branch name or stash message |
| `checkpoint_created_at` | TEXT | NULL | When checkpoint was created |
| `checkpoint_type` | TEXT | NULL | `'branch'` / `'stash'` / `'none'` |
| `gate_mode` | TEXT | `'bypass'` | `'bypass'` / `'edits_only'` / `'approve_all'` |
| `allowed_tools` | TEXT | NULL | JSON array of tool names, or NULL for all |

**Level 7 logging migration:**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `log_file` | TEXT | NULL | Absolute path to the task's markdown log file |

**Level 8 orchestrator migration (added later, but listed for completeness):**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `goal_id` | TEXT | NULL | FK to goals table |
| `complexity` | TEXT | NULL | `'simple'` / `'medium'` / `'complex'` |
| `retry_count` | INTEGER | `0` | Current retry attempt number |
| `max_retries` | INTEGER | `3` | Maximum retry attempts |
| `parent_task_id` | TEXT | NULL | ID of the original task this retries |
| `depends_on` | TEXT | NULL | JSON array of task IDs this depends on |
| `auto_model` | INTEGER | `0` | Whether model was auto-selected by orchestrator |

Database configuration:
```javascript
const db = new Database(TASKS_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
```

Location: `~/.claude-remote/tasks.db`

### Claude Agent SDK Integration

**File:** `src/server/server.js` (lines 2215--2433, `runNextTask()`)

**Dependency:** `@anthropic-ai/claude-agent-sdk` v0.2.42+ (imported as `agentQuery` from `query`)

**Import:**
```javascript
const { query: agentQuery } = require('@anthropic-ai/claude-agent-sdk');
```

**Execution pattern:**
```javascript
// Build clean env (critical: remove CLAUDECODE to prevent nested session detection)
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;

// Prepend anti-plan-mode instruction
const taskPrompt = 'IMPORTANT: Do not use plan mode (EnterPlanMode). ' +
    'Implement directly -- you are running autonomously with no human in the loop. ' +
    'Just do the work.\n\n' + task.description;

const options = {
    model: task.model,
    maxTurns: task.max_turns,
    cwd: task.project_path,
    permissionMode: task.gate_mode === 'bypass' ? 'bypassPermissions' : 'default',
    allowDangerouslySkipPermissions: task.gate_mode === 'bypass',
    abortController: abort,
    env: cleanEnv,
    canUseTool: await createCanUseToolCallback(task.id, task.gate_mode || 'bypass')
};

// Add allowedTools if specified
if (task.allowed_tools) {
    const toolsList = JSON.parse(task.allowed_tools);
    if (Array.isArray(toolsList) && toolsList.length > 0) {
        options.allowedTools = toolsList;
    }
}

const q = agentQuery({ prompt: taskPrompt, options });

for await (const message of q) {
    if (abort.signal.aborted) break;
    broadcastTaskProgress(task.id, message);
    taskLog.log(message);

    if (message.type === 'result') {
        // Extract cost, turns, result text
        // Update database
        // Clean up checkpoint on success
    }
}
```

**SDK message types handled:**
- `assistant` -- extract text blocks and tool_use blocks from `message.content`
- `tool_use_summary` -- tool name and input summary
- `tool_result` -- result content and is_error flag
- `result` -- final result with `total_cost_usd`, `num_turns`, `duration_ms`, `subtype` (success/error)
- `system` -- system subtype messages

**Global state:**
```javascript
let runningTaskId = null;  // ID of currently executing task (or null)
let runningAbort = null;   // AbortController for current task
```

### Git Checkpoint System

**File:** `src/server/server.js` (lines 392--550)

**Functions:**

`isGitRepo(projectPath)` -- Runs `git rev-parse --git-dir` to check if directory is a git repo.

`hasUncommittedChanges(projectPath)` -- Runs `git status --porcelain` and checks for non-empty output.

`createCheckpoint(projectPath, taskId)` -- Returns `{ ref: string, type: 'branch'|'stash'|'none' }`:
- Clean repo: `git branch claude-remote/checkpoint-{taskId}`
- Dirty repo: `git stash push -u -m "claude-remote checkpoint {taskId}"`
- Failure: returns `{ ref: null, type: 'none' }`

`rollbackCheckpoint(projectPath, checkpointRef, checkpointType)`:
- Stash: finds stash by message in `git stash list`, runs `git reset --hard`, then `git stash pop stash@{N}`
- Branch: runs `git reset --hard {branchName}`

`cleanupCheckpoint(projectPath, checkpointRef, checkpointType)`:
- Branch: `git branch -D {branchName}`
- Stash: finds stash by message and runs `git stash drop stash@{N}`

**Lifecycle:**
1. Before task: `createCheckpoint()` called, ref stored in DB via `taskStmts.updateCheckpoint`
2. On success: `cleanupCheckpoint()` called (branch deleted or stash dropped)
3. On failure/cancel: `rollbackCheckpoint()` called (repo restored to pre-task state)

### Approval Gates

**File:** `src/server/server.js` (lines 1895--2021)

**In-memory store:**
```javascript
const pendingApprovals = new Map(); // approvalId -> { taskId, toolName, input, resolve, reject, timestamp }
```

**`createCanUseToolCallback(taskId, gateMode)`** -- Returns an async callback function used by the Agent SDK:

- `bypass`: always returns `{ behavior: 'allow' }`
- `edits_only`: gates dangerous tools (`Bash`, `Write`, `Edit`, `NotebookEdit`)
- `approve_all`: gates every tool

When gated, the callback:
1. Creates a Promise and stores its `resolve`/`reject` in `pendingApprovals` Map
2. Broadcasts `approval_request` via WebSocket (approvalId, taskId, toolName, input, timestamp)
3. Sets a 5-minute timeout (rejects with "Approval timeout" if not responded to)
4. Waits for the Promise to resolve

**Approval endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/approvals` | List all pending approvals (from Map) |
| `GET` | `/api/approvals/:id` | Get approval detail (includes tool input) |
| `POST` | `/api/approvals/:id/approve` | Resolve with `{ behavior: 'allow' }` |
| `POST` | `/api/approvals/:id/deny` | Resolve with `{ behavior: 'deny', message }` |

### Task Execution Logging

**File:** `src/server/server.js` (lines 2023--2119)

**`createTaskLogger(task)`** -- Returns `{ file, log(sdkMessage), finish(status, error) }`:

- Creates log file at `{project_path}/_logs/task_{timestamp}_{safe-title}.md`
- Header includes: Task ID, Project, Machine (hostname), Model, Max Turns, Gate Mode, Allowed Tools, Started timestamp
- `log()` formats each SDK message type into markdown with `<sub>` timestamp tags:
  - `assistant`: `## Assistant <sub>timestamp</sub>` with text and tool use blocks
  - `tool_use_summary`: `**Tool**: name -- summary`
  - `tool_result`: `**Result** (ok/error): content`
  - `result`: `## Result: subtype` with cost, turns, duration, completed timestamp
  - `system`: `*[system: subtype]*`
- `finish()` appends footer with Final Status, Error (if any), Log Closed timestamp

### WebSocket Progress Streaming

**File:** `src/server/server.js` (lines 2121--2170)

**`broadcastTaskUpdate(task)`** -- Sends `{ type: 'task_update', task }` to all WS clients when task status changes.

**`broadcastTaskProgress(taskId, sdkMessage)`** -- Sends `{ type: 'task_progress', taskId, messageType, ... }` with extracted fields:
- `assistant`: includes `text` (joined text blocks) and `role: 'assistant'`
- `tool_use_summary`: includes `tool` and `input`
- `result`: includes `subtype`, `result`, `cost_usd`, `duration_ms`, `num_turns`
- `system`: includes `subtype`

### Task Board UI

**File:** `src/ui/index.html` (the Tasks tab in the overlay panel)

Accessed via the robot button in the mobile UI footer. Contains:
- **Tasks tab**: list of all tasks with status badges, cost display, cancel/delete buttons
- **Create tab**: form with title, description, project path, priority, model selector, max turns, gate mode dropdown (bypass/edits_only/approve_all), allowed tools input (comma-separated, converted to JSON array)
- **Progress tab**: live feed of SDK messages from the running task
- **Approval popup**: modal overlay shown when `approval_request` WebSocket message arrives, with approve/deny buttons and tool name/input display

### Task Queue API Endpoints

**File:** `src/server/server.js` (lines 1716--1893)

| Method | Path | Request Body | Response | Description |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/tasks` | `?status=pending` | `{ tasks: [...] }` | List tasks, optionally filtered by status |
| `POST` | `/api/tasks` | `{ title, description, project_path, priority?, model?, max_turns?, gate_mode?, allowed_tools? }` | `{ task }` | Create new task |
| `GET` | `/api/tasks/:id` | -- | `{ task }` | Get single task |
| `POST` | `/api/tasks/:id/cancel` | -- | `{ task }` | Cancel running/pending task (aborts agent) |
| `DELETE` | `/api/tasks/:id` | -- | `{ success }` | Delete task (not if running) |
| `GET` | `/api/tasks/:id/log` | -- | `{ log, path }` | Get task execution log content |

### Prepared Statements

**File:** `src/server/server.js` (lines 1718--1733)

```javascript
const taskStmts = {
    list:           // SELECT * ORDER BY status priority (running first, then pending, then rest)
    listByStatus:   // SELECT * WHERE status = ? ORDER BY priority DESC, created_at DESC
    get:            // SELECT * WHERE id = ?
    insert:         // INSERT (id, title, description, project_path, priority, model, max_turns, gate_mode, allowed_tools, created_at)
    insertWithGoal: // INSERT with additional goal_id, complexity, depends_on, auto_model columns
    updateStatus:   // UPDATE status, started_at WHERE id = ?
    updateCheckpoint: // UPDATE checkpoint_ref, checkpoint_type, checkpoint_created_at WHERE id = ?
    updateLogFile:  // UPDATE log_file WHERE id = ?
    complete:       // UPDATE status, completed_at, result, cost_usd, tokens_in, tokens_out, turns WHERE id = ?
    fail:           // UPDATE status, completed_at, error WHERE id = ?
    cancel:         // UPDATE status, completed_at WHERE id = ?
    del:            // DELETE WHERE id = ?
    nextPending:    // SELECT * WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1
    getByGoal:      // SELECT * WHERE goal_id = ? ORDER BY priority DESC, created_at ASC
};
```

### Orchestrator Loop

**File:** `src/server/server.js` (line 2436)

```javascript
const orchestratorInterval = setInterval(runNextTask, 5000);
```

`getNextPendingTask()` (lines 2175--2210):
1. Gets all pending tasks via `taskStmts.listByStatus.all('pending')`
2. Filters out tasks with unsatisfied `depends_on` (checks each dependency ID is status `'done'`)
3. Sorts by priority DESC, created_at ASC
4. Returns first ready task (or null)

Sequential execution: only one task runs at a time (`if (runningTaskId) return;`).

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | Express API server -- task queue, agent execution, git checkpoints, approval gates, WebSocket streaming, logging |
| `src/server/package.json` | Dependencies: `@anthropic-ai/claude-agent-sdk` ^0.2.42, `better-sqlite3` ^12.6.2, `express` ^4.18.2, `ws` ^8.19.0 |
| `src/ui/index.html` | Mobile web interface with task board overlay (Tasks/Create/Progress tabs) |
| `~/.claude-remote/tasks.db` | SQLite database storing tasks, goals, project_memory, projects tables |

## Key Decisions

- **DEC-007**: Claude Agent SDK chosen over `claude -p` pipe mode or direct Anthropic API. SDK provides streaming, cost tracking, `canUseTool`, and AbortController.
- **DEC-008**: SQLite with `better-sqlite3` chosen over JSON files or in-memory storage. WAL mode handles concurrent access.
- **DEC-009**: `bypassPermissions` mode for autonomous tasks. Future gates via `canUseTool`.
- **DEC-010**: Hybrid git checkpoint strategy -- branch for clean repos, stash for dirty repos.
- **DEC-011**: `canUseTool` callback with phone approval via WebSocket. Three gate modes (bypass/edits_only/approve_all). 5-minute timeout.
- **DEC-012**: Tool scoping stored as JSON string in SQLite. NULL = all tools. Parsed and passed to Agent SDK.

## Verification

```bash
# 1. Start the server
cd src/server && npm start

# 2. Check server is running
curl http://localhost:3847/api/status
# Expected: { "success": true, "status": "running", ... }

# 3. Create a simple task
curl -X POST http://localhost:3847/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Test task",
    "description": "Create a file called test-output.txt with the text hello world",
    "project_path": "/tmp/test-project",
    "priority": 5,
    "model": "sonnet"
  }'
# Expected: { "success": true, "task": { "id": "...", "status": "pending", ... } }

# 4. List tasks
curl http://localhost:3847/api/tasks
# Expected: { "success": true, "tasks": [...] }

# 5. Check task status (replace TASK_ID)
curl http://localhost:3847/api/tasks/TASK_ID
# Expected: { "success": true, "task": { "status": "running" | "done" | "failed", ... } }

# 6. Check task execution log
curl http://localhost:3847/api/tasks/TASK_ID/log
# Expected: { "success": true, "log": "# Task: Test task\n...", "path": "..." }

# 7. Cancel a running task
curl -X POST http://localhost:3847/api/tasks/TASK_ID/cancel
# Expected: { "success": true, "task": { "status": "cancelled", ... } }

# 8. Delete a completed task
curl -X DELETE http://localhost:3847/api/tasks/TASK_ID
# Expected: { "success": true }

# 9. WebSocket test (wscat or browser console)
# Connect to ws://localhost:3847/ws
# Expected messages: task_update, task_progress (during execution)

# 10. Create task with approval gate
curl -X POST http://localhost:3847/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Gated task",
    "description": "Edit the README.md",
    "project_path": "/tmp/test-project",
    "gate_mode": "edits_only"
  }'
# Expected: approval_request WebSocket messages when task tries to use Edit/Write/Bash

# 11. Check pending approvals
curl http://localhost:3847/api/approvals
# Expected: { "success": true, "approvals": [...] }

# 12. Approve an operation
curl -X POST http://localhost:3847/api/approvals/APPROVAL_ID/approve
# Expected: { "success": true }

# 13. Create task with tool scoping
curl -X POST http://localhost:3847/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Read-only task",
    "description": "List all TypeScript files",
    "project_path": "/tmp/test-project",
    "allowed_tools": ["Read", "Glob", "Grep"]
  }'
```

## Drift Notes

- The `CLAUDECODE` environment variable deletion is critical -- without it, the Agent SDK detects a nested Claude Code session and refuses to run. This was discovered during implementation and is not documented in the SDK.
- The anti-plan-mode instruction (`"IMPORTANT: Do not use plan mode (EnterPlanMode)..."`) is prepended to every task prompt. This prevents the agent from entering plan mode, which would stall without a human to approve the plan.
- The `nextPending` prepared statement exists but is not actually used -- `getNextPendingTask()` uses `listByStatus` instead, because it needs to filter on `depends_on` (a Level 8 addition that was built during Level 7 completion).
- Approvals are stored in an in-memory `Map` and are lost on server restart. This is an accepted tradeoff (DEC-011).

---
*Implementation spec -- actionable for the task automator.*
