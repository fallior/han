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

# Get script directory (where han is installed)
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
HAN_DIR="${HAN_DIR:-$HOME/.han}"
mkdir -p "$HAN_DIR/pending"
mkdir -p "$HAN_DIR/resolved"
echo -e "  ${GREEN}✓${NC} $HAN_DIR"

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

# Build the new Notification hook structure
# Format: hooks.Notification[] with matcher patterns
HOOK_ENTRY=$(jq -n --arg cmd "$HOOK_PATH" '{
    matcher: "permission_prompt|idle_prompt",
    hooks: [{
        type: "command",
        command: $cmd
    }]
}')

# Create or update settings.json
if [[ -f "$CLAUDE_SETTINGS" ]]; then
    TMP_FILE=$(mktemp)

    # Check if Notification hooks already exist
    if jq -e '.hooks.Notification' "$CLAUDE_SETTINGS" > /dev/null 2>&1; then
        # Check if our matcher already exists
        if jq -e '.hooks.Notification[] | select(.matcher == "permission_prompt|idle_prompt")' "$CLAUDE_SETTINGS" > /dev/null 2>&1; then
            # Update existing matcher entry
            jq --arg cmd "$HOOK_PATH" '
                .hooks.Notification = [.hooks.Notification[] |
                    if .matcher == "permission_prompt|idle_prompt" then
                        .hooks = [{type: "command", command: $cmd}]
                    else . end
                ]
            ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
            echo -e "  ${GREEN}✓${NC} Updated existing Notification hook"
        else
            # Add new matcher entry to existing Notification array
            jq --argjson entry "$HOOK_ENTRY" '
                .hooks.Notification += [$entry]
            ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
            echo -e "  ${GREEN}✓${NC} Added Notification hook to existing hooks"
        fi
    else
        # Add Notification hooks to existing settings (may have other hooks)
        jq --argjson entry "$HOOK_ENTRY" '
            .hooks = (.hooks // {}) + {Notification: [$entry]}
        ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
        echo -e "  ${GREEN}✓${NC} Added Notification hooks to settings"
    fi

    mv "$TMP_FILE" "$CLAUDE_SETTINGS"
else
    # Create new settings file with Notification hook
    jq -n --arg cmd "$HOOK_PATH" '{
        hooks: {
            Notification: [{
                matcher: "permission_prompt|idle_prompt",
                hooks: [{
                    type: "command",
                    command: $cmd
                }]
            }]
        }
    }' > "$CLAUDE_SETTINGS"
    echo -e "  ${GREEN}✓${NC} Created new settings with Notification hooks"
fi

# Create symlink for CLI
echo -e "\n${BLUE}Setting up CLI...${NC}"

CLI_PATH="$SCRIPT_DIR/scripts/han"
chmod +x "$CLI_PATH"

# Check if /usr/local/bin exists and is writable
if [[ -d "/usr/local/bin" && -w "/usr/local/bin" ]]; then
    ln -sf "$CLI_PATH" /usr/local/bin/han
    echo -e "  ${GREEN}✓${NC} CLI available at: han"
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
echo -e "     ${YELLOW}han${NC}"
echo ""
echo -e "  3. Open on your phone:"
echo -e "     ${YELLOW}http://$(hostname -s).local:3847${NC}"
echo -e "     or ${YELLOW}http://$(ipconfig getifaddr en0 2>/dev/null || echo '<your-ip>'):3847${NC}"
echo ""
echo -e "${BLUE}Optional - Push notifications:${NC}"
echo -e "  1. Install ntfy app on your phone"
echo -e "  2. Subscribe to a secret topic (e.g., 'my-claude-abc123')"
echo -e "  3. Create config file:"
echo -e "     ${YELLOW}cat > ~/.han/config.json << 'EOF'"
echo -e "     {"
echo -e "       \"ntfy_topic\": \"my-claude-abc123\","
echo -e "       \"remote_url\": \"http://$(hostname -s).local:3847\""
echo -e "     }"
echo -e "     EOF${NC}"
echo ""
echo -e "${BLUE}Need help?${NC}"
echo -e "  ${YELLOW}han --help${NC}"
echo ""
