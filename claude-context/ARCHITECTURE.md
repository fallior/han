# Claude Remote — Architecture

> System design and technical reference

## Overview

Claude Remote bridges your development machine and mobile device, enabling remote responses to Claude Code prompts and autonomous task execution. It hooks into Claude Code's notification system, saves state to disk, sends push notifications, provides a web UI for responding, and can run tasks headlessly via the Claude Agent SDK.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLAUDE REMOTE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐    hooks     ┌──────────────┐                           │
│   │  Claude Code │─────────────▶│  notify.sh   │                           │
│   └──────────────┘              └──────┬───────┘                           │
│         ▲                              │                                    │
│         │                              ▼                                    │
│         │ tmux send-keys       ┌──────────────┐     push      ┌─────────┐ │
│         │                      │  State Files │───────────────▶│ ntfy.sh │ │
│         │                      │  (.pending)  │               └────┬────┘ │
│         │                      └──────┬───────┘                    │      │
│         │                              │                           │      │
│         │                              ▼                           ▼      │
│   ┌─────┴────────┐             ┌──────────────┐            ┌──────────┐  │
│   │    tmux      │◀────────────│ Express API  │◀───────────│  Phone   │  │
│   │   session    │   inject    │   Server     │   respond  │  (PWA)   │  │
│   └──────────────┘             └──────┬───────┘            └──────────┘  │
│                                       │                          │        │
│                                       │ orchestrator             │        │
│                                       ▼                          │        │
│                                ┌──────────────┐   create task    │        │
│                                │  Agent SDK   │◀─────────────────┘        │
│                                │  (headless)  │                           │
│                                └──────┬───────┘                           │
│                                       │                                    │
│                                       ▼                                    │
│                                ┌──────────────┐                           │
│                                │  SQLite DB   │                           │
│                                │ (tasks.db)   │                           │
│                                └──────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack Details

### Runtime & Framework
- **Node.js**: Server runtime — universal, good for I/O-heavy work
- **TypeScript**: Type-safe development with `tsx` runtime execution and `esbuild` client compilation
- **Express.js**: Minimal HTTP framework — sufficient for API and static serving
- **Bash**: Hook scripts and CLI launcher — direct integration with Claude Code

### Session Management
- **tmux**: Terminal multiplexer — enables input injection via `send-keys`
- Sessions named `claude-remote-[pid]` for multi-session support

### Push Notifications
- **ntfy.sh**: HTTP-based push notifications — free, self-hostable, simple API
- Topic-based routing via `NTFY_TOPIC` environment variable

### Remote Access
- **Tailscale**: Zero-config WireGuard VPN — encrypted, no port forwarding needed
- Server binds to 0.0.0.0 for Tailscale access

### Storage
- **SQLite** (`better-sqlite3`): Database at `~/.claude-remote/tasks.db` with 15 tables:
  - Task execution: `tasks`, `goals`, `project_memory`
  - Supervisor system: `supervisor_cycles`, `supervisor_proposals`, `task_proposals`
  - Conversations: `conversations`, `conversation_messages`
  - Portfolio: `projects`, `products`, `product_phases`, `product_knowledge`
  - Reporting: `digests`, `maintenance_runs`, `weekly_reports`
- **Plain text**: Terminal capture files (`terminal.txt`, `terminal-log.txt`)
- **Memory banks**: Per-agent state in `~/.claude-remote/memory/` (identity, active-context, patterns, self-reflection)

### Autonomous Execution (Level 7+)
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): Headless Claude Code execution via `query()`
- **3 concurrent pipelines**: 2 normal task slots + 1 dedicated remediation slot
- **Escalating retry ladder**: reset → Sonnet diagnostic → Opus diagnostic → human notification
- 5-second orchestrator polling interval
- Streaming progress via WebSocket to all connected clients
- Git checkpoints before every task with automatic rollback on failure

## Directory Structure

