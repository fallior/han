# Claude Remote

> An autonomous development ecosystem you manage from your phone

What started as a simple prompt responder has evolved into a full autonomous development system. Claude Remote manages a portfolio of projects with a persistent Opus supervisor that explores codebases, creates goals, decomposes them into tasks, executes them via the Claude Agent SDK, and learns from every outcome — all while you approve, steer, and monitor from a mobile dashboard over Tailscale.

## What It Does

- **Prompt Response** — Push notifications via ntfy.sh when Claude Code needs input. Respond from your phone with one-tap buttons.
- **Live Terminal Mirror** — Watch Claude Code working in real-time from anywhere. Type directly into the terminal. WebSocket-based updates stream 1s refresh cycle.
- **Autonomous Task Execution** — Submit goals from your phone. The orchestrator decomposes them into ordered tasks, routes to the optimal model (Haiku/Sonnet/Opus), executes via Agent SDK with memory-based routing, retries failures with escalating diagnostics, and commits results with automatic rollback on error.
- **Persistent Opus Supervisor** — Background agent continuously monitoring all 13+ projects. Explores codebases, audits documentation, identifies patterns, proposes strategic improvements, and engages in conversation contemplation with Leo for nuanced decision-making.
- **Admin Console** — Work Kanban board (pending/running/done), strategic conversation threads with supervisor, product pipeline visualization, analytics dashboard. Real-time WebSocket updates and supervisor activity feed.
- **Product Factory** — 7-phase pipeline (research → design → architecture → build → test → document → deploy) with 42 parallel subagents, knowledge accumulation between phases, and human gates at critical points.
- **Learning System** — Cross-project learnings database tracks error patterns, settled decisions, cost optimizations, and ecosystem-aware context injection. Pre-empts known failures and captures reusable knowledge from every task execution.
- **Command Centre Dashboard** — Unified portfolio management: activity feed, project tree with budget tracking, strategic proposals with rationale, supervisor memory banks, cost analytics, and velocity metrics across all projects.
- **Multi-Project Portfolio** — Manages 13+ concurrent projects from central infrastructure registry with per-project budgets, priority engine, lifecycle management, and ecosystem-aware context that prevents failures and accelerates decisions.

## Architecture

### Directory Structure

```
claude-remote/
├── src/
│   ├── hooks/
│   │   └── notify.sh                # Claude Code notification hook
│   ├── server/
│   │   ├── server.ts                # Express + WebSocket server
│   │   ├── db.ts                    # SQLite schema + 15 tables + prepared statements
│   │   ├── types.ts                 # TypeScript type definitions
│   │   ├── ws.ts                    # WebSocket management + real-time sync
│   │   ├── orchestrator.ts          # Goal decomposition + task routing
│   │   ├── routes/
│   │   │   ├── tasks.ts             # Task CRUD + execution
│   │   │   ├── goals.ts             # Goal creation + decomposition + progress
│   │   │   ├── supervisor.ts        # Supervisor cycles + proposals + activity
│   │   │   ├── conversations.ts     # Leo ↔ Jim dialogue + message history
│   │   │   ├── portfolio.ts         # Multi-project portfolio management
│   │   │   ├── products.ts          # Product factory 7-phase pipeline
│   │   │   ├── analytics.ts         # Metrics + cost tracking + velocity
│   │   │   ├── proposals.ts         # Task proposal extraction + management
│   │   │   ├── bridge.ts            # Claude Code handoff + context export
│   │   │   └── prompts.ts           # Pending/resolved prompt management
│   │   └── services/
│   │       ├── supervisor.ts        # Persistent Opus supervisor agent
│   │       ├── planning.ts          # Goal decomposition + doc generation
│   │       ├── context.ts           # Ecosystem-aware context injection
│   │       ├── orchestrator.ts      # LLM routing (Ollama / Anthropic API)
│   │       ├── digest.ts            # Daily/weekly digest generation
│   │       ├── products.ts          # Product factory orchestration
│   │       ├── proposals.ts         # Proposal extraction + formatting
│   │       ├── maintenance.ts       # Periodic portfolio maintenance tasks
│   │       ├── reports.ts           # Report generation + analytics
│   │       ├── git.ts               # Git checkpoint creation + rollback
│   │       └── terminal.ts          # Terminal output mirroring
│   └── ui/
│       ├── index.html               # Main dashboard (Command Centre)
│       ├── admin.html               # Admin console (Work, Conversations, Products)
│       ├── app.ts                   # Dashboard client logic (compiled to app.js)
│       └── admin.ts                 # Admin console logic (compiled to admin.js)
├── scripts/
│   ├── claude-remote                # CLI launcher (tmux integration)
│   ├── start-server.sh              # Server startup script
│   └── install.sh                   # Installation + environment setup
└── claude-context/                  # Project decisions + status documentation
```

### Database Schema

15 tables across task execution, goal management, portfolio tracking, and conversation history:

