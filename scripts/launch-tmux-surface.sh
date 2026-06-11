#!/bin/bash
# launch-tmux-surface.sh — T-2 serverless-spoke launcher (plan #66, thread mppj72fx)
#
# Launches ONE per-surface tmux'd Claude Code session for an agent: the "spoke" in
# the hub-and-spoke model (#73). Deliberately does NOT start a watchdog/server —
# the agent's single hub server owns the port; surfaces are serverless Claude Code
# clients over file transport (tmux-dispatcher) + curl.
#
# Everything is derived from the Garden Manifest via scripts/manifest-get.ts
# (Jim's T-2 note #2: no hand-written parallel lists): the AGENT_* env contract,
# the --model value (manifest CLI read-path), and the valid surface set.
#
# Spine = the T-1.5 fixture learnings (2026-06-11):
#   - env contract via `tmux -e` (mirrors han<agent> launchers)
#   - CLAUDECODE unset in the pane (L012 nested-exec guard)
#   - repo cwd so .mcp.json registers han-diary (trust approval inherits per-project)
#   - NO watchdog pane (the hub server is launched once per agent, elsewhere)
#   - claude-logged ON by default (canonical provenance + the #78 write-shape both
#     depend on the raw transcript landing in ~/.han/logs/<slug>/ — Jim's note #4);
#     --no-log launches bare claude for disposable test fixtures only.
#
# SUPERVISION MODEL (Jim's note #3 — deliberate, single-manager): systemd units
# using this launcher are Type=oneshot boot-launchers with NO Restart=. The ONE
# runtime manager of surface sessions is the tmux-dispatcher (spawnAgentSession
# relaunches a missing session at dispatch time). Human hands may kill/launch
# sessions manually; nothing else respawns them. This is the anti-3847-respawn-war
# shape: exactly one manager per resource.
#
# Usage:
#   launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>]
#   e.g. launch-tmux-surface.sh leo heartbeat

set -euo pipefail

SLUG="${1:?usage: launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>]}"
SURFACE="${2:?usage: launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>]}"
shift 2

NO_LOG=false
MODEL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-log) NO_LOG=true; shift ;;
        --model)  MODEL_OVERRIDE="${2:?--model needs a value}"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="${SURFACE}-${SLUG}"
HAN_DIR="${HAN_DIR:-$HOME/.han}"

manifest_get() {
    (cd "$REPO_ROOT/src/server" && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/manifest-get.ts "$@")
}

# Validate the surface against the manifest's launchable set (fail loud on typos
# and on deferred surfaces — Q-V2-3 meditations are a named deferral, not launchable).
if ! manifest_get surfaces "$SLUG" | grep -qx "$SURFACE"; then
    echo "launch-tmux-surface: '$SURFACE' is not a launchable surface for '$SLUG' (per the Garden Manifest + Q-V2-3 deferrals)" >&2
    echo "launchable: $(manifest_get surfaces "$SLUG" | tr '\n' ' ')" >&2
    exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "launch-tmux-surface: session '$SESSION_NAME' already exists — single-manager rule: not respawning (kill it first if you mean to relaunch)" >&2
    exit 2
fi

MODEL="${MODEL_OVERRIDE:-$(manifest_get model "$SLUG" "$SURFACE")}"

# AGENT_* env contract from the manifest + registry (agent-agnostic, DEC-081).
ENV_ARGS=()
while IFS= read -r kv; do
    ENV_ARGS+=(-e "$kv")
done < <(manifest_get env "$SLUG" "$SURFACE")

tmux new-session -d -s "$SESSION_NAME" -c "$REPO_ROOT" \
    "${ENV_ARGS[@]}" \
    -e "AGENT_SURFACE=$SURFACE" \
    -e "HAN_SESSION=$SESSION_NAME" \
    -e "HAN_LOG_SURFACE=$SURFACE"

# Launch Claude in the pane. claude-logged is a ~/.bashrc function (canonical
# per-agent transcript, DEC-091); CLAUDECODE is unset first (L012). HAN_LOG_SURFACE
# is exported for the (proposed, Darron's hand) claude-logged filename amendment.
if [[ "$NO_LOG" == true ]]; then
    LAUNCH_LINE="unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; claude --model $MODEL --dangerously-skip-permissions"
else
    LAUNCH_LINE="unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; claude-logged --model $MODEL"
fi
tmux send-keys -t "$SESSION_NAME" -l "$LAUNCH_LINE"
tmux send-keys -t "$SESSION_NAME" Enter

# Surface-index sidecar: deterministic session→surface→log mapping for the c0→log
# active link (#79 / DEC-091). The claude-logged filename carries only a timestamp;
# this records launch epoch so the indexer can bind the session_*.md unambiguously.
if [[ "$NO_LOG" == false ]]; then
    LOG_DIR="$HAN_DIR/logs/$SLUG"
    mkdir -p "$LOG_DIR"
    printf '{"launched_at":"%s","launched_epoch":%s,"slug":"%s","surface":"%s","tmux_session":"%s","model":"%s"}\n' \
        "$(date -Iseconds)" "$(date +%s)" "$SLUG" "$SURFACE" "$SESSION_NAME" "$MODEL" \
        >> "$LOG_DIR/surface-index.jsonl"
fi

echo "launched: $SESSION_NAME (slug=$SLUG surface=$SURFACE model=$MODEL log=$([[ "$NO_LOG" == true ]] && echo OFF-fixture || echo claude-logged))"
echo "readiness: the session signals ~/.han/health/${SLUG}-${SURFACE}-ready at welcome-back close (step 10); idle until the dispatcher (or thaw) wakes it"