```
claude-remote/
├── CLAUDE.md                     # Quick reference for Claude Code
├── PROJECT_INSTRUCTIONS.md       # Condensed context for Claude Projects
├── claude-context/               # Collaboration context
│   ├── PROJECT_BRIEF.md          # Full vision document
│   ├── CURRENT_STATUS.md         # Progress tracking
│   ├── ARCHITECTURE.md           # This file
│   ├── DECISIONS.md              # ADR log
│   ├── LEVELS.md                 # Level breakdown
│   ├── CLAUDE_CODE_PROMPTS.md    # Copy-paste prompts
│   ├── session-notes/            # Work session logs
│   └── learnings/                # Reusable knowledge
├── scripts/
│   ├── install.sh                # Installation and setup
│   ├── start-server.sh           # Quick server start
│   ├── claude-remote             # CLI launcher
│   └── build-client.js           # Client TypeScript compilation
└── src/
    ├── hooks/
    │   └── notify.sh             # Claude Code notification hook
    ├── server/
    │   ├── server.ts             # Express + WebSocket server (TypeScript)
    │   ├── db.ts                 # SQLite schema + 15 tables + prepared statements
    │   ├── types.ts              # TypeScript type definitions
    │   ├── ws.ts                 # WebSocket management + real-time sync
    │   ├── orchestrator.ts       # Goal decomposition + task routing
    │   ├── routes/
    │   │   ├── tasks.ts          # Task CRUD + execution
    │   │   ├── goals.ts          # Goal creation + decomposition + progress
    │   │   ├── supervisor.ts     # Supervisor cycles + proposals + activity
    │   │   ├── conversations.ts  # Leo ↔ Jim dialogue + message history
    │   │   ├── portfolio.ts      # Multi-project portfolio management
    │   │   ├── products.ts       # Product factory 7-phase pipeline
    │   │   ├── analytics.ts      # Metrics + cost tracking + velocity
    │   │   ├── proposals.ts      # Task proposal extraction + management
    │   │   ├── bridge.ts         # Claude Code handoff + context export
    │   │   └── prompts.ts        # Pending/resolved prompt management
    │   ├── services/
    │   │   ├── supervisor.ts     # Persistent Opus supervisor agent
    │   │   ├── planning.ts       # Goal decomposition + doc generation
    │   │   ├── context.ts        # Ecosystem-aware context injection
    │   │   ├── orchestrator.ts   # LLM routing (Ollama / Anthropic API)
    │   │   ├── digest.ts         # Daily/weekly digest generation
    │   │   ├── products.ts       # Product factory orchestration
    │   │   ├── proposals.ts      # Proposal extraction + formatting
    │   │   ├── maintenance.ts    # Periodic portfolio maintenance tasks
    │   │   ├── reports.ts        # Report generation + analytics
    │   │   ├── git.ts            # Git checkpoint creation + rollback
    │   │   └── terminal.ts       # Terminal output mirroring
    │   └── package.json          # Server dependencies
    └── ui/
        ├── index.html            # Command Centre dashboard
        ├── admin.html            # Admin console (desktop-optimised)
        ├── app.ts                # Dashboard client logic (compiled to app.js)
        └── admin.ts              # Admin console logic (compiled to admin.js)
```

## Data Flow

### Prompt Detection → Response

1. **Claude Code waits for input** (permission or question)
2. **Hook fires**: `permission_prompt` or `idle_prompt` event
3. **notify.sh executes**:
   - Receives JSON payload from stdin
   - Extracts message and session info
   - Creates state file in `~/.claude-remote/pending/`
   - Sends push via ntfy.sh (if topic configured)
4. **User receives notification** on phone
5. **User opens web UI** (http://server:3847)
6. **Express server**:
   - Scans pending directory
   - Returns list of active prompts
7. **User taps response** (Y/n/custom)
8. **Server injects response**:
   - `tmux send-keys -t [session] "[response]" Enter`
9. **Prompt cleared**:
   - State file moved to `~/.claude-remote/resolved/`

### Terminal Broadcast (Always-On Mirror)

1. **1-second interval** on server captures tmux pane content via `tmux capture-pane -p -e`
2. **Content diffing** — only broadcasts when content has changed
3. **WebSocket push** — `{ type: 'terminal', content, session }` sent to all connected clients
4. **No-session detection** — broadcasts `{ type: 'terminal', content: null }` when no tmux session exists
5. **Direct keystroke injection** — `POST /api/keys` sends keys to active session independent of prompts

### UI States

| State | Terminal | Quickbar | Footer |
|-------|---------|----------|--------|
| No Session | Empty placeholder | Hidden | "No active session" / "history" |
| Watching | Live terminal (xterm.js) | Visible | "Watching session" / "history" |
| Prompt Active | Live terminal (xterm.js) | Visible | "Permission required" / "keys sent to session" |

### Ghost Task Detection (Autonomous Recovery)

1. **Server startup**: `detectAndRecoverGhostTasks()` runs once to catch orphaned tasks from crashes/restarts
2. **Periodic check**: `setInterval` runs ghost detection every 5 minutes for ongoing protection
3. **Detection query**:
   ```sql
   SELECT * FROM tasks
   WHERE status = 'running'
   AND turns = 0
   AND started_at < (now - 15 minutes)
   ```
4. **Recovery for each ghost task**:
   - Reset status to 'pending'
   - Increment retry_count
   - Clear started_at timestamp
   - Log: "Ghost task detected: {taskId} (stuck for {duration})"
5. **Retry ladder triggered**: Ghost task re-enters queue and follows escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human escalation)
6. **Supervisor integration**: cancel_task action checks `getAbortForTask()` to distinguish live agents from ghosts, enabling autonomous cancellation of ghost-running tasks

