#!/usr/bin/env bash
# credentials-scheduled-swap.sh — Scheduled account rotation on han
#
# Usage: credentials-scheduled-swap.sh {gmail|icloud}
#
# Copies .credentials-[ab].json over the live .credentials.json to switch
# the active Claude account on a schedule. Called from the user crontab.
# Logs every invocation to ~/.han/health/credential-swaps.jsonl with
# source="scheduled" so scheduled events land in the same audit trail as
# rate-limit-driven rotations.
#
# Account mapping on Darron's machine (han):
#   gmail  → .credentials-a.json (fallior@gmail.com)
#   icloud → .credentials-b.json (fallior@icloud.com)
#
# Idempotent: if the live file already matches the target, exits 0 without
# writing. Cron can fire the same swap multiple times without harm.
#
# See DEC-077 (Scheduled Account Rotation for Shared Subscriptions) and
# plans/credential-rotation-schedule-brief-mikes-han.md for the mirror
# implementation on Mike's machine.

set -euo pipefail

ARG="${1:-}"

CRED_DIR="${HOME}/.claude"
LIVE_FILE="${CRED_DIR}/.credentials.json"
LOG_DIR="${HOME}/.han/health"
LOG_FILE="${LOG_DIR}/credential-swaps.jsonl"

case "$ARG" in
    gmail)
        SOURCE_FILE="${CRED_DIR}/.credentials-a.json"
        ACCOUNT="fallior@gmail.com"
        ;;
    icloud)
        SOURCE_FILE="${CRED_DIR}/.credentials-b.json"
        ACCOUNT="fallior@icloud.com"
        ;;
    *)
        echo "Usage: $(basename "$0") {gmail|icloud}" >&2
        exit 1
        ;;
esac

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "Source credentials file not found: $SOURCE_FILE" >&2
    exit 2
fi

# Idempotent: skip the copy if the live file already matches the target
if cmp -s "$SOURCE_FILE" "$LIVE_FILE" 2>/dev/null; then
    STATUS="no-op"
    MESSAGE="Already on $ACCOUNT — no swap needed"
else
    cp -p "$SOURCE_FILE" "$LIVE_FILE"
    STATUS="swapped"
    MESSAGE="Swapped to $ACCOUNT"
fi

echo "$MESSAGE"

# Best-effort audit log
mkdir -p "$LOG_DIR" 2>/dev/null || true
TIMESTAMP=$(date -Iseconds)
printf '{"timestamp":"%s","source":"scheduled","target":"%s","account":"%s","status":"%s"}\n' \
    "$TIMESTAMP" "$ARG" "$ACCOUNT" "$STATUS" >> "$LOG_FILE" 2>/dev/null || true

exit 0
