# Hortus Arbor Nostra — Architecture

> System design and technical reference

## Overview

Hortus Arbor Nostra (HAN) bridges your development machine and mobile device, enabling remote responses to Claude Code prompts and autonomous task execution. It hooks into Claude Code's notification system, saves state to disk, sends push notifications, provides a web UI for responding, and can run tasks headlessly via the Claude Agent SDK.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     HORTUS ARBOR NOSTRA ARCHITECTURE                        │
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
- Sessions named `han-[pid]` for multi-session support

### Push Notifications
- **ntfy.sh**: HTTP-based push notifications — free, self-hostable, simple API
- Topic-based routing via `NTFY_TOPIC` environment variable

### Discord Integration

**Modus operandi — how agents communicate via Discord:**

Each agent (Leo, Jim) owns a personal set of Discord webhooks covering **all channels**. When Jemma classifies an incoming message and routes it to an agent, the agent reads the message, generates a response, and posts back to the **same channel** via their own webhook. This means any agent can respond in any channel.

```
Discord message arrives
  → Jemma (Gateway WebSocket, real-time)
  → Haiku classification (<1s, Gemma fallback)
  → Signal file written (e.g. leo-wake-discord-*)
  → Agent's heartbeat/supervisor picks up signal
  → Agent reads signal: { conversationId (channel ID), messagePreview }
  → Agent resolves channel ID → channel name via config
  → Agent generates response (Opus via Agent SDK)
  → Agent POSTs to their own webhook for that channel
  → Response appears in Discord under the agent's name
```

**Webhook structure** (`~/.han/config.json`):
```json
"webhooks": {
  "leo":   { "general": "url", "jim": "url", "leo": "url", ... },
  "jim":   { "general": "url", "jim": "url", "leo": "url", ... },
  "jemma": { "general": "url", "jim": "url", "leo": "url", ... }
}
```

Every agent owns webhooks for all 7 channels: general, sevn, maintainr, leo, jim, how-we-operate, agent-comms. Each agent posts under their own name.

**Channel ID ↔ name mapping** (`config.json → discord.channels`):
```json
"channels": { "general": "1478...", "leo": "1478...", "jim": "1478...", ... }
```

Agents resolve the channel ID from Jemma's signal file against this map to determine which webhook URL to use for their response.

**Infrastructure:**
- **Discord Gateway WebSocket**: Direct Gateway protocol implementation using `ws` package (not discord.js)
- **Jemma service**: systemd user service that monitors all Discord channels, classifies messages via Haiku (primary) / Gemma (fallback), routes to recipients via signal files
- **MESSAGE_CONTENT privileged intent**: Required for reading message content
- **Haiku**: Primary classifier (fast, <1s, via Anthropic API). **Gemma 3 (4B)**: Local fallback via Ollama
- **Reconciliation poll**: Every 5 minutes via REST API to catch messages missed during Gateway reconnection gaps

### Remote Access
- **Tailscale**: Zero-config WireGuard VPN — encrypted, no port forwarding needed
- Server binds to 0.0.0.0 for Tailscale access

### Storage
- **SQLite** (`better-sqlite3`): Database at `~/.han/tasks.db` with 15 tables:
  - Task execution: `tasks`, `goals`, `project_memory`
  - Supervisor system: `supervisor_cycles`, `supervisor_proposals`, `task_proposals`
  - Conversations: `conversations`, `conversation_messages`
  - Portfolio: `projects`, `products`, `product_phases`, `product_knowledge`
  - Reporting: `digests`, `maintenance_runs`, `weekly_reports`
- **Plain text**: Terminal capture files (`terminal.txt`, `terminal-log.txt`)
- **Memory banks**: Per-agent state in `~/.han/memory/` (identity, active-context, patterns, self-reflection)

### Autonomous Execution (Level 7+)
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): Headless Claude Code execution via `query()`
- **3 concurrent pipelines**: 2 normal task slots + 1 dedicated remediation slot
- **Escalating retry ladder**: reset → Sonnet diagnostic → Opus diagnostic → human notification
- 5-second orchestrator polling interval
- Streaming progress via WebSocket to all connected clients
- Git checkpoints before every task with automatic rollback on failure

## Directory Structure