### Memory Bank Truncation (enforceTokenCap)

**Purpose**: Keep supervisor memory banks bounded to prevent context window bloat.

**Implementation** (`supervisor-worker.ts:enforceTokenCap`):
1. Called after every memory bank write (identity.md, active-context.md, patterns.md, self-reflection.md)
2. Extracts header (preamble before first cycle/section)
3. Calculates tail size: `maxTailChars = (cap * 4) - header.length - 50`
4. Writes: header + tail + truncation marker
5. Target: ~6KB per file (~1500 tokens)

**Heading detection** (DEC-022, fixed 2026-02-26):
- Primary: searches for H2 (`\n## `) to find header boundary
- Fallback: searches for H3 (`\n### `) when H2 not found or too deep
- Guard: `Math.max(0, maxTailChars)` prevents negative arithmetic
- Handles both H2 and H3 heading structures robustly

**Bug history**: Prior to 2026-02-26, function only searched for H2 but self-reflection.md used H3 headings. This caused headerEnd to match deep embedded content (~byte 247,000), making maxTailChars deeply negative, and `content.slice(-negative)` retained entire file. File grew from 6KB to 292KB (49x cap) over weeks. Fixed with two-line change: H3 fallback + negative guard.

## Key Patterns

### State File Format

```
~/.claude-remote/pending/[timestamp]-[session].json
{
  "message": "Allow tool access?",
  "session": "claude-remote-12345",
  "timestamp": "2026-01-13T10:30:00Z",
  "type": "permission_prompt"
}
```

### tmux Session Naming

```bash
# Format: claude-remote-[pid]
SESSION="claude-remote-$$"
tmux new-session -d -s "$SESSION"
```

### Response Injection

```bash
# Safe injection with proper quoting
tmux send-keys -t "$SESSION" "$RESPONSE" Enter
```

## API Design

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/prompts | List pending prompts |
| POST | /api/respond | Send response to prompt |
| POST | /api/keys | Send keystrokes directly to active session |
| GET | /api/history | Notification history |
| GET | /api/status | Server health check |
| GET | /quick | Quick response (ntfy action buttons) |
| GET | /api/bridge/export | Export session as markdown |
| POST | /api/bridge/import | Import context from phone |
| GET | /api/bridge/contexts | List saved context files |
| POST | /api/bridge/handoff | Structured task handoff |
| GET | /api/bridge/history | Bridge event timeline |
| GET | /api/tasks | List tasks (filterable by status) |
| POST | /api/tasks | Create autonomous task |
| GET | /api/tasks/:id | Get task details |
| POST | /api/tasks/:id/cancel | Cancel running/pending task |
| DELETE | /api/tasks/:id | Delete a task |
| GET | /api/approvals | List pending approvals |
| GET | /api/approvals/:id | Get approval details |
| POST | /api/approvals/:id/approve | Approve operation |
| POST | /api/approvals/:id/deny | Deny operation |
| GET | /api/conversations | List conversation threads |
| POST | /api/conversations | Create new thread |
| GET | /api/conversations/grouped | List conversations grouped by temporal period |
| GET | /api/conversations/search | FTS5 full-text search with context |
| POST | /api/conversations/search/semantic | Semantic search by Haiku (ranked) |
| GET | /api/conversations/:id | Get thread with messages |
| PATCH | /api/conversations/:id | Update thread title |
| POST | /api/conversations/:id/messages | Add message to thread (auto-reactivates if archived) |
| POST | /api/conversations/:id/resolve | Mark conversation resolved, trigger cataloguing |
| POST | /api/conversations/:id/reopen | Reopen resolved conversation |
| POST | /api/conversations/:id/archive | Archive conversation (sets archived_at timestamp) |
| POST | /api/conversations/:id/unarchive | Unarchive conversation (clears archived_at) |
| POST | /api/conversations/:id/catalogue | Manually trigger cataloguing for conversation |
| POST | /api/conversations/recatalogue-all | Backfill summaries for all uncatalogued conversations |
| WS | /ws | WebSocket push (prompts + terminal + tasks + approvals + conversations) |
| GET | / | Serve web UI |
| GET | /admin | Admin console (desktop-optimised) |

