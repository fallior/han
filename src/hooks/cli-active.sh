#!/bin/bash
# Claude Remote — CLI Busy Signal (Optimistic Concurrency)
# Fires on UserPromptSubmit — signals that the CLI just submitted a prompt
# and Opus is about to be busy processing it.
#
# The heartbeat checks this file before running a beat.
# If present and recent (< 5 min), the heartbeat retries in 30s.

SIGNALS_DIR="${HOME}/.claude-remote/signals"
mkdir -p "$SIGNALS_DIR"

date -Iseconds > "${SIGNALS_DIR}/cli-busy"
