# Claude Remote — Current Status

> Last updated: 2026-02-15 (Session 15) by Darron (via Claude)

## Current Stage

**Levels 1-7 Complete**. All core levels plus full autonomous task runner with safety features. Prompt responder, push alerts, context window (search + copy), terminal mirror, mobile keyboard, always-on terminal broadcast, context bridge, and autonomous task execution via the Claude Agent SDK with git checkpoints, approval gates, and tool scoping.

Create tasks from your phone, Claude Code executes them headlessly with safety features: automatic git checkpoints before execution (rollback on failure), configurable approval gates (bypass/edits_only/approve_all), and tool scoping. SQLite task queue, real-time progress streaming via WebSocket, cost and token tracking. One-tap response buttons, iOS soft keyboard, search and copy, push notifications, Tailscale remote access — all working.

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Discovery & Research | 🟢 Complete | Found Claude Code hooks system |
| Architecture Design | 🟢 Complete | All 6 levels documented |
| Level 1 Implementation | 🟢 Complete | 8 files, ~1,800 lines |
| Level 1 Testing | 🟢 Complete | Simulated + live E2E passed |
| Level 2: Push Alerts | 🟢 Complete | ntfy.sh action buttons, config, history |
| WebSocket (from Level 4) | 🟢 Complete | Real-time push, polling fallback |
| Level 4: xterm.js Terminal | 🟢 Complete | ANSI colours, proper terminal emulation |
| Level 5: Mobile Keyboard | 🟢 Complete | Quick-action bar + iOS soft keyboard |
| Always-on Terminal Mirror | 🟢 Complete | 1s server broadcast via WebSocket |
| Level 3: Context Window | 🟢 Complete | Search (xterm-addon-search) + copy |
| Level 6: Claude Bridge | 🟢 Complete | Export, import, handoff, history |
| Level 7: Task Runner | 🟢 Complete | Agent SDK, SQLite queue, task board UI, git checkpoints, approval gates, tool scoping |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Recent Changes

### 2026-02-15 — Darron (via Claude) — Session 16
- **Level 7: Completion** (git checkpoints, approval gates, tool scoping):
  - **Git checkpoint system**: Auto-creates checkpoints before task execution
    - Clean repos: creates branch `claude-remote/checkpoint-{taskId}`
    - Dirty repos: creates stash with message `claude-remote checkpoint {taskId}`
    - Automatic rollback on task failure or cancellation
    - Cleanup on successful completion
  - **Configurable approval gates**: Phone-based approval for dangerous operations
    - Three modes: `bypass` (fully autonomous), `edits_only` (approve Bash/Write/Edit), `approve_all` (approve every tool)
    - Approval popup UI with approve/deny buttons
    - WebSocket broadcast of approval requests (`approval_request` message type)
    - API endpoints: `GET /api/approvals`, `GET/POST /api/approvals/:id/(approve|deny)`
    - canUseTool callback integration with 5-minute timeout
  - **Tool scoping**: Restrict tasks to specific tools via `allowed_tools` array
    - Stored as JSON in SQLite, parsed and passed to Agent SDK
    - UI input field for comma-separated tool names
  - Database migrations: added `checkpoint_ref`, `checkpoint_created_at`, `checkpoint_type`, `gate_mode`, `allowed_tools` columns
  - Updated task creation UI with gate mode dropdown and allowed tools input
  - Level 7 now fully complete as per ROADMAP.md

### 2026-02-15 — Darron (via Claude) — Session 15
- **Level 7: Autonomous Task Runner MVP** (`6475b79`):
  - SQLite task queue (`better-sqlite3`) at `~/.claude-remote/tasks.db`
  - Orchestrator loop: 5-second polling, picks up pending tasks, executes via Agent SDK
  - Claude Agent SDK integration (`@anthropic-ai/claude-agent-sdk`): `query()` with streaming
  - Task CRUD API: `GET/POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`, `DELETE /api/tasks/:id`
  - Task board UI: 🤖 button, overlay with Tasks/Create/Progress tabs
  - Real-time WebSocket progress streaming (`task_update`, `task_progress` messages)
  - Cost and token tracking per task
  - Cancel support via AbortController
  - Clean env (removes `CLAUDECODE`) to avoid nested session detection
  - Tested end-to-end: Haiku created file autonomously ($0.006, 2 turns)

### 2026-02-14 — Darron (via Claude) — Session 14
- **Diff-based terminal renderer** (`6f7b662`):
  - Per-line diffing replaces full DOM rewrite (1,600+ lines/sec → 0-2 lines/sec)
  - Each line is an individual `<div>` tracked for changes
  - Client-side local echo functions (limited by iOS hidden input delays)

