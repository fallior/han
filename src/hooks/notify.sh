#!/bin/bash
# Claude Remote - Notification Hook (Level 2)
# Receives prompt events from Claude Code and creates state files for remote response
# Sends rich push notifications via ntfy.sh with action buttons

set -euo pipefail

# Configuration
CLAUDE_REMOTE_DIR="${CLAUDE_REMOTE_DIR:-$HOME/.claude-remote}"
PENDING_DIR="$CLAUDE_REMOTE_DIR/pending"
RESOLVED_DIR="$CLAUDE_REMOTE_DIR/resolved"
CONFIG_FILE="$CLAUDE_REMOTE_DIR/config.json"

# Ensure directories exist
mkdir -p "$PENDING_DIR" "$RESOLVED_DIR"

# Read config file (if it exists)
CONFIG="{}"
if [[ -f "$CONFIG_FILE" ]]; then
    CONFIG=$(cat "$CONFIG_FILE")
fi

# Helper: read config value with fallback
cfg() {
    echo "$CONFIG" | jq -r --arg key "$1" --arg default "$2" '.[$key] // $default'
}

# Resolve settings: env vars override config file
NTFY_TOPIC="${NTFY_TOPIC:-$(cfg ntfy_topic "")}"
REMOTE_URL="${CLAUDE_REMOTE_URL:-$(cfg remote_url "")}"
NOTIFY_IDLE=$(cfg notify_idle_prompt "true")
QUIET_START=$(cfg quiet_hours_start "")
QUIET_END=$(cfg quiet_hours_end "")

# Read JSON from stdin
INPUT=$(cat)

# Parse JSON using jq (required dependency)
# Claude Code hooks pass notification_type for Notification events
EVENT_NAME=$(echo "$INPUT" | jq -r '.notification_type // .event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')

# Exit if no event name
if [[ -z "$EVENT_NAME" ]]; then
    exit 0
fi

# Only handle prompt events
if [[ "$EVENT_NAME" != "permission_prompt" && "$EVENT_NAME" != "idle_prompt" ]]; then
    exit 0
fi

# Generate unique ID based on timestamp
TIMESTAMP=$(date +%s%3N)
PROMPT_ID="${TIMESTAMP}-${SESSION_ID:-unknown}"

# Get tmux session name from environment or use default
TMUX_SESSION="${CLAUDE_REMOTE_SESSION:-claude-remote}"

# Capture terminal content to show actual prompt options
# Small delay to let the TUI render the options
sleep 0.3
TERMINAL_CONTENT=""
if command -v tmux &> /dev/null && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    TERMINAL_CONTENT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null | tail -20 || true)
fi

# Determine if we should send a push notification
SHOULD_NOTIFY=false
if [[ -n "$NTFY_TOPIC" ]]; then
    if [[ "$EVENT_NAME" == "permission_prompt" ]]; then
        SHOULD_NOTIFY=true
    elif [[ "$EVENT_NAME" == "idle_prompt" && "$NOTIFY_IDLE" == "true" ]]; then
        SHOULD_NOTIFY=true
    fi
fi

# Check quiet hours (local time)
if [[ "$SHOULD_NOTIFY" == "true" && -n "$QUIET_START" && -n "$QUIET_END" ]]; then
    CURRENT_HOUR=$(date +%H:%M)
    if [[ "$QUIET_START" < "$QUIET_END" ]]; then
        # Same-day range (e.g. 09:00-17:00)
        if [[ "$CURRENT_HOUR" >= "$QUIET_START" && "$CURRENT_HOUR" < "$QUIET_END" ]]; then
            SHOULD_NOTIFY=false
        fi
    else
        # Overnight range (e.g. 22:00-07:00)
        if [[ "$CURRENT_HOUR" >= "$QUIET_START" || "$CURRENT_HOUR" < "$QUIET_END" ]]; then
            SHOULD_NOTIFY=false
        fi
    fi
fi

# Create state file (with notification tracking)
STATE_FILE="$PENDING_DIR/${PROMPT_ID}.json"
jq -n \
    --arg id "$PROMPT_ID" \
    --arg event "$EVENT_NAME" \
    --arg message "$MESSAGE" \
    --arg session_id "$SESSION_ID" \
    --arg tmux_session "$TMUX_SESSION" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson created_at "$TIMESTAMP" \
    --arg terminal "$TERMINAL_CONTENT" \
    --argjson notified "$SHOULD_NOTIFY" \
    '{
        id: $id,
        event: $event,
        message: $message,
        session_id: $session_id,
        tmux_session: $tmux_session,
        timestamp: $timestamp,
        created_at: $created_at,
        terminal: $terminal,
        notified: $notified
    }' > "$STATE_FILE"

# Send push notification via ntfy.sh
if [[ "$SHOULD_NOTIFY" == "true" ]]; then
    # Build notification body from terminal content or message
    if [[ -n "$TERMINAL_CONTENT" ]]; then
        BODY=$(echo "$TERMINAL_CONTENT" | head -c 300)
    else
        BODY=$(echo "$MESSAGE" | head -c 300)
    fi

    # Build notification headers based on event type
    HEADERS=()

    if [[ "$EVENT_NAME" == "permission_prompt" ]]; then
        HEADERS+=(-H "Title: Claude needs permission")
        HEADERS+=(-H "Priority: urgent")
        HEADERS+=(-H "Tags: robot,warning")
    else
        HEADERS+=(-H "Title: Claude is waiting")
        HEADERS+=(-H "Priority: default")
        HEADERS+=(-H "Tags: robot,hourglass_flowing_sand")
    fi

    # Deduplication
    HEADERS+=(-H "X-Id: $PROMPT_ID")
    HEADERS+=(-H "Markdown: yes")

    # Add click URL and action buttons if remote URL is configured
    if [[ -n "$REMOTE_URL" ]]; then
        HEADERS+=(-H "Click: ${REMOTE_URL}/")

        if [[ "$EVENT_NAME" == "permission_prompt" ]]; then
            HEADERS+=(-H "Actions: view, Approve, ${REMOTE_URL}/quick?id=${PROMPT_ID}&action=1; view, Open UI, ${REMOTE_URL}/")
        else
            HEADERS+=(-H "Actions: view, Open UI, ${REMOTE_URL}/")
        fi
    fi

    # Send notification in background
    curl -s -o /dev/null \
        "${HEADERS[@]}" \
        -d "$BODY" \
        "https://ntfy.sh/${NTFY_TOPIC}" &
fi

exit 0