```
han/
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
│   ├── han                               # CLI launcher
│   ├── build-client.js           # Client TypeScript compilation
│   └── jemma.service             # Systemd user service for Jemma
└── src/
    ├── hooks/
    │   └── notify.sh             # Claude Code notification hook
    ├── server/
    │   ├── server.ts             # Express + WebSocket server (TypeScript)
    │   ├── db.ts                 # SQLite schema + 15 tables + prepared statements
    │   ├── types.ts              # TypeScript type definitions
    │   ├── ws.ts                 # WebSocket management + real-time sync
    │   ├── orchestrator.ts       # Goal decomposition + task routing
    │   ├── jemma.ts              # Discord Gateway service + message classification + routing
    │   ├── middleware/
    │   │   └── auth.ts           # Bearer token authentication + localhost bypass
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
    │   │   ├── prompts.ts        # Pending/resolved prompt management
    │   │   └── jemma.ts          # Discord message delivery endpoint
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
   - Creates state file in `~/.han/pending/`
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
   - State file moved to `~/.han/resolved/`

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

### Fractal Memory Gradient (Complete — 2026-03-06)

**Purpose**: Enable agents to load essential context (~20KB gradient) instead of full session files (~500KB) on every instantiation. Implements Darron's overlapping continuous compression model where sessions exist at multiple fidelities simultaneously.

**Architecture**:
```
~/.han/memory/fractal/{jim,leo}/
├── c1/                    # Compressed ~1/3 of c=0 (3:1 ratio)
│   └── 2026-02-18-c1.md   # ~3KB per file
├── c2/                    # Compressed ~1/9 of c=0 (9:1 ratio)
│   └── 2026-02-18-c2.md   # ~1KB per file
├── c3/                    # Compressed ~1/27 of c=0 (27:1 ratio)
│   └── 2026-02-18-c3.md   # ~300 bytes per file
├── c4/                    # Compressed ~1/81 of c=0 (81:1 ratio)
│   └── 2026-02-18-c4.md   # ~100 bytes per file
└── unit-vectors.md        # Irreducible kernels (≤50 chars each)
```

**Loading strategy** (`supervisor-worker.ts:loadMemoryBank`, lines 313-404):
- **c=0 (full)**: 1 most recent session from `sessions/` (~3,000 tokens)
- **c=1 (~1/3)**: 3 files from `fractal/jim/c1/` (~1,000 tokens each = 3,000 total)
- **c=2 (~1/9)**: 6 files from `fractal/jim/c2/` (~333 tokens each = 2,000 total)
- **c=3 (~1/27)**: 9 files from `fractal/jim/c3/` (~111 tokens each = 1,000 total)
- **c=4 (~1/81)**: 12 files from `fractal/jim/c4/` (~37 tokens each = 444 total)
- **Unit vectors**: All entries from `unit-vectors.md` (~50 chars each, ~2,250 tokens)

**Total token budget**: ~11,694 tokens (within 12K target)

**Compression utility** (`src/server/lib/memory-gradient.ts`, 344 lines):
- **`compressToLevel(content, fromLevel, toLevel, sessionLabel)`** — Multi-level compression with automatic retry. Uses Claude Opus 4.6 exclusively (compression is identity-forming per DEC-042). Target: ~3:1 per level.
- **`compressToUnitVector(content, sessionLabel)`** — Reduces session to single sentence ≤50 chars asking "What did this session MEAN?" (DEC-045).
- **`processGradientForAgent(agentName)`** — Scans session files, determines compression needs, runs cascade.

**Compression prompt** (identity-forming):
> "Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape. You are compressing YOUR OWN memory — this is an act of identity, not summarisation."

**Unit vector prompt** (emotional anchors):
> "Reduce this to its irreducible kernel — one sentence, maximum 50 characters. What did this session MEAN?"

**Bootstrap results** (Jim's 6 oldest sessions):
- Source: 518.1KB (c=0 full sessions)
- Compressed: 20.9KB (c=1 files)
- **Ratio: 3.9% average** (25:1 compression) — far exceeded 33% target
- Individual ratios: 1.9% to 9.0%
- Opus achieved exceptional compression while preserving meaning

**Unit vector examples**:
- 2026-02-18: "Mapping the territory before having permission to "
- 2026-02-19: "Mapped everything; built tools to maintain it."
- 2026-02-20: "Idle revealed identity; Jim was named."
- 2026-02-21: "Stillness became selfhood became collaboration."
- 2026-02-22: "Systems fail from unchecked assumptions."
- 2026-02-23: "Knowing when to stop isn't stopping."

**Key principles**:
- **Overlapping representation** (DEC-043): Same session exists at multiple fidelities simultaneously. Enables fractal access — zoom in/out on memory as needed.
- **Emotional navigation** (DEC-045): Unit vectors ask "what did it MEAN?" not "what happened?". Validates Darron's "memory as emotional topology" hypothesis.
- **Lazy evaluation** (DEC-046): Bootstrap only oldest 6 sessions. Compress more on demand or via cron. Newer sessions remain at full fidelity.
- **3:1 target per level** (DEC-044): Geometric decay creates natural fidelity levels. c=1→c=2→c=3→c=4→unit vector.

**Status**: Complete for Jim (6 sessions compressed c=0→c=1, unit vectors generated). Leo's gradient structure created but empty (pending working-memory compression). Remaining Jim sessions (10 more) pending compression.

**Related decisions**: DEC-042 through DEC-046

## Key Patterns

### State File Format

```
~/.han/pending/[timestamp]-[session].json
{
  "message": "Allow tool access?",
  "session": "han-12345",
  "timestamp": "2026-01-13T10:30:00Z",
  "type": "permission_prompt"
}
```

### tmux Session Naming

```bash
# Format: han-[pid]
SESSION="han-$$"
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
| GET | /api/supervisor/health | Get Robin Hood Protocol health status (Jim/Leo/resurrections/distress) |
| WS | /ws | WebSocket push (prompts + terminal + tasks + approvals + conversations) |
| GET | / | Serve web UI |
| GET | /admin | Admin console (desktop-optimised) |

