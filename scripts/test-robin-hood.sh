#!/bin/bash

###############################################################################
# Robin Hood Protocol — Quick Testing Script
#
# This script automates verification of the three Robin Hood improvements:
# 1. Verification wait (12s sleep)
# 2. Admin UI health panel
# 3. Distress signal detection
#
# Usage: ./scripts/test-robin-hood.sh [test1|test2|test3|all]
#        ./scripts/test-robin-hood.sh all    # Run all tests
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
HEALTH_DIR="$HOME/.han/health"
CONFIG_FILE="$HOME/.han/config.json"
TMPDIR="/tmp/robin-hood-test"
TEST_LOG="$TMPDIR/test-results.log"
SCREENSHOT_DIR="$TMPDIR/screenshots"

# ─────────────────────────────────────────────────────────────────────────

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Robin Hood Protocol — Test Suite v1.0             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"

# Create temp directory
mkdir -p "$TMPDIR" "$SCREENSHOT_DIR"

# ─── Utility Functions ──────────────────────────────────────────────────

log_test() {
    echo "[$(date +'%H:%M:%S')] $1" | tee -a "$TEST_LOG"
}

log_pass() {
    echo -e "${GREEN}✓ $1${NC}" | tee -a "$TEST_LOG"
}

log_fail() {
    echo -e "${RED}✗ $1${NC}" | tee -a "$TEST_LOG"
}

log_warn() {
    echo -e "${YELLOW}⚠ $1${NC}" | tee -a "$TEST_LOG"
}

log_info() {
    echo -e "${BLUE}ℹ $1${NC}" | tee -a "$TEST_LOG"
}

# ─── Test 1: Verification Wait ──────────────────────────────────────────

test_verification_wait() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Test 1: Verification Wait (12s sleep)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

    log_test "Checking leo-heartbeat.ts for 12s sleep..."

    # Check if 12s sleep exists in the code
    if grep -q "execSync('sleep 12')" /home/darron/Projects/clauderemote/src/server/leo-heartbeat.ts; then
        log_pass "Code contains 'sleep 12' (correct)"
    else
        log_fail "Code does not contain 'sleep 12'"
        log_info "Expected: execSync('sleep 12')"
        log_info "This is a critical fix — please verify line 174 of leo-heartbeat.ts"
        return 1
    fi

    # Check if Leo service is running
    if systemctl --user is-active leo-heartbeat.service &>/dev/null; then
        log_pass "Leo heartbeat service is active"
    else
        log_warn "Leo heartbeat service is not active"
        log_info "To test resurrection, start: systemctl --user start leo-heartbeat.service"
    fi

    # Check Jim service status
    if systemctl --user is-active han-server.service &>/dev/null; then
        log_pass "Jim service (han-server) is active"
    else
        log_warn "Jim service is not active"
        log_info "To test resurrection, ensure Jim is running: systemctl --user start han-server.service"
    fi

    # Check health files exist
    if [[ -f "$HEALTH_DIR/leo-health.json" ]]; then
        log_pass "Leo health file exists"
        local leo_beat=$(jq '.beat // 0' "$HEALTH_DIR/leo-health.json" 2>/dev/null || echo "?")
        log_info "Last beat: #$leo_beat"
    else
        log_warn "Leo health file not found"
    fi

    if [[ -f "$HEALTH_DIR/jim-health.json" ]]; then
        log_pass "Jim health file exists"
        local jim_cycle=$(jq '.cycle // 0' "$HEALTH_DIR/jim-health.json" 2>/dev/null || echo "?")
        log_info "Last cycle: #$jim_cycle"
    else
        log_warn "Jim health file not found"
    fi

    # Check resurrection log
    if [[ -f "$HEALTH_DIR/resurrection-log.jsonl" ]]; then
        log_pass "Resurrection log exists"
        local last_attempt=$(tail -1 "$HEALTH_DIR/resurrection-log.jsonl" 2>/dev/null)
        if [[ -n "$last_attempt" ]]; then
            local success=$(echo "$last_attempt" | jq '.success // false')
            if [[ "$success" == "true" ]]; then
                log_pass "Last resurrection: SUCCESS"
            else
                log_fail "Last resurrection: FAILED"
                log_info "This may indicate the 12s sleep is still not enough"
            fi
        fi
    else
        log_info "No resurrection log yet (this is OK if Jim hasn't crashed)"
    fi

    log_test "Verification wait test complete"
}

# ─── Test 2: Admin UI Health Panel ──────────────────────────────────────

