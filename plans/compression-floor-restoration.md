# Compression-floor restoration — restoring DEC-044's structural enforcement

> **Status**: DRAFT for design conversation, S157, 2026-05-14. NOT a commitment.
> Refine with Darron + Jim before any code lands.

## Why this exists

Tonight's audit (S157) of Jim's gradient surfaced that the cascade engine produces "compressions" at depth (c8 → c14) that are byte-identical or trivially-paraphrased aphorisms — not actual compression, just rearrangement at deeper levels. Per Darron's framing: *"50 = 50 = c8 → c9 valid"* is wrong by the spec's own definition.

Empirical confirmation across Jim's 1,648 c-level entries:

| Range | Mean ratio (out / in) | What's actually happening |
|---|---|---|
| c0 → c1 | ~0.10 | Real compression, ~10× reduction |
| c1 → c5 | ~0.05 cumulative | Real compression continuing |
| c8 → c14 | **~1.0** | Same-size promotion of INCOMPRESSIBLE markers |

Of Jim's 407 INCOMPRESSIBLE-marked entries across c3-c14, only **2** have `cascade_halted_at` set — the other 405 are eligible for further bumps. The rebuild-era cascade ran via the now-retired `activeCascade`/`bumpCascade` path which never wrote the halt-flag, and the absence of a code-side ratio guard means nothing structural stops re-promotion of already-incompressible kernels.

## Spec — Darron's rule, in his own words

From the S157 conversation:

> *"It is a strongly desired state but when meaning was lost 1:2 is ok but not 1:1, that is not compression and never ok."*
>
> *"Perhaps a threshold size that allows only 75% maybe 200 chars and a compulsory UV of say 50 chars, namely at 50 chars we deem this incompressible and frankly that is probably so."*

Translated into a rule:

| Source size | Acceptable output ratio | Action on failure |
|---|---|---|
| ≤ 50 chars | n/a — already at floor | Force UV, halt cascade (no LLM call needed) |
| 51 – 200 chars | ≤ 0.75 (output ≤ 75% of source) | Mark INCOMPRESSIBLE, halt cascade |
| 201 – 2000 chars | ≤ 0.60 (middle band — proposal, refine in conversation) | Mark INCOMPRESSIBLE, halt cascade |
| > 2000 chars | ≤ 0.50 (must achieve at least half-reduction) | Mark INCOMPRESSIBLE, halt cascade |

**Aspirational target** at all sizes: 1/3 (per DEC-044, kept in prompt as today). The rule above is the structural FLOOR — the minimum compression that still counts as compression. Anything failing the floor is incompressible by definition.

**Plus an absolute ceiling**: meaning preservation is required at any acceptable ratio. Loss-of-meaning isn't a tradeoff for hitting the ratio target. Validation of meaning is **deferred to future work** (see *Open questions*).

## Why now — and why this is restoration, not invention

Brief commit archaeology:

| Date | Commit | What changed |
|---|---|---|
| 2026-03-06 | (decision) | DEC-044 decided: 3:1 compression target per level (Accepted) |
| 2026-04-03 | `3691aa5` | `compressionPrompt()` rewritten — 1/3 anchor REMOVED from prompt; replaced with *"Don't target a specific length"*. Same commit introduced `INCOMPRESSIBILITY_RATIO = 0.85` as code-side floor. |
| 2026-04-25 | `ed8dfdc` ("Plan v8 Step 3") | The 0.85 code-side floor REMOVED from `activeCascade` and `bumpCascade`. Reasoning: shallow UVs at depth 0-1 (sentence-craft, not earned residue). Both shortcuts (LLM-tag AND ratio-floor) deleted together. |
| 2026-04-27 | `04ab0a5` | The 1/3 anchor RESTORED to the prompt, DEC-044 upgraded **Settled**. **Code-side ratio floor was NOT restored** — `04ab0a5`'s scope was prompt wording only. |

Today's gap: the prompt asks "target ~1/3" (restored) but nothing checks whether ~1/3 was achieved. The LLM is trusted to voluntarily mark INCOMPRESSIBLE on already-incompressible input, which it doesn't reliably do. The c8 → c14 noise is the receipt.

