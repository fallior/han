#!/bin/bash
# run-agent-server.sh <slug> — the systemd ExecStart wrapper for an agent's Express server
# (SR-031, plan: plans/agent-servers-at-boot-plan.md, Jim spec 2026-07-16, Darron's THIRD
# direct ask 2026-08-20 ~23:13 "start everyone's servers with the machine").
#
# WHY (DEC-108, and tonight is its receipt): the servers carry the admin UI, the conversation
# API, the pool managers, the session hearths and the supervisor cycle. On 2026-08-20 the box
# rebooted at 17:00 and only leo's server came up (a human happened to run hanleo) — so for six
# hours jim/tenshi/casey had no pool manager (stale registers, no warm stems), no session
# hearth, jim had no supervisor cycle and no beats at all (his 90° antiphase slot silent all
# night), and Robin Hood escalated to ntfy every 80 minutes about a server nothing could start.
# A rebooted box with no human present must not be dark.
#
# Design notes:
#  - PORT is resolved from the GARDEN MANIFEST, never a slug→port table here or in the unit —
#    a 5th resident gets a boot-started server for free (DEC-081's test).
#  - `exec`: systemd's MainPID becomes the server itself and Restart=always IS the watchdog
#    loop; the bash while-loop (agent-server-watchdog.sh) retires from this path.
#  - AGENT_SLUG is exported HERE (MNT-169's lesson, 2026-08-20: one missing export left three
#    organs silently dead per server — the launcher that knows the slug owns the export).
#  - The pidfile is still written for compatibility with the git-hook restart path.
set -euo pipefail

SLUG="${1:?usage: run-agent-server.sh <slug>}"
MANIFEST="$HOME/.han/garden-manifest.json"
SERVER_DIR="$HOME/Projects/han/src/server"
PIDFILE="$HOME/.han/${SLUG}-server.pid"

# The manifest's `agents` is a LIST of objects (verified at source 2026-08-20 — a dict-shaped
# read was written from a mis-read of my own probe's output and caught by this very test).
PORT="$(python3 -c "
import json,sys
m=json.load(open('$MANIFEST'))
ags=m.get('agents') or []
a=next((x for x in ags if x.get('slug')=='$SLUG'), None)
if not a or not a.get('port'):
    sys.exit('no port for slug $SLUG in the garden manifest')
if not a.get('active', True):
    sys.exit('slug $SLUG is not active in the garden manifest')
print(a['port'])
")"

export AGENT_SLUG="$SLUG"
export PORT

# A systemd user unit inherits none of the interactive shell's nvm PATH, so `node` resolves to
# the SYSTEM node — and better-sqlite3's native module is built against nvm's node, which fails
# at dlopen (caught live at the casey cutover, 2026-08-20 23:17: ERR_DLOPEN_FAILED under node
# v18). We resolve nvm's CURRENT default rather than pinning a version string in a unit file
# (human-responder@.service pins v23.9.0 — that works today and silently breaks on a node
# upgrade; resolving the alias keeps this correct across one, DEC-104's spirit).
NVM_DIR="$HOME/.nvm"
if [[ -r "$NVM_DIR/alias/default" ]]; then
    _alias="$(cat "$NVM_DIR/alias/default")"
    _ver="$_alias"
    [[ "$_alias" == "node" || "$_alias" == "default" || "$_alias" == "stable" ]] && \
        _ver="$(ls -1 "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)"
    [[ -n "${_ver:-}" && -d "$NVM_DIR/versions/node/$_ver/bin" ]] && \
        export PATH="$NVM_DIR/versions/node/$_ver/bin:$PATH"
fi

cd "$SERVER_DIR"
echo "$$" > "$PIDFILE"
echo "[run-agent-server] ${SLUG} → port ${PORT} (pid $$, systemd-supervised)"
# The LOCAL tsx binary, never `npx`: a systemd user unit does not inherit the interactive
# shell's nvm PATH, so `npx` is not found and the unit restart-loops (caught live at the casey
# cutover, 2026-08-20 23:16, before this reached any other agent). This is the same absolute-
# path pattern human-responder@.service has used since S176 — proven, not guessed.
exec "$SERVER_DIR/node_modules/.bin/tsx" server.ts