test_admin_ui() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Test 2: Admin UI Health Panel${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

    # Check if server is running
    log_test "Checking if Admin server is running..."
    if ! curl -s -k https://localhost:3847/api/supervisor/health &>/dev/null; then
        log_warn "Admin server not reachable at https://localhost:3847"
        log_info "Expected URL may be different. Check CLAUDE.md for actual port"
        return 1
    fi
    log_pass "Admin server is reachable"

    # Fetch health endpoint
    log_test "Fetching health data from API..."
    local health_response=$(curl -s -k https://localhost:3847/api/supervisor/health)

    if [[ -z "$health_response" ]]; then
        log_fail "No response from health endpoint"
        return 1
    fi

    log_pass "Health endpoint returned data"

    # Check for Jim data
    if echo "$health_response" | jq -e '.jim' &>/dev/null; then
        log_pass "Jim health data present"
        local jim_status=$(echo "$health_response" | jq -r '.jim.status // "unknown"')
        local jim_uptime=$(echo "$health_response" | jq '.jim.uptimeMinutes // 0')
        log_info "  Status: $jim_status"
        log_info "  Uptime: ${jim_uptime}min"
    else
        log_warn "Jim health data not found in response"
    fi

    # Check for Leo data
    if echo "$health_response" | jq -e '.leo' &>/dev/null; then
        log_pass "Leo health data present"
        local leo_status=$(echo "$health_response" | jq -r '.leo.status // "unknown"')
        local leo_beat=$(echo "$health_response" | jq '.leo.beat // 0')
        log_info "  Status: $leo_status"
        log_info "  Beat: #$leo_beat"
    else
        log_warn "Leo health data not found in response"
    fi

    # Check for resurrection history
    if echo "$health_response" | jq -e '.resurrections' &>/dev/null; then
        log_pass "Resurrection history present"
        local num_resurrections=$(echo "$health_response" | jq '.resurrections | length')
        log_info "  Total resurrections: $num_resurrections"
    else
        log_warn "Resurrection history not found in response"
    fi

    # Check for distress data
    if echo "$health_response" | jq -e '.distress' &>/dev/null; then
        log_pass "Distress signal data present"
    else
        log_info "No distress signals (this is normal if system is healthy)"
    fi

    log_test "Admin UI health panel test complete"
    log_info "To see the full panel, open: https://localhost:3847/admin?module=supervisor"
}

# ─── Test 3: Distress Signal Detection ──────────────────────────────────

test_distress_signal() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Test 3: Distress Signal Detection${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

    log_test "Checking for distress signal files..."

    # Check Leo distress
    if [[ -f "$HEALTH_DIR/leo-distress.json" ]]; then
        log_pass "Leo distress signal file exists"
        local leo_distress=$(cat "$HEALTH_DIR/leo-distress.json")
        if [[ -n "$leo_distress" ]]; then
            log_info "Latest Leo distress:"
            echo "$leo_distress" | jq '.' | sed 's/^/    /'
        fi
    else
        log_info "No Leo distress signals (this is normal if heartbeat is healthy)"
    fi

    # Check Jim distress
    if [[ -f "$HEALTH_DIR/jim-distress.json" ]]; then
        log_pass "Jim distress signal file exists"
        local jim_distress=$(cat "$HEALTH_DIR/jim-distress.json")
        if [[ -n "$jim_distress" ]]; then
            log_info "Latest Jim distress:"
            echo "$jim_distress" | jq '.' | sed 's/^/    /'
        fi
    else
        log_info "No Jim distress signals (this is normal if supervisor is healthy)"
    fi

    # Check for ntfy configuration
    log_test "Checking ntfy configuration..."
    if [[ -f "$CONFIG_FILE" ]]; then
        if grep -q "ntfy_topic" "$CONFIG_FILE"; then
            log_pass "ntfy_topic configured"
            local ntfy_topic=$(jq -r '.ntfy_topic // "not set"' "$CONFIG_FILE")
            log_info "  Topic: $ntfy_topic"
        else
            log_warn "ntfy_topic not configured"
            log_info "Add to config.json to enable distress notifications"
        fi
    else
        log_warn "Config file not found at $CONFIG_FILE"
    fi

    log_test "Distress signal test complete"
}

# ─── Full System Check ──────────────────────────────────────────────────

test_full_system() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Full System Health Check${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

    log_test "Checking directory structure..."

    for dir in "$HEALTH_DIR" "$HOME/.han/memory/leo" "$HOME/.han/signals"; do
        if [[ -d "$dir" ]]; then
            log_pass "Directory exists: $dir"
        else
            log_fail "Directory missing: $dir"
        fi
    done

    log_test "Checking file permissions..."

    if [[ -f "$HEALTH_DIR/leo-health.json" ]]; then
        local perms=$(stat -c '%a' "$HEALTH_DIR/leo-health.json" 2>/dev/null || stat -f '%A' "$HEALTH_DIR/leo-health.json" 2>/dev/null)
        if [[ "$perms" == "644" ]] || [[ "$perms" == "664" ]]; then
            log_pass "leo-health.json permissions OK: $perms"
        else
            log_warn "leo-health.json permissions: $perms (expected 644 or 664)"
        fi
    fi

    log_test "System health check complete"
}

# ─── Generate Report ────────────────────────────────────────────────────

generate_report() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Test Report Summary${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

    echo -e "\n${BLUE}Log file:${NC} $TEST_LOG"
    echo -e "${BLUE}Screenshots:${NC} $SCREENSHOT_DIR"

    # Count results
    local passes=$(grep -c "^✓" "$TEST_LOG" || echo "0")
    local fails=$(grep -c "^✗" "$TEST_LOG" || echo "0")
    local warns=$(grep -c "^⚠" "$TEST_LOG" || echo "0")

    echo ""
    echo -e "${GREEN}Passes: $passes${NC}"
    echo -e "${RED}Failures: $fails${NC}"
    echo -e "${YELLOW}Warnings: $warns${NC}"

    if [[ $fails -eq 0 ]]; then
        echo -e "\n${GREEN}✓ All tests passed!${NC}"
    else
        echo -e "\n${RED}✗ Some tests failed. Review log for details.${NC}"
    fi
}

# ─── Main Entry Point ───────────────────────────────────────────────────

TEST_SELECTION="${1:-all}"

case "$TEST_SELECTION" in
    test1)
        test_verification_wait
        ;;
    test2)
        test_admin_ui
        ;;
    test3)
        test_distress_signal
        ;;
    all)
        test_verification_wait
        test_admin_ui
        test_distress_signal
        test_full_system
        ;;
    *)
        echo "Usage: $0 [test1|test2|test3|all]"
        echo ""
        echo "  test1 - Verify 12s sleep and resurrection wait"
        echo "  test2 - Check Admin UI health panel"
        echo "  test3 - Verify distress signal detection"
        echo "  all   - Run all tests (default)"
        exit 1
        ;;
esac

generate_report

echo ""
echo "Test suite complete."
