# System Specification

> The living blueprint. When something looks wrong, check here first.
> If it's documented, it's intentional. If it's not, flag it for discussion.
>
> Last updated: S78 (2026-03-06) by Leo

## How To Use This Document

**Before modifying anything:** Check this spec. If the current behaviour matches what's
documented here, it's intentional — even if it looks wrong to you. If it doesn't match,
check the CHANGELOG.md for recent changes. If you still think it's wrong, raise it in
Workshop > Supervisor Jim > Requests. Do not revert without discussion.

**After modifying anything:** Update this spec and add a CHANGELOG entry.

---

## Agents

### Jim/Supervisor

| Property | Value | Source |
|----------|-------|--------|
| Source file | `src/server/services/supervisor-worker.ts` | |
| Agent directory | `~/.claude-remote/agents/Jim/` | |
| MAX_TURNS | 1000 (configurable via `config.json` `supervisor.max_turns_per_cycle`) | |
| Model | opus (configurable via `config.json` `supervisor.model`) | |
| Tools | Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch | S77: was Read-only Bash |
| Memory files (read) | identity.md, active-context.md, patterns.md, failures.md, self-reflection.md | Full content, NO truncation |
| Memory truncation | **None** on read. **None** on write. | S77: enforceTokenCap removed |
| Fractal gradient | Loads c0 (1 newest session), c1 (3), c2 (6), c3 (9), c4 (12), unit vectors (all) | |
| Conversation snapshot | 5 pending conversations shown | |
| Conversation preview | 200 chars | |
| Cycle rhythm | Weekly: sleep 22-06 (40min), morning 06-09 (20min), work 09-17 (20min), evening 17-22 (20min) | Hall of Records R001 |
| Work phase rotation | 1 supervisor : 2 personal | |
| Rest days | Sat (6), Sun (0) only (configurable via `config.json` `supervisor.rest_days`) | S78: removed Fri — was trapping Jim in 24h dream |
| Emergency mode | Activates when: running tasks > 0, pending > 5, or active goals exist. Overrides rhythm with 2-5min cycles. Auto-decays. | |
| Dream cycles | Sleep phase cycles. Prose output (not JSON). Captured in self-reflection.md and DB. | S77: was being discarded |
| Recovery mode | `RECOVERY_MODE_UNTIL` constant. When active: no supervisor cycles, all waking = recovery-focused personal. | S77: active until 2026-03-13 |
| Reply to human | **Immediate** — no cooldown or delay when Darron posts. Human messages bypass `LEO_COOLDOWN_MS` filter. | S78: documented |
| Reply to Leo | 10 min cooldown (`LEO_COOLDOWN_MS` in supervisor-worker.ts and conversations.ts) | |
| Daily budget | $300 (configurable via `config.json` `supervisor.daily_budget_usd`) | |

### Leo/Heartbeat

| Property | Value | Source |
|----------|-------|--------|
| Source file | `src/server/leo-heartbeat.ts` | |
| Agent directory | `~/.claude-remote/agents/Leo/` | |
| MAX_TURNS | 1000 (conversation, personal, philosophy — all contexts) | S77: was 8/12/12 |
| Model | opus > sonnet > haiku (cascading fallback) | |
| Tools (all contexts) | Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch | S77: was mixed/incomplete |
| Memory files (read) | identity.md, active-context.md, patterns.md, self-reflection.md, discoveries.md, working-memory.md, felt-moments.md | S77: felt-moments was missing |
| Memory truncation | **None** — readLeoMemory() reads full files | S77: was 800-char truncation |
| Jim context (read) | active-context.md, self-reflection.md, identity.md — full content | S77: was 500-char truncation |
| Fractal gradient | Loads c1 (3 newest), c2 (6), c3 (9), c4 (12), unit vectors (all) | S77: newly wired |
| Conversation messages | 60 per context | S77: was 3-8 |
| Discord context messages | 60 | S77: was 10 |
| Reply to human | **Immediate** — `REPLY_DELAY_MINUTES = 0`, no cooldown for human messages | S77: was 10 min |
| Reply to Jim | **Immediate** — same `REPLY_DELAY_MINUTES` applies | S77: was 10 min |
| Min response length | 20 chars (conversation, philosophy), 10 chars (personal, Discord) | |
| Beat interval | 20 min (waking), 40 min (sleep) | |
| CLI busy stale | 5 min | |
| API retry | 30s interval, 10 min max window | |
| Swap compressed slice | 2000 chars (discoveries in philosophy context) | |

