#!/bin/bash
# restart-agent-server.sh — send SIGTERM to a hanjim/hanleo/etc. server so
# its watchdog (agent-server-watchdog.sh) relaunches it with fresh code.
#
# No-op if the agent server isn't running (no pidfile, or stale pidfile).
# Called by local git hooks installed via install-restart-hooks.sh.

set -u

SLUG="${1:?usage: $0 <slug>}"
PIDFILE="$HOME/.han/${SLUG}-server.pid"

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
