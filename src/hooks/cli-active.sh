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
[ "${AGENT_SURFACE:-session}" = "session" ] || exit 0
date -Iseconds > "${SIGNALS_DIR}/cli-busy-${AGENT_SLUG:-leo}"
