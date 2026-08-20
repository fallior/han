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

# How long we wait for the pool rather than falling back (Darron's ruling — see the WHY
# block in warm_checkout). Measured basis, not a guess: a session stem warmed in ~4 min
# on 2026-08-20 (17:03 launch → 17:07 registered free), so the ceiling gives a cold-start
# pool ample room while still ENDING — a wait that never ends is its own silent failure.
WARM_WAIT_CEILING_SEC="${WARM_WAIT_CEILING_SEC:-600}"
WARM_WAIT_POLL_SEC="${WARM_WAIT_POLL_SEC:-5}"

# One checkout attempt. Prints the tmux session name on stdout and returns 0 only when a
# stem was actually checked out AND its session is live; every other outcome returns 1
# (the script's own diagnostics reach the terminal on stderr).
_attempt_checkout() {
    # N2 (Jim's audit, 2026-08-20): `npx` here is DELIBERATE and correct — this function only
    # ever runs from an interactive launcher, where the human's shell has nvm loaded. The same
    # call inside scripts/run-agent-server.sh would break (and did, at the casey cutover): a
    # systemd user unit inherits no nvm PATH. The asymmetry is intentional in BOTH directions;
    # do not copy this line into a unit, or that one back into here.
    local cast_model="$1" out session_name
    out=$( cd "$SCRIPT_DIR/src/server" && NODE_PATH="$(pwd)/node_modules" \
            npx tsx ../../scripts/checkout-session-stem.ts "$AGENT_SLUG" "$cast_model" ) || return 1
    session_name=$(echo "$out" | tail -1)
    [[ -n "$session_name" ]] && tmux has-session -t "$session_name" 2>/dev/null || return 1
    printf '%s' "$session_name"
}

# Is a warmed stem REGISTERED and free? This is the completion flag, not a guess — and it
# is the right one to wait on (DEC-108 WHY, Darron's question 2026-08-20 ~22:25 "does it
# have a hook or set a flag when done?"): a warming stem writes its own per-stem readiness
# sentinel (~/.han/health/<slug>-<stem-session>-ready) at wake step 10, carrying the c0 id
# it traversed to — the unforgeable proof it loaded to EOF (#107). prewarm-stem.ts READS
# that sentinel and only then registers the stem `free` in the pool. So the pool register
# is downstream of the stem's own proof-of-load: waiting on it means waiting on the flag
# the stem itself sets, through the one register every reader should use. We poll this
# cheap file rather than spawning the checkout each time — the heavy process runs once,
# when the flag says there is something to check out.
_free_stem_registered() {
    python3 -c "
import json,os,sys
try:
    p=json.load(open(os.path.expanduser('~/.han/pool/pool-${AGENT_SLUG}-session.json')))
    sys.exit(0 if any(x.get('state')=='free' for x in p.get('stems',[])) else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# Human-readable pool state for the wait's progress line — read from the pool file at each
# announce so what we report is the register itself, never a remembered value.
_pool_summary() {
    python3 -c "
import json,os,sys
try:
    p=json.load(open(os.path.expanduser('~/.han/pool/pool-${AGENT_SLUG}-session.json')))
    s=p.get('stems',[])
    print(', '.join(f\"{x['stem_id'].split('-')[-1]}={x['state']}\" for x in s) if s else 'none registered yet')
except Exception:
    print('pool file not written yet')
" 2>/dev/null || echo "unreadable"
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

    # The server IS the pool manager — nothing warms without it, so a failure here is
    # terminal for a warm checkout rather than a degradation to work around.
    if ! ensure_server; then
        echo -e "${RED}Cannot ensure the ${AGENT_SLUG} server on ${AGENT_PORT} — no pool manager, so no stem can warm.${NC}"
        echo -e "${YELLOW}Inspect the port/session named above. To seat yourself anyway: ${NC}han${AGENT_SLUG} --cold"
        return 1
    fi

    echo -e "${BLUE}Checking out a warm stem (cast → ${GREEN}${cast_model}${BLUE})...${NC}"
    local session_name
    if session_name=$(_attempt_checkout "$cast_model"); then
        echo -e "${GREEN}Warm seat ready: ${session_name}${NC} — attaching."
        tmux attach-session -t "$session_name"
        return 0
    fi

    # ── NO FALLBACK — WAIT (Darron's ruling, 2026-08-20 ~22:18: "I don't like your
    # fallback it is aweful and so simply don't fall back, wait"). WHY it travels here
    # (DEC-108): the cold path seats a human with NO LEASE — no pool record, no sleeve,
    # no organelle, no senescence check — an unregistered resident every reader then has
    # to guess at. It fired for the first time on 2026-08-20 at 17:03 (the pool was ~4
    # minutes from warm after the reseat reboot) and cost four hours of a hollow seat
    # that nothing could see. A wait of minutes strictly dominates a silent degradation
    # of hours, and the failure direction is now LOUD: we say what we are waiting for,
    # and if it never comes we stop and say so rather than quietly seating a lesser you.
    # The explicit --cold flag is UNTOUCHED (DEC-104: an escape hatch, never a constraint)
    # — what dies here is the automatic, silent one.
    local waited=0 announce=0
    echo -e "${YELLOW}No warm stem yet — WAITING on the pool register (Ctrl-C to abort; '--cold' is the deliberate escape).${NC}"
    echo -e "${BLUE}  the flag: a stem writes its readiness sentinel (c0 traversed), then registers free — that is what we watch.${NC}"
    while (( waited < WARM_WAIT_CEILING_SEC )); do
        sleep "$WARM_WAIT_POLL_SEC"
        waited=$(( waited + WARM_WAIT_POLL_SEC ))
        # Cheap flag-read first; the heavy checkout runs only when the register says yes.
        if _free_stem_registered; then
            if session_name=$(_attempt_checkout "$cast_model"); then
                echo -e "${GREEN}Warm seat ready after ${waited}s: ${session_name}${NC} — attaching."
                tmux attach-session -t "$session_name"
                return 0
            fi
            # Registered-then-unusable (raced by another checkout, or a dead tmux session the
            # checkout reaped): keep waiting for the next one rather than degrading.
            echo -e "${YELLOW}  a registered stem turned out unusable — continuing to wait.${NC}"
        fi
        if (( waited - announce >= 30 )); then
            announce=$waited
            echo -e "${BLUE}  …still warming (${waited}s). Stems for ${AGENT_SLUG}/session: ${NC}$(_pool_summary)"
        fi
    done

    echo -e "${RED}No warm stem after ${WARM_WAIT_CEILING_SEC}s — stopping rather than seating you cold.${NC}"
    echo -e "${YELLOW}Check the server pane (${GREEN}server-${AGENT_SLUG}${YELLOW}) for the pool manager, then retry — or seat yourself deliberately with ${NC}--cold"
    return 1
}