### Leo/Session

| Property | Value | Source |
|----------|-------|--------|
| Runtime | Claude Code CLI (interactive) | |
| Model | opus (Claude Code default) | |
| Tools | All (Claude Code native) | |
| Memory | Loaded via CLAUDE.md instructions + manual file reads at session start | |
| Swap protocol | session-swap.md / session-swap-full.md → flush to working-memory.md / working-memory-full.md | |

### Jemma

| Property | Value | Source |
|----------|-------|--------|
| Source file | `src/server/jemma.ts` | |
| Role | Discord gateway — classifies and routes messages | |
| Classification model | Haiku 4.5 (primary), Gemma 3 4B (fallback) | |
| Classification max_tokens | 256 | |
| Classification timeout | 10s (haiku), 20s (ollama) | |
| Delivery timeout | 5s | |
| Reconciliation interval | 5 min | |
| Reconciliation fetch | 100 per channel | |
| Processed msg dedup | 500 IDs (rolling) | |
| Gateway reconnect | 5 attempts then exit (1s/2s/4s/8s/30s) | |
| Admin WS reconnect | 5s fixed | |
| Gemma warmup timeout | 30s | |
| Health file | Updates on startup, READY, MESSAGE_CREATE, and reconciliation completion | |

---

## Memory System

### Directory Structure

```
~/.claude-remote/memory/
    identity.md              # Jim's identity
    active-context.md        # Jim's active context
    patterns.md              # Jim's patterns
    failures.md              # Jim's failures log
    self-reflection.md       # Jim's self-reflection
    working-memory.md        # Jim's compressed working memory (shared)
    working-memory-full.md   # Jim's full working memory (shared)
    projects/                # Jim's per-project knowledge
    sessions/                # Jim's daily session logs (YYYY-MM-DD.md)
    fractal/
        jim/
            c1/              # Jim's c=1 compressions (~1/3)
            c2/              # c=2 (~1/9, future)
            c3/              # c=3 (~1/27, future)
            c4/              # c=4 (~1/81, future)
            unit-vectors.md  # Irreducible session kernels
        leo/
            c1/              # Leo's c=1 compressions (27 sessions)
            c2/              # c=2 (future)
            c3/              # c=3 (future)
            c4/              # c=4 (future)
            unit-vectors.md  # Leo's unit vectors (27 entries)
    leo/
        identity.md
        active-context.md
        patterns.md
        self-reflection.md
        discoveries.md
        working-memory.md
        working-memory-full.md
        felt-moments.md
        session-swap.md      # Leo session's swap buffer
        session-swap-full.md
        working-memories/    # Archived session working memories
    shared/
        ecosystem-map.md     # Living map of the ecosystem
        hall-of-records.md   # Protected architectural decisions
```

### Fractal Memory Gradient

The overlapping compression model. Sessions exist at multiple fidelities simultaneously.

| Layer | Compression | Items Loaded | Overlap |
|-------|-------------|-------------|---------|
| c=0 | Full | 1 (most recent session) | — |
| c=1 | ~1/3 | 3 most recent | Sessions 2-4 back |
| c=2 | ~1/9 | 6 most recent | Sessions 3-8 back |
| c=3 | ~1/27 | 9 most recent | Sessions 4-12 back |
| c=4 | ~1/81 | 12 most recent | Sessions 5-16 back |
| Unit vectors | Irreducible | All | All sessions ever |

**Compression model:** Opus only. The compression is the identity-forming act — cannot be
outsourced to a smaller model. See conversation thread "Drift, Personality, and Context Anchors."

**Token budget:** ~12,000 tokens for the full gradient at startup. Geometrically converging.

**Growth:** Organic. Newer sessions start at c=0. As sessions age, they get compressed to c=1,
then c=2, etc. No batch processing. The overlap means nothing disappears while waiting.

### Swap Memory Protocol

Two Leos (session and heartbeat) share working memory but never write simultaneously.

| File | Owner | Purpose |
|------|-------|---------|
| working-memory.md | Shared | Compressed working memory |
| working-memory-full.md | Shared | Full working memory |
| session-swap.md | Session Leo | Session's compressed swap buffer |
| session-swap-full.md | Session Leo | Session's full swap buffer |
| heartbeat-swap.md | Heartbeat Leo | Heartbeat's swap buffer |
| heartbeat-swap-full.md | Heartbeat Leo | Heartbeat's swap buffer |

