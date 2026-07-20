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

# Derive the repo root from this script's own location (src/hooks/ → ../.. = root) — portable, no
# hardcoded path (#101; Jim's MNT-013 fold-in), so it works for any garden ($HOME), not just this one.
REPO="${HAN_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MEM="${AGENT_MEMORY_DIR:-}"
# R2 P-R2.2b (Fork A): resolve the swap pair off the sleeve (sleeved surface's prefix), fallback $AGENT_SWAP_* (inert today).
_sp="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-swap.sh" 2>/dev/null)"
if [ -n "$_sp" ]; then FULL_SWAP="${MEM}/${_sp}-full.md"; COMP_SWAP="${MEM}/${_sp}.md"
else FULL_SWAP="${MEM}/${AGENT_SWAP_FULL:-session-swap-full.md}"; COMP_SWAP="${MEM}/${AGENT_SWAP_COMPRESSED:-session-swap.md}"; fi
SLUG="${AGENT_SLUG:-unknown}"

[ -z "$MEM" ] && exit 0
[ ! -f "$FULL_SWAP" ] && exit 0
[ ! -f "$COMP_SWAP" ] && exit 0

# No-op unless BOTH swap files carry a real entry. MNT-060 F1: the gate greps the IDENTICAL
# entry-grammar FAMILY as wm-flush.ts's ENTRY_RE (`### ` canonical + `## ` legacy) — change one,
# change both; a gate/parser mismatch recreates the MNT-060 outage inside the fix (the gate
# declining bodies the parser could eat, or vice versa: the original defect was this gate + parser
# both keying `### ` while every seat wrote `## ` — a garden-wide silent no-op for 13 days).
# Keying on ENTRY markers — not "any non-header line" — stays robust to every header shape (Jim's
# MNT-012 catch). Cheap, so spoke turns (diary path, no entry marker in swap) never spawn tsx.
# TRANSITIONAL (MNT-060 addendum, Darron 2026-07-20 22:27): this content-shaped family is a
# stopgap; the destination is the sentinel transport-frame (byte-stuffed, stripped at flush,
# guard-checks-frame) — a named follow-on build.
has_body() { grep -qE '^(### |## )' "$1"; }
has_body "$FULL_SWAP" || exit 0
has_body "$COMP_SWAP" || exit 0

# Flush via the atomic paired writer (appendPairedMemory, #49) in a tsx one-shot — atomicity
# (both-or-neither, refuses asymmetric) is the reason this is TS not a bash append. The script
# resets the swap ONLY on a successful paired append (else preserves it for retry).
#
# Resolve node + the LOCAL tsx binary EXPLICITLY — do NOT rely on `npx` or the tsx shebang's
# `env node` (MNT-015, Jim's trace): the harness spawns this Stop hook with a PATH that LACKS
# nvm's node bin (where `npx` lives) — so bare `npx` is not-found and silently no-ops — and the
# tsx shebang's `env node` would otherwise resolve an ancient system `/usr/bin/node` and crash on
# tsx's modern ESM. The sibling Stop hooks (memory-guard/wake-ctx) work because they shell only
# standard-PATH tools (grep/jq); this one needs node. So resolve node nvm-aware + portably
# (#101 — newest installed version under $NVM_DIR, no hardcoded path; agnostic across gardens),
# and invoke the local tsx binary as its argument (the systemd units' canonical pattern).
cd "$REPO/src/server" 2>/dev/null || exit 0
TSX="$REPO/src/server/node_modules/.bin/tsx"
[ -x "$TSX" ] || exit 0
NODE_BIN=""
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -d "$NVM_DIR/versions/node" ]; then
  _nv="$(ls -1 "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)"
  [ -n "$_nv" ] && [ -x "$NVM_DIR/versions/node/$_nv/bin/node" ] && NODE_BIN="$NVM_DIR/versions/node/$_nv/bin/node"
fi
# Fallback: a node already on PATH (interactive / systemd contexts have the right one first).
[ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1 && NODE_BIN="$(command -v node)"
[ -z "$NODE_BIN" ] && exit 0   # fail-safe: no usable node -> no-op, swap preserved for retry
# MNT-060 F4 (DEC-103 fail-state CBA): `timeout 30` is sufficient BY CONSTRUCTION — F3 caps any
# single flush body at swapFlushMaxBytes (~20K; a measured 9.5K flush took ~2s), and every larger
# backlog is alert-and-preserve (never attempted here). Worst case on timeout: the tsx is killed,
# the swap is PRESERVED (reset only happens after a successful append), and the next Stop retries
# — alert-and-retry, not silent loss. Errors are legible via ~/.han/health/wm-flush-errors.jsonl
# (F2, written by the tsx itself); the >/dev/null covers stdout noise only.
NODE_PATH="$(pwd)/node_modules" timeout 30 "$NODE_BIN" "$TSX" ../../scripts/wm-flush.ts "$SLUG" "$FULL_SWAP" "$COMP_SWAP" >/dev/null 2>&1
exit 0
