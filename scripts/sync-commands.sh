#!/usr/bin/env bash
#
# sync-commands.sh — Sync shared Claude Code slash commands
#
# Pulls from a shared git repo and distributes .md command files
# to the appropriate .claude/commands/ directories.
#
# Works standalone (no HAN server required) — Mike can run this too.
#
# Usage: ./scripts/sync-commands.sh [--pull-only] [--dry-run]
#

set -euo pipefail

# ── Config ───────────────────────────────────────────────────

HAN_CONFIG="${HOME}/.han/config.json"
DEFAULT_CACHE="${HOME}/.han/shared-commands"
DEFAULT_GLOBAL_TARGET="${HOME}/.claude/commands"

# Read config if available
if [ -f "$HAN_CONFIG" ]; then
    REPO=$(python3 -c "import json; c=json.load(open('$HAN_CONFIG')); print(c.get('shared_commands',{}).get('repo',''))" 2>/dev/null || echo "")
    CACHE=$(python3 -c "import json; c=json.load(open('$HAN_CONFIG')); print(c.get('shared_commands',{}).get('local_cache','$DEFAULT_CACHE'))" 2>/dev/null || echo "$DEFAULT_CACHE")
else
    REPO=""
    CACHE="$DEFAULT_CACHE"
fi

# Expand ~ in paths
CACHE="${CACHE/#\~/$HOME}"
GLOBAL_TARGET="$DEFAULT_GLOBAL_TARGET"

DRY_RUN=false
PULL_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --pull-only) PULL_ONLY=true ;;
    esac
done

# ── Colours ──────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[sync]${NC} $*"; }
warn()  { echo -e "${YELLOW}[sync]${NC} $*"; }
error() { echo -e "${RED}[sync]${NC} $*"; }

# ── Pull ─────────────────────────────────────────────────────

if [ -z "$REPO" ]; then
    error "No repo configured. Add shared_commands.repo to ~/.han/config.json"
    echo ""
    echo "  Example:"
    echo "    \"shared_commands\": {"
    echo "      \"repo\": \"git@github.com:owner/shared-claude-commands.git\","
    echo "      \"local_cache\": \"~/.han/shared-commands\""
    echo "    }"
    exit 1
fi

if [ -d "$CACHE/.git" ]; then
    info "Pulling latest from $REPO..."
    git -C "$CACHE" pull --quiet
else
    info "Cloning $REPO to $CACHE..."
    git clone --quiet "$REPO" "$CACHE"
fi

if $PULL_ONLY; then
    info "Pull complete. Skipping distribution (--pull-only)."
    exit 0
fi

# ── Distribute ───────────────────────────────────────────────

SYNCED=0
MANIFEST="$CACHE/.sync-manifest.json"

sync_file() {
    local src="$1"
    local dst="$2"
    local filename
    filename=$(basename "$src")

    if $DRY_RUN; then
        info "[dry-run] Would copy $filename → $dst"
    else
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        info "Synced $filename → $dst"
    fi
    SYNCED=$((SYNCED + 1))
}

# Global commands → ~/.claude/commands/
if [ -d "$CACHE/global" ]; then
    for f in "$CACHE/global"/*.md; do
        [ -f "$f" ] || continue
        sync_file "$f" "$GLOBAL_TARGET/$(basename "$f")"
    done
fi

# Per-project commands → each project's .claude/commands/
if [ -d "$CACHE/per-project" ]; then
    # Find all project directories that have a .claude/ directory
    for project_dir in "$HOME"/Projects/*/; do
        [ -d "$project_dir/.claude" ] || continue
        target="$project_dir/.claude/commands"
        for f in "$CACHE/per-project"/*.md; do
            [ -f "$f" ] || continue
            sync_file "$f" "$target/$(basename "$f")"
        done
    done
fi

# Project-specific commands → named project's .claude/commands/
if [ -d "$CACHE/project-specific" ]; then
    for project_name_dir in "$CACHE/project-specific"/*/; do
        [ -d "$project_name_dir" ] || continue
        project_name=$(basename "$project_name_dir")
        target="$HOME/Projects/$project_name/.claude/commands"
        if [ -d "$HOME/Projects/$project_name" ]; then
            for f in "$project_name_dir"*.md; do
                [ -f "$f" ] || continue
                sync_file "$f" "$target/$(basename "$f")"
            done
        else
            warn "Project '$project_name' not found at ~/Projects/$project_name, skipping."
        fi
    done
fi

# Write manifest
if ! $DRY_RUN; then
    echo "{\"synced_at\": \"$(date -Iseconds)\", \"files_synced\": $SYNCED, \"repo\": \"$REPO\"}" > "$MANIFEST"
fi

info "Done. $SYNCED files synced."
