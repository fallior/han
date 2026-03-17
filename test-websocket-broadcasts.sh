#!/bin/bash
# Automated WebSocket Broadcast Testing
# Tests basic plumbing for signal-based broadcasts

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  WebSocket Broadcast Plumbing Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo

# ── Pre-checks ────────────────────────────────────────────────

echo -e "${YELLOW}→${NC} Checking prerequisites..."

# Check server is running
if ! pgrep -f "tsx.*server.ts" > /dev/null; then
    echo -e "${RED}✗${NC} Server not running (tsx server.ts)"
    exit 1
fi
echo -e "${GREEN}✓${NC} Server process found"

# Check port 3847 listening
if ! lsof -i :3847 > /dev/null 2>&1; then
    echo -e "${RED}✗${NC} Port 3847 not listening"
    exit 1
fi
echo -e "${GREEN}✓${NC} Port 3847 listening"

# Check human agents running
if ! pgrep -f "leo-human.ts" > /dev/null; then
    echo -e "${YELLOW}!${NC} leo-human.ts not running (optional)"
fi

if ! pgrep -f "jim-human.ts" > /dev/null; then
    echo -e "${YELLOW}!${NC} jim-human.ts not running (optional)"
fi

# Check signals directory exists
SIGNALS_DIR="$HOME/.han/signals"
if [ ! -d "$SIGNALS_DIR" ]; then
    echo -e "${RED}✗${NC} Signals directory missing: $SIGNALS_DIR"
    exit 1
fi
echo -e "${GREEN}✓${NC} Signals directory exists"

echo

# ── Test 1: Create conversation ──────────────────────────────

echo -e "${YELLOW}→${NC} Test 1: Creating test conversation..."

CONV_RESP=$(curl -s -k -X POST https://localhost:3847/api/conversations \
    -H "Content-Type: application/json" \
    -d '{"discussion_type": "general", "title": "WebSocket Test Conversation"}')

CONV_ID=$(echo "$CONV_RESP" | jq -r '.conversation.id // empty')

if [ -z "$CONV_ID" ]; then
    echo -e "${RED}✗${NC} Failed to create conversation"
    echo "Response: $CONV_RESP"
    exit 1
fi

echo -e "${GREEN}✓${NC} Created conversation: $CONV_ID"
echo

# ── Test 2: Post human message and check signal ──────────────

echo -e "${YELLOW}→${NC} Test 2: Posting human message..."

# Clear signals directory first
rm -f "$SIGNALS_DIR"/ws-broadcast* 2>/dev/null || true

MSG_RESP=$(curl -s -X POST "http://localhost:3847/api/conversations/$CONV_ID/messages" \
    -H "Content-Type: application/json" \
    -d '{"content": "Test message for WebSocket broadcast verification"}')

MSG_ID=$(echo "$MSG_RESP" | jq -r '.conversation.id // empty')

if [ -z "$MSG_ID" ]; then
    echo -e "${RED}✗${NC} Failed to post message"
    echo "Response: $MSG_RESP"
    exit 1
fi

echo -e "${GREEN}✓${NC} Posted message: $MSG_ID"

# Wait briefly for signal file to be created
sleep 0.5

# Check if signal file was created
if [ ! -f "$SIGNALS_DIR/ws-broadcast" ]; then
    echo -e "${RED}✗${NC} Signal file not created at $SIGNALS_DIR/ws-broadcast"
    echo "This means the broadcast won't reach WebSocket clients!"
    exit 1
fi

echo -e "${GREEN}✓${NC} Signal file created"

# Read signal file contents
SIGNAL_CONTENT=$(cat "$SIGNALS_DIR/ws-broadcast")
echo -e "${BLUE}Signal payload:${NC}"
echo "$SIGNAL_CONTENT" | jq '.' 2>/dev/null || echo "$SIGNAL_CONTENT"
echo

# Verify signal structure
SIGNAL_TYPE=$(echo "$SIGNAL_CONTENT" | jq -r '.type // empty')
SIGNAL_CONV_ID=$(echo "$SIGNAL_CONTENT" | jq -r '.conversation_id // empty')
SIGNAL_DISC_TYPE=$(echo "$SIGNAL_CONTENT" | jq -r '.discussion_type // empty')
SIGNAL_MSG_ID=$(echo "$SIGNAL_CONTENT" | jq -r '.message.id // empty')

