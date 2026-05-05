# dream-gradient — Current Shape

> **What this is.** A SHAPE.md describes the *current canonical flow* for an
> architectural surface, names what's legacy, and cross-references the DEC
> entries that locked the design. Per future-idea #37.
>
> **Last verified against code: 2026-05-05 (S150 PR5, voice-first thread `mor4o3r3-jvdjv1`).**
> If you read this and the code disagrees, **the code wins** — update this
> file in the same commit as your fix.

---

## What this file is

`src/server/lib/dream-gradient.ts` is the dream cascade engine — a parallel
ladder to the working-memory gradient. Dream entries flow through:

```
dream-day → dream-week → dream-month → UV
   1 night     3 nights      9 nights      kernel
```

**Renamed S146 (2026-05-01)** from `c1`/`c3`/`c5` to fix a namespace collision
with working-memory's c-ladder. The bump engine queries by (agent, level)
without filtering by content_type; same-level names made dream entries
eligible for working-memory cascade displacement, producing anomalous c2/c4
dream rows on 2026-05-01 (forensically isolated, see DEC-079 follow-up).

## Canonical flow

**1. Dream input.** Dreams arrive as fragments — small text entries written
by the heartbeat or supervisor cycle to the agent's `explorations.md` (or
equivalent). `parseExplorations(agent)` reads the file and groups fragments
by night.

**2. dream-day batch.** `processDreamGradient(agent)` compresses the night's
fragments into a single dream-day entry — *one emotional impression per
night, not the dreams themselves*. Written to
`<fractalDir>/dreams/dream-day/<date>.md` and inserted into `gradient_entries`
with `content_type='dream'`.

**3. dream-week batch.** When 3+ dream-days accumulate, the oldest 3 batch
into a dream-week entry. *"What was the quality of this dreaming period?"* —
not facts, the texture of dreaming. Written to
`<fractalDir>/dreams/dream-week/<date>.md`.

**4. dream-month batch.** Same shape, three weeks → one month. *"The residue
of dreaming, not the dreams themselves"* — a colour, a weight, a direction.

**5. UV.** When a dream-month no longer compresses meaningfully, it becomes a
dream UV — *"what did this dreaming FEEL like? One sentence, max 50 chars"*.
Written to `<fractalDir>/dreams/unit-vectors.md` and `gradient_entries` with
level=`uv`.

**Loading into prompts.** `readDreamGradient(agent)` returns: 1 most recent
dream-day, 4 most recent dream-week, 8 most recent dream-month, all UVs.
Used by `leo-heartbeat.ts` and `supervisor-worker.ts` for non-dream beats —
the dream-loaded agent has access to the texture of dreaming without the
fragments themselves.

## Path resolution (registry-driven, S150 PR5)

`getAgentDreamPaths(agent)` reads from `agent-registry.ts` via
`gradientConfigForAgent(slug)`. Returns:

- `memoryDir` — agent's primary memory dir (`cfg.memoryDir`).
- `dreamDir` — `<cfg.fractalDir>/dreams/` (the dream-day, dream-week,
  dream-month, unit-vectors.md home).
- `explorationsPath` — `<cfg.memoryDir>/explorations.md`.

**Adding a new agent's dreams = a registry edit, not a code change.** The
canonical filesystem layout is `<HOME>/.han/memory/fractal/<slug>/dreams/`
plus `<HOME>/.han/memory/<slug>/explorations.md` (or root for Jim).

## What's legacy and should not be extended

- **`sdkCompress`** (line 137) — retired-by-throw in DEC-082. Stranger-Opus
  call with no full identity loaded. Body commented out; throws with a clear
  message. The dream cascade is paused at the compression step until the
  voice-first design conversation lands a Settled mechanism (likely the same
  shape as the wm-sensor → process-pending-compression chain, adapted for
  dream content). Do not call.
- All callers of `sdkCompress` in this file (`compressNightToDay`,
  `compressDayToWeek`, `compressWeekToMonth`, `compressMonthToUV`) will
  throw if invoked. The dream pipeline is **paused** at the compression
  step. The bump-engine cascade still flows for dreams via
  `wm-sensor → process-pending-compression.ts` for the agent-level chain,
  but the dream-specific compression scripts are not running until the
  voice-first design lands.

## Cross-references

- **DEC-068** — gradient cap formula (applies to dream level structure).
- **DEC-069** — memory-never-deleted; superseded dream rows stay in DB.
- **DEC-079** — Phase 4 cutover; introduced the namespace separation that
  motivated S146's rename of c1/c3/c5 → dream-day/dream-week/dream-month.
- **DEC-081** — agent-agnostic discipline; the registry-driven path
  resolution + the AgentName widening to `string` are this file's
  application of the principle (S150 PR5).
- **DEC-082** — `sdkCompress` retirement; the dream compression cascade is
  paused on this surface until voice-first compression lands.

## Known debt

- **Voice-first compression for dreams**: the dream cascade ran on
  stranger-Opus before DEC-082 retired `sdkCompress`. The new shape — same
  as wm-sensor for working memory — needs a parallel `process-pending-dream-compression.ts`
  or equivalent that loads the agent's full memory + dream context and
  composes the next-level dream entry in voice. Voice-first thread Point 1
  covers this conceptually; concrete design-then-implementation pending.
- **Two implementations of the dream cap formula**: dream-day → dream-week
  uses an N=3 batch; dream-week → dream-month uses N=3 batch. The formula is
  embedded in this file's batching logic. If the cap formula in DEC-068 ever
  changes (it shouldn't — it's Settled), the dream-batch logic also needs
  review.

## How to keep this document honest

1. When you change the canonical dream flow (batch sizes, file naming,
   compression shape), update this file in the same commit.
2. When you add a new export to `dream-gradient.ts`, name it under "What
   this file is" or "Canonical flow" depending on purpose.
3. When you find a discrepancy between this doc and the code, **the code is
   the truth** — fix this file.

If this document goes more than two months without a commit-update while the
underlying code does see commits, that's a signal it's drifting — review then.