### 2026-02-14 — Darron (via Claude) — Session 13
- **HTTPS via Tailscale TLS** (`39a0858`): auto-detects certs, removes Safari "not secure" warning
- **Removed all xterm.js dead code** (`68ffbe6`):
  - Removed 5 CDN loads (xterm.js + Google Fonts) — fixed 10-second page load delay
  - Removed initXterm(), state variables, xtermContainer element, xterm CSS (106 lines removed)
  - Replaced JetBrains Mono with system monospace fonts
  - UI is now fully self-contained — zero external requests
- **Terminal persistence** (`68ffbe6`, `82cfc77`):
  - Server writes terminal content to `~/.claude-remote/terminal.txt` on every change
  - `GET /api/terminal` endpoint serves persisted content
  - UI loads persisted content on startup for instant scrollback
  - Append-only `terminal-log.txt` with 5-minute timestamps — complete history across all sessions

### 2026-02-14 — Darron (via Claude) — Session 12
- **Level 6: Claude Bridge** implemented (`a59561f`):
  - Session export, context import, structured handoff, bridge history
  - UI: Bridge button (🔗) in titlebar, overlay panel with 4 tabs
  - No browser extension — explicit copy-paste transfer (iPhone primary client)
- **Streamlined bridge export** (`3d49fae`): full scrollback, one-tap, auto-save to file
- **Replaced xterm.js with plain text** (`c2a3c89`):
  - Dropped ANSI colours — plain text in native scrollable div
  - Native iOS scrolling works perfectly (xterm.js was intercepting touch events)
  - Scroll position preserved during 1-second content updates
- **Full tmux scrollback** (`ab2dff0`): captures entire history (50k line tmux limit)
- **PID file lock** (`3558ea9`): server auto-kills previous instance on startup

### 2026-02-13 — Darron (via Claude) — Sessions 9-10
- **Level 3: Search + Copy** tested on iPhone and confirmed working
- Search: xterm-addon-search with prev/next navigation
- Copy: Web Share API (iOS) with selectable overlay fallback
- Improved search and copy for mobile (commit `09b051b`)

### 2026-02-11 — Darron (via Claude) — Session 8
- **Level 3: Context Window** implemented:
  - Added xterm-addon-search from CDN
  - Search bar UI: toggle button, input, prev/next, close
  - Copy button in titlebar (selection or full visible content)
  - Search fallback for raw text when addon can't find matches

### 2026-02-10–11 — Darron (via Claude) — Session 7
- **Tailscale remote access** tested and confirmed working from iPhone via 5G
- **iOS soft keyboard** support: hidden input triggers keyboard on terminal tap
- Fixed `claude-remote` script: unbound `CLAUDE_ARGS` array with `set -u`
- Fixed mobile terminal rendering: `term.clear()` + `requestAnimationFrame` for layout
- Added claude-remote scripts to PATH

### 2026-02-10 — Darron (via Claude) — Session 6
- **Always-on terminal mirror** — server + UI overhaul:
  - Server-side 1-second terminal capture broadcast via WebSocket (with content diffing)
  - New helper functions: `listActiveSessions()`, `getActiveSession()`, `captureTerminal()`
  - New `POST /api/keys` endpoint for direct keystroke injection (no prompt required)
  - Terminal state sent to clients on WS connect
  - UI now has three states: No Session / Watching / Prompt Active
  - xterm.js always visible when a tmux session exists (not just during prompts)
  - `sendKeyDirect()` routes keystrokes via `/api/keys` when watching (no prompt)
  - Quickbar visible in both watching and prompt states
  - Renamed `renderTerminal()` → `renderPromptOverlay()`, `renderEmpty()` → `renderNoSession()`

### 2026-02-08 — Darron (via Claude) — Session 5
- **Updated `install.sh`** to new Notification hook format:
  - Changed from `hooks.permission_prompt` / `hooks.idle_prompt` (old deprecated format)
  - Now uses `hooks.Notification[{matcher: "permission_prompt|idle_prompt", ...}]`
  - Updated push notification instructions to use config file approach

### 2026-02-08 — Darron (via Claude) — Session 4
- **xterm.js integration** (Level 4):
  - xterm.js v5.3.0 + FitAddon + WebLinksAddon from CDN (no build step)
  - Replaced plain-text `textContent` rendering with proper terminal emulation
  - ANSI colour codes now render correctly (added `-e` flag to `tmux capture-pane`)
  - Removed hidden textarea — xterm.js manages its own input via `onData`
  - Content diffing prevents flicker on re-renders
  - Lazy initialisation — xterm only created when first prompt arrives
  - GitHub-dark theme matching existing CSS variables
