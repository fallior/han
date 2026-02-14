# Claude Remote

> Unblock your Claude Code sessions from anywhere

## Session Protocol

**IMPORTANT:** When `session start` is triggered, Claude MUST:
1. Run `pwd` to verify the current working directory
2. Confirm this is `/Users/darron/Projects/clauderemote`
3. Load THIS project's `claude-context/CURRENT_STATUS.md`
4. IGNORE conversation history from other projects

The working directory is the source of truth — not conversation history.


## Activity Timestamp Protocol

**CRITICAL for accurate time tracking:** Claude MUST log timestamps throughout the session.

### Required Actions
1. **Session Start**: Run `date -Iseconds`, create session log in `_logs/` with Start timestamp
2. **Each Exchange**: Log timestamp before processing user input, log timestamp after response
3. **Session End**: Run `date -Iseconds`, calculate Duration and Active Time (excluding gaps > 5 min)

### Why This Matters
- Idle gaps (> 5 min between response and next input) are excluded from Active Time
- Dashboard analytics use these timestamps for accurate time tracking
- Without timestamps, session duration is guessed from file metadata (inaccurate)

See `_logs/README.md` for full timestamp protocol and format.

## Command Triggers

When the user types these phrases, execute the corresponding workflow from `claude-context/CLAUDE_CODE_PROMPTS.md`:

| User Says | Execute |
|-----------|---------|
| `session start` | **Session Start** — Create session log with timestamp, verify `pwd`, check status |
| `session end` | **Session End** — Finalise timestamps, calculate active time, update docs |
| `update docs` | **Update Docs** — Update all documentation with session changes |
| `incorporate notes` | **Incorporate Notes** — Review notes/todos for incorporation into IDEAS.md or CURRENT_STATUS.md |
| `create init scripts` | **Create Dev Scripts** — Generate init.sh/stop.sh with infrastructure registry ports |
| `context refresh` | **Context Refresh** — Get briefed after time away from project |
| `record decision` | **Decision Recording** — Draft a decision record for DECISIONS.md |
| `update architecture` | **Architecture Update** — Update ARCHITECTURE.md with system changes |
| `create learning` | **Create Learning** — Document a solved problem in learnings/ |
| `health check` | **Project Health Check** — Verify docs are accurate and in sync |
| `sync check` | **Sync Check** — Verify git and context are in sync before working |
| `generate instructions` | **Generate PROJECT_INSTRUCTIONS.md** — Create condensed context for Claude Projects |
| `onboard contributor` | **Onboard New Contributor** — Generate 10-minute project briefing |


## Critical Learnings

Review these cross-project learnings when relevant:

| ID | Learning | Why It Matters |
|----|----------|----------------|
| L008 | [javascript/date-timezone-gotchas.md](~/Projects/_learnings/javascript/date-timezone-gotchas.md) | Avoid UTC conversion bugs with `toISOString()`. Use local date components. |
| L012 | [claude-agent-sdk/nested-session-env-var.md](~/Projects/_learnings/claude-agent-sdk/nested-session-env-var.md) | Agent SDK exit code 1 — remove `CLAUDECODE` env var for nested execution. |

See `~/Projects/_learnings/INDEX.md` for full index.

## Quick Context

- **Stage**: Levels 1-7 Complete
- **Stack**: Node.js + Express + SQLite + Agent SDK + tmux + ntfy.sh + WebSocket
- **Status**: Active development

## What This Is

Claude Remote lets you respond to Claude Code prompts from your phone. When Claude needs your input (permission approval, Y/n question, or any prompt), you get a push notification and can respond via a mobile web UI — no need to rush back to your desk.

## Key Commands

```bash
# Start Claude Code in managed tmux session
claude-remote

# Start the server (in another terminal)
./scripts/start-server.sh

# Or with npm
cd src/server && npm start

# List active sessions
claude-remote --list

# Attach to existing session
claude-remote --attach

# Check status
claude-remote --status
```

## Project Structure

```
claude-remote/
├── src/
│   ├── hooks/notify.sh    # Claude Code notification hook
│   ├── server/server.js   # Express API server
│   └── ui/index.html      # Mobile web interface
├── scripts/
│   ├── install.sh         # Setup everything
│   ├── start-server.sh    # Quick start server
│   └── claude-remote      # CLI launcher
├── claude-context/        # AI collaboration context
└── docs/                  # Architecture and design
```

## Current Focus

Check `claude-context/CURRENT_STATUS.md` for:
- Current level and recent changes
- Next actions and blockers
- Session notes from recent work

## Implementation Levels

| Level | Focus | Status |
|-------|-------|--------|
| 1 | Prompt Responder (MVP) | 🟢 Complete |
| 2 | Push Alerts | 🟢 Complete |
| 3 | Context Window | 🟢 Complete |
| 4 | Terminal Mirror (xterm.js) | 🟢 Complete |
| 5 | Mobile Keyboard | 🟢 Complete |
| 6 | Claude Bridge | 🟢 Complete |
| 7 | Autonomous Task Runner | 🟢 Complete |

**Extended Vision (Levels 8-11):** See [`ROADMAP.md`](ROADMAP.md) for the full progression from autonomous task runner to development platform, including approval gates, cost dashboards, and hybrid orchestration architecture.

## Conventions

- **British English** spelling
- **Semantic commits**: feat:, fix:, docs:, refactor:
- **Session notes**: YYYY-MM-DD-author-topic.md

## Context Files

| File | Purpose |
|------|---------|
| `ROADMAP.md` | Extended vision (Levels 1-11) and future direction |
| `PROJECT_BRIEF.md` | Full vision and goals |
| `CURRENT_STATUS.md` | Progress tracking |
| `ARCHITECTURE.md` | System design |
| `DECISIONS.md` | Decision log |
| `LEVELS.md` | Level breakdown |

## Infrastructure Registry

This project is registered in the central infrastructure service registry at `~/Projects/infrastructure/`.

```bash
# Check all service status
~/Projects/infrastructure/scripts/status

# View this project's port allocation
~/Projects/infrastructure/scripts/lifecycle clauderemote ports

# Start this project's services
~/Projects/infrastructure/scripts/start clauderemote
```

Port allocations are managed centrally. See `~/Projects/infrastructure/registry/services.toml` for details.

## Author

**Darron** — Mackay, Queensland, Australia (UTC+10)

---

*Check CURRENT_STATUS.md before starting work.*
