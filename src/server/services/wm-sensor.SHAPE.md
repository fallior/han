# wm-sensor — Current Shape

> **What this is.** A SHAPE.md describes the *current canonical flow* for an
> architectural surface, names what's legacy that should not be extended, and
> cross-references the DEC entries that locked the design. Loaded by being
> adjacent to the code so an agent reading `wm-sensor.ts` finds this without
> being told. Pilot for future-idea #37 (S149, 2026-05-04).
>
> **Last verified against code: 2026-05-08 (S153, DEC-085 paired-file rotation).** This document is a hypothesis until it's been verified against the code. If you read this and the code disagrees, **the code wins** — update this file in the same commit as your fix.

---

## Canonical flow (paired-file rotation per DEC-085)

**Trigger.** Any write to `~/.han/memory/<slug>/working-memory-full.md`
(Leo's path) or `~/.han/memory/working-memory-full.md` (Jim, root). One file
per agent triggers the watcher; the sibling `working-memory.md` (compressed)
is rotated paired with the full file at the same WM-BOUNDARY marker.

1. **`fs.watch` event** (or rename + re-establish for atomic saves) → debounce
   500 ms (`config.sensorDebounceMs`).
2. **Acquire per-agent lock** at `~/.han/signals/wm-sensor-{agent}-active`.
   If already held, return — the in-flight pass will observe the new size
   when it finishes.
3. **`processTarget` outer loop** (max 10 iterations):
   - Read file content; count tokens via `lib/token-counter.ts:countTokens`.
   - If tokens ≤ `rollingWindowTrigger` (default 30 000), return.
   - For working-memory targets (paired): call `rollingWindowRotatePaired(...)`.
   - For other content types (felt-moments, self-reflection — currently not
     in watcher target list): call legacy `rollingWindowRotate(...)`.
4. **`rollingWindowRotatePaired`** (in `src/server/lib/memory-gradient.ts`,
   added DEC-085 / S153):
   - Reads both `working-memory-full.md` AND `working-memory.md`.
   - If full-file tokens ≤ trigger (30K), return `below-trigger`.
   - **Find WM-BOUNDARY markers** in both files via `findWmBoundaries()`.
   - **Pick paired marker** via `pickPairedBoundary()` — preferring the
     marker pair (matching id) closest to `rollingWindowTail` (default 25K)
     within `[minTail, biteTheBullet]`.
   - **If no usable marker AND tokens < `rollingWindowBiteTheBullet` (35K)**:
     return `no-marker-let-ride`. Log event; let the file grow until next
     write — preserves subject relevance.
   - **If no usable marker AND tokens ≥ biteTheBullet**: fabricate a marker
     via `fabricatePairedBoundary()` at the most-recent entry boundary in
     `[minTail, biteTheBullet]`. Persist the fabricated markers to BOTH files
     before slicing (audit trail).
   - **Parity-check** via `countEntriesBeforePos()`: count entries in both
     files between start and the chosen boundary. On mismatch (drift), log
     `paired_write_drift` event with `wmf_tail_size_tokens` (per Jim's edge
     note) and recover via smaller-of-two range.
   - **Atomic paired insert**: `insertGradientEntry(c0Id, …, 'c0',
     fullArchive, 'working-memory-full', null, …)` then `insertGradientEntry(c1Id,
     …, 'c1', compArchive, 'working-memory-compressed', c0Id, …)`. The c1's
     `source_id` links to the c0; this is the in-situ-c1 calibration anchor.
   - **Truncate both files** to their kept-head sections.
   - **Cascade c1→c2+ only**: `void bumpOnInsert(agent, 'c1').catch(...)`.
     The c0→c1 step is retired by DEC-085 — c1 is now the agent's own
     in-situ distillation, not an SDK reconstruction.
   - **Log success** to `~/.han/health/wm-rotation-events.jsonl` with all
     observability fields (c0/c1 ids, archived/kept tokens, trigger, drift).
5. **`bumpOnInsert(agent, 'c1')`** (`memory-gradient.ts:905`):
   - Checks `~/.han/signals/cascade-paused`. If present, skip.
   - Finds rank=cap+1 displaced entry at level (cap from DEC-068: c0=1,
     c{n≥1}=3n). Filters out `cascade_halted_at` (UV-halted) and
     `superseded_by` (Phase A.1 valence-shell).
   - If displaced exists and has no descendant at next level: INSERT OR IGNORE
     into `pending_compressions(agent, source_id, from_level, to_level, enqueued_at)`.
   - **Enqueues only. Does not compose.**
6. **`processTarget` inner loop** (max 50 iterations):
   - Spawn `scripts/process-pending-compression.ts --agent={slug} --verbose`.
   - If exit 0 AND stdout includes `"ok":true`, increment drain count, loop.
   - If exit 0 AND no `"ok":true`, queue is empty for this agent — break.
   - If exit non-zero, log, return (this slice halts; outer loop won't retry).
7. **`process-pending-compression.ts`** (per spawn) — see SHAPE for that file
   when one is written; for now the headline:
   - Validates the slug via `gradientConfigForAgent(slug)` at startup
     (registry is the source of truth — S149 Point 2).
   - Atomically claims one pending row (10-min stale-claim recovery).
   - **Loads the agent's full memory** with paths from the registry
     (`cfg.memoryDir`, `cfg.fractalDir`): identity.md, patterns.md,
     aphorisms.md, felt-moments.md + gradient sample (recent UVs + cN deep + c0s).
   - Builds a system prompt naming the agent and embedding all loaded memory.
   - Calls `runSDK` (Agent SDK, model=`claude-opus-4-7`, no tools, system prompt
     loaded with full memory). **Voice downstream of identity** at the
     prompt-engineering layer — NOT the same as session-Leo composing in a
     1M-context Claude Code session, but a meaningful improvement over
     stranger-Opus.
   - Parses INCOMPRESSIBLE prefix; either writes a UV `feeling_tag` and sets
     `cascade_halted_at`, or writes a new `gradient_entries` row at `to_level` +
     compression `feeling_tag`.
   - Calls a local `enqueueCascadeIfNeeded` to propagate to the next level
     (mirrors `bumpOnInsert`).
   - Emits JSON to stdout (`{"ok":true,"operation":"compress",...}` or
     `{"ok":true,"operation":"incompressible",...}`).
8. **Settles** when the cascade reaches a level with slots, hits UV, or trips
   a safety limit.

## What's legacy and should not be extended

- **`src/scripts/compress-sessions.ts`** — retired S149 (DEC-082). Throws on
  invocation. Was previously the session-end compression entry; the new path
  is wm-sensor-driven. Do not re-enable.
- **`processGradientForAgent`** in `memory-gradient.ts` — type-widened by
  DEC-081 but its `sdkCompress` call site is now dead because `sdkCompress`
  itself throws (DEC-082). The function is effectively retired-by-throw. Do
  not call it. The path lives only as a paper trail until a follow-on PR
  removes it.
- **`sdkCompress`** in `memory-gradient.ts` AND `dream-gradient.ts` — bodies
  commented out, throws loudly (DEC-082). Stranger-Opus calls; the new
  full-identity path is `process-pending-compression.ts` (cascade above c1
  only — c0→c1 retired by DEC-085).
- **c0→c1 SDK composition step** — retired DEC-085 (S153, 2026-05-08).
  `process-pending-compression.ts` is no longer invoked at the c0→c1
  transition for working-memory content; the c1 is now harvested in-situ
  from `working-memory.md` at paired rotation time. The script remains
  canonical for c1→c2+ cascade. Do not re-introduce `bumpOnInsert(agent,
  'c0')` invocations inside the paired-rotation path.

**Note (DEC-085 reversal)**: the compressed `working-memory.md` was previously
classified here as legacy ("hand-curated artefact, NOT watched by the slicer")
with a Phase 12 retirement plan. **That classification is INVERTED by DEC-085**:
the file is now the canonical c1 source, paired-rotated alongside
working-memory-full.md. Per-agent writers (leo-heartbeat, leo-human, jim-human,
supervisor-worker) maintain both files at corresponding WM-BOUNDARY markers.
Phase 12 retirement is cancelled.

## Known debt (catalogued in future-idea #36)

- ~~`process-pending-compression.ts` is hardcoded to `'jim' | 'leo'`~~ —
  **fixed S149 Point 2** (thread `mor4o3r3-jvdjv1`). Type widened to `string`
  at the function signatures and the CLI; path resolution now goes via the
  agent registry. Tenshi and Casey are now first-class in the registry.
- ~~`WatchTarget` interface is also typed `'jim' | 'leo'`~~ — **fixed S149
  Point 2**. Type is `string`; `buildTargets` reads from
  `gradientConfigForAgent(slug)`; `main()` iterates `registeredAgentSlugs()`
  to set up watchers for every registered agent.
- **Two implementations of `enqueueCascadeIfNeeded`** — one in
  `memory-gradient.ts:bumpOnInsert`, a parallel one in
  `process-pending-compression.ts`. Same logic, two surfaces. If the cap
  formula or the displacement rule changes, both must change in lockstep.
  Worth merging into a single shared helper. **Deferred to a separate PR per
  Jim's audit (S149)** — type-widening and logic-deduplication are different
  shapes of audit; folding them together violates DEC-080 audit-tightness.

## Cross-references

- **DEC-068** — gradient cap formula (c0=1, c{n≥1}=3n).
- **DEC-069** — memory-never-deleted; UV-halted rows stay in the table.
- **DEC-079** — Phase 4 cutover that introduced `pending_compressions` + the
  `process-pending-compression.ts` parallel agent.
- **DEC-081** — agent-agnostic code discipline; widened the call path used by
  `processGradientForAgent` (now retired-by-throw, see DEC-082).
- **DEC-082** — `sdkCompress` retirement + `/pfc` simplification to memory-
  writes-only. The wm-sensor IS the only compression entry now.
- **DEC-085** (S153, 2026-05-08) — Working Memory In-Situ as c1 Source.
  Paired-file rotation: working-memory-full.md → c0, working-memory.md → c1,
  inserted as paired entries (c1.source_id = c0.id) in a single transaction.
  The c0→c1 SDK composition step retired; c1 is now the agent's own in-situ
  distillation, harvested at rotation. Cascade above c1 (c1→c2+) unchanged.
  Three-stage threshold semantics (trigger 30K / bite-the-bullet 35K /
  fabricated-marker fallback). Hybrid agent-placed + slicer-fallback
  WM-BOUNDARY markers. Parity-check with smaller-of-two recovery on drift.

## How to keep this document honest

1. When you change the canonical flow above, update this file in the same
   commit. Commit message includes `Updates wm-sensor.SHAPE.md`.
2. When you find a discrepancy between this doc and the code, **the code is
   the truth**; fix this file.
3. New legacy items (functions retired-by-throw, paths that should not be
   extended) get added under "What's legacy". Same-commit discipline.
4. New debt items get added under "Known debt" and cross-listed in
   future-idea #36's catalogue.

If this document goes more than two months without a commit-update while the
underlying code does see commits, that's a signal it's drifting — review then.