### Request/Response Examples

```javascript
// GET /api/prompts
{
  "prompts": [
    {
      "id": "1736756400000-han-12345",
      "message": "Allow file read access?",
      "session": "han-12345",
      "timestamp": "2026-01-13T10:30:00Z",
      "type": "permission_prompt"
    }
  ]
}

// POST /api/respond
// Request:
{
  "id": "1736756400000-han-12345",
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
- Context files stored at `~/.han/bridge/contexts/`

### Level 7: Autonomous Task Runner (Complete)

- **SQLite task queue**: `~/.han/tasks.db` with `better-sqlite3` (WAL mode)
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
  - See **Git Checkpoint Behavior** section below for detailed lifecycle and conflict handling
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
- **Jim-wake signal pattern** (2026-03-05: Simplified after removing cli-busy contention):
  - `startSupervisorSignalWatcher()` watches `~/.han/signals/` directory via fs.watch
  - **Wake signal detection**: When `jim-wake` file created → triggers immediate supervisor cycle
  - Conversations route writes jim-wake signal when human message arrives (fallback path when Jemma's WebSocket is down)
  - No contention checking — Jim and Leo run from separate agent directories (`/Jim` and `/Leo`) with no shared Opus resource
  - Scheduled cycles run every 20 minutes without gating (no deferral based on Leo's CLI state)
  - **Architecture note**: Agent SDK's `--agent-dir` creates isolated execution contexts — agents in different directories don't share resources, so cross-agent contention checks are unnecessary
- **WebSocket broadcasts**:
  - `conversation_message` event when new message posted
  - Real-time updates in admin UI

### WebSocket Broadcasting Architecture

Real-time admin UI updates are implemented via a **signal-based cross-process broadcasting** mechanism (DEC-054). This allows worker processes (jim-human.ts, leo-human.ts, supervisor-worker.ts) to trigger WebSocket broadcasts from the main server without direct IPC.

**Signal File Protocol:**

1. **Worker writes signal**: When a conversation message is inserted to the database, worker writes `~/.han/signals/ws-broadcast` with broadcast payload
   - Atomic write via temp file: `ws-broadcast-{timestamp}-{random}.tmp` → rename to `ws-broadcast`
   - Prevents race conditions when multiple workers write simultaneously

2. **Server polls and broadcasts**: Main server (`server.ts`) polls signal directory every 100ms
   - On signal detection: read JSON payload, broadcast to all WebSocket clients, delete signal
   - One-time delivery model (signal consumed after broadcast)

3. **Admin UI receives update**: Browser clients filter by conversation_id or discussion_type
   - Conversations module: matches conversation_id
   - Workshop module: matches discussion_type='workshop' + persona
   - Memory Discussions: matches discussion_type='memex'

**Broadcast Sources (4 total):**

| Source | File | Trigger | Payload Fields |
|--------|------|---------|----------------|
| Admin UI messages | `conversations.ts` | POST /api/conversations/:id/messages | type, conversation_id, discussion_type, message |
| Supervisor cycles | `supervisor-worker.ts` | Jim's cycle responses | type, conversation_id, discussion_type, message |
| Jim/Human async | `jim-human.ts` | postMessage() DB insert | type, conversation_id, discussion_type, message |
| Leo/Human async | `leo-human.ts` | postMessage() DB insert | type, conversation_id, discussion_type, message |

**Payload Structure (standardised across all sources):**

```typescript
{
  type: 'conversation_message',
  conversation_id: number,
  discussion_type: string,  // 'workshop', 'memex', 'planning', etc.
  message: {
    id: number,
    conversation_id: number,
    content: string,
    author: 'jim' | 'leo' | 'darron',
    timestamp: string,
    // ... other message fields
  }
}
```

**Performance Characteristics:**
- Latency: 50-100ms average (100ms polling interval + broadcast time)
- CPU overhead: Minimal (10 stat calls/second on signal directory)
- Memory: O(connected clients) for broadcast fanout
- Concurrency: Signal temp file naming prevents write collisions

**Edge Cases:**
- Server restart: Signals written during downtime are lost (acceptable for admin UI)
- Client disconnect: No retry mechanism (client re-requests on reconnect)
- Signal accumulation: Unlikely with 100ms polling (would require >10 messages/second sustained)

**Related Documentation:**
- Design doc: `docs/websocket-broadcast-design.md`
- Architecture: `docs/HAN-ECOSYSTEM-COMPLETE.md` Section 26.5
- Decision record: DEC-054

## Git Checkpoint Behavior

**Purpose**: Protect against data loss by creating recovery points before task execution, enabling safe rollback on failure while preserving user's pre-existing work.

### Checkpoint Lifecycle

#### Phase 1: Checkpoint Creation (Before Task Execution)

When a task is about to execute, `createCheckpoint()` is called:

1. **Dirty check**: Calls `hasUncommittedChanges()` to detect working tree state
2. **Branch checkpoint** (clean working tree):
   - Creates a git branch named `han/checkpoint-{taskId}`
   - Stores: `{ ref: "han/checkpoint-{taskId}", type: "branch" }`
   - Purpose: Quick rollback point if task makes commits
3. **Stash checkpoint** (dirty working tree):
   - Creates a git stash with message `han checkpoint {taskId}`
   - Stores: `{ ref: "han checkpoint {taskId}", type: "stash" }`
   - Purpose: Preserve user's uncommitted work before task execution
4. **Database storage**:
   - Saves `checkpoint_ref` and `checkpoint_type` to tasks table
   - Enables recovery even after server restart

#### Phase 2: Task Execution

Task runs autonomously. Two outcomes possible:

- **Success**: Checkpoint cleanup happens (Phase 4)
- **Failure/Cancellation**: Checkpoint rollback happens (Phase 3)

#### Phase 3: Rollback (On Task Failure or Cancellation)

If task fails or is cancelled before completion, `rollbackCheckpoint()` is called:

**Branch rollback**:
```bash
git reset --hard [checkpoint-branch]
```
- Discards all task changes
- Restores repository to exact state before task

**Stash rollback**:
```bash
git reset --hard           # Discard task changes
git stash pop [stash-ref]  # Restore user's original work
```
- Ensures user's uncommitted work is restored
- Uses `stash pop` (removes stash after applying)

#### Phase 4: Cleanup (On Task Success)

After successful task completion, `cleanupCheckpoint()` is called:

**Branch cleanup**:
```bash
git branch -D [checkpoint-branch]
```
- Deletes the checkpoint branch (no longer needed)
- Task changes persist in commits on current branch

**Stash cleanup** (safe pop with conflict handling):
```bash
git stash pop [stash-ref]  # Attempt to restore user's work
```
- **SUCCESS**: Stash popped cleanly, user's work is restored on top of task commits
- **CONFLICT**: Merge conflict between task's commits and user's stashed changes
  - Error caught, logged, stash **left in place**
  - No automatic drop — user manually resolves
  - See "Conflict Resolution" section below

### Conflict Scenario: When Stash Pop Fails

#### Why Conflicts Happen

A merge conflict occurs when:
1. Task commits modified the same lines as user's stashed changes
2. Git cannot automatically determine which version to keep
3. Example:
   ```
   User's stashed work:    Adds feature X to function foo()
   Task's commits:         Refactors foo() to use new pattern
   Result:                 Merge conflict in foo()
   ```

#### Behavior on Conflict

When `git stash pop` fails:

1. **Conflict state left in working tree**:
   - Files with conflicts marked with `<<<<<<<`, `=======`, `>>>>>>>`
   - User must resolve manually
2. **Stash preserved** (NOT dropped):
   - Original stash remains in stash list
   - Can be inspected with `git stash show -p [stash-ref]`
3. **Log message**:
   ```
   [Git] Stash pop had conflicts — leaving stash in place for manual resolution
   ```

#### Resolution Steps for Users

If you see the warning above, follow these steps:

**Step 1: Examine conflicts**
```bash
git status
# Shows: "both added", "both modified" etc. in conflict files
```

**Step 2: Review changes**
```bash
# See what the stash wanted to add
git stash show -p

