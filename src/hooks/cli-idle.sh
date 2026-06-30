#!/bin/bash
# Hortus Arbor Nostra — CLI Free Signal (Optimistic Concurrency)
# Fires on Stop AND Notification/idle_prompt — signals that the CLI
# is no longer actively using Opus.
#
# Removes cli-busy and writes cli-free. The heartbeat's signal watcher
# detects cli-free and wakes up immediately if it's in a retry wait.

SIGNALS_DIR="${HOME}/.han/signals"
mkdir -p "$SIGNALS_DIR"

# Agent-scoped + session-only (mirror cli-active.sh; R011 Invariant 2 / DEC-096, DEC-081).
# R2 P-R2.2a (Fork A): resolve via sleeve-state (sleeved surface), fallback $AGENT_SURFACE (inert today).
_surface="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-surface.sh" 2>/dev/null)"; _surface="${_surface:-${AGENT_SURFACE:-session}}"
[ "$_surface" = "session" ] || exit 0
rm -f "${SIGNALS_DIR}/cli-busy-${AGENT_SLUG:-leo}"
date -Iseconds > "${SIGNALS_DIR}/cli-free-${AGENT_SLUG:-leo}"
