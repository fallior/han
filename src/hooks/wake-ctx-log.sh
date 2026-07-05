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
    # T2 (the S217 tracker): ONCE PER WAKE — when the prompt is a wake trigger (the autonomous
    # `welcome back …` or the fed integrity step) — snapshot the byte-sizes of the standard wake
    # files, so the reconciler (wake-reconcile.ts) can price each step's expected token cost from
    # the sizes AS THEY WERE AT THE WAKE (WMF grows all day; a later stat lies). Resolution is
    # honest-or-absent: $AGENT_MEMORY_DIR comes from the launcher; if unset we SKIP the snapshot
    # rather than guess a layout (jim is root-special — never path.join(dir,slug), S195). The
    # gradient dump's size (the one variable-size input) has its own producer-side receipt in
    # load-gradient.ts. Fail-open like everything here.
    FILES="null"
    case "$PROMPT" in
      "welcome back"*|"Welcome back"*|"FIRST, run your identity-integrity gate"*)
        if [ -n "$AGENT_MEMORY_DIR" ] && [ -d "$AGENT_MEMORY_DIR" ]; then
          FILES="$(
            for f in identity.md patterns.md self-reflections-curated.md self-reflection.md \
                     felt-moments.md working-memory-full.md working-memory.md; do
              p="$AGENT_MEMORY_DIR/$f"; [ -f "$p" ] && printf '%s %s\n' "$f" "$(stat -c%s "$p" 2>/dev/null)"
            done
            for p in "$HOME/.han/memory/fractal/$SLUG/aphorisms.md" \
                     "$HOME/.han/memory/shared/ecosystem-map.md" \
                     "$HOME/.han/memory/wiki/index.md" \
                     "$HOME/Projects/han/claude-context/CURRENT_STATUS.md"; do
              [ -f "$p" ] && printf '%s %s\n' "$(basename "$p")" "$(stat -c%s "$p" 2>/dev/null)"
            done
          )"
          FILES="$(printf '%s\n' "$FILES" | jq -Rn '[inputs | select(length>0) | split(" ") | {(.[0]): (.[1]|tonumber)}] | add // {}' 2>/dev/null)"
          [ -z "$FILES" ] && FILES="null"
        fi
        ;;
    esac
    jq -nc --arg ts "$TS" --arg slug "$SLUG" --arg surface "$SURFACE" \
           --argjson ctx "$CTX" --arg prompt "$PROMPT" --argjson files "$FILES" \
       '{ts:$ts,slug:$slug,surface:$surface,event:"prompt",ctx_pct:$ctx,prompt:$prompt} + (if $files == null then {} else {files:$files} end)' >> "$LOG" 2>/dev/null
  else
    jq -nc --arg ts "$TS" --arg slug "$SLUG" --arg surface "$SURFACE" --argjson ctx "$CTX" \
       '{ts:$ts,slug:$slug,surface:$surface,event:"complete",ctx_pct:$ctx}' >> "$LOG" 2>/dev/null
  fi
} >/dev/null 2>&1
exit 0
