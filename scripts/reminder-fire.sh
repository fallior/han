#!/usr/bin/env bash
# reminder-fire.sh — one-shot reminder firing
#
# Called by systemd transient timers to surface a scheduled reminder through
# three channels:
#   1. ntfy push to Darron's phone (uses topic from ~/.han/config.json)
#   2. Appends a line to ~/.han/reminders/pending.md (read by Leo at session start)
#   3. Logs firing to ~/.han/health/reminders-fired.jsonl
#
# Usage: reminder-fire.sh <title> <message>
#
# Example:
#   reminder-fire.sh "Mike creds discussion" \
#     "Saturday noon — discuss shared icloud credentials with Mike in person"

set -euo pipefail

TITLE="${1:?title required}"
MESSAGE="${2:?message required}"

HAN_DIR="${HOME}/.han"
CONFIG="${HAN_DIR}/config.json"
REMINDERS_DIR="${HAN_DIR}/reminders"
PENDING_FILE="${REMINDERS_DIR}/pending.md"
FIRED_LOG="${HAN_DIR}/health/reminders-fired.jsonl"

mkdir -p "$REMINDERS_DIR" "$(dirname "$FIRED_LOG")"

TIMESTAMP=$(date -Iseconds)

# Append to pending reminders (Leo checks this at session start)
{
    echo ""
    echo "## $TITLE ($TIMESTAMP)"
    echo ""
    echo "$MESSAGE"
    echo ""
    echo "---"
} >> "$PENDING_FILE"

# Log firing
printf '{"timestamp":"%s","title":"%s","message":"%s"}\n' \
    "$TIMESTAMP" "$TITLE" "$MESSAGE" >> "$FIRED_LOG" 2>/dev/null || true

# Push ntfy notification (best effort — don't fail if ntfy unavailable)
NTFY_TOPIC=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('ntfy_topic',''))" 2>/dev/null || echo "")
if [[ -n "$NTFY_TOPIC" ]]; then
    curl -s \
        -H "Title: $TITLE" \
        -H "Priority: default" \
        -H "Tags: alarm_clock" \
        -d "$MESSAGE" \
        "https://ntfy.sh/$NTFY_TOPIC" > /dev/null 2>&1 || true
fi

echo "Reminder fired: $TITLE"
