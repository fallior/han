# Claude Remote — Architecture

> System design and technical reference

## Overview

Claude Remote bridges your development machine and mobile device, enabling remote responses to Claude Code prompts. It hooks into Claude Code's notification system, saves state to disk, sends push notifications, and provides a web UI for responding — with responses injected back via tmux.

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
│   └──────────────┘             └──────────────┘            └──────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack Details

### Runtime & Framework
- **Node.js**: Server runtime — universal, good for I/O-heavy work
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

### Storage (Level 4+)
- **SQLite**: Session metadata and history indexing
- **Plain text**: Terminal capture files (for grep/search)

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
│   └── claude-remote             # CLI launcher
└── src/
    ├── hooks/
    │   └── notify.sh             # Claude Code notification hook
    ├── server/
    │   ├── server.js             # Express API server
    │   └── package.json          # Server dependencies
    └── ui/
        └── index.html            # Mobile web interface
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
| WS | /ws | WebSocket push (prompts + terminal) |
| GET | / | Serve web UI |

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

### Level 6: Claude Bridge

- Browser extension component
- Message format translation
- Session export/import

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

*Last updated: 2026-02-10*
