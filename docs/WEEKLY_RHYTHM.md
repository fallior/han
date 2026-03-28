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

## Shared Clock

`src/server/lib/day-phase.ts` — single source of truth for phase detection.
Both agents should use this module.

## History

Jim originally had the weekly rhythm concept. It eroded through undocumented incremental
changes into a purely activity-driven frequency model. Restored 2026-03-05 by Darron's
direction. Protected by Hall of Records R001 to prevent future creep.