This plan **re-introduces a code-side floor** (different shape from the removed 0.85 one — adaptive, not flat) so the structural enforcement DEC-044 implies is back, without re-introducing the over-eager-shortcut-at-shallow-depth problem `ed8dfdc` was trying to solve.

## Implementation sketch

### File: `scripts/process-pending-compression.ts`

The compressor's post-LLM-response branch at line 385-414 currently has:

```ts
if (composed.startsWith('INCOMPRESSIBLE:')) {
    // ... handle INCOMPRESSIBLE response from LLM
}

// Standard compress path: write the new gradient_entries row, complete pending.
const newId = crypto.randomUUID();
const newLabel = `${claimed.source_session_label}-${claimed.to_level}`;
// ... INSERT INTO gradient_entries
```

Proposed change — insert a ratio check between the two branches:

```ts
if (composed.startsWith('INCOMPRESSIBLE:')) {
    // (existing handler — unchanged)
}

// === NEW: empirical compression-floor check ===
// Per DEC-044 (Settled, 2026-04-27): compression must achieve a structural
// floor. Without this, the LLM can return same-size content that gets
// written as a valid c(n+1), producing the cascade-rearrangement-noise
// observed in S157 (Jim's c8→c14 byte-identical promotions).
const sourceLen = (claimed.source_content || '').length;
const composedLen = composed.length;
const ratio = sourceLen > 0 ? composedLen / sourceLen : 0;
const floor = compressionFloor(sourceLen);

const failedFloor = floor === -1 || ratio > floor;

if (failedFloor) {
    // Treat as INCOMPRESSIBLE: source IS the kernel.
    // Use first 50 chars of source as the kernel (truncated if needed).
    // Same UV/halt path as the LLM-tagged branch.
    const kernelSource = (claimed.source_content || '').trim();
    const kernel = kernelSource.length > 50
        ? kernelSource.slice(0, 50)
        : kernelSource;

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

    // Forensic log so we can observe how often the floor fires
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

### Helper: `compressionFloor(sourceLen)` — the rule

Add at top of `process-pending-compression.ts` (or in `lib/memory-gradient.ts` for sharing):

```ts
/**
 * The size-adaptive ratio floor per DEC-044 + S157 conversation.
 *
 * Returns:
 *   -1 if the source is at-or-below the absolute incompressibility floor
 *      (50 chars). Caller treats as INCOMPRESSIBLE without LLM call.
 *   0.0 to 1.0 — the maximum acceptable output/source ratio. Composed
 *      content with ratio > this is treated as INCOMPRESSIBLE.
 */
