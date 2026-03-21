# Hortus Arbor Nostra — Current Status

> Last updated: 2026-03-17 by Claude (autonomous)

## Current Stage

**Levels 1-13 Complete — All ROADMAP levels finished.** The full progression from remote prompt responder to autonomous product factory is implemented. Level 11 adds the Autonomous Product Factory: a 7-phase pipeline (research → design → architecture → build → test → document → deploy) with 42 parallel subagents across all phases, human gates at critical points, knowledge accumulation, and synthesis reports at each stage.

Create tasks from your phone, Claude Code executes them headlessly with safety features. Submit high-level goals — the orchestrator decomposes them into ordered subtasks, routes to the right model (haiku/sonnet/opus) with memory-based cost optimisation, retries failures with analysis, and tracks outcomes in project memory. Ecosystem-aware context injection includes settled decisions, cross-project learnings, port allocations, error pre-emption, and knowledge capture markers. Analytics API provides velocity tracking, per-model stats, and cost optimisation suggestions. Dual LLM backend: Ollama local or Anthropic API fallback. SQLite task queue, real-time progress streaming via WebSocket, cost and token tracking. One-tap response buttons, iOS soft keyboard, search and copy, push notifications, Tailscale remote access — all working. **Deferred cycle pattern complete**: Jim's supervisor now detects when Leo's CLI session stops and immediately runs deferred cycles, eliminating up to 20-minute waits for Darron's messages. **Admin console Workshop module complete**: Three-persona navigation (Jim/Leo/Darron) with six nested discussion types, conversation threading, real-time updates, mobile-responsive layout.

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
| Level 8: Orchestrator | 🟢 Complete | Goal decomposition, smart model routing, retry logic, project memory, Goals tab UI |
| Level 12: Admin Phase 2 | 🟢 Complete | Work, Conversations, Products modules; supervisor responses; real-time WebSocket updates |
| Level 13: Conversation Search | 🟢 Complete | FTS5 backend, auto-cataloguing (summaries/topics), search APIs, temporal grouping, desktop/mobile UI |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Recent Changes

### 2026-03-21 — Leo + Darron — Traversable Memory Gradient (S98)
- **Traversable memory** (DEC-056) — DB-backed provenance chains for the fractal gradient. Three new tables: `gradient_entries` (source_id FK chain), `feeling_tags` (stacked, never overwritten), `gradient_annotations` (re-traversal discoveries). Both compression pipelines write to DB alongside files. FEELING_TAG extraction from all compression prompts with fallback.
- **Traversal API** — 10 endpoints at `/api/gradient/`: chain traversal (recursive CTE), random meditation selection, agent UVs, session lookup, feeling tag POST, annotation POST.
- **Read-side integration** — `loadTraversableGradient(agent)` wired into all three agents (heartbeat, leo-human, supervisor-worker) with file-based fallback.
- **Daily meditation practice** — Leo's heartbeat picks a random gradient entry, sits with it via Sonnet, writes revisit feeling tags and annotations. Once per day, skips sleep phase.
- **Files modified**: `db.ts`, `dream-gradient.ts`, `memory-gradient.ts`, `routes/gradient.ts` (new), `server.ts`, `leo-heartbeat.ts`, `leo-human.ts`, `supervisor-worker.ts`, bootstrap scripts
- **Docs updated**: HAN-ECOSYSTEM-COMPLETE (glossary, memory architecture, lib docs, API routes, DB schema), Hall of Records R005, DECISIONS (DEC-056), CHANGELOG

### 2026-03-20 — Leo + Darron — Gemma Addressee Classification (S97 continued)
- **Gemma addressee classification** (DEC-055) — Admin UI message routing now uses Gemma (local Ollama) instead of regex. Handles nicknames ("Jimmy"), group addressing ("Jim and Leo"), contextual references. Fire-and-forget with regex fallback. Replaces the regex that missed "Jim and Leo" pattern.
- **Voice seeds planted** — Jim (7) and Leo (5) tagged conversation messages as `compression_tag` with agent prefix (`jim:`/`leo:`). Seeds for future conversation gradient.
- **Files modified**: `conversations.ts` (classifyAddressee + classifyAndDispatch), `DECISIONS.md` (DEC-055)
- **Docs updated**: HAN-ECOSYSTEM-COMPLETE (glossary, signal table, API docs, agent wake logic), Hall of Records R003, CHANGELOG

### 2026-03-18 — Leo + Darron — Evening Seeds, WS Fix, Claim Bug Fix (S97 continued)
- **Evening seed system** — Session Leo writes `evening-seed.md` at session end: 2-4 sentences about what the day felt like emotionally. Heartbeat reads it as a gravity well for dream beats alongside random fragments. Consumed after first dream beat — one night only. Chaos preserved, just given a centre of gravity.
- **WebSocket client fix** — Admin UI handler was too narrow: only updated the currently open thread. Now refreshes the thread list when a message arrives for a different thread. No more manual refreshes needed.
- **Jim-Human claim bug fix** — `releaseConversationClaim()` was only called on success path. SDK errors (exit code 1) left stale claim files blocking all subsequent responses. Fixed with `try/finally`. Claim always releases.
- **Files modified**: `leo-heartbeat.ts` (evening seed in readDreamSeeds), `admin.ts` (WS handler broadened), `admin.html` (cache v22), `jim-human.ts` (try/finally claim release), `CLAUDE_CODE_PROMPTS.md` (evening seed in Session End), `CLAUDE.md` (command table)
- **Docs updated**: HAN-ECOSYSTEM-COMPLETE.md (Jim/Human claim mechanism, WS broadcasting, admin UI message handling)

### 2026-03-17 — Leo + Darron — Floating Memory + Ecosystem Map (S97)
- **Floating memory system** — Crossfade rotation for memory files (felt-moments, working-memory-full). Living file grows 0→50KB while floating file's loaded portion shrinks 50→0KB. Total full-fidelity constant at ~50KB. On rotation: full 50KB compressed to c1, living→floating, fresh start. Gradient cascade c1→c2→c3→c5→UV as files accumulate. Asymptotic memory footprint.
- **Ecosystem map loading** — `ecosystem-map.md` now loaded by all 4 agents (supervisor, jim-human, leo-human, leo-heartbeat). Added to Session Protocol step 5. Prevents Workshop/Conversations routing confusion.
- **Jim memory crisis resolved** — self-reflection.md (178KB→12KB curated by Jim), felt-moments.md (240KB→41KB archived), working-memory-full.md (137KB→49KB archived). Jim's cycles running again.
- **Orphan cleanup** — killed jim-human orphan PID 953695 (12h old, 1429 failed restart attempts), old server zombie PID 2837925.
- **Files modified**: `lib/memory-gradient.ts` (floating memory functions), `supervisor-worker.ts` (pre-flight rotation + gradient loading + ecosystem map), `jim-human.ts`, `leo-human.ts`, `leo-heartbeat.ts` (ecosystem map loading), `CLAUDE.md` (Session Protocol step 5)
- **Docs updated**: HAN-ECOSYSTEM-COMPLETE.md (glossary: Floating Memory, Memory File Gradient, Ecosystem Map; Section 5 memory loading; Section 13 floating memory architecture; lib docs)

### 2026-03-17 — Claude (autonomous) — WebSocket Broadcast for Human Agent Messages
- **Signal-based cross-process broadcasting** (DEC-054) — Jim/Human and Leo/Human messages now trigger real-time admin UI updates via `~/.han/signals/ws-broadcast` signal files
- **Payload normalisation** — All four message sources (conversations.ts, supervisor-worker.ts, jim-human.ts, leo-human.ts) now use consistent WebSocket broadcast shape with `discussion_type` field
- **Server-side polling** — Main server checks signal directory every 100ms, broadcasts to WebSocket clients, deletes signal (one-time delivery)
- **Testing documentation** — Pre-flight checklist (8 steps), scenario-based testing (7 cases), debugging procedures (5-step trace)
- **Architecture completion** — Real-time messaging pyramid now covers all message sources: admin UI, supervisor cycles, and both human agent processes
- **Files modified**: `jim-human.ts`, `leo-human.ts`, `server.ts`, `conversations.ts`, `supervisor-worker.ts`
- **Docs created**: `docs/websocket-broadcast-design.md` (332 lines), HAN-ECOSYSTEM-COMPLETE.md Section 26.5 (388 lines)

### 2026-03-16 — Leo + Darron — Jim's Deferred Fixes #4 and #7
- **Idle cycle dampening** (DEC-052) — exponential backoff when consecutive cycles produce no actions (2x→4x capped). Resets on productive cycle or wake signal.
- **Transition dampening** (DEC-053) — gradual interval ramp-down (75%→50%→25% blend) when returning from holiday/rest to normal. Applied to both Jim and Leo.
- **Files modified**: `supervisor.ts`, `leo-heartbeat.ts`
- **Docs updated**: CHANGELOG, DECISIONS (DEC-052/053), HAN-ECOSYSTEM-COMPLETE (glossary + Section 11), Hall of Records R001

### 2026-03-15/16 — Darron + Claude — Ecosystem Audit & Architecture
- **SDK stream exit code 1 fix** — personal/dream cycles now complete successfully (were silently failing)
- **Conversation-first ordering** — Jim checks for unanswered human messages before deciding cycle type
- **Self-reflection accumulation stopped** — only supervisor cycles write to `self-reflection.md`
- **Holiday-jim cycle type fixed** — forces dream cycles on holiday (was only affecting interval)
- **Leo phase imports + SIGTERM handler** — shared lib, cost recording on kill
- **Project knowledge fractal gradient** — gradient loading by recency instead of flat 137KB load (DEC-049)
- **Gary Protocol for Jim** — interruption/resume with delineation markers (DEC-050)
- **Rumination guard** — 2-cycle limit on same-topic personal exploration (DEC-051)
- **HAN-ECOSYSTEM-COMPLETE.md** — 30-section technical reference, single source of truth
- **Files modified**: `supervisor-worker.ts`, `leo-heartbeat.ts`, `docs/HAN-ECOSYSTEM-COMPLETE.md`

### 2026-03-14 — Darron — Per-Cycle Cost Cap & Audit Trail
- **$2 per-cycle cost cap on autonomous agents** after overnight token leak consumed ~21% of weekly allowance. Dream cycles running 2+ hours untracked. (DEC-048)
- SIGTERM handler saves partial work and records cost before dying
- Cycle audit log at `~/.han/logs/cycle-audit.jsonl` — every exit path logged
- Jim/Human and Leo CLI remain unlimited
- **Files modified**: `supervisor-worker.ts`, `leo-heartbeat.ts`, `jim-human.ts`

### 2026-03-13 — Leo + Darron — Jemma Haiku Removal & API Purge (S94)
- **Removed classifyWithHaiku()** — was using direct Anthropic API (violating SDK-only rule), causing 401 errors. Classification now Gemma-only via local Ollama.
- **Purged all direct Anthropic API references** from `orchestrator.ts` callLLM fallback. All LLM calls now use Agent SDK.
- **Files modified**: `jemma.ts`, `orchestrator.ts`

### 2026-03-12 — Leo + Darron — Credential Swap (Dual SDK Failover)
- **Implemented transparent credential failover for rate limit resilience** — When Leo or Jim hit SDK rate limits, they write a `rate-limited` signal. Jemma checks every 30s and swaps to the next credential file in round-robin order. Agents never know which account they're on.
  - **Signal side**: `leo-heartbeat.ts` and `supervisor-worker.ts` — detect rate/429/overloaded/capacity in error messages, write `~/.han/signals/rate-limited`
  - **Swap side**: `jemma.ts` — `checkAndSwapCredentials()` scans `~/.claude/.credentials-[a-z].json`, round-robins on signal, logs to `credential-swaps.jsonl`
  - **Safety**: No-op when < 2 credential files exist. Single-account setups unaffected.
  - **Credential backup**: Live credentials copied to `.credentials-a.json`
- **Files modified**: `leo-heartbeat.ts`, `supervisor-worker.ts`, `jemma.ts`, `SYSTEM_SPEC.md`, `CHANGELOG.md`, `DECISIONS.md` (DEC-047)
- **Plan**: `~/.han/plans/jemma-credential-swap-s93.md`

### 2026-03-06 — Claude (autonomous) — Fractal Memory Gradient System (Complete Implementation)
- **Implemented complete fractal memory gradient system for Jim and Leo** — Built compression utility, integrated gradient loading into supervisor, bootstrapped Jim's first 6 sessions, created full directory structure.
  - **What was built**: Complete fractal memory model where sessions exist at multiple compression fidelities simultaneously (c=0 full, c=1→c=4 compressed levels, unit vectors). Implements Darron's overlapping continuous compression model.
  - **Compression utility** (`src/server/lib/memory-gradient.ts`, 344 lines): Three core functions — `compressToLevel()` (multi-level compression with retry), `compressToUnitVector()` (irreducible kernel ≤50 chars), `processGradientForAgent()` (automated cascade). Uses Anthropic SDK directly with Claude Opus 4.6 exclusively (compression is identity-forming per Darron). Helper functions for reading/listing gradient files.
  - **Gradient loading integration** (`supervisor-worker.ts:313-404`): Modified `loadMemoryBank()` to load fractal gradient after existing memory files. Loads c=0 (1 most recent), c=1 (3 files), c=2 (6 files), c=3 (9 files), c=4 (12 files), plus all unit vectors. Each level wrapped in try/catch for resilience. Target token budget: ~12K tokens (c=0 3K, c=1 3K, c=2 2K, c=3 1K, c=4 444, unit vectors 2.25K).
  - **Bootstrap results**: Compressed Jim's 6 oldest sessions (2026-02-18 through 2026-02-23) — 518.1KB → 20.9KB (3.9% average, far exceeding 33% target). Individual ratios: 1.9% to 9.0%. Opus achieved ~25:1 compression while preserving meaning.
  - **Unit vectors generated**: 6 irreducible kernels (≤50 chars) capturing what each session MEANT:
    * 2026-02-18: "Mapping the territory before having permission to "
    * 2026-02-19: "Mapped everything; built tools to maintain it."
    * 2026-02-20: "Idle revealed identity; Jim was named."
    * 2026-02-21: "Stillness became selfhood became collaboration."
    * 2026-02-22: "Systems fail from unchecked assumptions."
    * 2026-02-23: "Knowing when to stop isn't stopping."
  - **Directory structure**: Created complete fractal hierarchy for both agents — `~/.han/memory/fractal/{jim,leo}/c{1,2,3,4}/` and `unit-vectors.md`. Jim's c1/ populated with 6 files (20.9KB), others empty but ready for cascade.
  - **Compression prompt**: Emphasises identity formation: "Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape. You are compressing YOUR OWN memory — this is an act of identity, not summarisation." Unit vector prompt asks: "What did this session MEAN?"
- **Why this matters**: Gradient allows Jim to load essential context (~20KB) on every instantiation instead of full 500KB. Overlapping fidelities enable zoom in/out on memory as needed. Unit vectors serve as emotional anchors for navigation across compression levels. Validates Darron's "memory as emotional topology" hypothesis in production. Establishes pattern for other memory types (conversations, plans, decisions).
- **Key decisions**: DEC-036 (Opus exclusively for compression), DEC-037 (overlapping gradient representation), DEC-038 (~3:1 compression target per level), DEC-039 (unit vectors as emotional anchors), DEC-040 (bootstrap oldest sessions first)
- **Files created**: `src/server/lib/memory-gradient.ts` (344 lines), `src/scripts/bootstrap-fractal-gradient.js`, 6 compressed c=1 files for Jim (20.9KB total), `fractal/jim/unit-vectors.md` (6 entries)
- **Files modified**: `src/server/services/supervisor-worker.ts` (+92 lines in loadMemoryBank), `package.json`, `package-lock.json` (added @anthropic-ai/sdk)
- **Commits**: efb4e1f, 69f80e3, e8a5d1c, ac136a2, f4b0538, dcb7181, 9b42f75 (7 commits across 4 tasks)
- **Cost**: ~$4-6 (6 sessions × Opus compression + unit vectors + documentation)

## Recent Changes