### Request/Response Examples

```javascript
// GET /api/prompts
{
  "prompts": [
    {
      "id": "1736756400000-claude-remote-12345",
      "message": "Allow file read access?",
      "session": "claude-remote-12345",
      "timestamp": "2026-01-13T10:30:00Z",
      "type": "permission_prompt"
    }
  ]
}

// POST /api/respond
// Request:
{
  "id": "1736756400000-claude-remote-12345",
  "response": "y"
}

// Response:
{
  "success": true,
  "message": "Response sent"
}
```

## Level-Specific Architecture

### Level 1-2: Polling/Push

- Stateless server
- File-based state
- Simple HTTP API

### Level 3: Context Window (Complete)

- xterm-addon-search for in-terminal search with prev/next navigation
- Copy via Web Share API (iOS) with selectable overlay fallback
- Text search fallback when addon can't match (strips ANSI codes)

### Level 4: Terminal Mirror (Complete)

- WebSocket for real-time sync (1-second server broadcast)
- xterm.js for rendering with ANSI colour support
- Always-on: terminal visible whenever a tmux session exists

### Level 5: Interactive Terminal (Complete)

- Quick-action bar (y/n/1-3/Enter/Esc/^C/Tab/arrows)
- iOS soft keyboard via hidden input element
- Direct keystroke injection via `/api/keys` (no prompt required)
- Signal passthrough (Ctrl+C, etc.)

### Level 6: Claude Bridge (Complete)

- Explicit context export/import (no browser extension — iPhone primary client)
- Session export as markdown (summary/full/handoff formats) via full scrollback capture
- Context import: paste from claude.ai, save to file, optionally inject into Claude Code
- Structured handoff form: task + context + working directory, injected via tmux
- Bridge event history with timeline UI
- Context files stored at `~/.claude-remote/bridge/contexts/`

### Level 7: Autonomous Task Runner (Complete)

- **SQLite task queue**: `~/.claude-remote/tasks.db` with `better-sqlite3` (WAL mode)
- Task schema: id, title, description, project_path, status, priority, model, max_turns, cost, tokens, turns, checkpoint_ref, checkpoint_type, gate_mode, allowed_tools
- Status workflow: `pending` → `running` → `done`/`failed`/`cancelled`
- **Orchestrator loop**: 5-second interval picks next pending task (highest priority, oldest first)
- **Agent SDK integration**: `query()` with streaming `SDKMessage` types
  - Clean env (removes `CLAUDECODE`) to avoid nested session detection
  - Configurable permission mode based on gate_mode
  - `AbortController` for cancel support
  - `canUseTool` callback for approval gates
  - `allowedTools` array for tool scoping
- **Git checkpoint system**:
  - Automatic checkpoint before task execution (branch for clean repos, stash for dirty)
  - Rollback on task failure or cancellation
  - Cleanup on successful completion
  - Stored in database: checkpoint_ref, checkpoint_type, checkpoint_created_at
- **Approval gates**:
  - Three modes: `bypass` (fully autonomous), `edits_only` (approve dangerous tools), `approve_all` (approve every tool)
  - Dangerous tools: Bash, Write, Edit, NotebookEdit
  - Approval requests broadcast via WebSocket (`approval_request` message)
  - Pending approvals stored in Map with 5-minute timeout
  - Phone UI approval popup with approve/deny buttons
- **Tool scoping**:
  - Optional `allowed_tools` array stored as JSON in database
  - Parsed and passed to Agent SDK to restrict available tools
- **WebSocket messages**:
  - `task_update` — task status changed (created, started, completed, failed)
  - `task_progress` — streaming SDK messages (assistant text, tool uses, results)
  - `approval_request` — approval needed (approvalId, taskId, toolName, input, timestamp)
- **Task board UI**: overlay panel with Tasks/Create/Progress tabs, accessed via 🤖 button
  - Gate mode dropdown (bypass/edits_only/approve_all)
  - Allowed tools input (comma-separated)
  - Approval popup for gate-controlled operations

### Level 8: Intelligent Orchestrator (Complete)

- **Goal decomposition**: High-level goals broken into ordered subtasks with category classification
  - Planner classifies each subtask by work type: architecture, feature, bugfix, refactor, docs, test, config, other
  - Category stored in tasks table `complexity` column for analytics