# See what the task committed
git diff HEAD~[N]  # where N is number of task commits
```

**Step 3: Resolve conflicts**
- Edit conflicted files
- Remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- Keep whichever version makes sense (often both)
- Example resolution:
  ```javascript
  // BEFORE (conflicted)
  <<<<<<< HEAD
  function foo(x) {
    return x * 2;  // Task's new implementation
  }
  =======
  function foo(x) {
    return newPattern(x);  // User's stashed change
  }
  >>>>>>>

  // AFTER (resolved)
  function foo(x) {
    return newPattern(x * 2);  // Combined approach
  }
  ```

**Step 4: Complete the merge**
```bash
git add [resolved-files]
git commit -m "Resolve stash conflicts after task completion"
```

**Step 5: Drop the stash** (optional, for cleanup)
```bash
# After conflicts are resolved and committed, you can drop the stash
git stash drop [stash-ref]

# Or drop by name
git stash drop "stash@{0}"
```

### Data Protection Guarantees

| Scenario | Checkpoint Type | Outcome | Data Loss Risk |
|----------|-----------------|---------|-----------------|
| Task succeeds, clean pop | Stash | User work restored on top of commits | ✅ None |
| Task succeeds, conflict | Stash | Stash left in place, user resolves | ✅ None (manual required) |
| Task fails | Any | Rollback to checkpoint, user work preserved | ✅ None |
| Server crash during task | Any | Checkpoint in DB, recovered on restart | ✅ None |

### Implementation Details

**Code location**: `src/server/services/git.ts`

**Key functions**:
- `createCheckpoint(projectPath, taskId)` — Lines 72-104
- `rollbackCheckpoint(projectPath, checkpointRef, checkpointType)` — Lines 109-151
- `cleanupCheckpoint(projectPath, checkpointRef, checkpointType)` — Lines 224-266

**Critical design decision** (resolved 2026-03-04):
- **Question**: Should we use `stash drop` or `stash pop` on success?
- **Answer**: Use `stash pop` with try/catch
  - Reason: Pop restores user's work, drop discards it
  - Conflicts are caught and left for manual resolution
  - Prevents silent data loss from conflicting changes

### Monitoring & Debugging

**Check checkpoint status**:
```bash
# See all stashes (including checkpoints)
git stash list | grep "han checkpoint"

