#!/bin/bash
# launcher-warm-checkout.sh — the SHARED warm-checkout leg for the han<slug> launchers
# (DEC-081: one path, many agents — extracted from hanleo at the msz950i2 land so hanjim,
# and later hantenshi/hancasey, source this instead of growing twins. The design is
# Jim-GREEN'd on the leo instantiation, 2026-08-19; this file is its agnostic form.)
#
# Contract: the sourcing launcher must have set AGENT_SLUG, AGENT_PORT, SESSION_PREFIX,
# SCRIPT_DIR, and the colour vars (RED/GREEN/YELLOW/BLUE/NC). Functions only — sourcing
# this file changes nothing until warm_checkout/ensure_server are called.

# P3 (Jim's M3): the per-agent server decoupled from the seat. The launcher only ENSURES —
# kernel socket table + API as the authorities (S167: never pgrep), started once as a
# standalone tmux session, never a second instance.
ensure_server() {
    if curl -sk -o /dev/null -m 3 "https://localhost:${AGENT_PORT}/api/analytics" 2>/dev/null; then
        echo -e "${GREEN}Server already running on ${AGENT_PORT}${NC}"
        return 0
    fi
    if ss -tlnp 2>/dev/null | grep -q ":${AGENT_PORT} "; then
        echo -e "${YELLOW}Port ${AGENT_PORT} has a listener but the API is not answering — NOT starting a second server (inspect it; the ghost-server family S163/S167).${NC}"
        return 1
    fi
    local srv_session="server-${AGENT_SLUG}"
    if tmux has-session -t "$srv_session" 2>/dev/null; then
        echo -e "${YELLOW}Session ${srv_session} exists but nothing listens on ${AGENT_PORT} — leaving it for inspection, not stacking another.${NC}"
        return 1
    fi
    echo -e "${BLUE}Starting standalone server session ${GREEN}${srv_session}${NC}"
    tmux new-session -d -s "$srv_session" \
        "$SCRIPT_DIR/scripts/agent-server-watchdog.sh $AGENT_SLUG $AGENT_PORT '$SCRIPT_DIR/src/server'"
}

warm_checkout() {
    local cast_model="${1:-fable}"

    # M2 (Jim) — one seat per surface, as a launcher invariant. AUTHORED RESTRICTION
    # (DEC-104, Casey's fold): two seats sleeved {slug, session} would share ONE swap
    # pair, ONE readiness sentinel and ONE cli-busy signal — the MNT-098 paired-write
    # race made cheap, and the busy predicate stops being a fact about *a* seat
    # (Tenshi). Permanent structural hazard → no expiry owed. Author: Jim (M2,
    # msz950i2, 2026-08-18). The cure is ATTACH, not refuse: a second launcher
    # invocation joins the existing seat, exactly like `-a`.
    # A FREE (never checked-out) stem is NOT a seat: attaching to it directly would
    # bypass the checkout (cast, sleeve, attach-flush, DEC-092 stamp). Fixes the leo
    # land's M2 grep, which matched free stems too — a defect invisible at the audit
    # because the session pool did not exist yet to test against (found at extraction,
    # 2026-08-19 ~9:35 PM). Only a LEASED/spoke session stem or a classic seat attaches.
    local existing
    existing=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep -E "^${SESSION_PREFIX}-[0-9]+$|^stem-${AGENT_SLUG}-session-" || true)
    if [[ -n "$existing" ]]; then
        local live_seat=""
        while read -r s; do
            [[ -z "$s" ]] && continue
            if [[ "$s" == stem-${AGENT_SLUG}-session-* ]]; then
                # leased/spoke rows count as seats; free rows do not
                if python3 -c "
import json,sys,os
try:
    p=json.load(open(os.path.expanduser('~/.han/pool/pool-${AGENT_SLUG}-session.json')))
    st=[x for x in p['stems'] if x['tmux_session']=='$s']
    sys.exit(0 if (st and st[0]['state']!='free') else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then live_seat="$s"; break; fi
            else
                live_seat="$s"; break
            fi
        done <<< "$existing"
        if [[ -n "$live_seat" ]]; then
            echo -e "${YELLOW}A ${AGENT_SLUG} seat already exists — attaching to it (one seat per surface, M2):${NC} $live_seat"
            tmux attach-session -t "$live_seat"
            return 0
        fi
    fi

    ensure_server || true   # a checkout can proceed without the server; the pool just won't replenish until it's up

    echo -e "${BLUE}Checking out a warm stem (cast → ${GREEN}${cast_model}${BLUE})...${NC}"
    local out session_name
    if out=$( cd "$SCRIPT_DIR/src/server" && NODE_PATH="$(pwd)/node_modules" \
            npx tsx ../../scripts/checkout-session-stem.ts "$AGENT_SLUG" "$cast_model" ); then
        session_name=$(echo "$out" | tail -1)
        if [[ -n "$session_name" ]] && tmux has-session -t "$session_name" 2>/dev/null; then
            echo -e "${GREEN}Warm seat ready: ${session_name}${NC} — attaching."
            tmux attach-session -t "$session_name"
            return 0
        fi
    fi
    echo -e "${YELLOW}No usable warm stem — falling back to the cold launch (byte-identical classic path).${NC}"
    return 1
}