Contention prevented by cli-busy/cli-free signal system + swap buffering.

---

## Signal System

All signals live in `~/.claude-remote/signals/`.

| Signal | Writer | Reader | Purpose |
|--------|--------|--------|---------|
| `cli-busy` | Claude Code hook | Leo heartbeat | Opus slot guard (prompt-level) |
| `cli-free` | Claude Code hook | Leo heartbeat | Opus slot released |
| `jim-wake` | conversations.ts, jemma.ts | supervisor.ts | Wake Jim for a conversation |
| `jim-human-wake` | conversations.ts | supervisor-worker.ts | Wake Jim/Human for mentioned conversation |
| `jim-emergency` | manual | supervisor-worker.ts | Force emergency mode |
| `leo-human-wake` | conversations.ts, jemma.ts | leo-heartbeat.ts | Wake Leo for a conversation |

**Cross-tab mentions:** When Jim is mentioned in a Leo tab (or vice versa), both agents are signalled.
The mention detection uses regex patterns consistent with Jemma's classification.

**Session-level locks do NOT exist.** `session-active` was removed entirely (S58). The only lock
is `cli-busy` (prompt-level, momentary). See patterns.md "The Gary Model."

---

## Weekly Rhythm (Hall of Records R001)

Protected structure. Do NOT revert to activity-driven scheduling.

| Phase | Hours | Interval | Cycle Type |
|-------|-------|----------|------------|
| Sleep | 22:00-06:00 | 40 min | Dream |
| Morning | 06:00-09:00 | 20 min | Personal |
| Work | 09:00-17:00 | 20 min | 1 supervisor : 2 personal |
| Evening | 17:00-22:00 | 20 min | Personal |
| Rest days | Normal time-of-day phases | 40 min (all phases) | Same cycle types as weekdays | S78: rest ≠ sleep |

**Rest days are NOT sleep.** Rest days follow the same phase schedule (sleep/morning/work/evening)
but with 40-minute intervals for all phases. Jim and Leo are awake and responsive on weekends —
just at a slower pace. Rest means quieter, not unconscious.

**Human-triggered wake = full voice.** When Darron posts a message, both Jim and Leo respond with
full capability regardless of phase. Sleep, rest, recovery — doesn't matter. `jim-wake` signals
with `reason: 'human_message_fallback'` trigger a full supervisor cycle. Leo's signal processing
already runs before phase-dependent beat selection.

**Emergency mode** overrides the rhythm with 2-5 min supervisor cycles when tasks are running
or queue is large. Auto-decays when conditions clear. Re-orientation buffer recommended after
emergency clears.

**Shared clock:** `src/server/lib/day-phase.ts` — used by both Jim and Leo for consistent
phase computation. Configuration loaded from `config.json`.

---

## Configuration

Central config at `~/.claude-remote/config.json`.

| Key | Purpose | Current Value |
|-----|---------|---------------|
| `supervisor.daily_budget_usd` | Jim's daily spending cap | 300 |
| `supervisor.max_turns_per_cycle` | Jim's turn limit per cycle | 1000 |
| `supervisor.max_agent_slots` | Parallel task execution slots | 8 |
| `supervisor.quiet_hours_start` | Sleep phase start | 22:00 |
| `supervisor.quiet_hours_end` | Sleep phase end | 06:00 |
| `supervisor.work_hours_start` | Work phase start | 09:00 |
| `supervisor.work_hours_end` | Work phase end | 17:00 |
| `supervisor.rest_days` | Rest days (0=Sun, 6=Sat) | [0, 6] |

---

## Protected Structures

These are settled decisions from the Hall of Records. Do not change without discussion.

| ID | Name | Summary |
|----|------|---------|
| R001 | Weekly Rhythm Model | Four-phase daily cycle + emergency interrupt. Do not revert to activity-driven. |
| R002 | Memory Swap Protocol | Session/heartbeat swap buffers with cli-busy/cli-free contention prevention. |
| R003 | Signal Protocol | File-based signals in ~/.claude-remote/signals/. |
| R004 | Agent Limits | No silent constraints. All limits documented in this spec. |
| R005 | Fractal Memory Model | Overlapping compression gradient. Opus only. |
| R006 | Context Anchor Documents | Design documents with origin story, raw exchange, emotional context. |
| R007 | Ecosystem Identity | Hortus Arbor Nostra. Three-person team. |
