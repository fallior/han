#!/bin/bash
# restart-human-service.sh — restart a *-human systemd-user service so it
# picks up fresh code. No-op if:
#   - neither the seat's own source NOR any shared server-runtime dep changed
#   - the systemd service isn't installed (missing on this host)
#   - the service isn't currently active
#
# What counts as "fresh code" for a long-running seat (P0, S196): the seat loads
# src/server/<slug>-human.ts AND a shared runtime surface at boot —
# src/server/lib/** (tmux-dispatcher, prompt-builder, memory-paired-writer,
# garden-manifest, …), src/server/db.ts, src/server/services/discord.ts. A change
# in any of those does NOT take effect until the process restarts. The earlier
# source-file-ONLY check was blind to the shared libs — which is why the seats
# sat 4 days on a stale tmux-dispatcher (missing the fix-Leo arc) until a manual
# restart. We now trigger on the whole runtime surface.
#
# Why still conditional (different from restart-agent-server.sh, which restarts
# the agent SERVERS unconditionally): the *-human seats are continuously running
# responders; an unrelated commit (docs, another surface) shouldn't bounce an
# idle responder. Asymmetry by design: an over-restart briefly bounces an idle
# seat; an under-restart strands it on stale code for days — favour freshness.
#
# Called by local git hooks installed via install-restart-hooks.sh.
# Sibling to restart-agent-server.sh (which targets pidfile-based agent
# servers; this one targets systemd-user services).

set -u

SLUG="${1:?usage: $0 <slug> [post-commit|post-merge]}"
EVENT="${2:-post-commit}"  # safer default — only checks HEAD~1..HEAD
SERVICE="human-responder@${SLUG}.service"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$REPO_ROOT" ]]; then exit 0; fi
cd "$REPO_ROOT" || exit 0

# The seat restarts when its own entrypoint OR any shared server-runtime dep it
# loads at boot changed. Agent-agnostic (DEC-081): $SLUG parameterises the only
# per-agent leaf; the shared surface is identical for every seat.
TRIGGER_RE="^(src/server/human-responder\.ts|src/server/lib/|src/server/db\.ts|src/server/services/discord\.ts)"

# Pick the diff range based on the event that called us.
#   post-commit → HEAD~1..HEAD (just the new commit)
#   post-merge  → ORIG_HEAD..HEAD (all commits brought in by the merge/pull)
# Earlier version (S156, commit bd194a0) checked HEAD~1..HEAD then fell back to
# ORIG_HEAD..HEAD unconditionally. That fallback over-fired in post-commit
# context: ORIG_HEAD persists from prior git operations (resets, merges, pulls)
# and can stay pointed back across recent commits for an extended period, so
# every post-commit-after-a-merge inherited the pre-merge range as a stale
# pointer and matched .ts files that hadn't actually changed in the new commit.
# Routing the range by event-name eliminates the leak.
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
    # Neither the seat's source nor a shared runtime dep changed — silent no-op.
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

echo "[restart-human-service] runtime change in ${EVENT} range — restarting ${SERVICE}:"
echo "$CHANGED_FILES" | sed 's/^/[restart-human-service]   /'
systemctl --user restart "$SERVICE"
