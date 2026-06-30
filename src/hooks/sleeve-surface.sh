#!/bin/bash
# Sleeve-state resolver — .sh twin (R2 P-R2.1, DEC-099 / Fork A). Prints the resolved SURFACE for
# the current session: the sleeve-state file's `.surface` keyed by $HAN_SESSION, else $AGENT_SURFACE
# (then `session`). For hooks (wake-ctx-log, later wm-flush/memory-guard) — keep it shelling only
# standard-PATH tools (jq from /usr/bin), NOT tsx, so it works under the harness's stripped hook
# PATH (the MNT-015 lesson). MUST stay in lockstep with the .ts twin: src/server/lib/sleeve-state.ts
# (sleeveSurface). Fail-soft: any absent/unreadable/malformed file → fall back (never break a turn).
#
# Usage: surface="$(bash .../sleeve-surface.sh)"   # or: SURFACE_OVERRIDE for the fallback
FALLBACK="${AGENT_SURFACE:-session}"
SLEEVE="${HOME}/.han/sleeves/${HAN_SESSION}.json"

if [ -n "$HAN_SESSION" ] && [ -f "$SLEEVE" ] && command -v jq >/dev/null 2>&1; then
  surf="$(jq -r '.surface // empty' "$SLEEVE" 2>/dev/null)"
  if [ -n "$surf" ]; then printf '%s\n' "$surf"; exit 0; fi
fi
printf '%s\n' "$FALLBACK"