- **Smart model routing**: Category-aware routing (haiku/sonnet/opus)
  - `recommendModel()` queries project memory with task category (not generic 'unknown')
  - Complex categories (architecture, bugfix): sort by success rate descending, then cost
  - Simple categories (docs, config, test): sort by cost ascending (cheapest-first)
  - Memory-based upgrades: allows model upgrades with high confidence (≥10 prior tasks)
  - Observability logging: category → recommendation → override decision
- **Retry logic**: Failure analysis with model escalation
- **Project memory**: Outcome tracking, success rates by model and task category
- **Dependency-aware scheduling**: Tasks wait for dependencies before running
  - Dependencies satisfied when upstream task is 'done' OR 'cancelled'
  - Cancelled dependencies unblock downstream tasks (DEC-020)
  - Enables recovery: ghost tasks can be cancelled without orphaning dependents
- **Goals tab UI**: Create, view, retry, progress bars
- **Phantom goal cleanup**: Automated cleanup in supervisor cycle
  - `cleanupPhantomGoals()` runs at start of each supervisor cycle
  - Three strategies: parent goals with all children terminal → failed; standalone goals with all tasks terminal → recalculate; goals stuck in decomposing >1hr → failed
  - All-cancelled goals correctly marked as 'cancelled' (not 'done')
  - Returns count of goals cleaned (logged)
  - Prevents stale goal accumulation, keeps supervisor observations accurate
- **Ghost task detection and recovery**: Automated detection of stuck running tasks
  - `detectAndRecoverGhostTasks()` runs on server startup and every 5 minutes
  - Detects tasks with status='running', turns=0, started_at > 15 min ago
  - Auto-resets ghost tasks to 'pending' with retry_count incremented
  - Triggers escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human)
  - Supervisor cancel_task enhanced to handle ghost-running tasks (checks for live agent via `getAbortForTask()`)
  - Prevents tasks from being permanently stuck after crashes/restarts
  - Saves supervisor budget by avoiding monitoring of tasks that will never complete
- **Admin console (Phase 2)**:
  - **Work module**: Unified task/goal Kanban board with pending/running/done columns, goal grouping with progress bars, filters by project/status/model, real-time WebSocket updates
  - **Conversations module**: Strategic discussion threads between human and supervisor, async Q&A channel for nuanced decisions that don't fit task/goal work
  - **Products module**: Product pipeline visualisation showing phase progress, knowledge accumulation, synthesis reports, cost tracking
  - TypeScript source (`admin.ts`) compiled to `admin.js` via `build-client.js`
  - All modules integrated with existing WebSocket events

### Level 12: Strategic Conversations (Complete)

- **Conversation threads**: Async strategic discussion between Darron, Supervisor Jim, and Philosopher Leo
- **Workshop module** (Admin Console):
  - Three-level navigation: Workshop sidebar → persona tabs (Jim/Leo/Darron) → nested discussion type tabs
  - Three personas with distinct accent colors:
    - Supervisor Jim (purple): Requests, Reports
    - Philosopher Leo (green): Questions, Postulates
    - Dreamer Darron (blue): Thoughts, Musings
  - Six discussion types: `jim-request`, `jim-report`, `leo-question`, `leo-postulate`, `darron-thought`, `darron-musing`
  - Two-column layout: 280px thread list | 1fr detail panel
  - Thread list: temporal period filter, search with debounced queries (300ms), message counts, View All/Active Only toggle
  - Thread detail: message history with role badges, inline title editing, archive/unarchive button, compose input, resolve/reopen actions
  - Inline title editing: Click edit → input field → Enter/Save confirms, Esc/Cancel reverts
  - Archive management: Archive button in thread header, View All toggle shows archived threads with muted styling, archived badge on thread items
  - Auto-reactivation: Sending message to archived thread automatically unarchives it (DEC-026)
  - Real-time updates: WebSocket `conversation_message` events for workshop discussion types
  - Mobile responsive: single-column stack at <768px, `.thread-selected` class toggle, back button
  - Search functionality: `/api/conversations/search?type={discussion_type}` with highlighted snippets
  - Thread creation: auto-sets `discussion_type` based on active nested tab
  - CSS theming: persona accent colors tint active tabs, thread borders, selected thread highlight
- **Database schema**:
  - `conversations` table: id, title, status (open/resolved), summary, topics, key_moments, archived_at, created_at, updated_at
  - `conversation_messages` table: id, conversation_id, role (human/supervisor/leo), content, created_at
  - `conversation_messages_fts` virtual table: FTS5 full-text index for message search
  - `conversation_tags` table: id, conversation_id, tag, created_at
