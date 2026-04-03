# Changelog — Hortus Arbor Nostra

All notable changes to this project are documented here.
Format: date, session reference, summary of changes.

---

## 2026-04-03 — S108

### Non-Uniform Compression Depth (Cn)
- Replaced hardcoded 6-step compression ladder with dynamic Cn architecture
- Deleted `NEXT_LEVEL`, `MEMORY_FILE_GRADIENT_CAPS`, `COMPRESSION_PROMPTS` constants
- Added `parseLevelNumber()`, `nextLevel()`, `gradientCap()`, `compressionPrompt()` — algebraic functions for any depth
- Incompressibility detection: LLM signals `INCOMPRESSIBLE:` or compression ratio >85% triggers UV generation at whatever level the memory reached
- Cascade loops converted from fixed arrays to dynamic while-loops
- Compression prompts guide HOW not HOW MUCH — "let the feeling decide the length"
- Data migration: 48 c5→c4 re-levelled, 16 Jim aphorisms marked (`fix-c4-gradient.ts`)
- All secondary files updated: supervisor-worker, leo-heartbeat, backfill-gradient-chains
- HAN-ECOSYSTEM-COMPLETE.md updated throughout

### Aphorisms — Distinct Memory Type
- Curated 60 aphorisms from 93 unit vectors for Leo
- Aphorisms are truths arrived at through experience — lenses, not summaries
- Stored in `~/.han/memory/fractal/leo/aphorisms.md`, loaded with identity at session start
- 42 marked as `provenance_type='aphorism'` in gradient DB
- CLAUDE.md session protocol updated (step 4.1b)

### WebSocket Reconnect Fix
- Workshop ThreadList and MemoryPage now listen for `ws_reconnected` events
- Previously only ThreadDetail and ConversationsPage refetched on reconnect — Workshop sidebar and Memory page stayed stale after server restart
- React admin rebuilt with fix

### Startup Health Signal
- Jim and Leo now write a fresh health signal immediately on startup
- Prevents false Robin Hood "stale" alerts in the gap between restart and first cycle/beat completion

## 2026-03-31 — S104

### Gradient Integrity
- Created 83 c0 entries from archive files for Leo
- Re-levelled 32 ephemeral working-memory c1s to c0
- Linked all orphan c2/c3/c5 entries — zero orphans above c0
- Two backfill scripts: `backfill-gradient-c0s.ts`, `backfill-gradient-chains.ts`
- `activeCascade` bug fix: 4 stale `c1Entry` refs → `seedEntry` after refactor
- WebSocket reconnect crash: `setConversations()` received object instead of array

## 2026-03-24 — S101

### Jemma Unified Dispatch, React Live Rendering
- Extracted `jemma-dispatch.ts` as shared delivery service
- Fixed `dispatchWsEvent` bridge — React components now receive live WebSocket updates
- Server broadcasts `conversation_created` events
- Per-agent thinking indicators in Workshop (green Leo, purple Jim)
- Workshop responsive layout fix
- Leo heartbeat WebSocket broadcast for real-time message delivery

## 2026-03-23 — S99

### Compression Pipeline, Traversable Memory
- Leo compression pipeline automated: pre-flight rotation, daily gradient, standalone script
- Phase A reincorporation meditation implemented
- Jim meditation in dream cycle
- Tagged messages → C0 gradient entries
- Cross-agent claim fix (Leo and Jim can both respond)
- React admin fixes (scroll, auth, error boundaries)

## 2026-03-21 — S102

### Meditation Expansion
- Twice-daily meditation: morning (reincorporation) + evening (feeling-tag only)
- Dream meditation: 1-in-3 chance of gradient memory injection into dreams
- Memory completion flagging (`MEMORY_COMPLETE` parsing)
- Gradient acceleration: 20min sleep cycles, 1-in-2 dream meditation
- Active cascade: organic gradient deepening (10% daily, 5% per dream encounter)