if [ "$SIGNAL_TYPE" != "conversation_message" ]; then
    echo -e "${RED}✗${NC} Signal type incorrect: $SIGNAL_TYPE (expected: conversation_message)"
    exit 1
fi
echo -e "${GREEN}✓${NC} Signal type correct: $SIGNAL_TYPE"

if [ "$SIGNAL_CONV_ID" != "$CONV_ID" ]; then
    echo -e "${RED}✗${NC} Signal conversation_id mismatch"
    exit 1
fi
echo -e "${GREEN}✓${NC} Signal conversation_id matches: $CONV_ID"

if [ "$SIGNAL_DISC_TYPE" != "general" ]; then
    echo -e "${RED}✗${NC} Signal discussion_type incorrect: $SIGNAL_DISC_TYPE (expected: general)"
    exit 1
fi
echo -e "${GREEN}✓${NC} Signal discussion_type correct: $SIGNAL_DISC_TYPE"

if [ "$SIGNAL_MSG_ID" != "$MSG_ID" ]; then
    echo -e "${RED}✗${NC} Signal message.id mismatch"
    exit 1
fi
echo -e "${GREEN}✓${NC} Signal message.id matches: $MSG_ID"

echo

# ── Test 3: Workshop conversation (nested type) ──────────────

echo -e "${YELLOW}→${NC} Test 3: Testing workshop nested discussion type..."

# Create workshop conversation
WORKSHOP_RESP=$(curl -s -k -X POST https://localhost:3847/api/conversations \
    -H "Content-Type: application/json" \
    -d '{"discussion_type": "workshop-jim-request", "title": "Workshop Test"}')

WORKSHOP_ID=$(echo "$WORKSHOP_RESP" | jq -r '.conversation.id // empty')

if [ -z "$WORKSHOP_ID" ]; then
    echo -e "${RED}✗${NC} Failed to create workshop conversation"
    exit 1
fi

echo -e "${GREEN}✓${NC} Created workshop conversation: $WORKSHOP_ID"

# Clear signal
rm -f "$SIGNALS_DIR"/ws-broadcast* 2>/dev/null || true

# Post message
WORKSHOP_MSG=$(curl -s -X POST "http://localhost:3847/api/conversations/$WORKSHOP_ID/messages" \
    -H "Content-Type: application/json" \
    -d '{"content": "Workshop broadcast test"}')

sleep 0.5

if [ ! -f "$SIGNALS_DIR/ws-broadcast" ]; then
    echo -e "${RED}✗${NC} Workshop signal not created"
    exit 1
fi

WORKSHOP_SIGNAL=$(cat "$SIGNALS_DIR/ws-broadcast")
WORKSHOP_DISC_TYPE=$(echo "$WORKSHOP_SIGNAL" | jq -r '.discussion_type // empty')

if [ "$WORKSHOP_DISC_TYPE" != "workshop-jim-request" ]; then
    echo -e "${RED}✗${NC} Workshop discussion_type incorrect: $WORKSHOP_DISC_TYPE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Workshop discussion_type correct: $WORKSHOP_DISC_TYPE"
echo

# ── Test 4: Signal cleanup (manual check) ────────────────────

echo -e "${YELLOW}→${NC} Test 4: Signal cleanup..."
echo "Signal files should be cleaned up by server when read via WebSocket."
echo "Current signals directory contents:"
ls -lh "$SIGNALS_DIR"/ 2>/dev/null || echo "(empty)"
echo
echo -e "${YELLOW}Note:${NC} Signal file may still exist if no WebSocket client is connected."
echo "When admin UI is open, server reads and deletes signal files automatically."
echo

# ── Summary ───────────────────────────────────────────────────

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All automated plumbing tests passed!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo
echo "Next steps (manual testing required):"
echo "1. Open admin UI: http://localhost:3847/admin"
echo "2. Open DevTools Console (F12)"
echo "3. Navigate to Conversations tab"
echo "4. Post a message and verify real-time update"
echo "5. Check Console for: [WebSocket] Received: conversation_message"
echo
echo "See WEBSOCKET_TESTING_CHECKLIST.md for full test scenarios"
echo
