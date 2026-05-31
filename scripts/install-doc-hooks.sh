#!/bin/bash
# install-doc-hooks.sh — install local git hooks that enforce the
# parallel-doc-maintenance discipline per future-idea #69.
#
# Run once after clone. The hooks are written to .git/hooks/ which is local
# (not tracked) — so this script is the canonical install path. Mirrors
# the install-restart-hooks.sh pattern.
#
# Hooks installed:
#   pre-commit (appended) — calls check-doc-discipline.sh; blocks commits
#     that touch code-trigger surfaces without ALSO touching doc surfaces,
#     unless an opt-out trailer is present in COMMIT_EDITMSG.
#   commit-msg (created)   — calls check-doc-discipline-msg.sh; validates
#     the opt-out trailer's reason is specific (rejects generic skips
#     like "no docs needed").
#
# Bypass: `git commit --no-verify` skips both hooks. This is by design —
# deliberate skips are audit-visible in git reflog; habit-style skips fail
# loud. Same shape as the audit-rhythm-at-prompt-language-layer pattern
# extended to the code-vs-doc layer.
#
# Filed 2026-05-31 per Darron's directive after the doc-staleness audit
# (CURRENT_STATUS 14d stale, patterns.md 10d stale, HAN-ECOSYSTEM-COMPLETE
# 12d stale across the C1 + silent-fail + #67 work).

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
PRE_CHECK="$REPO_ROOT/scripts/check-doc-discipline.sh"
MSG_CHECK="$REPO_ROOT/scripts/check-doc-discipline-msg.sh"

if [[ ! -x "$PRE_CHECK" ]]; then
    chmod +x "$PRE_CHECK" 2>/dev/null || true
    if [[ ! -x "$PRE_CHECK" ]]; then
        echo "Error: $PRE_CHECK not found or not executable" >&2
        exit 1
    fi
fi
if [[ ! -x "$MSG_CHECK" ]]; then
    chmod +x "$MSG_CHECK" 2>/dev/null || true
    if [[ ! -x "$MSG_CHECK" ]]; then
        echo "Error: $MSG_CHECK not found or not executable" >&2
        exit 1
    fi
fi

# pre-commit: APPEND if existing (don't clobber restart-hooks if those land here),
# CREATE if absent. Idempotent: skip if our marker is already present.
PRE_HOOK="$HOOKS_DIR/pre-commit"
MARKER="# DOC-DISCIPLINE-HOOK (future-idea #69)"

if [[ -f "$PRE_HOOK" ]] && grep -qF "$MARKER" "$PRE_HOOK"; then
    echo "pre-commit: marker present, skipping (already installed)"
else
    if [[ ! -f "$PRE_HOOK" ]]; then
        echo "#!/bin/bash" > "$PRE_HOOK"
        echo "set -e" >> "$PRE_HOOK"
        echo "" >> "$PRE_HOOK"
    fi
    {
        echo ""
        echo "$MARKER"
        echo "\"$PRE_CHECK\""
    } >> "$PRE_HOOK"
    chmod +x "$PRE_HOOK"
    echo "Installed: $PRE_HOOK (appended doc-discipline check)"
fi

# commit-msg: CREATE / OVERWRITE — this hook is single-purpose for #69
MSG_HOOK="$HOOKS_DIR/commit-msg"
{
    echo "#!/bin/bash"
    echo "# Auto-installed by scripts/install-doc-hooks.sh"
    echo "$MARKER"
    echo "\"$MSG_CHECK\" \"\$1\""
} > "$MSG_HOOK"
chmod +x "$MSG_HOOK"
echo "Installed: $MSG_HOOK (doc-discipline message validation)"

echo
echo "Done. From the next commit forward:"
echo "  - Code touching src/server/, scripts/, src/ui/, etc. requires either:"
echo "    1. Matching doc updates staged (docs/, claude-context/, plans/, etc.)"
echo "    2. Specific 'Docs-skipped: <reason>' trailer in commit message"
echo "  - Generic skip reasons ('n/a', 'no docs needed') are rejected"
echo "  - Bypass via 'git commit --no-verify' is audit-visible"
echo
echo "Filed as future-idea #69's first concrete mechanism. SHAPE.md-style"
echo "fine-grained doc-trigger surfaces + periodic audit script + DEC"
echo "promotion deferred until the discipline proves itself in practice."
