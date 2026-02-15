# Level 1: Prompt Responder -- MVP

> Status: Complete (Retrospective)

## Context
Claude Code blocks on permission prompts and questions while you are away from your desk. Level 1 solves this by letting you respond from your phone via a simple web UI.

## What Was Built
- Bash hook (`notify.sh`) that intercepts `permission_prompt` and `idle_prompt` events from Claude Code's notification system
- State file system: prompts written as JSON to `~/.claude-remote/pending/`, moved to `resolved/` after response
- Express API server (`server.js`) serving a single-page mobile web UI on port 3847
- Quick-action buttons in the UI: Y, n, Enter, Esc, custom text input
- Response injection via `tmux send-keys` into the active Claude Code session
- CLI launcher (`claude-remote`) wrapping Claude Code in a named tmux session (`claude-remote-[pid]`)
- Polling-based UI refresh (15-second interval) to check for new prompts

## Key Files
| File | Role |
|------|------|
| `src/hooks/notify.sh` | Claude Code hook -- creates state files and sends push |
| `src/server/server.js` | Express API server with prompt and response endpoints |
| `src/ui/index.html` | Mobile web interface (single-file PWA) |
| `scripts/claude-remote` | CLI launcher with tmux session management |
| `scripts/install.sh` | Installation and Claude Code hook registration |

## Key Decisions
- **DEC-001**: Claude Code hooks chosen over terminal parsing or process monitoring
- **DEC-002**: tmux chosen for session management (`send-keys` for injection, `capture-pane` for output)
- **DEC-004**: Tailscale for secure remote access (no public exposure)
- **DEC-005**: 15-second polling interval as a balance of responsiveness and resource usage

## Verification
```bash
# Start a Claude Remote session
claude-remote

# In another terminal, start the server
./scripts/start-server.sh

# Check for pending prompts
curl http://localhost:3847/api/prompts

# Open mobile UI
# Navigate to http://<tailscale-ip>:3847 on your phone
# Trigger a permission prompt in Claude Code and confirm it appears
```

---
*Retrospective plan -- documents what was built, not a forward-looking spec.*