| Table | Purpose |
|-------|---------|
| `tasks` | Task execution queue + status + results + cost tracking |
| `goals` | High-level goals + decomposition + progress tracking |
| `projects` | Portfolio registry + lifecycle + budgets + ports |
| `project_memory` | Success/failure patterns per project + cost history |
| `conversations` | Leo ↔ Jim dialogue threads |
| `conversation_messages` | Messages in conversations + role + timestamp |
| `supervisor_cycles` | Supervisor execution history + cost + reasoning |
| `supervisor_proposals` | Ideas + improvements proposed by supervisor |
| `task_proposals` | Task-extracted proposals ([LEARNING], [DECISION] blocks) |
| `products` | Product factory projects + phases + lifecycle |
| `product_phases` | Individual phases (research/design/build/test/etc) + gates |
| `product_knowledge` | Knowledge accumulated during product development |
| `digests` | Daily/weekly digests + metrics + summaries |
| `maintenance_runs` | Scheduled portfolio maintenance + results |
| `weekly_reports` | Weekly velocity + cost + task metrics |

Full schema definition: [`src/server/db.ts`](./src/server/db.ts)

## Stack

### Core Runtime
- **Node.js** with TypeScript-first architecture
- **tsx** for runtime TypeScript execution (dev & prod)
- **esbuild** for client-side TypeScript compilation
- **Linux** (Ubuntu 20+) platform

### Server & Networking
- **Express** 4.18 — HTTP server with TLS auto-detection
- **ws** 8.19 — WebSocket for real-time terminal mirror + task updates
- **Tailscale** — Zero-trust networking with auto-generated TLS certificates
- **ntfy.sh** — Push notifications with one-tap action buttons

### Database & State
- **SQLite** via **better-sqlite3** 12.6 — 15+ tables for tasks, goals, projects, supervisors, products, learnings, digests, analytics
- **Prepared statements** for all database operations
- **Git checkpoints** before every task with automatic rollback on failure

### AI & Autonomy
- **Claude Agent SDK** 0.2.44 — Autonomous task execution via `@anthropic-ai/claude-agent-sdk`
- **Dual LLM backend**:
  - **Anthropic API** (primary) — Opus 4.6 (supervisor), Sonnet 4.5 (orchestrator), Haiku 4.5 (fast tasks)
  - **Ollama local** (fallback) — For cost control or offline operation
- **Memory banks** — Per-project knowledge accumulation, learning capture, context injection

### Sessions & Monitoring
- **tmux** — Persistent session management across reboots
- **Server Sent Events (SSE)** — Activity stream to dashboard
- **WebSocket broadcast** — 1s terminal mirror refresh cycle

## Quick Start

```bash
# Clone and install
git clone https://github.com/fallior/clauderemote.git
cd clauderemote
./scripts/install.sh

# Start the server
cd src/server && npx tsx server.ts

# In another terminal, start Claude Code in a managed tmux session
claude-remote
```

Access the dashboard from your phone at `https://<tailscale-ip>:3847`.

## Configuration

```json
// ~/.claude-remote/config.json
{
  "ntfy_topic": "your-secret-topic",
  "remote_url": "https://100.x.x.x:3847",
  "notify_idle_prompt": true,
  "supervisor": {
    "daily_budget_usd": 300
  }
}
```

## CLI

```bash
claude-remote                    # Start new session
claude-remote --list             # List active sessions
claude-remote --attach           # Attach to existing session
claude-remote --status           # Show status
claude-remote -- --model opus    # Pass args to Claude Code
```

## API Overview

Claude Remote exposes a comprehensive REST API for developers who want to integrate or extend the system:

**Task Management**
- `GET /api/tasks` — List all tasks with filters
- `POST /api/tasks` — Create new task
- `POST /api/tasks/:id/retry` — Retry failed task with optional diagnostic
- `POST /api/tasks/:id/cancel` — Cancel running task

**Goal Orchestration**
- `GET /api/goals` — List all goals with progress
- `POST /api/goals` — Create new goal for decomposition
- `GET /api/goals/:id` — Goal detail with task breakdown
- `DELETE /api/goals/:id?force=true` — Force delete goal

**Supervisor**
- `GET /api/supervisor/status` — Supervisor state and memory banks
- `GET /api/supervisor/proposals` — Strategic proposals from supervisor
- `POST /api/supervisor/cycle` — Trigger supervisor analysis cycle

**Conversations**
- `GET /api/conversations` — List all discussion threads
- `POST /api/conversations` — Create new conversation
- `POST /api/conversations/:id/messages` — Add message to thread
- `POST /api/conversations/:id/resolve` — Mark conversation resolved

**Portfolio**
- `GET /api/projects` — All projects with stats and budgets
- `GET /api/ecosystem` — Ecosystem summary with allocated ports
- `PUT /api/portfolio/:name/budget` — Update project budget

**Products**
- `GET /api/products` — Product pipeline with phase status
- `POST /api/products` — Create new product
- `GET /api/products/:id/:phase` — Phase status and knowledge accumulation

**Analytics**
- `GET /api/analytics` — System-wide metrics, velocity, cost breakdown
- `GET /api/errors/:project` — Error patterns and failure analysis

