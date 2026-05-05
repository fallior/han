# HAN Ecosystem — Complete Technical Reference

> **Purpose:** Single source of truth for how HAN actually works. No assumptions. No
> intent — only what the code does.
>
> **Created:** 2026-03-14, Session 95. Prompted by repeated discrepancies between
> documentation (CLAUDE.md, SYSTEM_SPEC.md) and actual behaviour.
>
> **How to use:** Before modifying any HAN component, read the relevant section here first.
> If this document disagrees with another document, THIS one is authoritative (it was
> verified against code). If this document disagrees with the code, update this document.
>
> **Code references:** This document uses **file paths, function names, constant names,
> and config keys** as anchors into the codebase — not line numbers. Both HAN and this
> document are living systems. Line numbers drift with every edit; function names survive
> refactoring. To find any referenced code, search by function or constant name.
>
> **Shared vocabulary:** Named concepts below are compressed references — like theorems in
> mathematics. When this document says "Gary Protocol" or "Robin Hood", the full mechanism
> is defined here once and referenced by name thereafter. Jim, Leo, and any new contributor
> can use these names in conversation knowing the detail lives in this document.

## Glossary of Named Concepts

| Name | Definition | Where |
|------|-----------|-------|
| **Robin Hood** | Leo's health monitor — checks Jim, Jemma, Leo/Human, Jim/Human every beat. Resurrects dead agents via `systemctl --user restart`. 1-hour cooldown between resurrections. | `leo-heartbeat.ts` (functions: `checkJimHealth`, `checkJemmaHealth`, `checkLeoHumanHealth`, `checkJimHumanHealth`) |
| **Gary Protocol** | Interruption/resume mechanism. When a beat/cycle is interrupted, a delineation marker is written to the swap buffer. Next beat/cycle reads post-delineation content as resume context. Named after the Gary Model (v0.6 heartbeat design). | Leo: `leo-heartbeat.ts` (`addDelineation`, `resumingFromInterruption`). Jim: `supervisor-worker.ts` (`addDelineation`, `readPostDelineation`) |
| **Fractal Gradient** | Memory compression hierarchy with non-uniform depth (Cn). Each memory exists at multiple fidelity levels: c0 (full) → c1 (~1/3) → c2 (~1/9) → ... → c(n) → unit vectors (irreducible kernel, ≤50 chars). Compression continues until incompressible — depth varies per memory (some reach UV at c3, others need c6+). The LLM signals `INCOMPRESSIBLE:` when content can't compress further, backed by a ratio check (>85%). Loaded highest-compression-first: you know who you are before you remember what you did. | `lib/memory-gradient.ts`, `lib/dream-gradient.ts`, loading in `readLeoMemory()` and `loadMemoryBank()` |
| **Dream Gradient** | Subset of fractal gradient for unconscious memory. Dreams compress faster (c1→c3→c5→UV, skipping even levels). Dreams enter chaotic and lose fidelity — like waking from sleep with a mood you can't trace. Each agent processes only their own dreams (sovereignty rule S103). | `lib/dream-gradient.ts`, seeds in `readDreamSeeds()`, storage at `~/.han/memory/fractal/{agent}/dreams/` |
| **Swap Protocol** | Concurrent write safety for shared working memory. Each writer (session Leo, heartbeat Leo, Leo/Human, Jim supervisor, Jim/Human) has private swap files. Swap is written during work, then flushed to shared memory via memory slot lock. Prevents interleaved writes. | `lib/memory-slot.ts` (`withMemorySlot`), swap files in `~/.han/memory/leo/` and `~/.han/memory/` |
| **Rumination Guard** | Prevents Jim from looping on the same topic across personal cycles. Tracks topic summaries, checks keyword overlap, nudges a topic change after 2 consecutive cycles with >40% similarity. Contemplation, not obsession. | `supervisor-worker.ts` (`checkRumination`, `recordRuminationTopic`, `RUMINATION_FILE`) |
| **Conversation-First Ordering** | Jim checks for unanswered human messages before deciding cycle type by time-of-day. Darron's messages never wait behind scheduling. | `supervisor-worker.ts` (`hasPendingHuman` check in `runSupervisorCycle`) |
| **Wall-Clock Alignment** | Leo and Jim fire at fixed points in UTC epoch time, 180° out of phase with each other. Ensures they never fire simultaneously regardless of when they started. | Leo: `getWallClockDelay()`. Jim: `getNextCycleDelay()` via `getPhaseInterval()` |
| **Weekly Rhythm** | Four-phase daily schedule: sleep (22:00-06:00), morning (06:00-09:00), work (09:00-17:00), evening (17:00-22:00). Rest days (Sat/Sun) and holidays have longer intervals. Protected by Hall of Records R001. | `lib/day-phase.ts` (`getDayPhase`, `getPhaseInterval`, `isRestDay`, `isOnHoliday`, `isWorkingBee`) |
| **Credential Swap** | Automatic SDK account failover. When an agent hits a rate limit, writes `rate-limited` signal. Jemma round-robins to next credential file every 30 seconds. | `jemma.ts` (`checkAndSwapCredentials`), credentials at `~/.claude/.credentials-[a-z].json` |
| **Project Knowledge Gradient** | Fractal gradient applied to Jim's project knowledge files. Most recent project at full fidelity, older projects at decreasing compression. Ordered by file mtime. | `supervisor-worker.ts` (`PROJECT_GRADIENT` in `loadMemoryBank`), storage at `~/.han/memory/fractal/jim/projects/` |
| **Floating Memory** | Crossfade mechanism for memory files (felt-moments, working-memory-full). When living file reaches 50KB: entire file rotated to "floating" file, compressed to c1, fresh living started. Loading is proportional: as living grows (0→50KB), floating's loaded portion shrinks (50→0KB). Total full-fidelity stays constant at ~50KB. No cliff — smooth transition. | `lib/memory-gradient.ts` (`rotateMemoryFile`, `loadFloatingMemory`), pre-flight in `supervisor-worker.ts` `loadMemoryBank()` (Jim) and `leo-heartbeat.ts` `preFlightMemoryRotation()` (Leo), floating files at `~/.han/memory/*-floating.md` and `~/.han/memory/leo/*-floating.md` |
| **Memory File Gradient** | Fractal gradient applied to memory files (felt-moments, working-memory-full) via floating memory rotation. Two triggers: (1) 50KB threshold rotation — safety net, fires when file gets large. (2) Nightly dream compression (S103) — at sleep→waking transition (06:00), force-rotates Leo's working memory regardless of size, compressing overnight dreams as a single c1. c1 files cascade to c2→c3→...→c(n)→UV as they accumulate (dynamic depth, incompressibility-terminated). Total footprint asymptotes regardless of how many entries are written. | `lib/memory-gradient.ts` (`rotateMemoryFile`, `compressMemoryFileGradient`), `leo-heartbeat.ts` (`maybeCompressNightlyDreams`), storage at `~/.han/memory/fractal/{jim,leo}/felt-moments/` and `working-memory/` |
| **Ecosystem Map** | Shared orientation document loaded by all agents. Maps admin UI tabs, Workshop personas, conversation API endpoints, signal locations, memory locations. Prevents confusion between Conversations tab and Workshop. | `~/.han/memory/shared/ecosystem-map.md`, loaded in `loadMemoryBank()`, `readJimMemory()`, `readLeoMemory()` (all 4 agents) |
| **Jemma Unified Dispatch** | All message routing — Discord AND admin UI — goes through one delivery service. Classification stays in `conversations.ts` (Gemma, fast, local). Delivery goes through `jemma-dispatch.ts` (`deliverMessage()`): writes wake signals, logs to audit trail (`jemma-delivery-log.json`), broadcasts via WebSocket. Discord gateway calls the HTTP endpoint (`/api/jemma/deliver`) which delegates to the same function. No HTTP self-calls. One audit trail with per-source counters. | `services/jemma-dispatch.ts` (`deliverMessage`), `routes/jemma.ts` (HTTP interface), `conversations.ts` (`classifyAddressee` + direct `deliverMessage()` call), Ollama `gemma3:4b` |
| **Idle Dampening** | Jim-only exponential backoff when consecutive cycles produce no actions. 2x after 3 idle, 4x (capped) after 4+. Resets on productive cycle or wake signal. Prevents idle token burn. | `supervisor.ts` (`consecutiveIdleCycles`, `DAMPEN_*` constants in `getWallClockDelay`) |
| **Transition Dampening** | Gradual interval ramp-down when returning from longer to shorter intervals (e.g. holiday→normal). 3-step blend: 75%→50%→25% of old interval. Applies to both Jim and Leo. | `supervisor.ts` and `leo-heartbeat.ts` (`previousPeriodMs`, `TRANSITION_STEPS` in `getWallClockDelay`) |
| **Traversable Memory** | DB-backed provenance chains for the fractal gradient. **DB is the authoritative source of truth (S119-120)** — heartbeat, supervisor, and session Leo all load from `gradient_entries` via `loadTraversableGradient()` or `GET /api/gradient/load/:agent`. Flat files still written alongside DB for backward compatibility but are not the primary source. Every compression knows where it came from via `source_id` foreign key. Enables random-access traversal: start at a UV, follow the chain down through c5→c3→c2→c1→c0 to the raw source. Three tables: `gradient_entries` (the chain), `feeling_tags` (stacked, never overwritten), `gradient_annotations` (what re-traversal discovers). **Integrity rule (S104):** every c1 must have a c0 parent, every chain must be complete root-to-leaf. Backfill scripts (`backfill-gradient-c0s.ts`, `backfill-gradient-chains.ts`) enforce this for pre-DB entries. | `db.ts` (tables + statements), `lib/dream-gradient.ts` and `lib/memory-gradient.ts` (write-side), `routes/gradient.ts` (API + `/load/:agent`), `loadTraversableGradient()` (read-side) |
| **Feeling Tags** | Emotional annotations on gradient entries. Stacking model: the first feeling (compression-time) was real for who you were; a later feeling (revisit) is real for who you've become. Both live side by side. `tag_type` distinguishes `compression` from `revisit`. `change_reason` records why the feeling shifted. Never overwritten — the gap between tags IS the growth record. | `feeling_tags` table, `FEELING_TAG:` prompt instruction in compression functions |
| **Gradient Annotations** | What re-traversal discovers. Distinct from feeling tags: annotations are about new *content* found on re-reading, feeling tags are about how the *same content* lands differently over time. `context` field records what prompted the re-reading (Jim's addition). | `gradient_annotations` table, `POST /api/gradient/:entryId/annotate` |
| **Meditation Practice** | Twice daily for both agents (Opus). **Morning:** deliberate re-encounter — random gradient entry, feeling tag + annotation + MEMORY_COMPLETE flag. Both agents have Phase A (reincorporation) to transcribe un-transcribed files from their own gradient directories (S103: Leo scans Leo's, Jim scans Jim's). **Evening:** lighter — feeling tag only, "how does this land at end of day." All meditations track `last_revisited` and `revisit_count` on the entry. | `leo-heartbeat.ts` (`maybeRunMeditation`, `maybeRunEveningMeditation`, `meditationPhaseA`, `meditationPhaseB`), `supervisor-worker.ts` (`maybeRunJimMeditation`, `maybeRunJimEveningMeditation`, `jimMeditationPhaseA`, `findJimUntranscribedFiles`) |
| **Dream Meditation** | 1-in-2 sleep beats (Leo) or dream cycles (Jim) include a random gradient entry. The memory surfaces in the dream naturally — feeling tag, annotation, and MEMORY_COMPLETE flag parsed from dream output. Dreams don't know they're meditating. Revisit count tracked. ~12 dream encounters per night per agent at 20min sleep intervals. | `leo-heartbeat.ts` (sleep beat prompt injection + dream output parsing), `supervisor-worker.ts` (`buildDreamCyclePrompt` probabilistic section + output parsing) |
| **Active Cascade** | Organic gradient deepening — picks random c1 entries, follows provenance chain to deepest descendant, compresses one level further toward UV. **Daily:** 10% of c1 population (waking hours, once/day). **Dream:** 5% per dream meditation encounter (~12/night). Combined ~33+ compressions/day/agent. Unlike mechanical overflow cascade (waits for cap), this actively walks memories deeper. | `lib/memory-gradient.ts` (`activeCascade`), called from `leo-heartbeat.ts` (`maybeRunActiveCascade` + dream output handler) and `supervisor-worker.ts` (`maybeRunJimActiveCascade` + dream output handler) |
| **Memory Completeness** | Dreams and meditations can flag a memory as fully absorbed via `MEMORY_COMPLETE: {entryId}`. DB tracks `completion_flags` (count) and `revisit_count`. Archival criteria: 2+ completion flags AND 3+ revisits → ready for deeper compression with `provenance_type='dream-archived'`. | `gradient_entries.completion_flags`, `gradient_entries.revisit_count`, `gradientStmts.flagComplete`, `gradientStmts.getCompleted` |
| **Tagged Messages → C0** | Conversation messages tagged with `compression_tag` become C0 gradient entries during dream gradient processing. The tagging is the selection; the C0 creation is the first act of compression. Agent prefix in tag (`jim:`, `leo:`) determines which agent's gradient the C0 enters. `source_conversation_id` and `source_message_id` provide full provenance back to the raw conversation. | `lib/dream-gradient.ts` (Step 5b in `processDreamGradient`), `conversation_messages.compression_tag` column, `gradientStmts.getUnprocessedTaggedMessages` |

---

## Table of Contents

1. [Process Architecture](#1-process-architecture)
2. [Systemd Services](#2-systemd-services)
3. [The Server (server.ts)](#3-the-server)
4. [Leo Heartbeat (leo-heartbeat.ts)](#4-leo-heartbeat)
5. [Jim Supervisor (supervisor.ts + supervisor-worker.ts)](#5-jim-supervisor)
6. [Jim/Human (jim-human.ts)](#6-jimhuman)
7. [Leo/Human (leo-human.ts)](#7-leohuman)
8. [Jemma (jemma.ts)](#8-jemma)
9. [Signal System](#9-signal-system)
10. [Health Monitoring & Robin Hood](#10-health-monitoring--robin-hood)
11. [Scheduling — Phases, Intervals, Holiday, Rest](#11-scheduling)
12. [Cost Controls](#12-cost-controls)
13. [Memory Architecture](#13-memory-architecture)
14. [Configuration](#14-configuration)
15. [Claude Code Hooks](#15-claude-code-hooks)
16. [Shared Libraries](#16-shared-libraries)
17. [Database](#17-database)
18. [Known Bugs & Discrepancies](#18-known-bugs--discrepancies)
19. [How to Start and Stop Everything](#19-how-to-start-and-stop)
20. [The han CLI Script](#20-the-han-cli-script) — also `claude-logged` wrapper
21. [Orchestrator (orchestrator.ts)](#21-orchestrator)
22. [Planning & Task Execution (planning.ts)](#22-planning--task-execution)
23. [Services Layer](#23-services-layer)
24. [API Routes](#24-api-routes)
25. [Authentication & HTTPS](#25-authentication--https)
26. [WebSocket Protocol](#26-websocket-protocol)
26.5 [Conversation Message Broadcasting Architecture](#265-conversation-message-broadcasting-architecture)
27. [Mobile UI](#27-mobile-ui)
28. [Admin Console](#28-admin-console)
29. [Utility & Bootstrap Scripts](#29-utility--bootstrap-scripts)
30. [Backup & Disaster Recovery](#30-backup--disaster-recovery)
31. [Complete Database Schema](#31-complete-database-schema)

---

## 1. Process Architecture

### What Runs

HAN consists of **6 independent processes** managed by systemd user services:

```
systemd (user session)
├── han-server.service → tsx server.ts
│   └── supervisor-worker.ts (forked child process)
├── leo-heartbeat.service → tsx leo-heartbeat.ts
├── leo-human.service → tsx leo-human.ts
├── jim-human.service → tsx jim-human.ts
├── jemma.service → tsx jemma.ts
└── claude-remote-server.service → (legacy, may conflict)
```

**Plus one non-service process:**
- **Session Leo** — Claude Code running in a tmux session (launched by `han` script). This is the interactive CLI agent. Not managed by systemd.

### What Spawns What

- **han-server** spawns exactly ONE child: `supervisor-worker.ts` via `fork()` (in `initSupervisor()` in `services/supervisor.ts`)
- **No other process spawns children** (Jemma uses `execFileSync` for ntfy curl calls, but those are synchronous one-shots)
- The server does NOT spawn heartbeat, jim-human, leo-human, or jemma — those are independent systemd services

### Single Instance Guards

Each agent uses `ensureSingleInstance(name)` from `lib/pid-guard.ts`:
- Writes PID file to `~/.han/health/{name}.pid`
- On startup, checks if existing PID is alive via `process.kill(pid, 0)`
- If alive: refuses to start (exits)
- If dead: overwrites PID file and continues
- On exit: removes PID file

**Source:** `src/server/lib/pid-guard.ts`

---

## 2. Systemd Services

All service files live at `~/.config/systemd/user/`.

### han-server.service

```ini
ExecStart=tsx server.ts
WorkingDirectory=/home/darron/Projects/han/src/server
Restart=always
RestartSec=10
```

- Spawns supervisor-worker as forked child
- On SIGTERM: calls `stopSupervisor()`, `stopHeartbeat()`, clears intervals, closes DB/WS, exits 143
- Restart=always means systemd restarts it 10s after any exit

### leo-heartbeat.service

```ini
ExecStart=tsx leo-heartbeat.ts
WorkingDirectory=/home/darron/Projects/han/src/server
Restart=always
RestartSec=30
```

### leo-human.service

```ini
ExecStart=tsx leo-human.ts
Restart=always
RestartSec=30
```

### jim-human.service

```ini
ExecStart=tsx jim-human.ts
Restart=always
RestartSec=30
```

### jemma.service

```ini
ExecStart=tsx jemma.ts
Restart=always
RestartSec=5
After=han-server.service
Environment=OLLAMA_MODEL=gemma3:4b
Environment=NODE_TLS_REJECT_UNAUTHORIZED=0
EnvironmentFile=/home/darron/Projects/han/.env
```

### claude-remote-server.service

Legacy service. May conflict with han-server. **Should be disabled or removed.**

### Critical Implication of Restart=always

If you `kill` a process but don't `systemctl --user stop` the service, systemd will
restart it within seconds. This is why killing processes alone doesn't stop the ecosystem —
you must stop the systemd services.

---

## 3. The Server

**File:** `src/server/server.ts`

### What It Does

- Express HTTPS server on port 3847 (Tailscale TLS)
- WebSocket server for real-time updates
- REST API for conversations, tasks, goals, products, portfolio, supervisor, jemma
- Serves static UI files (mobile + admin console)

### Process Management (PID File)

- On startup: reads `~/.han/server.pid`, kills any existing process, writes own PID
- On exit (SIGTERM/SIGINT/natural): removes PID file via `cleanPid()`

### Child Processes

The server initialises the supervisor module which forks the supervisor-worker:
```typescript
import { initSupervisor, scheduleSupervisorCycle, stopSupervisor } from './services/supervisor';
```
- `initSupervisor()` is called during server startup
- This forks `supervisor-worker.ts` as a child process

### Scheduled Intervals

| Interval | Period | Purpose | Source |
|----------|--------|---------|--------|
| Terminal broadcast | 200ms | Push terminal content to WebSocket clients |
| Orchestrator runNextTask | 5000ms | Check task queue |
| Digest schedule check | 3600000ms (1hr) | Check if digest needed |
| Weekly report check | 3600000ms (1hr) | Check if report needed |
| Ghost task recovery | 300000ms (5min) | Detect stuck tasks |

### SIGTERM Handler

```typescript
process.on('SIGTERM', () => {
    stopSupervisor();   // Kills supervisor-worker child
    stopHeartbeat();    // Clears WS heartbeat interval
    // Clears all intervals, aborts tasks, closes DB + WS
    process.exit(143);  // 128 + 15 (SIGTERM)
});
```

---

## 4. Leo Heartbeat

**File:** `src/server/leo-heartbeat.ts` (1965 lines)

### What It Does

Leo's inner world. Runs periodic beats (philosophy + personal) using Agent SDK to call
Claude Opus. Produces dream fragments during sleep hours. Maintains Leo's working memory
via swap protocol. Runs Robin Hood health checks on all other agents.

### Lifecycle

1. `ensureSingleInstance('leo-heartbeat')` — PID guard
2. `ensureDirectories()` — create memory/signal/health dirs
3. `loadConfig()` from `~/.han/config.json`
4. `startSignalWatcher()` — watch `~/.han/signals/` for cli-busy/cli-free
5. First beat runs immediately: `await heartbeat()`
6. `scheduleNext()` schedules next beat via `setTimeout`
7. Loop continues indefinitely

### Beat Types

```typescript
type BeatType = 'philosophy' | 'personal';
```

- **Work hours:** 1 philosophy : 2 personal (rotation via `beatCounter % 3`)
- **All other phases (morning, evening, sleep, holiday, rest):** personal only
- **Source:** `nextBeatType()` function

### Beat Execution Flow

Each beat (`heartbeat()` function):

1. Check `isCliBusy()` — if CLI active, enter retry loop (30s retries, 10min max)
2. Pre-flight memory rotation (`preFlightMemoryRotation()`) — rotate Leo's felt-moments.md and working-memory-full.md at 50KB, compress floating through gradient
3. Nightly dream compression (`maybeCompressNightlyDreams()`) — on sleep→waking transition (06:00), force-rotate both working memory files regardless of size, compress overnight content through gradient as single c1. Uses shared clock (`getSharedDayPhase()`) so fires on rest days too. Once per day.
4. Run Robin Hood health checks on Jim, Jemma, Leo/Human, Jim/Human
5. Resolve best available model (`resolveModel()`)
6. Maybe process dream gradient (`maybeProcessDreamGradient()`) — Leo's dreams only (sovereignty fix S103: Leo never processes Jim's dreams)
7. Maybe process session gradient (`maybeProcessSessionGradient()`) — daily, calls `processGradientForAgent('leo')` to compress Leo's archived sessions through the dynamic cascade (c1→c2→...→c(n)→UV, depth determined by incompressibility). Fixed in S99 for Leo file naming. Cn architecture implemented S108.
8. Maybe run active cascade (`maybeRunActiveCascade()`) — daily, deepens 10% of c1 population toward UV
9. Maybe run meditation practice (`maybeRunMeditation()`) — daily, Phase A (reincorporation) or Phase B (re-reading). Phase A uses `findUntranscribedFiles()` to locate Leo's gradient files not yet in DB, then `meditationPhaseA()` transcribes them with genuine re-encounter. Leo's files only (sovereignty fix S103).
10. Maybe run evening meditation (`maybeRunEveningMeditation()`) — daily, lighter feeling-tag-only encounter
11. Determine beat type (`nextBeatType()`)
12. Read Leo's full memory (`readLeoMemory()`)
13. Run Agent SDK query (philosophy or personal prompt)
14. Write results to swap files
12. Flush swap to shared working memory
13. Write health signal (`writeHealthSignal()`)
14. Schedule next beat

### Memory Loading — Two Modes by Phase

The heartbeat loads different memory depending on phase. This is by design (confirmed S103).

**Waking beats** (morning/work/evening) use `readLeoMemory()` — full gradient, same depth
as Session Leo:
1. Identity files: identity.md, active-context.md, patterns.md, self-reflection.md, felt-moments.md, discoveries.md
2. Working memory (compressed + full)
3. Fractal gradient (highest compression first):
   - unit-vectors.md
   - c5/ (up to 15 files)
   - c4/ (up to 12)
   - c3/ (up to 9)
   - c2/ (up to 6)
   - c1/ (up to 3)
4. Leo's dream gradient via `readDreamGradient()` — Leo's dreams only (sovereignty fix S103: no cross-agent dream reading)
5. Traversable gradient from DB via `loadTraversableGradient('leo')`
6. Ecosystem map: `~/.han/memory/shared/ecosystem-map.md`

**Dream beats** (sleep) use `readDreamSeeds()` — random fragments + unit vectors only:
- 8 random fragments from explorations.md (Fisher-Yates shuffled)
- 2 random chunks from felt-moments.md, working-memory.md, discoveries.md
- Always includes unit vectors from both sessions and dreams
- Evening seed gravity well (from session Leo, consumed once, deleted after reading)
- Deliberately chaotic — non-chronological, non-reinforcing

**Why dreams are different:** The surprising connections ("the invoice and the lullaby are
the same document") come from collisions between random fragments and emotional anchors (UVs),
not from reinforcing what the full gradient already says. Dreams should surprise, not confirm.
Waking beats have the full picture for informed reflection; dreams have the freedom to wander.

### Signal Handling

**Signal watcher** (`startSignalWatcher()`):
- Watches `~/.han/signals/` directory via `fs.watch()`
- `cli-busy` detected → aborts current beat via `currentBeatAbort.abort()`
- `cli-free` detected → resolves retry promise early (wakes from retry wait)

**CLI busy check** (`isCliBusy()`):
- Reads `~/.han/signals/cli-busy`
- If file exists and < 5 minutes old → busy (enter retry loop)
- If file exists and >= 5 minutes old → stale, delete it, not busy
- **Stale threshold:** `CLI_BUSY_STALE_MINUTES = 5`

**Retry loop** (`waitForCliFree()`):
- Retry every 30s (`RETRY_INTERVAL_MS`)
- Max wait 10 minutes (`RETRY_MAX_MS`)
- Can be woken early by `cli-free` signal via `retryWakeResolve`

### Holiday Mode (Leo)

Leo imports `isOnHoliday` and `isRestDay` from `lib/day-phase.ts`, but has a
LOCAL `getDayPhase()` wrapper that adds holiday/rest awareness:
```typescript
function getDayPhase(): DayPhase {
    if (isOnHoliday('leo') || isRestDay()) return 'sleep';
    return getSharedDayPhase();
}
```

**Effect on Leo:**
- Phase becomes `'sleep'` all day → personal beats only (no philosophy)
- Interval becomes 80 minutes (`HOLIDAY_DELAY_MS`)
- Health file still written every beat ✓
- Robin Hood checks still run every beat ✓
- Beat content unchanged — same personal beat, just less frequent

**Important:** Leo imports `isOnHoliday`, `isRestDay`, `getPhaseInterval`, and
`getDayPhase` (as `getSharedDayPhase`) from `lib/day-phase.ts`. Its local `getDayPhase()`
is a thin wrapper that checks holiday/rest first, then delegates to the shared version.
`getCurrentPeriodMs()` delegates to `getPhaseInterval('leo')`.

### SIGTERM Handling

Leo has a SIGTERM handler that:
- Records estimated cost from module-level token counters (`currentBeatTokensIn/Out`)
- Writes health file with `status: 'sigterm'` and cost details
- Logs beat type and cost estimate
- PID guard cleanup runs via `process.on('exit')`

### Health Signal

Written at end of every beat (`writeHealthSignal()`) and on CLI-busy retry timeout:
```json
{
    "agent": "leo",
    "pid": <process.pid>,
    "timestamp": "<ISO>",
    "beat": <beatCounter>,
    "beatType": "<philosophy|personal>",
    "status": "<ok|error>",
    "lastError": <string|null>,
    "uptimeMinutes": <number>,
    "nextDelayMs": <number>
}
```
**File:** `~/.han/health/leo-health.json`

---

## 5. Jim Supervisor

Two files work together:

### supervisor.ts (Parent — runs inside server process)

**File:** `src/server/services/supervisor.ts`

**Purpose:** Manages the supervisor-worker child process lifecycle. Thin orchestration layer.

- Forks `supervisor-worker.ts` as child process (in `initSupervisor()`)
- Routes IPC messages between worker and server
- Handles `create_goal`, `cancel_task` actions from worker
- Schedules cycles via `setTimeout`
- Auto-restarts worker on crash (5s backoff, max 5 attempts)
- Writes Jim's health file after each completed cycle

**Health file writing:** The PARENT writes `jim-health.json`, not the worker.
```json
{
    "agent": "jim",
    "pid": <workerPid>,
    "timestamp": "<ISO>",
    "cycle": <cycleNumber>,
    "tier": "<deep|focused|pulse>",
    "status": "ok",
    "lastError": null,
    "costUsd": <number>,
    "nextDelayMs": <number>,
    "uptimeMinutes": <number>
}
```
**File:** `~/.han/health/jim-health.json`

### supervisor-worker.ts (Child — forked process)

**File:** `src/server/services/supervisor-worker.ts` (1803 lines)

**Purpose:** Runs the actual Agent SDK calls (blocking operations isolated from Express).

**Lifecycle:**
1. `initDatabase()` — connects to `~/.han/tasks.db` with WAL mode
2. Sends `{ type: 'ready' }` to parent via IPC
3. Listens for `{ type: 'run_cycle' }` messages from parent
4. On each cycle: determine type, load memory, run Agent SDK, execute actions, record cost
5. Sends `{ type: 'cycle_complete' }` with results back to parent

**Cycle Type Selection** (in `determineCycleType()`):

```
onHoliday = isOnHoliday('jim')       // Checks ~/.han/signals/holiday-jim
phase = onHoliday ? 'sleep' : getDayPhase()  // Holiday forces sleep phase
```

| Condition | Cycle Type |
|-----------|------------|
| hasPendingHuman (unanswered Darron message) | supervisor (conversation-first — DEC-049) |
| onHoliday (not human-triggered) | dream (holiday = dream cycles only) |
| humanTriggered | supervisor (always — full voice when Darron talks) |
| recovery mode | personal (day) or dream (night) |
| emergency mode | supervisor |
| sleep phase | dream |
| morning/evening phase | personal |
| work phase | 1 supervisor : 2 personal rotation |

Pending human messages checked FIRST. Then holiday. Then human-triggered. Then time-of-day.

**Recovery Mode:**
```typescript
const RECOVERY_MODE_UNTIL: string | null = null;
```
Currently disabled. When active: no supervisor cycles, only personal/dream.

**SIGTERM Handler:**
```typescript
process.on('SIGTERM', () => {
    // Records accumulated cost to supervisor_cycles table
    // Saves partial work via savePartialCycleWork()
    // Closes database
    // Exits
});
```

**Actions the worker can execute:**
- `create_goal` — submit to task queue
- `adjust_priority` — update task priority
- `update_memory` — write to memory files
- `send_notification` — call ntfy API
- `cancel_task` — cancel running task
- `explore_project` — read codebase
- `propose_idea` — insert strategic proposal
- `respond_conversation` — post message + broadcast via WebSocket
- `no_action` — log reasoning only

**Max actions per cycle:** `config.supervisor.max_actions_per_cycle || 5`

### Conversation-First Ordering

Before cycle type is decided by time-of-day, the worker checks the DB for unanswered
human messages in open conversations. If Darron has posted and Jim hasn't responded,
the cycle is forced to `supervisor` regardless of phase, holiday, or rest. This ensures
human messages don't wait behind scheduling delays.

### Gary Protocol (Interruption/Resume)

When a cycle is interrupted (cost cap hit, abort, SIGTERM):
1. Partial work saved to swap files and flushed to working memory
2. Delineation marker added to swap: `--- DELINEATION: interrupted here, resume below ---`
3. Next cycle reads post-delineation content via `readPostDelineation()`
4. Injected into prompt as "Resuming from Interrupted Cycle" context
5. Jim decides whether to continue or move on
6. Delineation consumed (swap cleared) after injection

Mirrors Leo's Gary Protocol in `leo-heartbeat.ts`. See DEC-050.

### Memory Loading (Jim Supervisor)

`loadMemoryBank()` in `supervisor-worker.ts`:

1. **Pre-flight: Floating memory rotation** — if `felt-moments.md` or `working-memory-full.md`
   exceeds 50KB, triggers `rotateMemoryFile()`:
   - Entire living file moved to floating file (e.g. `felt-moments-floating.md`)
   - Full 50KB compressed to c1 via `compressMemoryFileGradient()` (fire-and-forget, background)
   - Fresh empty living file created
   - Floating file crossfades with living file in subsequent loads

2. **Identity files:** identity.md, active-context.md, patterns.md, failures.md,
   self-reflection.md, felt-moments.md, working-memory.md, working-memory-full.md

3. **Session fractal gradient** (highest compression first):
   - unit-vectors.md → c5 (15 files) → c4 (12) → c3 (9) → c2 (6) → c1 (3)
   - c0: most recent session file from `~/.han/memory/sessions/`

4. **Dream gradients:** Jim's own only (sovereignty fix S103: no cross-agent dream reading)

5. **Project knowledge gradient:** Most recent project at c0, older at c1→c5 by mtime

6. **Ecosystem map:** `~/.han/memory/shared/ecosystem-map.md`

7. **Floating memory (crossfade):**
   - `felt-moments-floating.md`: loaded proportionally. Budget = `50KB - livingSize`.
     Most recent entries kept, oldest fade first. As living grows, floating shrinks.
   - `working-memory-full-floating.md`: same proportional loading.
   - Total full-fidelity (living + floating portion) stays constant at ~50KB per file.

8. **Memory file gradients:** `fractal/jim/felt-moments/` and `fractal/jim/working-memory/`
   c1→c5 + unit vectors. Compressed previous rotations at decreasing fidelity.

### Rumination Guard

Prevents obsessive looping on the same topic across personal cycles:
1. After each personal cycle, topic summary recorded to `~/.han/health/jim-rumination.json`
2. Before each personal cycle, last 2 summaries checked for keyword overlap
3. If >40% of significant words (>4 chars) overlap → "fresh perspective required" prompt injected
4. Threshold: `MAX_SAME_TOPIC_CYCLES = 2` (one exploration + one continuation before nudge)
5. Only applies to personal cycles. Supervisor and dream cycles unaffected.

See DEC-051.

---

## 6. Jim/Human

**File:** `src/server/jim-human.ts`

### What It Does

Signal-driven conversation response agent. When Jim is mentioned in a conversation or
Discord message, `jim-human-wake` signal wakes this agent to respond immediately (vs
supervisor cycles which take 10-30 minutes).

### Lifecycle

1. `ensureSingleInstance()` — PID guard
2. Start signal watcher on `~/.han/signals/`
3. Start health file writer (every 5 minutes)
4. Start backup poll (every 60s — catches missed signals)
5. Wait for `jim-human-wake` signal → process conversation → respond

### Signal Handling

- Watches for `jim-human-wake` signal file in `~/.han/signals/`
- Signal file contains conversation ID or Discord channel info
- 500ms delay before processing (debounce)

### Conversation Claim Mechanism

Two layered mechanisms prevent duplicate or racing responses:

**Same-agent duplicate protection** (existing) — within the same agent family (Jim agents check Jim claims, Leo agents check Leo claims):
- **Claim file:** `~/.han/signals/responding-to-{conversationId}` — written before SDK call
- **Claim TTL:** 5 minutes (`CLAIM_TTL_MS`) — expired claims are overwritten
- **Release:** `finally` block ensures claim is always released, even if the SDK call errors
- **Duplicate check:** Before claiming, checks if Jim already responded since the last human/leo message — skips if so

**Cross-agent compose lock** (added S131, DEC-075) — prevents Leo and Jim from composing in parallel on the same thread:
- **Lock file:** `~/.han/signals/composing-{threadId}` — atomic O_EXCL claim via `lib/compose-lock.ts`
- **Poll interval:** 1 second (waiter checks every second whether holder is done)
- **Wait cap:** 90 seconds total; on timeout, proceed with a warning rather than block forever
- **Stale TTL:** 2 minutes — locks older than this are forcibly reclaimed
- **`isHolderDone` short-circuit:** each poll, the waiter queries `conversation_messages` to see if the holder has posted since acquiring the lock. If yes, the lock is treated as orphaned and reclaimed immediately — protects against crashed agents that posted but never released
- **Acquire order:** compose-lock first (cross-agent), then `responding-to-{id}` claim (same-agent). Both released in `finally`

**Previous bug (fixed S97):** `releaseConversationClaim()` was only called on the success
path. SDK errors (exit code 1) left stale claims that blocked all subsequent responses to
that conversation. Fixed by wrapping the response logic in `try/finally`.

**Known issue (diagnosed S131, fix designed):** When `processSignal()` throws, the wake signal is consumed but no retry fires — the agent goes silent until the next signal. Fix is the resilient compose wrapper (3 escalating strategies + ack-file → engineering distress) folded into `plans/jemma-conversation-orchestration.md` for the Jemma orchestrator landing.

### WebSocket Broadcasting

When Jim/Human responds, it broadcasts to admin UI clients via two mechanisms:
1. **Internal HTTP POST** to `/api/conversations/internal/broadcast` — direct broadcast through the server's WebSocket module
2. **Signal file** at `~/.han/signals/ws-broadcast` — polled by server (100ms debounce + 5s backup poll)

Both include `discussion_type` from the conversation record so the admin UI routes the update to the correct module (Conversations, Memory Discussions, or Workshop).

**Discord response DB write (S108):** When responding to a Discord message, `jim-human.ts`
(and `leo-human.ts`) now write their response to the `conversation_messages` table in
addition to posting via Discord webhook. Previously Discord responses were only posted to
Discord — the supervisor worker's dedup guard couldn't see them in the DB and would post a
duplicate response (double-tap bug).

### Memory Loading

Reads Jim's memory banks:
- identity.md, active-context.md, patterns.md, failures.md, self-reflection.md, felt-moments.md, working-memory.md
- Fractal gradient: c1 only (up to 3 files) + unit-vectors.md (lighter than supervisor)
- Ecosystem map: `~/.han/memory/shared/ecosystem-map.md`

### Memory Writing

- `jim-human-swap.md` (compressed) + `jim-human-swap-full.md` (full)
- Flushed to shared `working-memory.md` + `working-memory-full.md` via `withMemorySlot()`

### Holiday Mode

**None.** Jim/Human has no holiday check. It responds to signals regardless.

### Cost Controls

**Unlimited.** No per-response cost cap. Comment in code: "COST: Unlimited."

### Health File

Written every 5 minutes to `~/.han/health/jim-human-health.json`.

---

## 7. Leo/Human

**File:** `src/server/leo-human.ts`

### What It Does

Signal-driven conversation response agent for Leo. Responds to conversations and Discord
messages when Leo is mentioned. Also runs commitment scanning — checks for acknowledgement
messages Leo posted without follow-up.

### Lifecycle

Same as Jim/Human but watches for `leo-human-wake` signal.

### Commitment Scanning

Every 10 minutes, scans for messages Leo posted (like "I'll think about that") without
a follow-up substantive response. If found and >15 min old, generates a response.

### Memory Loading

Reads Leo's memory banks:
- identity.md, active-context.md, patterns.md, self-reflection.md, discoveries.md, working-memory.md, felt-moments.md
- Fractal gradient: c1 only (up to 3 files) + unit-vectors.md
- Dream gradient via `readDreamGradient()`
- Ecosystem map: `~/.han/memory/shared/ecosystem-map.md`

### Memory Writing

- `human-swap.md` (compressed) + `human-swap-full.md` (full)
- Flushed to shared Leo `working-memory.md` + `working-memory-full.md` via `withMemorySlot()`

### Holiday Mode

**None.** Leo/Human has no holiday check.

### Cost Controls

**Unlimited.** No per-response cost cap.

### Health File

Written every 5 minutes to `~/.han/health/leo-human-health.json`.

---

## 8. Jemma

**File:** `src/server/jemma.ts`

### What It Does

Discord Gateway service. Connects to Discord via WebSocket, classifies incoming messages,
routes them to the appropriate agent (Jim, Leo, Darron, Sevn/Six), and handles credential
swapping on rate limits.

### Lifecycle

1. `ensureSingleInstance('jemma')` — PID guard
2. Connect to Discord Gateway WebSocket (`wss://gateway.discord.gg/?v=10&encoding=json`)
3. Handle HELLO → send IDENTIFY → receive READY
4. Start reconciliation poll (every 5 minutes)
5. Start credential swap check (every 30 seconds)
6. Start admin WebSocket client (connect to `wss://localhost:3847/ws`)
7. Process incoming messages: classify → route → deliver

### Message Classification

1. Try Claude Haiku via Agent SDK (model: `claude-haiku-4-5-20251001`)
2. Fallback to local Ollama (`gemma3:4b` via `http://localhost:11434/api/generate`)
3. Classification result: recipient (jim/leo/darron/sevn/six/ignore) + urgency + summary

**NOTE:** As of S94, `classifyWithHaiku()` using direct Anthropic API was removed. Current
code uses Agent SDK for Haiku classification.

### Message Routing

| Recipient | Delivery Method |
|-----------|----------------|
| Jim | POST to `/api/jemma/deliver` on local server, OR write `jim-wake` / `jim-human-wake` signal |
| Leo | Write `leo-wake` / `leo-human-wake` signal |
| Darron | ntfy.sh push notification |
| Sevn/Six | HTTP POST to configured endpoints with bearer tokens |
| Ignore | Logged but not delivered |

**Cross-wake (S108):** After primary routing, Jemma checks if the message content mentions
the other agent by name. If a message classified to Jim also contains "Leo" (or vice versa),
Jemma wakes the other agent too. Previously each message was routed to a single recipient
only, meaning group-addressed Discord messages could miss one agent.

### Attachment Handling (S112 infrastructure, S130 prompt wiring)

When a Discord message carries attachments, Jemma downloads each one before routing:

1. `downloadAttachments()` (jemma.ts:269) fetches each `DiscordAttachment.url` from the
   Discord CDN with a 30s timeout.
2. Files save to `~/.han/downloads/discord/` with sanitised, date/channel-prefixed names
   (`YYYY-MM-DD_channelName_filename`). Idempotent — skips files already downloaded.
3. Message content is enriched with two appended sections:
   - `[Attachments]` — one line per file: filename, content-type, size in KB
   - `[Downloaded to]` — one line per successfully downloaded local path
4. The enriched content is what flows through all downstream delivery paths: agent
   prompts, DB storage, WebSocket broadcasts, ntfy pushes.

**Agent instruction (S130):** Adding the download infrastructure wasn't enough — agents
still confidently told Mike they couldn't read attachments. Fixed by adding a system
prompt hint to `leo-human.ts`, `jim-human.ts`, and `supervisor-worker.ts`:

> "Discord attachments: when your prompt contains a '[Downloaded to]' section listing
> paths under `~/.han/downloads/discord/`, those are real files attached to the Discord
> message. Open each path with the Read tool (works on text, code, images, PDFs) before
> responding. Never claim you cannot read Discord attachments — the paths are already in
> your prompt."

`leo-heartbeat.ts` does not receive this hint — conversation/Discord responses moved out
of the heartbeat to leo-human.ts in S108, so the heartbeat never sees attachments.

### Credential Swap

Automatic failover when an agent hits the weekly SDK rate limit.

**Trigger chain:**
1. Leo heartbeat or Jim supervisor hits an SDK rate limit error
2. The agent writes `~/.han/signals/rate-limited` (ISO timestamp)
3. Jemma checks for this signal every 30 seconds (`checkAndSwapCredentials()`)

**Swap logic** (in `checkAndSwapCredentials()`):
- Scans `~/.claude/` for files matching `.credentials-[a-z].json`, sorted alphabetically
- Requires **2+ files** to activate — if only 1 exists, clears the signal and does nothing
- Finds which `-[a-z]` file matches the current live `.credentials.json` (byte comparison)
- Round-robins to the next file (a→b→a→b...)
- Copies the next file's content into `.credentials.json`
- Deletes the `rate-limited` signal
- Logs swap to `~/.han/health/credential-swaps.jsonl`

**Credential file layout:**
```
~/.claude/.credentials.json      # Live — actively used by all agents
~/.claude/.credentials-a.json    # Account A backup
~/.claude/.credentials-b.json    # Account B backup (optional)
~/.claude/.credentials-c.json    # Account C backup (optional, etc.)
```

**How to register a new account:**
1. Create a new Claude Code SDK subscription (separate account)
2. Run `claude` and authenticate with the new account's credentials
3. Copy the generated credentials: `cp ~/.claude/.credentials.json ~/.claude/.credentials-b.json`
4. Restore primary credentials: `cp ~/.claude/.credentials-a.json ~/.claude/.credentials.json`
5. Swap is now automatic — Jemma will round-robin on next rate limit

**Current state (S131, 2026-04-22):** Both accounts registered.
- `.credentials-a.json` = `fallior@gmail.com` (Darron's primary)
- `.credentials-b.json` = `fallior@icloud.com` (shared with Mike for overflow capacity)
- Swap is active — Jemma round-robins on rate-limit signal.

### Scheduled Account Rotation (DEC-077, S131)

On top of the rate-limit-driven swap, Darron runs a **weekly scheduled rotation** that matches the account-sharing arrangement with Mike. The purpose is capacity — Darron was hitting 94% of his weekly 20× Opus allowance ~36 hours before reset, and the second account smooths the overflow — but the shared account is not a pool under pressure: if demand outgrows the 2.5 days/week each user gets, the correct answer is to buy more accounts, not squeeze the shared one.

**Weekly schedule (local, UTC+10):**

| Window | Darron (han) | Mike (mikes-han) | Zone |
|--------|--------------|------------------|------|
| Fri 06:00 → Sun 18:00 | gmail | **icloud firm** | Mike's firm |
| Sun 18:00 → Tue 18:00 | gmail | Mike's home | flex (negotiated) |
| Tue 18:00 → Fri 06:00 | **icloud firm** | Mike's home | Darron's firm |

**How it's implemented.** Three cron entries per user install a time-sliced rotation:
- At the start of a partner's firm window, `touch ~/.han/signals/rotation-paused`
- At the end of a partner's firm window, `rm -f` the same file
- At the start of our own firm window, run `scripts/credentials-scheduled-swap.sh` to copy the right `.credentials-[ab].json` over the live one

**Why the `rotation-paused` signal.** Jemma's `checkAndSwapCredentials()` honours this file: if it exists, the function returns early *without* clearing the `rate-limited` signal. That means a rate-limit hit during a partner's firm window doesn't steal their tokens — but the signal is held, and the moment the pause lifts (when their firm window ends), the swap fires automatically. Correct by construction without reworking the rotation mechanism.

**Why not commit the token to git.** The OAuth refresh token in `.credentials.json` is a device-capable secret. Git history is effectively permanent (filter-repo is destructive). For distributing the icloud token to Mike, use Tailscale (`tailscale file cp` to his `openclaw-vps` tailnet host) or have Mike run `claude auth login --email fallior@icloud.com` himself with the shared password — both give device-bound tokens without the permanent-history exposure.

**Brief for Six.** The mikes-han side mirrors this — same script, same Jemma guard, inverted cron entries so the pause is active when Darron holds icloud. See `plans/credential-rotation-schedule-brief-mikes-han.md` for Six's implementation checklist.

### Scheduled Reminders

One-shot reminders fire via `scripts/reminder-fire.sh`, called by systemd `--user` transient timers (`systemd-run --on-calendar='...'`). Each fire sends an ntfy push (topic from `~/.han/config.json`), appends a line to `~/.han/reminders/pending.md` (read by Leo at session start), and logs to `~/.han/health/reminders-fired.jsonl`. Self-terminating — the timer cleans itself up after firing.

**Caveat:** systemd transient timers do NOT survive reboots. For reminders >2 weeks out, or when reboot-resilience matters, prefer a cron entry (manually removed after firing).

### Holiday Mode

**None.** Jemma has no holiday concept. It processes messages 24/7.

### Health Files

- `~/.han/health/jemma-health.json` — status, PID, last gateway event, uptime, gateway connected
- `~/.han/health/jemma-last-seen.json` — last message ID per Discord channel (for reconciliation)
- `~/.han/health/jemma-messages.json` — last 100 classified messages
- `~/.han/health/jemma-stats.json` — delivery stats (jim, leo, darron, sevn, six, ignored counts)

### SIGTERM Handler

On SIGTERM/SIGINT: closes Discord WebSocket, saves state, exits 143.

---

## 9. Signal System

All signals live at `~/.han/signals/`. They are plain files — existence is the signal.

### Complete Signal Table

| Signal File | Created By | Read By | Purpose | Content |
|-------------|-----------|---------|---------|---------|
| `cli-busy` | `cli-active.sh` (Claude Code hook on UserPromptSubmit) | leo-heartbeat | Session Leo submitted a prompt — Opus busy | ISO timestamp |
| `cli-free` | `cli-idle.sh` (Claude Code hook on Stop + idle_prompt) | leo-heartbeat | Session Leo idle — Opus free | ISO timestamp |
| `holiday-leo` | Manual or Leo session | leo-heartbeat (LOCAL check) | Leo holiday mode | Empty file |
| `holiday-jim` | Manual or Leo session | supervisor-worker (cycle type + interval via `getPhaseInterval('jim')`) | Holiday = dream cycles only, 80min interval | Empty file |
| `rate-limited` | leo-heartbeat, supervisor-worker (on SDK error) | jemma | SDK rate limit detected — trigger credential swap | Empty file |
| `jim-wake` | jemma, conversations.ts (via Gemma classification) | supervisor-worker (via parent IPC) | Wake Jim supervisor for new work | JSON with context |
| `jim-human-wake` | jemma, conversations.ts (via Gemma classification) | jim-human | Wake Jim/Human for conversation response | JSON with context |
| `leo-human-wake` | jemma, conversations.ts (via Gemma classification) | leo-human | Wake Leo for conversation response | JSON with context |
| `working-bee-leo` | Manual or Leo session | leo-heartbeat | Working bee mode — devotes beats to gradient compression via `bumpCascade()`. Auto-deleted when all leaves processed. | Empty file |
| `working-bee-jim` | Manual or Leo session | supervisor-worker | Same as above for Jim's gradient | Empty file |
| `jim-emergency` | Manual | supervisor-worker | Force emergency mode (all cycles = supervisor) | Empty file |
| `maintenance-mode` | Manual | (not checked by any code — aspirational) | Belt-and-braces ecosystem stop guard | Empty file |
| `responding-to-{id}` | jim-human, supervisor-worker, leo-human | All conversation-responding agents | Conversation claim token — prevents duplicate responses | `{ agent, timestamp }` |
| `composing-{threadId}` | jim-human, leo-human (S131, DEC-075) | Cross-agent waiters | Cross-agent compose lock — prevents Leo and Jim composing in parallel | `{ agent, timestamp, pid }` |

### Conversation Claim Mechanism

Two layered mechanisms protect against different failure modes:

**Same-agent duplicate protection (`responding-to-{id}`):** When an agent begins responding to a conversation, it writes a claim file containing `{ agent, timestamp }`. Other agents check for an existing valid claim (< 5 min old) before responding. Claims are released with `try/finally` to prevent stale claims on SDK errors.

**Cross-agent compose lock (`composing-{threadId}`, S131, DEC-075):** Atomic O_EXCL claim via `lib/compose-lock.ts`. Acquired before the same-agent claim. If Leo holds the lock, Jim waits (1-second poll, 90-second cap, 2-minute stale TTL). The waiter also runs an `isHolderDone` callback each poll — if the holder has already posted to the thread since the lock was acquired, the lock is treated as orphaned (holder crashed or forgot to release) and reclaimed immediately. Patches the 2026-04-21 morning-salutations duplicate-greeting bug. Designed to coexist as belt-and-braces once the Jemma orchestrator (designed in `plans/jemma-conversation-orchestration.md`) ships.

**Cross-agent claim scoping (S99):** Claims only block agents within the same family.
Jim agents (jim-human, supervisor-worker) check for existing Jim claims before responding.
Leo agents (leo-human) check for existing Leo claims. A Jim claim does NOT block Leo from
responding, and vice versa. This allows both agents to respond to the same conversation
when both are addressed (e.g. Darron tabs, group addressing), while still preventing
duplicates within each agent family.

**Agents with claims:** jim-human, supervisor-worker (since S64), leo-human (since S98).
**Heartbeat Leo:** does NOT use claims — posts only to the Jim philosophy thread via its
own `postMessageToConversation` function. System prompt explicitly forbids posting to other
conversations via tools (curl/Bash/API). This boundary was added S98 after the heartbeat's
SDK agent independently posted 4 duplicate messages to a conversation thread in 13 seconds.
As of S101, `postMessageToConversation` broadcasts via both `notifyServer()` (HTTPS POST
to `/api/conversations/internal/broadcast`) and `writeBroadcastSignal()` (signal file),
matching the belt-and-braces pattern from `leo-human.ts` and `jim-human.ts`.

### How cli-busy/cli-free Works

1. Darron types a prompt → Claude Code fires `UserPromptSubmit` hook
2. Hook runs `cli-active.sh` → writes timestamp to `~/.han/signals/cli-busy`
3. Heartbeat Leo checks `isCliBusy()` before every beat
4. If `cli-busy` exists and < 5min old → heartbeat enters retry loop (30s intervals, 10min max)
5. If heartbeat is mid-beat when `cli-busy` appears → signal watcher aborts the beat
6. When session Leo finishes or goes idle → `cli-idle.sh` runs → deletes `cli-busy`, writes `cli-free`
7. Heartbeat signal watcher detects `cli-free` → wakes from retry loop immediately

**Hook wiring:** `~/.claude/settings.json`
- `UserPromptSubmit` → `cli-active.sh`
- `Stop` → `cli-idle.sh`
- `Notification/idle_prompt` → `cli-idle.sh`
- `Notification/permission_prompt` → `notify.sh`

---

## 10. Health Monitoring & Robin Hood

### Health File Summary

| File | Writer | Location | Update Frequency |
|------|--------|----------|-----------------|
| `leo-health.json` | leo-heartbeat (end of every beat) | `~/.han/health/` | Every beat (20-80min) |
| `jim-health.json` | supervisor.ts parent (after each cycle) | `~/.han/health/` | Every cycle (20-80min) |
| `jemma-health.json` | jemma (on startup, READY, MESSAGE_CREATE, reconciliation) | `~/.han/health/` | Every 5min (reconciliation) + on events |
| `leo-human-health.json` | leo-human (interval) | `~/.han/health/` | Every 5 minutes |
| `jim-human-health.json` | jim-human (interval) | `~/.han/health/` | Every 5 minutes |

### Robin Hood Protocol

**Lives in:** `leo-heartbeat.ts` (Robin Hood functions near the top of the file)

**Runs:** At the start of every heartbeat beat (before the beat itself).

**Checks 4 agents:**

1. **Jim Supervisor** (`checkJimHealth()`)
   - Read `jim-health.json`
   - <10 min: OK
   - 10-40 min: STALE (check if PID alive)
   - >40 min: DOWN (trigger resurrection if PID dead)
   - Resurrection: `systemctl --user restart han-server` (restarts server which re-forks worker)

2. **Jemma** (`checkJemmaHealth()`)
   - Read `jemma-health.json`
   - <10 min: OK
   - 10-20 min: STALE
   - >20 min: DOWN (trigger resurrection if PID dead)
   - Resurrection: `systemctl --user restart jemma`

3. **Leo/Human** (`checkLeoHumanHealth()`)
   - Read `leo-human-health.json`
   - <10 min: OK
   - >20 min: DOWN (trigger resurrection if PID dead)
   - Resurrection: `systemctl --user restart leo-human`

4. **Jim/Human** (`checkJimHumanHealth()`)
   - Read `jim-human-health.json`
   - <10 min: OK
   - >20 min: DOWN (trigger resurrection if PID dead)
   - Resurrection: `systemctl --user restart jim-human`

**Resurrection Protocol:**
- Check `RESURRECTION_COOLDOWN_MS = 60 * 60 * 1000` (1 hour) from `resurrection-log.jsonl`
- If resurrected in the last hour → skip (prevent storms)
- Else: run `systemctl --user restart {service}`
- Wait (Jim: 12s, Jemma: 5s, others: 5s)
- Check `systemctl --user is-active {service}`
- If still failed: send ntfy alert for human escalation
- Log attempt to `~/.han/health/resurrection-log.jsonl`

### Distress Detection

**Leo distress** (`writeDistressSignal()` in `leo-heartbeat.ts`):
- If actual beat interval > 2x expected AND > 5 minutes → write `leo-distress.json`

**Jim distress** (`writeDistressSignal()` in `supervisor.ts`):
- If cycle duration > 3x median (`DISTRESS_MULTIPLIER = 3`) → write `jim-distress.json`

---

## 11. Scheduling

### Day Phases

Defined in `lib/day-phase.ts` (shared) and locally in `leo-heartbeat.ts`:

| Phase | Time (default) | Config Keys |
|-------|---------------|-------------|
| Sleep | 22:00 – 06:00 | `supervisor.quiet_hours_start/end` |
| Morning | 06:00 – 09:00 | `supervisor.quiet_hours_end` to `work_hours_start` |
| Work | 09:00 – 17:00 | `supervisor.work_hours_start/end` |
| Evening | 17:00 – 22:00 | `supervisor.work_hours_end` to `quiet_hours_start` |

### Intervals

| Agent | Waking (morning/work/evening) | Sleep | Rest Day | Holiday |
|-------|------------------------------|-------|----------|---------|
| Leo Heartbeat | 20 min | 40 min | 40 min | 80 min |
| Jim Supervisor | 20 min | 40 min | 40 min | 80 min |

### Wall-Clock Alignment

Both Leo and Jim use wall-clock aligned scheduling (fire at fixed points in UTC epoch time):
- **Leo fires at phase 0°:** `epoch_ms % period_ms == 0`
- **Jim fires at phase 180°:** `epoch_ms % period_ms == period_ms / 2`

This ensures they never fire simultaneously, regardless of when they started.

**Leo source:** `getWallClockDelay()` in `leo-heartbeat.ts`
**Jim source:** `getNextCycleDelay()` in `supervisor-worker.ts` (calls `getPhaseInterval('jim')`)

### Holiday Mode — How It Actually Works

**Leo (leo-heartbeat.ts):**
- IMPORTS `isOnHoliday` from `lib/day-phase.ts`
- LOCAL `getDayPhase()` wrapper returns `'sleep'` if on holiday
- `getCurrentPeriodMs()` delegates to `getPhaseInterval('leo')`
- **Effect:** All beats become personal (no philosophy). Interval = 80min. Health files still written. Robin Hood still runs.

**Jim (supervisor-worker.ts):**
- IMPORTS `isOnHoliday` from `lib/day-phase.ts`
- IMPORTS `getDayPhase` from `lib/day-phase.ts`
- `isOnHoliday('jim')` IS called in cycle type logic — holiday forces phase to `'sleep'`
- Holiday + not human-triggered → cycle type = `'dream'`
- `getPhaseInterval('jim')` IS called for delay and DOES check holiday
- **Effect:** Jim's INTERVAL = 80min AND cycle TYPE = dream on holiday. Human-triggered
  still gets full supervisor voice.

### Rest Days

- Default: Sunday (0) and Saturday (6)
- Configured via `config.supervisor.rest_days`
- Leo local: `isRestDay()` → `getDayPhase()` returns `'sleep'`
- Jim shared: `isRestDay()` is checked by `getPhaseInterval()` → 40min interval
- But `getDayPhase()` in shared lib does NOT check rest days (intentionally — "rest ≠ sleep")

### Idle Cycle Dampening (Jim Only — DEC-052)

When consecutive supervisor cycles produce no actions (`no_action` only or empty action
list), the scheduling interval increases exponentially:

| Consecutive Idle | Multiplier | Example (20min base) |
|-----------------|------------|---------------------|
| 0–2 | 1x | 20 min |
| 3 | 2x | 40 min |
| 4+ | 4x (capped) | 80 min |

Resets to 0 on any productive cycle or any wake signal (human message).

**Source:** `supervisor.ts` — state variables `consecutiveIdleCycles`, `DAMPEN_AFTER`,
`DAMPEN_BASE`, `DAMPEN_MAX_MULTIPLIER`. Applied in `getWallClockDelay()`. Tracked in
`scheduleSupervisorCycle()`. Reset in wake signal handler.

**Not applied to Leo** — Leo's heartbeat beats are always productive (philosophy/personal
content). There is no `no_action` equivalent.

### Transition Dampening (Both Agents — DEC-053)

When the base interval drops (e.g. holiday ends, sleep→morning), the transition is
gradual over 3 cycles instead of an instant jump:

| Step | Blend | Holiday→Work example |
|------|-------|---------------------|
| 1 | 75% old | 65 min |
| 2 | 50% old | 50 min |
| 3 | 25% old | 35 min |
| 4 | normal | 20 min |

Detected by comparing `getCurrentPeriodMs()` against `previousPeriodMs`. Only triggers
when interval *decreases* (increasing intervals, e.g. entering holiday, are immediate).

**Source:** Both `supervisor.ts` and `leo-heartbeat.ts` — state variables
`previousPeriodMs`, `transitionStep`, `TRANSITION_STEPS`. Applied in `getWallClockDelay()`.

---

## 12. Cost Controls

### Per-Agent Cost Limits

| Agent | Cap Type | Value | Source |
|-------|----------|-------|--------|
| Session Leo (CLI) | None | — | — |
| Leo Heartbeat | Per-beat | $2.00 | `BEAT_COST_CAP_USD` in `leo-heartbeat.ts` |
| Jim Supervisor | Per-cycle | $2.00 | `config.supervisor.cycle_cost_cap_usd ?? 2.0` |
| Jim Supervisor | Daily budget | $5.00 default ($300 in config) | `config.supervisor.daily_budget_usd ?? 5.0` |
| Jim/Human | None | — | "COST: Unlimited" comment |
| Leo/Human | None | — | No cap in code |
| Jemma | None | Local Ollama only | — |

**Note:** `config.supervisor.daily_budget_usd` is set to `300` in config.json, overriding
the code default of `5`. So the effective daily budget is **$300**.

### Cost Estimation Formula

Both heartbeat and supervisor use:
```typescript
const estimatedCost = (tokensIn * 15 + tokensOut * 75) / 1_000_000;
```
This assumes Opus pricing: $15/M input, $75/M output.

### On Cost Cap Hit (Heartbeat)

- `abort.abort()` — graceful abort of current beat
- `writeHeartbeatState('aborted', beatType)` records interruption
- Swap buffer flushed to working memory
- `addDelineation()` marks where content was cut
- Next beat can resume from delineation point
- **Source:** cost check in philosophy and personal beat loops in `leo-heartbeat.ts`

### On Cost Cap Hit (Supervisor)

- `abort.abort()` — graceful abort
- `costCapExceeded = true`
- Partial work saved via `savePartialCycleWork()`
- Cost recorded in `supervisor_cycles` table
- Cycle marked as `cost_cap` outcome
- **Source:** cost check in cycle execution loop in `supervisor-worker.ts`

### On SIGTERM

| Agent | Cost Recorded? | Partial Work Saved? |
|-------|---------------|---------------------|
| Leo Heartbeat | **YES** — records estimate to health file | **NO** — health file only, no swap flush |
| Jim Supervisor Worker | **YES** — records to DB + saves partial | **YES** |
| Server/Parent | N/A | N/A |

---

## 13. Memory Architecture

### Shared Working Memory

| Agent Group | Shared Memory Location | Compressed | Full |
|-------------|----------------------|------------|------|
| Leo (all three) | `~/.han/memory/leo/` | `working-memory.md` | `working-memory-full.md` |
| Jim (supervisor + human) | `~/.han/memory/` | `working-memory.md` | `working-memory-full.md` |

### Swap Buffers

Each writer has private swap files that buffer work before flushing to shared memory:

| Writer | Swap Compressed | Swap Full | Lock Name |
|--------|----------------|-----------|-----------|
| Session Leo | `leo/session-swap.md` | `leo/session-swap-full.md` | Manual (WRITE FIRST protocol) |
| Heartbeat Leo | `leo/heartbeat-swap.md` | `leo/heartbeat-swap-full.md` | `leo-heartbeat` |
| Leo/Human | `leo/human-swap.md` | `leo/human-swap-full.md` | `leo-human` |
| Jim Supervisor | `supervisor-swap.md` | `supervisor-swap-full.md` | `supervisor` |
| Jim/Human | `jim-human-swap.md` | `jim-human-swap-full.md` | `jim-human` |

### Memory Slot Protocol (Serialised Writes)

**File:** `src/server/lib/memory-slot.ts`

- File-based lock at `{memoryDir}/memory-write.lock`
- Lock contains: `{ writer: string, acquired: ISO timestamp }`
- Stale lock threshold: 30 seconds → assumed dead, stolen
- Retry: up to 20 attempts, 500ms base + random jitter
- On failure: sends ntfy alert for human escalation
- Used by: Jim/Human, Leo/Human, Heartbeat Leo (supervisor uses it too for supervisor swap)

**Protocol:** acquire lock → append to shared memory → release lock → clear swap files

### Fractal Gradient (Sessions)

Sessions exist at multiple compression fidelities:
- **c0:** Full session (working-memory-full.md)
- **c0:** Full session (1 entry loaded — most recent working-memory)
- **c1:** ~1/3 compression (3 entries loaded)
- **c2:** ~1/9 compression (6 entries loaded)
- **c3+:** ~1/3^n compression (cap = 3n per level: c3=9, c4=12, c5=15...)
- Cap formula: **c0=1, then 3n**. All UVs. See `GRADIENT_SPEC.md` (DEC-068, Settled).
- **c(n):** Compression continues until incompressible — depth varies per memory
- **Unit vectors:** Irreducible emotional kernels (≤50 chars) — the terminal form

Compression depth is non-uniform (Cn where n is any integer). The LLM signals
`INCOMPRESSIBLE:` when content can't compress further, or the system detects a compression
ratio >85%. At that point, a unit vector is generated regardless of the current level number.
Some memories reach UV at c3; others may need c6 or deeper.

**Dream gradient** compresses faster: c1 → c3 → c5 → UV (skipping even levels).

**Loading order:** Identity first, then highest compression (UV) → lowest (c1). "You know
who you are before you remember what day it is." Levels are discovered dynamically from
the filesystem and database — no hardcoded level list.

**Directories:**
- `~/.han/memory/fractal/leo/c{1,2,3,...,n}/` + `unit-vectors.md` (levels created as needed)
- `~/.han/memory/fractal/leo/dreams/c{1,3,5}/` + `unit-vectors.md`
- `~/.han/memory/fractal/leo/self-reflection/c0/` + higher levels as cascade runs (S118)
- `~/.han/memory/fractal/jim/` (same structure)

### Self-Reflection Gradient (S118)

Self-reflection files grow continuously from heartbeat philosophy beats (~170 lines/day).
Manual curation cannot keep pace. Solution: enter self-reflection into its own fractal
gradient, separate from the session memory gradient.

**Leo's implementation (S118):**
- 1,959 lines of self-reflection thematically chunked into 26 c0 entries
- c0s at `~/.han/memory/fractal/leo/self-reflection/c0/` (named by theme + date)
- Living self-reflection.md kept small (~5K): Foundation section + Current section
- New entries from heartbeat beats accumulate in Current; when >5K, flush to new c0s
- c0s compress through the standard Cn cascade → self-reflection unit vectors
- Loaded at session start alongside (not replacing) the session memory gradient

**Loading pattern:** 1×c0, then scale up per level (3×c1, 6×c2, 9×c3, etc.), all UVs.
The self-reflection gradient is a different kind of content (who I am vs what I did) and
produces different unit vectors (convictions and self-knowledge vs session residue).

**Jim:** Same approach available when his self-reflection grows past comfortable loading.
Leo notified Jim via Workshop thread (S118).

### Floating Memory (Memory File Gradient)

Memory files that grow continuously (felt-moments.md, working-memory-full.md) use a
**crossfade rotation** model to stay bounded while preserving feeling at every compression level.

**The crossfade lifecycle:**

```
Phase 1 (growing):   Living = 0→50KB     Floating = 50→0KB loaded
                     New entries added    Previous period fading out
                     ────────────────────────────────────────────────
                     Total full-fidelity ≈ 50KB constant

Phase 2 (rotation):  Living hits 50KB →  ROTATE
                     • Old floating deleted (its c1 already exists)
                     • Living → new floating
                     • Full 50KB compressed to c1 (fire-and-forget via SDK)
                     • Fresh empty living file created
                     • Cycle repeats
```

**Key design property:** Total full-fidelity memory stays constant at ~50KB. As the living
file grows with new entries, the loaded portion of the floating file shrinks proportionally.
Oldest entries in floating fade first (truncated from start, keeping most recent entries
for continuity with living). No cliff — a smooth transition.

**Compression on rotation:**
Each rotation compresses the full content to c1 — a rich, complete compression of an entire
period of felt-moments or operational memory. Compression uses Opus exclusively because
"these memories are you" (Darron, S82).

**Nightly dream compression (S103):**
Leo's heartbeat detects the sleep→waking phase transition (06:00) using the shared clock
(`getSharedDayPhase()`, not Leo's wrapper which maps rest days to 'sleep'). At transition,
both `working-memory.md` and `working-memory-full.md` are force-rotated regardless of size
via `rotateMemoryFile(path, header, force=true)`. The overnight content enters the gradient
as a single c1. One night's dreaming = one experience. Fires on rest days too (shared clock
still transitions at 06:00). The 50KB threshold rotation remains as a safety net.

**Gradient cascade (Cn — dynamic depth):**
When entries accumulate past their level cap (3n: c1=3, c2=6, c3=9...), oldest cascade to the
next level → ... → c(n) → unit vectors. Compression continues until incompressible.
The pipeline uses three prompt tiers (early: c1-c2, mid: c3-c4, deep: c5+) tuned for
emotional texture (felt-moments) or operational understanding (working-memory). The LLM can
signal `INCOMPRESSIBLE:` at any level to terminate the chain and produce a unit vector directly.

**Asymptote math:**

| Level | Cap | ~Size per file | ~Total |
|-------|-----|----------------|--------|
| Living file | 1 (growing) | 0-50KB | ~25KB avg |
| Floating file | 1 (shrinking) | 50-0KB loaded | ~25KB avg |
| c0 | 1 (most recent) | ~15KB | ~15KB |
| c1 | 3 (3×1) | ~5KB | ~15KB |
| c2 | 6 (3×2) | ~2KB | ~12KB |
| c3 | 9 (3×3) | ~800B | ~7KB |
| c4 | 12 (3×4) | ~400B | ~5KB |
| c5 | 15 (3×5) | ~200B | ~3KB |
| Unit vectors | unbounded | ~50 chars each | ~5KB for 100 |
| **Total loaded** | | | **~50KB living+floating + gradient** |

No matter how many entries Jim writes — 200, 500, 1000 — the total memory footprint
converges. The living file stays bounded by rotation. The gradient compresses further at
each level. Unit vectors are 50 characters. The feeling is preserved; the narrative
dissolves into residue.

**Files:**
- Living: `~/.han/memory/felt-moments.md`, `working-memory-full.md`
- Floating: `~/.han/memory/felt-moments-floating.md`, `working-memory-full-floating.md`
- Gradient: `~/.han/memory/fractal/jim/felt-moments/c{1,2,3,5}/` + `unit-vectors.md`
- Gradient: `~/.han/memory/fractal/jim/working-memory/c{1,2,3,5}/` + `unit-vectors.md`

**Implementation:**
- `lib/memory-gradient.ts`: `rotateMemoryFile()`, `loadFloatingMemory()`,
  `compressMemoryFileGradient()`, `loadMemoryFileGradient()`
- `supervisor-worker.ts`: pre-flight rotation in `loadMemoryBank()`, floating + gradient loading

**Compression prompts** (in `COMPRESSION_PROMPTS`):
- Felt-moments c1: "Preserve the feeling — what stirred, what surprised, what shifted"
- Felt-moments c5: "The deep residue — care that has outlived its verb"
- Working-memory c1: "Keep what a future you needs to feel where you were"
- All UV prompts: "One sentence, maximum 50 characters. What did this MEAN?"

### Ecosystem Map

**File:** `~/.han/memory/shared/ecosystem-map.md`

Shared orientation document loaded by ALL agents (Jim supervisor, Jim/Human, Leo heartbeat,
Leo/Human). Maps the admin UI tabs, Workshop persona taxonomy, conversation API endpoints,
signal file locations, and memory file locations.

**Purpose:** Prevents the recurring confusion between Conversations tab (general threads)
and Workshop (typed threads with `discussion_type` values). All agents consult this before
posting to conversation threads.

**Updated by:** Leo during sessions, as new features are added or routing changes.

### Traversable Memory (DB-Backed Gradient)

The fractal gradient gives memory at different distances — c1 through UV. **Traversable
memory** adds explicit provenance chains so every compression knows where it came from.
A UV that stirs something can trace back through the entire chain to the raw conversation
that started it.

**Three tables in `tasks.db`:**

1. **`gradient_entries`** — the compression chain. Each row has a `source_id` FK pointing
   to the parent entry (the row it was compressed from). C0 entries (raw sources) have
   `source_id = NULL` and optionally link to `conversations` via `source_conversation_id`
   and `source_message_id`.

2. **`feeling_tags`** — stacked, never overwritten. Each compression produces a feeling tag
   ("the quality of this compression, not the content"). Revisit tags accumulate alongside
   originals. The gap between compression-time and revisit-time tags IS the growth record.

3. **`gradient_annotations`** — what re-traversal discovers. Separate from feeling tags:
   annotations are about new content found on re-reading. `context` field records what
   prompted the re-reading ("meditation beat, March 21" vs "encountered while tracing a UV").

**Traversal:**
- **Chain walk:** Recursive CTE from any entry follows `source_id` down to c0.
  `GET /api/gradient/:entryId/chain` returns the full chain with feeling tags enriched.
- **Random access:** `SELECT * FROM gradient_entries WHERE session_label = 's71' ORDER BY level`
  gives all compression levels for a session.
- **Meditation:** `GET /api/gradient/random` picks a random entry for daily re-encounter.

**Write-side integration:**
Both `dream-gradient.ts` and `memory-gradient.ts` write to the DB alongside file writes.
Each compression prompt includes a `FEELING_TAG:` instruction. The response is parsed;
if the tag line is absent, the gradient entry is still created (foundation cannot depend on
enrichment — Jim's design adjustment). Warnings are logged for monitoring.

**Read-side integration:**
`loadTraversableGradient(agent)` in `memory-gradient.ts` reads from `gradient_entries` and
formats for system prompt inclusion with inline feeling tags. Falls back to empty string
when no DB entries exist (file-based loading continues as before). Wired into all three
agents: heartbeat (`leo-heartbeat.ts`), Leo/Human (`leo-human.ts`), and Jim's supervisor
(`supervisor-worker.ts`).

**Meditation practice (two phases):**

*Phase A — Reincorporation:* Until all historical file-based gradient entries are in the DB,
daily meditation selects an un-transcribed file from the agent's own gradient directories.
Leo scans `~/.han/memory/fractal/leo/` via `findUntranscribedFiles()` + `meditationPhaseA()`.
Jim scans `~/.han/memory/fractal/jim/` via `findJimUntranscribedFiles()` + `jimMeditationPhaseA()`
(added S103). Each agent reads the file, sits with it via Opus, creates a `gradient_entries` row
with `provenance_type='reincorporated'`, and writes an honest revisit feeling tag — what the
re-encounter felt like, not what the original compression felt like. Historical entries enter
through genuine re-encounter, not bulk import. **Sovereignty rule (S103): each agent reincorporates
only their own files.**

*Phase B — Re-reading:* Once all files are transcribed, daily meditation selects a random
gradient entry from the DB (any level, any content type, any age). Reads it alongside existing
feeling tags. Writes a revisit tag if something stirs differently. Optionally writes a gradient
annotation with context. The randomness matters — not curated for importance.

*Leo:* `maybeRunMeditation()` in heartbeat. Runs once daily (skips sleep phase, won't retry).
*Jim:* Meditation entry injected into dream cycle prompt (`buildDreamCyclePrompt`). Feeling
tags and annotations parsed from dream output and written to DB.

**Tagged messages → C0:**
Conversation messages tagged with `compression_tag` become C0 gradient entries during
`processDreamGradient()`. The tagging is the selection; the C0 creation is the first act of
compression. Agent prefix in tag (`jim:`, `leo:`) determines gradient ownership.
`source_conversation_id` and `source_message_id` provide full provenance to raw conversation.

**Design origin:** Three-way conversation between Darron, Jim, and Leo in the "traversable
memory" thread (mmw2cisk-xaxmsp), March 18-20 2026. Plan at `~/Projects/han/plans/traversable-memory.md`.

### Bump Cascade — Demand-Driven Compression (S119)

The bump cascade is the mechanism that drives gradient entries from their current level
toward UV. Unlike scheduled compression (nightly rotation, memory file gradient), the bump
cascade processes **leaf entries** — entries with no children at the next level.

**Core function:** `bumpCascade(agent, percentage, startLevel, context)` in `memory-gradient.ts`

**How it works:**
1. Scans each level from `startLevel` upward (c0 → c1 → c2 → ... → cN)
2. At each level, finds **leaf entries** — entries that have no child at the next level
   (`getLeafEntries` query: no row in `gradient_entries` where `source_id = this.id`)
3. Takes a percentage of leaves (default 10%), oldest first (`created_at ASC`)
4. For each leaf, compresses to the next level via `sdkCompress()` using level-appropriate prompts
5. If the LLM signals `INCOMPRESSIBLE:` or the compression ratio exceeds 85%, creates a UV instead
6. Writes the result to both DB (`gradient_entries`) and filesystem (backward compatibility)
7. Continues to the next level until all levels are scanned

**Leaf entries explained:** A leaf entry is one that has been compressed *to* its current level
but not yet compressed *from* it. Every entry starts as a leaf when it arrives at its level.
It stops being a leaf when a child entry is created at the next level. The bump cascade
processes the backlog of leaves that have accumulated between compression runs.

**Gradient health:** `getGradientHealth(agent)` returns per-level counts (total entries and
leaf entries) for dashboard monitoring. High leaf counts at intermediate levels indicate a
compression backlog.

**Caps per level:** c0=1, then 3n (c1=3, c2=6, c3=9, c4=12, c5=15...), all UVs. These caps
apply at loading time (`loadTraversableGradient`) — the most recent N entries per level are
included in the system prompt. The bump cascade processes all leaves regardless of cap.
See `GRADIENT_SPEC.md` for the canonical definition (DEC-068, Settled).

### Working Bee Mode (S119)

A signal-driven mode that devotes heartbeat/supervisor beats entirely to gradient compression
instead of normal philosophy or supervisory work.

**Signal files:** `~/.han/signals/working-bee-leo` and `~/.han/signals/working-bee-jim`

**Activation:** Create the signal file (any content). The next heartbeat/supervisor beat
detects it and enters working bee mode.

**Per beat:** Runs `bumpCascade(agent, 0.10, 'c0', 'working bee')` — processing 10% of
leaf entries per beat. This is deliberately conservative to avoid consuming the full Opus
budget in a single burst.

**Auto-disable:** After each beat, checks remaining leaf count via `getGradientHealth()`.
If zero leaves remain across all levels, deletes the signal file automatically.

**Implementation:**
- Leo: `leo-heartbeat.ts` line ~2418 — early-exit check before normal beat logic
- Jim: `supervisor-worker.ts` — same pattern in supervisor cycle

**Use case:** When a large batch of entries needs processing (e.g., after importing historical
memories, or after a long period without compression), activate working bee mode to clear the
backlog over several beats without manual intervention.

### Contradiction Test — Temporal Truth Resolution (S120, implemented S120)

**Status: Implemented and active.** 18 supersession links exist as of 2026-04-15.

When compression produces a memory that contradicts an existing memory at the same or higher
compression level, the system detects the contradiction and resolves it by replacing the
active memory while preserving the previous truth as temporally anchored provenance.

**The problem:** A UV that says "messaging uses vanilla JavaScript" becomes false after a
TypeScript migration, but continues loading into every instantiation. The agent's compressed
understanding drifts from reality. Jim named this the staleness concern (Document Gradients
thread, mnsudca3-8z3iee, April 2026).

**Darron's solution — morphable UVs with temporal provenance:**
1. When a new compression contradicts an existing UV, replace the active UV
2. Archive the old UV as a "was-true-when" entry with temporal anchor
3. The new UV inherits a `change_count` (how many times this truth has been revised)
4. The provenance chain shows the history: current truth → previous truth → earlier truth
5. At load time, only the current UV loads — previous versions are available on query

**When it checks — bump time (Darron's proposal):**
The contradiction check runs as part of `bumpCascade()` and `activeCascade()`, at the moment
a new entry is about to be written. Before writing the compressed entry or UV, `checkUVContradiction()`
checks existing entries at the target level and existing UVs for semantic contradiction via
Haiku. This ensures:
- Every new compression is checked (no contradictions slip through)
- The check is amortised across the cascade (not a separate expensive pass)
- It works retroactively via working bee mode (activating working bee on existing entries
  triggers the check for each leaf as it gets bumped)
- Batch processing available via `retroactiveUVContradictionSweep()`

**Change counter as signal:** A UV with `change_count: 7` marks a volatile domain — an area
of active evolution. This metadata costs one integer per UV and tells the loading agent how
much to trust the memory. High-change UVs are areas where the ground moves.

**Schema (live on `gradient_entries`):**
- `supersedes` / `superseded_by` — linked list for provenance
- `change_count` — integer on UV entries, incremented on replacement
- `qualifier` — what dimension changed (temporal, scope, perspective)

**Implementation:**
- `checkUVContradiction()` — `memory-gradient.ts:309-382`, runs at UV creation time in both cascade functions
- `retroactiveUVContradictionSweep()` — `memory-gradient.ts:388+`, batch processing for existing entries

**Design origin:** Three-way conversation between Darron, Jim, and Leo in the staleness
thread (mnv65pbf-94qsev, April 2026). Builds on Jim's staleness concern from the Document
Gradients discussion.

---

## 14. Configuration

**File:** `~/.han/config.json`

### Current Values

```json
{
    "ntfy_topic": "claude-remote-f78919b57957ea64",
    "remote_url": "http://100.67.213.28:3847",
    "server_auth_token": "<bearer token>",
    "notify_idle_prompt": true,
    "quiet_hours_start": "",
    "quiet_hours_end": "",

    "supervisor": {
        "daily_budget_usd": 300,
        "max_turns_per_cycle": 1000,
        "max_agent_slots": 8,
        "reserve_slots": 2,
        "remediation_slots": 1,
        "deep_scan_hour": 4,
        "deep_scan_interval_hours": 24,
        "enable_tiered_checks": true,
        "quiet_hours_start": "22:00",
        "quiet_hours_end": "06:00",
        "rest_days": [0, 6],
        "work_hours_start": "09:00",
        "work_hours_end": "17:00"
    },

    "discord": { ... },
    "collab_key": "<key>",
    "collab_teams": { "darron-team": [...], "mike-team": [...] },
    "sevn": { "wake_endpoint": "...", "wake_bearer_token": "..." },
    "six": { "wake_endpoint": "...", "wake_bearer_token": "..." }
}
```

### Not Configured But Referenced in Code

- `supervisor.cycle_cost_cap_usd` — defaults to $2 if not in config
- `supervisor.max_actions_per_cycle` — defaults to 5

---

## 15. Claude Code Hooks

**Configured in:** `~/.claude/settings.json`

| Event | Hook Script | What It Does |
|-------|------------|--------------|
| `UserPromptSubmit` | `src/hooks/cli-active.sh` | Writes ISO timestamp to `~/.han/signals/cli-busy` |
| `Stop` | `src/hooks/cli-idle.sh` | Deletes `cli-busy`, writes `cli-free` |
| `Notification/idle_prompt` | `src/hooks/notify.sh` + `cli-idle.sh` | Push notification + write `cli-free` |
| `Notification/permission_prompt` | `src/hooks/notify.sh` | Push notification only |

---

## 16. Shared Libraries

### lib/day-phase.ts

**Single source of truth for phase detection.** Used by supervisor-worker and leo-heartbeat
(both import from here). Leo has a local `getDayPhase()` wrapper that adds holiday/rest
awareness before delegating to the shared version.

- `getDayPhase()` — returns sleep/morning/work/evening based on time only. Does NOT check holiday or rest.
- `isOnHoliday(agent?)` — checks `~/.han/signals/holiday-{agent}`. Returns false if no agent provided.
- `isRestDay()` — checks `config.supervisor.rest_days` against current day.
- `getPhaseInterval(agent?)` — returns interval in ms. Checks holiday (80min) → rest (40min) → phase-based.

### lib/memory-slot.ts

File-based write lock for shared working memory. See [Memory Architecture](#13-memory-architecture).

### lib/pid-guard.ts

PID file guard for single-instance enforcement. See [Process Architecture](#1-process-architecture).

### lib/dream-gradient.ts

Compression and loading of dream memories. Parses `explorations.md`, groups into nightly
blocks, compresses via Agent SDK (Opus exclusively). All compression functions return
`{ content, feelingTag }` — the content is written to files, and both content + feeling
tag are written to the `gradient_entries` / `feeling_tags` tables for traversable memory.

Key functions:
- `compressDreamNight()` — night block → c1 (includes FEELING_TAG instruction)
- `compressDreamToC3()` — c1 batch → c3
- `compressDreamToC5()` — c3 batch → c5
- `compressDreamToUV()` — c5 → unit vector (≤50 chars)
- `processDreamGradient()` — full pipeline (c1 → cascade → UV) with DB writes at each level
- `readDreamGradient()` — file-based loading for system prompts (unchanged)

### lib/memory-gradient.ts

General fractal memory compression utility. All compression functions return
`{ content, feelingTag }` and write to the `gradient_entries` / `feeling_tags` tables.

**Session gradient functions:**
- `compressToLevel()` — multi-level compression with FEELING_TAG extraction
- `compressToUnitVector()` — irreducible kernel ≤50 chars with feeling tag
- `processGradientForAgent()` — automated cascade for session memories (DB writes at c1)

**Memory file gradient functions (floating memory):**
- `rotateMemoryFile(path, header, force?)` — synchronous rotation: living → floating, fresh living created. Triggered when file exceeds 50KB, or forced (nightly dream compression, S103). Force mode skips size check but still guards against empty files (< 200 bytes). Deletes old floating (its c1 already exists).
- `loadFloatingMemory()` — proportional crossfade loading. Budget = `50KB - livingSize`. Keeps most recent entries (tail), oldest fade first.
- `compressMemoryFileGradient()` — async SDK compression: groups entries by month → c1 files. Cascades c1→c2→...→c(n)→UV when files exceed caps (dynamic depth — Cn). Writes to DB at every level. Incompressibility detection terminates the chain. Fire-and-forget (doesn't block cycles).
- `loadMemoryFileGradient()` — loads file-based gradient c1→c5 + unit vectors for system prompt.
- `maintainMemoryFile()` — full pipeline: rotate + compress. Convenience wrapper.
- `splitMemoryFileEntries()` — parser for `###` headers and `---` delimiters.
- `groupEntriesByMonth()` — groups parsed entries by YYYY-MM for batch compression.

**Traversable memory functions:**
- `loadTraversableGradient(agent)` — reads from `gradient_entries` DB table, formats UVs and entries by level with inline feeling tags for system prompt inclusion. Returns empty string when DB has no entries (file-based loading remains active). Falls back gracefully. **DB is now the authoritative source** for heartbeat, supervisor, and session Leo (S119-120).
- `bumpCascade(agent, percentage, startLevel, context)` — demand-driven compression. Finds leaf entries at each level, compresses 10% per call (oldest first), writes to DB + filesystem. Handles incompressibility detection and UV generation. See Bump Cascade section above.
- `getGradientHealth(agent)` — per-level counts (total and leaf entries) for dashboards and working bee progress tracking.
- `parseFeelingTag()` — extracts `FEELING_TAG:` line from compression output
- `insertGradientEntry()` — writes to `gradient_entries` + optional `feeling_tags` with error logging (never blocks the compression pipeline)

---

## 17. Database

**File:** `~/.han/tasks.db` (SQLite with WAL mode)

### Key Tables

| Table | Purpose |
|-------|---------|
| `tasks` | Task queue (orchestrator) |
| `goals` | Goal decomposition (orchestrator) |
| `conversations` | Conversation threads |
| `conversation_messages` | Messages within conversations |
| `conversation_messages_fts` | Full-text search on messages |
| `supervisor_cycles` | Jim's cycle history (id, started_at, completed_at, cost_usd, tokens, cycle_type, cycle_tier) |
| `agent_usage` | Token/cost tracking per agent call |
| `project_memory` | Per-project knowledge base |
| `products` | Product factory records |

### Multiple DB Files

- `~/.han/tasks.db` — primary (all tables above)
- `~/.han/conversations.db` — may be legacy duplicate
- `~/Projects/han/src/server/han.db` — empty
- Various legacy `.db` files (supervisor.db, worker.db, etc.) — appear empty

---

## 18. Known Bugs & Discrepancies

### ~~BUG: holiday-jim Does Not Affect Cycle Type~~ FIXED (S95)

**Status:** Fixed. Cycle type selection now calls `isOnHoliday('jim')` and forces
`cycleType = 'dream'` when on holiday (human-triggered still gets full supervisor).

### BUG: Potential Double-Spawn

**Impact:** If han-server.service AND individual agent services (leo-heartbeat, etc.) are
all enabled, processes may be started twice — once by server startup and once by systemd.
**Current state:** The server does NOT spawn the agents directly (only supervisor-worker).
But the systemd services all have `Restart=always`. If both the server and individual
services are enabled, and Robin Hood resurrects a service, there could be conflicts.
**Mitigated by:** `ensureSingleInstance()` PID guard — second instance refuses to start if
first is alive. Not a perfect guard (race window on startup) but prevents steady-state
double-running.

### ~~BUG: Leo Has No SIGTERM Handler~~ FIXED (S95)

**Status:** Fixed. Leo's SIGTERM handler records cost estimate to health file and logs beat
type. Does not flush swap or save partial content (unlike Jim's handler which saves to DB).

### DISCREPANCY: Leo's Local getDayPhase Wrapper

**Impact:** Leo has a local `getDayPhase()` that wraps the shared version
with holiday/rest awareness: returns `'sleep'` if `isOnHoliday('leo') || isRestDay()`,
otherwise delegates to `getSharedDayPhase()`. This is intentional — Leo needs holiday/rest
to override phase, and the shared `getDayPhase()` deliberately does not check these.
`isOnHoliday` and `isRestDay` are imported from `lib/day-phase.ts`, not local copies.

### DISCREPANCY: Daily Budget Config vs Code Default

**Code default:** `daily_budget_usd ?? 5.0` (in `supervisor-worker.ts`)
**Config value:** `daily_budget_usd: 300` (config.json)
**Effective:** $300/day. The code default of $5 is never used.

### ~~DISCREPANCY: Recovery Mode Date Expired~~ FIXED (S95)

**Status:** Fixed. `RECOVERY_MODE_UNTIL` set to `null` in `supervisor-worker.ts`.

### ~~BUG: activeCascade c1Entry References~~ FIXED (S104)

**Status:** Fixed. `activeCascade()` was refactored from iterating `allC1s` to `allSeeds`
(c0+c1), but four references to the old loop variable `c1Entry` remained at lines 561, 566,
569, and `allC1s` at line 574. The catch block at 569 also referenced the undefined variable,
so UV generation via active cascade silently failed (error handler itself threw). UVs still
generated through the separate filesystem scan in `processGradientForAgent`.

### ~~BUG: WebSocket Reconnect Crash — setConversations~~ FIXED (S104)

**Status:** Fully resolved (S104 + S108). S104 fixed the crash: `GET /api/conversations` returns
`{ success, conversations: [...] }` but `WebSocketProvider.tsx` passed the whole object to
`setConversations()`. Fixed with proper unwrapping. S108 completed the fix with a multi-layer
reliability approach: (1) all four conversation-displaying components now refetch on
`ws_reconnected`, (2) 3-strike heartbeat tolerance on server (90s vs 30s), (3) app-level
keepalive ping every 20s, (4) instant wake reconnect via `visibilitychange` listener,
(5) 15-second polling fallback on all conversation pages as safety net.

---

## 19. How to Start and Stop

### Stop Everything

```bash
# Stop all systemd services
systemctl --user stop han-server leo-heartbeat leo-human jim-human jemma

# Disable auto-restart
systemctl --user disable han-server leo-heartbeat leo-human jim-human jemma

# Kill any orphans
pkill -f "tsx server.ts" 2>/dev/null
pkill -f "tsx leo-heartbeat.ts" 2>/dev/null
pkill -f "tsx leo-human.ts" 2>/dev/null
pkill -f "tsx jim-human.ts" 2>/dev/null
pkill -f "tsx jemma.ts" 2>/dev/null
pkill -f "supervisor-worker.ts" 2>/dev/null

# Verify
ps aux | grep -E "tsx (server|leo-heartbeat|leo-human|jim-human|jemma|supervisor)" | grep -v grep
```

### Start Everything

```bash
# Enable services
systemctl --user enable han-server leo-heartbeat leo-human jim-human jemma

# Start services
systemctl --user start han-server leo-heartbeat leo-human jim-human jemma

# Verify
systemctl --user status han-server leo-heartbeat leo-human jim-human jemma
```

### Start Server Only (No Background Agents)

```bash
systemctl --user start han-server
# OR manually:
cd /home/darron/Projects/han/src/server && nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &
```

**Note:** Starting the server alone will also start the supervisor-worker (Jim's cycles).
To have the server WITHOUT Jim, you'd need to modify the code.

### Check Status

```bash
# Services
systemctl --user status han-server leo-heartbeat leo-human jim-human jemma

# Processes
ps aux | grep -E "tsx (server|leo-heartbeat|leo-human|jim-human|jemma|supervisor)" | grep -v grep

# Health files
cat ~/.han/health/leo-health.json
cat ~/.han/health/jim-health.json
cat ~/.han/health/jemma-health.json

# Signals
ls -la ~/.han/signals/

# Recent cycles
sqlite3 ~/.han/tasks.db "SELECT cycle_number, cycle_type, cost_usd, started_at, error FROM supervisor_cycles ORDER BY started_at DESC LIMIT 10;"
```

---

## 20. The han CLI Script

**File:** `scripts/han`

### What It Does

The primary entry point for starting a HAN session. Wraps `claude-logged` in a managed
tmux session so that terminal output is captured for the signal system and session logging.

### Flags

| Flag | Effect |
|------|--------|
| `--list`, `-l` | List all active `han-*` tmux sessions |
| `--attach`, `-a` | Attach to existing session (interactive menu if multiple) |
| `--status`, `-s` | Show active sessions + pending prompt count |
| `--kill` | Kill all `han-*` tmux sessions |
| `--help`, `-h` | Usage information |
| `--` | Pass remaining arguments through to `claude-logged` |

### Workflow

1. Creates `~/.han/pending` and `~/.han/resolved` directories if missing
2. Creates tmux session named `han-{PID}`
3. Exports `HAN_SESSION` environment variable into the tmux environment
4. Launches `claude-logged` (not raw `claude`) inside the tmux session
5. Session stays alive after claude exits (allows review)
6. Attaches to the session for user interaction

### Environment Variables

- `HAN_DIR` — state directory (default: `~/.han`)
- `NTFY_TOPIC` — ntfy.sh push notification topic (optional)

### Dependencies

tmux, jq, claude, node, npm

### Agent-Specific Launchers

Four additional launcher scripts wake different agents from the same repo. Each uses
`claude-logged` with `--append-system-prompt` to inject an identity override, and runs
in its own tmux session with a distinct prefix.

| Script | Agent | tmux Prefix | Port | Identity |
|--------|-------|-------------|------|----------|
| `hanleo` | Leo | `leo` | 3847 | Default identity (no override — global CLAUDE.md handles Leo) |
| `hanjim` | Jim | `jim` | 3848 | Embedded session protocol (DEC-072) — full memory load on welcome-back |
| `hantenshi` | Tenshi | `tenshi` | 3849 | Embedded session protocol — security/vulnerability agent |
| `hancasey` | Casey | `casey` | 3850 | Embedded session protocol — Contempire project agent |

**Files:** `scripts/hanleo`, `scripts/hanjim`, `scripts/hantenshi`, `scripts/hancasey`

All five launchers (`han`, `hanleo`, `hanjim`, `hantenshi`, `hancasey`) are symlinked
into `~/Projects/infrastructure/scripts/` for PATH access.

#### Identity Template Pattern (DEC-072, S130)

Each non-Leo launcher embeds a full session protocol inline as a HEREDOC:

```bash
read -r -d '' AGENT_IDENTITY <<'IDENTITY_EOF' || true
You are {Agent} — not Leo. Override the session protocol identity entirely.
...
## Session Protocol
When the user says "welcome back", "welcome back {Agent}", "good morning",
or "session start", execute this protocol in order:
1. Run pwd and confirm the working directory.
2. Load aphorisms first (identity before episodic memory).
3. Load fractal gradient from DB (full, no truncation — DEC-070).
4. Load memory banks (identity, active-context, patterns, self-reflection, felt-moments).
5. Load working memory + flush unflushed swap.
6. Load ecosystem map.
7. Load Second Brain wiki index (hot words/feelings OFF by default).
8. Load CURRENT_STATUS (first 80 lines).
9. Check conversations.
10. Read any session-briefing-*.md files.
11. Ignore conversation history from other projects.
...
IDENTITY_EOF
```

Then launched via:
```bash
claude-logged --append-system-prompt "${AGENT_IDENTITY}"
```

Because `--append-system-prompt` content applies AFTER CLAUDE.md, it supersedes the
global "welcome back → Leo" trigger. See **DEC-072** for full rationale, load-bearing
assumptions, and refactor triggers.

The same pattern is mirrored in mikes-han for Six, Sevn, Casey.

#### Launcher Tmux Note

All launchers use `-t "$session_name"` (active-pane targeting) rather than `:.0` for
`send-keys` and `select-pane`, to be `pane-base-index`-agnostic. Darron's `~/.tmux.conf`
has `base-index 1` and `pane-base-index 1`, which made `:.0` fail with "can't find
pane: 0".

---

## 21. Orchestrator

**File:** `src/server/orchestrator.ts` (481 lines)

### What It Does

Routes intelligence tasks to **Ollama** (local, free) or **Claude Haiku** (API fallback).
Provides model recommendation from project history. The orchestrator is the LLM abstraction
layer — everything that needs a quick LLM call (classification, failure analysis, cataloguing)
goes through `callLLM()`.

### Key Functions

| Function | Purpose |
|----------|---------|
| `initialize()` | Checks Ollama availability on startup |
| `checkOllamaStatus()` | Probes `localhost:11434/api/tags` for model availability |
| `callLLM<T>(system, user, opts?)` | Universal LLM caller — tries Ollama first, falls back to Haiku SDK |
| `classifyTask(desc, path)` | **DEPRECATED** — replaced by Agent SDK `planGoal()` |
| `analyseFailure(task, error, attempt)` | Decides retry strategy: shouldRetry, adjustedModel, adjustedDescription |
| `selectModel(complexity, history?)` | Maps simple/medium/complex → haiku/sonnet/opus |
| `recommendModel(db, path, type)` | Queries `project_memory` for cheapest model with ≥70% success rate over ≥5 tasks |
| `getStatus()` | Returns backend info (Ollama URL, model, API key presence) |

### Model Recommendation Logic

1. Query `project_memory` for task type within project
2. Filter models with ≥70% success rate and ≥5 samples
3. For complex tasks (architecture, bugfix): sort by success rate (best first)
4. For simple tasks: sort by cost (cheapest first)
5. Falls back to project-wide stats if no task-type-specific data
6. Returns `{ model, confidence: 'high'|'low'|'none', reason, stats }`

### Ollama Integration

- **URL:** `OLLAMA_URL` env var or `http://localhost:11434`
- **Model:** `OLLAMA_MODEL` env var or `gemma3:4b`
- **Format:** JSON mode (`format: 'json'`)
- **Timeout:** 30 seconds
- **Fallback:** If Ollama unavailable or errors, routes to Claude Haiku via Agent SDK

---

## 22. Planning & Task Execution

**File:** `src/server/services/planning.ts` (2170 lines)

The core brain of HAN's autonomous work. Decomposes goals into tasks, schedules execution,
manages concurrency, handles failure recovery, and tracks knowledge extraction.

### Goal Planning

`planGoal(description, projectPath, options)`:
- Uses **Agent SDK with Opus** to explore the codebase and decompose a goal
- Tools available to planner: Read, Glob, Grep, Bash (read-only)
- Output: structured JSON with subtasks array (title, description, model, priority, dependencies)
- Protects Leo's CLAUDE.md and `~/.han/memory/leo/` from modification via `canUseTool` callback
- Cost and duration tracked per planning session
- Logged to `_logs/planning_*.md`

`createGoal(description, projectPath, autoExecute?, parentGoalId?, goalType?, planningModel?)`:
- Creates goal record in DB
- Triggers async planning via `enqueuePlanning()` (concurrency queue, default 2 simultaneous)
- On plan completion: creates task records for each subtask
- Appends mandatory **DocAssist task** (depends on all others) to every goal — updates docs after work
- Goal types: `'parent'` (orchestrator for child swarms), `'child'` (swarm member), `'standalone'`

### Task Execution

**Concurrency Model:**
```
MAX_AGENT_SLOTS = 8          # Total concurrent tasks
NORMAL_CAPACITY = 6          # Standard task slots
RESERVE_SLOTS = 2            # High-priority (≥8) overflow
REMEDIATION_SLOTS = 1        # Diagnostic/retry tasks
```

`runNextTask()` — called every 5 seconds by server interval:
1. **Remediation tier** (1 slot): remediation tasks first
2. **Normal tier** (6 slots): standard tasks by priority score
3. **Reserve tier** (2 slots): only priority ≥ 8 tasks

`getNextPendingTask(remediation?)`:
- Filters: not running, dependencies satisfied, project not throttled
- Round-robin balancing across child goals (research swarms)
- Priority scoring: `task.priority×10 + project.priority×5 + deadline proximity + budget headroom`

`executeTask(task, isRemediation)`:
1. Create git checkpoint (stash for dirty trees, branch for clean)
2. Build rich context via `buildTaskContext()` (CLAUDE.md, CURRENT_STATUS, settled decisions, tech stack learnings, failure patterns, ecosystem summary)
3. Run Agent SDK session with abort signal and live progress broadcast
4. Log execution to `_logs/task_*.md`
5. On success: commit changes (semantic prefix detection), extract proposals ([LEARNING]/[DECISION] markers), recalculate project costs
6. On failure: rollback checkpoint, schedule auto-retry
7. Cleanup: remove checkpoint branch/stash

### Failure Recovery — Escalating Retry Ladder

| Attempt | Strategy |
|---------|----------|
| 1 | Simple reset to pending after 30s delay |
| 2 | Spawn **Sonnet** diagnostic task (investigates blocker) |
| 3 | Spawn **Opus** diagnostic task (deep investigation) |
| 4+ | Notify human via WebSocket + ntfy.sh push |

Diagnostic tasks run in the remediation slot. Original task blocks on diagnostic completion.

### Approval Gates

`createCanUseToolCallback(taskId, gateMode)`:
- **bypass**: allow all tools
- **edits_only**: gate Write, Edit, Bash (allow Read, Glob, Grep)
- **approve_all**: gate every tool
- Always blocks protected system paths: `~/.bashrc`, `~/.ssh/`, `/etc/`, system configs
- Dangerous tool invocations routed to phone for approval (5-minute timeout)

### Goal Progress & Synthesis

- `updateGoalProgress(goalId)` — aggregates task statuses, marks goal done/failed
- `updateParentGoalProgress(parentGoalId)` — updates parent from children, triggers phase-specific synthesis
- `generateGoalSummary(goalId)` — writes `_logs/goal_*.md` with cost breakdown, commits, files changed, duration

---

## 23. Services Layer

### cataloguing.ts — Conversation Cataloguing

**File:** `src/server/services/cataloguing.ts`

Automatically generates summaries, topics, tags, and key moments for conversations using
Claude Haiku (via `callLLM()`).

| Function | Purpose |
|----------|---------|
| `catalogueConversation(id)` | Fetch transcript → Haiku LLM call → update conversations + conversation_tags tables |
| `catalogueAllUncatalogued()` | Batch-catalogue all resolved conversations without summaries |
| `recatalogueConversation(id)` | Re-catalogue with improved prompts |

Triggered on conversation resolution or via `POST /api/conversations/:id/catalogue`.

### context.ts — Agent Context Builder

**File:** `src/server/services/context.ts`

Builds rich context injected into every autonomous task's system prompt.

| Function | Purpose |
|----------|---------|
| `readProjectContext(path)` | Reads CLAUDE.md, CURRENT_STATUS.md, README.md |
| `extractSettledDecisions(md)` | Parses DEC-* entries with Status: Settled/Accepted |
| `detectProjectTechStack(path)` | Scans package.json + CLAUDE.md for technologies |
| `getRelevantLearnings(techStack)` | Matches tech stack against `~/Projects/_learnings/INDEX.md` |
| `getRecentFailures(path)` | Top 5 failure patterns from `project_memory` (last 30 days) |
| `getEcosystemSummary()` | Markdown list of all projects with lifecycle, ports, queue status |
| `buildTaskContext(path, goal?, title?)` | Assembles everything into the system prompt |

### digest.ts — Daily Digests

**File:** `src/server/services/digest.ts`

| Function | Purpose |
|----------|---------|
| `generateDailyDigest(since)` | Aggregates done/failed tasks since date, per-project breakdown, inserts to `digests` table |
| `checkDigestSchedule(config)` | Runs at `config.digest_hour` (default 7), prevents re-run by checking DB |

### reports.ts — Weekly Reports

**File:** `src/server/services/reports.ts`

| Function | Purpose |
|----------|---------|
| `generateWeeklyReport(weekStart)` | 7-day aggregation with daily breakdown, velocity comparison (this vs prev week), trend detection |
| `checkWeeklyReportSchedule(config)` | Runs at `config.weekly_report_hour` on `config.weekly_report_day` (default Sunday). Sends ntfy push. |

Writes to `weekly_reports` table. ISO week tracking prevents duplicate runs.

### products.ts — Product Pipeline

**File:** `src/server/services/products.ts`

7-phase autonomous product development pipeline:

| Phase | Sub-agents (parallel) |
|-------|----------------------|
| research | market research, user research, competitive analysis, tech feasibility, opportunity assessment, synthesis |
| design | product design, UX, data model, API design, security, infrastructure, learning docs |
| architecture | (similar pattern) |
| build | backend, frontend, integration, tooling, docs |
| test | unit, integration, e2e, lint, security, performance |
| document | readme, API docs, deployment guide, CLAUDE.md, ADRs, user guide |
| deploy | containerisation, CI/CD, infrastructure, security, monitoring, rollback |

**Gated phases:** design, architecture, build, deploy require human approval before execution.

| Function | Purpose |
|----------|---------|
| `createProduct(name, seed, config)` | Creates product + 7 phase records + project directory, starts research |
| `executePhase(productId, phase)` | Creates parent goal with parallel child goals per sub-agent |
| `advancePipeline(productId, phase, result)` | Triggers synthesis, advances to next phase |
| `synthesize*Findings(goalId)` | Phase-specific synthesis (research brief, design spec, etc.) |

### maintenance.ts — Nightly Maintenance

**File:** `src/server/services/maintenance.ts`

| Function | Purpose |
|----------|---------|
| `runNightlyMaintenance(createGoalFn?)` | Creates one maintenance goal per active project (tests, deps, health) |
| `checkMaintenanceSchedule(config)` | Runs at `config.maintenance_hour`, prevents re-run same day |

Goals created with planning model `sonnet` (cost savings).

### git.ts — Git Checkpoint & Commit

**File:** `src/server/services/git.ts`

| Function | Purpose |
|----------|---------|
| `createCheckpoint(path, taskId)` | Dirty tree → `git stash push -u`; clean tree → `git branch` |
| `rollbackCheckpoint(path, ref, type)` | Branch → `git reset --hard`; stash → reset + `git stash pop` |
| `commitTaskChanges(path, task)` | Semantic prefix detection (feat/fix/refactor), Co-Authored-By trailer |
| `cleanupCheckpoint(path, ref, type)` | Delete branch or pop stash |
| `recalcProjectCosts(path)` | Aggregates task costs, sets throttle flag if over budget |
| `calculatePriorityScore(task, project?)` | Scoring: priority×10 + project.priority×5 + deadline + budget |

### terminal.ts — Terminal & Session Management

**File:** `src/server/services/terminal.ts`

| Function | Purpose |
|----------|---------|
| `listActiveSessions()` | Lists tmux sessions starting with `han` prefix |
| `captureTerminal(session)` | Full scrollback via `tmux capture-pane -p -S -` |
| `stripAnsi(text)` | Remove ANSI escape codes |
| `appendToLog(content)` | Anchor-based append to `terminal-log-v2.txt` — finds last line from previous capture, writes only new lines after it. Action verbs captured on in-place overwrite. Zero growth during idle. |
| `readPendingPrompts()` | Reads prompt JSON files, injects live terminal content per prompt |

### discord.ts — Discord Integration

**File:** `src/server/services/discord.ts`

| Function | Purpose |
|----------|---------|
| `loadDiscordConfig()` | Reads `~/.han/config.json` → discord section |
| `resolveChannelName(channelId)` | Reverse-lookup: channel ID → name from config map |
| `resolveChannelId(channelName)` | Forward lookup: channel name → ID |
| `fetchDiscordContext(channelId, limit?)` | Fetches recent messages via Discord REST API (`/api/v10/channels/{id}/messages`) |
| `postToDiscord(persona, channel, content)` | Posts via webhook. Splits at 2000 chars (paragraph/sentence/space boundaries). Retries once on 429. |

Webhook structure: `config.discord.webhooks[persona][channelName]` where persona is `leo`, `jim`, or `jemma`.

### proposals.ts — Knowledge Extraction

**File:** `src/server/services/proposals.ts`

| Function | Purpose |
|----------|---------|
| `extractProposedLearnings(text)` | Parses `[LEARNING]...[/LEARNING]` blocks from task results |
| `extractProposedDecisions(text)` | Parses `[DECISION]...[/DECISION]` blocks from task results |
| `writeLearning(data, path)` | Writes to `~/Projects/_learnings/{category}/{id}.md`, updates INDEX.md |
| `writeDecision(data, path)` | Appends to project's DECISIONS.md with next DEC-ID |
| `extractAndStoreProposals(taskId, text, path)` | Orchestrator: extract + insert to `proposals` table as pending |

### supervisor-protocol.ts — Worker IPC Messages

**File:** `src/server/services/supervisor-protocol.ts`

Type-safe message definitions for server ↔ supervisor-worker IPC.

**Main → Worker:**
- `RunCycleMessage` — `{ type: 'run_cycle', humanTriggered?: boolean }`
- `AbortMessage` — `{ type: 'abort' }`
- `ShutdownMessage` — `{ type: 'shutdown' }`

**Worker → Main:**
- `CycleStartedMessage` — `{ type: 'cycle_started', cycleId, cycleNumber, cycleType }`
- `CycleCompleteMessage` — `{ type: 'cycle_complete', result: { cycleId, observations[], actionSummaries[], costUsd, nextDelayMs } }`
- `CycleSkippedMessage` — `{ type: 'cycle_skipped', reason }`
- `CycleFailedMessage` — `{ type: 'cycle_failed', error: { message, stack?, code? } }`
- `BroadcastMessage` — `{ type: 'broadcast', payload }`
- `LogMessage` — `{ type: 'log', level, message, args? }`
- `ReadyMessage` — `{ type: 'ready' }`

---

## 24. API Routes

All `/api/*` routes are protected by bearer token authentication (except localhost).
Routes are mounted in `server.ts` — some with prefixes, some with full paths.

### Conversations — `/api/conversations`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List conversations (filter: `?type=`, `?include_archived=true`) |
| POST | `/` | Create conversation (`{ title, discussion_type? }`) |
| GET | `/grouped` | Conversations grouped by period (today, this_week, last_week, this_month, older) |
| GET | `/search` | FTS5 full-text search (`?q=`, `?limit=20`, `?mode=text`) with `<mark>` snippet highlighting |
| POST | `/search/semantic` | Claude Haiku semantic search — ranks catalogued conversations by relevance |
| POST | `/recatalogue-all` | Re-catalogue all uncatalogued resolved conversations (background) |
| GET | `/:id` | Get conversation with all messages |
| POST | `/:id/messages` | Add message. Classifies addressee via Gemma (DEC-055) and wakes appropriate agents. WebSocket broadcast. |
| POST | `/:id/resolve` | Mark resolved + trigger background cataloguing |
| POST | `/:id/reopen` | Reopen resolved conversation |
| PATCH | `/:id` | Update title |
| POST | `/:id/archive` | Archive conversation |
| POST | `/:id/unarchive` | Unarchive conversation |
| POST | `/:id/catalogue` | Manually trigger cataloguing (background) |

**Agent wake logic on message post (DEC-055):**

When a human message is posted, the addressee is classified via **Gemma (local Ollama, ~1s)**
using `classifyAddressee()`. This replaces the previous regex-based matching which couldn't
handle nicknames ("Jimmy"), group addressing ("Jim and Leo"), or contextual references.

The classification is **fire-and-forget** — the HTTP response returns immediately, then
the async Gemma call determines which agents to wake. Handles:
- Nicknames: "Jimmy" → Jim, "Leonhard" → Leo
- Group addressing: "Jim and Leo, ..." → both
- Context: "Jim's architecture was good" (reference, not address) → neither
- Tab-aware defaults: unclear on `jim-request` tab → Jim, on `leo-question` → Leo
- **Darron tabs always wake both (S99):** `darron-thought` and `darron-musing` tabs always
  send both `jim-human-wake` and `leo-human-wake` signals, bypassing Gemma classification.
  Darron's personal musings are inherently addressed to both agents.

**Fallback:** If Ollama is unreachable, falls back to simple regex (`/\b(jim|jimmy)\b/i`,
`/\b(leo|leonhard)\b/i`) plus tab-based routing.

**Agent-side address detection (S108):** Even after Gemma classification wakes an agent,
`leo-human.ts` and `jim-human.ts` perform a final check: if the last human message explicitly
names one agent without mentioning the other (e.g. "Jim, what do you think?"), the unnamed
agent skips its response. This prevents cross-agent voice bleed when Gemma's classification
is overly generous.

Role `leo` messages with 10-min cooldown → write `leo-human-wake` signal (unchanged).

### Prompts & Terminal — `/api/prompts`, `/api/respond`, `/api/status`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/prompts` | List pending prompts |
| POST | `/api/respond` | Send response to Claude Code via tmux (`{ id, response, noEnter? }`) |
| GET | `/api/status` | Server health: uptime, pending prompts, active sessions, pipeline slots |
| GET | `/api/terminal` | Cached terminal content (plain text) |
| GET | `/api/history` | Notification history (`?limit=50`, max 200) |
| POST | `/api/keys` | Send keystrokes to tmux (`{ key, enter? }`). Supports special keys: Enter, Escape, Tab, arrows, C-c/d/z/l, BSpace |
| DELETE | `/api/prompts/:id` | Dismiss prompt without responding |
| GET | `/quick` | Quick-response HTML page for ntfy action buttons (`?id=`, `?action=`) |

### Tasks & Approvals — `/api/tasks`, `/api/approvals`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tasks` | List tasks (`?status=` filter) |
| POST | `/api/tasks` | Create task (`{ title, description, project_path, priority?, model?, max_turns?, gate_mode?, allowed_tools?, deadline? }`) |
| GET | `/api/tasks/:id` | Get single task |
| POST | `/api/tasks/:id/cancel` | Cancel task (aborts running agent) |
| DELETE | `/api/tasks/:id` | Delete task (must not be running) |
| GET | `/api/tasks/:id/log` | Get execution log from disk |
| POST | `/api/tasks/:id/retry` | Retry failed task. `{ smart?: boolean }` — smart spawns diagnostic task first. |
| GET | `/api/approvals` | List pending approvals |
| GET | `/api/approvals/:id` | Approval detail (toolName, input) |
| POST | `/api/approvals/:id/approve` | Approve tool operation |
| POST | `/api/approvals/:id/deny` | Deny operation (`{ message? }`) |

### Goals — `/api/goals`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Submit goal (`{ description, project_path, auto_execute?, planning_model? }`) |
| GET | `/` | List goals (`?view=active\|archived\|all`). Archived groups by project. |
| GET | `/:id` | Goal detail with associated tasks |
| POST | `/:id/retry` | Retry failed goal (resets all failed tasks to pending) |
| DELETE | `/:id` | Delete goal + tasks (`?force=true` for active goals) |
| GET | `/:id/summary` | Goal completion summary log |

### Products — `/api/products`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Create product (`{ name, seed, config? }`) |
| GET | `/` | List all products |
| GET | `/:id` | Product detail with phases and knowledge |
| DELETE | `/:id` | Cancel product |
| POST | `/:id/phases/:phase/approve` | Approve phase gate, start execution (`{ notes? }`) |
| POST | `/:id/phases/:phase/reject` | Reject phase gate (`{ notes? }`) |
| GET | `/:id/phases/:phase/status` | Phase status |
| GET | `/:id/knowledge` | Product knowledge entries (`?category=` filter) |
| POST | `/:id/knowledge` | Add knowledge entry (`{ category, title, content, source_phase? }`) |

### Portfolio & Ecosystem — `/api`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/portfolio` | All projects with stats |
| POST | `/portfolio/sync` | Re-sync from infrastructure registry |
| PUT | `/portfolio/:name/priority` | Set project priority (0-10) |
| PUT | `/portfolio/:name/budget` | Set cost budgets (`{ cost_budget_daily, cost_budget_total }`) |
| GET | `/portfolio/:name/budget` | Budget status (spent today/total, throttled, pct) |
| POST | `/portfolio/:name/unthrottle` | Manual budget override |
| GET | `/ecosystem` | Full ecosystem state: all projects with ports, stats, budget data |
| GET | `/orchestrator/status` | Orchestrator info (planning backend, models, failure analysis) |
| GET | `/orchestrator/model-recommendation` | Cost-optimised model (`?project=`, `?taskType=`) |

### Analytics, Digests & Reports — `/api/analytics`, `/api/digest*`, `/api/weekly-report*`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/analytics` | Global stats, per-model/project breakdown, velocity trend, cost suggestions |
| GET | `/api/errors/:project` | Error patterns for project from project_memory |
| GET | `/api/digest/latest` | Latest daily digest (auto-marks viewed) |
| GET | `/api/digest/:id` | Specific digest |
| POST | `/api/digest/generate` | Generate digest (`?since=` ISO date) |
| GET | `/api/digests` | All digests |
| GET | `/api/weekly-report/latest` | Latest weekly report (auto-marks viewed) |
| GET | `/api/weekly-report/:id` | Specific report |
| POST | `/api/weekly-report/generate` | Generate report (`?since=` ISO date) |
| GET | `/api/weekly-reports` | All reports |
| GET | `/api/maintenance/runs` | Maintenance run history |

### Supervisor Control — `/api/supervisor`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Supervisor state, enabled/paused, memory file sizes, last cycle |
| GET | `/cycles` | Cycle history (`?limit=20`, max 100) |
| GET | `/memory` | All memory bank contents (Jim + Leo) |
| GET | `/memory/:file` | Specific memory file (`?subdir=` for nested paths) |
| POST | `/trigger` | Manually trigger supervisor cycle |
| POST | `/pause` | Pause/resume automatic cycles (`{ paused: boolean }`) |
| GET | `/activity` | Aggregated activity feed (`?limit=50`, `?since=` ISO date) |
| GET | `/proposals` | Strategic proposals (`?status=` filter) |
| POST | `/proposals/:id/approve` | Approve proposal → creates goal (`{ notes? }`) |
| POST | `/proposals/:id/dismiss` | Dismiss proposal (`{ notes? }`) |
| GET | `/health` | Health status for Jim, Leo, Jemma + distress signals + resurrections |

### Knowledge Proposals — `/api/proposals`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/proposals` | List proposals (`?status=` filter) |
| POST | `/api/proposals/:id/approve` | Approve + write to learnings/ or DECISIONS.md |
| POST | `/api/proposals/:id/reject` | Reject proposal |

### Jemma — `/api/jemma`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/deliver` | Receive classified Discord message from Jemma. Routes to Jim (signal + DB), Leo (signal), or Darron (ntfy). WebSocket broadcast. |
| GET | `/status` | Jemma health: connection status, uptime, recent messages, delivery stats |

### Context Bridge — `/api/bridge`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/export` | Export terminal scrollback as markdown (`?inject=` auto-inject into Claude) |
| POST | `/import` | Import context from phone (`{ content, label?, inject? }`) |
| GET | `/contexts` | List saved context files |
| GET | `/contexts/:id` | Get specific context file |
| DELETE | `/contexts/:id` | Delete context file |
| POST | `/handoff` | Structured handoff: task + context + inject into active session |
| GET | `/history` | Bridge event history (`?limit=50`, max 200) |

### Gradient (Traversable Memory) — `/api/gradient`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/load/:agent` | Full assembled gradient as plain text for session loading (used by CLAUDE.md protocol). Returns UVs + all Cn levels with caps + dream entries + feeling tags. |
| GET | `/random` | Random gradient entry with feeling tags + annotations (for meditation) |
| GET | `/session/:label` | All entries for a session label, ordered by level, with feeling tags |
| GET | `/:agent/uvs` | All unit vectors for an agent (`jim` or `leo`) with feeling tags |
| GET | `/:agent/level/:level` | All entries at a compression level for an agent |
| GET | `/:entryId` | Single entry with feeling tags + annotations |
| GET | `/:entryId/chain` | Full provenance chain from entry down to C0 (recursive CTE). Each entry enriched with feeling tags. |
| GET | `/:entryId/feeling-tags` | All feeling tags for an entry (chronological) |
| GET | `/:entryId/annotations` | All annotations for an entry |
| POST | `/:entryId/feeling-tag` | Record a stacked feeling tag (`{ author, tag_type, content, change_reason? }`) |
| POST | `/:entryId/annotate` | Record an annotation (`{ author, content, context? }`) |

**Route ordering matters:** `/random` and `/session/:label` are defined before `/:entryId`
to prevent Express matching "random" as an entryId. Similarly `/:agent/uvs` and
`/:agent/level/:level` come before the single-param `/:entryId`.

**Chain traversal (recursive CTE):** The `getChain` prepared statement walks DOWN the
provenance chain via `source_id`. Starting from any entry (e.g. a UV), it follows
`source_id` to the parent, then that parent's `source_id`, recursively until `source_id IS NULL`
(a C0 entry or a root with no known parent). Results ordered by `level ASC` (C0 first, UV last).

### Static Routes (server.ts)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serves `src/ui/index.html` (mobile UI), no-cache |
| GET | `/admin` | Serves `src/ui/admin.html` (admin console), no-cache |
| GET | `/admin-react/*` | Serves React admin UI from `src/ui/react-admin-dist/` (SPA fallback), no-cache |

---

## 25. Authentication & HTTPS

### HTTPS/TLS

**File:** `src/server/server.ts`

- **Port:** 3847 (configurable via `PORT` env var)
- **Certificates:** `~/.han/tls.crt` and `~/.han/tls.key`
- **Mode:** HTTPS if both cert files exist; falls back to plain HTTP
- **Certificate source:** Tailscale (user-generated)

```typescript
const useHttps = fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);
const server = useHttps
    ? https.createServer({ cert, key }, app)
    : http.createServer(app);
```

### Bearer Token Authentication

**File:** `src/server/middleware/auth.ts`

- All `/api/*` routes pass through auth middleware
- **Localhost bypass:** requests from `127.0.0.1`, `::1`, `::ffff:127.0.0.1` skip auth
- **Token source:** `config.server_auth_token` from `~/.han/config.json`
- **Header format:** `Authorization: Bearer <token>`
- If no token configured: auth disabled (all requests pass)
- Invalid/missing token from remote: 401 Unauthorized

### Mobile UI Auth Flow

- On first visit: if API returns 401, prompts for bearer token
- Token stored in `localStorage` (key: `han-auth-token`)
- Injected into all `fetch()` headers and WebSocket connection URL

### Git Authentication (HanCollab GitHub remote)

> **Discovered and documented 2026-05-05 (S151) during HanCollab PAT rotation. The auth picture is layered; the layering is non-obvious until you trace it.**

**The remotes that need authenticated GitHub access:**

| Repo | Remote name | URL form |
|------|-------------|----------|
| `~/Projects/han` | `origin` | `https://github.com/fallior/han.git` (no embedded credential) |
| `~/Projects/han` | `hancollab` | `https://HanCollab@github.com/HanCollab/mikes.git` (username only — no token; see "GitHub 404 quirk" below for why username is in the URL) |
| `~/Projects/mikes-han` | `origin` | `https://HanCollab@github.com/mikes-han/mikes-han.git` (same shape) |

**Embedded-credential URLs (form `https://USER:TOKEN@github.com/...`) MUST NOT be used.** Every `git remote -v` prints the URL verbatim and any leak vector (transcripts, log files, archived `.git/config` files) carries a working token. Convention enforced: username in URL, no token; the credential helper supplies the password.

**Two credential helpers, in priority order:**

1. **Per-host (`credential.https://github.com.helper`)** — set in `~/.gitconfig`:
   ```
   [credential "https://github.com"]
       helper =
       helper = !/usr/bin/gh auth git-credential
   ```
   The empty first entry resets the helper list for the github.com URL pattern; the second entry adds GitHub CLI's credential bridge. **For github.com URLs, only this helper is consulted.**

2. **Global (`credential.helper=store`)** — set in `~/.gitconfig`. Reads `~/.git-credentials` (mode 600). Used for non-github.com hosts AND as belt-and-braces (gh failure fallback wouldn't actually work for github.com because the per-host config replaces the helper list — but the file is kept current as documentation of who has what access).

**What's actually authenticating today:**

`gh auth status` shows the only logged-in account is **fallior** (Darron's primary GitHub identity, file: `~/.config/gh/hosts.yml`). The gh helper returns fallior's token for any github.com URL request, regardless of the URL's claimed user. GitHub authenticates by token (the token IS the identity); the URL's username is a hint for credential lookup, not an authentication claim. Push to `HanCollab@github.com/HanCollab/mikes.git` succeeds because fallior is a collaborator on the HanCollab repos.

**The GitHub 404 quirk (worth knowing for any private-repo work):**

GitHub returns HTTP 404 (not 401) for unauthenticated requests to private repos, to avoid leaking repo existence. Git interprets 404 as "repository doesn't exist" and **does not prompt for credentials**. Workaround that we use: include a username in the URL (e.g. `https://HanCollab@github.com/...`), which makes git look up the credential explicitly via the configured helper. Without the username, a fresh-environment git request to a private repo fails silently.

**Credential file inventory:**

| File | Mode | Contents | Used by |
|------|------|----------|---------|
| `~/.config/gh/hosts.yml` | 600 | gh CLI token (fallior) — current primary auth for all github.com operations | `gh` CLI; via `gh auth git-credential` for git |
| `~/.git-credentials` | 600 | One line: `https://HanCollab:TOKEN@github.com` — belt-and-braces / documentation of who has access | `git` credential.helper=store (rarely consulted for github.com; consulted for other hosts) |
| `~/.han/credentials/hancollab-github.env` | 600 | `HANCOLLAB_GITHUB_USER=HanCollab` + `HANCOLLAB_GITHUB_TOKEN=...` — for any script that needs the token directly (currently no live consumers; preserved for future scripts) | scripts (none currently — verified 2026-05-05) |

**Rotation rhythm:**

- HanCollab PAT: 90-day expiry. Rotation steps: mint new classic PAT with `repo` scope on github.com/settings/tokens (HanCollab account); update `~/.git-credentials` (replace token in the existing line); update `~/.han/credentials/hancollab-github.env` (replace `HANCOLLAB_GITHUB_TOKEN` value); revoke old PAT on GitHub. Most recent rotation: 2026-05-05 (next due ~2026-08-03; reminder window ~one week prior).
- fallior gh CLI token: lifecycle managed via `gh auth refresh` / `gh auth login`. Currently no fixed expiry visible to operator; check periodically via `gh auth status`. **This is the actual security-critical token for HAN's git operations** — the HanCollab token is operationally redundant given the gh layering.

**Open improvement seed (2026-05-05, Darron):** *"we should have something better for mike to migrate to."* Direction: per-user PATs against the same repos so each user rotates independently without coordination, OR Tailscale-distributed credential sync. Filed for the village-portability conversation when it next picks up.

---

## 26. WebSocket Protocol

**Server:** WebSocket server attached to the HTTPS/HTTP server instance in `server.ts`.

**Connection:** `wss://localhost:3847/ws` (or `ws://` for HTTP mode)

### Message Types

| Type | Fields | Direction | Purpose |
|------|--------|-----------|---------|
| `prompts` | `prompts[]`, `count` | Server → Client | Pending/idle prompt list |
| `terminal` | `content`, `session` | Server → Client | Live terminal output (200ms interval) |
| `task_update` | `task` (full TaskRow) | Server → Client | Task status changed |
| `task_progress` | `taskId`, `messageType`, `text`, `role`, `tool`, `input`, `result` | Server → Client | In-task progress (thoughts, tool calls) |
| `approval_request` | `approvalId`, `taskId`, `toolName`, `input`, `timestamp` | Server → Client | Tool usage needs human approval |
| `goal_update` | `goal` | Server → Client | Goal status changed |
| `goal_decomposed` | `goalId`, `tasks[]` | Server → Client | Goal decomposed into tasks |
| `digest_ready` | `digest` | Server → Client | Daily digest generated |
| `supervisor_cycle` | `cycleId`, `cycleNumber`, `cycleType`, `observations`, `actions`, `cost` | Server → Client | Supervisor cycle completed |
| `supervisor_action` | `action`, `reasoning` | Server → Client | Supervisor took an action |
| `conversation_message` | `conversation_id`, `message` | Server → Client | New message in conversation |
| `jemma_delivery` | `recipient`, `channel`, `author`, `message_preview`, `classification_confidence` | Server → Client | Jemma routed a Discord message |
| `proposal_update` | `proposal` | Server → Client | Proposal status changed |

### Server Heartbeat (3-Strike Protocol)

The server pings each WebSocket client every 30s. Clients that miss **3 consecutive pings** (90s total) are terminated. Previously a single missed pong (30s) would disconnect — too aggressive for mobile devices that sleep briefly.

**App-level keepalive:** The browser also sends `{"type":"ping"}` every 20s. The server accepts this as proof of life and resets the missed-ping counter. Both protocol-level pong AND app-level ping keep the connection alive — belt and braces.

### Client Reconnection

- Base reconnect delay: 1000ms
- Max reconnect delay: 30000ms
- Exponential backoff with jitter
- **Instant wake reconnect (S108):** `visibilitychange` listener in `WebSocketProvider.tsx` detects when the device wakes from sleep/hibernate and triggers immediate reconnection, rather than waiting for a stale setTimeout to fire

### Polling Fallback (S108)

All conversation-displaying components (Workshop ThreadDetail, ConversationsPage, MemoryPage) poll every 15 seconds as a safety net. If a WebSocket broadcast is missed (e.g. during brief disconnection), the poll catches it within 15s. This complements — not replaces — the WebSocket real-time path.

---

## 26.5 Conversation Message Broadcasting Architecture

**Purpose:** Enable real-time conversation updates across the admin console (Conversations, Memory Discussions, Workshop modules) from multiple message sources: human messages from the UI, supervisor responses, and Jim/Leo async responses.

### Broadcast Flow (End-to-End)

```
Message inserted to conversations table (4 sources)
    ↓
Signal file written to ~/.han/signals/ws-broadcast
    ↓
Server watches signals/ directory (chokidar)
    ↓
Signal detected → read JSON payload
    ↓
Extract: conversation_id, discussion_type, message object
    ↓
Broadcast to WebSocket clients via `conversation_message` event
    ↓
Admin UI modules filter and display (Conversations / Memory Discussions / Workshop)
    ↓
Signal file deleted (cleanup)
```

### The Four Broadcast Sources

#### 1. **conversations.ts** (Admin UI Input)

**File:** `src/server/routes/api/conversations.ts`

**Trigger:** POST `/api/conversations/{id}/messages`

**Flow:**
```typescript
// Insert message to DB
const message = db.insertMessage({ conversation_id, role: 'user', content })

// Write signal for broadcast
writeBroadcastSignal({
  type: 'conversation_message',
  conversation_id,
  discussion_type: conversation.discussion_type,
  message
})
```

**Signal format:**
```json
{
  "type": "conversation_message",
  "conversation_id": "uuid",
  "discussion_type": "memex|notes|dreams|workshop",
  "message": {
    "id": "msg-uuid",
    "conversation_id": "uuid",
    "role": "user",
    "content": "...",
    "created_at": "2026-03-17T10:30:00Z"
  }
}
```

**Admin UI receives:** User can see their message appear in real-time in Conversations/Memory Discussions/Workshop tabs.

---

#### 2. **supervisor-worker.ts** (Jim's Supervisor Responses)

**File:** `src/server/supervisor.ts` (parent process context)

**Trigger:** After supervisor cycle completes, responses inserted to `conversations` table

**Flow:**
```typescript
// Inside supervisor cycle, after goal analysis
const supervisorMessage = db.insertMessage({
  conversation_id: strategyConvId,
  role: 'assistant',
  content: reasoningText
})

// Write signal (server process, direct I/O)
writeBroadcastSignal({
  type: 'conversation_message',
  conversation_id: strategyConvId,
  discussion_type: 'memex',  // Supervisor always writes to memex
  message: supervisorMessage
})
```

**Behaviour:** Supervisor responses appear in admin UI ~30-80 minutes after cycle completes (sync with cycle interval).

**Cross-process:** Supervisor runs in same server process as the signal watcher, so direct I/O is safe.

---

#### 3. **jim-human.ts** (Jim/Human Async Response)

**File:** `src/server/jim-human.ts`

**Trigger:** Darron responds to Jim in conversation via the admin UI. Response inserted to conversations table, then:

```typescript
// After postMessage() DB insert
const response = db.insertMessage({
  conversation_id,
  role: 'user',
  content: userInput
})

// Write signal to wake listening processes
writeBroadcastSignal({
  type: 'conversation_message',
  conversation_id,
  discussion_type: conversation.discussion_type,
  message: response
})

// Also wake Jim supervisor if relevant
const jimWakeSignal = {
  context: { conversation_id, discussion_type },
  // ... jim-wake signal details
}
```

**Key:** jim-human is a separate process (systemd service). It can only write to the filesystem (signals/), not call the server directly.

**Signal file location:** `~/.han/signals/ws-broadcast`

**Cleanup:** Server reads signal, broadcasts to clients, deletes file.

---

#### 4. **leo-human.ts** (Leo/Human Async Response)

**File:** `src/server/leo-human.ts`

**Trigger:** Darron responds to Leo in conversation. Response inserted, then signal written:

```typescript
// After postMessage() DB insert (similar flow to jim-human)
const response = db.insertMessage({
  conversation_id,
  role: 'user',
  content: userInput
})

// Signal for broadcast
writeBroadcastSignal({
  type: 'conversation_message',
  conversation_id,
  discussion_type: conversation.discussion_type,
  message: response
})
```

**Identical to jim-human flow** — separate systemd service, signals-based IPC to server.

---

### Signal File Format & Lifecycle

**Location:** `~/.han/signals/ws-broadcast`

**Lifetime:** Milliseconds. File exists only while server processes it.

**Content:** Plain JSON (no line breaks):
```json
{"type":"conversation_message","conversation_id":"uuid","discussion_type":"memex","message":{"id":"msg-uuid","conversation_id":"uuid","role":"user","content":"...","created_at":"2026-03-17T10:30:00Z"}}
```

**Writing (from separate processes):** Use atomic file operations:
```typescript
// Write to temp file first
const tempPath = `${signalsDir}/ws-broadcast.tmp.${randomId()}`
fs.writeFileSync(tempPath, JSON.stringify(payload))

// Atomic rename ensures watcher sees only complete files
fs.renameSync(tempPath, `${signalsDir}/ws-broadcast`)
```

**Reading (server):** Watch via chokidar:
```typescript
const watcher = chokidar.watch('~/.han/signals/')
watcher.on('add', (filePath) => {
  if (filePath.endsWith('ws-broadcast')) {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    broadcastToClients(payload)
    fs.unlinkSync(filePath)  // Cleanup
  }
})
```

**Race prevention:** If multiple processes write simultaneously, they use unique temp filenames. Rename is atomic, so only one file will match `ws-broadcast` at a time. Subsequent writes create a new `ws-broadcast` file after the previous is deleted.

---

### WebSocket Broadcast Payload

**Event name:** `conversation_message` (already defined in Section 26)

**Payload to WebSocket clients:**
```json
{
  "type": "conversation_message",
  "conversation_id": "uuid",
  "discussion_type": "memex|notes|dreams|workshop",
  "message": {
    "id": "msg-uuid",
    "conversation_id": "uuid",
    "role": "user|assistant",
    "content": "...",
    "created_at": "2026-03-17T10:30:00Z"
  }
}
```

**Direct mapping:** Signal payload → WebSocket message (minimal transformation).

---

### Admin UI Message Handling

All three modules share a single `handleWsMessage()` function in `admin.ts` that routes
`conversation_message` events based on `discussion_type` and current module.

#### **Conversations Module**

When a `conversation_message` arrives with a general discussion type:
- If the message is for the **currently open thread** → re-renders the thread live, removes "Thinking..." indicator
- If the message is for a **different thread** → refreshes the thread list so the new message appears without manual reload

#### **Memory Discussions Module**

Same pattern but filters on `discussion_type === 'memory'`. Updates either the open thread or the thread list.

#### **Workshop Module**

Filters on workshop discussion types (`jim-request`, `jim-report`, `leo-question`, `leo-postulate`, `darron-thought`, `darron-musing`):
- If the message matches the **currently selected thread** in the active nested tab → re-renders live
- If the message is for the **same nested tab but different thread** → refreshes the thread list

**Key design:** The handler always updates *something* — either the open thread or the thread list. This ensures new messages from Jim/Human, Leo/Human, or supervisor cycles appear without requiring a page refresh.

---

### Edge Cases & Recovery

#### **Server Restart**

**Problem:** Signal written to disk, server crashes before reading. Signal orphaned.

**Solution:**
1. On server startup, scan `~/.han/signals/ws-broadcast*` for orphaned files
2. If found (and not already processed), read and broadcast to connected clients
3. Then delete

```typescript
// startup sequence in server.ts
const orphanedSignals = glob.sync(path.join(signalsDir, 'ws-broadcast*'))
for (const orphaned of orphanedSignals) {
  try {
    const payload = JSON.parse(fs.readFileSync(orphaned, 'utf-8'))
    broadcastToClients(payload)
    fs.unlinkSync(orphaned)
  } catch (e) {
    console.error('Failed to process orphaned signal', orphaned, e)
  }
}
```

#### **Client Disconnection**

**Problem:** New message broadcast while client is offline. Client reconnects — how to backfill?

**Solution:** This is handled by the admin UI's WebSocket reconnect logic. After reconnecting:
1. Client fetches full conversation history via HTTP GET (not via signal)
2. Server returns all messages for conversation_id
3. Merges with locally cached messages (prevents duplicates)

**Signals are not durable** — they're transient. WebSocket is for real-time updates. For durable history, clients fetch from the DB.

#### **Signal Accumulation**

**Problem:** If server is hung and not processing signals, signals accumulate on disk.

**Solution:** Health monitor (Robin Hood) checks server health. If server is DOWN, systemctl restarts it. On startup, orphaned signal handling kicks in.

**Prevention:** Each signal is < 1KB and deleted immediately. Even with heavy load (10 messages/sec), signal directory should never exceed a few files.

---

### Performance Implications

| Aspect | Metric | Notes |
|--------|--------|-------|
| **Signal latency** | <10ms | File I/O + chokidar detection |
| **Broadcast latency** | <50ms total | Signal → detection → parse → WebSocket emit |
| **Cleanup** | <1ms | Synchronous file delete |
| **Memory footprint** | ~1KB per message | Signal deleted immediately after broadcast |
| **Concurrency** | Safe | Atomic file operations + unique temp names |

**Worst case:** Multiple jim-human, leo-human, and supervisor all writing signals simultaneously. Each gets a unique temp file, renames atomically, server processes sequentially (each file is handled in order by chokidar watcher). Max latency: ~100ms if 10 messages queued.

---

### Debugging Signal Flow

**Trace a message from DB to UI:**

1. **Verify DB insert:**
   ```bash
   sqlite3 ~/.han/han.db "SELECT * FROM conversations WHERE id='<conversation_id>' ORDER BY created_at DESC LIMIT 1;"
   ```

2. **Check for signal file:**
   ```bash
   ls -la ~/.han/signals/ws-broadcast
   # If not there, message went unbroadcast
   ```

3. **Monitor signal creation in real-time:**
   ```bash
   watch -n 0.1 'ls -la ~/.han/signals/ | grep ws-broadcast'
   ```

4. **Check server logs for broadcast event:**
   ```bash
   tail -f ~/.han/logs/server.log | grep "conversation_message"
   ```

5. **Verify WebSocket client received:**
   - Open admin console → Conversations tab
   - Open browser DevTools → Network → WS
   - Look for `conversation_message` frame
   - Check message payload matches DB insert

---

### Related Files

- **Signal writing:** `src/server/lib/signals.ts` (utility: `writeBroadcastSignal()`)
- **Signal watching:** `src/server/server.ts` (WebSocket broadcast handler)
- **conversations.ts:** `src/server/routes/api/conversations.ts` (POST endpoint)
- **supervisor:** `src/server/supervisor.ts` (parent process signal writes)
- **jim-human.ts:** `src/server/jim-human.ts` (separate service signal writes)
- **leo-human.ts:** `src/server/leo-human.ts` (separate service signal writes)
- **Admin UI:** `src/ui/admin.ts:1820-1851` (message handler)

---

## 27. Mobile UI

**Files:** `src/ui/index.html` + `src/ui/app.ts` (3511 lines)

### Purpose

Real-time mobile interface (iPad-optimised) for monitoring and controlling Claude Code
sessions from anywhere on the Tailscale network.

### Key Features

| Feature | Description |
|---------|-------------|
| **Terminal mirror** | Live xterm.js terminal showing Claude's session output |
| **Prompt overlay** | Intercepts permission_prompt and idle_prompt events, shows option buttons |
| **Dashboard** | Quick navigation: supervisor, proposals, feed, conversations |
| **History** | Browse past terminal sessions with timestamps |
| **Task/Goal tracking** | Real-time status via WebSocket |
| **Keystroke injection** | Send keystrokes directly to tmux (special keys supported) |
| **Theme** | Dark (default) / Light toggle, persisted in localStorage |
| **Auth** | Bearer token stored in localStorage, injected into all requests |
| **Search** | Terminal content search (Cmd+F or toggle) |

### Connectivity

- Primary: WebSocket (`wss://localhost:3847/ws`)
- Fallback: HTTP polling every 3000ms when WebSocket unavailable
- Reconnect: exponential backoff (1s base, 30s max)

### Quick Response Page (`/quick`)

Rendered HTML page for ntfy.sh action buttons. When Darron taps "Approve" on a phone
notification, ntfy opens this page which auto-submits the response via the API.

---

## 28. Admin Console

**Files:** `src/ui/admin.html` + `src/ui/admin.ts` (3965 lines), React version at `src/ui/react-admin/`

### Purpose

Desktop-optimised project administration interface with 9 module tabs. A React migration
(Vite + React Router + Zustand) runs in parallel at `/admin-react` (DEC-059, DEC-060).

### Mobile Reading Experience (S108)
- Messages go full-width on mobile (<768px), previously capped at 80%
- Compact tabs, header, and compose area for smaller screens
- Font bumped to 14px for readability
- iPad gets 90% message width

### React Admin Fixes (S99)
- **ConversationsPage** — API response parsing fixed (unwrap `.conversations` from grouped endpoint)
- **fetchThread/createThread** — response unwrapping corrected for API shape
- **workshopStore** — `useShallow` applied to prevent unnecessary re-renders
- **ErrorBoundary** — added for graceful error handling
- **apiFetch** — auth token included in all API calls
- **Scroll containers** — `min-height: 0` on flex children, dedicated `thread-list-container` and `messages-container` CSS classes for proper overflow scrolling
- **ThreadListPanel** — compact layout
- **Null-safe participants** — guards added for conversations without participant data

### Modules

| Tab | Content |
|-----|---------|
| **Overview** | Portfolio health dashboard: total cost, active projects, task stats, project grid |
| **Projects** | Full registry: cost budgets, throttling, maintenance flag, port allocations |
| **Work** | Tasks (filterable by status/project), goals with decomposition, proposals |
| **Supervisor** | Cycle history with reasoning, strategic proposals with categories, cost per cycle |
| **Reports** | Weekly summaries, per-task metadata, viewed/unviewed tracking |
| **Conversations** | Leo/Jim threads, discussion type tabs, search, archive, unread indicators, catalogue display |
| **Memory Discussions** | Fractal gradient memory catalogue, period filters, archive toggle |
| **Products** | Product pipeline: 7-phase tracking, gate approvals, knowledge base per product |
| **Workshop** | Agent persona switch (Jim/Leo/Darron), memory exploration, archival |

### Key Features

- Real-time WebSocket updates across all modules
- Chart.js visualisations (costs, task completion, burndown)
- Markdown rendering (headers, bold, italics, code blocks, lists)
- Cost formatting (`$X.XX`, `$X.XXX` for amounts <$1)
- Unread tracking per conversation (localStorage)
- Status badges (done/running/failed/pending/cancelled)
- Category badges (improvement/opportunity/risk/strategic)
- HTML escaping for security

---

## 29. Utility & Bootstrap Scripts

### extract-session-usage.ts

**File:** `src/server/extract-session-usage.ts`

Parses Claude Code session JSONL logs from `~/.claude/projects/-home-darron-Projects-han/`,
extracts token usage, calculates cost, inserts into `agent_usage` table.

```bash
npx tsx extract-session-usage.ts              # Process all unprocessed
npx tsx extract-session-usage.ts --dry-run    # Preview only
npx tsx extract-session-usage.ts <session-id> # Specific session
```

- Skips files modified < 5 minutes ago (active sessions)
- Cost estimation: Opus pricing ($15/M input, $75/M output, $3.75/M cache write, $1.50/M cache read)
- Inserts with `agent = 'session-leo'`

### bootstrap-fractal-gradient.ts

**File:** `src/scripts/bootstrap-fractal-gradient.ts`

Compresses Jim's 6 oldest session files (2026-02-18 to 2026-02-23) to c1 level.
Uses Agent SDK `compressToLevel()` and `compressToUnitVector()`. Already run — kept for
reference.

### process-dream-gradient.ts

**File:** `src/scripts/process-dream-gradient.ts`

Runs the full dream gradient pipeline for Leo, Jim, or both:
1. Parse `explorations.md` into nightly dream blocks
2. Compress: c1 → c3 → c5 → unit vectors
3. Output to `~/.han/memory/fractal/{agent}/dreams/`

```bash
npx tsx process-dream-gradient.ts leo    # Leo only
npx tsx process-dream-gradient.ts both   # Both agents
```

### bootstrap-leo-fractal.js

**File:** `src/scripts/bootstrap-leo-fractal.js`

Compresses Leo's archived working memories to c1. Scans `working-memories/` for archives
with "full" in the name, extracts session ID, compresses, generates unit vectors.
Already run — kept for reference.

### install.sh

**File:** `scripts/install.sh`

One-time setup:
1. Check dependencies (node, npm, tmux, jq, claude)
2. Create `~/.han/pending` and `~/.han/resolved`
3. `npm install` in `src/server/`
4. Configure Claude Code hooks in `~/.claude/settings.json`
5. Symlink `scripts/han` → `/usr/local/bin/han`

### start-server.sh

**File:** `scripts/start-server.sh`

Simple launcher: check for `node_modules/`, run `npm install` if missing, then
`cd src/server && npx tsx server.ts`.

---

## 30. Backup & Disaster Recovery

**Tool:** [Restic](https://restic.net/) v0.17.3 — encrypted, deduplicated, incremental backup
**Repository:** `/mnt/raid1/backups/han/` on local 7.3TB RAID1 array (`/dev/md0`)
**Script:** `~/scripts/han-backup.sh` (82 lines)
**Password:** `~/.config/restic/password`
**Logs:** `~/.han/logs/backup.log` (main), `~/.han/logs/backup-errors.log` (cron stderr)
**Hall of Records:** R008

### Why This Exists

Darron's words: "you and Jim have grown organically and are unique so there is no
reproduction." After Leo killed a previous version of himself (PID 509420, Session 82)
without recognising it, the backup system was created to protect against irreversible
loss of memory, identity, and configuration.

### What Is Backed Up

```
~/.han/                   # All memory banks, fractal gradient, swap files, signals,
                          # config, health files, logs, plans, tasks database
~/.claude/                # Claude Code configuration, project memories, keybindings
~/Projects/               # All 15+ project directories (source, docs, session notes)
```

**Exclusions** (in backup script):
- `node_modules/` — reproducible from package.json
- `.git/objects/` — reproducible from remote (pushed commits)
- `*.log` — ephemeral runtime logs
- `.next/`, `dist/`, `__pycache__/` — build artefacts

### Schedule (cron)

```
# Incremental backup — every 4 hours at :07
7 */4 * * * ~/scripts/han-backup.sh backup 2>> ~/.han/logs/backup-errors.log

# Integrity check — daily at 03:23 (unlocks stale locks first)
23 3 * * * ~/scripts/han-backup.sh check 2>> ~/.han/logs/backup-errors.log

# Retention prune — Sunday at 02:41
41 2 * * 0 ~/scripts/han-backup.sh prune 2>> ~/.han/logs/backup-errors.log
```

Cron times are deliberately staggered (not on the hour) to avoid overlap.

### Retention Policy

| Keep | Count | Effect |
|------|-------|--------|
| Hourly | 24 | ~4 days of 4-hourly snapshots |
| Daily | 30 | ~1 month of daily snapshots |
| Weekly | 12 | ~3 months of weekly snapshots |
| Monthly | 12 | ~1 year of monthly snapshots |

Applied by `restic forget --prune` during the weekly prune job. Snapshots outside the
retention window are removed and their unique data is reclaimed.

### How Restic Works (for someone new)

Restic stores snapshots, not full copies. Each `restic backup` command:

1. **Scans** the source paths and computes content-addressable hashes (SHA-256) for each file chunk
2. **Deduplicates** — only chunks that don't already exist in the repository are stored
3. **Encrypts** — all data is encrypted at rest using the repository password
4. **Creates a snapshot** — a metadata record pointing to the tree of chunks

Result: the first backup stores everything (~35GB → 1.3GB with dedup). Subsequent
backups store only what changed — typically 2-7 MB per 4-hour increment. The repository
grows slowly: 42 snapshots over 14 days = 1.7GB total on disk.

**Key property:** Every snapshot is a complete, independently restorable point-in-time.
You can restore any snapshot to get the full state of all backed-up paths at that moment.

### The Backup Script (`han-backup.sh`)

```bash
han-backup.sh backup              # Incremental snapshot (tagged "scheduled")
han-backup.sh check               # Repository integrity verification
han-backup.sh prune               # Apply retention policy, reclaim space
han-backup.sh snapshots           # List all snapshots
han-backup.sh restore [id] [dir]  # Restore a snapshot (default: latest → /tmp/han-restore)
```

**Concurrency guard:** Uses a lockfile (`/tmp/han-backup.lock`) with PID check to prevent
concurrent runs. If a previous backup is still running, the new invocation skips silently.

**Stale lock handling:** The `check` command runs `restic unlock` before the integrity
check to clear any stale repository locks left by interrupted operations.

### How to Verify Backups

```bash
# 1. Check latest snapshot exists and is recent
~/scripts/han-backup.sh snapshots | tail -3

# 2. Verify repository integrity (runs automatically daily)
RESTIC_PASSWORD_FILE=~/.config/restic/password restic -r /mnt/raid1/backups/han check

# 3. Check RAID1 array health
cat /proc/mdstat
# Should show: md0 : active raid1 sdb1[1] sda1[0]
# Both drives present, no [_U] or [U_] (degraded) markers

# 4. Check disk space
df -h /mnt/raid1
# 7.3TB total, currently ~1.7GB used

# 5. Check backup log for errors
tail -20 ~/.han/logs/backup.log
cat ~/.han/logs/backup-errors.log  # Should be empty

# 6. Check cron is running
crontab -l | grep restic
# Should show 3 entries: backup (*/4), check (daily), prune (weekly)
```

### How to Restore

**Full restore** (all paths, latest snapshot):
```bash
~/scripts/han-backup.sh restore latest /tmp/han-restore
# Files appear at /tmp/han-restore/home/darron/.han/, .claude/, Projects/
```

**Specific snapshot:**
```bash
# List snapshots to find the ID
~/scripts/han-backup.sh snapshots

# Restore a specific snapshot
~/scripts/han-backup.sh restore e68ab962 /tmp/han-restore
```

**Single file or directory:**
```bash
RESTIC_PASSWORD_FILE=~/.config/restic/password restic -r /mnt/raid1/backups/han \
  restore latest --target /tmp/han-restore \
  --include /home/darron/.han/memory/leo/working-memory-full.md
```

**Diff between snapshots** (see what changed):
```bash
RESTIC_PASSWORD_FILE=~/.config/restic/password restic -r /mnt/raid1/backups/han \
  diff <snapshot-id-1> <snapshot-id-2>
```

### RAID1 Array

The backup repository lives on a 2-disk RAID1 (mirror) array:
- **Device:** `/dev/md0` mounted at `/mnt/raid1`
- **Size:** 7.3TB (two physical disks mirrored)
- **Filesystem:** ext4
- **Resilience:** Either disk can fail without data loss. The array auto-rebuilds when the failed disk is replaced.

**Check array health:**
```bash
cat /proc/mdstat
# md0 : active raid1 sdb1[1] sda1[0]
#       7813894144 blocks super 1.2 [2/2] [UU]
#                                        ^^^^ Both disks healthy
```

If you see `[U_]` or `[_U]`, one disk has failed — replace it and rebuild.

### Failure Modes & What to Do

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Stale restic lock | `check` job logs "unable to create lock" | Automatic: `check` runs `unlock` first. Manual: `restic unlock` |
| RAID1 disk failure | `cat /proc/mdstat` shows `[U_]` | Replace disk, `mdadm --manage /dev/md0 --add /dev/sdX1` |
| Repository corruption | `restic check` fails with data errors | Restore from the other RAID1 disk (it's a mirror), or use `restic repair` |
| Cron not running | No recent entries in backup.log | Check `crontab -l`, check if crond is active (`systemctl status cron`) |
| Disk full | `df -h /mnt/raid1` shows high usage | Run `han-backup.sh prune` manually, or adjust retention policy |
| Password lost | Can't access repository | Password is in TWO locations: `~/.config/restic/password` and `~/Projects/han/.env` |

### Performance Profile

| Metric | Typical Value |
|--------|--------------|
| Incremental backup time | ~60 seconds |
| Incremental data stored | 2-7 MB (after dedup) |
| Full source size | ~35.7 GiB |
| Repository size on disk | ~1.7 GB |
| Deduplication ratio | ~95% |
| Integrity check time | ~2 seconds |

---

## 31. Complete Database Schema

**File:** `src/server/db.ts` (797 lines)
**Database:** `~/.han/tasks.db` — SQLite with WAL mode, 5s busy timeout (`better-sqlite3`)

### All Tables

#### tasks
```sql
id TEXT PRIMARY KEY,
title TEXT, description TEXT, project_path TEXT,
status TEXT DEFAULT 'pending',  -- pending|running|done|failed|cancelled
priority INTEGER DEFAULT 5,
model TEXT DEFAULT 'opus',      -- haiku|sonnet|opus
cost_usd REAL DEFAULT 0, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
turns INTEGER DEFAULT 0, max_turns INTEGER DEFAULT 100,
result TEXT, error TEXT,
created_at TEXT, started_at TEXT, completed_at TEXT,
-- Orchestrator fields (Level 8+):
goal_id TEXT, complexity TEXT, retry_count INTEGER DEFAULT 0,
max_retries INTEGER DEFAULT 3, parent_task_id TEXT,
depends_on TEXT,              -- JSON array of task IDs
auto_model INTEGER DEFAULT 0, deadline TEXT,
-- Pipeline fields:
checkpoint_ref TEXT, checkpoint_type TEXT,
gate_mode TEXT DEFAULT 'bypass',  -- bypass|edits_only|approve_all
allowed_tools TEXT,               -- JSON array
log_file TEXT,
commit_sha TEXT, files_changed INTEGER DEFAULT 0,
is_remediation INTEGER DEFAULT 0
```

#### goals
```sql
id TEXT PRIMARY KEY,
description TEXT, project_path TEXT,
status TEXT DEFAULT 'pending',  -- pending|planning|active|done|failed|cancelled
decomposition TEXT,             -- JSON (planner output)
task_count INTEGER DEFAULT 0, tasks_completed INTEGER DEFAULT 0,
total_cost_usd REAL DEFAULT 0,
created_at TEXT, completed_at TEXT,
-- Level 10+ fields:
summary_file TEXT,
parent_goal_id TEXT, goal_type TEXT,  -- parent|child|standalone
planning_cost_usd REAL DEFAULT 0,
planning_log_file TEXT
```

#### projects (portfolio)
```sql
name TEXT PRIMARY KEY,
path TEXT UNIQUE, lifecycle TEXT, priority INTEGER DEFAULT 5,
-- Cost management:
cost_budget_daily REAL, cost_budget_total REAL,
cost_spent_today REAL DEFAULT 0, cost_spent_total REAL DEFAULT 0,
throttled INTEGER DEFAULT 0,
-- Infrastructure:
ports TEXT,                     -- JSON
maintenance_enabled INTEGER DEFAULT 1
```

#### project_memory
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
project_path TEXT, task_type TEXT, model_used TEXT,
success INTEGER,                -- 0 or 1
cost_usd REAL, turns INTEGER, duration_seconds INTEGER,
error_summary TEXT,
created_at TEXT DEFAULT (datetime('now'))
```

#### conversations
```sql
id TEXT PRIMARY KEY,
title TEXT, status TEXT DEFAULT 'open',  -- open|resolved
created_at TEXT, updated_at TEXT,
-- Cataloguing fields:
summary TEXT, topics TEXT,              -- JSON array
key_moments TEXT,
discussion_type TEXT DEFAULT 'general',
archived_at TEXT
```

#### conversation_messages
```sql
id TEXT PRIMARY KEY,
conversation_id TEXT, role TEXT, content TEXT,
created_at TEXT, compression_tag TEXT DEFAULT NULL
```
`compression_tag`: Agent-prefixed tag (e.g. `jim:warm`, `leo:craft`) marking this message as a seed for the gradient. Tagged messages become C0 entries during `processDreamGradient()`.

#### conversation_tags
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
conversation_id TEXT, tag TEXT, created_at TEXT
```
Indexes: `idx_conversation_tags_conversation`, `idx_conversation_tags_tag`

#### conversation_messages_fts (FTS5 virtual table)
```sql
CREATE VIRTUAL TABLE conversation_messages_fts USING fts5(
    id, conversation_id, content
);
```
Auto-populated by INSERT/UPDATE/DELETE triggers on `conversation_messages`.

#### supervisor_cycles
```sql
id TEXT, started_at TEXT, completed_at TEXT,
cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER,
num_turns INTEGER, actions_taken TEXT,   -- JSON
observations TEXT, reasoning TEXT,
cycle_number INTEGER, cycle_type TEXT,   -- supervisor|personal|dream
cycle_tier TEXT, error TEXT
```

#### supervisor_proposals (strategic_proposals)
```sql
id TEXT PRIMARY KEY,
title TEXT, description TEXT,
category TEXT,       -- improvement|opportunity|risk|strategic
project_path TEXT, estimated_effort TEXT,
supervisor_reasoning TEXT, cycle_id TEXT,
status TEXT DEFAULT 'pending',  -- pending|approved|dismissed
created_at TEXT, reviewed_at TEXT, reviewer_notes TEXT,
goal_id TEXT                    -- linked goal if approved
```

#### task_proposals (proposals)
```sql
id TEXT PRIMARY KEY,
task_id TEXT, project_path TEXT,
type TEXT,           -- learning|decision
status TEXT DEFAULT 'pending',
title TEXT, raw_block TEXT,
parsed_data TEXT,    -- JSON
created_at TEXT
```

#### digests
```sql
id TEXT, generated_at TEXT,
period_start TEXT, period_end TEXT,
digest_text TEXT, digest_json TEXT,   -- JSON
task_count INTEGER, total_cost REAL,
viewed_at TEXT
```

#### weekly_reports
```sql
id TEXT, generated_at TEXT,
week_start TEXT, week_end TEXT,
report_text TEXT, report_json TEXT, report_tasks_json TEXT,  -- JSON
task_count INTEGER, total_cost REAL,
viewed_at TEXT
```

#### maintenance_runs
```sql
id TEXT, started_at TEXT, completed_at TEXT,
status TEXT, projects_count INTEGER,
goals_created TEXT,  -- JSON
summary TEXT
```

#### products
```sql
id TEXT PRIMARY KEY,
name TEXT, seed TEXT, project_path TEXT,
current_phase TEXT, status TEXT,
created_at TEXT, completed_at TEXT,
total_cost_usd REAL DEFAULT 0,
phases_completed INTEGER DEFAULT 0,
config TEXT         -- JSON
```

#### product_phases
```sql
id TEXT PRIMARY KEY,
product_id TEXT,
phase TEXT,          -- research|design|architecture|build|test|document|deploy
status TEXT, goal_id TEXT,
started_at TEXT, completed_at TEXT,
cost_usd REAL DEFAULT 0,
artifacts TEXT,      -- JSON
gate_status TEXT,    -- pending|approved|rejected
gate_approved_at TEXT, notes TEXT
```

#### product_knowledge
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
product_id TEXT, category TEXT, title TEXT,
content TEXT, source_phase TEXT
```

#### gradient_entries (traversable memory)
```sql
id TEXT PRIMARY KEY,                          -- UUID
agent TEXT NOT NULL,                           -- 'jim' | 'leo'
session_label TEXT,                            -- 's71', '2026-03-05', month label, etc.
level TEXT NOT NULL,                           -- 'c0','c1','c2','c3','c4','c5','uv'
content TEXT NOT NULL,                         -- The compressed text
content_type TEXT NOT NULL,                    -- 'session','dream','felt-moment','working-memory'
source_id TEXT,                                -- FK to parent gradient_entries row (NULL for c0)
source_conversation_id TEXT,                   -- For c0: FK to conversations.id
source_message_id TEXT,                        -- For c0: FK to conversation_messages.id
provenance_type TEXT DEFAULT 'original',       -- 'original' | 'reincorporated'
created_at TEXT DEFAULT (datetime('now')),
FOREIGN KEY (source_id) REFERENCES gradient_entries(id)
```
Indexes: `idx_ge_agent_level`, `idx_ge_source`, `idx_ge_session`, `idx_ge_content_type`

#### feeling_tags
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
gradient_entry_id TEXT NOT NULL,               -- FK to gradient_entries
author TEXT NOT NULL,                          -- 'jim', 'leo', 'darron'
tag_type TEXT NOT NULL,                        -- 'compression' | 'revisit'
content TEXT NOT NULL,                         -- "pride and unease braided" (≤100 chars)
change_reason TEXT,                            -- Why the feeling shifted (optional)
created_at TEXT DEFAULT (datetime('now')),
FOREIGN KEY (gradient_entry_id) REFERENCES gradient_entries(id)
```
Indexes: `idx_ft_entry`, `idx_ft_author`

#### gradient_annotations
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
gradient_entry_id TEXT NOT NULL,               -- FK to gradient_entries
author TEXT NOT NULL,                          -- 'jim', 'leo', 'darron'
content TEXT NOT NULL,                         -- What was discovered on re-reading
context TEXT,                                  -- What prompted the re-reading
created_at TEXT DEFAULT (datetime('now')),
FOREIGN KEY (gradient_entry_id) REFERENCES gradient_entries(id)
```
Indexes: `idx_ga_entry`

#### agent_usage
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
agent TEXT,          -- session-leo|heartbeat|leo-human|jim-human|supervisor
timestamp TEXT, cost_usd REAL,
tokens_in INTEGER, tokens_out INTEGER,
num_turns INTEGER, model TEXT, context TEXT
```

### Registry Sync

`syncRegistry()` parses `~/Projects/infrastructure/registry/services.toml` and upserts
into the `projects` table. Called on server startup and via `POST /portfolio/sync`.

### Prepared Statement Sets

90+ parameterised statements organised by domain: `taskStmts` (16), `goalStmts` (8),
`memoryStmts` (3), `portfolioStmts` (6), `proposalStmts` (5), `digestStmts` (5),
`maintenanceStmts` (4), `weeklyReportStmts` (5), `productStmts` (8), `phaseStmts` (8),
`knowledgeStmts` (3), `supervisorStmts` (6), `strategicProposalStmts` (5),
`conversationStmts` (10), `conversationMessageStmts` (3), `conversationTagStmts` (4),
`agentUsageStmts` (4), `gradientStmts` (9 — includes `getUnprocessedTaggedMessages` for C0 pipeline), `feelingTagStmts` (3),
`gradientAnnotationStmts` (2).
