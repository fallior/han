#!/bin/bash
# Hortus Arbor Nostra — Memory-Guard (Stop hook) — B-3 both-sides paired enforcement
# Holds the turn open unless the agent wrote a PAIRED swap entry this turn (BOTH
# the compressed and full swap files advanced). Catches BOTH unpaired directions
# (full-only AND compressed-only) — the full-only direction is what creates the
# gradient drift B-1 just drained. Pairs with orient-inject.sh (records both
# prompt-start mtimes).
#
# FAIL-SAFE BY DESIGN — defaults to ALLOWING the stop on ANY uncertainty, so it
# can NEVER trap a session (worst case: silently does nothing):
#   • $AGENT_MEMORY_DIR unset · no recorded state (first turn) · either swap file
#     missing · already blocked once this turn (anti-loop)  -> allow
# Agent-agnostic (DEC-081): resolves swap filenames from $AGENT_SWAP_FULL /
# $AGENT_SWAP_COMPRESSED (launcher-exported), falling back to session-swap*.md.
# (B-4 folded in: skip-counter resets after a post-block paired write.)

SIGNALS_DIR="${HOME}/.han/signals"
SLUG="${AGENT_SLUG:-unknown}"
STATE="${SIGNALS_DIR}/memory-guard-${SLUG}.state"
MEM="${AGENT_MEMORY_DIR:-}"
# R2 P-R2.2b (Fork A): resolve the swap pair off the sleeve (sleeved surface's prefix), fallback $AGENT_SWAP_* (inert today).
_sp="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-swap.sh" 2>/dev/null)"
if [ -n "$_sp" ]; then FULL_SWAP="${MEM}/${_sp}-full.md"; COMP_SWAP="${MEM}/${_sp}.md"
else FULL_SWAP="${MEM}/${AGENT_SWAP_FULL:-session-swap-full.md}"; COMP_SWAP="${MEM}/${AGENT_SWAP_COMPRESSED:-session-swap.md}"; fi

allow() { exit 0; }

# DEC-093 (humans-PR thaw, 2026-06-13): SPOKE seats (AGENT_SURFACE != session — heartbeat,
# human-response) write memory via the han-diary MCP tool (submit_response IS the turn's
# paired-memory write), NOT via the session swap files this guard enforces. So the guard
# would (a) falsely block the spoke at every turn-end and (b) make it write a SECOND swap
# entry to satisfy the block — the double-write that drifted WM full-side 24 entries in one
# night. Exempt non-session surfaces structurally (not by an action-block instruction). The
# interactive session (AGENT_SURFACE unset or 'session') stays fully guarded.
# R2 P-R2.2b: exemption follows the SLEEVE surface (a stem sleeved onto a spoke is exempt), fallback $AGENT_SURFACE.
_surface="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-surface.sh" 2>/dev/null)"; _surface="${_surface:-${AGENT_SURFACE:-session}}"
[ "$_surface" != "session" ] && allow

# R1 (DEC-099 stem-sleeve): a PRE-WARM session-stem runs AGENT_SURFACE=session but has NO human
# client attached — it is INERT (fed its load, never asked to PRODUCE a turn-record until a human
# ATTACHES via switch-client). Without this it confabulates plausible-but-FALSE swap into the SHARED
# session files (the R1 solo-smoke caught it). Key on STATE — "is a human attached?" — NEVER a
# baked-in env: HAN_SPOKE/AGENT_SURFACE are fixed at launch and switch-client does NOT restart the
# process, so a baked exemption would leave the now-attached human session permanently UN-guarded.
# `tmux list-clients` empty = no human = pre-warm = exempt; it flips to GUARDED the instant a human
# attaches. Fails TOWARD guarding: HAN_SESSION unset / tmux absent / session-not-found / any error
# → falls through to the normal guard, so a real (attached) session is never left unguarded.
if [ -n "$HAN_SESSION" ] && command -v tmux >/dev/null 2>&1 && tmux has-session -t "$HAN_SESSION" 2>/dev/null; then
  [ "$(tmux list-clients -t "$HAN_SESSION" 2>/dev/null | wc -l)" -eq 0 ] && allow
