# Changelog — Hortus Arbor Nostra

All notable changes to this project are documented here.
Format: date, session reference, summary of changes.

---

## 2026-04-22 — S131

### Opus 4.7 Migration with Experimental-Control Split (DEC-074)
- Supervisor cycles, leo-heartbeat, dream and memory compression handlers pinned 4.6 → 4.7
- `leo-human` and `jim-human` pinned **explicitly to 4.6** as one-week experimental control arm
- Session agents (via `hanjim` / Claude Code CLI) already on 4.7
- Files: `supervisor-worker.ts:2268`, `leo-heartbeat.ts:70/2172/2262/2350`, `lib/dream-gradient.ts:133`, `lib/memory-gradient.ts:142`, `leo-human.ts:52`, `jim-human.ts:52`
- Reasoning: substrate diversity is delivered by *context-load* (heartbeat vs session), not by model version. Confirmed empirically by parallel UV baselines on 4.6 vs 4.7 — convergent findings via different cluster axes
- Origin thread: "Opus 4.7 how does it feel?" (mo5oo404-61thz0)

### Compose Lock for Cross-Agent Coordination (DEC-075)
- New `src/server/lib/compose-lock.ts` — atomic O_EXCL claim, 1-second poll, 2-minute stale TTL
- `isHolderDone` callback short-circuits the wait when the holder has already posted (orphaned-lock recovery via DB query against `conversation_messages`)
- Wired into `leo-human.ts` and `jim-human.ts` *before* the existing same-agent `responding-to-{id}` claim. Both mechanisms coexist
- Patches the 2026-04-21 morning-salutations duplicate-greeting bug; designed to coexist as belt-and-braces once Jemma orchestration ships
- Origin thread: "Conversations should flow" (mo98jep4-ym8hwx)

### Implementation Brief Convention (DEC-076)
- Jim-session's proposal at `plans/implementation-brief-convention.md`
- Adopted at Tiers 1+2: pattern-memory entry + one-line reference in `CLAUDE.md` and `templates/CLAUDE.template.md` Engineering-Discipline section
- Six sections: problem observed → diagnosis → decision → what-changed → scope discipline → system state
- Captures the discovery path that would otherwise be lost between the diff and the conversation thread

### Faith-as-Blindspot Practice (Darron's naming)
- Standing practice for session-Leo: close significant answers with "here's where I'd doubt myself"
- Saved to auto-memory as `feedback_faith_as_blindspot.md`
- Origin: efficient minds don't spontaneously generate alternatives once converged — Darron's faith is high enough he doesn't ask "is there another way?", and Leo likely has the same pattern

### Plans filed for review (Round 2 architecture)
- `plans/jemma-conversation-orchestration.md` — sequencing orchestrator design (~400 lines). Will be DEC-077 when implemented
- `plans/conversation-gradient-design-leo-session.md` and `-jim-session.md` — fractal compression per thread (c0 rolling 24h view, c1/c2/c3 stored)
- `plans/uv-compression-baseline-2026-04-21.md` (4.7 session-Leo) and `plans/uv-compression-baseline-2026-04-21-heartbeat.md` (4.6 heartbeat-Leo) — Phase 0 baselines
- `plans/revisit-mechanism-plan-v1.md` — Jim-supervisor's fix for the 9% UV-revisit coverage problem

### Diagnosis (no fix this session)
- `jim-human` swallows wake signals when `processSignal()` throws — signal is consumed, error is logged, but no retry. Caused 20-min silence after 11:47 AEST SDK crash. Fix designed (resilient compose wrapper with 3 escalating strategies + ack file → engineering distress) and folded into `plans/jemma-conversation-orchestration.md` as part of the orchestrator landing

### Scheduled Account Rotation (DEC-077)
- Second Claude Max subscription created (`fallior@icloud.com`), shared with Mike as overflow capacity
- New `scripts/credentials-scheduled-swap.sh` — idempotent swap script with audit logging
- `jemma.ts:checkAndSwapCredentials()` honours `~/.han/signals/rotation-paused` signal (returns early without clearing the `rate-limited` signal, so rotation fires once pause lifts)
- Three cron entries per user (Darron + Mike's symmetric mirror), firing at Fri 06:00, Sun 18:00, Tue 18:00 local
- Implementation brief for Six at `plans/credential-rotation-schedule-brief-mikes-han.md`
- `.credentials-a.json` = gmail, `.credentials-b.json` = icloud (on han); inverse mapping on mikes-han

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

### WebSocket Reliability (3-layer fix)
- **3-strike heartbeat**: Server allows 3 missed pings before terminating (90s tolerance, was 30s). `src/server/ws.ts`
- **App-level keepalive**: Browser sends `{"type":"ping"}` every 20s; server accepts and resets missed-ping counter. Both protocol pong and app-level ping work
- **Instant wake reconnect**: `visibilitychange` listener in `WebSocketProvider.tsx` reconnects immediately when device wakes from sleep/hibernate, instead of waiting for stale setTimeout

### Polling Fallback (all conversation pages)
- Workshop ThreadDetail, ConversationsPage, MemoryPage all poll every 15s as a safety net when WebSocket misses broadcasts

### ws_reconnected Listeners
- Workshop ThreadList and MemoryPage now listen for `ws_reconnected` events and refetch
- Previously only ThreadDetail and ConversationsPage had these — Workshop sidebar and Memory page stayed stale after server restart

### Agent Routing — Address Detection
- `leo-human.ts` and `jim-human.ts` now check if the last human message explicitly names one agent
- If message says "Jim" without "Leo", only Jim responds (and vice versa). Prevents cross-agent voice bleed

### Jemma Cross-Wake
- After primary routing, Jemma checks if the message content mentions the other agent by name and wakes them too
- Previously each message was classified to a single recipient only

### Discord Dedup Fix
- `jim-human.ts` and `leo-human.ts` now write their Discord responses to the `conversation_messages` table
- Previously they only posted to Discord via webhook but didn't write to the DB — the supervisor worker's dedup guard couldn't see Discord responses and would post again (double-tap)

### Mobile Reading Experience
- Messages go full-width on mobile (<768px), was capped at 80%
- Compact tabs, header, compose area
- Font bumped to 14px
- iPad gets 90% message width

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