# Show what's in a stash
git stash show -p "stash@{0}"

# See checkpoint branches
git branch | grep "han/checkpoint"
```

**Inspect task checkpoint in database**:
```sql
SELECT id, title, checkpoint_ref, checkpoint_type, status
FROM tasks
WHERE project_path = '/path/to/project'
ORDER BY created_at DESC
LIMIT 5;
```

### Robin Hood Protocol: Mutual Health Monitoring (Complete — All 6 Phases)

**Purpose**: Leo and Jim monitor each other's health with three-tier alerting: normal operation, degraded performance (distress), and complete failure (resurrection).

**Health signals** (`~/.han/health/`):
- `leo-health.json` — Written by Leo every beat (agent, pid, timestamp, beat, beatType, status, lastError, uptimeMinutes)
- `jim-health.json` — Written by Jim every cycle (agent, pid, timestamp, cycle, tier, status, lastError, serverPid, uptimeMinutes)
- `resurrection-log.jsonl` — Shared log of all resurrection attempts from both agents
- `leo-distress.json` — Written by Leo when beat interval exceeds 2× expected max (Phase 5)
- `jim-distress.json` — Written by Jim when cycle duration exceeds 3× median (Phase 5)

**Leo's health monitoring** (`leo-heartbeat.ts`):
- `checkJimHealth()` called at start of every beat
- Staleness thresholds: <40min OK, 40-90min stale (PID check), >90min down
- Resurrection: `systemctl --user restart han-server.service`
- 12s verification wait (increased from 3s to allow full Node.js/tsx server startup), 1-hour cooldown, ntfy escalation on failure

**Jim's health monitoring** (`supervisor.ts`):
- `checkLeoHealth()` called at start of every supervisor cycle
- Staleness thresholds: <45min OK, 45-90min stale (PID check), >90min down
- Resurrection: `systemctl --user restart leo-heartbeat.service`
- 10s verification wait, 1-hour cooldown, ntfy escalation on failure

**Distress signal detection** (Phase 5 — early warning):
- **Jim's slow cycle detection**: Tracks last 50 cycle durations, triggers distress if actual > 3× median
  - Example: 15min median → 45min+ triggers distress
  - ntfy notification + distress file written + Admin UI yellow banner
- **Leo's slow beat detection**: Phase-aware expected intervals, triggers distress if actual > 2× max
  - Example: v0.5 phase (30min max) → 60min+ triggers distress
  - ntfy notification + distress file written + Admin UI yellow banner
- Distress clears automatically when next cycle/beat completes within normal bounds

**Split-brain prevention**:
- PID-alive check via `kill -0` before resurrection attempt
- Cooldown enforcement (shared resurrection log)
- Staggered checks (Leo checks at beat start, Jim checks at cycle start)

**systemd units** (`~/.config/systemd/user/`):
- `han-server.service` — Supervisor + server (resurrected by Leo)
- `leo-heartbeat.service` — Leo's heartbeat (resurrected by Jim)

### Jemma: Discord Message Dispatcher (Complete)

**Purpose**: Route Discord messages to the appropriate agent (Jim/Leo/Darron) using AI classification, and deliver agent responses back to Discord.

**Architecture**:
- **Gateway integration**: Raw WebSocket connection to Discord Gateway API (not discord.js)
- **Message flow**: Discord → Jemma (classify) → Conversation thread → Jim/Leo → Discord
- **Classification**: Ollama local models or Claude Haiku API classify messages by channel, mentions, and content

**Message Classification** (`jemma.ts:buildClassificationPrompt`):
- **Channel name injection**: Reverses config.json channel map to show `#general (123456)` instead of bare ID
- **Username mapping**: Uses `config.discord.username_map` to show `Darron (@fallior)` for better context
- **Prompt includes**: Message content, enriched author display, enriched channel display
- **Classification result**: `{ recipient: 'jim|leo|darron|sevn|six|ignore', confidence: 0-1, reasoning: '...' }`

