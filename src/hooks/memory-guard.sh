#!/bin/bash
# Hortus Arbor Nostra — Memory-Guard (Stop hook)
# Holds the turn open if the agent ended it WITHOUT writing a session-swap entry.
# Pairs with orient-inject.sh (UserPromptSubmit) which records prompt-start state.
#
# FAIL-SAFE BY DESIGN — defaults to ALLOWING the stop on ANY uncertainty, so it
# can NEVER trap a session (worst case: silently does nothing):
#   • unknown agent / $AGENT_MEMORY_DIR unset      -> allow
#   • no recorded prompt-start state (first turn)   -> allow
#   • swap file missing                             -> allow
#   • already blocked once this turn (anti-loop)    -> allow
# It blocks ONLY when it can positively confirm: known agent + state present +
# swap file present + no write since prompt-start + not-yet-blocked-this-turn.

SIGNALS_DIR="${HOME}/.han/signals"
SLUG="${AGENT_SLUG:-unknown}"
STATE="${SIGNALS_DIR}/memory-guard-${SLUG}.state"
SWAP="${AGENT_MEMORY_DIR:-}/session-swap-full.md"

allow() { exit 0; }

[ -z "${AGENT_MEMORY_DIR:-}" ] && allow
[ ! -f "$STATE" ] && allow
[ ! -f "$SWAP" ] && allow

prompt_mtime=$(grep -oE 'prompt_mtime=[0-9]+' "$STATE" | cut -d= -f2); prompt_mtime=${prompt_mtime:-0}
skip=$(grep -oE 'skip=[0-9]+' "$STATE" | cut -d= -f2); skip=${skip:-0}
blocked=$(grep -oE 'blocked=[0-9]+' "$STATE" | cut -d= -f2); blocked=${blocked:-0}

# Anti-loop: only ever block ONCE per turn.
if [ "$blocked" -ge 1 ] 2>/dev/null; then
  printf 'prompt_mtime=%s\nskip=%s\nblocked=0\n' "$prompt_mtime" "$skip" > "$STATE"
  allow
fi

now_mtime=$(stat -c %Y "$SWAP" 2>/dev/null || echo 0)

# A write (or flush) touched the swap this turn -> good. Reset.
if [ "$now_mtime" -gt "$prompt_mtime" ] 2>/dev/null; then
  printf 'prompt_mtime=%s\nskip=0\nblocked=0\n' "$now_mtime" > "$STATE"
  allow
fi

# No memory activity this turn -> block once, increment skip for the nag.
newskip=$((skip + 1))
printf 'prompt_mtime=%s\nskip=%s\nblocked=1\n' "$prompt_mtime" "$newskip" > "$STATE"
cat <<'JSON'
{"decision":"block","reason":"Incremental Memory Protocol (structural guard): you have not written to session-swap-full.md this turn. Before finishing, append this exchange's entry to BOTH session-swap.md (compressed, 2-3 lines) and session-swap-full.md (full) — FLUSH-FIRST/WRITE-SECOND. Then end the turn. This guard blocks at most once per turn; it cannot trap you."}
JSON
exit 0
