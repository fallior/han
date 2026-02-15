# Level 4: Terminal Mirror -- Full Read-only Terminal View

> Status: Complete (Retrospective)

## Context
Seeing only the last few lines of context is not enough. Level 4 provides a full, always-on terminal mirror on your phone using xterm.js and WebSocket, so you can see everything Claude Code is doing in real time.

## What Was Built
- xterm.js terminal rendering in the mobile UI with full ANSI colour support
- WebSocket-based real-time sync: server captures tmux pane content every 1 second and broadcasts to all connected clients
- Content diffing on server side -- only broadcasts when terminal content has changed
- Append-only client-side buffer with overlap detection to preserve scrollback history
- Auto-trim at 5000 lines (trims to 2000) to keep the DOM bounded
- Manual trim button for user-controlled buffer management
- History stash/restore to preserve buffer when switching views
- No-session detection: shows placeholder when no tmux session is active
- Full scrollback capture via `tmux capture-pane -p -e -S -` for export

## Key Files
| File | Role |
|------|------|
| `src/server/server.js` | 1-second tmux capture interval, WebSocket broadcast logic |
| `src/ui/index.html` | xterm.js rendering, append-only buffer, auto-trim, scroll handling |

## Key Decisions
- **DEC-006**: SQLite + plain text hybrid for session metadata and terminal output storage
- **DEC-013** (Settled): Append-only buffer with client-side overlap detection -- alternatives (server-side diff, fixed pane view) were tried and produced worse mobile experiences (missing text, broken scrolling)
- **DEC-014** (Settled): User controls scroll position -- never force scroll; smart-scroll only within 50px of bottom; `overscroll-behavior: contain` prevents rubber-banding

## Verification
```bash
# Start session and server
claude-remote &
./scripts/start-server.sh

# Open mobile UI -- terminal view should show live tmux content
# Run commands in Claude Code session -- verify they appear in real time
# Scroll up in the terminal view -- verify scroll position is preserved
# Verify auto-trim: generate 5000+ lines and confirm DOM stays bounded

# Test no-session state
# Kill the tmux session -- verify UI shows "No active session" placeholder
```

---
*Retrospective plan -- documents what was built, not a forward-looking spec.*
