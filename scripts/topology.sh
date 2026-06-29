#!/bin/bash
# topology.sh — print the LIVE filesystem + process topology of HAN.
#
# Why this exists (2026-06-30, S209): a night was lost to load-bearing
# structure that was real but undocumented — the PATH launchers are SYMLINKS
# into the code repo (so SCRIPT_DIR resolves there); the `jim-<pid>` tmux
# session is a SERVER-WATCHDOG host, not a chat session; code, PATH-launchers,
# and state live in three different roots. This script is the companion to
# docs/HAN-FILESYSTEM.md: the doc narrates, this prints the GROUND TRUTH so the
# map can never silently rot. Running it is also a fast ORIENTATION — it shows
# a fresh agent (or human) where everything actually is, right now.
#
# Read-only. Safe to run any time. Usage:
#   ./scripts/topology.sh            # print the live topology
#   ./scripts/topology.sh --check    # same, plus a PASS/WARN verdict line
#
# Tend it like meditation: when something new bites, add the check here first
# (ground truth), then a line in the doc that points back at it.

# NB: deliberately NOT `set -e` — we want every section to print even if one
# probe fails. readlink -f BASH_SOURCE so this works through the PATH symlink.
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
HAN_REPO="$(cd "$HERE/.." && pwd)"
HAN_STATE="${HAN_DIR:-$HOME/.han}"
INFRA_REPO="$HOME/Projects/infrastructure"
WARN=0

c() { printf '\033[%sm%s\033[0m' "$1" "$2"; }   # colour helper
hdr() { printf '\n%s\n' "$(c '1;36' "== $* ==")"; }
warn() { WARN=$((WARN+1)); printf '   %s %s\n' "$(c '1;33' 'WARN')" "$*"; }
ok()  { printf '   %s %s\n' "$(c '1;32' 'ok')" "$*"; }

# ── 1. ROOTS — code vs PATH-launchers vs state live in THREE places ──────────
hdr "ROOTS (three separate trees — don't conflate them)"
printf '   %-22s %s\n' "code repo:"     "$HAN_REPO   $( [ -d "$HAN_REPO/.git" ] && echo '(git)' )"
printf '   %-22s %s\n' "state (runtime):" "$HAN_STATE   $( [ -d "$HAN_STATE" ] && echo 'exists' || echo 'MISSING' )"
printf '   %-22s %s\n' "infra/PATH repo:" "$INFRA_REPO   $( [ -d "$INFRA_REPO/.git" ] && echo '(git)' )"
echo   "   verify: readlink -f \$(command -v hanjim)   # = a launcher inside the code repo"

# ── 2. LAUNCHERS — the symlink trap (tonight's bite) ─────────────────────────
hdr "LAUNCHERS on PATH (han<agent>) — each should be a SYMLINK into the code repo"
for slug in leo jim tenshi casey; do
  name="han$slug"
  onpath="$(command -v "$name" 2>/dev/null)"
  if [ -z "$onpath" ]; then printf '   %-12s %s\n' "$name" "$(c '1;33' 'not on PATH')"; continue; fi
  link="$(readlink "$onpath" 2>/dev/null)"
  resolved="$(readlink -f "$onpath" 2>/dev/null)"
  if [ -L "$onpath" ]; then
    printf '   %-12s symlink → %s\n' "$name" "$resolved"
    case "$resolved" in
      "$HAN_REPO"/*) : ;;                       # good: resolves into the code repo
      *) warn "$name resolves OUTSIDE the code repo ($resolved)" ;;
    esac
  else
    warn "$name on PATH is a REGULAR FILE ($onpath) — not a symlink into $HAN_REPO."
    warn "  → SCRIPT_DIR will resolve to the wrong repo. Restore: ln -sf $HAN_REPO/scripts/$name $onpath"
    warn "  → (this is exactly what 'sed -i' on the symlink caused on 2026-06-30; use --follow-symlinks or edit the target)"
  fi
done
echo "   verify: ls -l \$(command -v hanleo) ; readlink -f \$(command -v hanleo)"

# ── 3. AGENT SERVERS — watchdog-hosted in tmux, NOT systemd ──────────────────
hdr "AGENT SERVERS (ports 3847=leo / 3848=jim) — run by agent-server-watchdog.sh in tmux"
for portpair in "3847 leo" "3848 jim"; do
  set -- $portpair; port="$1"; who="$2"
  listener="$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)"
  if [ -n "$listener" ]; then ok "$who server ($port) LISTENING (pid $listener)"
  else warn "$who server ($port) is DOWN (nothing listening)"; fi
  wd="$(pgrep -af "agent-server-watchdog.sh $who" | grep -v 'grep\|claude-\|topology' | grep -oP '^[0-9]+' | head -1)"
  [ -n "$wd" ] && printf '       watchdog pid %s ; host tmux session: %s\n' "$wd" "$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^$who-" | head -1)"
done
echo   "   NOTE: a 'jim-<pid>' / 'leo-<pid>' tmux session may HOST the server-watchdog —"
echo   "         killing it takes the server DOWN. It is NOT (only) a chat session."
echo   "   verify: ss -tlnp | grep -E ':3847|:3848' ; pgrep -af agent-server-watchdog"

# ── 4. STATE TREE — what lives under ~/.han ──────────────────────────────────
hdr "STATE TREE under $HAN_STATE (per-agent identity/memory + runtime signals)"
for d in agents memory health signals sleeves logs; do
  printf '   %-10s %s\n' "$d/" "$( [ -d "$HAN_STATE/$d" ] && echo "$(find "$HAN_STATE/$d" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l | tr -d ' ') entries" || echo '—' )"
done
echo   "   agent memory: \$AGENT_MEMORY_DIR (jim = $HAN_STATE/memory [root-special]; others = $HAN_STATE/memory/<slug>)"

# ── 5. FROZEN-AT-LAUNCH — env + hook list are fixed when a session starts ────
hdr "FROZEN-AT-LAUNCH (env + Stop-hook list are read once, at session launch)"
echo  "   A running session does NOT pick up new env (-e forwards) or newly-registered"
echo  "   hooks until it is RELAUNCHED. /clear resets the conversation, not the process."
echo  "   verify (inside a session): echo \"\$AGENT_SWAP_FULL\"   # empty = launched before the MNT-013 fix"

if [ "${1:-}" = "--check" ]; then
  echo
  if [ "$WARN" -eq 0 ]; then printf '%s\n' "$(c '1;32' "VERDICT: topology healthy — 0 warnings")"
  else printf '%s\n' "$(c '1;33' "VERDICT: $WARN warning(s) above — see WARN lines")"; fi
fi
