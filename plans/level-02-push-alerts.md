# Level 2: Push Alerts -- Real-time Notifications

> Status: Complete (Retrospective)

## Context
Level 1's polling meant you had to keep checking the UI. Level 2 adds instant push notifications via ntfy.sh so your phone buzzes the moment Claude Code needs input.

## What Was Built
- ntfy.sh integration in `notify.sh` -- HTTP POST sends push notification on prompt events
- Rich notification content: terminal context (last 20 lines via `tmux capture-pane`) included in body
- Differentiated urgency: `permission_prompt` is urgent priority, `idle_prompt` is default
- Action buttons in notifications: "Approve" deep-links to quick-response endpoint, "Open UI" links to web interface
- Quick-response endpoint (`GET /quick?id=...&action=1`) for responding directly from notification actions
- Configurable via `~/.claude-remote/config.json`: ntfy topic, remote URL, quiet hours, idle notification toggle
- Deduplication via `X-Id` header to prevent repeat notifications for the same prompt
- Quiet hours support (same-day and overnight ranges)

## Key Files
| File | Role |
|------|------|
| `src/hooks/notify.sh` | Push notification logic (lines 126-167) |
| `~/.claude-remote/config.json` | Runtime configuration (ntfy topic, quiet hours) |

## Key Decisions
- **DEC-003**: ntfy.sh chosen over Pushover, custom WebSocket/FCM, or email/SMS -- best simplicity-to-capability ratio
- Notification topic treated as a secret (env var `NTFY_TOPIC` or config file)
- 0.3-second sleep before `capture-pane` to let the TUI render prompt options

## Verification
```bash
# Ensure ntfy topic is configured
export NTFY_TOPIC="your-secret-topic"

# Start session and server
claude-remote &
./scripts/start-server.sh

# Trigger a permission prompt in Claude Code
# Verify push notification arrives on phone (ntfy app)
# Tap "Approve" action button -- confirm response is injected

# Test quiet hours
# Set quiet_hours_start/end in ~/.claude-remote/config.json
# Verify notifications are suppressed during quiet window
```

---
*Retrospective plan -- documents what was built, not a forward-looking spec.*