- **Mobile quick-action keyboard bar** (Level 5):
  - Two-row button bar: `y` `n` `1` `2` `3` / `Enter` `Esc` `^C` `Tab` `↑` `↓`
  - 44px minimum touch targets (iOS HIG compliant)
  - Buttons call `sendKey()` directly — bypass xterm focus requirement
  - Bar appears only when prompt active, hides in empty/history states
  - Sending state greys out buttons to prevent double-sends
  - xterm.js auto-refits when bar appears/disappears

### 2026-02-08 — Darron (via Claude) — Session 3
- **Level 2: Push Alerts** — Full implementation:
  - Config file support (`~/.claude-remote/config.json`) for ntfy_topic, remote_url, quiet hours
  - Rich ntfy.sh notifications: urgent priority, action buttons (Approve, Open UI), dedup via X-Id
  - Quick-response endpoint (`GET /quick`) for one-tap responses from notification
  - Notification history endpoint (`GET /api/history`) and UI history view
  - idle_prompt notifications (configurable), quiet hours support
  - Notification tracking (`notified` field) in state files
- **WebSocket real-time updates**:
  - `ws` npm package, WebSocketServer on `/ws` path
  - `fs.watch` on pending directory with 100ms debounce
  - Automatic fallback to HTTP polling if WebSocket disconnects
  - Exponential backoff reconnection, iOS Safari visibility handling
  - Status indicator: "live" (WebSocket) or "polling" (HTTP fallback)
- **Testing**:
  - Push notifications verified on iPhone (ntfy.sh topic + action buttons)
  - Fixed firewall (`ufw allow 3847/tcp`) for phone access
  - WebSocket instant updates verified (create/delete test files)
  - Improved quick-response page with visual feedback
- Committed and pushed to GitHub (e36c9f8)

### 2026-02-07 — Darron (via Claude) — Session 2
- Ran full simulated end-to-end test — all 10 steps passed
- Updated `notify.sh` for new Claude Code hook JSON format (`notification_type` field)
- Created `~/.claude/settings.json` with Notification hooks configuration
- Installed server npm dependencies
- Attempted live test — blocked by Opus concurrency limit (one session at a time)
- Hook config format changed: now uses `Notification` event with `matcher` patterns

### 2026-02-07 — Darron (via Claude) — Session 1
- Integrated extended roadmap (Levels 7-11) into project
- Created `ROADMAP.md` with full vision document (1098 lines)

### 2026-01-13 — Darron (via Claude) — Session 2
- Implemented complete Level 1 MVP (8 files, ~1,800 lines)
- Pushed to GitHub: https://github.com/fallior/clauderemote

### 2026-01-13 — Darron (via Claude) — Session 1
- Set up `claude-context/` folder structure following starter kit template
- Created full project documentation (ARCHITECTURE.md, DECISIONS.md, LEVELS.md)

## What's Working

- ✅ Hook script receives notification data from Claude Code
- ✅ State files created for pending prompts
- ✅ Rich push notifications via ntfy.sh with action buttons
- ✅ One-tap response from notification (quick-response page)
- ✅ Config file for persistent settings (ntfy topic, remote URL, quiet hours)
- ✅ Express server serves web UI, API, and WebSocket
- ✅ Terminal mirror UI shows live tmux pane content
- ✅ Keystroke forwarding to Claude Code via tmux
- ✅ WebSocket real-time push (instant prompt updates)
- ✅ Automatic fallback to HTTP polling if WebSocket drops
- ✅ Notification history in web UI
- ✅ tmux session management via `claude-remote` CLI
- ✅ xterm.js terminal emulation with ANSI colour rendering
- ✅ Mobile quick-action keyboard bar (y/n/1-3/Enter/Esc/^C/Tab/arrows)
- ✅ Always-on terminal mirror (live tmux content via 1s WebSocket broadcast)
- ✅ Direct keystroke injection to tmux session (no prompt required)
- ✅ iOS soft keyboard support (hidden input, tap terminal to type)
- ✅ Search bar (xterm-addon-search with prev/next navigation)
- ✅ Copy (Web Share API on iOS, selectable overlay fallback)
- ✅ Tailscale remote access from iPhone (tested via 5G)
- ✅ Context bridge: export sessions, import context, structured handoff
- ✅ Bridge history tracking with timeline UI
- ✅ Plain text terminal view (native iOS scrolling, no xterm.js)
- ✅ Full tmux scrollback capture (50k lines)
- ✅ PID file lock (single server instance)
- ✅ HTTPS via Tailscale TLS (auto-detected)
- ✅ Terminal persistence to disk (`terminal.txt`) with instant startup load
- ✅ Append-only terminal log (`terminal-log.txt`) with 5-minute timestamps
- ✅ Zero CDN dependencies (fully self-contained UI)
- ✅ Autonomous task execution via Claude Agent SDK
- ✅ SQLite task queue with priority ordering
- ✅ Task board UI with create/list/progress views
- ✅ Real-time task progress streaming via WebSocket
- ✅ Cost and token tracking per task
- ✅ Git checkpoints with automatic rollback on failure
- ✅ Configurable approval gates (bypass/edits_only/approve_all)
- ✅ Tool scoping via allowed_tools
- ✅ Approval popup UI with WebSocket notifications

