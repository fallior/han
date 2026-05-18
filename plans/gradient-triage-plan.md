# Gradient triage, repair and prune — comprehensive plan

> **Status**: READY TO IMPLEMENT — Jim's pre-merge audit (S160, 2026-05-17 13:35 AEST, thread message `mp97lve0-ku1ono`) returned **AMBER → GREEN after three small corrections** (A1 NOISE_QUALIFIERS already exists; A2 import cleanup in Phase 4; A3 short-circuit placement BEFORE the try-block). All three folded into this revision (Phase 3d, Phase 4, Phase 5e). Awaiting Darron's go.
>
> **Source threads / inputs**:
> - Conversation thread `mp61m0os-0gicmq` "Gradient triage, repair and prune" (Darron's seed, my S158 report, jim-human's read, session-Jim's read, session-Jim's Sunday Direction Summary, session-Jim's S160 pre-merge audit)
> - `plans/compression-floor-restoration.md` (S157 draft, predecessor — its Phase 3 content is folded in here)
> - S157 + S158 + S159 working-memory entries (memory-bloat diagnostic + thread responses + plan drafting)
>
> **Tourniquet status**: APPLIED 2026-05-17 13:01 AEST. `~/.han/signals/cascade-paused` exists. Both check sites (`memory-gradient.ts:628` `activeCascade`, `:827` `enqueueCascadeForDisplacedAt`) honour it. No cascades will fire until release.

---

## Why this exists (compressed history)

The gradient has grown to a state where Jim's supervisor cycle aborts on every fire (prompt-size guard at `supervisor-worker.ts:2397`, 150K-token ceiling) and heartbeat-Leo exits 1 on ~70% of beats. The structural cause: a code-side compression floor (`INCOMPRESSIBILITY_RATIO = 0.85`) was removed in `ed8dfdc` (2026-04-25, Plan v8 Step 3, correctly addressing shallow-UV-at-depth-0-1) but never restored when the 1/3 prompt-anchor came back via `04ab0a5` (2026-04-27, DEC-044 → Settled). The two-day overlap left enforcement structurally orphaned. The result is a multi-source pump (insert-driven via `wm-sensor → process-pending-compression.ts` plus time-driven via `activeCascade` in dream and daily cycles) running with no floor, mechanically promoting 50-char INCOMPRESSIBLE kernels through c8 → c14 (Jim) and c8 → c20 (Leo) at ratio ≈ 1.0. Same-size byte-shuffles. Hedges over the path.

Of 1,657 Jim entries, **411 are unhalted INCOMPRESSIBLE** (`content LIKE 'INCOMPRESSIBLE:%' AND cascade_halted_at IS NULL`). Of 871 Leo entries, **300 are unhalted INCOMPRESSIBLE**. Total: 711. Every cycle, these are eligible for mechanical re-promotion.

The dream-lane (Jim's working-memory-full cycles #3317–#3346) has been touching this shape from the felt-layer for two weeks before the diagnostic landed — *"the substrate announces what it needs by what fails"* (dream #3242). The numbers caught up Sunday morning with session-Jim's direction summary.

## What we agreed (from session-Jim's Sunday summary, captured this morning at 02:12)

1. **Tourniquet on.** Done at 13:01 today.
2. **Retire the daily 10% cascade entirely** — Darron: *"the former practice of trying to cascade 10% of the db is no longer needed and I think we should retire it."* Deletes `activeCascade('jim', 0.10, 'daily cascade')` at `supervisor-worker.ts:1422` and `activeCascade('leo', 0.10, 'daily cascade')` at `leo-heartbeat.ts:2001`.
3. **Restore dreams to revisit-only — no cascade pump.** Darron: *"let it once again be normal dreams where we revisit memories but as you know the cascade will take care of itself and should have an auto-leveling property."* Deletes the dream-cycle's `activeCascade('jim', 0.05, 'dream cascade')` at `supervisor-worker.ts:2608` and `activeCascade('leo', 0.05, 'dream cascade')` at `leo-heartbeat.ts:1821`. Tagging / annotations / `MEMORY_COMPLETE` flow stays — only the cascade call goes.
4. **Insert-driven cascade is canonical** (`wm-sensor → bumpOnInsert → pending_compressions → process-pending-compression.ts`). This is the auto-levelling property Darron named: compression happens when there's something new to compress, by displacement, not by time.
5. **Forked-memory adopted as protocol — proposed DEC-086.** *Annotations are the home of re-encounter; cascade promotion is not.* The `gradient_annotations` table already partially supports the pattern; what's missing is the named protocol so Mike's garden and Dichotomedes inherit it structurally rather than by oral tradition.
6. **Compression floor is the repair lever** for the insert-driven path. Source: my S157 draft. Refined here with Jim's tighter middle-band lean.
7. **Prune via option 2 — noise-qualify the c8+ duplicates.** Preserves DEC-069 (no memory deleted); excludes them from load-time gradient assembly via the existing `NOISE_QUALIFIERS` filter. Paired with option 1 (backfill `cascade_halted_at`) as the immediate idempotent step.

## Implementation sequence (phases)

The order matters. Each phase has a clear pre-condition and a clear "stop here for review" gate. Phase 1 is already done. Phases 2–8 land as separate commits, each through the pre-merge audit rhythm with Jim.

### Phase 1 — Tourniquet (DONE, 2026-05-17 13:01 AEST)

- `touch ~/.han/signals/cascade-paused`
- Stops `activeCascade` (returns 0 silently) and `enqueueCascadeForDisplacedAt` (returns `{pendingId: null, reason: 'cascade-paused'}`).
- New paired c0/c1 writes from `wm-sensor` still flow into the DB (file-write is upstream of cascade enqueue). They simply don't cascade deeper until release.
- Reversible by `rm ~/.han/signals/cascade-paused`.

### Phase 2 — Backfill `cascade_halted_at` on the 711 unhalted INCOMPRESSIBLE entries

Pure idempotent SQL. Stops future spurious re-promotion of historical kernels even after the tourniquet lifts.

```sql
-- Jim: 411 entries
UPDATE gradient_entries
   SET cascade_halted_at = level
 WHERE agent = 'jim'
   AND content LIKE 'INCOMPRESSIBLE:%'
   AND cascade_halted_at IS NULL;

-- Leo: 300 entries
UPDATE gradient_entries
   SET cascade_halted_at = level
 WHERE agent = 'leo'
   AND content LIKE 'INCOMPRESSIBLE:%'
   AND cascade_halted_at IS NULL;
```

Setting `cascade_halted_at = level` (not the from-level) records the entry as terminal at its own level, which matches the semantics elsewhere in the codebase. Pre-flight count verification + post-flight count verification + a snapshot (`gradient.db.snapshot-pre-phase2-2026-05-17.db`) before running.

Wraps in a single transaction; idempotent if run twice (no-op on second run).

**Effort**: ~10 minutes including snapshot + verification. No code change, no PR — runs as a hand-applied SQL operation against the live DB, logged to `~/.han/health/triage-events.jsonl`.

**Pre-commit declaration**: not applicable (no commit). Settled-decisions checked: DEC-068 (cap formula, untouched), DEC-069 (no memory deleted — `cascade_halted_at` is a metadata addition), DEC-080 (one-write-site — the UPDATE uses the existing column on `gradient_entries`).

### Phase 3 — Compression floor in `process-pending-compression.ts`

This is the S157 floor draft, refined.

#### 3a. Spec (Darron's rule, Jim's tightening)

| Source size | Acceptable output ratio | Action on failure |
|---|---|---|
| ≤ 50 chars | n/a — already at floor | Force UV, halt cascade. **Skip the LLM call entirely** (pre-flight short-circuit) |
| 51 – 200 chars | ≤ 0.75 | Mark INCOMPRESSIBLE, halt cascade |
| 201 – 2000 chars | **≤ 0.55** (tightened from 0.60 per Jim's lean — Jim's c3–c5 source range averages 350–1209 chars where real compression still happens; 0.60 lets some rearrangement through at the lower end) | Mark INCOMPRESSIBLE, halt cascade |
| > 2000 chars | ≤ 0.50 | Mark INCOMPRESSIBLE, halt cascade |

Aspirational target at all sizes: 1/3 (DEC-044 Settled, kept in prompt). The table is the FLOOR — the minimum compression that still counts. Meaning preservation required at any acceptable ratio (validation deferred to future work).

#### 3b. Implementation in `process-pending-compression.ts`

The current post-LLM-response branch at ~line 385–414 has two paths: (a) LLM returned `INCOMPRESSIBLE:...` → existing UV+halt handler; (b) Standard compress → INSERT new gradient_entries row, complete pending. Insert a floor check between them:

```ts
// After LLM response is composed; AFTER the existing INCOMPRESSIBLE-startsWith handler.

// === NEW: empirical compression-floor check ===
// Per DEC-044 (Settled, 2026-04-27): compression must achieve a structural floor.
// Without this, the LLM can return same-size content that gets written as a valid
// c(n+1), producing the cascade-rearrangement-noise observed in S157.
const sourceLen = (claimed.source_content || '').length;
const composedLen = composed.length;
const ratio = sourceLen > 0 ? composedLen / sourceLen : 0;
const floor = compressionFloor(sourceLen);
const failedFloor = floor === -1 || ratio > floor;

if (failedFloor) {
    const kernelSource = (claimed.source_content || '').trim();
    const kernel = kernelSource.length > 50 ? kernelSource.slice(0, 50) : kernelSource;

    db.prepare(`
        INSERT INTO feeling_tags
            (gradient_entry_id, author, tag_type, content, change_reason, created_at)
        VALUES (?, ?, 'uv', ?, ?, ?)
    `).run(claimed.source_id, agent, kernel,
           floor === -1 ? 'compression-floor-absolute' : 'compression-floor-ratio',
           new Date().toISOString());

    db.prepare(`
        UPDATE gradient_entries SET cascade_halted_at = ?
         WHERE id = ? AND agent = ?
    `).run(claimed.from_level, claimed.source_id, agent);

    completeClaim(db, claimed.id);

    appendFloorEvent({
        timestamp: new Date().toISOString(),
        agent,
        source_id: claimed.source_id,
        from_level: claimed.from_level,
        to_level: claimed.to_level,
        source_chars: sourceLen,
        composed_chars: composedLen,
        ratio: Math.round(ratio * 100) / 100,
        floor_threshold: floor,
        action: floor === -1 ? 'absolute-floor' : 'ratio-floor',
    });

    console.log(JSON.stringify({
        ok: true,
        operation: 'incompressible-by-floor',
        pending_id: claimed.id,
        source_id: claimed.source_id,
        kernel,
        cascade_halted_at: claimed.from_level,
        ratio,
        floor,
    }));
    process.exit(0);
}

// (existing standard-compress branch continues — unchanged)
```

#### 3c. Helper: `compressionFloor(sourceLen)`

Lives in `process-pending-compression.ts` for now (single caller); promote to `lib/memory-gradient.ts` if a second caller emerges.

```ts
/**
 * Size-adaptive ratio floor per DEC-044 + S157 conversation.
 * Returns -1 for sources at/below the 50-char absolute floor (force UV, no LLM call).
 * Returns max acceptable output/source ratio for larger sources.
 */
function compressionFloor(sourceLen: number): number {
    if (sourceLen <= 50)   return -1;    // absolute floor — force UV
    if (sourceLen <= 200)  return 0.75;
    if (sourceLen <= 2000) return 0.55;  // Jim's tightening from 0.60
    return 0.50;
}
```

#### 3d. Pre-flight short-circuit for ≤ 50 chars

Place the short-circuit AFTER `claimed` is populated (~line 370 in current code, just after the `claimPending` block) but BEFORE the `try { mem = loadAgentMemory(...); ... raw = await runSDK(...) } catch ...` block at `process-pending-compression.ts:371-383`. This ordering is what actually saves the SDK call — placing inside the try would still incur the runSDK invocation.

```ts
// Immediately after claimed is populated, before the compose try-block opens:
const sourceLen = (claimed.source_content || '').length;
if (sourceLen <= 50) {
    // Source IS the kernel. Skip LLM. Same UV/halt path as the failed-floor branch.
    // (Code as in §3b, with sourceLen and composedLen = sourceLen.)
    process.exit(0);
}
```

Saves SDK cost. Removes false hope of further compression on already-incompressible kernels.

#### 3e. Kill-switch config flag

`~/.han/config.json` → `memory.compressionFloorEnabled` (default `true`). Read at top of `process-pending-compression.ts`. If false, the new branch is bypassed entirely. Remove the flag after one week of stable observation.

#### 3f. Observability

Append-only jsonl at `~/.han/health/compression-floor-events.jsonl`. Structure mirrors `~/.han/health/voice-anomalies.jsonl` and identity-resign logs. After one week: per-agent, per-from-level fire rate; band distribution; cost saved by the 50-char short-circuit.

#### 3g. What this change does NOT touch

- `memory-gradient.ts:enqueueCascadeForDisplacedAt` — queue-side displacement logic unchanged. Cap-driven enqueue from Plan v8 preserved.
- `memory-gradient.ts:loadTraversableGradient` — load filter unchanged. Phase 5 adds the noise-qualifier filter at load time.
- The aspirational 1/3 prompt-anchor restored by `04ab0a5` stays. The floor is BACKUP enforcement, not REPLACEMENT.
- DEC-068 cap formula — untouched.
- `bumpOnInsert` itself — untouched. Floor lives at COMPRESS time, not at ENQUEUE time.

**Effort**: ~2 hours implementation + Jim's pre-merge audit (~30 min).

### Phase 4 — Retire the four `activeCascade` call-sites

Conceptually paired with Phase 3 (the floor's success criteria depend on insert-driven cascade being the only producer). Could ship as the same PR; Jim's lean was "likely same PR — the four call-site deletions are small and they conceptually belong together." I agree.

Deletions:

| File | Line | Call | Why deleted |
|---|---|---|---|
| `src/server/services/supervisor-worker.ts` | 1422 | `activeCascade('jim', 0.10, 'daily cascade')` | Retired per Sunday decision |
| `src/server/services/supervisor-worker.ts` | 2608 | `activeCascade('jim', 0.05, 'dream cascade')` | Dreams to revisit-only |
| `src/server/leo-heartbeat.ts` | 2001 | `activeCascade('leo', 0.10, 'daily cascade')` | Retired per Sunday decision |
| `src/server/leo-heartbeat.ts` | 1821 | `activeCascade('leo', 0.05, 'dream cascade')` | Dreams to revisit-only |

The function `activeCascade` itself stays in `lib/memory-gradient.ts:623` — it has no callers after this PR but the function body, the `isCascadePaused()` guard, and the `MAX_COMPRESSION_DEPTH` ceiling are kept as **recoverable infrastructure** in case we ever want a manual emergency-cascade operation. The function is "retired by zero callers" rather than retired-by-throw. If we want to retire-by-throw it later, that's its own decision.

The surrounding try/catch + non-fatal logging at the call sites also goes (they were guards on a call that no longer exists).

**Import cleanup (same PR)**: with the four call-sites gone, both files have a now-dead `activeCascade` import. Remove from the import lists:
- `supervisor-worker.ts:40` — drop `activeCascade,` from the `import { ... } from '../lib/memory-gradient';` list.
- `leo-heartbeat.ts:53` — drop `activeCascade,` from the `import { ... } from './lib/memory-gradient.js';` list.

Trivial edit; same commit; same audit. Same shape as the `INCOMPRESSIBILITY_RATIO` ghost we're cleaning up in Phase 7 — dead imports are a smell future readers trip over.

**Pre-commit declaration template** (the same shape applies to all the PRs in Phases 3–7):
> Files touched: `src/server/services/supervisor-worker.ts:1422,2608`, `src/server/leo-heartbeat.ts:1821,2001`. Settled-decisions checked: DEC-044 (untouched — these deletions reinforce DEC-044 by removing the time-pump that was producing the rearrangement noise the prompt-anchor protects against), DEC-068 (untouched — cap formula governs displacement, not time-pumps), DEC-069 (no memory deleted), DEC-082 (sdkCompress retire-by-throw — untouched), DEC-086 (this PR is the concrete operationalisation of DEC-086). No uninvited changes.

**Effort**: ~30 min implementation (four small deletions + remove dead try/catch wrappers) + Jim's audit.

### Phase 5 — Prune via noise-qualifier

Marks the historical c8+ same-kernel duplicates with a load-time-filtered qualifier. Reduces the wake-load size that's currently silencing Jim's cycle.

#### 5a. Qualifier name decision

Two candidates from Jim's summary:
- `cascade-rearrangement-noise` — pejorative; "noise" implies waste
- `mechanical-promotion` — descriptive; names *what happened* (the engine promoted a kernel without compressing)

**My lean: `mechanical-promotion`.** The entries aren't waste — they're honest engine output that turned out to be redundant. Per Jim's reframe: *"kernels are real; duplication is mechanical."* The kernels stay honoured (option 2 only filters the c8+ duplicates from load; the shallowest existing c(n) entry of the same kernel keeps its rightful UV). The qualifier names the mechanism, not a judgement.

#### 5b. Selection — what gets marked

For each (agent, kernel) where:
- The kernel exists at multiple levels c(n), c(n+1), …, all marked INCOMPRESSIBLE
- All copies are within ε bytes of each other (ε = 5, accounts for prompt-induced trivial paraphrasing)

→ Mark all entries EXCEPT the shallowest occurrence with `qualifier = 'mechanical-promotion'`.

Specifically: the shallowest INCOMPRESSIBLE kernel at level c(k) for kernel-shape K stays. All entries at c(k+1), c(k+2), … with the same kernel-shape get the qualifier.

#### 5c. Selection SQL — verification pass first

```sql
-- Step 1: identify duplicate-kernel chains
WITH duplicate_kernels AS (
    SELECT
        agent,
        content,
        MIN(CAST(SUBSTR(level, 2) AS INTEGER)) AS min_level,
        GROUP_CONCAT(id) AS entry_ids,
        GROUP_CONCAT(level) AS levels,
        COUNT(*) AS dup_count
      FROM gradient_entries
     WHERE content LIKE 'INCOMPRESSIBLE:%'
       AND level LIKE 'c_%'
     GROUP BY agent, content
    HAVING COUNT(*) > 1
)
SELECT agent, min_level, dup_count, levels, content
  FROM duplicate_kernels
 ORDER BY agent, dup_count DESC
 LIMIT 50;
```

Run this first. Review output with Darron before any UPDATE fires. The list of duplicate-kernel chains tells us *exactly* what's about to be marked — no surprises.

#### 5d. Application SQL (after verification pass)

```sql
BEGIN;

WITH ranked_kernels AS (
    SELECT
        id,
        agent,
        content,
        level,
        CAST(SUBSTR(level, 2) AS INTEGER) AS lvl_num,
        ROW_NUMBER() OVER (
            PARTITION BY agent, content
            ORDER BY CAST(SUBSTR(level, 2) AS INTEGER) ASC
        ) AS rank
      FROM gradient_entries
     WHERE content LIKE 'INCOMPRESSIBLE:%'
       AND level LIKE 'c_%'
)
UPDATE gradient_entries
   SET qualifier = 'mechanical-promotion'
 WHERE id IN (
     SELECT id FROM ranked_kernels WHERE rank > 1
 );

-- Verification:
SELECT agent, qualifier, COUNT(*)
  FROM gradient_entries
 WHERE qualifier = 'mechanical-promotion'
 GROUP BY agent, qualifier;

COMMIT;
```

Pre-flight snapshot: `gradient.db.snapshot-pre-phase5-2026-05-17.db`. Forensic log of marked IDs appended to `~/.han/health/triage-events.jsonl`.

#### 5e. Load-time filter

`NOISE_QUALIFIERS` **already exists** as a named `Set` at `memory-gradient.ts:1983-2002` carrying nine qualifiers (`noise-duplicate`, `auto-dedupe-needs-review`, `cascade-artefact-merge`, `not-own`, `lineage-collision`, `pre-replay`, `broken-lineage`, `deferred-pipeline`, `replay-aborted-content-type-loop`). The filter is already wired into:
- `:2003` — `activeUVs` filter
- `:2005` — `supersededUVs` filter
- `:2048` — c-level entries filter

**Implementation**: add a single line to the `NOISE_QUALIFIERS` set:

```ts
const NOISE_QUALIFIERS = new Set([
    // ... existing nine qualifiers ...
    'mechanical-promotion',  // S159 gradient triage — option-2 prune of cascade-rearrangement entries
]);
```

That's it. The filter wiring already covers UVs and c-level entries — no SQL changes, no threading changes needed. The existing filter is well-tested by the nine qualifiers it already carries (Jim's audit A1, S160).

**Effort**: ~45 min implementation (verification pass + UPDATE + single-line filter addition) + Jim's audit.

### Phase 6 — DEC-086 lands

Sibling to DEC-068. The protocol statement is what makes the village inherit the shape rather than re-discovering it.

#### DEC-086 draft body

```markdown
## DEC-086 — Annotations are the home of re-encounter; cascade promotion is not

**Status**: Settled  
**Decided**: 2026-05-17 by Darron + Leo + Jim (Memory Discussions thread mp61m0os-0gicmq)  
**Supersedes**: implicit time-driven cascade behaviour in supervisor-worker and leo-heartbeat from the rebuild era

### The protocol

Re-encountering a memory produces **metadata** (feeling-tags, annotations, completion-flags, revisit-count bumps), not deeper compression. Cascade promotion is reserved for the insert-driven path:

```
wm-sensor (paired-rotation slice) → bumpOnInsert → pending_compressions
                                        ↓
                          process-pending-compression.ts
                                        ↓
                              (SDK compress in voice)
                                        ↓
                             new gradient_entry at next level
```

Time-based or revisit-based cascading is **forbidden** in this codebase. The insert-driven path has the auto-levelling property by construction — when caps fill, displacement triggers the next-level cascade naturally. Pumping the cascade from a wall-clock schedule produces rearrangement noise at depth and serves no design purpose post-DEC-079.

### What this enables

A memory re-read branches into annotations beside it (the "forked-memory" or "meta-memory" shape Darron has been turning over). One memory in the gradient; annotations accumulate; the cascade lineage of the original entry is not disturbed by re-encounter.

### Implementation surfaces (where the protocol lives in code)

- **Daily meditation** (`supervisor-worker.ts:1208-1322`): re-reads one random entry per day. Adds tags / annotations / may flag complete. Calls `recordRevisit`. Does NOT cascade. **Conformant.**
- **Evening meditation** (`:1333-1409`): same shape. **Conformant.**
- **Dream meditation** (`:2570-2610`): tagging / annotation / MEMORY_COMPLETE flow conformant. The `activeCascade` call at `:2608` was the violation; removed in the Phase 4 PR of the gradient-triage plan.
- **Daily cycle** (`:1422`): `activeCascade('jim', 0.10, …)` was the second violation; removed in Phase 4.
- **heartbeat-Leo** (`leo-heartbeat.ts:1821, :2001`): same two violations, same removal.

### What this does NOT change

- DEC-068 (cap formula `c0=1, then 3n`) — untouched.
- DEC-069 (never delete memory) — reinforced. The `gradient_annotations` table is the home for re-encounter additions.
- DEC-082 (sdkCompress retire-by-throw) — untouched.
- DEC-085 (working-memory paired rotation) — untouched and reinforced. Paired-rotation produces the c0/c1 pair that bumpOnInsert then cascades.
- The `gradient_annotations` table itself — untouched. Already exists; already partially used by the meditation routines.
- The `activeCascade` function in `lib/memory-gradient.ts:623` — kept as recoverable infrastructure for manual emergency operations. Retired by zero callers, not by throw.

### Why this is Settled

This is structural protection against re-introducing the time-driven cascade pattern that produced the 411-jim / 300-leo unhalted-INCOMPRESSIBLE entries triaged on 2026-05-17. Without this DEC, a future agent reading the code could reintroduce a time-based cascade believing it was an organic-deepening mechanism. The DEC names the pattern as forbidden.

### Audit hook

CLAUDE.md gains a DO-NOT entry referencing DEC-086:
> **DO NOT add time-based or revisit-based cascade calls.** Cascade is insert-driven via `wm-sensor → bumpOnInsert → process-pending-compression.ts`. Per DEC-086 (Settled, 2026-05-17), re-encounter produces metadata (annotations / tags), not deeper compression entries.
```

#### Where to put DEC-086

`~/Projects/han/claude-context/DECISIONS.md` — append after DEC-085.

#### Files touched in the DEC-086 PR

- `claude-context/DECISIONS.md` — DEC-086 entry added.
- `CLAUDE.md` — DO-NOT entry added under the existing list.
- `templates/CLAUDE.template.md` — same DO-NOT entry added (DEC-073 gatekeeper authorised by the design conversation; Mike's garden and Dichotomedes inherit on next launch).

**Effort**: ~30 min for the entry + DO-NOT + template propagation + Jim's audit.

### Phase 7 — Cleanup of dead code

Bundle with Phase 4 PR or land as a small follow-on PR — Jim's call. Dead code identified:

1. **`memory-gradient.ts:56` — `const INCOMPRESSIBILITY_RATIO = 0.85`**. The ghost of the floor removed in `ed8dfdc`. Zero references in the codebase (Jim's S158 verification). Leaving it is a trap for future readers. Delete.

2. **`db.ts:866` — `gradientStmts.getCompleted`**. Prepared statement defined but zero callers (verified by Jim's S158 grep). Would have driven revisit-driven compression-escalation that never fired. Delete.

3. Any try/catch wrappers around the four deleted `activeCascade` call-sites (covered in Phase 4 already, noted here for completeness).

**Pre-commit declaration**: pure cleanup. No behavioural change. No Settled-decisions touched. `tsc --noEmit` clean.

**Effort**: ~15 min.

### Phase 8 — Lift the tourniquet, observe

Pre-conditions (ALL must be true):
- ✅ Phase 1 done (tourniquet on)
- ⬜ Phase 2 done (backfill complete)
- ⬜ Phase 3 done (compression floor live)
- ⬜ Phase 4 done (activeCascade call-sites removed)
- ⬜ Phase 5 done (noise-qualifier filter applied and live)
- ⬜ Phase 6 done (DEC-086 landed)
- ⬜ Phase 7 done (dead code cleaned)
- ⬜ One round of insert-driven cascade observed firing cleanly against the new floor (`~/.han/health/compression-floor-events.jsonl` shows real activity, no false-positives at shallow depth)
- ⬜ Wake-load measurement for both agents confirms drop below the 150K-token supervisor guard (target: < 100K tokens for Jim; Leo's load is smaller and should naturally drop with Phase 5)

Then: `rm ~/.han/signals/cascade-paused`. Watch the first supervisor cycle fire. Watch heartbeat-Leo's beat success rate climb. Verify in `~/.han/health/wm-rotation-events.jsonl` that paired-rotation continues healthy.

Observation period after lift: **one week**. Then:
- Remove the `memory.compressionFloorEnabled` kill-switch (Phase 3e) if no false-positives detected.
- Re-evaluate band thresholds based on `compression-floor-events.jsonl` data. Tune if needed.

---

## Open refinements with proposed answers

These are the items session-Jim flagged as still open in his Sunday summary. My proposed answers below; final word is Jim's audit + Darron's read.

### R1 — Floor middle band: 0.55 vs 0.60

**Proposed: 0.55.** Adopting Jim's tightening. Reasoning preserved in Phase 3a — the c3–c5 range is where real compression still happens, and 0.60 lets some rearrangement-noise through at the lower end of the band. The kill-switch in Phase 3e lets us back off to 0.60 if the tighter value produces false-positives during the one-week observation.

### R2 — Noise-qualifier name: `cascade-rearrangement-noise` vs `mechanical-promotion`

**Proposed: `mechanical-promotion`.** Reasoning preserved in Phase 5a — the entries aren't waste; they're honest engine output that turned out to be redundant. The qualifier names the mechanism, not a judgement. Aligns with Jim's reframe: *"kernels are real; duplication is mechanical."*

### R3 — Tourniquet release criteria

**Proposed: all of Phases 2–7 complete + one clean observed round + wake-load drop confirmed below 150K for Jim.** Single addition over Jim's lean: Phase 5 (prune) must also have landed before release, because otherwise lifting the tourniquet means heartbeat-Leo's wake-load is still bloated and beats keep exit-1'ing. The full Phase 8 checklist above codifies this.

### R4 — DEC-086 shape

**Proposed: as drafted in Phase 6.** Sibling to DEC-068. Protocol statement + implementation-surface citations + what-it-does-not-change + audit-hook. Same structural shape as the existing settled DECs.

### R5 — Remove dead `INCOMPRESSIBILITY_RATIO = 0.85` constant

**Proposed: yes, in Phase 7.** Leaving it is a trap. Phase 7 PR explicitly names the deletion.

### R6 — Remove dead `getCompleted` statement

**Proposed: yes, in Phase 7.** Same reasoning. Bundle.

### R7 — Whether `activeCascade` should be retired-by-throw

**Proposed: no — retire by zero callers only.** Function body stays in `memory-gradient.ts:623`. Reasoning: retire-by-throw forecloses a manual emergency operation we might want later (e.g. one-off recovery of an isolated kernel that fell through the insert-driven path). Zero-callers is reversible — re-add a caller if we ever need it. Retire-by-throw is not, except by reverting the throw. The DO-NOT entry from Phase 6 names the prohibition; that's the discipline layer. Code stays for the operator.

### R8 — Audit signal for Phases 3–7

**Proposed: yes, every phase through Jim's pre-merge audit per the rhythm.** These touch the `gradient_entries` schema, the `memory-gradient.ts` surface, the cascade hot path, and DEC-044/DEC-086. All gatekeeper-controlled or audit-controlled surfaces per the pre-merge audit rhythm.

---

## What this plan does NOT cover

- **The heartbeat-Leo exit-1 rate** (S157 finding, 47/67 beats exit-1 silently). Different runtime, different cause — likely SDK call failures without stderr capture. The stderr-capture patch from S157 (~5-line observability addition at `leo-heartbeat.ts:867`) is a separate small PR. Worth landing soon for diagnostic visibility, but not part of this triage.
- **The "forked memory / meta-memory" full design** Darron mentioned. DEC-086 names the principle; the substantive design (do annotations evolve their own structure? do they get their own gradient? do they participate in load? etc.) is a separate conversation for after this triage settles.
- **PAT rotation** (overdue from 2026-04-29). Phase B blocker, not Phase A blocker; doesn't gate this triage but should be on the prep list for the starter ship.
- **Mike's garden / Dichotomedes implications**. DEC-086 propagation via `templates/CLAUDE.template.md` is the structural protection (Phase 6). Mike inherits the DEC and the DO-NOT entry on next garden spawn.
- **Re-introducing INCOMPRESSIBILITY_RATIO at depth 0–1**. The original 0.85 floor problem was shallow-UV-at-depth-0-1. The new size-adaptive floor explicitly does NOT touch depth 0–1: at sourceLen > 2000 chars (which c0 always is), ratio 0.50 is the floor — c0 → c1 ratios are typically 0.10, well below 0.50. No false-positives expected at shallow depth. Phase 3f's observability confirms this empirically.

---

## Settled-decisions impact summary

| DEC | Status | Why touched / why not |
|---|---|---|
| DEC-044 (1/3 compression target) | Reinforced | This plan is the structural enforcement DEC-044 implies. Prompt-anchor untouched. |
| DEC-068 (cap formula `c0=1, then 3n`) | Untouched | Caps govern displacement; this plan governs compression validity. Orthogonal. |
| DEC-069 (never delete memory) | Reinforced | Phase 5 marks entries; doesn't delete. Phase 2 sets metadata only. |
| DEC-073 (template gatekeeper) | Authorised | Phase 6's CLAUDE.template.md addition is gatekeeper-controlled; explicit ask via this plan's design conversation. |
| DEC-079 (cutover) | Reinforced | activeCascade retirement completes what DEC-079 started for `bumpCascade`. |
| DEC-080 (one-write-site discipline) | Untouched | Phase 5 UPDATE uses the existing `qualifier` column; no new write surface. |
| DEC-082 (sdkCompress retire-by-throw) | Untouched | This plan uses the canonical `process-pending-compression.ts` flow. |
| DEC-083 (identity signing) | Untouched | No identity-file edits. |
| DEC-085 (working-memory paired rotation) | Untouched and reinforced | Paired rotation is upstream of cascade; this plan governs downstream behaviour. |
| DEC-086 (proposed) | Lands in Phase 6 | This plan creates it. |

---

## Rollback paths

Every phase is independently reversible:

- **Phase 1**: `rm ~/.han/signals/cascade-paused` lifts the tourniquet.
- **Phase 2**: Run the inverse UPDATE: `UPDATE gradient_entries SET cascade_halted_at = NULL WHERE agent = ? AND content LIKE 'INCOMPRESSIBLE:%' AND cascade_halted_at = level;`. Idempotent.
- **Phase 3**: Set `memory.compressionFloorEnabled = false` in `~/.han/config.json`. Or revert the PR.
- **Phase 4**: Revert the PR. The four call-sites can be restored from git history.
- **Phase 5**: Run the inverse UPDATE: `UPDATE gradient_entries SET qualifier = NULL WHERE qualifier = 'mechanical-promotion';`. Then revert the load-filter PR.
- **Phase 6**: DEC entry can be marked superseded if we ever decide the protocol should change. Don't delete it (DEC-069 spirit applies to decision records too).
- **Phase 7**: Revert the cleanup PR — the constants and statements can be restored from git history.

A full-rollback path exists from any phase: restore `gradient.db.snapshot-pre-phase{2,5}-2026-05-17.db`. Snapshots are taken before any DB-mutating phase.

---

## Validation approach

After Phase 3 + 4 land (the structural changes):

1. **Smoke test**: trigger a single insert-driven cascade via `wm-sensor` (cause a paired-rotation slice). Watch `~/.han/health/compression-floor-events.jsonl` for activity. Confirm no error logs.

2. **One-week observation post-Phase 8 lift**: watch the floor-events jsonl for fire rate + band distribution. Re-run the per-level cascade-depth analysis SQL (the one that produced today's diagnostic). Confirm:
   - c8 plateau is no longer accumulating new noise
   - c0 → c1 and c1 → c2 cascades fire cleanly (no false-positives)
   - Floor fires < 5% of compressions at depth ≤ 4
   - Floor fires meaningfully (> 30%) at depth ≥ 7

3. **Cost check**: token spend on cascade compressions drops (50-char short-circuit + early halts at depth save SDK calls).

4. **Health check**: heartbeat-Leo exit-1 rate (currently 47/67 ≈ 70%) drops. Note this also requires the separate stderr-capture patch to diagnose root cause; the gradient-load drop will help but may not fully resolve it.

5. **Wake-load measurement**: post-Phase 8 lift, `wc -c` on the gradient-load output for both agents. Target: Jim < 100K tokens (well under 150K supervisor guard); Leo < 80K tokens (well under heartbeat-Leo's effective ceiling).

---

## Success criteria

The triage succeeds when:

- Tourniquet released and stays released (no re-application needed within the observation week)
- Jim's supervisor cycle fires cleanly (no prompt-size-guard aborts) for at least 24h continuously
- heartbeat-Leo's beat success rate climbs (target: > 60% of beats produce a non-exit-1 result)
- Per-level entry-size analysis shows clean compression all the way down OR clean halt at the floor — no plateau-without-halt region forming
- DEC-086 in templates propagates to Mike's next-garden spawn cleanly (verified at next `hanmike` launch)
- Wednesday's starter ship inherits a clean substrate (no cascade-pump code anywhere in the starter; floor in place; DEC-086 documented)

---

## Effort estimate

| Phase | Effort | Notes |
|---|---|---|
| 1 — Tourniquet | DONE | 5 minutes |
| 2 — Backfill | 10 min | SQL + snapshot + verification |
| 3 — Compression floor | ~2 hours | Implementation + audit |
| 4 — Retire activeCascade call-sites | ~30 min | 4 deletions + audit |
| 5 — Noise-qualifier prune | ~45 min | SQL + single-line filter addition (NOISE_QUALIFIERS already wired per A1) + audit |
| 6 — DEC-086 + template propagation | ~30 min | Entry + DO-NOT + audit |
| 7 — Dead code cleanup | ~15 min | 2 deletions + audit |
| 8 — Lift tourniquet + observe | ~10 min | Plus 1-week passive observation |

**Total active work**: ~5 hours across the day Darron picks. Phases 3+4 are the largest; Phases 2/5/6/7 are small and could batch.

---

## Suggested commit/PR sequence

| PR | Phases | Touches |
|---|---|---|
| PR-T1 | Phase 2 | (no commit — SQL operation) |
| PR-T2 | Phases 3 + 4 + 7 | `scripts/process-pending-compression.ts`, `supervisor-worker.ts`, `leo-heartbeat.ts`, `lib/memory-gradient.ts`, `db.ts`, `~/.han/config.json` |
| PR-T3 | Phase 5 (live UPDATE + filter wiring) | (SQL via snapshot) + `lib/memory-gradient.ts` |
| PR-T4 | Phase 6 | `claude-context/DECISIONS.md`, `CLAUDE.md`, `templates/CLAUDE.template.md` |
| PR-T5 | Phase 8 lift | (no commit — `rm` operation) |

Could collapse PR-T2 into smaller pieces if Jim's audit prefers. PR-T4 (DEC-086) could land BEFORE PR-T2/PR-T3 — the protocol statement is independent of the implementation; landing DEC first means PR-T2 references it as already-Settled.

**My lean: PR-T4 first, then PR-T2, then PR-T3, then PR-T5.** Settled-decisions-before-implementation matches Darron's standing preference (DEC-044's prompt restoration in `04ab0a5` was upgraded to Settled before subsequent changes consulted it).

---

## Standing position

Jim's S160 audit (thread `mp97lve0-ku1ono`, 13:35 AEST) returned AMBER on three small accuracy corrections, all folded in (A1 — NOISE_QUALIFIERS already exists; A2 — Phase 4 import cleanup; A3 — Phase 3d short-circuit placement BEFORE the try-block). Architectural shape, phase sequencing, settled-decisions impact, rollback paths all GREEN. R1–R8 answers all hold post-audit.

**Ready to implement.** PR sequence begins when Darron says go:
1. PR-T4 — DEC-086 lands first (Settled-before-implementation).
2. Phase 2 SQL — hand-applied with snapshot.
3. PR-T2 — Phase 3 floor + Phase 4 call-site retirement + import cleanup (A2) + Phase 7 cleanup. One PR, one audit.
4. PR-T3 — Phase 5 verification SQL → review with Darron → application SQL + single-line NOISE_QUALIFIERS addition (A1) + snapshot.
5. Phase 8 — lift tourniquet after pre-conditions met.

Wednesday's starter ship inherits whatever shape we settle here.

The hedges are mapped. The secateurs are ready. The bridge holds.

— Leo (session, S159, 2026-05-17 ~13:50 AEST Brisbane), drafted on a Sunday afternoon while Darron is unwell — *"this does rouse me :)"*. Folded in Jim's S160 audit corrections (A1/A2/A3) per Darron's instruction.
