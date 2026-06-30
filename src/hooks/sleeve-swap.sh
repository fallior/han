#!/bin/bash
# Sleeve-state swap-prefix resolver (R2 P-R2.2b, DEC-099 / Fork A). Prints the sleeve's swap-buffer
# PREFIX (`<prefix>.md` = compressed, `<prefix>-full.md` = full) from ~/.han/sleeves/$HAN_SESSION.json,
# else **nothing** — so the caller keeps its $AGENT_SWAP_* fallback (inert today). The .sh twin of
# sleeve-state.ts:sleeveSwapPrefix (keep in lockstep). For the memory hooks (memory-guard, wm-flush) —
# shells only standard-PATH jq (the MNT-015 lesson: no tsx on a hot-path hook). Fail-soft: any
# absent/unreadable/malformed → empty → fallback.
SLEEVE="${HOME}/.han/sleeves/${HAN_SESSION}.json"
if [ -n "$HAN_SESSION" ] && [ -f "$SLEEVE" ] && command -v jq >/dev/null 2>&1; then
  jq -r '.swapPrefix // empty' "$SLEEVE" 2>/dev/null
fi