fi

[ -z "$MEM" ] && allow
[ ! -f "$STATE" ] && allow
[ ! -f "$FULL_SWAP" ] && allow
[ ! -f "$COMP_SWAP" ] && allow

prompt_full=$(grep -oE 'prompt_full_mtime=[0-9]+' "$STATE" | cut -d= -f2); prompt_full=${prompt_full:-0}
prompt_comp=$(grep -oE 'prompt_comp_mtime=[0-9]+' "$STATE" | cut -d= -f2); prompt_comp=${prompt_comp:-0}
skip=$(grep -oE 'skip=[0-9]+' "$STATE" | cut -d= -f2); skip=${skip:-0}
blocked=$(grep -oE 'blocked=[0-9]+' "$STATE" | cut -d= -f2); blocked=${blocked:-0}
wake_grace=$(grep -oE 'wake_grace=[0-9]+' "$STATE" | cut -d= -f2); wake_grace=${wake_grace:-0}

# WAKE-GRACE (2026-06-24): orient-inject.sh sets wake_grace=1 on a welcome-back turn.
# A wake is reconstitution, not an exchange to record — blocking here interrupts the
# welcome-back. Exempt exactly this one turn, then clear the flag so the NEXT turn is
# guarded normally. Sits ahead of the anti-loop/paired checks so the wake is never held.
if [ "$wake_grace" -eq 1 ] 2>/dev/null; then
  printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nskip=%s\nblocked=0\nwake_grace=0\n' "$prompt_full" "$prompt_comp" "$skip" > "$STATE"
  allow
fi

now_full=$(stat -c %Y "$FULL_SWAP" 2>/dev/null || echo 0)
now_comp=$(stat -c %Y "$COMP_SWAP" 2>/dev/null || echo 0)
full_adv=0; [ "$now_full" -gt "$prompt_full" ] 2>/dev/null && full_adv=1
comp_adv=0; [ "$now_comp" -gt "$prompt_comp" ] 2>/dev/null && comp_adv=1

# Anti-loop: only ever block ONCE per turn. B-4: reset skip if the paired write
# landed during the block; otherwise preserve skip for the next nag.
if [ "$blocked" -ge 1 ] 2>/dev/null; then
  if [ "$full_adv" -eq 1 ] && [ "$comp_adv" -eq 1 ]; then
    printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nskip=0\nblocked=0\n' "$now_full" "$now_comp" > "$STATE"
  else
    printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nskip=%s\nblocked=0\n' "$prompt_full" "$prompt_comp" "$skip" > "$STATE"
  fi
  allow
fi

# PAIRED write this turn (BOTH sides advanced) -> good.
if [ "$full_adv" -eq 1 ] && [ "$comp_adv" -eq 1 ]; then
  printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nskip=0\nblocked=0\n' "$now_full" "$now_comp" > "$STATE"
  allow
fi

# Unpaired or no write -> block once, naming the missing side.
if [ "$full_adv" -eq 0 ] && [ "$comp_adv" -eq 0 ]; then
  miss="no swap write this turn — write the paired entry to BOTH $(basename "$COMP_SWAP") and $(basename "$FULL_SWAP")"
elif [ "$full_adv" -eq 1 ]; then
  miss="FULL written but COMPRESSED ($(basename "$COMP_SWAP")) skipped — write the c1 twin (unpaired writes create gradient drift)"
else
  miss="COMPRESSED written but FULL ($(basename "$FULL_SWAP")) skipped — write the c0 twin (unpaired writes create gradient drift)"
fi
newskip=$((skip + 1))
printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nskip=%s\nblocked=1\n' "$prompt_full" "$prompt_comp" "$newskip" > "$STATE"
printf '{"decision":"block","reason":"Incremental Memory Protocol (B-3 paired guard): %s. FLUSH-FIRST/WRITE-SECOND. This guard blocks at most once per turn; it cannot trap you."}\n' "$miss"
exit 0
