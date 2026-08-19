#!/bin/bash
# hearth-pulse-pull.sh — Layer-1 boundary PULL for the interactive seat's hearth pulse
# (warm-checkout P2; Tenshi F2's direction, thread msz950i2).
#
# WHY PULL: `send-keys` into a pane where a human may be mid-composition CONCATENATES
# the pulse text with their half-typed prompt (demonstrated at the character layer,
# 2026-08-18) — so the interactive seat's pulse must NEVER be typed into its box.
# This hook runs at Stop — a turn boundary the seat already owns — and delivers the
# pulse through the harness's own feedback channel instead.
#
# MECHANICS: lib/session-hearth.ts (the checker in the per-agent server) computes
# due-ness from disk (cli-busy mtime + last-pulse stamp; no HTTP route — F3) and writes
# a due-file whose message was materialised AT WRITE TIME (§2.8 — this hook fetches no
# config). We consume BEFORE emitting, so delivery is at-most-once and the follow-up
# Stop after the pulse turn passes clean (no loop by construction).
#
# Registration: ~/.claude/settings.json Stop array, AFTER memory-guard + wm-flush.
# Registration is LAUNCH-FROZEN per session (S209) — live for new seats on save.

set -u

SLUG="${AGENT_SLUG:-}"
[ -z "$SLUG" ] && exit 0

# Surface resolution mirrors src/hooks/sleeve-surface.sh (P-R2.2c): sleeve first,
# $AGENT_SURFACE fallback. Only the interactive session seat pulls pulses.
_sf=""
if [ -n "${HAN_SESSION:-}" ] && [ -f "$HOME/.han/sleeves/$HAN_SESSION.json" ]; then
  _sf=$(jq -r '.surface // empty' "$HOME/.han/sleeves/$HAN_SESSION.json" 2>/dev/null)
fi
_sf="${_sf:-${AGENT_SURFACE:-session}}"
[ "$_sf" = "session" ] || exit 0

DUE="$HOME/.han/health/hearth-due-${SLUG}-session.json"
[ -f "$DUE" ] || exit 0

MSG=$(jq -r '.message // empty' "$DUE" 2>/dev/null)
rm -f "$DUE"   # consume FIRST: at-most-once, loop-free
[ -n "$MSG" ] || exit 0

{
  echo "Hearth pulse (boundary pull — the seat's own turn end, never your input box):"
  echo "$MSG"
  echo "(Covenant: check the board honestly; an empty board makes quiet work honest work. This fired because the seat was idle past the pulse interval — activity is the reset.)"
} >&2
exit 2
