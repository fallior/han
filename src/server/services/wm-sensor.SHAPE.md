# wm-sensor — Current Shape

> **What this is.** A SHAPE.md describes the *current canonical flow* for an
> architectural surface, names what's legacy that should not be extended, and
> cross-references the DEC entries that locked the design. Loaded by being
> adjacent to the code so an agent reading `wm-sensor.ts` finds this without
> being told. Pilot for future-idea #37 (S149, 2026-05-04).
>
> **Last verified against code: 2026-05-04 (S149, Point 2 of voice-first thread `mor4o3r3-jvdjv1`).** This document is a hypothesis until it's been verified against the code. If you read this and the code disagrees, **the code wins** — update this file in the same commit as your fix.

---

## Canonical flow (one trigger → settled cascade)

**Trigger.** Any write to `~/.han/memory/<slug>/working-memory-full.md`
(Leo's path) or `~/.han/memory/working-memory-full.md` (Jim, root). One file
per agent. **No other files trigger the sensor.**

1. **`fs.watch` event** (or rename + re-establish for atomic saves) → debounce
   500 ms (`config.sensorDebounceMs`).
2. **Acquire per-agent lock** at `~/.han/signals/wm-sensor-{agent}-active`.
   If already held, return — the in-flight pass will observe the new size
   when it finishes.
3. **`processTarget` outer loop** (max 10 iterations):
   - Read file content; count tokens via `lib/token-counter.ts:countTokens`.
   - If tokens ≤ ceiling (50 000 = head 25 000 + tail 25 000), return.
   - Call `rollingWindowRotate(filePath, header, 25000, 25000, agent, contentType)`.
4. **`rollingWindowRotate`** (in `src/server/lib/memory-gradient.ts:1739`):
   - Splits file into entries via `splitMemoryFileEntries`.
   - Walks oldest-first, accumulates ~25K tokens to archive (always at least
     one entry; splits at entry boundaries, never mid-entry).
   - Atomically inserts a `c0` row into `gradient_entries`:
     `insertGradientEntry(entryId, agent, "rolling-{date}", "c0", archiveContent, contentType, null, null)`.
   - **Fire-and-forget**: `void bumpOnInsert(agent, 'c0').catch(...)`.
   - Writes the legacy archive file (`<basename>-rolling-archive.md`).
   - Rewrites the living file with the kept entries (header + rest).
5. **`bumpOnInsert(agent, 'c0')`** (`memory-gradient.ts:1387`):
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
  full-identity path is `process-pending-compression.ts`.
- **The compressed `working-memory.md`** — hand-curated artefact, NOT watched
  by the slicer. Phase 12 cleanup will retire the dual-file pattern entirely.

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
