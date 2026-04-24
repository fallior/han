#!/bin/bash
# install-restart-hooks.sh — install local git hooks that auto-restart
# agent servers (hanjim, hanleo, hantenshi, hancasey) on code change.
#
# Run once after clone. The hooks are written to .git/hooks/ which is local
# (not tracked) — so this script is the canonical install path.
#
# Hooks installed:
#   post-commit   — fires after `git commit` lands a local commit
#   post-merge    — fires after `git pull` / `git merge`
#
# Each hook calls restart-agent-server.sh for every known slug. If the
# corresponding agent server isn't running, the call is a silent no-op.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
RESTART_SCRIPT="$REPO_ROOT/scripts/restart-agent-server.sh"
SLUGS=(jim leo tenshi casey)

if [[ ! -x "$RESTART_SCRIPT" ]]; then
    echo "Error: $RESTART_SCRIPT not found or not executable" >&2
    exit 1
fi

for event in post-commit post-merge; do
    HOOK="$HOOKS_DIR/$event"
    {
        echo "#!/bin/bash"
        echo "# Auto-installed by scripts/install-restart-hooks.sh"
        echo "# Restart agent servers (hanjim/hanleo/hantenshi/hancasey) on code change"
        echo "# so they pick up fresh code. No-op when the corresponding server isn't running."
        for slug in "${SLUGS[@]}"; do
            echo "\"$RESTART_SCRIPT\" $slug"
        done
    } > "$HOOK"
    chmod +x "$HOOK"
    echo "Installed: $HOOK"
done

echo
echo "Done. Hanjim/hanleo/hantenshi/hancasey servers will auto-restart on:"
echo "  - git commit (local commits)"
echo "  - git pull / git merge"
echo
echo "Each restart is ~2s of connection-refused for the affected agent's CLI."
