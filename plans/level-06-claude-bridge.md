# Level 6: Claude Bridge -- Context Export/Import

> Status: Complete (Retrospective)

## Context
Discussions on claude.ai (from your phone) and Claude Code sessions (on your workstation) live in separate worlds. Level 6 bridges them, enabling context transfer in both directions so you can plan on claude.ai and execute with Claude Code seamlessly.

## What Was Built
- **Session export**: full terminal scrollback captured as markdown via `tmux capture-pane -S -`, auto-saved to `~/.claude-remote/bridge/contexts/`
- **Context import**: paste text from claude.ai into the bridge UI, saved as a context file, optionally injected into the active Claude Code session via tmux
- **Structured handoff**: form with task description, context, and working directory fields -- combined into a markdown file and injected as a prompt into Claude Code
- **Context file management**: list, view, and delete saved context files via API
- **Bridge event history**: timeline of all import/export/handoff events stored in `history.json`
- **Bridge UI tab**: accessible from the mobile interface with export, import, handoff, and history views
- No browser extension required -- designed for iPhone as the primary client

## Key Files
| File | Role |
|------|------|
| `src/server/server.js` | Bridge API endpoints (`/api/bridge/*`) |
| `src/ui/index.html` | Bridge tab UI (export, import, handoff, history views) |
| `~/.claude-remote/bridge/contexts/` | Stored context files (exports, imports, handoffs) |
| `~/.claude-remote/bridge/history.json` | Bridge event timeline |

## Key Decisions
- Explicit export/import model rather than a browser extension -- iPhone is the primary client, and Safari extensions are impractical for this use case
- Context injection via tmux `send-keys` with a "Read this file" prompt -- lets Claude Code load the context naturally rather than trying to inject raw text
- Context files stored as markdown for human readability and easy pasting into claude.ai Projects

## Verification
```bash
# Export current session
curl http://localhost:3847/api/bridge/export
# Verify markdown file created in ~/.claude-remote/bridge/contexts/

# Import context from phone
curl -X POST http://localhost:3847/api/bridge/import \
  -H 'Content-Type: application/json' \
  -d '{"content": "# Task\nBuild a widget", "label": "Widget plan", "inject": true}'
# Verify file saved and command injected into tmux session

# Structured handoff
curl -X POST http://localhost:3847/api/bridge/handoff \
  -H 'Content-Type: application/json' \
  -d '{"task": "Add error handling to server.js", "context": "See DEC-008"}'
# Verify handoff file created and injected

# List context files
curl http://localhost:3847/api/bridge/contexts

# View bridge history
curl http://localhost:3847/api/bridge/history
```

---
*Retrospective plan -- documents what was built, not a forward-looking spec.*
