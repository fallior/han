#!/bin/bash
# install-restart-hooks.sh — install local git hooks that auto-restart
# agent servers AND human-responder systemd services on code change.
#
# Run once after clone. The hooks are written to .git/hooks/ which is local
# (not tracked) — so this script is the canonical install path.
#
# Hooks installed:
#   post-commit   — fires after `git commit` lands a local commit
#   post-merge    — fires after `git pull` / `git merge`
#
# Each hook fires two restart layers:
#   1. restart-agent-server.sh per slug (hanjim/hanleo/hantenshi/hancasey)
#      — pidfile-based agent servers (Darron's interactive Claude Code
#      sessions). Silent no-op if the pidfile doesn't exist.
#   2. restart-human-service.sh per slug (jim/leo) — systemd-user services
#      (jim-human.service, leo-human.service — the Jemma-dispatched
#      conversation responders). Conditional on the relevant *.ts file
#      having actually changed in the commit/merge, so unrelated commits
#      don't interrupt in-flight composes. Silent no-op if no file change.
#      Added 2026-05-11 (S156) after the gap was caught: jim-human and
#      leo-human were running 2-day-old code from before the controller-
#      postMessage strip (commit 6834324) because nothing restarted them.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
RESTART_SCRIPT="$REPO_ROOT/scripts/restart-agent-server.sh"
HUMAN_RESTART_SCRIPT="$REPO_ROOT/scripts/restart-human-service.sh"
SLUGS=(jim leo tenshi casey)
HUMAN_SLUGS=(jim leo)

if [[ ! -x "$RESTART_SCRIPT" ]]; then
    echo "Error: $RESTART_SCRIPT not found or not executable" >&2
    exit 1
fi
if [[ ! -x "$HUMAN_RESTART_SCRIPT" ]]; then
    echo "Error: $HUMAN_RESTART_SCRIPT not found or not executable" >&2
    exit 1
fi

for event in post-commit post-merge; do
    HOOK="$HOOKS_DIR/$event"
    {
        echo "#!/bin/bash"
        echo "# Auto-installed by scripts/install-restart-hooks.sh"
        echo "# Layer 1: restart agent servers (hanjim/hanleo/hantenshi/hancasey) on code change"
        echo "# so they pick up fresh code. No-op when the corresponding server isn't running."
        for slug in "${SLUGS[@]}"; do
            echo "\"$RESTART_SCRIPT\" $slug"
        done
        echo "# Layer 2: restart *-human systemd services (jim-human, leo-human) when"
        echo "# their .ts source files change. No-op when source unchanged or service inactive."
        echo "# The event name ($event) routes the diff range — post-commit checks"
        echo "# HEAD~1..HEAD; post-merge checks ORIG_HEAD..HEAD. Avoids stale-ORIG_HEAD"
        echo "# over-firing on post-commit (S156 fix)."
        for slug in "${HUMAN_SLUGS[@]}"; do
            echo "\"$HUMAN_RESTART_SCRIPT\" $slug $event"
        done
    } > "$HOOK"
    chmod +x "$HOOK"
    echo "Installed: $HOOK"
done

echo
echo "Done. The following will auto-restart on git commit / pull / merge:"
echo "  Agent servers (pidfile-based, no-op if not running):"
echo "    hanjim, hanleo, hantenshi, hancasey"
echo "  Human-responder systemd services (conditional on relevant .ts file change):"
echo "    jim-human.service, leo-human.service"
echo
echo "Each agent-server restart is ~2s of connection-refused for the affected agent's CLI."
echo "Each human-service restart is ~3s during which Jemma dispatches will queue."
