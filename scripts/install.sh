#!/bin/bash
# Claude Remote - Installation Script
# Sets up directories, dependencies, and configures Claude Code hooks

set -euo pipefail

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No colour

# Get script directory (where claude-remote is installed)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              Claude Remote - Installation                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "  ${RED}✕${NC} $1 (not found)"
        return 1
    fi
}

MISSING=0
check_command "node" || MISSING=1
check_command "npm" || MISSING=1
check_command "tmux" || MISSING=1
check_command "jq" || MISSING=1
check_command "claude" || { echo -e "    ${YELLOW}Warning: Claude Code CLI not found. Install from https://claude.ai/download${NC}"; }

if [[ $MISSING -eq 1 ]]; then
    echo -e "\n${RED}Missing required dependencies. Please install them and try again.${NC}"
    echo "  brew install node tmux jq"
    exit 1
fi

echo -e "\n${BLUE}Creating directories...${NC}"

# Create state directories
CLAUDE_REMOTE_DIR="${CLAUDE_REMOTE_DIR:-$HOME/.claude-remote}"
mkdir -p "$CLAUDE_REMOTE_DIR/pending"
mkdir -p "$CLAUDE_REMOTE_DIR/resolved"
echo -e "  ${GREEN}✓${NC} $CLAUDE_REMOTE_DIR"

# Install npm dependencies
echo -e "\n${BLUE}Installing server dependencies...${NC}"
cd "$SCRIPT_DIR/src/server"
npm install --silent
echo -e "  ${GREEN}✓${NC} npm packages installed"

# Configure Claude Code hook
echo -e "\n${BLUE}Configuring Claude Code hook...${NC}"

CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_SETTINGS="$CLAUDE_CONFIG_DIR/settings.json"
HOOK_PATH="$SCRIPT_DIR/src/hooks/notify.sh"

# Ensure Claude config directory exists
mkdir -p "$CLAUDE_CONFIG_DIR"

# Create or update settings.json
if [[ -f "$CLAUDE_SETTINGS" ]]; then
    # Check if hooks already configured
    if jq -e '.hooks' "$CLAUDE_SETTINGS" > /dev/null 2>&1; then
        # Update existing hooks
        TMP_FILE=$(mktemp)
        jq --arg hook "$HOOK_PATH" '
            .hooks.permission_prompt = [$hook] |
            .hooks.idle_prompt = [$hook]
        ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
        mv "$TMP_FILE" "$CLAUDE_SETTINGS"
        echo -e "  ${GREEN}✓${NC} Updated existing hooks configuration"
    else
        # Add hooks to existing settings
        TMP_FILE=$(mktemp)
        jq --arg hook "$HOOK_PATH" '
            . + {
                hooks: {
                    permission_prompt: [$hook],
                    idle_prompt: [$hook]
                }
            }
        ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
        mv "$TMP_FILE" "$CLAUDE_SETTINGS"
        echo -e "  ${GREEN}✓${NC} Added hooks to existing settings"
    fi
else
    # Create new settings file
    cat > "$CLAUDE_SETTINGS" << EOF
{
    "hooks": {
        "permission_prompt": ["$HOOK_PATH"],
        "idle_prompt": ["$HOOK_PATH"]
    }
}
EOF
    echo -e "  ${GREEN}✓${NC} Created new settings with hooks"
fi

# Create symlink for CLI
echo -e "\n${BLUE}Setting up CLI...${NC}"

CLI_PATH="$SCRIPT_DIR/scripts/claude-remote"
chmod +x "$CLI_PATH"

# Check if /usr/local/bin exists and is writable
if [[ -d "/usr/local/bin" && -w "/usr/local/bin" ]]; then
    ln -sf "$CLI_PATH" /usr/local/bin/claude-remote
    echo -e "  ${GREEN}✓${NC} CLI available at: claude-remote"
else
    echo -e "  ${YELLOW}!${NC} Could not create symlink in /usr/local/bin"
    echo -e "    Run manually: ${YELLOW}$CLI_PATH${NC}"
    echo -e "    Or add to PATH: ${YELLOW}export PATH=\"$SCRIPT_DIR/scripts:\$PATH\"${NC}"
fi

# Print success
echo -e "\n${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              Installation Complete!                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${BLUE}Quick Start:${NC}"
echo ""
echo -e "  1. Start the server:"
echo -e "     ${YELLOW}$SCRIPT_DIR/scripts/start-server.sh${NC}"
echo ""
echo -e "  2. Start Claude Code (in another terminal):"
echo -e "     ${YELLOW}claude-remote${NC}"
echo ""
echo -e "  3. Open on your phone:"
echo -e "     ${YELLOW}http://$(hostname -s).local:3847${NC}"
echo -e "     or ${YELLOW}http://$(ipconfig getifaddr en0 2>/dev/null || echo '<your-ip>'):3847${NC}"
echo ""
echo -e "${BLUE}Optional - Push notifications:${NC}"
echo -e "  1. Install ntfy app on your phone"
echo -e "  2. Subscribe to a secret topic (e.g., 'my-claude-abc123')"
echo -e "  3. Set environment variable:"
echo -e "     ${YELLOW}export NTFY_TOPIC=\"my-claude-abc123\"${NC}"
echo ""
echo -e "${BLUE}Need help?${NC}"
echo -e "  ${YELLOW}claude-remote --help${NC}"
echo ""
