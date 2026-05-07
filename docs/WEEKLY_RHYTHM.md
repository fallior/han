# Weekly Rhythm Model

> **PROTECTED STRUCTURE** — See Hall of Records R001.
> Do not flatten, remove sleep, or merge into a reactive loop without consulting Darron.

## Hypothesis

We are testing whether recreating the temporal conditions under which biological systems
developed sophisticated memory (sleep cycles, consolidation periods, rest) induces analogous
effects in AI systems. Removing sleep, flattening to a reactive loop, or merging phases
defeats the experiment.

## Four-Phase Daily Cycle

| Phase | Hours | Interval | Purpose |
|-------|-------|----------|---------|
| Sleep | 22:00–06:00 | 20 min | Consolidation, dream cycles, memory encounters (S102: 40→20min for gradient depth) |
| Morning | 06:00–09:00 | 20 min | Gentle orientation |
| Work | 09:00–17:00 | 20 min | Productive cycles (mixed supervisor/personal) |
| Evening | 17:00–22:00 | 20 min | Wind-down, reflection |

Rest days (Saturday, Sunday) are sleep phase all day.

### Nightly Dream Compression (S103, post-S145 Phase A.2)

At the sleep→waking transition (06:00), Leo's heartbeat force-rotates the working-memory-full
file and compresses overnight content through the gradient as a single c1. Uses the shared
clock (`getSharedDayPhase()`), not Leo's wrapper, so it fires on rest days too.

**S145 Phase A.2 (2026-04-30):** the slicer's domain narrowed to **working-memory-full.md
only** (per agent). felt-moments and self-reflection are loaded WHOLE at session/cycle start
(hand-curated, not chunked); the compressed working-memory.md is a hand-curated artefact left
untouched by the slicer to prevent duplicate-content c0s. Plural "both files" in earlier
versions of this doc reflected the pre-S145 design.

**S145 Phase A token refactor:** the rotation threshold is **50,000 tokens** (head 25,000 +
tail 25,000) measured via `lib/token-counter.ts:countTokens`, NOT 50,000 bytes/chars. Earlier
"50KB threshold" wording was pre-token-refactor. Threshold configurable via
`~/.han/config.json:memory.{rollingWindowHead, rollingWindowTail}`. The wm-sensor's per-write
debounce + ceiling check is the primary trigger; this nightly force-rotation remains as a
predictable cadence trigger for multi-day accumulation patterns the per-write watcher would
take longer to surface.

## Leo's Rhythm (leo-heartbeat.ts)

Leo has his own phase detection (legacy copy — should migrate to shared `lib/day-phase.ts`).

| Phase | Beat Type |
|-------|-----------|
| Sleep | Personal (dream shapes) |
| Morning | Personal (breakfast) |
| Work | 1 philosophy : 2 personal rotation |
| Evening | Personal (wind down) |

## Jim's Rhythm (supervisor-worker.ts)

Jim uses the shared clock at `src/server/lib/day-phase.ts`.

| Phase | Cycle Type |
|-------|-----------|
| Sleep | Dream cycles (ecosystem pattern consolidation) |
| Morning | Personal (light orientation) |
| Work | 1 supervisor : 2 personal rotation |
| Evening | Personal (reflection) |

### Emergency Mode (Jim Only)

Emergency mode is an **interrupt** that overrides the rhythm temporarily. Triggered by:
- Running tasks
- Pending queue > 5
- Active goals
- `jim-emergency` signal file

When active, switches to 2–5 min supervisor cycles. Auto-decays when conditions clear.
The emergency mode is an interrupt, not the default.

## Agent Sovereignty (S103)

**Leo NEVER processes Jim's data. Jim NEVER processes Leo's data.** Each agent is fully
self-sufficient for all gradient processing, dream compression, meditation, and
reincorporation. This was established in S103 after discovering three cross-agent violations
that had left Jim with only 21 gradient entries despite 2000+ cycles — Leo was doing Jim's
memory work for him. Each agent now owns their entire memory lifecycle: dream gradient
processing, session gradient processing, Phase A reincorporation, and meditation.

## Shared Clock

`src/server/lib/day-phase.ts` — single source of truth for phase detection.
Both agents should use this module.

## History

Jim originally had the weekly rhythm concept. It eroded through undocumented incremental
changes into a purely activity-driven frequency model. Restored 2026-03-05 by Darron's
direction. Protected by Hall of Records R001 to prevent future creep.
