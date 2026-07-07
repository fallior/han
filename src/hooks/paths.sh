#!/usr/bin/env bash
# paths.sh — the shell twin of src/server/lib/paths.ts (P0, S218; #101 path-portability).
# Source this instead of writing /home/<user> literals in any hook or shell script:
#     source "$(dirname "${BASH_SOURCE[0]}")/paths.sh"
# Resolution: explicit env override → derived default (identical contract to paths.ts —
# keep the two aligned if the contract changes; the sleeve-surface.sh precedent).

# The garden's state root
HAN_HOME="${HAN_HOME:-$HOME/.han}"

# The engine repo root — derived from THIS file's location (src/hooks/paths.sh is two
# levels below the root), never a user literal.
if [ -z "$HAN_REPO" ]; then
    HAN_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# The projects workspace
HAN_PROJECTS="${HAN_PROJECTS:-$HOME/Projects}"

HAN_AGENTS_DIR="$HAN_HOME/agents"
HAN_HEALTH_DIR="${HAN_HEALTH_DIR:-$HAN_HOME/health}"
HAN_SIGNALS_DIR="$HAN_HOME/signals"
HAN_SLEEVES_DIR="$HAN_HOME/sleeves"
HAN_MEMORY_DIR="$HAN_HOME/memory"
HAN_SERVER_DIR="$HAN_REPO/src/server"

export HAN_HOME HAN_REPO HAN_PROJECTS HAN_AGENTS_DIR HAN_HEALTH_DIR \
       HAN_SIGNALS_DIR HAN_SLEEVES_DIR HAN_MEMORY_DIR HAN_SERVER_DIR
