#!/bin/bash
# Hortus Arbor Nostra — Orient + Memory-Nag (UserPromptSubmit hook)
# S166, Darron's directive: make two per-prompt disciplines STRUCTURAL, because
# instruction-only enforcement empirically failed (orientation ~3/10 prompts,
# memory-writes ~2/session). stdout from a UserPromptSubmit hook is injected
# into the agent's context, so:
#   1. ORIENTATION — inject the current time EVERY prompt. The time becomes a
#      fact the agent always has; no dependence on remembering to run `date`.
#   2. MEMORY-NAG — if the previous turn ended without a session-swap write
#      (flag set by memory-guard.sh, the paired Stop hook), surface an
#      escalating reminder.
# Agent-agnostic (HAN principle): resolves the swap file from $AGENT_MEMORY_DIR.

SIGNALS_DIR="${HOME}/.han/signals"
SLUG="${AGENT_SLUG:-unknown}"
STATE="${SIGNALS_DIR}/memory-guard-${SLUG}.state"
SWAP="${AGENT_MEMORY_DIR:-}/session-swap-full.md"
mkdir -p "$SIGNALS_DIR"

# 1. ORIENTATION — universal, zero-risk, every prompt.
echo "⏰ Oriented: $(date '+%A %-d %B %Y, %-I:%M %p %Z') — open your reply by saying this line (re-queried fresh, not extrapolated)."

# 2. MEMORY-NAG — escalate by how many turns were skipped.
skip=0
[ -f "$STATE" ] && skip=$(grep -oE 'skip=[0-9]+' "$STATE" 2>/dev/null | cut -d= -f2)
skip=${skip:-0}
if [ "$skip" -gt 0 ] 2>/dev/null; then
  bang="⚠"; [ "$skip" -ge 2 ] && bang="⚠⚠"; [ "$skip" -ge 3 ] && bang="🔴🔴🔴"
  echo "$bang MEMORY: no session-swap write for the last ${skip} turn(s). Per the Incremental Memory Protocol — FLUSH session-swap→working-memory, then WRITE this exchange's entry (compressed + full) BEFORE the work. The Stop hook holds the turn open until you do."
fi

# 3. Record this prompt's start mtime so the Stop hook can detect a write.
mtime=0
[ -n "${AGENT_MEMORY_DIR:-}" ] && [ -f "$SWAP" ] && mtime=$(stat -c %Y "$SWAP" 2>/dev/null || echo 0)
printf 'prompt_mtime=%s\nskip=%s\nblocked=0\n' "$mtime" "$skip" > "$STATE"
exit 0
