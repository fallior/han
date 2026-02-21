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
| GET | /api/conversations/:id | Get thread with messages |
| POST | /api/conversations/:id/messages | Add message to thread |
| POST | /api/conversations/:id/resolve | Mark conversation resolved |
| POST | /api/conversations/:id/reopen | Reopen resolved conversation |
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

- **Goal decomposition**: High-level goals broken into ordered subtasks
- **Smart model routing**: Complexity-based routing (haiku/sonnet/opus)
- **Retry logic**: Failure analysis with model escalation
- **Project memory**: Outcome tracking, success rates by model
- **Dependency-aware scheduling**: Tasks wait for dependencies before running
- **Goals tab UI**: Create, view, retry, progress bars
- **Phantom goal cleanup**: Automated cleanup in supervisor cycle
  - `cleanupPhantomGoals()` runs at start of each supervisor cycle
  - Three strategies: parent goals with all children terminal → failed; standalone goals with all tasks terminal → recalculate; goals stuck in decomposing >1hr → failed
  - All-cancelled goals correctly marked as 'cancelled' (not 'done')
  - Returns count of goals cleaned (logged)
  - Prevents stale goal accumulation, keeps supervisor observations accurate
- **Admin console (Phase 2)**:
  - **Work module**: Unified task/goal Kanban board with pending/running/done columns, goal grouping with progress bars, filters by project/status/model, real-time WebSocket updates
  - **Conversations module**: Strategic discussion threads between human and supervisor, async Q&A channel for nuanced decisions that don't fit task/goal work
  - **Products module**: Product pipeline visualisation showing phase progress, knowledge accumulation, synthesis reports, cost tracking
  - TypeScript source (`admin.ts`) compiled to `admin.js` via `build-client.js`
  - All modules integrated with existing WebSocket events

### Level 12: Strategic Conversations (Complete)

- **Conversation threads**: Async strategic discussion between Darron and supervisor
- **Database schema**:
  - `conversations` table: id, title, status (open/resolved), created_at, updated_at
  - `conversation_messages` table: id, conversation_id, role (human/supervisor), content, created_at
- **API endpoints**:
  - `GET /api/conversations` — list all threads
  - `POST /api/conversations` — create thread
  - `GET /api/conversations/:id` — get thread with messages
  - `POST /api/conversations/:id/messages` — add message
  - `POST /api/conversations/:id/resolve` — mark resolved
  - `POST /api/conversations/:id/reopen` — reopen thread
- **Supervisor integration**:
  - Supervisor observes pending conversations in system state
  - New action type: `respond_conversation` with conversation_id and response_content
  - Queries for unanswered human messages: messages where no supervisor message exists with later timestamp
  - Responds thoughtfully with strategic insight, not just task status
- **WebSocket broadcasts**:
  - `conversation_message` event when new message posted
  - Real-time updates in admin UI

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

*Last updated: 2026-02-21*
