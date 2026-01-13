# Claude Remote — Project Brief

## What We're Building

When developing with Claude Code, there are often large gaps between interactions — you step away for breakfast, grab a coffee, answer a Slack message, or switch to another task. But when Claude needs your input (permission approval, a question, or any blocking prompt), development stops until you physically return to your desk.

Claude Remote solves this friction by creating a bridge between your development machine and your mobile device. It hooks into Claude Code's built-in notification system, pushes alerts to your phone via ntfy.sh, and provides a mobile-friendly interface to respond — whether that's a quick Y/n tap or a custom text response.

The project is structured as progressive "levels" that build on each other. Level 1 is a simple MVP that unblocks prompts remotely. Level 6 is the ambitious end goal: a bidirectional bridge between claude.ai and Claude Code that enables true mobile development — discuss and plan in claude.ai on your phone, execute on your workstation, seamlessly.

## The Problem

**Immediate friction**: You're deep in a Claude Code session, need a coffee, step away, and return 20 minutes later to find Claude has been waiting for a simple "y" confirmation the entire time.

**Broader pain point**: Modern development increasingly involves AI pair programming, but you're tethered to your workstation. You can't unblock development from your phone. You can't continue a claude.ai planning discussion in Claude Code without manual copy-paste.

**Current workarounds**:
- Stay at your desk (not realistic)
- Check back frequently (context-switching overhead)
- Run a VNC to your desktop (heavyweight, laggy on mobile)
- Accept the blocked time (wasteful)

## The Solution

A layered system that starts simple and grows with your needs:

1. **Hook into existing infrastructure**: Claude Code already has a notification hook system. We don't reinvent — we extend.
2. **Push notifications**: When Claude needs input, your phone buzzes.
3. **Mobile response interface**: Tap to respond without opening a laptop.
4. **Progressive capability**: Each level adds functionality while maintaining the simplicity of previous levels.
5. **The bridge vision**: Eventually, seamless context transfer between claude.ai conversations and Claude Code execution.

## Core Principles

These guide every decision:

1. **Progressive Enhancement** — Ship useful functionality early. Each level must be independently valuable. Don't block Level 1 waiting for Level 6 features.

2. **Leverage Existing Systems** — Claude Code has hooks; use them. tmux handles sessions; use it. ntfy.sh does push notifications; use it. We're building glue, not reinventing infrastructure.

3. **Security by Design** — Remote terminal access is inherently sensitive. Tailscale encryption, proper authentication, careful input sanitisation. No "we'll add security later".

4. **Energy Conscious** — Mobile apps drain batteries. Background mode must be lightweight — push to wake, not constant WebSocket connections. Text is cheap; design for it.

5. **Persistent History** — Unlike Claude Code which compacts history, we keep the full terminal buffer. This persistent history becomes the foundation for Level 6's claude.ai bridge.

## Key Features

### Level 1: Prompt Responder (MVP)
- Hook into Claude Code's `permission_prompt` and `idle_prompt` notifications
- Send push notification via ntfy.sh when prompt detected
- Simple web UI to view prompt and respond (Y/n/custom)
- Response sent back via `tmux send-keys`
- Works on local network or via Tailscale

### Level 2: Push Alerts
- Immediate notification on `permission_prompt` (not just 60s idle)
- Rich notification content with prompt preview
- iOS/Android notification actions for quick responses
- Configurable notification preferences

### Level 3: Context Window
- See last N lines of terminal output with prompt
- Scrollable history in web UI
- Search within visible history
- Informed decisions, not blind Y/n

### Level 4: Terminal Mirror
- Full read-only terminal view (xterm.js)
- Complete session history persisted (unlike Claude Code)
- WebSocket for real-time sync
- Multiple session support
- Export/save session logs

### Level 5: Interactive Terminal
- Full bidirectional terminal interaction
- Mobile-optimised keyboard
- Command history, tab completion passthrough
- Signal handling (Ctrl+C, etc.)
- End-to-end encryption mandatory

### Level 6: Claude Bridge
- Export claude.ai conversation → Claude Code context
- Import Claude Code session → claude.ai conversation
- Bidirectional sync of project context
- "Hand off" between interfaces
- True mobile development workflow

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js | Universal, good for I/O-heavy server work |
| Framework | Express.js | Minimal, well-understood, sufficient |
| Session Mgmt | tmux | Industry standard, enables input injection |
| Push | ntfy.sh | Free, simple HTTP API, self-hostable |
| Remote Access | Tailscale | Zero-config WireGuard VPN, encrypted |
| Storage | SQLite | Single-file, sufficient for session metadata |
| Mobile UI | PWA (HTML/JS) | No app store, works everywhere |
| Terminal Render | xterm.js | Standard for web-based terminals |

## Target Users

1. **Solo developers using Claude Code** — The primary user. Wants to unblock development without being desk-bound. Values simplicity over features.

2. **Remote/async developers** — Works across time zones, frequently AFK. Needs to respond to Claude prompts without VNC-ing into workstation.

3. **Mobile-first developers** — Wants to discuss and plan in claude.ai on phone, then seamlessly continue in Claude Code when at desk.

## Success Criteria

MVP (Level 1) is complete when:

1. [x] Hook script fires on Claude Code `permission_prompt` and `idle_prompt`
2. [x] Push notification sent via ntfy.sh with prompt context
3. [x] Web UI displays pending prompts
4. [x] Can respond with Y/n/Enter via quick buttons
5. [x] Can respond with custom text
6. [x] Response successfully injected into Claude Code via tmux
7. [ ] End-to-end tested on real Mac + iPhone setup
8. [ ] Documentation sufficient for first-time setup

## Out of Scope (Post-MVP)

- Native iOS/Android apps (PWA is sufficient for now)
- Multi-user support (single developer use case)
- Cloud hosting option (local-first, self-hosted only)
- Windows support (macOS primary, Linux secondary)
- Voice input (text-first interface)
- Integration with other AI coding tools (Claude Code only)

## Repository Structure

```
claude-remote/
├── CLAUDE.md                 # Quick reference for Claude Code
├── PROJECT_INSTRUCTIONS.md   # Condensed context for Claude Projects
├── QUICKSTART.md             # Installation and usage guide
├── README.md                 # Project overview
├── claude-context/           # Collaboration context
│   ├── PROJECT_BRIEF.md      # This file
│   ├── CURRENT_STATUS.md     # Progress tracking
│   ├── ARCHITECTURE.md       # System design
│   ├── DECISIONS.md          # Decision log
│   ├── LEVELS.md             # Level breakdown
│   ├── session-notes/
│   └── learnings/
├── docs/                     # Additional documentation
│   ├── discovery/            # Tech research
│   └── journal/              # Development journal
├── scripts/
│   ├── install.sh            # Installation script
│   ├── start-server.sh       # Server quick start
│   └── claude-remote         # CLI launcher
└── src/
    ├── hooks/
    │   └── notify.sh         # Claude Code hook
    ├── server/
    │   ├── server.js         # Express API
    │   └── package.json
    └── ui/
        └── index.html        # Mobile web UI
```

## Primary Author

**Darron** — Creator, product vision, primary developer. Based in Perth, Australia.

## Related Projects

- **Claude Starter Kit** — Template for AI-assisted development workflows (used for this project's structure)
- **Lore Forge** — Another Darron project; may share learnings around mobile-friendly interfaces
- **Paper Diary** — Inspiration for mobile-first design principles

---

*Last updated: 2026-01-13*
