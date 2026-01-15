# Claude Remote

> Unblock your Claude Code sessions from anywhere


## Command Triggers

When the user types these phrases, execute the corresponding workflow from `claude-context/CLAUDE_CODE_PROMPTS.md`:

| User Says | Execute |
|-----------|---------|
| `update docs` | **Update Docs** — Update all documentation with session changes |
| `session end` | **Session End** — Create session note and update status |
| `session start` | **Session Start** — Check status and get briefed |


## Quick Context

- **Stage**: Level 1 Prototype Complete
- **Stack**: Node.js + Express + tmux + ntfy.sh
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
| 1 | Prompt Responder (MVP) | 🟡 Prototype |
| 2 | Push Alerts | ⚪ Not Started |
| 3 | Context Window | ⚪ Not Started |
| 4 | Terminal Mirror | ⚪ Not Started |
| 5 | Interactive Terminal | ⚪ Not Started |
| 6 | Claude Bridge | ⚪ Not Started |

## Conventions

- **British English** spelling
- **Semantic commits**: feat:, fix:, docs:, refactor:
- **Session notes**: YYYY-MM-DD-author-topic.md

## Context Files

| File | Purpose |
|------|---------|
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

**Darron** — Perth, Australia

---

*Check CURRENT_STATUS.md before starting work.*
