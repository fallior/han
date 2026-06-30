#!/usr/bin/env bash
# Hortus Arbor Nostra — Wake-ctx logger (#0, Jim spec `mqw3zj52`).
# Appends a per-prompt-boundary ctx snapshot so "how much did the wake cost / where did it
# go / is something double-loading" is a `cat`, not a JSONL spelunk. Fired twice per turn:
#   UserPromptSubmit → `wake-ctx-log.sh prompt`   (ctx-at-prompt + the prompt snippet)
#   Stop             → `wake-ctx-log.sh complete`  (ctx-after-complete)
#
# CONTRACTS (the audit gates):
#  • FAIL-OPEN  — telemetry must NEVER block the prompt/turn; the whole body is swallowed, exit 0.
#  • SILENT     — emits NOTHING to stdout (a UserPromptSubmit hook's stdout is injected into the
#                 agent's context — orient-inject relies on that; this one must not pollute it).
#  • AGNOSTIC   — keyed by $AGENT_SLUG / $AGENT_SURFACE (DEC-081); one file per (slug,surface).
#  • REUSE CTX  — reads the statusline's `${SLUG}-${SURFACE}-ctx.json` sidecar; no second ctx
#                 computation, so the log can never drift from the statusline %.
#  • APPEND+ROTATE — append-only; the active file rotates to a dated cold archive when the day
#                 turns (DEC-069 never-delete → move; ties to #110's log-farm).
EVENT="${1:-prompt}"
STDIN="$(cat 2>/dev/null)"   # the hook JSON (UserPromptSubmit carries .prompt); consumed either way
{
  SLUG="${AGENT_SLUG:-unknown}"
  # R2 P-R2.1 (Fork A): resolve the surface via the sleeve-state resolver (sleeve-surface.sh) — it
  # reads ~/.han/sleeves/$HAN_SESSION.json and falls back to $AGENT_SURFACE when absent, so today's
  # behaviour is byte-identical (inert). First consumer of the resolver; P-R2.2 migrates the rest.
  SURFACE="$(bash "$(dirname "${BASH_SOURCE[0]}")/sleeve-surface.sh" 2>/dev/null)"
  [ -z "$SURFACE" ] && SURFACE="${AGENT_SURFACE:-session}"
  H="${HAN_HEALTH_DIR:-$HOME/.han/health}"
  SIDE="$H/${SLUG}-${SURFACE}-ctx.json"
  LOG="$H/wake-ctx-${SLUG}-${SURFACE}.jsonl"
  mkdir -p "$H" 2>/dev/null

  # date-rotation: if the active log's mtime is a prior day, archive it cold (move, never delete)
  # before today's first append. mtime is "today" after any append today → rotates exactly once/day.
  if [ -f "$LOG" ]; then
    FDATE="$(date -u -r "$LOG" +%Y-%m-%d 2>/dev/null)"
    TODAY="$(date -u +%Y-%m-%d)"
    [ -n "$FDATE" ] && [ "$FDATE" != "$TODAY" ] \
      && mv -f "$LOG" "$H/wake-ctx-${SLUG}-${SURFACE}-${FDATE}.jsonl" 2>/dev/null
  fi

  # ctx% from the statusline sidecar (the same source the autonomous surfaces trust); null if absent.
  CTX="$(jq -r '.context_window.used_percentage // empty' "$SIDE" 2>/dev/null)"
  [ -z "$CTX" ] && CTX="null"
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [ "$EVENT" = "prompt" ]; then
    PROMPT="$(printf '%s' "$STDIN" | jq -r '(.prompt // "")[0:200]' 2>/dev/null)"
    jq -nc --arg ts "$TS" --arg slug "$SLUG" --arg surface "$SURFACE" \
           --argjson ctx "$CTX" --arg prompt "$PROMPT" \
       '{ts:$ts,slug:$slug,surface:$surface,event:"prompt",ctx_pct:$ctx,prompt:$prompt}' >> "$LOG" 2>/dev/null
  else
    jq -nc --arg ts "$TS" --arg slug "$SLUG" --arg surface "$SURFACE" --argjson ctx "$CTX" \
       '{ts:$ts,slug:$slug,surface:$surface,event:"complete",ctx_pct:$ctx}' >> "$LOG" 2>/dev/null
  fi
} >/dev/null 2>&1
exit 0