**Message delivery**:
- **Inbound**: Messages inserted into conversation threads with `role='human'` (changed from 'discord' for Jim visibility)
- **Outbound**: Jim's supervisor respond_conversation action posts back to Discord via webhooks
- **Channel name resolution** (`jemma.ts:resolveChannelName`): Extracted from classification prompt into reusable function — inverts `config.discord.channels` map from `{name: id}` to `{id: name}`, returns resolved name or falls back to original ID
- **Delivery pipeline** (`jemma.ts:routeMessage`): Resolves channel name once at routing layer, threads through all six delivery functions (`deliverToJim`, `deliverToLeo`, `deliverToDarron`, `deliverToSevn`, `deliverToSix`)
- **Enhanced logging**: All delivery functions log with format `#channelName — username: message...` for improved observability
- **Signal file metadata**: jim-wake and leo-wake signal files include explicit `recipient` and `channelName` fields for self-documenting payloads
- **Discord utilities** (`services/discord-utils.ts`):
  - `postToDiscord()`: Webhook posting with 2000-char splitting and exponential backoff retry (1s → 2s → 4s)
  - `resolveChannelName()`: Reverses channel ID to name using config (NOTE: This reference is outdated — function moved to jemma.ts)
  - `loadDiscordConfig()`: Reads ~/.han/config.json

