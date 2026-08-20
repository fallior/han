#!/bin/bash
# sync-agent-server-units.sh — make the enabled set of han-agent-server@<slug> units match the
# Garden Manifest's ACTIVE residents. Idempotent; safe to run any time (SR-031).
#
# WHY registry-derived rather than a hardcoded list (DEC-081 + the MNT-036 lesson): the restart
# hook that hardcoded jim+leo left casey running stale code twice. A list in a script is a
# fifth agent's silent omission waiting to happen. Read the register; enable what it says.
#
# ENABLE only (no --now) by default: enabling is what makes a server come up WITH THE BOX,
# which is the ask. Starting a unit while a legacy pane-watchdog still holds the port would
# fail to bind, so the live cutover is deliberate and per-agent (--now flag below), never a
# side-effect of a sync.
set -euo pipefail

MANIFEST="$HOME/.han/garden-manifest.json"
NOW=""
[[ "${1:-}" == "--now" ]] && NOW="--now"

# `agents` is a LIST of objects in the manifest (verified at source, 2026-08-20).
mapfile -t ACTIVE < <(python3 -c "
import json
m=json.load(open('$MANIFEST'))
for a in (m.get('agents') or []):
    if a.get('active', True) and a.get('port') and a.get('slug'):
        print(a['slug'])
")

if [[ ${#ACTIVE[@]} -eq 0 ]]; then
    echo "[sync-agent-server-units] no active residents with a port in the manifest — nothing to do"
    exit 0
fi

echo "[sync-agent-server-units] active residents: ${ACTIVE[*]}"
for slug in "${ACTIVE[@]}"; do
    if systemctl --user is-enabled "han-agent-server@${slug}.service" >/dev/null 2>&1; then
        echo "  ${slug}: already enabled"
        [[ -n "$NOW" ]] && systemctl --user start "han-agent-server@${slug}.service" || true
    else
        systemctl --user enable $NOW "han-agent-server@${slug}.service"
        echo "  ${slug}: ENABLED${NOW:+ + started}"
    fi
done

# Departed residents: disable units the manifest no longer lists (supersede, never surprise —
# the unit file itself is untouched, so re-admission is one enable away).
while read -r unit; do
    [[ -z "$unit" ]] && continue
    slug="${unit#han-agent-server@}"; slug="${slug%.service}"
    # Skip the bare TEMPLATE (`han-agent-server@.service`, empty slug): it is not an instance,
    # and disabling it removes every instance's symlink at once. Caught live 2026-08-20 23:19
    # — the first run of this script disabled all four agents it had just enabled.
    [[ -z "$slug" ]] && continue
    if ! printf '%s\n' "${ACTIVE[@]}" | grep -qx "$slug"; then
        echo "  ${slug}: no longer an active resident — disabling"
        systemctl --user disable "$unit" || true
    fi
done < <(systemctl --user list-unit-files 'han-agent-server@*.service' --no-legend 2>/dev/null | awk '{print $1}')

echo "[sync-agent-server-units] done"
