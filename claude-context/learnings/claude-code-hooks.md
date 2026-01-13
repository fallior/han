# Claude Code Hooks System

> How to detect and respond to Claude Code prompts programmatically

## Problem

You want to be notified when Claude Code is waiting for user input — either a permission approval (Y/n) or a free-form response. You need to integrate with Claude Code without modifying its source code.

## Challenge

Claude Code is a closed-source CLI tool. There's no obvious API for detecting when it needs input. Terminal output parsing would be fragile and unreliable.

## Solution

Claude Code has a built-in hooks system that executes shell commands when specific events occur. Configure hooks in `~/.claude/settings.json`:

```json
{
    "hooks": {
        "permission_prompt": ["/path/to/your/script.sh"],
        "idle_prompt": ["/path/to/your/script.sh"]
    }
}
```

### Hook Events

| Event | When it fires | Delay |
|-------|---------------|-------|
| `permission_prompt` | Claude needs Y/n approval | Immediate |
| `idle_prompt` | Claude is waiting for any input | ~60 seconds |

### Hook Input

Hooks receive JSON via stdin with event details:

```json
{
    "event_name": "permission_prompt",
    "session_id": "abc123",
    "message": "Claude wants to edit file.txt. Allow? (Y/n)"
}
```

### Example Hook Script

```bash
#!/bin/bash
# notify.sh - Claude Code notification hook

set -euo pipefail

# Read JSON from stdin
INPUT=$(cat)

# Parse with jq
EVENT_NAME=$(echo "$INPUT" | jq -r '.event_name // empty')
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')

# Only notify on permission prompts (immediate)
if [[ "$EVENT_NAME" == "permission_prompt" ]]; then
    # Send push notification, create state file, etc.
    curl -d "$MESSAGE" "https://ntfy.sh/your-topic"
fi
```

### Installation

The install script should update `~/.claude/settings.json`:

```bash
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# Create or update settings
if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Update existing
    jq --arg hook "/path/to/hook.sh" '
        .hooks.permission_prompt = [$hook] |
        .hooks.idle_prompt = [$hook]
    ' "$CLAUDE_SETTINGS" > tmp && mv tmp "$CLAUDE_SETTINGS"
else
    # Create new
    cat > "$CLAUDE_SETTINGS" << EOF
{
    "hooks": {
        "permission_prompt": ["/path/to/hook.sh"],
        "idle_prompt": ["/path/to/hook.sh"]
    }
}
EOF
fi
```

## Key Insight

The `permission_prompt` event fires **immediately** when Claude needs approval — this is the critical one for remote notification. The `idle_prompt` has a built-in 60-second delay before firing, making it less useful for time-sensitive alerts.

Handle both events in your hook, but only send push notifications for `permission_prompt`.

## Gotchas

- **VSCode Extension**: Hooks in the VSCode extension have known issues (GitHub #16114). Use terminal mode for reliable hooks.
- **Multiple hooks**: The array can contain multiple scripts — all will be executed
- **Exit codes**: Non-zero exit codes are logged but don't affect Claude Code
- **Async execution**: Hooks run asynchronously, don't block Claude Code
- **jq required**: JSON parsing in bash needs jq — ensure it's installed

## References

- Claude Code documentation (hooks section)
- GitHub Issue #16114 (VSCode hooks broken)

---

*Discovered: 2026-01-13*