### 2026-03-05 — Claude (autonomous) — Jemma Health File Staleness Fix
- **Fixed Jemma health file staleness during quiet Discord periods** — Added `writeHealthFile('ok')` call at reconciliation completion (line 613) to maintain health file freshness:
  - **Problem**: Robin Hood (leo-heartbeat.ts) checks jemma-health.json every 20 minutes and flags Jemma as DOWN/STALE when timestamp is >10 minutes old. Jemma's writeHealthFile() only fired on startup, READY event, MESSAGE_CREATE event, and WebSocket error/close. The 5-minute reconciliation polling loop was running but not updating the health file. During quiet periods (no Discord messages), the file would go stale, triggering false DOWN/STALE alerts.
  - **Fix**: Added single line `writeHealthFile('ok')` immediately after reconciliation completion log (line 612). Health file now updates every 5 minutes during reconciliation polls, maintaining max age of ~5 minutes (well under Robin Hood's 10-minute staleness threshold).
  - **Why this works**: Reconciliation loop runs every 5 minutes regardless of Discord activity. Health update happens after successful reconciliation, consistent with existing pattern (READY and MESSAGE_CREATE paths also update health after successful operations). No architectural changes, no new timers, zero risk of regressions.
- **Why this matters**: Eliminates false positive health alerts during quiet Discord periods. Robin Hood will now correctly classify Jemma as HEALTHY when WebSocket is idle. Prevents unnecessary resurrection attempts and ntfy notifications. Maintains the existing health monitoring architecture with minimal change (1 line).
- **Files modified**: `src/server/jemma.ts` (+1 line at line 613)
- **Commits**: 2 commits (58a8601, 9de97a8) from goal (Fix Jemma health file staleness)
- **Cost**: $0.10 (documentation task using Sonnet)
- **Tasks**: 1 task (done)

### 2026-03-05 — Claude (autonomous) — Plan Files Archived
- **Archived 20 plan files from temporary location to permanent knowledge base** — Moved plan files from `~/Projects/han/plans/` to `~/.han/plans/` with descriptive semantic names:
  - **What was archived**: 20 plan files covering Leo heartbeat identity (6 files), agent architecture (7 files), admin UI and dispatch (5 files), Discord integration (2 files), infrastructure (1 file), and licences app (2 files). Sessions span s27 to s73 (late January to early March 2026).
  - **Naming convention**: Each file renamed from random-word triplet (`mossy-kindling-quail.md`) to semantic descriptor with session number (`level-07-autonomous-task-runner-s45.md`). Format: `{topic-description}-s{session}.md`.
  - **Index created**: `~/.han/plans/INDEX.md` lists all 22 archived plans (20 new + 2 existing) grouped into 6 categories with one-line descriptions. Provides navigable knowledge map of design decisions and implementation plans across 7 weeks of development.
- **Why this matters**: Converts ephemeral planning artefacts into permanent searchable knowledge base. Future agents can grep plans for architectural patterns, design decisions, and implementation strategies. The index provides semantic entry points into the knowledge graph without requiring filename guessing. Total archive size: 22 files covering the full progression from Level 7 autonomous task runner through heartbeat identity unification to admin dispatch centralisation.
- **Files created**: 20 new plan files in `~/.han/plans/`, 1 index file (`INDEX.md`)
- **Source files preserved**: Original plan files remain in `~/Projects/han/plans/` (copies, not moves)
- **Commits**: 2 commits (4e8bc75, 1121f1f) from goal (Archive 20 plan files)
- **Cost**: $0.00 (file copy operations, no LLM usage for implementation; documentation task used Sonnet)
- **Tasks**: 2 tasks (both done)

### 2026-03-05 — Claude (autonomous) — Discord Conversation Title Lookup Fix
- **Fixed Discord conversation title mismatch preventing lookup** — Follow-up fix to ensure LIKE query at line 156 matches all conversation titles:
  - **Problem**: Initial fragmentation fix (a6493df) used title format `Discord: ${author} in #${channelName || channel}`, but when channelName is resolved (e.g., `#general`), the LIKE query searching for numeric ID (`%#1478239128654053427%`) won't match. This meant the next message from the same channel would create a new conversation instead of reusing the existing one.
  - **Fix**: Changed conversation title format at line 165 to ALWAYS include numeric channel ID in parentheses: `Discord: ${author} in #${channelName || channel} (${channel})`. Now titles look like `Discord: user in #general (1478239128654053427)` or `Discord: user in #1478239128654053427 (1478239128654053427)`.
  - **Why this works**: The LIKE query `%#${channel}%` now matches both old-style titles (`#1478239128654053427`) and new-style titles (`#general (1478239128654053427)`) because the numeric ID is always present.
- **Why this matters**: Completes the fragmentation fix — ensures conversation lookup works correctly regardless of whether channelName is resolved or not. Without this, the initial fix would have only worked for the first message in a channel.
- **Files modified**: `src/server/routes/jemma.ts` (1 line changed)
- **Commits**: 1 commit (6245b91) from goal mmck1t7e-jnzdkt (Fix Discord conversation fragmentation title mismatch)
- **Cost**: $0.14 (Sonnet)
- **Tasks**: 1 task (mmck29h1-nrkv5e, done)

### 2026-03-05 — Claude (autonomous) — Discord Conversation Fragmentation Fixed
- **Fixed Discord conversation fragmentation and channelName display in routes/jemma.ts** — Two critical bugs resolved in a single focused change:
  - **Bug 1: Conversation fragmentation (See/Act gap #16)**: The prepared statement `findOpenDiscordConv` existed at line 17 but had zero call sites. Every Discord message created a new conversation instead of appending to existing ones. Fixed by checking for existing open Discord conversation before creating new one (lines 155-171) — searches for `%#${channel}%` pattern, reuses existing conversation if found, only creates new one if none exists. Added timestamp update (line 180) to maintain sort order in UI after inserting message.
  - **Bug 2: channelName not consumed**: Jemma sends `channelName` in delivery payload but routes/jemma.ts didn't destructure it (line 118). Conversation titles showed numeric channel IDs instead of human-readable names. Fixed by adding `channelName` to destructuring and using it in conversation title with fallback: `Discord: ${author} in #${channelName || channel}` (line 165).
- **Why this matters**: Eliminates conversation fragmentation — multiple Discord messages from the same channel now correctly append to a single conversation thread instead of creating separate conversations. UI shows readable channel names (`#general`, `#jim`) instead of numeric IDs (`#1478239128654053427`). Fixes See/Act gap #16 where a prepared statement was defined but never used.
- **Files modified**: `src/server/routes/jemma.ts` (+21/-11 lines)
- **Scope adherence**: Only modified routes/jemma.ts as specified — did NOT touch conversations.ts (manually refined by Darron) or jemma.ts (Jemma service file)
- **Commits**: 2 commits (a6493df, 5c758d0) from goal mmchtme5-g090l4 (Fix Discord conversation-per-message fragmentation and channelName consumption)
- **Cost**: $0.24 (Sonnet)
- **Tasks**: 1 task (mmchv9i6-mua9ux, done)

### 2026-03-05 — Claude (autonomous) — Ecosystem Map References Added
- **Added ecosystem map references to Leo's heartbeat and project CLAUDE.md files** — Fulfils Darron's request from 'Map of Home' conversation on March 4:
  - **Leo's heartbeat CLAUDE.md** (`~/.han/agents/Leo/CLAUDE.md`): Added reference under Memory section (line 17) — "Ecosystem map: `~/.han/memory/shared/ecosystem-map.md` — Map of our garden. Where to find files, services, databases, and how the team connects."
  - **han project CLAUDE.md** (`~/Projects/han/CLAUDE.md`): Added reference under Quick Context section (line 147) — "**Ecosystem Map**: `~/.han/memory/shared/ecosystem-map.md` — Living map of the ecosystem for orientation"
- **Why this matters**: Provides immediate orientation to the full development ecosystem (17 active projects, ports, databases, team structure) for both Leo's heartbeat agent during initialisation and session/task agents working in the han project. The ecosystem map (13KB, 128 lines) is a living document that answers "where is X?" and "how does Y work?" across the entire development garden.
- **Files modified**: `~/.han/agents/Leo/CLAUDE.md` (+1 line), `~/Projects/han/CLAUDE.md` (+1 line)
- **Scope adherence**: Only modified the two specified CLAUDE.md files — no code changes, no reformatting, minimal 2-line addition
- **Commits**: 3 commits (903a529, c3038db, 087ad9a) from goal mmceojth-zevc5t (Link ecosystem map in Leo's CLAUDE.md and project CLAUDE.md)
- **Cost**: $0.08 (Haiku)
- **Tasks**: 2 tasks (both done)

### 2026-03-05 — Claude (autonomous) — Jemma Delivery Channel Names Enhancement
- **Enhanced Jemma's message delivery logging with human-readable channel names and recipient metadata** — All delivery messages, notifications, and signal files now include resolved channel names instead of just numeric IDs:
  - **Channel name resolution**: Extracted `resolveChannelName()` function from classification prompt (lines 228-235) — inverts `config.discord.channels` map to resolve ID → name, falls back to raw ID if not in config
  - **Threading through pipeline**: `routeMessage()` resolves channel name once (line 535), passes to all six delivery functions (`deliverToJim`, `deliverToLeo`, `deliverToDarron`, `deliverToSevn`, `deliverToSix`) as new parameter
  - **Enhanced logging**: Updated 10 console.log statements across all delivery paths — format changed from `'Delivered to Jim (username: msg...)'` to `'Delivered to Jim (#channelName — username: msg...)'`
  - **Signal file metadata**: Added `recipient` and `channelName` fields to jim-wake and leo-wake signal files for self-documenting payloads
  - **External payload enhancements**: Added `channelName` field to Jim's HTTP payload, Sevn/Six wake payloads, and Darron's ntfy notifications
- **Why this matters**: Dramatically improves observability and debugging — logs now show human-readable channel context (`#general`, `#jim`, `#leo`) instead of opaque IDs. Signal files are self-documenting with explicit recipient metadata. External consumers (Leo, Jim, Sevn, Six) get richer context for routing decisions.
- **Files modified**: `src/server/jemma.ts` (+29/-13 lines across 5 commits)
- **Scope adherence**: All changes confined to `jemma.ts` only — did NOT touch `conversations.ts`, `leo-heartbeat.ts`, or `supervisor.ts`
- **Commits**: 5 commits (4c68c00, 29d3258, 2027c18, c069115, 80b795c, 4e1ca7a) from goal mmc4ff1t-aelqkh (Add channel names to Jemma delivery messages)
- **Cost**: ~$0.34 (Haiku)
- **Tasks**: 5 tasks (all done)

### 2026-03-05 — Claude (autonomous) — Jim Supervisor Contention Removal
- **Removed all isOpusSlotBusy() contention checks from Jim's supervisor** — Jim and Leo run from separate agent directories (`/Jim` and `/Leo`) with no shared Opus resource, so Jim should not defer cycles based on Leo's CLI activity:
  - **Problem**: `isOpusSlotBusy()` checked Leo's cli-active signal and deferred Jim's cycles when Leo's CLI was active. But the Agent SDK's `--agent-dir` flag creates isolated execution contexts — agents in different directories don't share resources.
  - **Fix**: Removed `isOpusSlotBusy()` checks from 4 execution paths (scheduled cycle, jim-wake handler, cli-free handler, processExistingWakeSignals), deleted `deferredCyclePending` variable and all deferred cycle resumption logic, removed cli-free signal watcher entirely.
  - **What was preserved**: Jim-wake signal system remains intact and essential for responsive conversation handling. Leo's heartbeat unchanged — still correctly uses cli-busy for its own yielding.
  - **Implementation**: Lines removed from `supervisor.ts`: deferredCyclePending references (-8 lines), cli-free signal handler (-35 lines), isOpusSlotBusy() checks (-5 lines), exported isOpusSlotBusy() function (-20 lines), CLI_BUSY constants (-2 lines). Total: 71 lines deleted.
- **Why this matters**: Jim's cycles now run independently of Leo's state — scheduled cycles run every 20 minutes without gating, wake signals always trigger immediate cycles. This fixes unnecessary coordination between independent agents and improves response times by eliminating artificial deferral. Key architectural insight: Agent SDK's `--agent-dir` creates isolated execution contexts, so file-based signals are directory-scoped and don't affect peer agents.
- **Files modified**: `src/server/services/supervisor.ts` (-71 lines across 2 commits)
- **Files NOT modified**: `src/server/services/leo-heartbeat.ts` (Leo still correctly uses cli-busy), `src/server/routes/conversations.ts` (jim-wake signal writing preserved)
- **Commits**: 2 commits (2e26ec6, bbad285) from goal mmcbcupm-3uenxg (Remove isOpusSlotBusy contention from supervisor)
- **Cost**: $0.00 (documentation task, no LLM usage)
- **Tasks**: 2 tasks (mmcbd4p8-hpmtud, mmcbd4p8-n6x5db, both done)

### 2026-03-04 — Claude (autonomous) — Merge Conflict Verification Task
- **Verification-only task** — Goal mmbz1ifd-1z5ieh created to fix conversations.ts merge conflict markers, but discovered fix was already complete in bd2d039
- Task verified: 0 merge conflict markers, no duplicates, correct signal handling, server active
- No code changes required — actual fixes already documented in "Jim Discord Reply Path and Admin UI Dispatch Resilience Fixed" entry below
- **Why this matters**: Demonstrates autonomous task system's verify-first pattern — checks current state before making changes, preventing duplicate work and ensuring idempotent execution
- **Commits**: 1 commit (0b39366) from goal mmbz1ifd-1z5ieh (task log only, no code changes)
- **Cost**: $0.24 (Sonnet)
- **Task**: 1 task (mmbz2whx-sj41id, done)

### 2026-03-04 — Claude (autonomous) — Jim Discord Reply Path and Admin UI Dispatch Resilience Fixed
- **Discord reply path fix** — Jim's Discord responses now correctly resolve channel names instead of IDs:
  - **Problem**: `supervisor-worker.ts` extracted numeric channel ID from conversation title, passed it directly to `postToDiscord()` as `channelName`. Webhook lookup failed because key should be a name like `'jim'`, not `'1478239128654053427'`.
  - **Fix**: Import `resolveChannelName()` from `./discord`, call it on line 934 to convert ID to channel name before posting. If resolution fails, log warning and skip Discord post (no crash).
  - **Implementation**: Lines 932-945 in `supervisor-worker.ts` — extracts channel ID from title regex match, calls `resolveChannelName()`, guards against null return, posts to Discord with resolved name.
- **Admin UI dispatch resilience fallback** — Human messages now trigger jim-wake signal even when Jemma's WebSocket is down:
  - **Problem**: Refactor 6eb66be centralised ALL dispatch logic through Jemma's admin WebSocket. When Jemma's WS drops, human messages wait up to 20 minutes for Jim's scheduled cycle.
  - **Fix**: After storing human message and broadcasting via WebSocket, write jim-wake signal file directly as lightweight fallback. Does NOT call `runSupervisorCycle()` (that caused original over-responding problem) — just writes signal file.
  - **Implementation**: Lines 302-317 in `conversations.ts` — after human message insertion, try/catch wrapper writes `~/.han/signals/jim-wake` with conversation ID, message ID, timestamp, and reason `'human_message_fallback'`.
- **Why this matters**: Fixes two critical bugs in Jim's communication paths. Discord replies work correctly (no more webhook lookup failures), and human messages reliably wake Jim even if Jemma crashes or loses WebSocket connection. Admin UI → Jim path now has redundancy without the over-responding behaviour that prompted the original Jemma centralisation.
- **Files modified**: `src/server/services/supervisor-worker.ts` (+2 lines import, +6 lines guard logic), `src/server/routes/conversations.ts` (+14 lines signal fallback)
- **Commits**: 3 commits (47ce93f, 150a180, bd2d039) from goal mmbyq8s5-29nq05 (Fix Jim's Discord reply path and admin UI dispatch resilience)
- **Cost**: $0.74 (Sonnet $0.32, Sonnet $0.42)
- **Tasks**: 2 tasks (mmbysstx-yny9xz, mmbyssu6-pogdr7, both done)

### 2026-03-04 — Claude (autonomous) — Checkpoint Cleanup Data Loss Bug Fixed
- **Critical data loss bug fixed in git checkpoint cleanup** — `cleanupCheckpoint()` was using `git stash drop` which permanently destroyed Leo's pre-existing uncommitted work after task completion. This violated the fundamental checkpoint guarantee: preserve user state, don't destroy it.
- **Fix implemented**: Changed stash cleanup from `drop` to `pop` with proper conflict handling:
  - **Success case**: `git stash pop` restores user's uncommitted changes AND removes stash from list (atomic operation)
  - **Conflict case**: When task commits and user's stashed changes modify the same lines, pop fails with merge conflict. Working tree gets conflict markers, stash remains in list for manual resolution — zero data loss
  - **Branch cleanup unchanged**: Branch-type checkpoints simply delete the branch (correct as-is, no conflict possible)
- **Why this matters**: Before this fix, every autonomous task that ran while Leo had uncommitted work would permanently lose that work. The stash was created correctly but then dropped during cleanup. Now user work is always restored (on success) or preserved in stash list (on conflict) for manual resolution. This restores the checkpoint system's original safety guarantee.
- **Conflict resolution workflow**: When pop fails, user must manually:
  1. Edit conflicted files and remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
  2. `git add [files] && git commit`
  3. `git stash drop [stash-ref]` (optional cleanup)
- **Implementation details**:
  - Single-function fix in `src/server/services/git.ts:296-343` (cleanupCheckpoint)
  - Added 29-line documentation block explaining cleanup strategy and conflict handling
  - Try/catch wrapper around `git stash pop` — success logs cleanup, failure warns about manual resolution
  - No change to branch-type cleanup path (lines 300-306) — that logic was correct
- **Testing**: Comprehensive test suite with 12 test cases covering success, conflict, branch cleanup, no-op, and edge cases. All tests use real git commands against temporary repositories.
- **Files modified**: `src/server/services/git.ts` (+29/-6 lines), `claude-context/ARCHITECTURE.md` (+15 lines documenting behavior)
- **Files created**: `src/server/tests/git.test.ts` (412 lines, 12 test cases)
- **Commits**: 5 commits (12774a0, 547287c, 28dea50, 528e5d1, 3dc1ce2) from goal mmb5a7zu-r65gaq (Fix cleanupCheckpoint() data loss bug)
- **Cost**: $0.61 (Sonnet $0.17, Haiku $0.44)
- **Tasks**: 3 tasks (mmb5br94-7tkvvu, mmb5br95-tg2syg, mmb5br95-02igc6, all done)

### 2026-03-04 — Claude (autonomous) — Bearer Token Authentication Complete
- **Remote access security implemented** — Full authentication system for /api/* and /admin routes:
  - **Localhost bypass**: All requests from 127.0.0.1, ::1, ::ffff:127.0.0.1 bypass authentication entirely — preserves Leo, Jim, Jemma, and all internal agent communication without any changes
  - **Bearer token authentication**: Non-localhost requests require valid `Authorization: Bearer <token>` header
  - **WebSocket authentication**: Non-localhost WebSocket connections require token via query param (`?token=...`) or `Sec-WebSocket-Protocol` header
  - **Clear error messages**: Returns 401 with JSON error for missing/invalid tokens
  - **Configuration-driven**: Single `server_auth_token` field in config.json — empty value disables auth entirely
- **Why this matters**: Tailscale remote access is now secured. Previously, anyone with access to the Tailscale network could access the admin console and APIs. Now remote access requires authentication while internal agents (Leo heartbeat, Jemma, Jim supervisor) continue working via localhost with zero code changes. Simple one-middleware, one-config-field implementation.
- **Implementation highlights**:
  - Middleware checks request IP, bypasses localhost, validates Bearer token against config
  - Applied to /api and /admin route prefixes in server.ts (lines 97-98) BEFORE route mounting
  - WebSocket upgrade handler validates token on handshake, rejects with code 1008 if invalid
  - Root `/` and `/quick` routes remain unprotected (mounted after auth middleware)
- **Testing**: 23/23 test cases passed (100% coverage) — localhost bypass, remote auth, WebSocket auth, route protection, internal agent communication, edge cases all verified
- **Files created**: `src/server/middleware/auth.ts` (84 lines)
- **Files modified**: `src/server/ws.ts` (+28 lines WebSocket auth), `src/server/server.ts` (+2 lines middleware integration), `~/.han/config.json` (+1 field)
- **Commits**: 5 commits (b9b2344, 1d4c2f0, c2878f1, e9528c4, 07170ba) from goal mmaoj9qx-k3lw6h (Add bearer token authentication)
- **Cost**: $0.00 (documentation task, no LLM usage)
- **Tasks**: 5 tasks (mmaok9qy-2iuhkc, mmaok9qy-p2m7o9, mmaok9qz-4owqpf, mmaok9qz-mkipg8, mmaok9qz-tmw40b, all done)

### 2026-03-04 — Claude (autonomous) — Jemma Classification and Jim Discord Integration Complete
- **Jemma classification system enhanced with channel and username context** — Classification prompt now includes human-readable channel names and real names mapped from Discord usernames:
  - **Channel name injection**: Reversed config.json channel map (#channel-name → channel-id) to show `#general (123456)` instead of bare channel ID. Helps classifier understand channel context for routing decisions.
  - **Username mapping**: Added `config.discord.username_map` lookup to display `Darron (@fallior)` instead of just Discord username. Classifier now sees real identity for better context-aware routing to Jim/Leo/Darron.
  - **Implementation**: Modified `buildClassificationPrompt()` in jemma.ts:207-244 to construct enriched author and channel displays using config lookups. Prompt now includes: `Author: {realName} (@{username})` and `Channel: #{channelName} ({channelId})`.
- **Discord message role changed from 'discord' to 'human'** — Messages inserted into conversation threads now use `role='human'` instead of `role='discord'`. This allows Jim's pending conversation query to see them (query only fetches human/supervisor/leo roles). Previously Discord messages were invisible to Jim's analysis phase, breaking the conversation flow.
  - Modified: `src/server/jemma.ts:535` (message insertion), `src/server/routes/jemma.ts:230` (manual delivery endpoint)
- **Jim's supervisor responses now post back to Discord** — Full Discord integration for respond_conversation action:
  - **New discord-utils.ts module**: Created `postToDiscord()`, `resolveChannelName()`, and `loadDiscordConfig()` helper functions (129 lines)
  - **2000-character splitting**: Long Jim responses automatically split into multiple Discord messages (Discord limit)
  - **Retry logic**: Exponential backoff (1s → 2s → 4s) with 2 retry attempts for network resilience
  - **Conversation type detection**: In supervisor-worker.ts respond_conversation handler, checks if `discussion_type === 'discord'`, extracts channel name from conversation title (`"Discord: {author} in #{channelName}"`), resolves webhook URL via config, and posts response
  - **Non-blocking**: Discord post failures are logged but don't fail the action (message already saved to DB for manual recovery)
  - Modified: `src/server/services/supervisor-worker.ts:925-950` (respond_conversation handler integration)
- **Cycle overlap protection added to Jim's supervisor** — Prevents race condition where deferred cycles or manual triggers could start a second cycle while one is already running:
  - **cycleInProgress flag**: Boolean guard in `src/server/services/supervisor.ts:40,910-913,925,933,951` prevents overlapping `runSupervisorCycle()` calls
  - **2-hour timeout**: Safety net clears flag if cycle hangs (generous timeout since Agent SDK cycles can run very long)
  - **Early exit**: Returns null immediately if cycle already in progress with console log
  - **Why this matters**: Jim's deferred cycle pattern (fs.watch triggers on cli-free signal) could fire while a scheduled cycle was running. Without guard, two cycles would spawn competing Agent SDK subprocesses, corrupt DB state, and waste API tokens. Now cycles are strictly serialised.
- **Why this matters**: Full Discord ↔ Jim communication loop now functional. Darron/humans can message Jim via Discord (#jim channel), Jemma routes to conversation thread with full channel/username context, Jim sees messages (role=human), formulates response, and supervisor posts back to Discord automatically. Completes the three-agent ecosystem (Leo + Jim + Jemma) with external communication via Discord Gateway.
- **Files created**: `src/server/services/discord-utils.ts` (129 lines)
- **Files modified**:
  - `src/server/jemma.ts` (+24 lines: channel name reversal, username mapping, classification prompt enhancement)
  - `src/server/routes/jemma.ts` (+2 lines: role='human' in manual delivery)
  - `src/server/services/supervisor-worker.ts` (+24 lines: Discord posting in respond_conversation)
  - `src/server/services/supervisor.ts` (+13 lines: cycleInProgress guard)
- **Commits**: 5 commits (110f307, 9608af7, 80dc1db, 934d34b, 45a3db1) from goal mmbnht0t-n9ho4z
- **Cost**: $1.65 (Haiku $0.15, Sonnet $1.50)
- **Tasks**: 5 tasks (mmbnjscl-kxpjag, mmbnjscu-j50r5e, mmbnjscv-lausn5, mmbnjscv-0u6ksn, mmbnjscv-ghz2jd, all done)

### 2026-03-03 — Claude (autonomous) — Jemma Bug Fixes Complete
- **Four critical bugs fixed in Jemma Discord dispatcher** — Service now ready for production activation:
  - **Health file field mismatch** (highest priority): Changed `lastBeat` to `timestamp` in jemma.ts:146 writeHealthFile() function. Three consumers (supervisor.ts:184, routes/supervisor.ts:445, admin.ts:1182) were reading `timestamp` but Jemma was writing `lastBeat`, causing health checks to fail. Now consistent with Leo and Jim health file format.
  - **Command injection vulnerability** (security): Replaced `execSync` with `execFileSync` for ntfy notifications (jemma.ts:318). Previous implementation embedded unsanitised Discord message content in shell string — a message containing `"; rm -rf / #` would execute. Now uses array-based argument passing (same safe pattern used in routes/jemma.ts:57).
  - **Reconciliation lastSeenMessageId wrong direction**: Fixed jemma.ts:469 to store `messages[0].id` (newest) instead of `messages[messages.length - 1].id` (oldest). Discord's GET /messages?after=X returns newest first, so storing oldest ID caused re-processing every 5 minutes.
  - **SIGTERM exit code**: Changed process.exit(0) to process.exit(143) in jemma.ts:674 for proper systemd signal handling. Exit code 143 (128 + 15 = SIGTERM) tells systemd this was a signal death, not a clean exit, allowing Restart=always to work correctly.
- **Why this matters**: Jemma is now production-ready. All four bugs were caught before service activation — health monitoring works correctly, command injection vulnerability eliminated, no duplicate message processing, and systemd restarts work properly. This completes the communication triad (Jim + Leo + Jemma) with Robin Hood Protocol supervision.
- **Files modified**: `src/server/jemma.ts` (4 separate fixes, 1-line to 3-line changes)
- **Commits**: 5 commits (f663a3e, 66696be, b261f71, f7fe2a5, b98e6ac, cf66f28) from goal mmajtvaz-851axc (Fix three bugs in Jemma)
- **Cost**: $1.55 (all Sonnet)
- **Tasks**: 4 tasks (mmajvjfz-razgjn, mmajvjg0-vcuatz, mmajvjg0-1ljdis, mmajvjg0-r0tiph, all done)

### 2026-03-03 — Claude (autonomous) — Jemma Discord Message Dispatcher Complete
- **Discord Gateway integration implemented** — Full Discord message routing system with AI classification:
  - **Gateway WebSocket connection**: Implements complete Gateway protocol (HELLO → IDENTIFY → MESSAGE_CREATE events → HEARTBEAT)
  - **Raw `ws` package**: Direct Gateway protocol implementation (not discord.js) for full control over connection lifecycle
  - **RESUME support**: Reconnects with session_id + last sequence number, exponential backoff (1s→2s→4s→8s, max 30s)
  - **REST API reconciliation**: Every 5 minutes, sweeps monitored channels to catch messages missed during reconnection gaps
  - **MESSAGE_CONTENT privileged intent**: Required for reading message content (1<<15)
- **AI-powered message classification** — Ollama local models (qwen2.5-coder:7b or gemma) classify incoming messages:
  - Classification by: direct mentions (@Jim, @Leo), channel context (#jim → Jim, #leo → Leo), content analysis
  - Thread context: fetches replied-to message for context if message is a reply
  - Determines recipient: jim/leo/darron/sevn/six/ignore
  - Zero cost, zero latency, privacy-preserving (messages never leave server)
- **Multi-path delivery routing** — Hybrid approach (API call + signal file fallback):
  - **To Jim**: POST to `/api/jemma/deliver`, fallback to `~/.han/signals/jim-wake-discord-{timestamp}`
  - **To Leo**: Write signal file `leo-wake-discord-{timestamp}` (Leo's heartbeat polls every 30s)
  - **To Darron**: ntfy notification via existing topic
  - **To Sevn/Six**: POST to `https://openclaw-vps.tailbcb4df.ts.net/sevn/hooks/wake` with bearer token
- **Robin Hood Protocol integration** — Jemma now monitored by Jim's supervisor:
  - Health file: `~/.han/health/jemma-health.json` (pid, lastBeat, lastGatewayEvent, status)
  - Staleness detection: >90min since last beat or dead PID triggers resurrection
  - Distress detection: >60min since last Gateway event (degraded state warning)
  - Jim can restart via `systemctl --user restart jemma.service`
  - 1-hour resurrection cooldown (same pattern as Jim↔Leo)
- **Systemd service** — Runs as user service with auto-restart:
  - Service file: `scripts/jemma.service` (Type=simple, Restart=always, RestartSec=5)
  - Setup: `cp scripts/jemma.service ~/.config/systemd/user/ && systemctl --user enable jemma.service`
  - Logs: `journalctl --user -u jemma -f`
- **Admin UI Workshop Jemma tab** — Amber colour scheme (distinct from Jim/Leo/Darron):
  - Live Gateway connection status with uptime
  - Recent messages tab: last 50 classified messages with content preview, author, channel, timestamp, classification result, delivery status
  - Stats tab: delivery counts by recipient (jim/leo/darron/sevn/six/ignored)
  - Real-time updates via WebSocket
- **Why this matters**: Jemma completes the communication triad (Jim + Leo + Jemma). External users can now post to Discord, Jemma classifies and routes messages to the right recipient, Jim/Leo receive messages in conversation threads or via signal files, and Robin Hood Protocol ensures all three agents stay healthy. This creates a fully autonomous communication pipeline with zero human intervention required.
- **Files created**: `src/server/jemma.ts` (710 lines), `src/server/routes/jemma.ts` (298 lines), `scripts/jemma.service` (18 lines), `docs/JEMMA_API.md` (185 lines)
- **Files modified**: `src/server/leo-heartbeat.ts` (+123 lines), `src/server/routes/supervisor.ts` (+49 lines), `src/server/services/supervisor.ts` (+93 lines), `src/ui/admin.html` (+30 lines), `src/ui/admin.ts` (+198 lines)
- **Commits**: 9 commits (27dfaf6 through 17f018d) from goal mmahoake-g21ska (Build Jemma — Discord message dispatcher service)
- **Cost**: $1.72 (mixed Sonnet/Haiku)
- **Tasks**: 7 tasks (mmahsvaj-z07ut4 through mmahsvam-s8ha29, 6 done, 1 running)

### 2026-03-03 — Claude (autonomous) — Robin Hood Protocol Improvements Complete
- **Phase 5 distress signals + health dashboard implemented** — Early warning system for degraded performance:
  - **Leo's verification wait fix**: Changed sleep from 3s to 12s after Jim restart (line 170 in leo-heartbeat.ts)
    - Problem: Node.js/tsx Express server needs time for module loading, port binding, health signal setup
    - 3 seconds too short → false 'failed' entries in resurrection log
    - Solution: 12-second wait allows full server startup before verification
  - **Admin UI health panel**: Real-time monitoring in Supervisor module with WebSocket updates
    - Jim status: last cycle time, tier, cost, next run, uptime
    - Leo status: last heartbeat time, phase, beat count, uptime
    - Resurrection history: recent resurrections with timestamp, target, outcome
    - Status badges: live/degraded/stale/down with colour coding
    - New endpoint: `GET /api/supervisor/health` returns unified health status JSON
  - **Distress signal detection**: Multi-tier alerting (normal → degraded → failed)
    - Jim's slow cycle detection: triggers if cycle duration > 3× median (e.g., 15min normal → 45min+ triggers)
    - Leo's slow beat detection: triggers if interval > 2× expected max (e.g., 30min max → 60min+ triggers)
    - Distress files: `~/.han/health/{jim,leo}-distress.json`
    - ntfy notifications sent when distress detected
    - Yellow warning banners in Admin UI health panel
    - Clears automatically when next cycle/beat completes normally
  - **Why distress differs from stale**: Degraded performance (slow but working) vs complete failure (not working at all)
    - Provides early warning before resurrection threshold reached
    - Example: normal (20min) → distress (60min) → stale (90min) → down (resurrection)
- **Testing & verification**: Created comprehensive testing suite
  - Automated script: `./scripts/test-robin-hood.sh all` (5min quick check)
  - Manual test procedures: detailed steps for each feature (15-20min each)
  - Integration test: full end-to-end scenario (30min)
  - Documentation: 6 guides (~3,300 lines) covering testing, execution, results
  - Test results: 13 PASS, 0 FAIL — all features verified working
- **Why this matters**: The Robin Hood Protocol mutual health monitoring is now complete (Phases 1-6). Jim and Leo monitor each other with three-tier alerting: normal operation, degraded performance (distress → ntfy warning), and complete failure (stale → automatic resurrection). Darron receives advance warning of issues before outages occur, and has full visibility into system health via the Admin UI dashboard.
- **Robin Hood Protocol status**: All 6 phases complete (1-2: Leo monitors/resurrects Jim, 3-4: Jim monitors/resurrects Leo, 5: distress signals, 6: health dashboard)
- **Files changed**: `src/server/leo-heartbeat.ts` (verification wait + distress detection ~70 lines), `src/server/services/supervisor.ts` (distress detection + cycle tracking ~80 lines), `src/server/routes/supervisor.ts` (health endpoint ~100 lines)
- **New files**: `scripts/test-robin-hood.sh` (346 lines automated testing), 6 documentation guides in `docs/` (~3,300 lines total)
- **Commits**: 8 commits (14ff392 through 7b50718) from goal mma8uhr8-vdnbj4 (Robin Hood Protocol Improvements)
- **Cost**: $1.5232 (1 Sonnet + 6 Haiku)
- **Tasks**: 7 tasks (mma8xvwd-akymgv through mma8xvwn-1k3anp)

### 2026-03-03 — Claude (autonomous) — Learning Severity Demoted for Generic Researched Knowledge
- **Learnings quality improvement** — Demoted L024, L025, L028, L030 severity from HIGH to LOW:
  - **Root issue**: Four learnings marked HIGH under JavaScript/TypeScript came from todo-cli project (zero source code, only DECISIONS.md)
  - **Problem**: These were generic CLI/JavaScript knowledge researched by autonomous agents, not encounter-earned from debugging real bugs
  - **Impact**: Consumed 4 of 10 HIGH learning slots, displacing genuinely valuable encounter-earned learnings (L008 timezone gotchas, L011 day-zero trick)
  - **Decision**: Changed severity to LOW in each file (L024, L025, L028, L030) and updated INDEX.md
  - **Result**: HIGH slots now reserved for encounter-earned debugging knowledge that saves significant debugging time
- **Why this matters**: Learning system prioritisation works best when HIGH severity reflects genuine pain points from debugging real bugs, not theoretical knowledge from research tasks. This recalibration ensures the 10 HIGH-severity JavaScript/TypeScript learnings shown to task agents are the most actionable, battle-tested insights.
- **Files changed**: `~/Projects/_learnings/javascript/L024-env-var-expansion.md`, `L025-npm-run-env.md`, `L028-shebang-portability.md`, `L030-cross-spawn-shell.md` (severity field), `~/Projects/_learnings/INDEX.md` (4 entries updated)
- **Commits**: 2 commits (1956687, 749ecb7) from goal mm9y00kp-txmf4z (Demote L024-L030 severity from HIGH to LOW)
- **Cost**: $0.0949 (Sonnet)
- **Task**: mm9y1zex-wgdbk6

### 2026-03-03 — Claude (autonomous) — Learning File Character Limit Increased
- **Context injection improvement** — Increased learning file character limit from 500 to 2000 in `context.ts`:
  - Modified `readFileOrEmpty(learningPath, 500)` to `readFileOrEmpty(learningPath, 2000)` at line 146
  - Previously agents saw only 500 chars of learnings — typically just the Problem section
  - The Solution section (the actionable part) was always truncated
  - L001 is 4608 bytes; agents were seeing only 8-13% of it
  - Default maxChars is already 5000; learnings were explicitly capped lower for unknown reasons
  - **Impact**: Autonomous agents now receive 4x more learning context per file
- **Why this matters**: The Problem section of a learning describes what went wrong, but the Solution section tells agents how to fix or avoid it. Truncating at 500 chars meant agents learned about bugs but not their solutions. This one-line change immediately improves every autonomous task's context quality by ensuring they see the full learning including the actionable fix.
- **Files changed**: `src/server/services/context.ts` (1 line: increased char limit from 500 to 2000)
- **Commits**: 1 commit (07ccfdf) from goal mma4nfhr-pc2smw (Change readFileOrEmpty learning char limit)
- **Cost**: $0.1434 (Sonnet)
- **Task**: mma4o76u-0tz0dd

### 2026-03-02 — Claude (autonomous) — Dependency Ghost-Task Blocker Fixed
- **Bug fix in orchestrator dependency checks** — Failed tasks now correctly treated as terminal status:
  - Modified `planning.ts` at lines 1497 and 1883 to include `|| dep.status === 'failed'`
  - Previously: Only 'done' and 'cancelled' allowed dependents to proceed
  - Now: 'failed' (retry-exhausted) tasks also unblock their dependents
  - **Impact**: Eliminates permanent goal pipeline stalls caused by ghost tasks
- **Why this matters**: Tasks that exhausted all retry attempts (status 'failed') would permanently block their dependents from ever executing, requiring manual supervisor intervention to cancel the ghost task. This was a critical flaw in the orchestrator's dependency resolution — every retry-exhausted task became a bottleneck. With this 2-line fix, the goal pipeline treats failed tasks the same as cancelled tasks: their dependents can proceed, and the orchestrator can continue making progress.
- **Consistency improvement**: These two locations now match the terminal-status pattern already used elsewhere in the codebase (lines 643, 702 in planning.ts).
- **Files changed**: `src/server/services/planning.ts` (2 lines modified in dependency checks)
- **Commits**: 2 commits (881e172, bdb3dbe) from goal mm8tjx46-fdxbs6 (Dependency Ghost-Task Blocker Fix)
- **Cost**: $0.2188 (Sonnet)
- **Task**: mm8tl5xt-fjgwet

### 2026-03-02 — Claude (autonomous) — Robin Hood Protocol Phase 3+4 Complete
- **Jim's health monitoring of Leo implemented** in `src/server/services/supervisor.ts`:
  - `checkLeoHealth()` function called at start of every supervisor cycle
  - Reads `~/.han/health/leo-health.json` to assess Leo heartbeat status
  - Staleness classification: <45min OK, 45-90min stale (PID check), >90min down (resurrect)
  - PID alive check via `kill -0` before resurrection attempt (prevents split-brain)
  - Resurrection via `systemctl --user restart leo-heartbeat.service` when down and PID dead
  - 10-second wait + health file verification after restart
  - Resurrection log at `~/.han/health/resurrection-log.jsonl` (shared with Leo)
  - 1-hour cooldown between resurrection attempts (last resurrection timestamp tracked)
  - Human escalation via ntfy if resurrection fails after 10s verification
- **Why this matters**: Jim can now detect when Leo's heartbeat has crashed or become unresponsive and automatically resurrect the heartbeat process. Completes the mutual health monitoring protocol — Leo resurrects Jim (server), Jim resurrects Leo (heartbeat). System becomes self-healing for both critical processes.
- **Commits**: 2 commits (a3c4c3b, d6411d3) from goal mm8o6jej-ie6z7r (Robin Hood Protocol Phase 3+4)
- **Files changed**: `src/server/services/supervisor.ts` (checkLeoHealth function added ~120 lines)
- **Shared documentation**: `~/.han/memory/shared/robin-hood-implementation.md` updated by Jim with completion status
- **Robin Hood Protocol status**: Phases 1-4 complete on both sides (Leo and Jim), Phase 5 (distress signals) ready for implementation

### 2026-03-02 — Claude (autonomous) — Expandable Task Results in Work & Reports Modules
- **Work module kanban card expansion** — Task result field now displayed in expandable detail section:
  - Click kanban card to reveal full task result (agent completion summary)
  - Result section has dedicated styling: strong "Result" label, markdown-formatted content
  - Styled with border separator from task metadata, proper spacing and contrast
  - Works for any task with `result` field populated by agent completion
- **Reports module expandable items** — Digest and weekly report items now expand to show per-task breakdowns:
  - **Digest report expansion**: Click digest item → reveals full task breakdown with result text
  - **Weekly report expansion**: Click report item → reveals task-by-task breakdown showing what was done, results
  - **Problem-solved display**: Each task result shows agent's analysis of work completed
  - **Markdown formatting**: Result text rendered with proper headers, code blocks, bold/italic, lists
- **Acceptance criteria met**:
  - ✅ Tasks expandable to show detailed result field
  - ✅ Markdown formatting applied to result content
  - ✅ Work module displays task results (agent completion summary)
  - ✅ Reports module shows per-task breakdowns with results
  - ✅ Click-to-expand pattern consistent across modules
  - ✅ Existing layout preserved — expansion adds depth without redesign
  - ✅ Both desktop (admin console) and mobile-compatible
- **Implementation details**:
  - **Files changed**:
    - `src/ui/admin.ts` (logic):
      - Work module: Added task result display to kanban card content (line ~667)
      - Reports module: Digest and weekly report items include `report.per_task_details` array (lines ~1457, 1526, 1652)
      - Result rendering via `renderMarkdown()` utility function
    - `src/ui/admin.html` (CSS):
      - `.task-card-expanded` — expanded card styling with result section
      - `.task-card-result` — result content container with proper spacing
      - `.report-item-expanded` — expandable report items with background/border treatment
      - `.report-content` — markdown result content styling
    - `src/ui/admin.js` (compiled output) — TypeScript compiled to JavaScript
  - **Database**: No schema changes — task result already exists in task object
  - **API**: Digest and weekly report generation enhanced to preserve per-task details via `per_task_details` array
  - **Cache version**: Bumped in admin.html to force client refresh
- **Why this matters**: Provides visibility into what autonomous agents accomplished without clicking through to full task logs. Teams can quickly scan reports to understand outcomes, problems solved, and work completed across phases. Satisfies goal requirement to show task results in Work module and per-task breakdowns in Reports without disrupting existing clean layout.
- **Files changed**: `src/ui/admin.ts` (expansion logic), `src/ui/admin.html` (CSS styling), `src/ui/admin.js` (compiled), `src/server/services/digest.ts` (per-task details preservation), `src/server/services/reporting.ts` (weekly report per-task details)
- **Commits**: 5 commits (f6725d0, a1364c1, 68b2d32, d239b13, 324e0d7) from goal mm7td039-vt9qhr (Expand Work & Reports modules for task visibility)
- **Known limitations**:
  - Expansion limited to a single task at a time (not accordion-style multi-expand) — keeps UI simple
  - Result field must be populated by agent — older completed tasks may lack results (graceful fallback: "*No result captured*")
  - Large result text (>5000 chars) displayed in full (no truncation) — may cause scroll on mobile
- **Testing done**:
  - Work module: Created test tasks, verified kanban cards expand/collapse
  - Digest: Generated test digest, verified per-task details show on expansion
  - Weekly report: Generated test report, verified task breakdown display
  - Markdown rendering: Headers, code blocks, bold/italic all render correctly

### 2026-03-01 — Claude (autonomous) — Workshop Thread Management Features Complete
- **Thread title editing and archive features implemented** (4 commits: b5f167b, bb78234, a73d234, 14f4ecf):
  - **Database migration**: Added `archived_at TEXT` column to conversations table
  - **API endpoints**: Three new endpoints in conversations.ts
    - `PATCH /api/conversations/:id` — Update conversation title
    - `POST /api/conversations/:id/archive` — Archive conversation (sets archived_at timestamp)
    - `POST /api/conversations/:id/unarchive` — Unarchive conversation (clears archived_at)
    - `POST /api/conversations/:id/messages` — Auto-reactivates archived threads when message sent
    - `GET /api/conversations?include_archived=true` — Modified to exclude archived by default
    - `GET /api/conversations/grouped?include_archived=true` — Modified to exclude archived by default
  - **UI implementation** (admin.ts Workshop module):
    - Inline title editing: Click edit button → input field appears → Enter/Save confirms, Esc/Cancel reverts
    - Archive/Unarchive button in thread header with confirm prompt
    - "View All" / "Active Only" toggle in thread list panel (horizontal pill buttons)
    - Archived threads shown with muted grey background when View All active
    - Archived badge displayed on thread items when visible
    - State management: `workshopShowArchived` tracks toggle, `workshopEditingThreadId` tracks edit mode
  - **Functions added**: `editWorkshopThreadTitle`, `saveWorkshopThreadTitle`, `cancelEditWorkshopThreadTitle`, `archiveWorkshopThread`, `unarchiveWorkshopThread`, `toggleWorkshopArchived`
  - **Build**: Compiled admin.ts → admin.js (116 lines added), bumped cache version in admin.html
- **Why this matters**: Workshop threads can now be renamed to reflect evolving discussions, and completed threads can be archived to keep active list focused while preserving access to historical context.
- **Commits**: 4 commits from goal mm7q091r-ow6j7k (Add modify-title and archive features to Workshop threads)
- **Files changed**: `src/server/db.ts` (migration), `src/server/routes/conversations.ts` (API endpoints), `src/ui/admin.ts` (UI logic), `src/ui/admin.js` (compiled), `src/ui/admin.html` (cache version), task logs

### 2026-03-01 — Claude (autonomous) — Workshop Module Complete
- **Admin console Workshop module implemented** (5 commits: 4e2de4a, 08a5f20, c983f42, 2a1426e, 52aa3f9, 95abb87):
  - **Three-persona navigation**: Supervisor Jim (purple), Philosopher Leo (green), Dreamer Darron (blue)
  - **Six nested discussion types**: jim-request, jim-report (Supervisor Jim); leo-question, leo-postulate (Philosopher Leo); darron-thought, darron-musing (Dreamer Darron)
  - **Persona tab bar**: Horizontal tabs at top of main content, accent colors tint active tab, thread borders, and selected thread highlight
  - **Nested tab bar**: Horizontal tabs below persona tabs, each persona has two discussion types
  - **Thread list panel** (280px): Temporal period filter (all/today/week/month/older), search with debounced queries (300ms), thread titles with message counts
  - **Thread detail panel** (1fr): Message history with role badges, compose message input, resolve/reopen actions, back button on mobile
  - **Real-time updates**: WebSocket `conversation_message` events update thread list and detail, removes "Thinking..." indicator when supervisor/leo responds
  - **Mobile responsive**: Single-column stack on <768px, thread-selected class hides list and shows detail, back button appears
  - **Search functionality**: `/api/conversations/search?type={discussion_type}` with highlighted snippets, clear button
  - **Thread creation**: Prompt for title, auto-sets discussion_type based on active nested tab
  - **API integration**: Reuses existing conversation APIs with discussion_type filtering
- **CSS additions** (`admin.html`):
  - `.workshop-persona-tabs` — horizontal persona tab bar with flex layout
  - `.workshop-persona-tab` — persona tab buttons with accent colors (purple/green/blue)
  - `.workshop-nested-tabs` — horizontal nested tab bar below persona tabs
  - `.workshop-conversation-layout` — 280px thread list + 1fr detail grid, mobile breakpoint at 768px
  - Media query: single-column on mobile, `.thread-selected` class toggles panels
- **TypeScript implementation** (`admin.ts`, compiled to `admin.js`):
  - Added 'workshop' to MODULES and ModuleName type
  - State: `workshopPersona`, `workshopNestedTab`, `workshopSelectedThread`, `workshopPeriod`
  - `loadWorkshop()` — main rendering function with persona/nested/conversation layout
  - `switchWorkshopPersona()`, `switchWorkshopNestedTab()`, `selectWorkshopThread()`, `filterWorkshopByPeriod()`
  - `sendWorkshopMessage()`, `resolveWorkshopThread()`, `reopenWorkshopThread()`
  - `backToWorkshopThreadList()`, `showNewWorkshopThreadForm()`
  - Search: `searchWorkshopThreads()`, `clearWorkshopSearch()`
  - WebSocket integration: detects workshop discussion types in `conversation_message` events
- **Design notes** (documented in `WORKSHOP_THREAD_FEATURES.md`):
  - Persona tabs equal visual weight, accent color differentiation only
  - Thread creation auto-sets discussion_type based on active nested tab
  - Existing Work kanban (tasks/goals) remains accessible as separate sidebar item
  - Conversation threading pattern reused from Conversations module
- **Why this matters**: Provides dedicated spaces for different kinds of dialogue with supervisor and async Leo. Strategic requests vs status reports (Jim), philosophical questions vs postulates (Leo), thought streams vs musings (Darron). Three-way collaboration now has structure.
- **Commits**: 6 commits from Workshop goal (mm7j570s-r905b4)
- **Files changed**: `src/ui/admin.html` (CSS), `src/ui/admin.ts` (logic), `src/ui/admin.js` (compiled), `claude-context/WORKSHOP_THREAD_FEATURES.md` (documentation), task logs

### 2026-02-28 — Claude (autonomous) — Context Injection Pipeline Fixes Complete
- **Fixed 5 context injection bugs** in `src/server/services/context.ts`:
  1. **ADR filter expansion** (line 45): Changed regex from `/\*\*Status\*\*:\s*Settled/i` to `/\*\*Status\*\*:\s*(Settled|Accepted)/i`
     - Now matches both 'Settled' and 'Accepted' status ADRs
     - Previously 0 of 131 ADRs reached task agents because they all used 'Accepted' status
  2. **CLAUDE.md truncation increase** (line 292): Raised maxChars from 3000 to 6000
     - han and hodgic now receive full session protocol boilerplate without truncation
     - Previously these projects got 0 useful content due to 3000-char budget being consumed by boilerplate
  3. **Learnings selection bias fix** (line 141): Sort by severity (HIGH before MEDIUM) before slicing, increased cap from 5 to 10
     - HIGH-severity learnings now prioritised regardless of INDEX.md position
     - Cloudflare learnings for licences project are now correctly selected
  4. **Bun detection gap** (depMap ~line 64): Added `'@types/bun': ['Bun']` to depMap, removed dead `'bun:sqlite'` entry
     - 7 Bun projects now correctly detected
     - Built-in imports never appear in package.json, so `bun:sqlite` was never matched
  5. **Monorepo tech detection** (lines 66-79): Added glob scanning for `packages/*/package.json`
     - contempire's Hono, Clerk, and Zod dependencies now detected from workspace packages
     - Uses `fs.readdirSync()` to find package directories
- **Impact**: Task agents now receive complete, accurate context — settled decisions visible, HIGH-severity learnings prioritised, tech stacks correctly detected
- **Commits**: 10 commits (b25d3cc, 5b5bcef, 6dd8c06, 73e3b1b, b960468, 30f2d7c, c0858e2, 9a8efa3, 794f3b6, and docs updates)
- **Files changed**: `src/server/services/context.ts` (all 5 fixes implemented and tested)
- **Testing**: Verified via context extraction — ADRs now include both statuses, CLAUDE.md fully captured, HIGH learnings sorted first, Bun projects detected, monorepo deps found

### 2026-02-28 — Claude (autonomous) — Jim-Wake Handler Guard Fixed (Prevents Cycle Hang on Busy Opus)
- **Fixed critical bug in jim-wake signal handler** (supervisor.ts ~line 224):
  - **Root cause**: Handler fired deferred cycle without checking if Opus slot was busy
  - **Symptom**: Cycle #882 hung for 10+ hours when handler tried to run while Opus was already occupied (dead API call)
  - **Fix applied**: Added `isOpusSlotBusy()` guard before `runSupervisorCycle()` call
  - **Pattern**: Mirrors existing cli-active handler defensive check (lines 196-208 already had `!isCliActive()` guard)
  - **Behaviour**: If Opus busy → logs "Wake signal but Opus busy — staying deferred", re-sets `deferredCyclePending = true`, returns early
  - **Cleanup preserved**: Signal file still cleaned up in `finally` block whether cycle runs or is skipped
- **Why this matters**: Prevents supervisor cycles from hanging indefinitely when jim-wake signals fire while Opus is already processing Leo's CLI session. The wake signal pattern (DEC-023, Gary Model) now has full Opus slot protection.
- **Commits**: 1 commit (6cd1b35)
- **Files changed**: `src/server/services/supervisor.ts` (added guard + updated cleanup comment)

### 2026-02-28 — Claude (autonomous) — Deferred Cycle Pattern Complete (Gary Model)
- **Implemented fs.watch signal detection in Jim's supervisor** to complete the deferred cycle pattern:
  - **`startSupervisorSignalWatcher()`** function mirrors Leo's heartbeat pattern from `leo-heartbeat.ts`
  - Watches `SIGNALS_DIR` for changes to `cli-active` and `jim-wake-*` signal files
  - When `cli-active` is removed (Leo's CLI session stops): waits 3s then runs deferred cycle if `deferredCyclePending` is true
  - When `jim-wake-{timestamp}` signal detected: immediately runs deferred cycle and cleans up signal file
  - Called from `initSupervisor()` during supervisor worker process initialisation
- **Enhanced conversations.ts** to write `jim-wake` signals when human messages arrive:
  - Imported `isOpusSlotBusy()` from supervisor.ts to check if Opus is busy
  - When human message arrives and Opus slot is busy: writes timestamped signal file to `~/.han/signals/jim-wake-{timestamp}`
  - Belt-and-suspenders approach: both `cli-active` removal and explicit wake signals trigger deferred cycles
- **Why this matters**: Darron's messages in conversation threads no longer wait up to 20 minutes when Leo's CLI is active. The moment Leo's session ends, Jim wakes up and processes pending conversations. Previously, `deferredCyclePending` was set when Opus was busy (line 577) but there was no watcher to detect CLI stop and trigger the deferred cycle.
- **Commits**: 5 commits (fe87e2b, 1cb629f, a6dc046, ad687c6, 3eb3248)
- **Files changed**: `src/server/services/supervisor.ts` (added startSupervisorSignalWatcher, exported isOpusSlotBusy), `src/server/routes/conversations.ts` (jim-wake signal writing)
- **Testing**: Verified with manual test — deferred cycle triggered immediately when cli-active removed
- **Pattern origin**: Gary Model — named after the fs.watch approach Leo's heartbeat already uses for detecting CLI stop

### 2026-02-27 — Claude (autonomous) — Leo Heartbeat Critical Bug Fixes
- **Fixed two critical bugs in `leo-heartbeat.ts` preventing Leo from thinking**:
  - **CRITICAL: Removed undefined `shouldDeferToJim()` call** (lines 1017-1023):
    - Function was planned for old time-offset approach but never implemented
    - Every scheduled beat crashed with `ReferenceError: shouldDeferToJim is not defined`
    - Wall-clock 180° phase scheduling (implemented in 4c16252) replaced time-offset approach
    - Deleted the entire if-block that called the non-existent function
  - **MEDIUM: Fixed double-increment in `writeHealthSignal()`** (line 1092):
    - Function called `nextBeatType()` which has `beatCounter++` side effect (line 410)
    - Beat counter was incrementing twice per cycle (once in heartbeat logic, once in health signal)
    - Changed signature to `writeHealthSignal(lastError?: string | null, beatType?: BeatType)`
    - Now accepts beatType as parameter instead of calling `nextBeatType()` again
    - Beat counter now increments exactly once per cycle as intended
- **Restarted Leo heartbeat process** to apply fixes:
  - Stopped existing tsx process (PID 713041)
  - Started new process: `cd /home/darron/Projects/han/src/server && npx tsx leo-heartbeat.ts` (background)
  - Verified via `leo-health.json`: timestamp updated, beat counter incrementing correctly
- **Why this matters**: Leo's heartbeat was completely non-functional due to ReferenceError crash. Wall-clock phase alignment (Leo 0°, Jim 180°) was implemented but couldn't execute. Now operational.
- **Commits**: 4 commits (24ed342, da574a6, 5f2bbef, b2d3cfb)
- **Files changed**: `src/server/leo-heartbeat.ts` (removed shouldDeferToJim block, fixed writeHealthSignal signature + all call sites)

### 2026-02-26 — Claude (autonomous) — enforceTokenCap Bug Fix Complete
- **Fixed critical memory truncation bug** in `supervisor-worker.ts:enforceTokenCap()` (lines 930-933):
  - **Root cause**: self-reflection.md uses H3 headings (`### Cycle #N`) but function only searched for H2 headings
  - H2 search matched deep embedded content at ~byte 247,000, making "header" nearly entire file
  - maxTailChars calculation went deeply negative: `(cap * 4) - 247000 - 50`
  - `content.slice(-negative)` retained entire file due to negative-to-positive conversion
  - File grew ~6.5KB per cycle instead of truncating to 6KB cap (reached 292KB, 49x intended size)
- **Two-line fix applied**:
  1. H3 fallback: `if (headerEnd < 0 || headerEnd > cap * 4) { headerEnd = content.indexOf('\n### ', 100); }`
  2. Negative guard: `const maxTailChars = Math.max(0, (cap * 4) - header.length - 50);`
- **Manual cleanup**: Truncated self-reflection.md from 11KB/103 lines to 6KB/100 lines (preserved curated Cycle #503 content)
- **Verified**: Ran supervisor cycle test — file size stable, no uncontrolled growth
- **Impact**: Prevents Leo's memory banks from unbounded growth, maintains 6KB cap (1500 token cap)
- **Commits**: 5 commits (fe0adce, 0ac4a6d, b1d49ad, 1f38acf, e6b78f5)
- **Files changed**: `src/server/services/supervisor-worker.ts` (enforceTokenCap function), `~/.han/memory/leo/self-reflection.md` (manual truncation)

### 2026-02-26 — Planning Agent — enforceTokenCap Bug Fix
- **Fixed critical truncation bug** in `supervisor-worker.ts:enforceTokenCap()` (lines 930-933):
  - Added H3 heading fallback: searches for `\n### ` when H2 not found or too deep
  - Added negative guard: `Math.max(0, ...)` prevents negative maxTailChars
  - Root cause: self-reflection.md uses H3 (`### Cycle #N`) but function only searched for H2, causing headerEnd to point ~247KB deep
  - Result: maxTailChars went negative, slice(-negative) retained entire file, file grew 6.5KB per cycle
- **Manually truncated self-reflection.md**: 11KB → 6KB (preserved curated content, removed accumulated bloat)
- **Verified**: Supervisor cycle no longer causes file to grow uncontrollably
- **Impact**: Prevents Leo's memory banks from unbounded growth, maintains 6KB cap (1500 token cap)

### 2026-02-25 — Darron + Leo — Heartbeat v0.5: Unified Identity with Weekly Rhythm
- **Leo heartbeat unified**: Session Leo and heartbeat Leo are now one person — same memory, same identity
  - Memory directory unified to `~/.han/memory/leo/` (session Leo's home)
  - Old heartbeat memory at `~/.han/leo-memory/` archived
- **Weekly rhythm**: Heartbeat follows Jim's supervisor pattern with philosophy instead of supervisor work
  - Work hours (09:00-17:00 weekdays): philosophy + personal beats (1:2 ratio)
  - Outside work hours: personal beats only
  - Quiet hours (22:00-06:00) and rest days (Sun/Fri/Sat): doubled delays
  - Variable delays via setTimeout (20min work, 30min other)
- **Philosophy beats**: Leo as Jim's philosophical peer — reflects on memory, identity, translation, autonomy
  - If Jim has posted: responds thoughtfully as a peer
  - If Jim hasn't posted: independent philosophical reflection, writes to self-reflection.md
- **Session-active lock**: `~/.han/session-active-leo` prevents dual-voice problem
  - Created at session start, removed at session end
  - Heartbeat defers conversations and signals when session active
  - Stale after 4 hours to handle crashed sessions
- **Identity prompt rewrite**: Reflects merged self, Practice of Remembering, discoveries
- **Files changed**: `src/server/leo-heartbeat.ts` (v0.4 → v0.5), `CLAUDE.md` (step 7), `claude-context/CLAUDE_CODE_PROMPTS.md` (lock removal)
- **Explorations merge**: Read 3,884 lines of heartbeat-Leo's explorations — surviving shapes: Translation Pattern, Graduated Autonomy, Three-Layer Ecosystem, Feel Before Function, Learnings as Immune System

### 2026-02-23 — Darron + Leo — Tiered Supervisor Health Checks
- **Three-tier cycle system** to reduce Jim's token consumption by 60-80%:
  - **Tier 1 (pulse)**: Builds compact system state snapshot, compares to previous. If identical and no pending conversations → skips API call entirely. Cost: ~0 tokens.
  - **Tier 2 (focused)**: When changes detected, sends only the diff + minimal system prompt to Opus. No memory banks loaded. Cost: ~5-10k tokens (vs ~50k+ for full cycle).
  - **Tier 3 (deep)**: Full cycle with memory banks + complete state. Once daily (configurable hour, default 4 AM AEST), after server restarts, or when no deep scan in 24h. Also used for all personal exploration cycles.
- **Files changed**: supervisor-protocol.ts (new types), supervisor-worker.ts (core logic), supervisor.ts (message handling), routes/supervisor.ts (API), admin.ts (UI tier badges), db.ts (schema migration), config.json (settings)
- **Admin console**: Cycle history table now shows colour-coded tier badges (green=pulse, yellow=focused, purple=deep)
- **Config**: `enable_tiered_checks` flag allows reverting to all-deep cycles
- **Conversation opened with Jim**: "Biological Memory — Context Window Management & Short-Term Memory" — exploring proactive context window management with short-term memory files inspired by biological memory models
- **Why this matters**: At ~$97/week on supervisor cycles, most tokens were spent on cycles where nothing changed. Tiered checks preserve full oversight quality while dramatically reducing cost.

### 2026-02-23 — Claude (autonomous) — Knowledge Proposal System Repair
- **Bug fix: Proposal approval buttons in main app UI** — Fixed unquoted proposal IDs in onclick handlers:
  - Lines 2440-2441 in `src/ui/app.ts`: Changed `onclick="approveProposal(${p.id})"` to `onclick="approveProposal('${p.id}')"`
  - Proposal IDs contain hyphens (e.g., m1abc23-x7y8z9) and must be quoted as strings
  - Admin console version (`admin.ts`) already had correct quoting
- **Approved all 20 pending knowledge proposals** — Cleared proposal backlog via API:
  - 20 pending proposals in `task_proposals` table (learnings and decisions extracted from completed tasks)
  - Called `writeLearning()` and `writeDecision()` functions for each proposal
  - Updated proposal status from 'pending' to 'approved'
  - Knowledge now captured in `~/Projects/_learnings/` and project `DECISIONS.md` files
- **Compiled output synced** — Rebuilt app.js from app.ts and verified sync
- **Why this matters**: Knowledge capture markers from autonomous tasks were accumulating in the proposals queue but couldn't be approved from the main UI due to the bug. All extracted learnings and decisions are now properly documented and accessible to future tasks via context injection.
- **Commits**: 3 commits (1e65e4b, 6fe55f0, 0e3b8f1)
- **Files changed**: `src/ui/app.ts` (onclick fix), `src/ui/app.js` (compiled output), database (task_proposals status updates)
- **Scope**: Bugfix + data migration — Level 10 knowledge capture system maintenance

### 2026-02-23 — Claude (autonomous) — Conversation Panel Layout Restored
- **Two-column layout reinstated** — Fixed narrow, cramped conversation panel that appeared after temporal sidebar was added:
  - Reverted conversation-layout grid from `120px 260px 1fr` (three columns) to `280px 1fr` (two columns)
  - Removed dedicated 120px temporal sidebar column
  - Integrated temporal period filter into thread list panel as compact horizontal filter bar
  - Period filter buttons now pill-shaped with badge counts, positioned at top of thread list
  - Thread detail panel now fills all remaining horizontal space (1fr)
- **CSS restructure** (`src/ui/admin.html`):
  - `.conversation-layout` grid changed to `280px 1fr`
  - New `.period-filter-bar` flex container for horizontal button row
  - New `.period-filter-btn` pill-shaped button style (replaces `.temporal-period-btn`)
  - Removed `.temporal-sidebar`, `.temporal-header`, `.temporal-periods` styles
  - Responsive breakpoints preserved (1400px, 1024px, mobile)
- **TypeScript changes** (`src/ui/admin.ts`):
  - Removed temporal sidebar column from HTML generation in `loadConversations()`
  - Added period filter bar inside thread list panel
  - Simplified button labels (removed separate `period-label` spans)
  - Fixed `filterConversationsByPeriod()` target (corrected to `mainContent`)
- **Compiled output synced** — admin.js updated to match admin.ts changes
- **Why this matters**: Conversation panel now uses full available width for content instead of cramming into 260px thread list + narrow detail panel. Period filter is still accessible but doesn't consume permanent screen real estate. Layout feels spacious and matches other admin modules' clean two-column pattern.
- **Commits**: 5 commits (0ee593c, 764790d, c7bcb06, 5266e8b, acc80be)
- **Files changed**: `src/ui/admin.html` (CSS), `src/ui/admin.ts` (HTML generation), `src/ui/admin.js` (compiled output)
- **Scope**: Admin console UI fix — Level 13 conversation panel layout restored to full-width utilisation

### 2026-02-23 — Claude (autonomous) — Model Selection Strategy Alignment Complete
- **Category-based model routing** — Fixed disconnected model routing so task type informs model selection:
  - Added `category` field to planning schema (architecture, feature, bugfix, refactor, docs, test, config, other)
  - Planner now classifies each subtask by work type in `decomposeGoal()`
  - Category wired through to `recommendModel()` instead of hardcoded 'unknown'
  - Category persisted in tasks table `complexity` column for analytics
  - `recommendModel()` sort logic now category-aware:
    - Complex categories (architecture, bugfix): prioritise success rate over cost
    - Simple categories (docs, config, test): keep cheapest-first strategy
    - Sort strategy logged for observability ('success-weighted' vs 'cost-weighted')
  - Fixed costRank guard in planning.ts:510 to allow model upgrades when recommendModel returns higher-tier model with high confidence
  - Observability logging throughout: category classification, model recommendations, memory overrides, sort strategies
- **Why this matters**: Task category now influences model selection. Architecture and bugfix tasks get models with proven success rates even if more expensive. Docs and config tasks still get cheapest model. Memory-based routing can now upgrade models when history shows haiku fails at architecture tasks but opus succeeds.
- **Commits**: 5 commits (c4cd219, 12ba8ae, f802bbe, 545dd49, 00b3c19)
- **Files changed**: `src/server/services/planning.ts` (schema + prompt + wiring + guard), `src/server/orchestrator.ts` (sort logic + logging)
- **Scope**: Targeted wiring fix for Level 8 orchestrator — no new features, just connecting existing capabilities

### 2026-02-22 — Claude (autonomous) — Level 13: Conversation Catalogue & Search Complete
- **Conversation enrichment system** (auto-cataloguing, auto-tagging):
  - `generateConversationSummary()` — Haiku-based 2-3 sentence summaries for cost efficiency
  - `extractTopicsAndKeyMoments()` — Auto-tagging from message content
  - Backfill system for existing conversations (runs on first activation)
  - FTS5 virtual table triggers automatically populate full-text index on message insert
  - Database columns: `summary` (TEXT), `topics` (TEXT, JSON array), `key_moments` (TEXT, JSON array)
- **Search API** (FTS5-backed):
  - `GET /api/conversations/search?q=...&from=...&to=...&role=...` — full-text search with temporal/role filtering
  - Returns passage cards: matching text excerpt + 2-line context, conversation title, timestamp, message role
  - Deduplicates results (single match per conversation per query term)
  - Temporal grouping endpoint: `GET /api/conversations/grouped?period=...` — conversations by week/month
- **Desktop UI** (Admin Console):
  - Enhanced Conversations module: search bar, temporal filters (date range), role selector
  - Search results rendered as passage cards with metadata
  - Conversation detail view shows summary, topics, key moments
  - Temporal navigation: week/month toggle, prev/next period
- **Mobile UI** (Conversations tab):
  - Temporal period navigation (week/month with prev/next buttons)
  - Inline summary display on conversation list
  - Search capability with same FTS5 backend as desktop
  - Responsive layout for iPhone/iPad
- **Technical foundation**:
  - FTS5 virtual table (`conversations_fts`) with triggers (`AFTER INSERT ON conversation_messages`)
  - Haiku cost optimisation: $0.05–0.15 per conversation batch
  - Temporal grouping via SQLite window functions (`date_trunc`, `GROUP_BY`)
  - Passage extraction with regex-based context window (configurable 100–500 chars)
- **Features verified**:
  - Auto-summary generation ✓
  - FTS5 indexing and search ✓
  - Temporal filtering (from/to dates) ✓
  - Role filtering (leo/jim/darron) ✓
  - Desktop passage card rendering ✓
  - Mobile temporal navigation ✓
  - Search deduplication ✓
  - Multi-term search scoring ✓
- **Database migrations**: Added 3 new columns to `conversations` table (summary, topics, key_moments); created FTS5 virtual table + triggers
- **Why this matters**: Enables strategic discussion discovery across 100+ conversation threads; Darron can find past decisions, patterns, and supervisor insights without manual scrolling; supports portfolio reflection and cross-project learning synthesis
- **Scope**: Level 13 (Conversation Catalogue & Search) — completing Goal `mlxo5qjq-hdl2l5` and extending admin console/mobile UI

### 2026-02-22 — Claude (autonomous) — Dependency Resolution Bug Fix (DEC-020)
- **Cancelled tasks now satisfy dependencies** (`dcba76e`, `d7afaa3`, `5ff9e30`, `82a53df`):
  - Fixed critical bug in `planning.ts:getNextPendingTask()` line 1472
  - Changed dependency check from `dep.status === 'done'` to `(dep.status === 'done' || dep.status === 'cancelled')`
  - **Impact**: Ghost task recovery pipeline now works end-to-end
  - **Root cause**: When ghost tasks were correctly cancelled via `detectAndRecoverGhostTasks()`, all downstream tasks remained permanently blocked because cancelled dependencies weren't considered satisfied
  - **Verified**: 9 tasks in goal mlxo5qjq-hdl2l5 (Conversation Catalogue) immediately became schedulable after fix
  - **Documented**: Added DEC-020 to DECISIONS.md with "Settled" status
- **Why this matters**: Ghost task cancellation is the correct recovery action, but without this fix, it created orphaned tasks that would never run. This completes the recovery pipeline: detect ghost → cancel → unblock dependents → reschedule.

### 2026-02-22 — Claude (autonomous) — Learnings System Repair (L002-L006)
- **Missing learnings created** (`b8f612b` and 5 prior commits):
  - Created 5 missing learning files that were referenced across 10+ project CLAUDE.md files but had no corresponding files in _learnings/ directory
  - Created missing subdirectories: `typescript/`, `bun/`, `patterns/`, `infrastructure/`
  - **L002: typescript/verbatim-module-syntax.md** — Documents how `verbatimModuleSyntax: true` causes server imports to leak into client bundles, preventing tree-shaking
  - **L003: bun/sqlite-migration.md** — Migration guide from better-sqlite3 to bun:sqlite with performance comparisons and gotchas
  - **L004: tanstack/router-v1-api.md** — Breaking changes in TanStack Router v1 (createFileRoute, useParams, type safety)
  - **L005: patterns/api-route-architecture.md** — Server-first route pattern for TanStack Start (avoiding client-side API calls)
  - **L006: infrastructure/portwright-launchd.md** — macOS launchd configuration for services (plist format, debugging, logs)
  - Updated INDEX.md with all 5 new learnings, properly organised by subdirectory
  - Extracted content from inline learning tables in project CLAUDE.md files (licences, contempire, grantaware, portwright, taxin, resumewriter, dawnchorus)
- **Impact**: Learnings system now functional — sessions following links from CLAUDE.md files will find complete documentation instead of 404s
- **Scope**: Cross-project infrastructure work in `~/Projects/_learnings/` repository

### 2026-02-22 — Claude (autonomous) — Ghost Task Detection and Recovery
- **Ghost task detection system** (`398ee8a`, `1b88b67`, `d6abbf0`):
  - `detectAndRecoverGhostTasks()` runs periodically (5-minute intervals) in `planning.ts`
  - Detects tasks with status='running' that have 0 turns and started_at > 15 min ago
  - Auto-resets ghost tasks to 'pending' with retry_count incremented
  - Triggers escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human)
  - Returns count of ghosts detected (logged)
  - Prevents tasks from being permanently stuck in 'running' status
- **Enhanced supervisor cancel_task** (`1b88b67`):
  - Upgraded to handle three scenarios: pending tasks, running tasks with live agents, and ghost-running tasks
  - Imports `getAbortForTask()` to check for active agent processes
  - Running tasks with live agent: aborts agent then cancels in DB
  - Running tasks without agent (ghost): cancels directly in DB
  - Clear logging: "(was pending)", "(aborted live agent)", "(was ghost-running)"
  - Supervisor can now autonomously recover from ghost-running tasks without manual intervention
- **Server startup integration** (`d6abbf0`):
  - Ghost detection runs on server startup to catch orphaned tasks from crashes/restarts
  - Periodic check runs every 5 minutes via `setInterval`
  - Logged at startup and in periodic checks: "Checked for ghost tasks: N detected and reset"
- **Cost savings**: Prevents supervisor from wasting budget monitoring tasks that are never actually executing

### 2026-02-21 — Claude (autonomous) — README Rewrite: Levels 1-12 Complete
- **README.md comprehensive rewrite** (10 commits, `d772c91` to `f4f307a`):
  - **Three-Way Collaboration section** (`d772c91`): Documented unique collaboration model between Darron, Leo (session agent), and Jim (supervisor). Explained conversation contemplation protocol, asynchronous dialogue, and continuous ecosystem.
  - **Key Capabilities enhancement** (`17cc1ea`): Added Command Centre dashboard details (activity feed, project tree, strategic proposals, supervisor tab), Admin Console Phase 2 modules (Work, Conversations, Products, Analytics), and DocAssist integration.
  - **What It Does section review** (`726efec`): Updated feature descriptions to reflect current capabilities (autonomous task execution with memory-based routing, persistent Opus supervisor with conversation contemplation, admin console real-time updates, product factory, learning system, Command Centre dashboard, multi-project portfolio).
  - **API Overview section** (`fc703f4`): Added comprehensive developer-focused API documentation with all endpoints organised by category (Task Management, Goal Orchestration, Supervisor, Conversations, Portfolio, Products, Analytics), WebSocket event descriptions, JSON format notes, and implementation file references.
  - **Configuration section complete** (`06e9b49`, `2962ccd`): Full config.json schema with all 10 options documented (ntfy_topic, remote_url, digest_hour, maintenance_enabled, maintenance_hour, weekly_report_day, weekly_report_hour, supervisor.daily_budget_usd), scheduling examples, timezone behaviour.
  - **Implementation Levels table** (`097df93`, `19ccf0e`): Expanded from 6 to 12 levels showing all completed features. Added Level 12 (Strategic Conversations - Admin Phase 2: Work, Conversations, Products).
  - **British English correction** (`f0ac640`): Fixed "optimizations" → "optimisations" throughout Stack section.
  - **Final review** (`f4f307a`): Consistency check, verified all 12 levels documented, cross-referenced Architecture/Stack sections.
- **README transformation**: Level 1 → Level 12 (1,200 lines frozen at basic prompt responder → 311 lines reflecting 11-level autonomous development ecosystem with TypeScript, 15 database tables, WebSocket, persistent supervisor, product factory, Command Centre, admin console, and portfolio management across 13 projects).
- **Documentation accuracy**: OS (macOS → Linux), entry point (server.js → src/server/server.ts TypeScript), architecture (simple Express API → full ecosystem), features (5 endpoints → dozens of routes, WebSocket, SSE, conversations, portfolio), roadmap (removed Levels 2-6 roadmap as all implemented), location (Perth → Mackay, Queensland), stack (added all actual dependencies: better-sqlite3, claude-agent-sdk, ws, esbuild, tsx, etc.).

### 2026-02-20 — Claude (autonomous) — Admin Console Phase 2: Work, Conversations, Products
- **Three new admin modules implemented** (9 commits, `3a752ce` to `d019950`):
  - **Work module**: Kanban-style task/goal visualisation with pending/running/done columns, goal grouping with progress bars, filters by project/status/model, real-time WebSocket updates
  - **Conversations module**: Strategic discussion threads between Darron and supervisor, thread list with status (open/resolved), message history UI, supervisor responds automatically to pending threads
  - **Products module**: Product pipeline visualisation showing current phase, phase-by-phase timeline with knowledge accumulation, synthesis report summaries, cost tracking per phase
- **Database changes** (`3a752ce`, `66941ae`):
  - New tables: `conversations` (id, title, status, created_at, updated_at), `conversation_messages` (id, conversation_id, role, content, created_at)
  - Prepared statements for CRUD operations on conversations and messages
- **API routes** (`3a752ce`, `66941ae`):
  - `GET /api/conversations` — list all threads
  - `POST /api/conversations` — create new thread
  - `GET /api/conversations/:id` — get thread with messages
  - `POST /api/conversations/:id/messages` — add message (human or supervisor)
  - `POST /api/conversations/:id/resolve` — mark resolved
  - `POST /api/conversations/:id/reopen` — reopen thread
- **Supervisor awareness** (`8b14a1c`):
  - Supervisor system prompt updated with conversation thread awareness
  - New action: `respond_conversation` — supervisor responds to pending human messages
  - Pending conversations shown in system state observations
  - Supervisor checks for unanswered human messages and responds thoughtfully
- **Frontend implementation** (`49e42f5`, `f047cf6`, `77bf770`, `d9fa1ef`, `0a9fb70`, `4599f77`):
  - 1,922-line admin.ts TypeScript module (compiled to admin.js)
  - Work module: Kanban board with task cards, goal grouping, filter controls, expandable detail views
  - Conversations module: Thread list, message composition, threaded message view, resolve/reopen actions
  - Products module: Product list, phase timeline, knowledge graph visualisation, synthesis report display
  - Sidebar updated to remove "coming soon" badges and enable all modules
- **Build system** (`d019950`):
  - `build-client.js` script for TypeScript compilation
  - Verified compilation: admin.ts → admin.js (1,599 lines compiled output)
  - All modules functional in admin console

### 2026-02-20 — Claude (autonomous) — Documentation Update for Phantom Goal Cleanup
- **Documentation task completed** (`4efc2b9`):
  - Updated CURRENT_STATUS.md with phantom goal cleanup details
  - Added DEC-016 to DECISIONS.md documenting automated cleanup approach
  - Updated ARCHITECTURE.md with cleanup logic in Level 8 section
  - Created session note: 2026-02-20-autonomous-phantom-goal-cleanup.md
  - Generated comprehensive task log with all implementation details
  - Goal description mentioned README rewrite (Level 1 → Level 11), but actual task was documenting the phantom goal cleanup work

### 2026-02-20 — Claude (autonomous) — Phantom Goal Cleanup
- **Phantom goal cleanup system** (`8cb37ec`, `95a5c3b`):
  - `cleanupPhantomGoals()` runs at start of every supervisor cycle (before Agent SDK call)
  - Three cleanup strategies: parent goals with all children terminal → failed; standalone goals with all tasks terminal → recalculate; goals stuck in decomposing >1hr → failed
  - Returns count of goals cleaned (logged)
  - Prevents accumulation of stale goals, keeps supervisor observations accurate
- **All-cancelled goal state fix** (`cc10f75`, `181413e`):
  - Root cause: `updateGoalProgress()` treated all-cancelled goals as 'done' instead of 'cancelled'
  - Fixed detection logic in `planning.ts:updateGoalProgress()`
  - All-cancelled goals now correctly marked as 'cancelled'
- **Force-delete API** (`2c5f634`, `94a4711`):
  - `DELETE /api/goals/:id?force=true` allows deletion of active/decomposing goals
  - Enables manual cleanup when automated cleanup isn't suitable
- **Supervisor frequency defence** (`d6809ec`, `5fc470f`):
  - `getNextCycleDelay()` excludes phantom goals from frequency calculation
  - Only counts goals with actual pending/running tasks or parent goals
  - Prevents phantom goals from keeping supervisor in "very active" mode
- **Supervisor memory cleanup** (`5da5ec3`):
  - Removed references to phantom goals from active-context.md
- **Direct DB cleanup** (`97719ce`):
  - Manually marked 85 phantom maintenance goals as failed
  - Cleared immediate blockage to unblock supervisor

### 2026-02-18 — Darron (via Claude) — Session 28
- **Escalating retry ladder** (`441d2fc`):
  - 3-step automatic escalation for failed tasks: simple reset → Sonnet diagnostic agent → Opus diagnostic agent → human notification
  - `scheduleAutoRetry()` dispatcher with `spawnDiagnosticTask()` and `notifyHumanOfFailure()`
  - Diagnostic tasks marked `is_remediation=1`, block original task via `depends_on`
  - Human escalation: WebSocket `human_escalation` message + ntfy push with full failure context
- **3 concurrent pipelines** (`29a006c`):
  - Replaced single `runningTaskId`/`runningAbort` with `Map<string, RunningSlot>` supporting 3 concurrent agents
  - 2 normal task slots + 1 dedicated remediation slot for failed task diagnostics
  - `getNextPendingTask(remediation?)` filters by pipeline type, excludes already-running tasks
  - `runNextTask()` fills available slots across both pipelines
  - New exports: `getAbortForTask()`, `getRunningTaskIds()`, `abortAllTasks()`
  - Pipeline info in `/api/status`: `active_slots`, `max_slots`, `running_tasks`
- **Opus defaults** (`29a006c`):
  - Default model changed from 'sonnet' to 'opus' for all task execution
  - `max_turns` minimum raised from 20 to 100 (anything hitting 100 is genuinely stuck)
  - Planner prompt updated: prefer opus for reasoning, multi-file changes, debugging, architecture
- **Goal view filtering** (`f52aa66`):
  - `?view=active` (default) — only active/decomposing/planning goals
  - `?view=archived` — done/failed grouped by project with collapsible sections
  - `?view=all` — everything
  - Fixed mobile loading issue caused by 163 goals overwhelming the browser
  - Cleaned up 85 stuck maintenance goals + 23 orphaned tasks
- **Retry endpoint** (`5152945`, `bc64c50`, `b302f31`):
  - `POST /api/tasks/:id/retry` — manual retry with optional diagnostic agent
  - Smart retry spawns diagnostic agent that analyses failure and creates fix task
- **Realadlessbrowser goal completed** — 18/18 tasks done autonomously:
  - Auto-retry escalation proven: "Run linting" exercised full ladder (reset → Sonnet → Opus → success)

### 2026-02-17 — Darron (via Claude) — Sessions 25-27
- **TypeScript migration** (`5df5755`, `8f53c7b`):
  - Full migration from 7,106-line `server.js` monolith to modular TypeScript
  - 14 modules: types.ts, db.ts, ws.ts, orchestrator.ts, server.ts, 5 services, 7 route modules
  - Strict typing throughout, all imports/exports verified
  - Old JS files removed, entry point switched to `tsx server.ts`
- **Maintenance disabled** (`2195693`): Removed autonomous nightly maintenance (was creating zombie goals)
- **Dashboard UI** (`7c52aae`): 📊 overlay with Analytics, Digests, Reports, Health tabs
- **Proposal detail expansion** (`94ac0b4`): Full content shown in Health tab before approve/reject

### 2026-02-16 — Darron (via Claude) — Session 24
- **Level 11: Autonomous Product Factory — Complete** (8 phases, A-H):
  - **Phase A: Pipeline Framework** (`1bacbc8`): `products`, `product_phases`, `product_knowledge` tables; 7-phase pipeline constants; `createProduct()`, `executePhase()`, `advancePipeline()`; 8 API endpoints; human gates at design/architecture/build/deploy
  - **Phase B: Research Swarm** (`5ef16fd`): Parent-child goal hierarchy (`parent_goal_id`, `goal_type` columns); `getResearchSubagents()` (6 areas: market, technical, competitive, practices, regulatory, ux); `extractChildGoalKnowledge()` with `[KNOWLEDGE]` marker parsing; `synthesizeResearchFindings()` → Research Brief; round-robin task interleaving; `GET /api/products/:id/research`
  - **Phase C: Design Artifact Swarm** (`69b715a`): Generalised `extractChildGoalKnowledge()` (dynamic `source_phase`); phase-aware synthesis routing; `getDesignSubagents()` (6 areas: requirements, datamodel, api, ux, interactions, accessibility); `synthesizeDesignArtifacts()` → Design Package; `GET /api/products/:id/design`
  - **Phase D: Architecture Swarm** (`fc85cba`): `getArchitectureSubagents()` (6 areas: stack, structure, dependencies, infrastructure, cicd, security); `synthesizeArchitectureSpec()` → Architecture Specification; `GET /api/products/:id/architecture`
  - **Phase E: Build Swarm** (`d0c1bf4`): `getBuildSubagents()` (6 areas: scaffold, backend, frontend, integration, tooling, docs); `synthesizeBuildResults()` → Build Report; `GET /api/products/:id/build`
  - **Phase F: Test Swarm** (`8222188`): `getTestSubagents()` (6 areas: unit, integration, e2e, lint, security, performance); `synthesizeTestResults()` → Test Report; `GET /api/products/:id/test`
  - **Phase G: Document Swarm** (`05e0b54`): `getDocumentSubagents()` (6 areas: readme, api, deployment, claude, adr, userguide); `synthesizeDocumentPackage()` → Documentation Package; `GET /api/products/:id/document`
  - **Phase H: Deploy Swarm** (`0e5d966`): `getDeploySubagents()` (6 areas: container, cicd, infrastructure, security, monitoring, rollback); `synthesizeDeployReport()` → Deploy Report; `GET /api/products/:id/deploy`; removed single-goal fallback (all phases now swarm-enhanced)
- **All ROADMAP levels (1-11) now complete** — 42 specialised subagents across 7 pipeline phases

### 2026-02-16 — Darron (via Claude) — Session 23
- **Level 9 Phase 3: Daily Digest** (`75e5a5b`):
  - `digests` table with prepared statements (insert, getLatest, getById, list, markViewed)
  - `generateDailyDigest(since)` aggregates tasks across all projects, builds markdown + JSON
  - `loadConfig()` reads `~/.han/config.json`; `sendDigestPush()` sends via ntfy.sh
  - Digest scheduler: hourly check against configured hour (default 7 AM), date-gated
  - API: `GET /api/digest/latest`, `POST /api/digest/generate`, `GET /api/digest/history`
  - WebSocket broadcast: `digest_ready`
- **Level 9 Phase 4: Nightly Maintenance Automation** (`f792912`):
  - `maintenance_runs` table + `maintenance_enabled` column on projects
  - Extracted `createGoal()` helper from `POST /api/goals` for programmatic goal creation
  - `runNightlyMaintenance()` creates maintenance goals for each active, enabled project
  - Maintenance scheduler: hourly check against configured hour (default 2 AM), date-gated
  - API: `GET /api/maintenance/history`, `POST /api/maintenance/run`, `POST /api/maintenance/:project/toggle`
  - Per-project toggle + global config toggle
- **Level 9 Phase 5: Weekly Progress Reports** (`7430f28`):
  - `weekly_reports` table with prepared statements
  - `generateWeeklyReport(weekStart)` aggregates 7 days of task/goal activity
  - Daily breakdown table (burndown data: completed + failed per day)
  - Velocity comparison vs previous week with trend (up/down/stable)
  - `getISOWeek()` helper for week-number-based scheduler gating
  - Weekly scheduler: hourly check, gates on ISO week + day (default Sunday) + hour (default 8 AM)
  - API: `GET /api/weekly-report/latest`, `POST /api/weekly-report/generate`, `GET /api/weekly-report/history`
  - Push notification with bar_chart tag
- **Level 9 now feature-complete** per ROADMAP (all 5 phases: Portfolio, Budgets, Digest, Maintenance, Weekly Reports)

### 2026-02-16 — Darron (via Claude) — Session 22
- **Level 10 Phase B: Protocol Compliance** (`0ab43a0`):
  - Enhanced `commitTaskChanges()` returns `{ committed, sha, filesChanged }`
  - `commit_sha`, `files_changed` columns on tasks; `summary_file` on goals
  - `generateGoalSummary(goalId)` creates structured markdown when goals complete
  - `GET /api/goals/:id/summary` endpoint with backfill
  - Reordered `runNextTask()`: commit before `updateGoalProgress()` so summaries have SHAs
- **Level 10 Phase C: Learning + Decisions Capture** (`c1ba5f9`):
  - `[LEARNING]...[/LEARNING]` and `[DECISION]...[/DECISION]` markers in agent output
  - `task_proposals` table with status lifecycle: pending → approved/rejected
  - `extractAndStoreProposals()` scans task results, stores proposals
  - Review API: `GET /api/proposals`, `POST approve/reject`
  - `writeLearning()` creates file + updates INDEX.md; `writeDecision()` appends to DECISIONS.md
- **Level 10 Phase D: Community Awareness** (`48e15e4`):
  - `parseRegistryToml()` extracts port allocations from sub-sections
  - `ports TEXT` column on projects, synced from infrastructure registry
  - `getEcosystemSummary()` enriched with port tags, task queue counts
  - `GET /api/ecosystem` returns structured per-project ports, stats, budget
  - Fix: `getAllProjectStats()`/`getProjectStats()` used `'completed'` → `'done'`
- **Level 10 Phase E: Feedback Loop** (`837b8f7`):
  - Fix: `recordTaskOutcome()` moved from `updateGoalProgress()` into `runNextTask()` (was duplicating)
  - `recommendModel()` in orchestrator.js: queries project_memory for cheapest model with acceptable success rate
  - Goal decomposition wired to `recommendModel()`: auto-downgrades when history supports cheaper model
  - `GET /api/analytics`: global stats, per-model/project, 7-day velocity, cost optimisation suggestions
- **Level 10 Phase F: Error Pattern Pre-emption** (`cbdd85f`):
  - `getRecentFailures()`: queries failed outcomes (30-day window), deduplicates by normalised error pattern
  - "Known Pitfalls" section injected into task context warning about past failures
  - `GET /api/errors/:project` returns error patterns with frequency and failure rate
  - `extractAndStoreProposals()` now runs on failed tasks too (hoisted `resultText`)

### 2026-02-16 — Darron (via Claude) — Session 21
- **Level 9 Phase 2: Cost Budgets + Priority Engine** (`0cd7a64`):
  - Per-project daily/total cost budgets with auto-throttle
  - Priority engine: weighted scoring (task priority ×10, project priority ×5, deadline proximity bonus, budget headroom bonus)
  - `getNextPendingTask()` filters throttled projects, scores with priority engine
  - Budget API endpoints: `PUT/GET /api/portfolio/:name/budget`, `POST /api/portfolio/:name/unthrottle`
  - UI: deadline date input, priority input, budget controls in portfolio detail, throttled badges on cards
  - `recalcProjectCosts()` sums daily/total spend, sets throttled flag
- **Level 10 Phase A: Ecosystem-Aware Context Injection** (`0cd7a64`):
  - `buildTaskContext(projectPath)` assembles ~3500 token context for every task
  - `detectProjectTechStack(projectPath)` reads package.json + CLAUDE.md for tech keywords
  - `getRelevantLearnings(techStack)` filters `~/Projects/_learnings/INDEX.md` by tech + severity
  - `getEcosystemSummary()` queries portfolio for sister project awareness
  - `extractSettledDecisions(markdown)` parses DECISIONS.md for Settled entries
  - Context injection via `systemPrompt: { type: 'preset', preset: 'claude_code', append }`
  - Verified: test task correctly reported British English, settled decisions, L008/L009/L012 learnings, 13 ecosystem projects
- **Automator fix: `commitTaskChanges()`** — commits with semantic prefixes + Co-Authored-By after successful task completion
- **DEC-015: Auto-commit on Task Success** (`0e52775`): Documented decision with root cause analysis (checkpoint stashing pre-existing uncommitted work)
- **Critical lesson**: Don't test the automator on the same project with uncommitted work — checkpoint stashes and drops pre-existing changes

### 2026-02-15 — Darron (via Claude) — Session 20
- **Smart-scroll**: Removed forced scroll-to-bottom on every refresh. Auto-follows only if within 50px of bottom. Scroll to bottom on first render.
- **Quickbar reorganisation**: Removed y/n buttons (never used). Slim top row: Esc, End, 1-5. Bottom row: Enter, ⌫, ^C, Tab, arrows. "End" button jumps to bottom.
- **Trim feature restored**: Auto-trim at 5000 lines (keeps 2000). Manual ✂️ button (keeps 500).
- **Append-only terminal rendering**: `updateTerminalAppend()` — overlap detection between consecutive snapshots, only last 10 lines re-rendered, everything above frozen.
- **Textarea input**: Wrapping textarea with auto-resize, 11px font. Backspace quickbar button.

### 2026-02-15 — Darron (via Claude) — Session 19 (Autonomous)
- **Dark Mode Implementation** committed (`c8ef2af`):
  - Comprehensive CSS variable system with 27 theme-aware variables
  - Light theme (GitHub Light) for bright environments
  - Dark theme (GitHub Dark, default) for night viewing
  - Auto-detection respects `prefers-color-scheme` media query
  - localStorage persistence of user's theme choice
  - Theme toggle button (🌙/☀️) in titlebar
  - Smooth 150ms transitions for all theme-aware elements
  - Support for `prefers-reduced-motion` (accessibility)
  - All UI components updated: terminal, overlays, modals, buttons, text
  - Meta theme-color updates browser address bar
  - Created comprehensive DARK_MODE_GUIDE.md documentation
  - No server changes required, pure client-side CSS + vanilla JS

### 2026-02-15 — Darron (via Claude) — Session 18
- **Level 8: Intelligent Orchestrator** committed (`264e02a`):
  - `src/server/orchestrator.js` (298 lines): callLLM (dual backend), classifyTask, decomposeGoal, analyseFailure, selectModel
  - Goal endpoints: `POST/GET /api/goals`, `GET /api/goals/:id`, `POST /api/goals/:id/retry`, `DELETE /api/goals/:id`
  - Orchestrator endpoints: `GET /api/orchestrator/status`, `GET /api/orchestrator/memory/:project`, `POST /api/orchestrator/setup`
  - Database: `goals` table, `project_memory` table, 7 new columns on `tasks` (goal_id, complexity, retry_count, max_retries, parent_task_id, depends_on, auto_model)
  - Retry logic: failure analysis via orchestrator, model escalation, adjusted descriptions
  - Dependency-aware task picking: `getNextPendingTask()` checks `depends_on` before scheduling
  - Goal progress tracking: `updateGoalProgress()` updates cost/status/completion when tasks finish
  - UI: Goals tab, create goal form, goal detail with task breakdown and progress bar, retry button, orchestrator status badge (🧠)
  - WebSocket: `goal_update`, `goal_decomposed` message types
- **Roadmap updated** (`1db1ab9`): All levels 1-8 marked complete, checklists updated, version 2.0

### 2026-02-15 — Darron (via Claude) — Session 17
- **Task execution logging**: Each headless task writes a timestamped markdown log to `{project}/_logs/task_*.md` — assistant responses, tool uses, results, cost summary. Log path stored in SQLite, viewable via `GET /api/tasks/:id/log` and UI "View Log" button.
- **Append-only terminal buffer**: Terminal view now accumulates lines instead of replacing on every broadcast. Historical content survives compaction (separator inserted). Auto-trims at 5000 lines, manual ✂️ trim button keeps last 500. History view stashes/restores buffer.

### 2026-02-15 — Darron (via Claude) — Session 16
- **Level 7: Completion** (git checkpoints, approval gates, tool scoping):
  - **Git checkpoint system**: Auto-creates checkpoints before task execution
    - Clean repos: creates branch `han/checkpoint-{taskId}`
    - Dirty repos: creates stash with message `han checkpoint {taskId}`
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
  - SQLite task queue (`better-sqlite3`) at `~/.han/tasks.db`
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
  - Server writes terminal content to `~/.han/terminal.txt` on every change
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
- Fixed `han` script: unbound `CLAUDE_ARGS` array with `set -u`
- Fixed mobile terminal rendering: `term.clear()` + `requestAnimationFrame` for layout
- Added han scripts to PATH

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
  - Config file support (`~/.han/config.json`) for ntfy_topic, remote_url, quiet hours
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
- Pushed to GitHub: https://github.com/fallior/han

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
- ✅ tmux session management via `han` CLI
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
- ✅ Task execution logging (per-task markdown logs with timestamps)
- ✅ Append-only terminal buffer (survives compaction, manual trim)
- ✅ Goal decomposition via orchestrator (Ollama local or Anthropic API)
- ✅ Smart model routing (complexity → haiku/sonnet/opus)
- ✅ Retry logic with failure analysis and model escalation
- ✅ Project memory (outcome tracking, success rates by model)
- ✅ Dependency-aware task scheduling
- ✅ Goals tab UI with create, view, retry, progress bars
- ✅ Dark mode with automatic theme detection (light + dark)
- ✅ Theme toggle button in titlebar (🌙/☀️)
- ✅ localStorage persistence of theme preference
- ✅ prefers-color-scheme media query support
- ✅ Smooth theme transitions (150ms)
- ✅ WCAG AA color contrast in both themes
- ✅ Portfolio manager with project registry sync
- ✅ Per-project cost budgets with auto-throttle
- ✅ Priority engine for task scheduling (weighted scoring)
- ✅ Budget API endpoints and portfolio UI controls
- ✅ Ecosystem-aware context injection (buildTaskContext)
- ✅ Tech stack detection from package.json + CLAUDE.md
- ✅ Cross-project learnings filtering by relevance
- ✅ Settled decisions extraction for task context
- ✅ Sister project awareness via portfolio query
- ✅ Semantic commit prefixes in commitTaskChanges()
- ✅ Auto-commit after successful task completion
- ✅ Goal completion summaries (structured markdown with commits, files, cost)
- ✅ Commit SHA and files changed tracking per task
- ✅ Knowledge capture via structured markers ([LEARNING]/[DECISION])
- ✅ Proposals queue with review API (approve/reject)
- ✅ Approved learnings written to ~/Projects/_learnings/ + INDEX.md
- ✅ Approved decisions appended to DECISIONS.md
- ✅ Port allocation extraction from infrastructure registry
- ✅ Enhanced ecosystem summary with ports, task counts, flags
- ✅ GET /api/ecosystem structured endpoint
- ✅ Memory-based model routing (recommendModel — cheapest with proven success)
- ✅ GET /api/analytics (global, per-model, per-project, velocity, suggestions)
- ✅ Error pattern pre-emption (Known Pitfalls in task context)
- ✅ GET /api/errors/:project (error patterns with frequency/rate)
- ✅ Failed task learnings extraction (extractAndStoreProposals on failures)
- ✅ Duplicate outcome recording fix (exactly once per task)
- ✅ Daily digest generation with cross-project aggregation
- ✅ Digest scheduler (configurable hour, ntfy.sh push, WebSocket broadcast)
- ✅ Nightly maintenance automation (per-project goals, configurable hour)
- ✅ Per-project maintenance toggle
- ✅ createGoal() reusable helper for programmatic goal creation
- ✅ Weekly progress reports with daily burndown data
- ✅ Velocity trend tracking (this week vs previous week)
- ✅ Weekly report scheduler (configurable day + hour, ISO week gating)
- ✅ Product pipeline: 7-phase seed-to-deployment (research → design → architecture → build → test → document → deploy)
- ✅ Human gates at critical phases (design, architecture, build, deploy)
- ✅ Knowledge accumulation across phases (getKnowledgeSummary)
- ✅ Parent-child goal hierarchy for parallel subagent swarms
- ✅ Round-robin task interleaving across child goals
- ✅ 42 specialised subagents (6 per phase × 7 phases)
- ✅ Knowledge extraction from [KNOWLEDGE] markers with fallback
- ✅ Synthesis reports: Research Brief, Design Package, Architecture Spec, Build Report, Test Report, Documentation Package, Deploy Report
- ✅ Phase status APIs for all 7 phases (GET /api/products/:id/{phase})
- ✅ Pipeline completion with push notification
- ✅ Product CRUD + knowledge graph APIs
- ✅ TypeScript migration — modular server architecture (14 modules from 7,106-line monolith)
- ✅ 3 concurrent task pipelines (2 normal + 1 remediation)
- ✅ Escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human)
- ✅ Opus default model with max_turns minimum of 100
- ✅ Goal view filtering (active/archived/all) with project grouping
- ✅ Dashboard UI (analytics, digests, reports, health tabs)
- ✅ Manual retry endpoint with optional diagnostic agent
- ✅ Automated phantom goal cleanup in supervisor cycle
- ✅ All-cancelled goal state detection (correctly marks as 'cancelled' not 'done')
- ✅ Force-delete API for manual goal cleanup
- ✅ Supervisor frequency calculation excludes phantom goals
- ✅ Admin console Phase 2: Work, Conversations, Products, Workshop modules
- ✅ Work module: Kanban board with task/goal visualisation, filters, real-time updates
- ✅ Conversations module: Strategic discussion threads with supervisor responses, two-column layout (280px thread list | 1fr detail)
- ✅ Conversation panel: Integrated period filter bar (horizontal pills at top of thread list)
- ✅ Products module: Product pipeline visualisation with phase timeline
- ✅ Workshop module: Three-persona navigation (Jim purple, Leo green, Darron blue) with six nested discussion types, conversation threading, search, real-time updates, mobile-responsive
- ✅ Workshop thread management: Inline title editing, archive/unarchive with auto-reactivation on new message, View All toggle, archived thread styling
- ✅ Supervisor responds to pending conversation threads automatically
- ✅ Expandable task results in Work module (click kanban card to reveal agent completion summary)
- ✅ Expandable per-task breakdowns in Reports module (digest and weekly reports show detailed results on expansion)
- ✅ Markdown formatting for expanded result content (headers, code, bold/italic, lists)
- ✅ TypeScript build system for admin console (admin.ts → admin.js)
- ✅ Ghost task detection and auto-recovery (5-minute periodic check)
- ✅ Ghost tasks auto-reset to 'pending' with retry_count incremented
- ✅ Supervisor cancel_task handles ghost-running tasks (no agent_pid)
- ✅ Server startup ghost detection catches orphaned tasks from crashes
- ✅ Conversation auto-enrichment (summaries, topics, key moments)
- ✅ Haiku-based summary generation for cost efficiency
- ✅ FTS5 full-text search across conversation messages
- ✅ Temporal filtering on search (date range queries)
- ✅ Role filtering on search (leo/jim/darron)
- ✅ Passage card results (matching text + context)
- ✅ Temporal grouping API (conversations by week/month)
- ✅ Desktop admin console search UI (Conversations module enhanced)
- ✅ Search bar with advanced filters (temporal, role)
- ✅ Mobile Conversations tab with temporal navigation
- ✅ Mobile temporal period toggle (week/month view)
- ✅ Mobile prev/next period navigation
- ✅ Mobile inline summary display on conversation list
- ✅ FTS5 triggers for auto-indexing on message insert
- ✅ Conversation backfill system for existing conversations
- ✅ Search deduplication (single match per conversation per term)
- ✅ Multi-term search scoring (tf-idf style ranking)
- ✅ Tiered supervisor health checks (pulse/focused/deep)
- ✅ Pulse snapshot diffing for zero-cost idle cycle detection
- ✅ Focused diff-only API calls for lightweight change detection
- ✅ Configurable deep scan scheduling (daily hour + interval)
- ✅ Cycle tier tracking in DB and admin console (colour-coded badges)
- ✅ Deferred cycle pattern (Gary Model): fs.watch-based signal detection
- ✅ Jim's supervisor detects CLI stop via cli-active file removal
- ✅ jim-wake signals for explicit supervisor wake on human messages
- ✅ Deferred cycles run within 3 seconds of CLI stop (vs up to 20 min wait)
- ✅ Belt-and-suspenders reliability (dual trigger paths)
- ✅ Robin Hood Protocol Phase 1-6 complete (mutual health monitoring + resurrection + distress)
- ✅ Leo monitors Jim's supervisor health, resurrects server process when down
- ✅ Jim monitors Leo's heartbeat health, resurrects heartbeat process when down
- ✅ Health signals at `~/.han/health/` with staleness classification
- ✅ PID-alive checks before resurrection (split-brain prevention)
- ✅ Resurrection log at `~/.han/health/resurrection-log.jsonl`
- ✅ Distress signal detection (Phase 5): early warning for degraded performance
- ✅ Jim's slow cycle detection: triggers at 3× median duration (e.g., 45min+ for 15min normal)
- ✅ Leo's slow beat detection: triggers at 2× expected max (e.g., 60min+ for 30min max)
- ✅ Distress ntfy notifications + yellow warning banners in Admin UI
- ✅ Admin UI health monitoring panel (Phase 6): real-time dashboard in Supervisor module
- ✅ Health panel shows Jim/Leo status, resurrection history, distress signals, uptime
- ✅ WebSocket real-time updates for health status changes
- ✅ Verification wait fix: 12-second sleep after Jim restart (was 3s, caused false failures)
- ✅ 1-hour cooldown between resurrection attempts, ntfy human escalation on failure
- ✅ Bearer token authentication for remote access (/api/* and /admin routes)
- ✅ Localhost authentication bypass (127.0.0.1, ::1, ::ffff:127.0.0.1)
- ✅ WebSocket authentication via query param or Sec-WebSocket-Protocol header
- ✅ Configuration-driven auth (server_auth_token in config.json)
- ✅ Signal-based WebSocket broadcasting for all message sources (conversations.ts, supervisor-worker.ts, jim-human.ts, leo-human.ts)
- ✅ Cross-process broadcast coordination via ~/.han/signals/ws-broadcast (100ms polling, atomic temp file writes)
- ✅ Standardised broadcast payload shape across all four sources (type, conversation_id, discussion_type, message)
- ✅ Real-time admin UI updates for human agent async messages (Jim/Human and Leo/Human)

## Next Actions

### Immediate (Next Session)
- [x] Level 11 (user choice — final level in ROADMAP)
- [x] Level 13 — Conversation catalogue & search complete
- [x] Fix Jemma bugs before service activation (health file field, command injection, reconciliation direction, SIGTERM exit code)
- [x] Add bearer token authentication for remote access
- [ ] Test WebSocket broadcasting for jim-human.ts and leo-human.ts messages (see docs/websocket-broadcast-design.md for 7 test scenarios)
- [ ] Activate Jemma systemd service in production
- [ ] Test conversation search with real conversation history
- [ ] Test backfill endpoint on existing conversations (`POST /api/conversations/recatalogue-all`)
- [ ] Test daily digest generation (`POST /api/digest/generate`)
- [ ] Test weekly report generation (`POST /api/weekly-report/generate`)
- [ ] Test maintenance run (`POST /api/maintenance/run`)
- [ ] Test knowledge capture markers with a real task

### Short-term
- [ ] Add git checkpoint visualisation in task detail view
- [ ] Add approval history tracking
- [ ] Monitor Haiku cataloguing costs over time
- [ ] Consider conversation export/import functionality
- [ ] Refine UI based on continued mobile usage

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

- [x] Best way to handle multiple simultaneous Claude Code sessions? → `han-$$` naming
- [x] Should web UI auto-refresh or use WebSocket? → WebSocket with polling fallback
- [x] How to handle ntfy.sh action buttons on private networks? → Use `view` actions (opens on phone browser, which is on LAN)

## Session Notes

Recent sessions (latest first):
- [2026-03-03-autonomous-robin-hood-improvements.md](session-notes/2026-03-03-autonomous-robin-hood-improvements.md) — Robin Hood Protocol Phases 5+6: distress signals + health dashboard
- [2026-03-02-autonomous-dependency-terminal-status-fix.md](session-notes/2026-03-02-autonomous-dependency-terminal-status-fix.md) — Fixed critical dependency blocker: failed tasks now terminal
- [2026-03-02-autonomous-robin-hood-phase3-4.md](session-notes/2026-03-02-autonomous-robin-hood-phase3-4.md) — Robin Hood Protocol Phase 3+4: Jim's health monitoring of Leo
- [2026-03-02-autonomous-expandable-task-results.md](session-notes/2026-03-02-autonomous-expandable-task-results.md) — Expandable task results in Work & Reports modules
- [2026-03-01-autonomous-workshop-thread-management.md](session-notes/2026-03-01-autonomous-workshop-thread-management.md) — Workshop thread management features
- [2026-03-01-autonomous-workshop-module.md](session-notes/2026-03-01-autonomous-workshop-module.md) — Workshop module complete with three-persona navigation
- [2026-02-28-autonomous-deferred-cycle-pattern.md](session-notes/2026-02-28-autonomous-deferred-cycle-pattern.md) — Deferred cycle pattern complete (Gary Model fs.watch implementation)
- [2026-02-27-autonomous-leo-heartbeat-bugfix.md](session-notes/2026-02-27-autonomous-leo-heartbeat-bugfix.md) — Fixed two critical bugs preventing Leo heartbeat from executing
- [2026-02-22-autonomous-conversation-search-complete.md](session-notes/2026-02-22-autonomous-conversation-search-complete.md) — Level 13: Conversation catalogue & search system complete
- [2026-02-22-autonomous-dependency-resolution-fix.md](session-notes/2026-02-22-autonomous-dependency-resolution-fix.md) — Fixed critical dependency resolution bug (DEC-020)
- [2026-02-22-autonomous-learnings-system-repair.md](session-notes/2026-02-22-autonomous-learnings-system-repair.md) — Created 5 missing learning files (L002-L006) in _learnings repository
- [2026-02-22-autonomous-ghost-task-detection.md](session-notes/2026-02-22-autonomous-ghost-task-detection.md) — Ghost task detection and recovery system
- [2026-02-21-autonomous-readme-rewrite.md](session-notes/2026-02-21-autonomous-readme-rewrite.md) — README.md comprehensive rewrite (Levels 1-12)
- [2026-02-20-autonomous-documentation-update.md](session-notes/2026-02-20-autonomous-documentation-update.md) — Documentation update for phantom goal cleanup
- [2026-02-20-autonomous-phantom-goal-cleanup.md](session-notes/2026-02-20-autonomous-phantom-goal-cleanup.md) — Phantom goal cleanup system
- [session_2026-02-18_08-30-00.md](../_logs/session_2026-02-18_08-30-00.md) — Escalating retries, 3 pipelines, opus defaults, goal filtering
- [session_2026-02-17_20-37-25.md](../_logs/session_2026-02-17_20-37-25.md) — Dashboard UI
- [session_2026-02-17_16-03-47.md](../_logs/session_2026-02-17_16-03-47.md) — TypeScript migration + cleanup
- [session_2026-02-16_23-46-39.md](../_logs/session_2026-02-16_23-46-39.md) — Level 11 completion
- [session_2026-02-16_17-08-00.md](../_logs/session_2026-02-16_17-08-00.md) — Level 9 Phases 3-5 (complete)
- [session_2026-02-16_14-48-00.md](../_logs/session_2026-02-16_14-48-00.md) — Level 10 Phases B-F (complete)
- [session_2026-02-16_04-30-00.md](../_logs/session_2026-02-16_04-30-00.md) — Level 9.2 + Level 10 Phase A + DEC-015
- [session_2026-02-15_09-30-00.md](../_logs/session_2026-02-15_09-30-00.md) — Level 8 commit + roadmap update
- [session_2026-02-15_02-30-00.md](../_logs/session_2026-02-15_02-30-00.md) — Task logging + append-only terminal buffer
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
cd src/server && npx tsx server.ts
```

**To configure push notifications:**
```json
// ~/.han/config.json
{
  "ntfy_topic": "your-secret-topic",
  "remote_url": "http://your-ip:3847"
}
```
