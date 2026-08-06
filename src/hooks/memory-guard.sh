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

# MNT-090 (2026-08-06): NO SEAT, NO GUARD. A claude invocation with no agent seat —
# AGENT_SLUG or AGENT_MEMORY_DIR unset: jemma's Haiku classifier, ad-hoc CLI runs,
# scripts — owes no swap discipline, and guarding it blocks the turn against files
# that cannot exist. The block-loop killed every Haiku classification after the
# Sunday CLI update (the new CLI honours Stop-hook blocks in -p mode), which
# silenced Discord routing garden-wide. wm-flush.sh already fail-safes this case;
# the guard now matches it. (A seatless run that SHOULD be guarded does not exist:
# the guard's whole subject is a seat's swap files.)
[ -z "${AGENT_SLUG:-}" ] && allow
[ -z "${AGENT_MEMORY_DIR:-}" ] && allow

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
# MNT-060 addendum (the sentinel-frame build): the guard is upgraded from MTIME- to
# FRAME-checking — a turn's paired write is proven by a NEW `<!-- SWAP-ENTRY ts=… -->`
# transport frame appearing in BOTH swap files. Guard and flush now cite the SAME declared
# contract (src/server/lib/swap-frame.ts is the source of truth; the suite string-compares
# this regex to it and to orient-inject.sh's — change swap-frame.ts, change all three).
# The block message below TEACHES the frame — it is the migration's own teacher; its
# `ts=<ISO>` placeholder can never itself parse as a frame (the regex requires a digit).
FRAME_RE='^<!-- SWAP-ENTRY ts=[0-9][^ ]* -->$'
prompt_full_fr=$(grep -oE 'prompt_full_frames=[0-9]+' "$STATE" | cut -d= -f2)
prompt_comp_fr=$(grep -oE 'prompt_comp_frames=[0-9]+' "$STATE" | cut -d= -f2)
skip=$(grep -oE 'skip=[0-9]+' "$STATE" | cut -d= -f2); skip=${skip:-0}
blocked=$(grep -oE 'blocked=[0-9]+' "$STATE" | cut -d= -f2); blocked=${blocked:-0}
wake_grace=$(grep -oE 'wake_grace=[0-9]+' "$STATE" | cut -d= -f2); wake_grace=${wake_grace:-0}

now_full=$(stat -c %Y "$FULL_SWAP" 2>/dev/null || echo 0)
now_comp=$(stat -c %Y "$COMP_SWAP" 2>/dev/null || echo 0)
now_full_fr=$(grep -cE "$FRAME_RE" "$FULL_SWAP" 2>/dev/null); now_full_fr=${now_full_fr:-0}
now_comp_fr=$(grep -cE "$FRAME_RE" "$COMP_SWAP" 2>/dev/null); now_comp_fr=${now_comp_fr:-0}

# One state shape everywhere: mtimes kept (legacy fallback + debugging), frame counts canonical.
state_write() { # $1 full_mtime $2 comp_mtime $3 full_frames $4 comp_frames $5 skip $6 blocked $7 wake_grace
  printf 'prompt_full_mtime=%s\nprompt_comp_mtime=%s\nprompt_full_frames=%s\nprompt_comp_frames=%s\nskip=%s\nblocked=%s\nwake_grace=%s\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" "$7" > "$STATE"
}

# WAKE-GRACE (2026-06-24): orient-inject.sh sets wake_grace=1 on a welcome-back turn.
# A wake is reconstitution, not an exchange to record — blocking here interrupts the
# welcome-back. Exempt exactly this one turn (re-baselining to the CURRENT counts so a
# pre-existing frame can't false-satisfy the next turn), then clear the flag so the NEXT
# turn is guarded normally. Sits ahead of the anti-loop/paired checks so the wake is never held.
if [ "$wake_grace" -eq 1 ] 2>/dev/null; then
  state_write "$now_full" "$now_comp" "$now_full_fr" "$now_comp_fr" "$skip" 0 0
  allow
fi

