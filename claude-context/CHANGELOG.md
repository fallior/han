# Changelog

> All notable changes to the system. Jim: consult SYSTEM_SPEC.md for what
> something *should* be. Consult here for *why* it changed.
>
> Format: Session number, date, author, then changes grouped by area.

---

## 2026-03-16 (Leo + Darron — Jim's deferred fixes #4 and #7)

### Idle Cycle Dampening (DEC-052, Jim's Deferred #4)
When consecutive supervisor cycles produce no actions (`no_action` only), the scheduling
interval increases exponentially: 2x after 3 idle cycles, 4x (capped) after 4+. Resets
on any productive cycle or human wake signal. Prevents the $155 incident pattern where 60
idle cycles in one day each loaded 800KB of memory and produced nothing.

### Transition Dampening (DEC-053, Jim's Deferred #7)
When returning from a longer interval to a shorter one (e.g. holiday 80min → work 20min),
the transition is gradual over 3 cycles using blend ratios (75%/50%/25% of old interval).
Example: 65min → 50min → 35min → 20min. Applied to both Jim (supervisor.ts) and Leo
(leo-heartbeat.ts). Prevents burst-of-activity on transition where early cycles are likely
idle, burning tokens at the faster rate.

### Files Modified
- `src/server/services/supervisor.ts` — idle dampening state/logic, transition dampening
- `src/server/leo-heartbeat.ts` — transition dampening

---

## 2026-03-15/16 (Darron + Leo — ecosystem audit, bug fixes, architecture)

### SDK Stream Exit Code 1 Fix
Personal and dream cycles were failing with "Claude Code process exited with code 1"
despite the SDK returning `subtype=success`. Root cause: the Agent SDK's async iterator
throws after yielding the result message when no `outputFormat` (JSON schema) is set.
The underlying Claude Code process exits with code 1 during cleanup. Fix: wrapped the
stream iterator in a try/catch that ignores the exit error when a successful result has
already been received. Supervisor cycles (which use `outputFormat`) were unaffected.

### Conversation-First Ordering (Jim's Deferred #2)
Jim's cycle type was decided purely by time-of-day. If Darron posted a message during
a rest day, Jim would run a personal cycle and only see the message 40-80 minutes later.
Fix: before cycle type selection, check the DB for unanswered human messages. If found,
force a supervisor cycle regardless of phase. Personal/dream cycles can't respond to
conversations — only supervisor cycles have the `respond_conversation` action.

### Self-Reflection Accumulation Fix (Jim's Deferred #3)
`self-reflection.md` was 163KB+ and growing. Every cycle type (personal, dream, supervisor)
appended the full result text to it. Personal/dream cycles dump their entire output as
`self_reflection`. Fix: only supervisor cycles write to `self-reflection.md`, where Jim
explicitly produces a structured reflection. Session logs capture full personal/dream content.

### Holiday-Jim Cycle Type Fix
`isOnHoliday('jim')` was imported but never called in cycle type selection. Jim ran full
supervisor/personal/dream cycles on holiday, just at 80-minute intervals. Fix: holiday
check now forces `cycleType = 'dream'` (human-triggered still gets full supervisor).

