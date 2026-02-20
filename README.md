# Claude Remote

> An autonomous development ecosystem you manage from your phone

What started as a simple prompt responder has evolved into a full autonomous development system. Claude Remote manages a portfolio of projects with a persistent Opus supervisor that explores codebases, creates goals, decomposes them into tasks, executes them via the Claude Agent SDK, and learns from every outcome — all while you approve, steer, and monitor from a mobile dashboard over Tailscale.

## What It Does

- **Prompt Response** — Push notifications via ntfy.sh when Claude Code needs input. Respond from your phone with one-tap buttons.
- **Live Terminal Mirror** — Watch Claude Code working in real-time from anywhere. Type directly into the terminal from your phone.
- **Autonomous Task Execution** — Submit goals from your phone. The orchestrator decomposes them into tasks, routes to the right model (haiku/sonnet/opus), executes via Agent SDK, retries failures with escalation, and commits results.
- **Persistent Opus Supervisor** — A background Opus agent that continuously monitors all projects, explores codebases to build deep knowledge, creates documentation goals, and proposes strategic ideas for your approval.
- **Command Centre Dashboard** — Activity feed, project tree, strategic proposals, and supervisor insights. See what's happening across your entire portfolio at a glance.
- **Multi-Project Portfolio** — Manages 13+ projects from a central infrastructure registry. Per-project budgets, priority engine, ecosystem-aware context injection.
- **Product Factory** — 7-phase pipeline (research → design → architecture → build → test → document → deploy) with 42 parallel subagents and human gates at critical points.

## Architecture

```
claude-remote/
├── src/
│   ├── hooks/notify.sh              # Claude Code notification hook
│   ├── server/
│   │   ├── server.ts                # Express + WebSocket + Tailscale TLS
│   │   ├── db.ts                    # SQLite schema + prepared statements
│   │   ├── routes/                  # API route modules
│   │   │   ├── tasks.ts             # Task CRUD + execution
│   │   │   ├── goals.ts             # Goal decomposition + progress
│   │   │   ├── supervisor.ts        # Supervisor cycles + proposals + activity feed
│   │   │   ├── portfolio.ts         # Multi-project management
│   │   │   ├── products.ts          # Product factory pipeline
│   │   │   └── ...                  # Analytics, digests, reports, health
│   │   └── services/
│   │       ├── supervisor.ts        # Persistent Opus supervisor agent
│   │       ├── planning.ts          # Goal decomposition + DocAssist
│   │       ├── context.ts           # Ecosystem-aware task context injection
│   │       └── orchestrator.ts      # LLM routing (Ollama / Anthropic)
│   └── ui/
│       ├── index.html               # Mobile-first dashboard
│       └── app.ts                   # Client-side TypeScript
├── scripts/
│   ├── claude-remote                # CLI launcher (tmux integration)
│   ├── start-server.sh              # Server startup
│   └── install.sh                   # Installation
└── claude-context/                  # Project documentation + decisions
```

## Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **Server**: Express + WebSocket (ws)
- **Database**: SQLite (better-sqlite3)
- **AI**: Claude Agent SDK + Ollama local fallback
- **Networking**: Tailscale (auto-TLS), ntfy.sh (push notifications)
- **Sessions**: tmux
- **Platform**: Linux (Ubuntu)

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

**Supervisor** — Persistent Opus agent running on adaptive schedule (2min when active, 30min when idle). Maintains memory banks per project, audits documentation health, proposes strategic improvements. Actions: create goals, adjust priorities, update memory, send notifications, propose ideas.

**Orchestrator** — Decomposes high-level goals into ordered tasks with dependency chains. Routes to cheapest model with proven success rate. Escalating retry ladder: reset → Sonnet diagnostic → Opus diagnostic → human notification.

**3 Concurrent Pipelines** — 2 normal task slots + 1 dedicated remediation slot. Git checkpoint before every task with automatic rollback on failure.

**DocAssist** — Mandatory documentation task appended to every goal. Ensures CURRENT_STATUS.md, ARCHITECTURE.md, and session notes stay current as the system evolves.

**Command Centre** — Dashboard with 4 sub-tabs: Activity Feed (chronological events), Project Tree (portfolio hierarchy with status indicators), Strategic Proposals (approve/dismiss supervisor ideas), Supervisor (cycle history and memory).

## Author

**Darron** — Mackay, Queensland, Australia

## Licence

MIT
