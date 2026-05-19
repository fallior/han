#!/bin/bash
# restart-all-services.sh — restart every HAN systemd user service so all
# running processes pick up fresh code.
#
# Why this exists: the post-commit hook (.git/hooks/post-commit) only
# restarts the hanjim/hanleo CLI launchers + the *-human services. It does
# NOT touch han-server, leo-heartbeat, wm-sensor, or jemma. After any code
# change to memory-gradient.ts / supervisor-worker.ts / leo-heartbeat.ts /
# the wm-sensor surface, those services keep running pre-change code until
# explicitly restarted. The gradient triage (2026-05-17 to 2026-05-19)
# shipped to disk but never reloaded because of exactly this gap.
#
# Usage:
#   ./scripts/restart-all-services.sh            # restart all
#   ./scripts/restart-all-services.sh --status   # just print state, no restart
#   ./scripts/restart-all-services.sh --dry-run  # show what would happen
#
# Exit code: 0 if all services come up active; non-zero if any failed.

set -u

# The canonical HAN service list. Update HAN-ECOSYSTEM-COMPLETE.md and this
# list together — they are paired surfaces. New service → add here AND
# in the doc's services table.
HAN_SERVICES=(
    han-server         # API + supervisor-worker child + Orchestrator (port 3847)
    leo-heartbeat      # Leo's 20-min beats (work/sleep/dream/evening)
    wm-sensor          # Working-memory file watcher → paired rotation → cascade enqueue
    jim-human          # Jim's conversation-thread responder (signal-driven)
    leo-human          # Leo's conversation-thread responder (signal-driven)
    jemma              # Discord gateway / message dispatcher
)

MODE="restart"
for arg in "$@"; do
    case "$arg" in
        --status)  MODE="status" ;;
        --dry-run) MODE="dry-run" ;;
        --help|-h)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "Unknown arg: $arg" >&2; exit 1 ;;
    esac
done

print_state_line() {
    local svc="$1"
    local state pid started cpu
    state=$(systemctl --user is-active "${svc}.service" 2>&1)
    pid=$(systemctl --user show "${svc}.service" -p MainPID --value 2>&1)
    started=$(systemctl --user show "${svc}.service" -p ActiveEnterTimestamp --value 2>&1)
    printf "  %-18s %-9s PID=%-9s started=%s\n" "$svc" "$state" "$pid" "$started"
}

print_table() {
    local label="$1"
    echo "=== $label ==="
    for svc in "${HAN_SERVICES[@]}"; do
        print_state_line "$svc"
    done
}

# Always print pre-state so the operator knows what they were about to touch
print_table "Pre-state"

if [[ "$MODE" == "status" ]]; then
    exit 0
fi

if [[ "$MODE" == "dry-run" ]]; then
    echo ""
    echo "=== Would run (dry-run) ==="
    for svc in "${HAN_SERVICES[@]}"; do
        echo "  systemctl --user restart ${svc}.service"
    done
    exit 0
fi

echo ""
echo "=== Restarting ==="
failures=()
for svc in "${HAN_SERVICES[@]}"; do
    if systemctl --user restart "${svc}.service" 2>&1; then
        printf "  ✓ %s restarted\n" "$svc"
    else
        printf "  ✗ %s FAILED to restart\n" "$svc"
        failures+=("$svc")
    fi
done

# Brief settle delay so MainPID populates
sleep 2

echo ""
print_table "Post-state"

# Check supervisor came along as child of han-server
echo ""
echo "=== Supervisor-worker (child of han-server) ==="
hanserver_pid=$(systemctl --user show han-server.service -p MainPID --value 2>&1)
supervisor_pids=$(pgrep -af "supervisor-worker\.ts" 2>&1 | head -5)
if [[ -n "$supervisor_pids" ]]; then
    echo "$supervisor_pids" | sed 's/^/  /'
else
    echo "  (no supervisor-worker process found — han-server may still be initialising)"
fi

# Port 3847 ownership
echo ""
echo "=== Port 3847 listener ==="
ss -tlnp 2>/dev/null | grep ':3847' | head -1 | sed 's/^/  /' || echo "  (no listener)"

# Orphan-process detection: tsx processes outside systemd
echo ""
echo "=== Orphan tsx processes (outside systemd) ==="
orphans=$(pgrep -af "tsx server.ts\|tsx jemma.ts\|tsx leo-heartbeat.ts\|tsx leo-human.ts\|tsx jim-human.ts\|tsx services/wm-sensor.ts" 2>/dev/null | grep -v "systemd-managed" || true)
if [[ -n "$orphans" ]]; then
    # Filter out the legit systemd-managed ones we just started
    legit_pids=""
    for svc in "${HAN_SERVICES[@]}"; do
        pid=$(systemctl --user show "${svc}.service" -p MainPID --value 2>&1)
        legit_pids="$legit_pids $pid"
    done
    while IFS= read -r line; do
        pid=$(echo "$line" | awk '{print $1}')
        if ! grep -q " $pid " <<< " $legit_pids "; then
            echo "  ORPHAN: $line"
        fi
    done <<< "$orphans"
    echo "  (legit children of restarted services not shown)"
else
    echo "  (none)"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
    echo "✓ All ${#HAN_SERVICES[@]} HAN services restarted successfully"
    exit 0
else
    echo "✗ ${#failures[@]} service(s) failed: ${failures[*]}"
    exit 1
fi
