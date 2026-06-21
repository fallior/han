#!/bin/bash
# restart-heartbeat-service.sh — restart a <slug>-heartbeat systemd-user service
# so it picks up fresh code. Sibling of restart-human-service.sh (same shape,
# different surface). No-op if:
#   - neither the heartbeat's own source NOR any shared server-runtime dep changed
#   - the systemd service isn't installed (missing on this host)
#   - the service isn't currently active
#
# Why this exists (P0b, S196): the heartbeat is the AUTONOMOUS surface and loads
# the same shared runtime as the human seats (tmux-dispatcher, agent-cycle,
# agent-scheduler, garden-manifest, …) at boot — but it was NOT in the
# post-commit hook AT ALL (only the agent servers + *-human seats were). So a
# shared-lib change left the heartbeat scheduler on stale code until a manual
# S159 restart — the identical staleness exposure P0 closed for the *-human
# seats, on the surface where it matters most (the one no human is watching).
# Targets the SCHEDULER service (<slug>-heartbeat.service, the node process that
# loads the libs and dispatches beats) — not the dispatcher-managed spoke
# surface unit (han-surface-*), which cold-launches its code from disk.
#
# Why conditional (like restart-human-service.sh): the heartbeat is a
# continuously-running responder; an unrelated commit shouldn't bounce it
# mid-beat. Asymmetry by design: an over-restart briefly bounces an idle beat;
# an under-restart strands the autonomous surface on stale code for days —
# favour freshness.
#
# Called by local git hooks installed via install-restart-hooks.sh.
# Sibling to restart-human-service.sh / restart-agent-server.sh.

set -u

SLUG="${1:?usage: $0 <slug> [post-commit|post-merge]}"
EVENT="${2:-post-commit}"  # safer default — only checks HEAD~1..HEAD
SERVICE="${SLUG}-heartbeat.service"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$REPO_ROOT" ]]; then exit 0; fi
cd "$REPO_ROOT" || exit 0

# The heartbeat restarts when its own entrypoint OR any shared server-runtime dep
# it loads at boot changed. Grounded in leo-heartbeat.ts's import surface
# (lib/{agent-cycle,agent-scheduler,day-phase,diary-mcp-server,garden-manifest,
# pid-guard,tmux-dispatcher} + transitive db.ts) — all under src/server/lib/.
# Agent-agnostic (DEC-081): $SLUG is the only per-agent leaf; the shared surface
# is identical for every heartbeat.
TRIGGER_RE="^(src/server/${SLUG}-heartbeat\.ts|src/server/lib/|src/server/db\.ts)"

# Pick the diff range based on the event that called us (S156: route by
# event-name to avoid stale-ORIG_HEAD over-firing on post-commit).
#   post-commit → HEAD~1..HEAD (just the new commit)
#   post-merge  → ORIG_HEAD..HEAD (all commits brought in by the merge/pull)
RANGE=""
if [[ "$EVENT" == "post-merge" ]]; then
    git rev-parse ORIG_HEAD >/dev/null 2>&1 && RANGE="ORIG_HEAD HEAD"
else
    # post-commit (or unspecified — same default)
    git rev-parse HEAD~1 >/dev/null 2>&1 && RANGE="HEAD~1 HEAD"
fi
if [[ -z "$RANGE" ]]; then exit 0; fi

# Any own-source or shared-runtime file in the range? (capture them for the log)
CHANGED_FILES="$(git diff --name-only $RANGE 2>/dev/null | grep -E "$TRIGGER_RE" || true)"
if [[ -z "$CHANGED_FILES" ]]; then
    # Neither the heartbeat's source nor a shared runtime dep changed — silent no-op.
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

echo "[restart-heartbeat-service] runtime change in ${EVENT} range — restarting ${SERVICE}:"
echo "$CHANGED_FILES" | sed 's/^/[restart-heartbeat-service]   /'
systemctl --user restart "$SERVICE"
