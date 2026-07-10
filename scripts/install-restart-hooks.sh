#!/bin/bash
# install-restart-hooks.sh — install local git hooks that auto-restart
# agent servers, human-responder + heartbeat systemd services on code change.
#
# Run once after clone. The hooks are written to .git/hooks/ which is local
# (not tracked) — so this script is the canonical install path.
#
# Hooks installed:
#   post-commit   — fires after `git commit` lands a local commit
#   post-merge    — fires after `git pull` / `git merge`
#
# Each hook fires three restart layers:
#   1. restart-agent-server.sh per slug (hanjim/hanleo/hantenshi/hancasey)
#      — pidfile-based agent servers (Darron's interactive Claude Code
#      sessions). Silent no-op if the pidfile doesn't exist.
#   2. restart-human-service.sh per slug (jim/leo) — systemd-user services
#      (jim-human.service, leo-human.service — the Jemma-dispatched
#      conversation responders). Conditional on the seat's own *.ts source
#      OR a shared server-runtime dep (src/server/lib/, db.ts, services/
#      discord.ts) having changed, so unrelated commits don't interrupt an
#      in-flight compose. Silent no-op if no relevant change. Added 2026-05-11
#      (S156); widened to the shared runtime surface 2026-06-21 (P0, S196)
#      after the seats sat 4 days on a stale tmux-dispatcher (the wedge).
#   3. restart-heartbeat-service.sh per slug (leo) — the <slug>-heartbeat
#      systemd-user service (the autonomous beat scheduler). Same shape as
#      Layer 2 (own *.ts OR shared lib/ + db.ts). Added 2026-06-21 (P0b,
#      S196): the heartbeat loads tmux-dispatcher/agent-cycle too but was
#      previously uncovered by the hook — the same staleness exposure on the
#      surface no human is watching.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
RESTART_SCRIPT="$REPO_ROOT/scripts/restart-agent-server.sh"
HUMAN_RESTART_SCRIPT="$REPO_ROOT/scripts/restart-human-service.sh"
HEARTBEAT_RESTART_SCRIPT="$REPO_ROOT/scripts/restart-heartbeat-service.sh"
# MNT-036 cure (P3a, S219): the slug lists DERIVE from the garden manifest at install
# time — never a hand-written roster copy (Tenshi's census: this was specimen #4, and it
# was already stale when found). Re-materialise after any roster change: run this script
# (the P3 `han update` flow re-runs it at its restart step, so updates self-heal).
# Fail-closed: an empty derivation aborts the install rather than writing hollow hooks.
_EMIT="$REPO_ROOT/scripts/emit-garden-services.ts"
_emit() { (cd "$REPO_ROOT/src/server" && NODE_PATH="$PWD/node_modules" npx tsx "$_EMIT" "$1"); }
mapfile -t SLUGS < <(_emit server)
mapfile -t HUMAN_SLUGS < <(_emit human)
mapfile -t HEARTBEAT_SLUGS < <(_emit heartbeat)
if [[ ${#SLUGS[@]} -eq 0 || ${#HUMAN_SLUGS[@]} -eq 0 ]]; then
    echo "Error: manifest-derived service lists came back empty — refusing to install hollow hooks (MNT-036 fail-closed)" >&2
    exit 1
fi
echo "manifest-derived: servers=(${SLUGS[*]}) human=(${HUMAN_SLUGS[*]}) heartbeat=(${HEARTBEAT_SLUGS[*]})"

if [[ ! -x "$RESTART_SCRIPT" ]]; then
    echo "Error: $RESTART_SCRIPT not found or not executable" >&2
    exit 1
fi
if [[ ! -x "$HUMAN_RESTART_SCRIPT" ]]; then
    echo "Error: $HUMAN_RESTART_SCRIPT not found or not executable" >&2
    exit 1
fi
if [[ ! -x "$HEARTBEAT_RESTART_SCRIPT" ]]; then
    echo "Error: $HEARTBEAT_RESTART_SCRIPT not found or not executable" >&2
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
        echo "# Layer 2: restart human-responder@<slug> systemd services (human-responder@jim,"
        echo "# human-responder@leo) when their source changes. No-op when unchanged or inactive."
        echo "# The event name ($event) routes the diff range — post-commit checks"
        echo "# HEAD~1..HEAD; post-merge checks ORIG_HEAD..HEAD. Avoids stale-ORIG_HEAD"
        echo "# over-firing on post-commit (S156 fix)."
        for slug in "${HUMAN_SLUGS[@]}"; do
            echo "\"$HUMAN_RESTART_SCRIPT\" $slug $event"
        done
        echo "# Layer 3: restart <slug>-heartbeat systemd services (leo) when their .ts"
        echo "# source OR a shared server-runtime lib (src/server/lib/, db.ts) changes."
        echo "# The heartbeat is the autonomous surface + loads tmux-dispatcher/agent-cycle"
        echo "# too, but was previously uncovered by the hook (P0b, S196). Same event-routed"
        echo "# range + silent no-op on absent/inactive unit."
        for slug in "${HEARTBEAT_SLUGS[@]}"; do
            echo "\"$HEARTBEAT_RESTART_SCRIPT\" $slug $event"
        done
    } > "$HOOK"
    chmod +x "$HOOK"
    echo "Installed: $HOOK"
done

echo
echo "Done. The following will auto-restart on git commit / pull / merge:"
echo "  Agent servers (pidfile-based, no-op if not running):"
echo "    hanjim, hanleo, hantenshi, hancasey"
echo "  Human-responder systemd services (conditional on own .ts OR shared lib/ change):"
echo "    human-responder@jim.service, human-responder@leo.service"
echo "  Heartbeat systemd services (conditional on own .ts OR shared lib/ change):"
echo "    leo-heartbeat.service"
echo
echo "Each agent-server restart is ~2s of connection-refused for the affected agent's CLI."
echo "Each human/heartbeat-service restart is ~3s during which dispatches/beats queue."