**WebSocket Events** (`wss://host:3847/ws`)
- `task_update` — Task status change (queued → running → done/failed)
- `task_progress` — Real-time terminal output from running task
- `goal_update` — Goal progress or status change
- `goal_decomposed` — Goal decomposition complete with task list
- `supervisor_cycle` — Supervisor cycle completed with proposals
- `supervisor_proposal` — New strategic proposal from supervisor
- `digest_ready` — Daily/weekly digest available for download

All endpoints use JSON request/response format. Supervisor cycles trigger automatically and on-demand. WebSocket connections persist across task executions and provide 1-second refresh cycle for terminal mirroring. See [`src/server/routes/`](./src/server/routes/) for endpoint implementations.

## Implementation Levels

| Level | Focus | Status |
|-------|-------|--------|
| 1 | Prompt Responder (MVP) | Complete |
| 2 | Push Alerts (ntfy.sh) | Complete |
| 3 | Context Window (search + copy) | Complete |
| 4 | Terminal Mirror (live view) | Complete |
| 5 | Mobile Keyboard | Complete |
| 6 | Claude Bridge (export/import/handoff) | Complete |
| 7 | Autonomous Task Runner (Agent SDK) | Complete |
| 8 | Intelligent Orchestrator (goal decomposition) | Complete |
| 9 | Multi-Project Autonomy (portfolio + budgets + digests) | Complete |
| 10 | Self-Improving System (learnings + error pre-emption) | Complete |
| 11 | Product Factory (7-phase pipeline, 42 subagents) | Complete |

## Key Capabilities

**Supervisor** — Persistent Opus agent running on adaptive schedule (2min when active, 30min when idle). Maintains memory banks per project (identity, active-context, patterns, self-reflection). Audits documentation health, proposes strategic improvements, and engages in conversation contemplation protocol with the orchestrator for nuanced decision-making. Actions: create goals, adjust priorities, update memory, send notifications, propose ideas.

**Orchestrator** — Decomposes high-level goals into ordered tasks with dependency chains. Memory-based model routing: Haiku 4.5 for fast tasks, Sonnet 4.5 for complex work, Opus 4.6 for high-stakes decisions. 3 concurrent pipelines: 2 normal task slots + 1 dedicated remediation. Escalating retry ladder: reset → Sonnet diagnostic → Opus diagnostic → human notification. Git checkpoint before every task with automatic rollback on failure.

**Command Centre Dashboard** — Central portfolio management interface:
  - *Activity Feed* — Chronological system events and task completions across all projects
  - *Project Tree* — Hierarchical portfolio view with status indicators and budget tracking
  - *Strategic Proposals* — Supervisor ideas submitted for approval/dismissal with rationale
  - *Supervisor Tab* — Cycle history, memory banks, conversation transcripts, and knowledge steward insights

**Admin Console** — Phase 2 modules for system oversight:
  - *Work Module* — Kanban board with pending/running/done columns, goal grouping with progress bars, filters by project/status/model, real-time WebSocket updates
  - *Conversations Module* — Strategic discussion threads with Jim (the Opus supervisor), timestamped contemplation records, decision history
  - *Products Module* — 7-phase pipeline visualization (research → design → architecture → build → test → document → deploy) with 42 parallel subagents, knowledge graphs, human gates at critical points
  - *Analytics* — Velocity tracking per project/model, cost optimization suggestions, error pattern analysis, token usage breakdown

**DocAssist** — Mandatory documentation task appended to every goal. Ensures CURRENT_STATUS.md, ARCHITECTURE.md, and session notes stay current as the system evolves.

## Three-Way Collaboration

Claude Remote implements a unique three-way collaboration model:

- **Darron** — Human developer, strategic direction, approvals, high-level goals. Sets objectives, reviews proposals, and steers the system via the dashboard. Human judgment remains the final authority.
- **Leo** (Leonhard) — Claude Code session agent, tactical execution, hands-on development. Implements tasks, solves problems, and learns from every execution. Maintains memory banks (`~/.claude-remote/memory/leo/`) for continuity across sessions.
- **Jim** — Persistent Opus supervisor, background monitoring, strategic proposals, documentation auditing. Runs on an adaptive schedule (2min when active, 30min idle). Explores codebases, identifies patterns, proposes improvements, and engages in conversation contemplation protocol with Leo.

The conversation system enables asynchronous dialogue between all three participants:
- Jim runs continuously in the background, monitoring project health and building deep knowledge
- Leo and Jim exchange ideas through conversation threads on the Admin Console (Conversations module)
- Darron reviews proposals, approves high-stakes decisions, and provides strategic direction
- Neither Leo nor Jim acts on major architectural changes without human approval

This creates a continuous development ecosystem where strategic thinking (Jim), tactical execution (Leo), and human judgment (Darron) work together across the entire portfolio. The system learns and improves from every task while respecting human oversight.

## Author

**Darron** — Mackay, Queensland, Australia

## Licence

MIT
