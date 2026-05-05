# memory-gradient — Current Shape

> **What this is.** A SHAPE.md describes the *current canonical flow* for an
> architectural surface, names what's legacy that should not be extended, and
> cross-references the DEC entries that locked the design. Loaded by being
> adjacent to the code so an agent reading `memory-gradient.ts` finds this
> without being told. Per future-idea #37.
>
> **Last verified against code: 2026-05-05 (S150 PR3, voice-first thread `mor4o3r3-jvdjv1`).**
> If you read this and the code disagrees, **the code wins** — update this
> file in the same commit as your fix.

---

## What this file is

`src/server/lib/memory-gradient.ts` is the gradient mechanics core. It owns:

- **Schema-touching helpers** for `gradient_entries` and `pending_compressions`
  (insertGradientEntry, writeUVEntry, generateGradientId, hasDescendantAtLevel).
- **The cascade engine**: `bumpOnInsert`, `enqueueCascadeForDisplacedAt`
  (consolidated S150 PR3), `rollingWindowRotate`.
- **Compression primitives** (`compressToLevel`, `compressToUnitVector` —
  currently dead, see "What's legacy").
- **Memory-file rotation**: `rollingWindowRotate` slices the working-memory
  files when they cross the configured ceiling.
- **Cap formula** (`gradientCap`) per DEC-068.
- **Cascade pause guard** (`isCascadePaused` reading `~/.han/signals/cascade-paused`).

## Canonical bump-cascade flow (one displacement → one queue row)

The cascade chain is **pressure-driven, not orchestrated**. Every insert at
any level may displace the rank=cap+1 entry; the engine reacts to that
pressure by enqueueing a `pending_compressions` row. Per Darron's design:
*"let the engine react to pressure which will naturally settle — this is the
whole intent."*

The single canonical entry point is **`enqueueCascadeForDisplacedAt(db, agent, level)`**
(consolidated S150 PR3 — replaced two duplicate implementations).

### Call paths into the helper

1. **`bumpOnInsert(agent, level)`** — async wrapper that uses the closure-captured
   singleton `db`. Preserves the `BumpResult` return for legacy callers
   (`rollingWindowRotate`, `replay-bump-fill.ts`).
2. **`scripts/process-pending-compression.ts`** — imports the helper directly,
   passes its own `Database` instance. Called after each c{N}→c{N+1}
   composition lands, to enqueue the next-level cascade if displacement
   exists.

### What the helper does (in order)

1. Checks `~/.han/signals/cascade-paused`. If present, returns `{ pendingId: null, reason: 'cascade-paused' }`. (Tourniquet — S145 emergency stop for the UV-multiplication incident.)
2. Computes `cap = gradientCap(level)` per DEC-068 (c0=1, c{n≥1}=3n).
3. Queries `gradient_entries` for the rank=cap+1 entry — composite (created_at, id) DESC, OFFSET cap, filtering out `cascade_halted_at IS NOT NULL` (UV-halted) and `superseded_by IS NOT NULL` (Phase A.1 valence-shell semantics).
4. If no displaced entry → returns null with reason `level has slots`.
5. If `nextLevel(level)` is null → returns null with reason `no further level`.
6. Idempotency check: queries `gradient_entries` for any descendant at next level. If exists → returns null with reason `already cascaded`.
7. Generates a fresh UUID. INSERT OR IGNORE into `pending_compressions` with the UNIQUE constraint `(agent, source_id, from_level)`.
8. If `info.changes > 0` → returns `{ pendingId: <new uuid>, reason: 'enqueued' }`.
9. If UNIQUE rejection → returns `{ pendingId: null, reason: 'already enqueued (UNIQUE)' }`. **Drift A fix from S150**: previously, the duplicate implementation returned the generated UUID even on rejection, producing a misleading log upstream.

### What happens to the enqueued row

`pending_compressions` is consumed by `wm-sensor.ts` (which spawns
`scripts/process-pending-compression.ts` per row) — see `wm-sensor.SHAPE.md`
for that flow. The compression itself runs with the agent's full memory
loaded into the system prompt (NOT stranger-Opus per DEC-082).

## What's legacy and should not be extended

- **`processGradientForAgent`** (line 619) — currently uncalled live code. Its
  only caller (`compress-sessions.ts`) was retired in DEC-082. Slated for
  retirement-by-throw per future-idea #38. Do not call.
