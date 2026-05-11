#!/bin/bash
# restart-human-service.sh — restart a *-human systemd-user service so it
# picks up fresh code from src/server/<slug>-human.ts. No-op if:
#   - the corresponding source file did NOT change in HEAD
#   - the systemd service isn't installed (missing on this host)
#   - the service isn't currently active
#
# Why conditional-on-file-change (different from restart-agent-server.sh):
# the *-human services are continuously running responder processes; an
# unrelated commit (e.g. a docs change) shouldn't interrupt an in-flight
# compose. We restart only when the actual .ts file changed.
#
# Called by local git hooks installed via install-restart-hooks.sh.
# Sibling to restart-agent-server.sh (which targets pidfile-based agent
# servers; this one targets systemd-user services).

set -u

SLUG="${1:?usage: $0 <slug>}"
SERVICE="${SLUG}-human.service"
SOURCE_FILE="src/server/${SLUG}-human.ts"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$REPO_ROOT" ]]; then exit 0; fi
cd "$REPO_ROOT" || exit 0

# Only restart if the source file actually changed. Check both the most-recent
# commit (post-commit case) AND the merge range if ORIG_HEAD exists (post-merge
# case where multiple commits arrived in a pull).
CHANGED=""
if git rev-parse HEAD~1 >/dev/null 2>&1; then
    if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qx "$SOURCE_FILE"; then
        CHANGED="commit"
    fi
fi
if [[ -z "$CHANGED" ]] && git rev-parse ORIG_HEAD >/dev/null 2>&1; then
    if git diff --name-only ORIG_HEAD HEAD 2>/dev/null | grep -qx "$SOURCE_FILE"; then
        CHANGED="merge"
    fi
fi

if [[ -z "$CHANGED" ]]; then
    # Source file didn't change — silent no-op, don't pollute git output.
    exit 0
fi

# Service installed?
if ! systemctl --user list-unit-files "$SERVICE" --no-legend 2>/dev/null | grep -q "^${SERVICE}\b"; then
    # Service unit not present on this host — silent no-op.
    exit 0
fi

# Service active?
if ! systemctl --user is-active --quiet "$SERVICE"; then
    # Loaded but not running — leave it alone.
    exit 0
fi

echo "[restart-human-service] ${SOURCE_FILE} changed (via ${CHANGED}) — restarting ${SERVICE}"
systemctl --user restart "$SERVICE"
