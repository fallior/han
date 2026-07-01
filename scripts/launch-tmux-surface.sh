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
#   - AGENT-DIR cwd (S199 P4 step 5) so the spoke loads its OWN generated CLAUDE.md +
#     .mcp.json (han-diary) — closes the structural corruption root (a spoke no longer
#     sits next to a foreign agent's identity file; W6 only patched the phrase layer)
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
#   launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>] [--stem]
#   e.g. launch-tmux-surface.sh leo heartbeat
#        launch-tmux-surface.sh leo session --stem   # pre-warm a session-stem (R1, DEC-099)
#
# --stem (R1, DEC-099 stem-sleeve): pre-warm a STEM — a personality-warm `session` self that
# idles ready to be ATTACHED to (re-sleeved) by a human, taking the expensive L1 load off the
# critical path. The interactive `session` is NOT in the manifest's launchable surface set (it's
# human-launched via `han`/`hanjim`, never the dispatcher), so --stem BYPASSES the launchable-
# surface check (and ONLY for the stem path — the normal validation stays intact for real spokes,
# preserving the anti-respawn-war single-manager guard). Everything else reuses the proven contract:
# the env (manifest-derived, surface=session — incl jim's root-special memoryDir), HAN_SPOKE=1 (so
# a detached pane skips the ssh-agent prompt), claude-logged, the ready-sentinel. The greet-less
# wake-feed + the stem-registry are the caller's job (scripts/prewarm-stem.ts). This is also the
# first brick of R2's `launch-tmux-surface.sh → launch-stem` collapse (surface → sleeve-param).

set -euo pipefail

SLUG="${1:?usage: launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>] [--stem]}"
SURFACE="${2:?usage: launch-tmux-surface.sh <slug> <surface> [--no-log] [--model <model>] [--stem]}"
shift 2

NO_LOG=false
MODEL_OVERRIDE=""
STEM=false
SESSION_OVERRIDE=""   # R3a.1c-ii: a warm-pool stem needs a DISTINCT session name (N stems can't all
                      # be `session-<slug>`). The dispatcher's pool-manager passes it via --session-name.
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-log) NO_LOG=true; shift ;;
        --model)  MODEL_OVERRIDE="${2:?--model needs a value}"; shift 2 ;;
        --stem)   STEM=true; shift ;;
        --session-name) SESSION_OVERRIDE="${2:?--session-name needs a value}"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 1 ;;
    esac
done

# --stem is R1-AS-session only: a stem pre-warms the interactive `session` self. Guard against
# misuse on a real (launchable) surface — those go through normal validation, not the bypass.
if [[ "$STEM" == true && "$SURFACE" != "session" ]]; then
    echo "launch-tmux-surface: --stem is for the 'session' surface only (got '$SURFACE')" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
# R3a.1c-ii: a pool stem overrides the fixed `<surface>-<slug>` name with its unique session
# (default byte-identical for every existing caller — the override is unset unless --session-name).
SESSION_NAME="${SESSION_OVERRIDE:-${SURFACE}-${SLUG}}"
HAN_DIR="${HAN_DIR:-$HOME/.han}"

manifest_get() {
    (cd "$REPO_ROOT/src/server" && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/manifest-get.ts "$@")
}

# Validate the surface against the manifest's launchable set (fail loud on typos
# and on deferred surfaces — Q-V2-3 meditations are a named deferral, not launchable).
# --stem skips this ONE check (the interactive `session` is deliberately not in the launchable
# set — human-launched, never the dispatcher), and ONLY this check: the env/model/cwd contract
# below is unchanged, and real spokes still validate normally (the single-manager guard intact).
if [[ "$STEM" == false ]] && ! manifest_get surfaces "$SLUG" | grep -qx "$SURFACE"; then
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
ENV_KV="$(manifest_get env "$SLUG" "$SURFACE")"
ENV_ARGS=()
while IFS= read -r kv; do
    [[ -n "$kv" ]] && ENV_ARGS+=(-e "$kv")
done <<< "$ENV_KV"

# Agent working dir = ~/.han/agents/<DisplayName> (uniform across the garden — verified;
# AGENT_NAME is manifest-derived, so this stays agnostic). The spoke cd's here so its project
# CLAUDE.md is its OWN generated identity, not the repo root's (S199 P4 step 5).
AGENT_NAME="$(grep '^AGENT_NAME=' <<< "$ENV_KV" | cut -d= -f2-)"
AGENT_DIR="$HOME/.han/agents/$AGENT_NAME"
if [[ -z "$AGENT_NAME" ]]; then
    echo "launch-tmux-surface: could not resolve AGENT_NAME for '$SLUG' from the manifest" >&2
    exit 1
fi

# Generate the agent's CLAUDE.md + .mcp.json from the Garden Manifest BEFORE cd-ing (Jim's
# note a — refresh before launch, else the spoke cd's into a stub/stale file). Same shared
# generator the interactive launchers use. 'session' surface keeps the agent-dir file stable
# across an agent's surfaces — the per-surface swap prefix flows via the -e env above (the
# operational source), not this file's descriptive text.
( cd "$REPO_ROOT/src/server" && NODE_PATH="$(pwd)/node_modules" \
    npx tsx ../../scripts/generate-agent-claude-md.ts "$SLUG" ) >&2

# HAN_SPOKE=1 marks the pane as a detached serverless spoke: ~/.bashrc's
# ssh-agent init must skip under it (the ssh-add passphrase prompt blocks a
# detached pane BEFORE claude launches — first-warm-beat finding, 2026-06-12).
# Spokes need no SSH (file transport + curl to localhost). The .bashrc guard
# itself is Darron's hand (L013), same precedent as HAN_LOG_SURFACE.
# CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: suppress the "How is Claude doing?" survey
# (+ its data-use y/n follow-up) in autonomous spokes (S173, 2026-06-13). Seen live
# in the heartbeat pane under a model error. Two reasons: (1) the survey modal
# pollutes the pane and could wedge an autonomous seat that can't answer TUI chrome;
# (2) PRIVACY — we do not want autonomous spokes auto-consenting to data-use on the
# experiment's content; suppressed = no per-session consent, posture stays account-default.
tmux new-session -d -s "$SESSION_NAME" -c "$AGENT_DIR" \
    "${ENV_ARGS[@]}" \
    -e "AGENT_SURFACE=$SURFACE" \
    -e "HAN_SESSION=$SESSION_NAME" \
    -e "HAN_LOG_SURFACE=$SURFACE" \
    -e "HAN_SPOKE=1" \
    -e "HAN_DIARY_SLUG=${SESSION_OVERRIDE:-$SLUG}" \
    -e "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1"

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
