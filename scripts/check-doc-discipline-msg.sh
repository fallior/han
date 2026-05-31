#!/bin/bash
# check-doc-discipline-msg.sh — commit-msg hook companion to check-doc-discipline.sh
#
# The pre-commit hook fires BEFORE the commit message is composed, so its
# opt-out check against COMMIT_EDITMSG sees either a stale prior message or
# the merge-template default. This commit-msg hook fires AFTER the message
# is composed (or amended) and validates the opt-out trailer against the
# actual message about to be committed.
#
# Behaviour:
# - If pre-commit already validated docs-touched, this is a no-op
# - If pre-commit relied on the "Docs-skipped:" opt-out, this validates
#   the reason is specific (not "no docs needed" / "n/a" / etc.)
# - If neither condition holds, BLOCKS the commit
#
# Per the doc-discipline contract: explicit opt-outs are fine when honest;
# generic opt-outs are the failure mode the discipline guards against.

set -e

MSG_FILE="$1"
if [[ -z "$MSG_FILE" ]] || [[ ! -f "$MSG_FILE" ]]; then
    # Defensive — git always passes a path; if absent, fail open
    exit 0
fi

# Re-derive the staged-files check that pre-commit ran
STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
if [[ -z "$STAGED" ]]; then
    exit 0
fi

CODE_TRIGGER_PATTERNS=(
    'src/server/lib/'
    'src/server/services/'
    'src/server/routes/'
    'src/server/'
    'src/ui/'
    'src/scripts/'
    'scripts/'
)
DOC_SATISFACTION_PATTERNS=(
    'docs/'
    'claude-context/'
    'plans/'
    'README.md'
    'CHANGELOG.md'
    'templates/'
    '.SHAPE.md'
)

CODE_TOUCHED=0
for f in $STAGED; do
    for pat in "${CODE_TRIGGER_PATTERNS[@]}"; do
        if [[ "$f" == ${pat}* ]]; then CODE_TOUCHED=1; break 2; fi
    done
done
[[ $CODE_TOUCHED -eq 0 ]] && exit 0

DOCS_TOUCHED=0
for f in $STAGED; do
    for pat in "${DOC_SATISFACTION_PATTERNS[@]}"; do
        if [[ "$f" == ${pat}* ]] || [[ "$f" == *${pat} ]]; then DOCS_TOUCHED=1; break 2; fi
    done
done
[[ $DOCS_TOUCHED -eq 1 ]] && exit 0

# Code touched, no docs touched — opt-out trailer must be present + specific
SKIP_LINE=$(grep -E '^Docs-skipped:' "$MSG_FILE" | head -1)
if [[ -z "$SKIP_LINE" ]]; then
    {
        echo
        echo "[doc-discipline] No 'Docs-skipped:' trailer in commit message."
        echo "  The pre-commit hook allowed this commit because COMMIT_EDITMSG"
        echo "  contained one, but the final message doesn't. Add the line"
        echo "  back or stage docs to fix."
        echo
    } >&2
    exit 1
fi

REASON=$(echo "$SKIP_LINE" | sed 's/^Docs-skipped:[[:space:]]*//')
# Reject generic / lazy reasons
GENERIC_PATTERNS=(
    'no docs needed'
    'n/a'
    'na'
    'none'
    'nothing'
    'no docs'
    'skip'
    'no doc'
    'not needed'
)
REASON_LOWER=$(echo "$REASON" | tr '[:upper:]' '[:lower:]' | sed 's/[[:punct:]]//g' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

for pat in "${GENERIC_PATTERNS[@]}"; do
    if [[ "$REASON_LOWER" == "$pat" ]]; then
        {
            echo
            echo "[doc-discipline] 'Docs-skipped' reason too generic: \"$REASON\""
            echo "  The reason must be specific enough that future-you (or another"
            echo "  agent) reading the commit log understands WHY no docs were touched."
            echo "  Examples of acceptable reasons:"
            echo "    Docs-skipped: type-system-internal change with no user-facing surface"
            echo "    Docs-skipped: test-only refactor; behaviour documented in test names"
            echo "    Docs-skipped: build-tooling tweak; no architectural surface affected"
            echo "  Examples REJECTED (generic):"
            echo "    Docs-skipped: no docs needed"
            echo "    Docs-skipped: n/a"
            echo "    Docs-skipped: skip"
            echo
        } >&2
        exit 1
    fi
done

# Reason length sanity — under 15 chars is suspicious
REASON_LEN=${#REASON}
if [[ $REASON_LEN -lt 15 ]]; then
    {
        echo
        echo "[doc-discipline] 'Docs-skipped' reason too short ($REASON_LEN chars): \"$REASON\""
        echo "  Provide a reason at least 15 chars long that explains the WHY."
        echo
    } >&2
    exit 1
fi

# Accepted — log to stderr for visibility
echo "[doc-discipline] Docs explicitly skipped: $REASON" >&2
exit 0
