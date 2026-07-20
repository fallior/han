#!/bin/bash
# restart-agent-server.sh — send SIGTERM to a hanjim/hanleo/etc. server so
# its watchdog (agent-server-watchdog.sh) relaunches it with fresh code.
#
# No-op if the agent server isn't running (no pidfile, or stale pidfile).
# Called by local git hooks installed via install-restart-hooks.sh.

set -u

SLUG="${1:?usage: $0 <slug> [event]}"
EVENT="${2:-}"
PIDFILE="$HOME/.han/${SLUG}-server.pid"

# ── Range gate (S227, the 3847-flapping fix): when called from a git hook with
# an event name, restart ONLY if the commit range touched server runtime.
# Docs/CHANGELOG/plans/UI-source commits were bouncing all four servers — the
# admin UI dropped on every disclosure commit (Darron caught it as "flapping").
# Bare invocation (no event) stays unconditional — the manual operator path.
# Same event-routed range as the sibling scripts (S156 stale-ORIG_HEAD fix).
if [[ -n "$EVENT" ]]; then
    TRIGGER_RE="^src/server/"
    EXCLUDE_RE="^src/server/tests/"
    RANGE=""
    if [[ "$EVENT" == "post-merge" ]]; then
        git rev-parse ORIG_HEAD >/dev/null 2>&1 && RANGE="ORIG_HEAD HEAD"
    else
        git rev-parse HEAD~1 >/dev/null 2>&1 && RANGE="HEAD~1 HEAD"
    fi
    if [[ -z "$RANGE" ]]; then exit 0; fi
    CHANGED="$(git diff --name-only $RANGE 2>/dev/null | grep -E "$TRIGGER_RE" | grep -vE "$EXCLUDE_RE" || true)"
    if [[ -z "$CHANGED" ]]; then
        # No server-runtime change in this commit — the server keeps serving;
        # no flap. Silent no-op, matching the sibling layers.
        exit 0
    fi
fi

if [[ ! -f "$PIDFILE" ]]; then
    # Silent no-op: agent server isn't running. Don't pollute git output.
    exit 0
fi

PID=$(cat "$PIDFILE" 2>/dev/null || echo "")
if [[ -z "$PID" ]]; then
    rm -f "$PIDFILE"
    exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
    echo "[restart-agent-server] sending SIGTERM to ${SLUG} server (PID $PID) — watchdog will relaunch with fresh code"
    kill -TERM "$PID"
else
    echo "[restart-agent-server] stale pidfile for ${SLUG} (PID $PID not running) — cleaning"
    rm -f "$PIDFILE"
fi
