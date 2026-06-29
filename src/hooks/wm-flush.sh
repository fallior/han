#!/bin/bash
# Hortus Arbor Nostra — WM-Flush (Stop hook) — #50 / MNT-012: harness-enforced per-turn
# swap → working-memory flush. The structural endpoint of DEC-085's FLUSH-FIRST: after each
# turn, the swap the seat wrote THIS turn is flushed (atomically, paired) into the canonical
# working-memory pair and the swap reset to header-only — so the shared WM is DURABLY CURRENT
# every turn (catastrophe insurance + warm-spoke re-sleeve currency + continuity: "I just did
# this" means now, not at the next /pfc). DEC-085 decided this; #50 (deferred) is the hook that
# makes it structural rather than agent-discipline (which drifted — S163 instruction-vs-structure).
#
# Runs AFTER memory-guard.sh in the Stop array: the guard asserts the swap advanced this turn,
# then this persists+clears it — they compose, don't fight.
#
# FAIL-SAFE BY DESIGN — any uncertainty → exit 0 doing nothing (NEVER block a turn-end):
#   • $AGENT_MEMORY_DIR unset · either swap file missing · empty swap (no paired turn-write) → no-op
#   • the tsx flush failing → the flush script preserves the swap (resets only on success), so the
#     next Stop / the /pfc Step-0 sweep retries; a turn is never lost.
# Agent-agnostic (DEC-081): resolves swap from $AGENT_SWAP_* / session-swap*.md defaults.
# NOTE (R2, MNT-012↔R2 intersection): this is a surface-keyed swap consumer — when R2 lands the
# sleeve-state resolver, wm-flush folds onto it (P-R2.2) alongside the sentinel/guard/swap rows.

REPO="${HAN_REPO:-/home/darron/Projects/han}"
MEM="${AGENT_MEMORY_DIR:-}"
FULL_SWAP="${MEM}/${AGENT_SWAP_FULL:-session-swap-full.md}"
COMP_SWAP="${MEM}/${AGENT_SWAP_COMPRESSED:-session-swap.md}"
SLUG="${AGENT_SLUG:-unknown}"

[ -z "$MEM" ] && exit 0
[ ! -f "$FULL_SWAP" ] && exit 0
[ ! -f "$COMP_SWAP" ] && exit 0

# No-op unless BOTH swap files carry a real entry (a `### ` line = a paired turn-write). Keying on
# the `### ` ENTRY marker — not "any non-header line" — is robust to every header shape (1-line,
# 3-line `# …/blank/> blurb`, or no `#` line): a header-only swap has no `### ` → no-op. (Jim's
# MNT-012 catch: the old "skip line 1, any non-blank = body" awk let a 3-line header's `> blurb`
# trip the gate → spokes spawned tsx + flushed the blurb.) Cheap, so spoke turns (diary path, no
# `### ` in swap) never spawn tsx.
has_body() { grep -q '^### ' "$1"; }
has_body "$FULL_SWAP" || exit 0
has_body "$COMP_SWAP" || exit 0

# Flush via the atomic paired writer (appendPairedMemory, #49) in a tsx one-shot — atomicity
# (both-or-neither, refuses asymmetric) is the reason this is TS not a bash append. The script
# resets the swap ONLY on a successful paired append (else preserves it for retry).
cd "$REPO/src/server" 2>/dev/null || exit 0
NODE_PATH="$(pwd)/node_modules" timeout 30 npx tsx ../../scripts/wm-flush.ts "$SLUG" "$FULL_SWAP" "$COMP_SWAP" >/dev/null 2>&1
exit 0