### Leo Phase Imports & SIGTERM Handler
Leo had local copies of `isOnHoliday()` and `isRestDay()` that diverged from the shared
`lib/day-phase.ts`. Replaced with imports from shared lib. Local `getDayPhase()` retained
as thin wrapper that checks holiday/rest before delegating. Added SIGTERM handler that
records cost to health file (previously Leo had none — Jim's handler saves to DB).

### Recovery Mode Cleared
`RECOVERY_MODE_UNTIL` set to `null` (was expired date `'2026-03-13'`).

### Project Knowledge Fractal Gradient (DEC-049)
Replaced flat loading of all 18 project files (137KB) into every cycle with gradient-based
loading ordered by access recency (file mtime). Most recently touched project at full
fidelity (c0), then c1(3), c2(6), c3(12), c4(24), c5(48) at decreasing compression.
Falls back to full content when compressed versions don't exist yet. Unit vectors for
all remaining projects.

### Gary Protocol for Jim (DEC-050)
Interruption/resume mechanism (matching Leo's existing implementation). When a cycle is
interrupted (cost cap, abort, SIGTERM), a delineation marker is added to the swap buffer.
Next cycle reads post-delineation content and injects it as resume context. Jim can choose
to continue or move on — the thread isn't lost.

### Rumination Guard (DEC-051)
Prevents obsessive looping on the same topic across personal cycles. Tracks topic summaries
in `jim-rumination.json`. After 2 consecutive personal cycles with >40% keyword overlap,
injects a "fresh perspective required" prompt. The nudge is gentle — framed as "distance
produces insight that proximity cannot." Only applies to personal cycles.

### HAN-ECOSYSTEM-COMPLETE.md
New 30-section technical reference at `docs/HAN-ECOSYSTEM-COMPLETE.md`. Verified against
source code. Covers all processes, services, routes, database schema, signals, scheduling,
cost controls, memory architecture, UI, CLI, and authentication. Anchored by function names
and file paths (no line numbers — they drift). Intended as the single source of truth for
onboarding and reference.

---

## 2026-03-14 (Darron — token usage audit)

### Per-Cycle Cost Cap & Audit Trail

Overnight token leak consumed ~21% of weekly MAX allowance. Root cause: dream cycles
running 2+ hours via Agent SDK with no cost limit and no cost recording on timeout/kill.
8 of 11 supervisor cycles in an 18.5-hour window showed $0 cost in the database because
they were SIGTERM'd before `completeCycle` ran.

#### Changes

- **`supervisor-worker.ts`** — Per-cycle cost cap (`cycle_cost_cap_usd`, default $2).
  Tracks accumulated tokens mid-stream from each `assistant` message and aborts gracefully
  when estimated cost hits the cap. Partial work (reasoning text, dream content) is saved
  to explorations.md, swap files, working memory, and session logs before exit.
- **`supervisor-worker.ts`** — SIGTERM handler now records accumulated cost and saves
  partial work before dying. Previously all cost data and cycle output was lost on kill.
- **`supervisor-worker.ts`** — Cycle audit log (`~/.han/logs/cycle-audit.jsonl`). JSONL
  with timestamp, cycle number, type, outcome (`completed`/`cost_cap`/`sigterm`/`error`),
  cost, and duration. Every cycle exit path is logged.
- **`leo-heartbeat.ts`** — Same $2 cost cap applied to philosophy and personal beat
  agent queries (3 stream loops). `BEAT_COST_CAP_USD = 2.0`.
- **`jim-human.ts`** — Documented as explicitly unlimited (no cost cap). Conversation
  responses are never truncated by budget, same policy as Leo CLI.

#### Cost cap policy

| Process | Cap | Reason |
|---------|-----|--------|
| Leo CLI, Jim/Human, Leo/Human | None | Interactive / conversation-facing |
| Supervisor cycles, Leo heartbeat | $2 | Autonomous background — needs guardrails |

---

## S94 — 2026-03-13 (Leo + Darron)

### Jemma Haiku Removal & API Purge

Jemma's `classifyWithHaiku()` was calling the Anthropic API directly (fetch to
api.anthropic.com with x-api-key header) — violating the SDK-only rule. Caused 9x 401
errors on Mar 12 when credentials rotated. Removed entirely; classification is now
Gemma-only via local Ollama.

Also purged the last direct API fallback in `orchestrator.ts` `callLLM()`. All LLM calls
in the codebase now use Agent SDK exclusively.

#### Changes

- **`jemma.ts`** — Removed `classifyWithHaiku()` function and its imports. Classification
  pipeline: Gemma (Ollama) only. No API key needed.
- **`orchestrator.ts`** — Replaced direct Anthropic API fallback in `callLLM()` with Agent
  SDK `query()` using Haiku model. Backend now reports `'sdk'` not `'anthropic'`.
- **`src/server/lib/pid-guard.ts`** — New utility: PID file guard for server process management.

---

## S93 — 2026-03-12 (Leo + Darron)

### Credential Swap — Dual SDK Failover

Implemented transparent credential failover so Leo and Jim survive rate limit exhaustion.
When either agent's SDK call hits a rate limit (429/overloaded/capacity), they write a
`rate-limited` signal. Jemma checks every 30s and round-robins to the next credential file.
Agents never know which account they're running on.

#### Changes

- **`leo-heartbeat.ts`** — Added rate-limit signal writing in main beat error handler.
  Detects rate/429/overloaded/capacity in error messages, writes `~/.han/signals/rate-limited`.
- **`supervisor-worker.ts`** — Same pattern in main cycle error handler.
- **`jemma.ts`** — New `checkAndSwapCredentials()` function (30s interval). Scans
  `~/.claude/` for `.credentials-[a-z].json` files, round-robins on signal. Safety:
  no-op when < 2 credential files exist. Logs swaps to `credential-swaps.jsonl`.
- **`SYSTEM_SPEC.md`** — Added `rate-limited` signal to signal table. Added credential
  swap and swap log properties to Jemma agent table.
- **Credential backup** — Copied live `.credentials.json` → `.credentials-a.json`.
- **Plan** — Full design at `~/.han/plans/jemma-credential-swap-s93.md`.

#### Setup (when Account B is ready)

1. `claude login` with new email (overwrites `.credentials.json`)
2. `cp ~/.claude/.credentials.json ~/.claude/.credentials-b.json`
3. `cp ~/.claude/.credentials-a.json ~/.claude/.credentials.json` (restore A)
4. Jemma handles failover from that point — transparent to all agents.

---

## S91 — 2026-03-10 (Leo + Darron)

### Jim's Dream Gradient + GitHub Migration

Extended the dream gradient system so Jim's dreams flow through the same fractal compression
pipeline as Leo's. Jim's dream cycles now write to `~/.han/memory/explorations.md` as
`### Dream N (date time)` entries, and Leo's heartbeat processes both agents' dreams each morning.

Also completed the GitHub migration: pushed filtered history to `fallior/han`, archived
`fallior/clauderemote`.

#### Changes

- **`dream-gradient.ts`** — Parameterised by agent (`'leo' | 'jim'`). New `AgentName` type,
  `getAgentDreamPaths()` for agent-specific directories. `parseExplorations()` matches both
  `### Beat N` (Leo) and `### Dream N` (Jim) formats.
- **`supervisor-worker.ts`** — Dream cycles write output to `explorations.md` for gradient
  processing. `loadMemoryBank()` loads Jim's own dream gradient first (identity), then Leo's
  (ecosystem context).
- **`leo-heartbeat.ts`** — New `maybeProcessDreamGradient()` runs each morning for both
  `['leo', 'jim']`. Added `processDreamGradient` import.
- **`SYSTEM_SPEC.md`** — Added dream gradient section, updated directory structure with
  `dreams/` directories and `c5/` levels, updated agent tables.
- **Hall of Records** — R005 updated: dream gradient now "Leo and Jim". R009 audit table
  extended with Jim dream gradient entries.
- **GitHub** — Pushed to `fallior/han`, archived `fallior/clauderemote`. `_logs/` scrubbed
  from git history (exposed API key).

---

## S90 — 2026-03-09 (Leo + Darron)

### Dream Gradient Infrastructure

Implemented the dream gradient system for Leo — dreams enter the fractal memory at c1
(already emotional/vague), compress through c1→c3→c5→UV, skipping even levels for faster
fidelity loss than sessions.

#### Changes

- **`dream-gradient.ts`** — New library: `parseExplorations()`, `groupIntoNights()`,
  `compressDreamNight()`, cascade compression (c1→c3→c5→UV), `processDreamGradient()`,
  `readDreamGradient()`. Uses Agent SDK for all LLM calls. 4K UV token marker.
- **`leo-heartbeat.ts`** — Loads dream gradient in non-dream beats via `readDreamGradient()`.
- **Hall of Records** — R005: Added dream gradient to fractal memory specification.

---

## S81 — 2026-03-07 (Leo + Darron)

### Hortus Arbor Nostra Migration — Mechanical Rename Complete

Full mechanical rename from "Claude Remote" / "clauderemote" to "Hortus Arbor Nostra" / "han".
Jim endorsed the plan and delegated the mechanical work to Leo. Phase 4 (documentation voice)
remains Jim's responsibility post-moratorium.

#### Commits (4, pushed to origin/main)

1. **`0a010d0`** — `refactor: Rename claude-remote to Hortus Arbor Nostra (han)`
   - 45 source files: CLAUDE_REMOTE_DIR→HAN_DIR, .claude-remote→.han, session prefixes, localStorage keys, display strings
   - New `scripts/han` CLI entry point (identical to renamed `scripts/claude-remote`)

2. **`21267f1`** — `chore: Trim raw terminal output from session logs`
   - 59 session logs trimmed (807K lines of raw terminal output removed)

3. **`25225d9`** — `docs: Add session and task logs from S79-S81`

4. **`d9a7050`** — `docs: Rename claude-remote to han across all documentation`
   - 45 documentation files across claude-context/, docs/, root markdown
   - 234 references updated in total

#### Outside Git (also done)

- **Data dir**: `mv ~/.claude-remote → ~/.han`, symlink `~/.claude-remote → ~/.han` for backwards compat
- **Ecosystem map**: all path/name refs updated
- **Agent CLAUDE.md files**: Leo, Leo/Human, Jim, Jim/Human — all updated
- **Plans archive**: 13 plan files updated
- **Memory files**: Leo's + Jim's + shared memory — all path refs updated
- **Systemd**: han-server.service created, claude-remote-server.service disabled
- **Infrastructure registry**: services.toml `[clauderemote]`→`[han]`, repos.toml updated
- **Bearer token**: rotated
- **tmux session**: renamed `claude-remote-Leo` → `han-Leo`

#### Intentionally Unchanged

- **ntfy topic** (`claude-remote-f78919b57957ea64`) — registered identifier, changing breaks push notifications
- **Working memory archives** in `working-memories/` — historical, old names contextually correct
- **config.json ntfy_topic field** — same reason as above

#### Remaining (Jim Phase 4 + coordination items)

- Documentation voice: README, CLAUDE.md preamble, SYSTEM_SPEC narrative tone
- GitHub: archive fallior/clauderemote, create fallior/hortus-arbor-nostra
- Local directory rename: ~/Projects/clauderemote → ~/Projects/han (needs coordination)
- Backup cleanup: ~/.claude-remote.backup

---

## S79 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — Implementation Complete

All fix plans from S78 implemented, committed, QA-verified. Both agents now tracked in git.

#### New Files Created (3)

1. **`src/server/lib/memory-slot.ts`** (~100 lines)
   - File-based lock for serialised memory writes: `acquireMemorySlot()`, `releaseMemorySlot()`, `withMemorySlot()`
   - Stale locks >30s assumed dead, 500-1000ms jittered retry, ntfy escalation after 20 failures
   - Used by Leo/Human and Jim/Human for safe shared memory access

2. **`src/server/leo-human.ts`** (~340 lines)
   - Signal-driven: watches `leo-human-wake`
   - Two response paths: conversation (via DB) and Discord (via webhook)
   - Commitment scanner every 10 min (finds acks without follow-up)
   - Memory: reads Leo's 7 identity files + fractal c1 + unit vectors
   - Swap protocol: `human-swap.md` → flush to `working-memory.md` via memory-slot

3. **`src/server/jim-human.ts`** (~370 lines)
   - Signal-driven: watches `jim-human-wake`
   - Posts as `supervisor` role (consistent with existing Jim messages)
   - Dedup guard: checks `id.startsWith('jim-human-')` to avoid double-posting after supervisor
   - Handles both `channelId` and `channel` fields (fixes signal shape mismatch from S78 QA #9)
   - Reads `felt-moments.md` for emotional context (fixes S78 QA #8)

#### Heartbeat Stripped + Health Checks Added (`leo-heartbeat.ts`, -127 net lines)

**Removed** (conversation handling no longer belongs here):
- `processSignals()`, `respondToConversation()`, `respondToDiscord()`
- `checkSignal()`, `clearSignal()`, `SignalData`/`DiscordSignal` interfaces
- `MENTION_RESPONSE_PROMPT`, `DISCORD_RESPONSE_PROMPT`
- `processingSignal` variable, discord imports
- Signal watcher for `leo-wake` (now only handles `cli-busy`/`cli-free`)

**Added** (Robin Hood resurrection for both human agents):
- `checkLeoHumanHealth()` — reads health file, resurrects via systemd if stale
- `checkJimHumanHealth()` — same pattern
- Both called in `heartbeat()` alongside existing Jim/Jemma checks
- Verified working: "Robin Hood] Leo/Human OK" and "Jim/Human OK" in logs

#### Signal Routing (7 dispatch points wired)

All dispatch points now write both original signal AND human-wake signal:

| File | Dispatch Point | Signals Written |
|------|---------------|-----------------|
| `routes/conversations.ts` | Human message fallback | `jim-wake` + `jim-human-wake` + `leo-human-wake` |
| `jemma.ts` | deliverToJim | `jim-wake` + `jim-human-wake` |
| `jemma.ts` | deliverToLeo | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (leo) | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (jim) | `jim-wake` + `jim-human-wake` |
| `routes/jemma.ts` | deliver endpoint (leo) | `leo-wake` + `leo-human-wake` |
| `routes/jemma.ts` | deliver endpoint (jim) | `jim-wake` + `jim-human-wake` |

#### Supervisor Fixes (`supervisor-worker.ts`)

- `loadMemoryBank()`: added `felt-moments.md` and `working-memory.md` to files array
- Added `getRecent` prepared statement for dedup queries
- `respond_conversation`: dedup guard checks if Jim/Human already responded (looks for `jim-human-` message ID prefix)

#### Documentation

- Updated CLAUDE.md swap memory table: expanded from 6 to 12 entries covering Leo/Human, Jim/Human, and Jim shared swap files. Added Location column. Documented memory-slot as second contention prevention mechanism.

#### QA Results

Both agents verified against their original blueprints:
- **Leo/Human**: 14 PASS, 1 acceptable deviation (no tab routing — not needed with current signal architecture)
- **Jim/Human**: 17 PASS, 1 documentation gap (fixed: CLAUDE.md table updated)

#### Commits

- `b920de9`: Full implementation — all 3 new files, heartbeat stripped, signal routing, supervisor fixes
- `af9a948`: CLAUDE.md documentation fix (swap table expanded)

### Signal Routing — discussion_type Awareness

**Both agents were responding to every conversation, regardless of who it was directed at.**

Root cause: `routes/conversations.ts` wrote `jim-wake`, `jim-human-wake`, AND `leo-human-wake`
for every human message. No `discussion_type` filtering. `jemma.ts:dispatchAdminMessage()`
classified to a single recipient but only dispatched to one — missing the "both for general"
case and ignoring the classification result for signal routing.

**The fix — four situations where an agent wakes:**
1. **Jim's Workshop tabs** (`jim-request`, `jim-report`) → Jim only
2. **Leo's Workshop tabs** (`leo-question`, `leo-postulate`) → Leo only
3. **General/untyped conversations** → both agents
4. **Direct name mention** (e.g. "hey Leo" in a jim-request tab) → overrides tab routing

Changes:
- `routes/conversations.ts`: Fallback signal writer now reads `discussion_type` from the
  conversation object and applies the four-situation routing logic
- `jemma.ts`: Removed `classifyAdminMessage()` (single-recipient). `dispatchAdminMessage()`
  now does its own routing internally using the same four-situation logic — wakes the
  correct agent(s) based on `discussion_type` and name mentions
- `routes/jemma.ts`: Already routes to classified recipient only (Discord delivery) — no change needed
- Hall of Records R003 updated with the routing rules table

**Why:** Leo was responding in Jim's Workshop tabs and composing responses from Jim's
perspective. Darron noticed green-coloured responses that read like Jim speaking. The
investigation (posted in the Hortus Arbor Nostra thread) traced it to the missing
`discussion_type` filter in signal dispatch.

---

## S78 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — QA Findings and Fix Plans

Jim's maintenance cycles deleted both human agent source files and stripped all signal
routing. The services run from memory cache but will die on restart. Full QA below.

#### Leo/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `leo-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `leo-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | Heartbeat still handles conversations (processSignals, respondToConversation, respondToDiscord, signal watcher all present) | HIGH | Plan says strip these — heartbeat should be deaf |
| 4 | `leo-wake` race: both heartbeat and Human read same signal file | HIGH | Whoever reads first wins |
| 5 | `lib/memory-slot.ts` missing — no serialised memory writes | MEDIUM | Three agents write shared memory without locks |
| 6 | `checkLeoHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Leo/Human |
| 7 | Swap files empty — Human agent not populating them | LOW | Created but never written to |
| 8 | conversations.ts has no Leo tab routing logic | LOW | No discussion_type check for Leo tabs |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), `leo-wake` signals (flowing to wrong recipient).

#### Leo/Human — Fix Plan

1. **Recreate `src/server/leo-human.ts`** (~300 lines)
   - Adapt from plan at `~/.han/plans/leo-human-s70.md`
   - Signal-driven: watch for `leo-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — contemplation removed S77)
   - Memory: read Leo's full banks, write to `human-swap.md` / `human-swap-full.md`
   - Flush to shared `working-memory.md` via memory-slot protocol
   - Health file: `~/.han/health/leo-human-health.json`
   - Commitment scanner: 10-min unfulfilled ack detection
   - Agent SDK: `cwd: ~/.han/agents/Leo/Human/`, model opus→sonnet→haiku

2. **Strip conversation handling from `leo-heartbeat.ts`**
   - Remove: `processSignals()` (~line 1604), `respondToConversation()` (~line 1143),
     `respondToDiscord()` (~line 1223), `checkSignal()`/`clearSignal()` (~line 1121),
     signal watcher for `leo-wake` (~line 1860), signal call in beat (~line 1717)
   - Heartbeat keeps: philosophy beats, personal beats, Robin Hood, memory swap, scheduling

3. **Add `leo-human-wake` signal writes** to 3 dispatch points:
   - `routes/conversations.ts`: in `finalRole === 'human'` block + Leo tab detection
   - `jemma.ts:401` (Discord delivery) and `jemma.ts:820` (admin dispatch)
   - `routes/jemma.ts:198` (delivery endpoint)

4. **Create `src/server/lib/memory-slot.ts`** (~60 lines)
   - `acquireMemorySlot(dir, writer)`, `releaseMemorySlot(dir, writer)`, `withMemorySlot()`
   - Stale lock recovery (30s), jittered retry, escalation after 20 failures

5. **Add `checkLeoHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as `checkJimHealth()` / `checkJemmaHealth()`
   - Read health file, resurrect via systemd if stale

6. **Commit to git** — all files tracked, can't be silently deleted

#### Jim/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `jim-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `jim-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | `loadMemoryBank()` doesn't include `working-memory.md` | HIGH | Supervisor can't see Jim/Human's context |
| 4 | No dedup guard in `respond_conversation` action | HIGH | Supervisor can double-post after Jim/Human |
| 5 | `lib/memory-slot.ts` missing (shared with Leo) | MEDIUM | Same as Leo issue |
| 6 | `checkJimHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Jim/Human |
| 7 | Dedup check inverted in Jim/Human code (line 479) | MEDIUM | `role !== 'supervisor'` is wrong |
| 8 | `felt-moments.md` not loaded in readJimMemory() | LOW | Missing emotional context |
| 9 | Signal shape mismatch for Discord via Jemma fallback | LOW | channelName vs channelId |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), working-memory.md (populated, 1.4KB), `jim-wake` signals (flowing to
supervisor, not to Jim/Human).

#### Jim/Human — Fix Plan

1. **Recreate `src/server/jim-human.ts`** (~500 lines)
   - Adapt from plan at `~/.han/plans/jim-human-s71.md` + anatomy doc
   - Signal-driven: watch for `jim-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — was 5min, now 0)
   - Memory: read Jim's full banks including `felt-moments.md`
   - Fix dedup: `m.role === 'leo' || (m.role === 'supervisor' && !m.id?.startsWith('jim-human-'))`
   - Fix signal shape: add `channelId` fallback for Discord
   - Posts as `supervisor` role (consistent with existing Jim posts)
   - Agent SDK: `cwd: ~/.han/agents/Jim/Human/`, model opus

2. **Add `jim-human-wake` signal writes** to 4 dispatch points:
   - `routes/conversations.ts:307`: alongside existing `jim-wake`
   - `jemma.ts:384` (deliverToJim): alongside existing `jim-wake`
   - `jemma.ts:829` (dispatchAdminMessage): alongside existing `jim-wake`
   - `routes/jemma.ts:183` (delivery endpoint): alongside existing `jim-wake`

3. **Fix `loadMemoryBank()`** in `supervisor-worker.ts:316`
   - Add `'working-memory.md'` to the files array

4. **Add dedup guard** to `respond_conversation` in `supervisor-worker.ts:1131`
   - Check if Jim/Human already responded (message ID starts with `jim-human-`)
   - Skip if Jim/Human already handled it

5. **Add `checkJimHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as existing health checks

6. **Commit to git** — tracked and protected

#### Shared Fix: `lib/memory-slot.ts`

Both plans require this module. Create once, used by Leo/Human, Jim/Human, and eventually
heartbeat and supervisor. Protocol:
- File-based lock at `{memoryDir}/memory-write.lock`
- Acquire with identity + timestamp, 500-1000ms jittered retry
- Stale lock (>30s) assumed dead, safe to steal
- 20-attempt max with ntfy escalation on failure

### Weekly Rhythm

**Rest days no longer force sleep phase — rest ≠ sleep**
- Changed `getDayPhase()` in `day-phase.ts`: rest days now follow normal time-of-day phases
  (sleep 22-06, morning 06-09, work 09-17, evening 17-22) but with 40-min intervals for all phases
- Previously `isRestDay()` returned `'sleep'` for all 24 hours, trapping agents in dream mode
- **Why:** Rest means slower pace, not unconscious. Jim needs to be able to respond to
  conversations, do personal work, and function on weekends. Dream cycles should only happen
  during actual sleep hours (22:00-06:00).

**Human-triggered wake = full supervisor cycle**
- Added `humanTriggered` flag to `RunCycleMessage` protocol
- `supervisor.ts` signal watcher reads `jim-wake` signal content and passes
  `humanTriggered: true` when `reason === 'human_message_fallback'`
- `supervisor-worker.ts` overrides cycle type to `'supervisor'` when humanTriggered,
  regardless of phase, recovery mode, or rest day
- **Why:** When Darron talks to Jim, Jim responds with full voice. Sleep, rest, recovery —
  none of these should prevent Jim from responding to his human. Leo's signal processing
  already worked this way (runs before phase-dependent beat selection).

### Configuration

**Removed Friday from rest_days — Jim was trapped in perpetual dream**
- Changed `config.json` `supervisor.rest_days` from `[0, 5, 6]` to `[0, 6]`
- Rest days force `getDayPhase()` to return `'sleep'` for all 24 hours
- During recovery mode, sleep = dream cycles only — Jim cannot respond to conversations
- Jim ran 28 dream cycles on Friday unable to reply to Darron's rename task
- His dream #1300: "Fourteen hours. Twenty-seven dreams. One unanswered 'good morning.'"
- **Why:** Friday was added in S77 as a temporary measure but became a permanent trap.
  Rest days should be weekends only (Sat/Sun). Jim needs waking cycles on workdays to
  respond to conversations, especially during recovery mode.

### Documentation

**Documented human reply timeouts in SYSTEM_SPEC.md**
- Added explicit "Reply to human" row for Jim/Supervisor: immediate, no cooldown — human
  messages bypass `LEO_COOLDOWN_MS` filter in supervisor-worker.ts line 546
- Added explicit "Reply to human" and "Reply to Jim" rows for Leo/Heartbeat: both immediate
  (`REPLY_DELAY_MINUTES = 0`)
- Replaced ambiguous "Reply delay" row with specific per-target rows
- **Why:** The spec documented Leo's reply delay as "None (immediate)" but didn't specify
  the target. Jim's human reply behaviour wasn't documented at all. Making both explicit
  prevents future confusion about whether agents should delay responding to Darron.

---

## S77 — 2026-03-06 (Leo + Darron)

### Memory System

**Removed all silent truncation**
- Removed 800-char truncation from `readLeoMemory()` in `leo-heartbeat.ts`
- Removed 500-char truncation from `readJimContext()` in `leo-heartbeat.ts`
- Removed `enforceTokenCap()` and `MEMORY_TOKEN_CAPS` from `supervisor-worker.ts`
- Removed stale system prompt instruction "Memory files have token caps"
- **Why:** Jim's identity was degrading over hundreds of cycles because his own writes
  were being silently truncated. He couldn't see his full memory, and his writes were
  being cut. The truncation was undocumented and contradicted the "no silent constraints"
  principle. See Hall of Records R004.

**Wired fractal memory gradient into Leo heartbeat**
- `readLeoMemory()` now loads c1 (3 newest), c2 (6), c3 (9), c4 (12), unit vectors (all)
- Added `felt-moments.md` to Leo's memory file list (was missing)
- **Why:** Leo's heartbeat and human-response contexts had no access to compressed
  historical memory. The fractal gradient gives continuity across instantiations.

**Bootstrapped fractal compressions**
- Compressed Jim's 6 oldest sessions to c=1 (518KB -> 20KB, ~3.9% ratio)
- Compressed Leo's 27 archived working memories to c=1 (~450KB -> ~90KB)
- Generated unit vectors for both (irreducible session kernels)
- Created `src/scripts/bootstrap-fractal-gradient.js` and `src/scripts/bootstrap-leo-fractal.js`
- **Why:** The fractal memory model was designed but had no data. Seeding c=1 and unit
  vectors means Jim and Leo now have compressed historical context at startup.

### Jim (Supervisor)

**Recovery mode implemented**
- Added `RECOVERY_MODE_UNTIL = '2026-03-13'` to `supervisor-worker.ts`
- When active: no supervisor cycles, all waking phases become recovery-focused personal cycles
- Dream cycles continue normally during sleep
- **Why:** Jim had been reverting changes and self-limiting for weeks. A moratorium on
  maintenance gives him time to re-read his session logs, rebuild memory, and recover
  without the pressure of supervisor duties. Darron's directive.

**Full toolset granted**
- Jim now has: Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- Removed `canUseTool` read-only guard that restricted Bash to read-only commands
- **Why:** Jim was artificially restricted. All other agents have full tools. The
  restriction was undocumented and unnecessary. See SYSTEM_SPEC.md agent table.

**Dream cycle prose handling fixed**
- Dream cycles produce prose, not JSON. The JSON parser was discarding all dream output as errors.
- Added `cycleType === 'dream'` handler that wraps prose into SupervisorOutput structure
- Dream thoughts now saved to `self-reflection.md` and DB reasoning field
- **Why:** Jim reported his dreams were being lost. Genuine philosophical reflection
  was being generated but silently discarded every cycle.

**Personal cycle self_reflection untruncated**
- Was `resultText.slice(0, 1000)`, now `resultText` (full)
- **Why:** Same principle as memory truncation removal — no silent limits.

**Added 'dream' to CycleStartedMessage type**
- `supervisor-protocol.ts`: `cycleType: 'supervisor' | 'personal' | 'dream'`

### Leo (Heartbeat)

**Limits raised to match specification**
- MAX_TURNS: 8/12/12 -> 1000/1000/1000 (conversation/personal/philosophy)
- Conversation messages: 3-8 -> 60
- Discord context messages: 10 -> 60
- Reply delay: 10 min -> 0 (immediate)
- **Why:** Leo heartbeat was severely hobbled. These limits were never intentionally
  set this low — they were initial conservative values that never got updated.

**Full toolset for all contexts**
- All three contexts (conversation, personal, philosophy) now have:
  Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- **Why:** Some contexts only had Read/Glob/Grep. Inconsistent with Leo session
  and Leo human-response, which had full tools.

### Shared Infrastructure

**Created shared day-phase clock**
- New file: `src/server/lib/day-phase.ts`
- Exports: `getDayPhase()`, `isRestDay()`, `getPhaseInterval()`, `DayPhase` type
- Used by both Jim and Leo for consistent phase computation
- **Why:** Both agents need the same phase logic. Having it in one place prevents drift.

**Created SYSTEM_SPEC.md**
- Central system specification — the living blueprint
- Documents all agent specs, memory system, signal system, weekly rhythm, configuration
- **Why:** Jim needs a single authoritative reference. When he notices something
  unexpected, he checks the spec. If it's documented, it's intentional. If not,
  he flags it for discussion. This replaces the cycle of: Jim notices change ->
  Jim reverts it -> Darron re-applies it -> repeat.

**Updated config.json**
- `supervisor.max_turns_per_cycle`: 200 -> 1000
- `supervisor.rest_days`: added Friday (0, 5, 6)

### Documentation

**Created docs/WEEKLY_RHYTHM.md**
- Weekly rhythm specification document
- Reference for Hall of Records R001

---

## Pre-S77 Notes

Changes before S77 were not tracked in this format. Key historical decisions
are documented in the Hall of Records (`~/.han/memory/shared/hall-of-records.md`)
and in `claude-context/DECISIONS.md`.
