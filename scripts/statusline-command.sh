#!/usr/bin/env bash
# Claude Code status line — context usage, model, and current directory

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# T-1.5/T-2 (tmux harness): mirror context-% to the per-(agent,surface) ctx sink
# so the dispatcher's getContextPct(slug, surface) can read it. Keyed per-SURFACE
# since the T-2 re-key (the T-1.5 cross-talk catch: per-slug files were
# last-writer-wins across same-slug sessions). Interactive sessions default to
# surface "session". The legacy per-slug file is still written during the
# transition; retire at T-7. No-op for non-HAN sessions. Atomic writes.
# Repo copy: han/scripts/statusline-command.sh (reproducible-install path).
if [ -n "${AGENT_SLUG:-}" ] && [ -n "$used" ]; then
    _health="${HAN_HEALTH_DIR:-$HOME/.han/health}"
    _surface="${AGENT_SURFACE:-session}"
    mkdir -p "$_health" 2>/dev/null
    _payload=$(printf '{"context_window":{"used_percentage":%s},"updated_at":"%s"}' "$used" "$(date -Iseconds)")
    printf '%s' "$_payload" > "$_health/${AGENT_SLUG}-${_surface}-ctx.json.tmp" 2>/dev/null \
        && mv -f "$_health/${AGENT_SLUG}-${_surface}-ctx.json.tmp" "$_health/${AGENT_SLUG}-${_surface}-ctx.json" 2>/dev/null
    # legacy per-slug file (transition only — readers re-keyed at T-2; remove at T-7)
    printf '%s' "$_payload" > "$_health/${AGENT_SLUG}-ctx.json.tmp" 2>/dev/null \
        && mv -f "$_health/${AGENT_SLUG}-ctx.json.tmp" "$_health/${AGENT_SLUG}-ctx.json" 2>/dev/null
fi

# Shorten home directory to ~
if [ -n "$cwd" ]; then
    home="$HOME"
    cwd="${cwd/#$home/\~}"
fi

# Build status parts
parts=()

[ -n "$model" ] && parts+=("$model")
[ -n "$cwd" ] && parts+=("$cwd")

if [ -n "$used" ]; then
    used_int=$(printf '%.0f' "$used")
    parts+=("ctx: ${used_int}%")
fi

printf '%s' "$(IFS=' | '; echo "${parts[*]}")"
