#!/bin/bash
# Hortus Arbor Nostra — CLI Busy Signal (Optimistic Concurrency)
# Fires on UserPromptSubmit — signals that the CLI just submitted a prompt
# and Opus is about to be busy processing it.
#
# The heartbeat checks this file before running a beat.
# If present and recent (< 5 min), the heartbeat retries in 30s.

SIGNALS_DIR="${HOME}/.han/signals"
mkdir -p "$SIGNALS_DIR"

# Agent-scoped + session-only (R011 Invariant 2 / DEC-096, DEC-081). cli-busy is the
# interactive session telling ITS OWN agent's heartbeat to yield the Opus slot. Only an
# interactive session writes it — a dispatched spoke (AGENT_SURFACE != session) must not make
# the heartbeat yield to its own beats — and it is keyed per-agent so e.g. Leo's heartbeat
# yields to Leo's session, never to Jim's activity (the cross-agent global-cli-busy bug, live
# on beat #17).
# R2 P-R2.2a (Fork A): resolve via sleeve-state (sleeved surface), fallback $AGENT_SURFACE (inert today).
_surface="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-surface.sh" 2>/dev/null)"; _surface="${_surface:-${AGENT_SURFACE:-session}}"
[ "$_surface" = "session" ] || exit 0
# Guard-and-skip (S226 scour, DEC-103 CBA): a slug-less seat writes NOTHING rather than
# defaulting to leo's signals (cross-agent corruption) or failing the turn (`:?`).
[ -z "$AGENT_SLUG" ] && exit 0
date -Iseconds > "${SIGNALS_DIR}/cli-busy-${AGENT_SLUG}"
# MNT-180 cure + Darron's Enter-anchor ruling (2026-08-25): a LEVEL stamp of the seat's last
# prompt-submit that NOTHING ever consumes or deletes. cli-busy dies at Stop (cli-idle) and
# cli-free is eaten as an edge by the legacy leo-heartbeat watcher — both readers keep their
# semantics untouched; the hearth anchors on THIS. Written at Enter because the 60-min cache
# knee runs from the turn's first cache read (his ruling): pulse lands within TTL by construction.
date -Iseconds > "${SIGNALS_DIR}/cli-enter-${AGENT_SLUG}"
