#!/bin/bash
# Hortus Arbor Nostra — Welcome-Back Handover (UserPromptSubmit hook, S169).
# When the user's prompt is a wake trigger (welcome back / good morning / session
# start) AND a handover pointer exists for this agent, inject a reminder to read
# the previous session's handover thread — so a cross-session (or cross-substrate,
# e.g. the Fable 5 window) handover is picked up structurally, not by luck.
#
# stdout from a UserPromptSubmit hook is injected into the agent's context.
# Agent-agnostic (DEC-081): per-slug pointer at ~/.han/signals/handover-<slug>.
# FAIL-SAFE: any uncertainty (no pointer, not a wake trigger, parse failure) → no-op.
#
# Pointer file format (line 1): <thread_id><TAB><one-line note>
# The waking agent clears the pointer (`rm`) once it has read the thread.

SIGNALS_DIR="${HOME}/.han/signals"
SLUG="${AGENT_SLUG:-unknown}"
PTR="${SIGNALS_DIR}/handover-${SLUG}"

# #107 P1b (surface-gate, plan-audit mqubg8sq): the handover pointer is for the INTERACTIVE
# seat only. A dispatched spoke (heartbeat / human-response / supervisor-cycle / meditation /
# compression) must wake in the dark and reconstitute fully on its own — nothing should fire
# AT it that hands it orientation it ought to load for itself (the keep-the-agent-in-the-dark
# principle; the accelerant under the welcome-back light-load). Fire only for AGENT_SURFACE
# 'session' (unset/empty = an interactive launch). FAIL-SAFE: any other surface → no-op.
case "${AGENT_SURFACE:-session}" in
    session) ;;            # interactive seat — proceed
    *) exit 0 ;;           # dispatched spoke / any non-session surface — suppress the pointer
esac

# No handover waiting → nothing to do.
[ ! -f "$PTR" ] && exit 0

# Read the UserPromptSubmit payload (JSON on stdin) and extract the prompt.
INPUT="$(cat 2>/dev/null)"
PROMPT="$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("prompt",""))
except Exception: pass' 2>/dev/null)"

# Only fire on a wake trigger.
printf '%s' "$PROMPT" | grep -qiE 'welcome back|good morning|session start' || exit 0

TID="$(head -1 "$PTR" | cut -f1)"
NOTE="$(head -1 "$PTR" | cut -f2-)"
[ -z "$TID" ] && exit 0

echo "📋 WELCOME-BACK HANDOVER WAITING — your previous session left a handover in conversation thread \"${TID}\"${NOTE:+: ${NOTE}}. Read it as part of your wake (it carries the crisp pick-up your gradient/WM may not): curl -sk \"https://localhost:3847/api/conversations/${TID}\" . Once read, clear the pointer: rm \"${PTR}\" ."
exit 0