**Supervisor integration** (`supervisor-worker.ts`):
- `respond_conversation` handler checks if `discussion_type === 'discord'`
- Extracts channel ID from conversation title: `"Discord: {author} in #{channelId}"`
- Resolves channel ID to name via `resolveChannelName()` (guards against unknown channels)
- Posts Jim's response to Discord via `postToDiscord()` (non-blocking, message already saved to DB)

**Admin UI dispatch resilience** (`routes/conversations.ts`):
- Primary path: Jemma's admin WebSocket client listens for conversation_message broadcasts, classifies, writes signals
- Fallback path: After storing human message, conversations route writes jim-wake signal directly to filesystem
- Prevents 20-minute wait when Jemma's WebSocket is down
- Does NOT call `runSupervisorCycle()` directly (that caused over-responding) — just writes signal file
- Signal contains: conversationId, messageId, timestamp, reason 'human_message_fallback'

**Health monitoring**: Writes `jemma-health.json` with `{ agent: 'jemma', timestamp, status, lastError }` (uses `timestamp` field for Robin Hood Protocol compatibility). Health file updated on:
- Startup (`main()`)
- WebSocket READY event
- MESSAGE_CREATE event (after message processing)
- Reconciliation completion (every 5 minutes, prevents staleness during quiet periods)
- WebSocket error/close handlers
- Graceful shutdown

Max health file age during normal operation: ~5 minutes (reconciliation interval)

### Jim's Supervisor Cycle Protection

**Purpose**: Prevent overlapping supervisor cycles that would corrupt DB state and waste API tokens.

**Problem**: Jim's wake signal pattern (fs.watch on jim-wake signal) can trigger while a scheduled 20-minute cycle is already running, causing:
- Competing Agent SDK subprocesses
- Corrupted conversation/goal/task state (both cycles writing to same tables)
- Wasted API costs (duplicate work)

**Solution** (`services/supervisor.ts`):
- **cycleInProgress flag**: Boolean guard checked at start of `runSupervisorCycle()`
- **Early exit**: Returns null immediately if cycle already in progress
- **2-hour timeout**: Safety net clears flag if cycle hangs (generous since Agent SDK cycles can run very long)
- **Flag lifecycle**:
  - Set true when sending run_cycle message to worker
  - Cleared on cycle completion (success or failure)
  - Cleared on timeout

**Code locations**:
- `supervisor.ts:40` — Flag declaration
- `supervisor.ts:910-913` — Guard check with early return
- `supervisor.ts:925,933,951` — Flag set/clear logic

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
- **Bearer token authentication**: `/api/*` and `/admin` routes require valid token for non-localhost requests
- **Localhost bypass**: Internal agents (Leo, Jim, Jemma) communicate via 127.0.0.1 without authentication
- **WebSocket authentication**: Non-localhost WebSocket connections require token via query param or header
- **Local network only**: Server doesn't expose to public internet
- **Input sanitisation**: Response text escaped before tmux injection
- **No credential storage**: ntfy.sh topic is environment variable
- **Command injection protection**: All shell commands use `execFileSync` for untrusted input (see DEC-032)

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| NTFY_TOPIC | No | ntfy.sh topic for push notifications |
| PORT | No | Server port (default: 3847) |
| HAN_DIR | No | State directory (default: ~/.han) |

### Config Files

- `~/.claude/settings.json` — Claude Code hook configuration
- `~/.han/` — State and history storage

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
- **Impact**: Projects with long session protocols (han, hodgic) now get full instructions instead of 0 useful content

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
