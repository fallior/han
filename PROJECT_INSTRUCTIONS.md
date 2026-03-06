# Hortus Arbor Nostra — Project Instructions

> Unblock your Claude Code sessions from anywhere via push notifications and mobile response interface

## What We're Building

When developing with Claude Code, there are often large gaps between interactions — you step away for breakfast, grab a coffee, or switch to another task. But when Claude needs your input, development blocks until you return to your desk.

Hortus Arbor Nostra solves this by creating a bridge between your development machine and your mobile device. It hooks into Claude Code's notification system, pushes alerts to your phone, and lets you respond remotely — whether that's a simple Y/n confirmation or a custom text response.

The project is structured as progressive "levels" — from a simple MVP that unblocks prompts, all the way to a full terminal mirror with bidirectional claude.ai ↔ Claude Code integration. This lets us ship useful functionality quickly while building toward the ambitious vision of true mobile development.

## Core Principles

1. **Progressive Enhancement** — Each level builds on the previous. Ship useful functionality early, iterate toward the vision.
2. **Leverage Existing Systems** — Claude Code already has hooks; tmux already handles sessions. We extend, not reinvent.
3. **Security by Design** — Remote terminal access is sensitive. Tailscale encryption, device pairing, and careful input handling from day one.
4. **Energy Conscious** — Mobile apps drain batteries. Background mode must be lightweight; push to wake, not constant polling.
5. **Persistent History** — Unlike Claude Code's compaction, we keep the full terminal buffer. This becomes the foundation for the claude.ai bridge.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Node.js (server), Bash (hooks/scripts) |
| Framework | Express.js (minimal, sufficient) |
| Session Management | tmux |
| Push Notifications | ntfy.sh (free, self-hostable) |
| Remote Access | Tailscale (WireGuard VPN) |
| Storage | SQLite + plain text (Level 4+) |
| Mobile UI | Progressive Web App (HTML/JS initially) |

## Architecture Overview

Claude Code fires notification hooks when waiting for input. Our hook script captures the context, saves state, and sends a push via ntfy.sh. The Express server serves a mobile-friendly UI where you can view prompts and respond. Responses are injected back to Claude Code via `tmux send-keys`.

**Key Components:**
- **Hook Script** (`notify.sh`) — Triggered by Claude Code, saves state, sends push
- **CLI Launcher** (`han`) — Starts Claude Code in tmux with session management  
- **Express Server** (`server.js`) — API for prompts/responses, serves web UI
- **Web UI** (`index.html`) — Mobile-friendly interface with quick actions
- **Installer** (`install.sh`) — Sets up hooks, directories, and configuration

## Implementation Levels

| Level | Name | Focus | Status |
|-------|------|-------|--------|
| 1 | Prompt Responder | MVP — Polling, Y/n responses via web | 🟡 Prototype Complete |
| 2 | Push Alerts | Real-time notifications when prompts arrive | ⚪ Not Started |
| 3 | Context Window | See recent terminal history with prompts | ⚪ Not Started |
| 4 | Terminal Mirror | Full read-only terminal view, persistent buffer | ⚪ Not Started |
| 5 | Interactive Terminal | Full bidirectional terminal interaction | ⚪ Not Started |
| 6 | Claude Bridge | Two-way claude.ai ↔ Claude Code transport | ⚪ Not Started |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Project Structure

```
han/
├── CLAUDE.md                 # Quick reference for Claude Code
├── PROJECT_INSTRUCTIONS.md   # This file (for Claude Projects)
├── QUICKSTART.md             # Installation and usage guide
├── claude-context/           # Collaboration context
│   ├── PROJECT_BRIEF.md      # Detailed vision
│   ├── CURRENT_STATUS.md     # Progress tracking
│   ├── ARCHITECTURE.md       # System design (detailed)
│   ├── DECISIONS.md          # ADR log
│   ├── LEVELS.md             # Level breakdown with features
│   ├── session-notes/
│   └── learnings/
├── scripts/
│   ├── install.sh            # Installation script
│   ├── start-server.sh       # Quick start the server
│   └── han                   # CLI launcher
└── src/
    ├── hooks/
    │   └── notify.sh         # Claude Code notification hook
    ├── server/
    │   ├── server.js         # Express API server
    │   └── package.json
    └── ui/
        └── index.html        # Mobile web interface
```

## Key Context Files

When working on this project:
- **CURRENT_STATUS.md** — Check every session for progress and next actions
- **ARCHITECTURE.md** — Detailed system design including diagrams for each level
- **DECISIONS.md** — Six ADRs already documented covering hooks, tmux, ntfy.sh, Tailscale
- **LEVELS.md** — Detailed breakdown of each level with features and success criteria

## Key Decisions Made

| ID | Decision | Choice |
|----|----------|--------|
| DEC-001 | Event source | Claude Code hooks (built-in notification system) |
| DEC-002 | Session management | tmux (enables input injection and mirroring) |
| DEC-003 | Push notifications | ntfy.sh (simple, free, self-hostable) |
| DEC-004 | Remote access | Tailscale (zero-config VPN) |
| DEC-005 | Polling interval | 15 seconds (before push notifications) |
| DEC-006 | Storage format | SQLite + plain text (Level 4+) |

## Conventions

- **British English** spelling (colour, organisation, centre)
- **Semantic commits**: feat:, fix:, docs:, refactor:
- Comments explaining non-obvious decisions
- Session notes: `YYYY-MM-DD-author-topic.md`

## Current Focus

**Level 1 Prototype** is complete and ready for testing:
1. Install with `./scripts/install.sh`
2. Configure ntfy topic: `export NTFY_TOPIC="your-secret-topic"`
3. Start server: `./scripts/start-server.sh`
4. Start Claude Code: `han`
5. Test the flow end-to-end

**Next milestone**: Refine Level 1 based on real usage, then move to Level 2 (push notifications).

## The Vision

Level 6 represents the ultimate goal:

> "All the discussions we've had and we simply export to our Claude Code terminal and develop. We could effectively develop an entire project on our mobile phone."

This bridge between claude.ai and Claude Code would enable true mobile development — plan and discuss on your phone, execute on your workstation, seamlessly.

## Author

**Darron** — Creator, based in Perth, Australia.

---

*Unblock your development from anywhere — one level at a time.*
