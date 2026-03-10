#!/bin/bash
# Hortus Arbor Nostra — CLI Free Signal (Optimistic Concurrency)
# Fires on Stop AND Notification/idle_prompt — signals that the CLI
# is no longer actively using Opus.
#
# Removes cli-busy and writes cli-free. The heartbeat's signal watcher
# detects cli-free and wakes up immediately if it's in a retry wait.

SIGNALS_DIR="${HOME}/.han/signals"
mkdir -p "$SIGNALS_DIR"

rm -f "${SIGNALS_DIR}/cli-busy"
date -Iseconds > "${SIGNALS_DIR}/cli-free"