# MNT-067: the WAKE-WINDOW flag — a FED wake's grace, owned by the feeder (feedWakeSteps
# raises + heartbeat-touches it per step; lowers when the greeting turn COMPLETES). Replaces
# the retired fed-step prompt-sniffing (one echo-safety backtick defeated the old regex and
# the guard taught a loading mind to write memories about loading — Tenshi's four exhibits).
# Read at STOP-time directly (not via prompt-start state) so a flag raised mid-turn — the
# /wake spawn turn's detached feeder — still covers that turn. Ruled polarity (Darron's
# addendum): this gates the BLOCK only — wm-flush is a separate Stop hook and never reads
# this flag; a chosen noticing during the window still frames, flushes, and enters memory.
# Staleness ceiling (the crash belt, DEC-103-priced ~15min = generous multiple of the longest
# step): a stale flag reads as LOWERED + writes a stale-flag alert — a dead feeder can never
# leave this seat's guard silently off (Casey's 4th polarity: fail toward guarded-and-loud).
# Every skip is receipted (Tenshi: an exemption that fires invisibly is unauditable).
# ONE contract: the path template + ceiling mirror tmux-dispatcher.ts's wakeWindowFlagPath /
# WAKE_WINDOW_STALE_MINUTES — suite-compared (test-wake-window.ts), the gate==parser law.
WAKE_FLAG="${SIGNALS_DIR}/wake-window-${SLUG}.flag"
WAKE_WINDOW_STALE_MIN=15
WAKE_EVENTS="${HOME}/.han/health/wake-window-events.jsonl"
wake_event() { # $1 kind $2 age_min
  mkdir -p "$(dirname "$WAKE_EVENTS")" 2>/dev/null
  [ -f "$WAKE_EVENTS" ] && [ "$(stat -c %s "$WAKE_EVENTS" 2>/dev/null || echo 0)" -gt 1000000 ] && mv "$WAKE_EVENTS" "$WAKE_EVENTS.1" 2>/dev/null
  printf '{"ts":"%s","slug":"%s","kind":"%s","age_min":%s}\n' "$(date -Iseconds)" "$SLUG" "$1" "$2" >> "$WAKE_EVENTS" 2>/dev/null
}
if [ -f "$WAKE_FLAG" ]; then
  _fmt=$(stat -c %Y "$WAKE_FLAG" 2>/dev/null || echo 0)
  _age=$(( ( $(date +%s) - _fmt ) / 60 ))
  if [ "$_age" -lt "$WAKE_WINDOW_STALE_MIN" ] 2>/dev/null; then
    wake_event "flag-grace" "$_age"
    state_write "$now_full" "$now_comp" "$now_full_fr" "$now_comp_fr" "$skip" 0 0
    allow
  else
    wake_event "stale-flag" "$_age"
    # fall through GUARDED — the ceiling lapsed the window by its own terms; loud, then normal.
  fi
fi

# Advanced-this-turn: FRAME counts when the state carries frame baselines (canonical);
# mtime fallback ONLY for a stale pre-frame state (the single flip turn — never trap).
if [ -n "$prompt_full_fr" ] && [ -n "$prompt_comp_fr" ]; then
  full_adv=0; [ "$now_full_fr" -gt "$prompt_full_fr" ] 2>/dev/null && full_adv=1
  comp_adv=0; [ "$now_comp_fr" -gt "$prompt_comp_fr" ] 2>/dev/null && comp_adv=1
else
  full_adv=0; [ "$now_full" -gt "$prompt_full" ] 2>/dev/null && full_adv=1
  comp_adv=0; [ "$now_comp" -gt "$prompt_comp" ] 2>/dev/null && comp_adv=1
fi

# Anti-loop: only ever block ONCE per turn. B-4: reset skip if the paired write
# landed during the block; otherwise preserve skip for the next nag.
if [ "$blocked" -ge 1 ] 2>/dev/null; then
  if [ "$full_adv" -eq 1 ] && [ "$comp_adv" -eq 1 ]; then
    state_write "$now_full" "$now_comp" "$now_full_fr" "$now_comp_fr" 0 0 0
  else
    state_write "$prompt_full" "$prompt_comp" "${prompt_full_fr:-0}" "${prompt_comp_fr:-0}" "$skip" 0 0
  fi
  allow
fi

# PAIRED framed write this turn (BOTH sides advanced) -> good.
if [ "$full_adv" -eq 1 ] && [ "$comp_adv" -eq 1 ]; then
  state_write "$now_full" "$now_comp" "$now_full_fr" "$now_comp_fr" 0 0 0
  allow
fi

# Unpaired or no framed write -> block once, naming the missing side + teaching the frame.
frame_teach="open each entry with its transport frame <!-- SWAP-ENTRY ts=<ISO> --> on its own line (use date -Iseconds; then your ### heading + body — the frame is stripped at flush and never enters memory)"
if [ "$full_adv" -eq 0 ] && [ "$comp_adv" -eq 0 ]; then
  miss="no FRAMED swap entry this turn — write the paired entry to BOTH $(basename "$COMP_SWAP") and $(basename "$FULL_SWAP"); $frame_teach"
elif [ "$full_adv" -eq 1 ]; then
  miss="FULL framed but COMPRESSED ($(basename "$COMP_SWAP")) has no new frame — write the framed c1 twin (unpaired writes create gradient drift); $frame_teach"
else
  miss="COMPRESSED framed but FULL ($(basename "$FULL_SWAP")) has no new frame — write the framed c0 twin (unpaired writes create gradient drift); $frame_teach"
fi
newskip=$((skip + 1))
state_write "$prompt_full" "$prompt_comp" "${prompt_full_fr:-0}" "${prompt_comp_fr:-0}" "$newskip" 1 0
printf '{"decision":"block","reason":"Incremental Memory Protocol (B-3 paired guard): %s. FLUSH-FIRST/WRITE-SECOND. This guard blocks at most once per turn; it cannot trap you."}\n' "$miss"
exit 0
