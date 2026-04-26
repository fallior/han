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

# Refresh-token prime (default ON; opt-out via SWAP_NO_PRIME=1).
#
# `claude auth status` forces an OAuth token refresh under the hood, which
# (a) writes new access+refresh tokens for the OUTGOING account into LIVE_FILE,
# (b) invalidates the previous refresh token server-side per OAuth standard.
# We then save the freshly-primed live file to its corresponding static so the
# static stays current with each rotation cycle. Side-effect (b) also helps
# the rotation problem itself: any long-running session on the outgoing account
# loses its in-memory refresh token, gets 401 on next refresh, and dies cleanly
# rather than silently overwriting the swap. That is the desired behaviour
# during a scheduled rotation.
#
# Opt-out for ad-hoc / manual swaps where you don't want to disturb live sessions:
#     SWAP_NO_PRIME=1 ./credentials-scheduled-swap.sh gmail
OUTGOING_PRIMED="not-primed"
CLAUDE_BIN="${HOME}/.nvm/versions/node/v23.9.0/bin/claude"
if [[ "${SWAP_NO_PRIME:-0}" != "1" ]]; then
    if [[ -x "$CLAUDE_BIN" ]]; then
        PROBE_OUT=$("$CLAUDE_BIN" auth status --json 2>/dev/null)
        OUTGOING_PRIMED=$(echo "$PROBE_OUT" | jq -r '.email // empty' 2>/dev/null || true)
        if [[ -z "$OUTGOING_PRIMED" ]]; then
            echo "Prime failed — could not determine outgoing account. Aborting swap to avoid corrupting static files." >&2
            mkdir -p "$LOG_DIR" 2>/dev/null || true
            printf '{"timestamp":"%s","source":"scheduled","target":"%s","account":"%s","status":"prime-failed"}\n' \
                "$(date -Iseconds)" "$ARG" "$ACCOUNT" >> "$LOG_FILE" 2>/dev/null || true
            exit 4
        fi

        # Let the prime's write settle and the SDK take its breath.
        sleep 3

        # Save freshly-primed live tokens to the OUTGOING account's static file
        # so it stays current for the next rotation cycle. Maps email→static via
        # the same conventions as the case statement above.
        case "$OUTGOING_PRIMED" in
            fallior@gmail.com) OUTGOING_STATIC="${CRED_DIR}/.credentials-a.json" ;;
            fallior@icloud.com) OUTGOING_STATIC="${CRED_DIR}/.credentials-b.json" ;;
            *)
                echo "Outgoing email unrecognised: $OUTGOING_PRIMED. Aborting swap." >&2
                printf '{"timestamp":"%s","source":"scheduled","target":"%s","account":"%s","status":"prime-unknown-account","outgoing_primed":"%s"}\n' \
                    "$(date -Iseconds)" "$ARG" "$ACCOUNT" "$OUTGOING_PRIMED" >> "$LOG_FILE" 2>/dev/null || true
                exit 5
                ;;
        esac
        cp -p "$LIVE_FILE" "$OUTGOING_STATIC"

        # Beat between save and swap.
        sleep 2
    else
        OUTGOING_PRIMED="claude-bin-not-found"
    fi
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

# Post-swap identity probe — opt-in via SWAP_PROBE=1.
#
# When run, queries Anthropic via `claude auth status` for the actual account
# behind the live token. Detects drift from in-flight refreshes by long-running
# claude processes (which write back to .credentials.json on token expiry,
# silently overwriting the swap with whatever account the running process
# already had in memory).
#
# Off by default because the probe makes an authenticated call and triggers
# refresh-token rotation per OAuth 2.0; if other consumers share the refresh
# chain, the rotation can invalidate their cached tokens and 401 them out.
# Safe to enable for manual invocation when nothing else is mid-call:
#     SWAP_PROBE=1 ./credentials-scheduled-swap.sh gmail
ACTUAL_EMAIL="not-probed"
if [[ "${SWAP_PROBE:-0}" == "1" ]]; then
    CLAUDE_BIN="${HOME}/.nvm/versions/node/v23.9.0/bin/claude"
    if [[ -x "$CLAUDE_BIN" ]]; then
        ACTUAL_EMAIL=$("$CLAUDE_BIN" auth status --json 2>/dev/null | jq -r '.email // "unknown"' 2>/dev/null || echo "probe-failed")
    else
        ACTUAL_EMAIL="claude-bin-not-found"
    fi
fi

# Best-effort audit log
mkdir -p "$LOG_DIR" 2>/dev/null || true
TIMESTAMP=$(date -Iseconds)
printf '{"timestamp":"%s","source":"scheduled","target":"%s","account":"%s","status":"%s","outgoing_primed":"%s","actual_email":"%s"}\n' \
    "$TIMESTAMP" "$ARG" "$ACCOUNT" "$STATUS" "$OUTGOING_PRIMED" "$ACTUAL_EMAIL" >> "$LOG_FILE" 2>/dev/null || true

if [[ "$ACTUAL_EMAIL" != "$ACCOUNT" && "$ACTUAL_EMAIL" != "probe-failed" && "$ACTUAL_EMAIL" != "claude-bin-not-found" ]]; then
    echo "WARNING: post-swap drift — expected $ACCOUNT, claude auth status reports $ACTUAL_EMAIL" >&2
fi

exit 0
