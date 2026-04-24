#!/bin/bash
# agent-server-watchdog.sh — auto-restarting wrapper for han agent servers.
#
# Replaces the bare `exec npx tsx server.ts` line in the hanjim/hanleo/etc.
# launchers. The watchdog spawns the server, writes its PID to
# ~/.han/{slug}-server.pid, waits for exit, then relaunches. External
# triggers (git hooks via restart-agent-server.sh) send SIGTERM to that PID
# to force a code-pickup restart with a ~2-second outage window.
#
# Without this, agent servers launched by hanjim live for the lifetime of
# their tmux session — drifting from the systemd-managed han-server as
# deploys land. The Apr 20 → Apr 24 ghost server (PID 2271911) was the cost.

set -u

SLUG="${1:?usage: $0 <slug> <port> <server-dir>}"
PORT="${2:?missing port}"
SERVER_DIR="${3:?missing server-dir}"
PIDFILE="$HOME/.han/${SLUG}-server.pid"

cleanup() {
    rm -f "$PIDFILE"
}
trap cleanup EXIT

cd "$SERVER_DIR"

echo "[${SLUG}-watchdog] starting (port=${PORT}, server-dir=${SERVER_DIR})"
echo "[${SLUG}-watchdog] PID will be written to ${PIDFILE}"
echo "[${SLUG}-watchdog] To stop: Ctrl-C this pane (kills the loop, not just the server)"
echo

while true; do
    PORT="$PORT" npx tsx server.ts &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PIDFILE"
    wait "$SERVER_PID"
    EXIT=$?
    rm -f "$PIDFILE"
    echo
    echo "[${SLUG}-watchdog] server exited with code $EXIT — restarting in 2s"
    echo
    sleep 2
done
