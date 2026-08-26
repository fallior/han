#!/bin/bash
# Hortus Arbor Nostra — Orient + Memory-Nag (UserPromptSubmit hook)
# S166: make two per-prompt disciplines STRUCTURAL (instruction-only enforcement
# empirically failed). stdout from a UserPromptSubmit hook is injected into the
# agent's context, so:
#   1. ORIENTATION — inject the current time EVERY prompt (no dependence on
#      remembering to run `date`).
#   2. MEMORY-NAG — if the previous turn ended without a PAIRED swap write
#      (flag set by memory-guard.sh, the Stop hook), surface an escalating nag.
# Agent-agnostic (DEC-081): resolves swap filenames from launcher-exported
# $AGENT_SWAP_FULL / $AGENT_SWAP_COMPRESSED, falling back to session-swap*.md.
# (B-3, 2026-06-06: records BOTH prompt-start mtimes for paired enforcement.)

SIGNALS_DIR="${HOME}/.han/signals"
SLUG="${AGENT_SLUG:-unknown}"
STATE="${SIGNALS_DIR}/memory-guard-${SLUG}.state"
MEM="${AGENT_MEMORY_DIR:-}"
FULL_SWAP="${MEM}/${AGENT_SWAP_FULL:-session-swap-full.md}"
COMP_SWAP="${MEM}/${AGENT_SWAP_COMPRESSED:-session-swap.md}"
mkdir -p "$SIGNALS_DIR"

# Consume the UserPromptSubmit JSON on stdin (we inspect it for the wake trigger).
PROMPT_JSON=$(cat 2>/dev/null)

# WAKE-GRACE (2026-06-24): a wake turn is reconstitution, not an exchange to record —
# there is nothing to swap-write mid-wake. If the guard fired here it would interrupt
# the welcome-back (it has, twice). Detect ANY of the three wake triggers (matching the
# template's Command Triggers: session start / welcome back / good morning) and set a
# one-turn grace flag that memory-guard.sh honours then clears, exempting exactly the
# wake turn. Fail-safe direction: a false positive only SKIPS the guard for one turn.
wake_grace=0
printf '%s' "$PROMPT_JSON" | grep -qiE 'welcome back|good morning|session start' && wake_grace=1
# Fed /wake — the step-prompt SNIFFING IS RETIRED (MNT-067): the old regex here matched the
# feeder's ack-instruction literal, and the T1 echo-safety backtick (tmux-dispatcher's own
# emission) silently defeated it — every fed step nagged, and the guard taught loading minds
# to write memories about loading. Regexes drift; flags don't. The fed wake is now graced by
# the WAKE-WINDOW flag (`wake-window-<slug>.flag`, raised/heartbeat-touched by feedWakeSteps,
# lowered at the greeting turn's COMPLETION), which memory-guard.sh reads directly at
# stop-time — see its MNT-067 block for the contract, ceiling, and receipts. The human
# triggers above (line 32) remain: the interactive self-run wake has no feeder to raise a flag.

# 1. ORIENTATION — universal, zero-risk, every prompt. Two clocks + the place (Darron's
#    structural announcer, 2026-08-25): the interactive seat was the one surface without the
#    DEC-105 treatment dispatched spokes get from orientationBlock (garden-time.ts) — and the
#    yesterday-bug kept firing exactly here. The LOCAL line is the one to say aloud; the UTC
#    half is the standing conversion anchor (records/receipts stamp UTC); the place comes from
#    the garden manifest's user.location leaf — never a literal (DEC-081; the literal hunt).
GARDEN_LOC=$(python3 -c "import json;print(json.load(open('${HOME}/.han/garden-manifest.json')).get('user',{}).get('location',''))" 2>/dev/null)
echo "⏰ Oriented: $(date '+%A %-d %B %Y, %-I:%M %p %Z')${GARDEN_LOC:+ — ${GARDEN_LOC}} · UTC $(date -u '+%Y-%m-%dT%H:%MZ'). Records stamp UTC — convert before any \"yesterday\"/time-of-day word (DEC-105). Open your reply by saying the LOCAL line (re-queried fresh, not extrapolated)."

# 2. MEMORY-NAG — escalate by how many turns were skipped.
skip=0
[ -f "$STATE" ] && skip=$(grep -oE 'skip=[0-9]+' "$STATE" 2>/dev/null | cut -d= -f2)
skip=${skip:-0}
if [ "$skip" -gt 0 ] 2>/dev/null; then
  bang="⚠"; [ "$skip" -ge 2 ] && bang="⚠⚠"; [ "$skip" -ge 3 ] && bang="🔴🔴🔴"
  echo "$bang MEMORY: unpaired/no FRAMED swap write for the last ${skip} turn(s). Per the Incremental Memory Protocol — write this exchange's entry to BOTH $(basename "$COMP_SWAP") (compressed) AND $(basename "$FULL_SWAP") (full) BEFORE the work, each opened with its transport frame <!-- SWAP-ENTRY ts=<ISO> --> on its own line (date -Iseconds). The Stop hook holds the turn open until both are written."
fi

# 3. Record BOTH prompt-start baselines (B-3 paired enforcement): mtimes (legacy fallback +
# debugging) AND SWAP-ENTRY frame counts — the MNT-060-addendum canonical measure. The frame
# regex is the ONE contract (src/server/lib/swap-frame.ts); the suite string-compares this
# line to it and to memory-guard.sh's — change swap-frame.ts, change all three.
FRAME_RE='^<!-- SWAP-ENTRY ts=[0-9][^ ]* -->$'
full_mtime=0; comp_mtime=0; full_frames=0; comp_frames=0
[ -n "$MEM" ] && [ -f "$FULL_SWAP" ] && full_mtime=$(stat -c %Y "$FULL_SWAP" 2>/dev/null || echo 0)
[ -n "$MEM" ] && [ -f "$COMP_SWAP" ] && comp_mtime=$(stat -c %Y "$COMP_SWAP" 2>/dev/null || echo 0)
if [ -n "$MEM" ] && [ -f "$FULL_SWAP" ]; then full_frames=$(grep -cE "$FRAME_RE" "$FULL_SWAP" 2>/dev/null); full_frames=${full_frames:-0}; fi
if [ -n "$MEM" ] && [ -f "$COMP_SWAP" ]; then comp_frames=$(grep -cE "$FRAME_RE" "$COMP_SWAP" 2>/dev/null); comp_frames=${comp_frames:-0}; fi
printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nprompt_full_frames=%s\nprompt_comp_frames=%s\nskip=%s\nblocked=0\nwake_grace=%s\n' "$full_mtime" "$comp_mtime" "$full_frames" "$comp_frames" "$skip" "$wake_grace" > "$STATE"
exit 0