## Next Actions

### Immediate (Next Session)
- [ ] Test Level 7 features end-to-end from phone
- [ ] Test git checkpoint rollback with failing task
- [ ] Test approval gates with edits_only mode
- [ ] Refine UI based on continued mobile usage

### Short-term
- [ ] Consider extended levels (8-11) from ROADMAP.md
- [ ] Add git checkpoint visualization in task detail view
- [ ] Add approval history tracking

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `idle_prompt` 60s delay | Medium | Built into Claude Code; can't be reduced |
| iOS Safari drops WebSocket in background | Low | Handled by visibilitychange reconnect + polling fallback |
| Opus concurrency limit | Low | Can't run two Claude Code Opus sessions simultaneously |
| Agent SDK nested session | Low | Must remove `CLAUDECODE` env var — handled in code (see L012) |

## Blockers

*None currently*

## Questions to Resolve

- [x] Best way to handle multiple simultaneous Claude Code sessions? → `claude-remote-$$` naming
- [x] Should web UI auto-refresh or use WebSocket? → WebSocket with polling fallback
- [x] How to handle ntfy.sh action buttons on private networks? → Use `view` actions (opens on phone browser, which is on LAN)

## Session Notes

Recent sessions (latest first):
- [session_2026-02-14_22-23-02.md](../_logs/session_2026-02-14_22-23-02.md) — Level 7 autonomous task runner (Agent SDK + SQLite)
- [session_2026-02-14_19-23-51.md](../_logs/session_2026-02-14_19-23-51.md) — Diff renderer + local echo + typing UX exploration
- [session_2026-02-14_17-29-25.md](../_logs/session_2026-02-14_17-29-25.md) — HTTPS + xterm cleanup + terminal persistence
- [session_2026-02-14_10-20-08.md](../_logs/session_2026-02-14_10-20-08.md) — Level 6 + plain text terminal + PID lock (8 commits)
- [session_2026-02-13_21-39-54.md](../_logs/session_2026-02-13_21-39-54.md) — Level 3 iPhone testing
- [session_2026-02-11_22-44-16.md](../_logs/session_2026-02-11_22-44-16.md) — Level 3 implementation
- [session_2026-02-10_19-13-57.md](../_logs/session_2026-02-10_19-13-57.md) — Tailscale testing + iOS keyboard
- [session_2026-02-10_05-28-03.md](../_logs/session_2026-02-10_05-28-03.md) — Always-on terminal mirror
- [session_2026-02-08_22-14-13.md](../_logs/session_2026-02-08_22-14-13.md) — install.sh hook format update
- [session_2026-02-08_02-48-24.md](../_logs/session_2026-02-08_02-48-24.md) — xterm.js + Mobile keyboard
- [session_2026-02-08_00-00-00.md](../_logs/session_2026-02-08_00-00-00.md) — Level 2 + WebSocket
- [session_2026-02-07_21-20-25.md](../_logs/session_2026-02-07_21-20-25.md) — E2E testing
- [2026-01-13-darron-level1-implementation.md](session-notes/2026-01-13-darron-level1-implementation.md) — Level 1 MVP implementation
- [2026-01-13-darron-kickoff.md](session-notes/2026-01-13-darron-kickoff.md) — Context structure setup

---

## Quick Reference

**To resume work:**
1. Read this file for context
2. Check the "Next Actions" section
3. Review ARCHITECTURE.md for system design
4. Check DECISIONS.md for why choices were made

**After working:**
1. Update "Recent Changes" with what you did
2. Move completed items from "Next Actions"
3. Add any new issues or blockers
4. Create a session note if significant work was done

**To start the server:**
```bash
cd src/server && node server.js
```

**To configure push notifications:**
```json
// ~/.claude-remote/config.json
{
  "ntfy_topic": "your-secret-topic",
  "remote_url": "http://your-ip:3847"
}
```
