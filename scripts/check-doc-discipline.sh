#!/bin/bash
# check-doc-discipline.sh — pre-commit guard that enforces parallel doc maintenance
#
# Filed 2026-05-31 per Darron's directive after the doc-staleness audit revealed
# CURRENT_STATUS.md (14d stale), patterns.md (10d stale), HAN-ECOSYSTEM-COMPLETE
# (12d stale), CHANGELOG.md stale — across the C1 migration close + tmux harness +
# silent-fail audit cycle. Documentation lag is one of the most important measures
# of code integrity and the principal capture-mechanism for drift. The "docs as we
# go" promise had empirically slipped; the architectural cure is to make the
# discipline structural rather than habitual.
#
# Mechanism: when staged code touches doc-trigger surfaces (src/server/lib/,
# src/server/services/, src/server/routes/, src/server/, scripts/, top-level
# src/), this script requires the commit to EITHER also touch a doc surface
# (docs/, claude-context/, plans/, README.md, CHANGELOG.md) OR include an
# explicit opt-out trailer in the commit message: "Docs-skipped: <reason>"
# (the reason must be specific — e.g. "type-system-internal change with no
# surface documented", NOT generic "no docs needed").
#
# Operator can also bypass via `git commit --no-verify` — explicit, visible,
# auditable in git reflog. Habit-style skips should fail loud; deliberate
# skips should be explicit. Same shape as the audit-rhythm at the prompt-
# language layer (silent-fail-directive-audit) extended to the code-vs-doc
# layer.
#
# Filed as future-idea #69's first concrete mechanism. SHAPE.md-style
# fine-grained doc-trigger surfaces + periodic audit script + DEC promotion
# deferred until the discipline proves itself over a few weeks.

set -e

# Code-trigger surfaces: if a staged file matches one of these prefixes, doc
# review is required. Order matches the audit-rhythm's trigger surfaces.
CODE_TRIGGER_PATTERNS=(
    'src/server/lib/'
    'src/server/services/'
    'src/server/routes/'
    'src/server/'
    'src/ui/'
    'src/scripts/'
    'scripts/'
)

# Doc-satisfaction surfaces: if ANY of these are also staged, the discipline
# is satisfied. plans/ counts because design conversations capture intent
# even when CURRENT_STATUS hasn't caught up.
DOC_SATISFACTION_PATTERNS=(
    'docs/'
    'claude-context/'
    'plans/'
    'README.md'
    'CHANGELOG.md'
    'templates/'
    '.SHAPE.md'
)

# Read staged files
STAGED=$(git diff --cached --name-only --diff-filter=ACMR)

if [[ -z "$STAGED" ]]; then
    # Nothing staged; nothing to enforce
    exit 0
fi

# Determine if any code-trigger surface is touched
CODE_TOUCHED=0
TOUCHED_CODE=()
for f in $STAGED; do
    for pat in "${CODE_TRIGGER_PATTERNS[@]}"; do
        if [[ "$f" == ${pat}* ]]; then
            CODE_TOUCHED=1
            TOUCHED_CODE+=("$f")
            break
        fi
    done
done

if [[ $CODE_TOUCHED -eq 0 ]]; then
    # No code-trigger surface touched; no doc requirement
    exit 0
fi

# Determine if any doc-satisfaction surface is touched
DOCS_TOUCHED=0
TOUCHED_DOCS=()
for f in $STAGED; do
    for pat in "${DOC_SATISFACTION_PATTERNS[@]}"; do
        if [[ "$f" == ${pat}* ]] || [[ "$f" == *${pat} ]]; then
            DOCS_TOUCHED=1
            TOUCHED_DOCS+=("$f")
            break
        fi
    done
done

if [[ $DOCS_TOUCHED -eq 1 ]]; then
    # Discipline satisfied via touched docs
    exit 0
fi

# No docs touched. Check for explicit opt-out in the prepared commit message.
# Pre-commit doesn't have access to the message yet, so we check the most
# recent COMMIT_EDITMSG if present. The commit-msg hook is the right place
# for opt-out validation against the actual message — see install-doc-hooks.sh.
COMMIT_MSG_FILE="$(git rev-parse --git-path COMMIT_EDITMSG)"
if [[ -f "$COMMIT_MSG_FILE" ]]; then
    if grep -qE '^Docs-skipped:[[:space:]]*\S' "$COMMIT_MSG_FILE"; then
        # Explicit opt-out with reason — log to stderr for visibility but proceed
        SKIP_REASON=$(grep -E '^Docs-skipped:' "$COMMIT_MSG_FILE" | head -1 | sed 's/^Docs-skipped:[[:space:]]*//')
        echo "[doc-discipline] Docs explicitly skipped: $SKIP_REASON" >&2
        exit 0
    fi
fi

# Discipline NOT satisfied — block the commit
{
    echo
    echo "════════════════════════════════════════════════════════════════"
    echo "  DOC DISCIPLINE: commit blocked — code touched, no docs updated"
    echo "════════════════════════════════════════════════════════════════"
    echo
    echo "Code-trigger files staged:"
    for f in "${TOUCHED_CODE[@]:0:10}"; do echo "  - $f"; done
    if [[ ${#TOUCHED_CODE[@]} -gt 10 ]]; then
        echo "  (+ $((${#TOUCHED_CODE[@]} - 10)) more)"
    fi
    echo
    echo "Doc-satisfaction surfaces (one of these must ALSO be staged):"
    for pat in "${DOC_SATISFACTION_PATTERNS[@]}"; do echo "  - $pat"; done
    echo
    echo "Three ways to proceed:"
    echo "  1. Stage matching doc updates and re-commit (preferred)"
    echo "  2. Add 'Docs-skipped: <specific-reason>' line to commit message"
    echo "     (the reason must be specific — 'no docs needed' is rejected)"
    echo "  3. Bypass with 'git commit --no-verify' (deliberate; audit-visible)"
    echo
    echo "Promise: this is the parallel-doc-maintenance discipline per"
    echo "future-idea #69. Drift is the principal failure mode of the"
    echo "'code is source of truth' claim; the hook fails loud so drift"
    echo "can't compound silently."
    echo "════════════════════════════════════════════════════════════════"
    echo
} >&2

exit 1