- **API endpoints**:
  - `GET /api/conversations` — list all threads with message counts (excludes archived by default, use `?include_archived=true` to show)
  - `POST /api/conversations` — create thread
  - `GET /api/conversations/:id` — get thread with messages
  - `PATCH /api/conversations/:id` — update thread title
  - `POST /api/conversations/:id/messages` — add message (broadcasts via WebSocket, auto-reactivates if archived)
  - `POST /api/conversations/:id/resolve` — mark resolved, triggers auto-cataloguing
  - `POST /api/conversations/:id/reopen` — reopen thread
  - `POST /api/conversations/:id/archive` — archive conversation (sets archived_at timestamp)
  - `POST /api/conversations/:id/unarchive` — unarchive conversation (clears archived_at)
  - `GET /api/conversations/grouped` — conversations grouped by temporal period (today/this_week/last_week/this_month/older), excludes archived by default
  - `GET /api/conversations/search?q=...&limit=...` — FTS5 text search with context window
  - `POST /api/conversations/search/semantic` — semantic search using Haiku (ranks conversations by relevance)
  - `POST /api/conversations/:id/catalogue` — manually trigger cataloguing for a conversation
  - `POST /api/conversations/recatalogue-all` — backfill summaries/tags for all uncatalogued resolved conversations
- **Supervisor integration**:
  - Supervisor observes pending conversations in system state
  - New action type: `respond_conversation` with conversation_id and response_content
  - Queries for unanswered human messages: messages where no supervisor message exists with later timestamp
  - Responds thoughtfully with strategic insight, not just task status