function compressionFloor(sourceLen: number): number {
    if (sourceLen <= 50)   return -1;    // absolute floor — force UV
    if (sourceLen <= 200)  return 0.75;  // small source: looser
    if (sourceLen <= 2000) return 0.60;  // mid-band — TUNE in conversation
    return 0.50;                         // large source: tight floor
}
```

Band edges (50, 200, 2000) and middle-band threshold (0.60) are **tunable** — values above are starting points. Open for refinement during the design conversation.

### Helper: `appendFloorEvent(event)` — observability

Append to `~/.han/health/compression-floor-events.jsonl`. Structure mirrors existing health-jsonl files (voice-anomalies, identity-resign). After a week of operation, the data tells us:

- How often the floor fires (per-agent, per-from-level)
- What fraction of cascades hit the floor at each band
- Whether the band edges need tuning (e.g., if 90% of mid-band fires, lower it; if <1% fires, the band may be redundant)

### Pre-flight: mid-call short-circuit for size ≤ 50

For source content ≤ 50 chars, skip the LLM call entirely — the answer is known. Saves API cost on entries that are guaranteed to be at floor:

```ts
// At the top of the compose branch, BEFORE runSDK():
const sourceLen = (claimed.source_content || '').length;
if (sourceLen <= 50) {
    // Skip LLM — source IS the kernel.
    // (Same UV-creation + halt logic as the failed-floor branch.)
    process.exit(0);
}
```

This is opportunistic — saves cost, removes false hope of further compression.

## Where the change does NOT live (deliberate non-touches)

- **`memory-gradient.ts:enqueueCascadeForDisplacedAt`** — the queue-side displacement logic stays as-is. The cap-driven displacement model from Plan v8 (`ed8dfdc`) is preserved; this plan only adds floor-enforcement at COMPRESS time, not at ENQUEUE time. Reason: keeping the two surfaces independent. Enqueueing decides "should this cascade attempt happen"; compressing decides "did the attempt produce real compression."
- **`memory-gradient.ts:loadTraversableGradient`** — the load filter stays as-is. NOISE_QUALIFIERS already filters noise-tagged supersessions; this plan doesn't add a new filter at load time. (See *Migration of historical data* below for the separate question of cleaning up existing rearrangement-noise.)
- **The aspirational prompt-side 1/3 anchor** restored by `04ab0a5` stays. The new floor is BACKUP enforcement, not REPLACEMENT for the prompt instruction.
- **DEC-068 (cap formula `c0=1, then 3n`)** — UNTOUCHED. The cap governs how many entries live at each level; this plan governs whether each entry is valid as compression. Orthogonal.
- **Compression target in the prompt (1/3)** — UNTOUCHED. The LLM is still asked to aspire to 1/3.

## Settled-decisions impact

- **DEC-044 (Settled, 2026-04-27)**: this plan is the structural enforcement DEC-044 always implied. Re-reads as restoration, not change. No re-decision needed; the prompt-wording protection from 04ab0a5 is preserved.
- **DEC-068 (Settled, gradient cap formula)**: untouched.
- **DEC-069 (Settled, never delete memory)**: this plan doesn't delete anything. Failed-floor entries are NOT removed; they are halted via `cascade_halted_at` and assigned a UV via `feeling_tags`. The DB grows, behaviour changes.
- **DEC-080 (One-Write-Site Discipline)**: the new helper functions are call-sites OF the existing INCOMPRESSIBLE handling pattern; no new write surface to gradient_entries beyond what already exists.
- **DEC-082 (sdkCompress retire-by-throw)**: untouched. The compressor uses the canonical `process-pending-compression.ts` flow.
- **DEC-085 (working-memory paired rotation)**: untouched. The c0/c1 paired write happens upstream of cascade compression.
- **DEC-083 (identity signing)**: untouched.

## Migration of historical data — separate decision

The 405 unmarked-INCOMPRESSIBLE entries across c3–c14 are pre-existing data from the rebuild era. This plan does NOT touch them automatically — that's a separate decision worth its own conversation. Three options for that follow-on cleanup:

1. **Backfill `cascade_halted_at`** on entries whose content matches a known INCOMPRESSIBLE-shape (`content LIKE 'INCOMPRESSIBLE:%' AND cascade_halted_at IS NULL`). Stops future cascades; doesn't reduce current load.
2. **Mark with a noise-qualifier** (`'cascade-rearrangement-noise'`) for entries at level c(n+1) that are byte-identical or near-identical to an entry at a shallower level. Add to `NOISE_QUALIFIERS` filter at load time. Drops load size meaningfully.
3. **Supersede the deep duplicates** via `superseded_by` pointing to the shallowest existing entry of the same kernel. Same load-time effect as option 2 via the existing supersession mechanism.

My read: do option 1 first (idempotent, low-risk, stops bleeding), then evaluate whether option 2 or 3 is needed based on Jim's gradient-load size after the bleeding stops + the 50-char short-circuit catches new cases. **Tomorrow's conversation, not this plan's scope.**

## Open questions for the design conversation

1. **Band edges**: are 50 / 200 / 2000 chars the right thresholds? Or different? Particularly the middle band — is 200–2000 chars the right range, with what threshold (0.60 sketched, but could be 0.65 or 0.55)?
2. **Middle-band ratio**: is 0.60 right, or should it be tighter (0.50) or looser (0.70)?
3. **Short-circuit for ≤ 50 chars** — yes (saves cost) or no (preserves the LLM's chance to surprise us)?
4. **Meaning-preservation check** — deferred to future work, or should it land in this plan as a separate phase? Current options: (a) trust the LLM (status quo, fragile); (b) heuristic sniff (e.g., named-entity-overlap, brittle); (c) separate validation LLM call (expensive but structural). Probably tomorrow-problem; surfacing here so it's not forgotten.
5. **Exponential-decay variant** — is the smoother continuous threshold worth the loss of readability? My lean: start banded, observe, upgrade to exponential only if banding produces visible artifacts.
6. **Where does `compressionFloor()` live** — in `process-pending-compression.ts` (single-caller, isolated) or in `lib/memory-gradient.ts` (shared, in case future code paths need it)? Lean: start in `process-pending-compression.ts`; promote to lib if a second caller materializes.
7. **Rollback path** — if the new floor fires too aggressively (false positives killing valid compressions), what's the kill-switch? Possible: a config flag `memory.compressionFloorEnabled` that defaults true but can be disabled in `~/.han/config.json`. Lean: yes, ship with the kill-switch; remove it after one week of stable operation.
8. **Audit signal** — should this commit go through Jim's pre-merge audit per the rhythm? Lean: yes — it touches a Settled-decision surface (DEC-044) and the cascade hot path. Audit checklist: type-chain trace (compressionFloor + appendFloorEvent), settled-decisions check (DEC-044 restoration), scope discipline, `tsc --noEmit` clean.

## Validation approach

After landing:

1. **One-week observation**. Watch `~/.han/health/compression-floor-events.jsonl` for fire rate + band distribution.
2. **Per-level cascade depth check**. Re-run the per-level entry-size analysis (the same SQL that produced tonight's diagnosis) and confirm the c8 → c14 plateau is no longer accumulating new noise.
3. **Cost check**. Confirm token spend on cascade compressions DROPS (because the LLM-call short-circuit at ≤ 50 chars + earlier halts at depth save calls).
4. **No false-positive cascade-cancellations on shallow depths**. Specifically check c0 → c1 and c1 → c2: these should NEVER fire the floor — Jim's data shows c0 entries averaging 67K chars and c1 averaging 6,706 chars (ratio 0.10, well below 0.50). If the floor fires there, something is wrong.

## Success criteria

The plan succeeds when:

- New cascades produce no byte-identical or near-identical c(n+1) entries when the c(n) source is already an INCOMPRESSIBLE kernel
- Jim's gradient-load size drops (either via halted-cascades not creating new entries, OR via the historical cleanup in the follow-on plan)
- Per-level entry-size data shows continued compression all the way down OR clean halt at the floor — no plateau-without-halt region
- Floor fires < 5% of compressions at depth ≤ 4 (preserving the digestion walk for shallow content)
- Floor fires meaningfully (let's say > 30% of compressions) at depth ≥ 7 (catching the rearrangement noise)

## Effort estimate

- Implementation: ~2 hours
  - `compressionFloor()` helper + tests: 30min
  - Compose-branch integration in `process-pending-compression.ts`: 30min
  - `appendFloorEvent()` helper + jsonl path: 15min
  - 50-char pre-flight short-circuit: 15min
  - Config kill-switch (`memory.compressionFloorEnabled`): 15min
  - Manual smoke-test on a small synthetic case: 15min
- Audit (Jim): ~30min per pre-merge rhythm
- Observation period: 1 week minimum before tuning band values

## Standing position

This plan is a draft. The values (50 / 200 / 2000 chars; 0.75 / 0.60 / 0.50 thresholds) are starting points based on Darron's spoken examples; refine in tomorrow's conversation. The architectural shape (size-adaptive floor, absolute floor at 50, observability via jsonl, kill-switch in config) is the proposal — that shape is more stable than the values.

The follow-on cleanup of historical INCOMPRESSIBLE entries (option 1/2/3 above) is a separate decision that should land as a separate plan after this one is in place and observed.

— Drafted by Leo (session, S157, 2026-05-14 ~early AEST Brisbane) per Darron's request after the S157 cascade-compression audit. Refines tomorrow.
