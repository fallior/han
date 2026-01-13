#!/bin/bash
# Claude Remote - Notification Hook
# Receives prompt events from Claude Code and creates state files for remote response

set -euo pipefail

# Configuration
CLAUDE_REMOTE_DIR="${CLAUDE_REMOTE_DIR:-$HOME/.claude-remote}"
PENDING_DIR="$CLAUDE_REMOTE_DIR/pending"
RESOLVED_DIR="$CLAUDE_REMOTE_DIR/resolved"

# Ensure directories exist
mkdir -p "$PENDING_DIR" "$RESOLVED_DIR"

# Read JSON from stdin
INPUT=$(cat)

# Parse JSON using jq (required dependency)
EVENT_NAME=$(echo "$INPUT" | jq -r '.event_name // empty')
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

# Create state file
STATE_FILE="$PENDING_DIR/${PROMPT_ID}.json"
cat > "$STATE_FILE" << EOF
{
    "id": "$PROMPT_ID",
    "event": "$EVENT_NAME",
    "message": $(echo "$MESSAGE" | jq -Rs .),
    "session_id": "$SESSION_ID",
    "tmux_session": "$TMUX_SESSION",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "created_at": $TIMESTAMP
}
EOF

# Send push notification only for permission_prompt (not idle_prompt)
if [[ "$EVENT_NAME" == "permission_prompt" && -n "${NTFY_TOPIC:-}" ]]; then
    # Truncate message for notification preview
    PREVIEW=$(echo "$MESSAGE" | head -c 200)

    # Send to ntfy.sh
    curl -s -o /dev/null \
        -H "Title: Claude needs input" \
        -H "Priority: high" \
        -H "Tags: robot" \
        -d "$PREVIEW" \
        "https://ntfy.sh/${NTFY_TOPIC}" &
fi

exit 0
