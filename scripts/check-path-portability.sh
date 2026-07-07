#!/usr/bin/env bash
# check-path-portability.sh — the P0 standing lint (S218; #101; Jim's "worth a standing lint").
# Blocks a commit that stages an ENGINE file carrying an absolute user path (/home/<user>).
# The engine must be portable: paths resolve via src/server/lib/paths.ts (TS) or
# src/hooks/paths.sh (shell) — never a literal. We stopped minting new ones the same
# day we killed the old (the wm-flush.sh lesson: even a brand-new file grew one).
#
# Sibling of check-doc-discipline.sh (#69) — same fail-loud shape, same escape hatch:
# a commit-msg line `Paths-waived: <specific reason>` bypasses (audit-visible), for the
# rare legitimate case (e.g. a doc QUOTING a path in an example).

set -euo pipefail
ENGINE_DIRS_RE='^(src/|scripts/|templates/|systemd/)'
# ANY absolute user-home literal is non-portable (not just ours) — and this regex form
# cannot match its own source (the '[' after /home/ is outside the char class), so the
# lint never blocks itself. Excludes systemd's %h and $HOME/$HAN_* forms by construction.
PATTERN='/home/[a-zA-Z0-9_-]+'

MSGFILE="${1:-}"   # commit-msg hook passes the message file; empty at bare pre-commit use
staged=$(git diff --cached --name-only --diff-filter=ACM | grep -E "$ENGINE_DIRS_RE" || true)
[ -z "$staged" ] && exit 0

offenders=""
while IFS= read -r f; do
    # check the STAGED content, not the worktree
    if git show ":$f" 2>/dev/null | grep -Eq "$PATTERN"; then
        offenders="$offenders  - $f\n"
    fi
done <<< "$staged"

[ -z "$offenders" ] && exit 0

# escape hatch: an explicit waiver in the commit message (the hook's $1 per the #69 pattern)
if [ -n "$MSGFILE" ] && [ -f "$MSGFILE" ] && grep -q "^Paths-waived: ..*" "$MSGFILE"; then
    exit 0
fi

cat >&2 << BANNER
════════════════════════════════════════════════════════════════
  PATH PORTABILITY: commit blocked — engine file carries a /home/<user> literal
════════════════════════════════════════════════════════════════

Staged engine files with absolute user paths:
$(printf "$offenders")
The engine ships to other gardens (thread mqz3wev0) — an absolute
user path unions one user's filesystem into another's. Resolve via:
  TS:    src/server/lib/paths.ts   (hanHome/hanRepo/healthDir/…)
  shell: source src/hooks/paths.sh (\$HAN_HOME/\$HAN_REPO/…)

Escape hatch (rare, audit-visible): add to the commit message
  Paths-waived: <specific reason>
════════════════════════════════════════════════════════════════
BANNER
exit 1