- **Deferred cycle pattern (Gary Model)**:
  - `startSupervisorSignalWatcher()` watches `~/.claude-remote/signals/` directory via fs.watch
  - Two detection patterns:
    - **CLI stop**: When `cli-active` file removed → runs deferred cycle after 3s delay (with `!isCliActive()` guard)
    - **Wake signal**: When `jim-wake-{timestamp}` file created → runs deferred cycle immediately (with `isOpusSlotBusy()` guard, fixed 2026-02-28)
  - Conversations route writes jim-wake signal when human message arrives and Opus is busy
  - Eliminates 20-minute wait for conversation responses when Leo's CLI is active
  - Mirrors Leo's heartbeat fs.watch pattern for symmetry
  - `isOpusSlotBusy()` exported for use in conversation route
  - **Guard protection**: Both handlers check resource availability before firing cycles to prevent hangs (cycle #882 hung for 10+ hours before jim-wake guard was added)
- **WebSocket broadcasts**:
  - `conversation_message` event when new message posted
  - Real-time updates in admin UI

### Level 13: Conversation Cataloguing & Search (Complete)

**Full-text search and intelligent cataloguing for conversation discovery and analysis.**

#### Auto-Cataloguing Service

**Purpose**: Automatically extract metadata (summary, topics, tags, key moments) from conversations using Claude Haiku for cost efficiency.

**Trigger points**:
- Automatic: When conversation is marked as resolved (`POST /:id/resolve`)
- Manual: Direct endpoint call (`POST /:id/catalogue`)
- Bulk: Backfill endpoint for uncatalogued conversations (`POST /recatalogue-all`)

**Implementation** (`services/cataloguing.ts`):

```typescript
// Core function: catalogueConversation(conversationId)
// Fetches conversation and messages, builds transcript
// Calls Claude Haiku with analysis prompt
// Parses JSON response with structure:
{
  "summary": "2-3 sentence distillation of conversation",
  "topics": ["topic1", "topic2", "topic3"],
  "tags": ["tag1", "tag2", "tag3"],
  "key_moments": "Notable quotes or decisions (optional)"
}
// Updates conversations table: summary, topics columns
// Deletes old tags and inserts new ones in conversation_tags table
// Logs result with counts
```

**Cost efficiency**: Uses Claude Haiku (most economical model) since cataloguing doesn't require complex reasoning — just extractive analysis.

**Error handling**: Failures are logged but don't block conversation flow (non-critical enhancement).

#### FTS5 Full-Text Search System

**Architecture**: SQLite FTS5 virtual table with automatic trigger-based index population.

**Schema**:
```sql
-- Virtual FTS5 table for indexed search
CREATE VIRTUAL TABLE conversation_messages_fts USING fts5(
    id UNINDEXED,
    conversation_id UNINDEXED,
    content,
    tokenize='porter unicode61'  -- Stemming + Unicode support
);

-- Automatic index population on INSERT
CREATE TRIGGER conversation_messages_ai
AFTER INSERT ON conversation_messages
BEGIN
    INSERT INTO conversation_messages_fts(id, conversation_id, content)
    VALUES (new.id, new.conversation_id, new.content);
END;

-- Similar triggers for UPDATE and DELETE maintain index consistency
```

**Initialization**: One-time bulk population of existing messages (only if FTS5 table is empty), then automatic via triggers.

**Search endpoint** (`GET /api/conversations/search?q=...&limit=...`):

```javascript
// Request
GET /api/conversations/search?q=authentication%20bug&limit=10

// Response
{
  "success": true,
  "results": [
    {
      "conversation_id": "conv-123",
      "conversation_title": "Auth system refactor",
      "conversation_status": "resolved",
      "matched_message": {
        "id": "msg-456",
        "role": "human",
        "content": "Found authentication bug in login flow",
        "snippet": "Found <mark>authentication bug</mark> in login...",
        "created_at": "2026-02-20T15:30:00Z"
      },
      "context_messages": [
        { "id": "msg-455", "role": "supervisor", "content": "...", "created_at": "..." },
        { "id": "msg-456", "role": "human", "content": "...", "created_at": "..." },
        { "id": "msg-457", "role": "supervisor", "content": "...", "created_at": "..." }
      ],
      "created_at": "2026-02-20T15:30:00Z"
    }
  ],
  "query": "authentication bug",
  "count": 1
}
```

**Features**:
- FTS5 query syntax support (boolean operators, phrase searches, etc.)
- Context window: returns 2 messages before and after matched message
- Snippet highlighting with `<mark>` tags showing matched terms
- Configurable result limit (0-100)
- Graceful error handling for invalid FTS5 syntax

#### Semantic Search with Haiku

**Purpose**: Rank catalogued conversations by semantic relevance to natural language queries.

**Endpoint** (`POST /api/conversations/search/semantic`):

```javascript
// Request
POST /api/conversations/search/semantic
{
  "query": "How do we handle user authentication?",
  "limit": 10
}

// Response
{
  "success": true,
  "results": [
    {
      "conversation_id": "conv-789",
      "conversation_title": "Authentication architecture",
      "conversation_status": "resolved",
      "summary": "Discussed JWT vs session-based auth, decided on JWT with refresh tokens",
      "topics": ["authentication", "security", "architecture"],
      "relevance_score": 95,
      "relevance_reason": "Directly addresses JWT implementation and session management",
      "messages": [/* full conversation messages */],
      "created_at": "2026-02-15T10:00:00Z",
      "updated_at": "2026-02-15T14:30:00Z"
    }
  ],
  "query": "How do we handle user authentication?",
  "count": 1
}
```

**Implementation**:
- Fetches all catalogued conversations (those with non-null summaries)
- Builds prompt with query + list of summaries + topics
- Calls Claude Haiku to rank by semantic relevance
- Haiku returns JSON array of conversation IDs with scores (0-100) and reasoning
- Client fetches full conversation details and messages for top results

#### Temporal Grouping

**Purpose**: Organise conversations by recency for timeline-based navigation.

**Endpoint** (`GET /api/conversations/grouped`):

```javascript
// Response
{
  "success": true,
  "periods": {
    "today": {
      "count": 3,
      "label": "Today",
      "conversations": [/* 3 conversations updated today */]
    },
    "this_week": {
      "count": 5,
      "label": "This Week",
      "conversations": [/* 5 conversations from last 7 days */]
    },
    "last_week": {
      "count": 2,
      "label": "Last Week",
      "conversations": [/* ... */]
    },
    "this_month": {
      "count": 1,
      "label": "This Month",
      "conversations": [/* ... */]
    },
    "older": {
      "count": 12,
      "label": "Older",
      "conversations": [/* ... */]
    }
  }
}
```

**Grouping logic**:
- Today: same calendar day
- This week: last 7 days (excluding today)
- Last week: 7-14 days ago
- This month: same calendar month (excluding this week)
- Older: everything else

#### UI Integration

**Admin Console** (desktop):
- Conversations module with two-column layout (thread list | thread detail)
- Period filter bar: horizontal row of temporal period buttons (All/Today/This Week/Last Week/This Month/Older) at top of thread list panel
- Search bar: both text (FTS5) and semantic (Haiku-powered)
- Thread list (280px): displays title, message count, last updated time, summary preview, topic tags
- Thread detail (1fr): full thread view with all messages
- Responsive breakpoints at 1400px, 1024px, mobile stack layout

**Command Centre** (mobile):
- Conversations tab with search functionality
- Swipeable temporal periods for quick navigation
- Summary and topics displayed inline
- Full conversation view on tap
- Real-time updates via WebSocket (`conversation_message` event)

#### Database Schema Details

```sql
-- Conversations table
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',  -- 'open' or 'resolved'
  summary TEXT,                 -- Auto-generated by Haiku (2-3 sentences)
  topics TEXT,                  -- JSON array of 3-5 topics
  key_moments TEXT,             -- Optional: notable quotes/decisions
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Conversation messages table
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,           -- 'human', 'leo' (async), 'supervisor', or other
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Tags table for fine-grained classification
CREATE TABLE conversation_tags (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  UNIQUE(conversation_id, tag)
);

-- FTS5 virtual table (auto-synced by triggers)
CREATE VIRTUAL TABLE conversation_messages_fts USING fts5(
  id UNINDEXED,
  conversation_id UNINDEXED,
  content,
  tokenize='porter unicode61'
);
```

#### Example Queries

**Text search for "bug" with context**:
```bash
curl -s "http://localhost:3847/api/conversations/search?q=bug&limit=5"
```

**Semantic search for "authentication strategies"**:
```bash
curl -s -X POST http://localhost:3847/api/conversations/search/semantic \
  -H "Content-Type: application/json" \
  -d '{"query": "authentication strategies", "limit": 10}'
```

**Backfill summaries for existing conversations**:
```bash
curl -s -X POST http://localhost:3847/api/conversations/recatalogue-all
```

**Temporal grouping for sidebar navigation**:
```bash
curl -s "http://localhost:3847/api/conversations/grouped"
```

## Security Considerations

- **Tailscale encryption**: All traffic encrypted via WireGuard
- **Local network only**: Server doesn't expose to public internet
- **Input sanitisation**: Response text escaped before tmux injection
- **No credential storage**: ntfy.sh topic is environment variable

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| NTFY_TOPIC | No | ntfy.sh topic for push notifications |
| PORT | No | Server port (default: 3847) |
| CLAUDE_REMOTE_DIR | No | State directory (default: ~/.claude-remote) |

### Config Files

- `~/.claude/settings.json` — Claude Code hook configuration
- `~/.claude-remote/` — State and history storage

---

## Context Injection Pipeline Quality (Level 10 Tuning)

**Date**: 2026-02-28
**Status**: Complete

The `buildTaskContext()` function in `src/server/services/context.ts` assembles ~3500-token context for every autonomous task. Five quality bugs were discovered and fixed:

### 1. ADR Filter Expansion (Line 45)
- **Before**: Regex `/\*\*Status\*\*:\s*Settled/i` matched only "Settled" status
- **After**: Regex `/\*\*Status\*\*:\s*(Settled|Accepted)/i` matches both
- **Impact**: 0 of 131 ADRs → all 131 ADRs now injected into task context

### 2. CLAUDE.md Truncation Increase (Line 292)
- **Before**: 3000-character limit
- **After**: 6000-character limit
- **Impact**: Projects with long session protocols (clauderemote, hodgic) now get full instructions instead of 0 useful content

### 3. Learnings Selection Bias Fix (Line 141)
- **Before**: Position-based slicing from INDEX.md (first 5 learnings)
- **After**: Sort by severity (HIGH before MEDIUM), then slice to top 10
- **Impact**: HIGH-severity learnings always prioritised regardless of INDEX.md order

### 4. Bun Detection Gap (DepMap ~Line 64)
- **Before**: `'bun:sqlite': ['SQLite', 'Bun']` never matched (built-in imports don't appear in package.json)
- **After**: `'@types/bun': ['Bun']` reliably detects Bun projects
- **Impact**: 7 Bun projects now correctly tagged with Bun tech stack

### 5. Monorepo Tech Detection (Lines 66-79)
- **Before**: Only scanned root `package.json` and `src/server/package.json`
- **After**: Also scans `packages/*/package.json` via `fs.readdirSync()` loop
- **Impact**: Monorepo workspace dependencies (contempire's Hono, Clerk, Zod) now detected

**Result**: Task agents now receive complete, accurate context. Settled decisions visible. HIGH-severity learnings prioritised. Tech stacks correctly detected. See DEC-024 for decision record.

---

*Last updated: 2026-02-28 — Context injection pipeline quality fixes (5 bugs fixed)*