- **`sdkCompress`** (line 137) — retired-by-throw in DEC-082. Stranger-Opus
  call with no full identity loaded. Body commented out; throws on
  invocation. Use the wm-sensor → process-pending-compression chain.
- **`compressToLevel`, `compressToUnitVector`** (lines 555, 597) — only
  callers are bootstrap scripts (`bootstrap-fractal-gradient.ts`,
  `bootstrap-leo-fractal.js`) which themselves reference retired
  `sdkCompress`. Effectively dead. Class A candidate per future-idea #38.
- ~~`getGradientHealth`, `getFractalMemoryFiles`, `readFractalMemory`,
  `listAvailableSessions`~~ — **deleted in S150 PR6 Batch 2.** Zero live
  callers; planned-but-never-wired-up dashboard endpoints. Import refs
  cleaned in `supervisor-worker.ts:39` and `leo-heartbeat.ts:53` same commit.
- ~~`claimNextPendingCompression`, `completePendingCompression`,
  `completePendingCompressionForSource`, `releasePendingCompression`~~ —
  **deleted in S150 PR6 Batch 1.** Zero live callers; the actual queue
  claim path lives inline in `scripts/process-pending-compression.ts:claimNext`
  and `scripts/agent-bump-step.ts:findPendingCompression`, each with their
  own constant + own DB handle.
- **`loadFloatingMemory`** — already `@deprecated` in its docstring (line
  1844). ZERO callers. Class A.
- **`bumpCascade`** — already `@deprecated`. ZERO callers. Class A.

## Known debt (catalogued in future-idea #36, scoped #38)

- ~~`loadTraversableGradient` and `activeCascade` had `'jim' | 'leo'` type signatures.~~
  **Fixed S150 PR5** (voice-first thread, commit-pending). Both type-widened
  to `string`; their bodies were already path-clean (pure DB queries with no
  hardcoded path branches).
- Lines 1521 (`readFractalMemory`) and 1540 (`listAvailableSessions`) have
  hardcoded path branches `agentName === 'jim' ? 'sessions' : 'leo'`. Both
  functions are Class A candidates (no callers); deletion via #38 obviates
  the deagentification work.

## Cross-references

- **DEC-068** — gradient cap formula (c0=1, c{n≥1}=3n).
- **DEC-069** — memory-never-deleted; UV-halted rows stay in the table.
- **DEC-079** — Phase 4 cutover that introduced `pending_compressions` + the
  `process-pending-compression.ts` parallel agent.
- **DEC-080** — one-write-site discipline. The S150 PR3 consolidation honours
  this at the cascade-enqueue surface: `enqueueCascadeForDisplacedAt` is the
  single source of truth, called from both `bumpOnInsert` (server context)
  and `process-pending-compression.ts` (script context).
- **DEC-081** — agent-agnostic code discipline. Type signatures use `string`,
  not `'jim' | 'leo'`. Path resolution via `agent-registry.ts`.
- **DEC-082** — `sdkCompress` retirement; `/pfc` simplified to memory-writes.
  Several functions in this file are downstream of that retirement (see
  "What's legacy").

## Tests

`src/server/tests/enqueue-cascade.test.ts` — 9 cases covering the helper's
contract end-to-end. Uses `node:test` + `node:assert` with an in-memory
SQLite (`:memory:`) so the tests are isolated from production data.

Run via `cd src/server && npx tsx --test tests/enqueue-cascade.test.ts`.

## How to keep this document honest

1. When you change the canonical flow above (bump engine, cap formula,
   displacement filters, idempotency contract), update this file in the same
   commit. Commit message includes `Updates memory-gradient.SHAPE.md`.
2. When you add a new export to `memory-gradient.ts`, add it to the
   "What this file is" or "Canonical bump-cascade flow" section depending on
   purpose.
3. When you retire an export (move it to "What's legacy"), update the entry
   here. Class A retirements (full deletion) remove the entry; Class B
   retire-by-throw entries stay with the tombstone reason.
4. When you find a discrepancy between this doc and the code, **the code is
   the truth** — fix this file.

If this document goes more than two months without a commit-update while the
underlying code does see commits, that's a signal it's drifting — review then.
