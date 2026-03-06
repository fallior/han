# Hortus Arbor Nostra — Implementation Levels

> Progressive enhancement from MVP to full mobile development

## Overview

Hortus Arbor Nostra is built in layers, each adding functionality while maintaining the simplicity of previous levels. Each level is independently useful — you don't need Level 6 to benefit from Level 1.

## Level Summary

| Level | Name | Focus | Status |
|-------|------|-------|--------|
| 1 | Prompt Responder | MVP — Polling, Y/n responses via web | 🟡 Prototype |
| 2 | Push Alerts | Real-time notifications when prompts arrive | ⚪ Not Started |
| 3 | Context Window | See recent terminal history with prompts | ⚪ Not Started |
| 4 | Terminal Mirror | Full read-only terminal view, persistent buffer | ⚪ Not Started |
| 5 | Interactive Terminal | Full bidirectional terminal interaction | ⚪ Not Started |
| 6 | Claude Bridge | Two-way claude.ai ↔ Claude Code transport | ⚪ Not Started |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

---

## Level 1: Prompt Responder (MVP)

> Unblock prompts remotely with a simple web UI

### Goal

When Claude Code is waiting for input, get notified and respond from your phone.

### Features

- [x] Hook into Claude Code's `permission_prompt` and `idle_prompt` notifications
- [x] Save prompt state to disk for API access
- [x] Send push notification via ntfy.sh
- [x] Web UI to view pending prompts
- [x] Quick action buttons: Y, n, Enter, Skip, Custom
- [x] Response injection via `tmux send-keys`
- [x] CLI launcher (`han`) with tmux session management
- [x] Installation script with Claude Code hook configuration

### Technical Implementation

```
Claude Code → Hook → notify.sh → State File + ntfy.sh Push
                                      ↓
Phone ← Web UI ← Express Server ← State Directory
                      ↓
              tmux send-keys → Claude Code
```

### Success Criteria

- [ ] End-to-end tested on real Mac + iPhone
- [ ] Response latency under 30 seconds from notification
- [ ] Works over local network and Tailscale

---

## Level 2: Push Alerts

> Immediate notifications with rich content

### Goal

Get notified instantly when Claude Code needs input, with enough context to respond intelligently.

### Features

- [ ] Immediate notification on `permission_prompt` (not 60s idle delay)
- [ ] Rich notification content with prompt preview
- [ ] iOS/Android notification actions for quick responses
- [ ] Configurable notification preferences (quiet hours, filter types)
- [ ] Notification history in web UI

### Technical Implementation

- Differentiate `permission_prompt` (immediate) from `idle_prompt` (60s delay)
- Use ntfy.sh action buttons for Y/n responses
- Store notification history for debugging

### Success Criteria

- [ ] Permission prompts notify within 5 seconds
- [ ] Can respond "Y" directly from notification
- [ ] No duplicate notifications for same prompt

---

## Level 3: Context Window

> See what Claude is doing before responding

### Goal

Don't respond blindly. See the recent terminal output that led to the prompt.

### Features

- [ ] Last N lines of terminal output with prompt
- [ ] Scrollable history in web UI
- [ ] Search within visible history
- [ ] Syntax highlighting for code blocks
- [ ] Copy text from history

### Technical Implementation

- Use `tmux capture-pane` to grab recent output
- Store with prompt in state file
- Add history viewer component to web UI

### Success Criteria

- [ ] Can see last 50 lines of context with each prompt
- [ ] Search finds text within visible history
- [ ] Context loads in under 2 seconds

---

## Level 4: Terminal Mirror

> Full read-only terminal view with persistent history

### Goal

See everything Claude Code has done, not just recent context. Unlike Claude Code's compacted view, we keep the full history.

### Features

- [ ] Full terminal view using xterm.js
- [ ] Real-time sync via WebSocket
- [ ] Complete session history persisted (not compacted)
- [ ] Multiple simultaneous session support
- [ ] Export/save session logs
- [ ] Search across full history

### Technical Implementation

- WebSocket connection for live updates
- SQLite for session metadata
- Plain text files for terminal capture
- xterm.js for rendering

### Success Criteria

- [ ] Full terminal visible on mobile
- [ ] History persists across server restarts
- [ ] Can search 10,000+ lines of history quickly

---

## Level 5: Interactive Terminal

> Full bidirectional terminal access

### Goal

Not just respond to prompts — full terminal interaction from mobile.

### Features

- [ ] Full bidirectional terminal I/O
- [ ] Mobile-optimised keyboard (special keys, shortcuts)
- [ ] Command history (up arrow)
- [ ] Tab completion passthrough
- [ ] Signal handling (Ctrl+C, Ctrl+D, Ctrl+Z)
- [ ] End-to-end encryption mandatory

### Technical Implementation

- Bidirectional WebSocket
- tmux attach or direct PTY access
- Mobile keyboard component with special keys
- Encryption layer for all traffic

### Success Criteria

- [ ] Can run any command from mobile
- [ ] Ctrl+C interrupts running process
- [ ] Tab completion works
- [ ] All traffic encrypted

---

## Level 6: Claude Bridge

> Two-way claude.ai ↔ Claude Code transport

### Goal

Seamless context transfer between claude.ai conversations and Claude Code execution. Discuss on your phone, execute on your workstation.

### Features

- [ ] Export claude.ai conversation → Claude Code context
- [ ] Import Claude Code session → claude.ai conversation
- [ ] Bidirectional sync of project context
- [ ] "Hand off" command between interfaces
- [ ] Conversation threading and branching

### Technical Implementation

- Browser extension for claude.ai
- Message format translation layer
- Session state synchronisation
- Project context packaging

### Success Criteria

- [ ] Can start discussion in claude.ai, continue in Claude Code
- [ ] Can export Claude Code session to claude.ai
- [ ] Project context transfers accurately
- [ ] History maintained across bridges

---

## The Vision

From the original discussion:

> "All the discussions we've had and we simply export to our Claude Code terminal and develop. We could effectively develop an entire project on our mobile phone."

Level 6 represents true mobile-first AI development — plan and discuss anywhere, execute seamlessly.

---

## Dependencies Between Levels

```
Level 1 (MVP)
    ↓
Level 2 (Push) ← Independent enhancement
    ↓
Level 3 (Context) ← Requires tmux capture
    ↓
Level 4 (Mirror) ← Requires WebSocket, history storage
    ↓
Level 5 (Interactive) ← Requires bidirectional WebSocket
    ↓
Level 6 (Bridge) ← Requires history access, new components
```

Most levels can be worked on somewhat independently, but the capabilities build on each other.

---

*Ship useful functionality early, iterate toward the vision.*
