# Claude Remote — Current Status

> Last updated: 2026-02-14 (Session 12, extended) by Darron (via Claude)

## Current Stage

**Levels 1-6 Complete**. All core levels implemented: prompt responder, push alerts, context window (search + copy), terminal mirror (xterm.js), mobile keyboard (quickbar + iOS soft keyboard), always-on terminal broadcast, and context bridge (export/import/handoff between phone and workstation).

Full terminal emulation with ANSI colours via xterm.js. One-tap response buttons (y/n/1/2/3/Enter/Esc/^C/Tab/arrows). iOS soft keyboard for free-form typing. Search and copy. Push notifications, WebSocket, always-on terminal mirror, Tailscale remote access, and context bridge all working.

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

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Recent Changes

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

## Next Actions

### Immediate (Next Session)
- [ ] Refine UI based on continued mobile usage
- [ ] Add HTTPS via Tailscale certs (remove Safari "not secure" warning)

### Short-term
- [ ] Consider extended levels (7-11) from ROADMAP.md

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `idle_prompt` 60s delay | Medium | Built into Claude Code; can't be reduced |
| iOS Safari drops WebSocket in background | Low | Handled by visibilitychange reconnect + polling fallback |
| Opus concurrency limit | Low | Can't run two Claude Code Opus sessions simultaneously |

## Blockers

*None currently*

## Questions to Resolve

- [x] Best way to handle multiple simultaneous Claude Code sessions? → `claude-remote-$$` naming
- [x] Should web UI auto-refresh or use WebSocket? → WebSocket with polling fallback
- [x] How to handle ntfy.sh action buttons on private networks? → Use `view` actions (opens on phone browser, which is on LAN)

## Session Notes

Recent sessions (latest first):
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
