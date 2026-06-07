#!/usr/bin/env bash
# doc-debt.sh — the persistent doc-debt nag (#69 follow-up, S166).
#
# Read-only. The ledger claude-context/DOC_DEBT.md is the source of truth for
# repayment status; this script surfaces OUTSTANDING debt (escalating by age)
# and flags any Docs-skipped commit that isn't in the ledger yet.
#
# Standalone:   ./scripts/doc-debt.sh
# As a nag:     call from .git/hooks/pre-commit so every commit prints the debt
#               banner until it's cleared (the "annoying" requirement, Darron S166).
#
# Exit code is always 0 (informational); the *acknowledgement gate* (a commit
# must pay or carry `Doc-debt-ack:` past a threshold) is a separate commit-msg
# check — see DOC_DEBT.md. Kept advisory here so it never hard-blocks a commit
# that legitimately needs to land.

set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "doc-debt: not a git repo"; exit 0; }
LEDGER="$ROOT/claude-context/DOC_DEBT.md"
NOW=$(date +%s)
outstanding=0

echo "── doc-debt scan ($(date '+%F %H:%M')) ─────────────────────"

# 1. OUTSTANDING rows in the ledger — escalate the loudness by age.
if [[ -f "$LEDGER" ]]; then
  while IFS= read -r row; do
    hash=$(printf '%s' "$row" | grep -oE '[0-9a-f]{7,40}' | head -1)
    [[ -z "$hash" ]] && continue
    ts=$(git show -s --format=%ct "$hash" 2>/dev/null || echo "$NOW")
    age=$(( (NOW - ts) / 86400 ))
    note=$(printf '%s' "$row" | awk -F'|' '{print $4}' | sed 's/^ *//;s/ *$//')
    mark="⚠"; [[ $age -ge 1 ]] && mark="⚠⚠"; [[ $age -ge 3 ]] && mark="🔴🔴🔴"
    echo "  $mark OUTSTANDING ${age}d  $hash  $note"
    outstanding=$((outstanding+1))
  done < <(grep -E '^\|.*OUTSTANDING' "$LEDGER" 2>/dev/null)
else
  echo "  (no ledger at $LEDGER — create it to start tracking)"
fi

# 2. Ledger-drift: Docs-skipped commits not yet recorded in the ledger.
while IFS= read -r h; do
  [[ -z "$h" ]] && continue
  grep -q "$h" "$LEDGER" 2>/dev/null || echo "  ✱ UN-LEDGERED skip: $h — add a row to DOC_DEBT.md"
done < <(git log --grep='Docs-skipped:' --format='%h' 2>/dev/null | head -100)

if [[ "$outstanding" -eq 0 ]]; then
  echo "  ✓ ledger shows no outstanding doc-debt."
else
  printf '  %s\n' \
    "════════════════════════════════════════════════════" \
    "⚠  $outstanding DOC-DEBT(S) UNPAID — this nag escalates daily." \
    "   Pay the doc, or add to your next commit message:" \
    "   Doc-debt-ack: <hash> still-deferred: <reason>" \
    "   (#69 — doc-debt becomes structural, not hopeful.)" \
    "════════════════════════════════════════════════════"
fi
exit 0
