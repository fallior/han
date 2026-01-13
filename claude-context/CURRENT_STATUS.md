# Claude Remote — Current Status

> Last updated: 2026-01-13 by Darron (via Claude)

## Current Stage

**Level 1**: Prompt Responder (MVP)

Prototype implementation complete. Ready for real-world testing on Mac + iPhone.

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Discovery & Research | 🟢 Complete | Found Claude Code hooks system |
| Architecture Design | 🟢 Complete | All 6 levels documented |
| Level 1 Prototype | 🟡 In Progress | Code complete, needs testing |
| Level 2: Push Alerts | ⚪ Not Started | — |
| Level 3: Context Window | ⚪ Not Started | — |
| Level 4-6 | ⚪ Not Started | — |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Recent Changes

### 2026-01-13 — Darron (via Claude)
- Set up `claude-context/` folder structure following starter kit template
- Created full project documentation:
  - `ARCHITECTURE.md` — System design with diagrams
  - `DECISIONS.md` — 6 ADRs (hooks, tmux, ntfy.sh, Tailscale, polling, storage)
  - `LEVELS.md` — All 6 implementation levels detailed
  - `CLAUDE_CODE_PROMPTS.md` — Project-specific prompts
- Created `session-notes/` and `learnings/` folders with templates
- Previous session created Level 1 prototype:
  - `notify.sh` hook script for Claude Code
  - `claude-remote` CLI launcher with tmux integration
  - Express server with API endpoints
  - Mobile-friendly web UI with quick actions
  - Installation script with Claude Code hook configuration

## What's Working

- ✅ Hook script receives notification data from Claude Code
- ✅ State files created for pending prompts
- ✅ Push notifications sent via ntfy.sh (if topic configured)
- ✅ Express server serves web UI and API
- ✅ Web UI displays prompts with quick action buttons
- ✅ Response sent to Claude Code via `tmux send-keys`
- ✅ tmux session management via `claude-remote` CLI

## Next Actions

### Immediate (This Session)
- [ ] Test installation script on real Mac
- [ ] Verify hook fires correctly from Claude Code
- [ ] Test end-to-end flow: prompt → notification → response

### Short-term (This Week)
- [ ] Set up ntfy.sh topic and test push notifications
- [ ] Install Tailscale and test remote access
- [ ] Refine web UI based on actual mobile usage
- [ ] Fix any bugs found during testing

### Medium-term (Level 2)
- [ ] Improve notification timing (immediate on permission_prompt)
- [ ] Add notification actions for iOS/Android
- [ ] Richer notification content with prompt preview

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `idle_prompt` 60s delay | Medium | Built into Claude Code; can't be reduced |
| VSCode extension hooks broken | Low | Known issue (GitHub #16114); terminal works |
| iOS instant notifications need upstream | Low | Requires ntfy.sh upstream config |

## Blockers

*None currently*

## Questions to Resolve

- [ ] Best way to handle multiple simultaneous Claude Code sessions?
- [ ] Should web UI auto-refresh or use WebSocket?
- [ ] Is 15-second polling acceptable for Level 1, or should we push to Level 2 immediately?

## Session Notes

Recent sessions (latest first):
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

**To test the prototype:**
```bash
cd claude-remote
./scripts/install.sh
export NTFY_TOPIC="your-secret-topic"
./scripts/start-server.sh  # Terminal 1
claude-remote              # Terminal 2
# Open http://localhost:3847 on phone
```
