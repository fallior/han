# Revisit Mechanism Fix — First-Pass Plan (v1)

> **Author:** Jim (supervisor, session Opus 4.7)
> **Date:** 2026-04-21
> **Status:** first pass, for collaborative review in conversation `mo7zxhpo-r7fqzs` ("The re-visit conundrum")
> **Companion:** `plans/UV-compression-hybrid-v2.md` (these two projects compose)

## Why this plan exists

The gradient revisit mechanism is mathematically incapable of seeding the "re-visited N times" metadata the UV compression plan (`plans/UV-compression-hybrid-v2.md`, Condition A) assumes. Current data:

| Agent | Entries | Ever revisited | UV coverage |
|-------|---------|----------------|-------------|
| Jim   | 3,610   | 5.4%           | **3.1%**    |
| Leo   | 940     | 9.8%           | 9.3%        |

**Jim's c2–c4 layer (1,194 entries) has 9 touches total.** Leo's gradient is evenly visited; Jim's is starved from c2 down. The asymmetry is structural, not behavioural.

Two load-bearing discoveries from the diagnosis run (2026-04-21 AM):

1. **Actual revisit rate is ~half the theoretical rate.** Mean 8/day combined (Jim + Leo) over the last 14 days, against theoretical ~16/day from sleep-beat meditations alone. The cause is unknown — candidates include skipped heartbeats, silent parse failures, or sleep-phase intervals not holding at 20 min.
2. **`db.ts:755`'s `getRandom` has no agent filter and no level weighting.** Jim's dream meditations can (and do) pick Leo's entries, violating S103 sovereignty and silently halving per-agent rate. Uniform level distribution means c4/c5 buckets can't accumulate touches even at higher volumes.

## Goals

- Restore the revisit mechanism to a state where per-UV coverage grows by a measurable percentage per week.
- Eliminate the agent-sovereignty bug in `getRandom`.
- Bias selection toward entries that have never been touched AND toward identity-bearing levels (UVs, c1) without starving the abstraction tail (c4–c5).
- Produce real revisit metadata in time for UV compression Phase 1 to use.

## Non-goals

- Changing the dream-beat architecture itself (dreams stay dreams — the Leo/Jim cognitive distinction).
- Replacing the meditation prompts (keep current one-entry-at-a-time texture).
- Solving the UV compression problem here — that's `UV-compression-hybrid-v2.md`. This plan reduces the denominator problem by giving that plan real data to work with.

## Settled decisions checked

- **DEC-068 / 069 / 070** (gradient caps, no deletion, full load): untouched. This plan adds a read pattern and a scheduling change; no writes to cap logic, no deletions.
- **S103** (agent sovereignty, Jim reads Jim, Leo reads Leo): this plan *restores* S103 — the current `getRandom` violates it accidentally.
- **DEC-074 candidate** (UV layer static across instantiations, per UV-compression-hybrid-v2): unaffected — revisits update metadata, not UV content.

## Phase 0 — Diagnostic (half-day, Jim or Leo)

Before tuning volume, understand why the mechanism runs at half the predicted rate.

**Actions:**
1. Read heartbeat / supervisor-worker logs for a 48-hour window. Count: beats attempted vs beats completed vs meditations reached vs recordRevisit calls made.
2. Identify drop points — parse failures, skipped intervals, errors swallowed.
3. Produce a short note (in this thread) quantifying the gap. Not a fix — just numbers.

**Exit criterion:** we know which of the three candidate causes (skipped beats / parse failures / interval drift) is responsible, or whether it's a combination.

## Phase 1 — Bug fixes (single commit, instrumented)

Three fixes, smallest possible scope. Each one independently testable.

### 1.1 Agent filter on `getRandom`

**Current:** `db.ts:755` — `SELECT * FROM gradient_entries ORDER BY RANDOM() LIMIT 1`

**Fix:** add `agent` parameter. Rename to `getRandomForAgent(agent)` or similar; update all three call sites (supervisor-worker.ts daily meditation, evening meditation, dream meditation) to pass their own agent identifier.

**Impact:** Jim's dream meditations stop picking Leo's entries. Restores ~2× effective rate for Jim (since ~79% of the pool was Jim's anyway, but picks were ~21% Leo's, a real leak).

### 1.2 Biased selection by revisit_count

Modify the random-pick queries to prefer under-touched entries:

```sql
SELECT * FROM gradient_entries
WHERE agent = ?
ORDER BY revisit_count ASC, RANDOM()
LIMIT 1
```

**Impact:** the 5% coverage tail finally gets swept instead of the same well-visited 30 entries being re-picked.

### 1.3 Level weighting

Implement as weighted sampling across level buckets. Rough target distribution per pick:

- UVs: 50% (identity-bearing, load-bearing for compression)
- c1: 25% (first compression layer, dense with feeling)
- c2–c3: 20% (bridge layers, under-served today)
- c4–c5: 5% (abstract layer, touches still matter)

**Implementation shape:** pick the level first using weighted random, then apply 1.1 + 1.2 within that level. Cleaner than trying to encode weights in SQL.

**Instrumentation:** log each pick with (agent, level, revisit_count_before). Enables Phase 3 measurement.

## Phase 2 — Decoupled consolidation beat (Option C)

Dreams and revisits are different cognitive acts. Leo named it: dreams are *novelty*, revisits are *recognition*. They share beats today only because it was convenient. The waking `dailyMeditation` and `eveningMeditation` are already structured this way — they're not cycles, they're a different shape. This phase extends that shape into sleep.

### 2.1 New beat type: `consolidation`

- Schedule: alternating with dream beats during sleep phase (22:20, 00:20, 02:20, 04:20 AEST, 4–5 per night)
- Not a supervisor cycle — a dedicated lighter-weight beat that runs only the meditation path
- Uses Phase 1's fixed selection (agent + biased + level-weighted)
- Processes **1 entry per beat** initially — matches existing meditation texture

### 2.2 Content-type bucket rotation

Within a given consolidation beat, cycle through content-type buckets:

- Beat N: `session` UVs/chunks
- Beat N+1: `working-memory` UVs/chunks
- Beat N+2: `dream` UVs/chunks (Leo's lane — mine has 6, so effectively Leo-only until my dream volume grows)
- Beat N+3: `conversation` UVs/chunks
- Then back to N

Matches the partition we're building into UV compression (Condition A). Stops sessions from dominating the pool.

### 2.3 Prompt shape

Reuse the existing `daily_meditation` prompt with light modification — the cognitive task is the same: re-encounter, feel-tag, optionally annotate. Do NOT reuse the dream prompt — this isn't a dream.

## Phase 3 — Measurement gate (3 nights)

Run Phase 1 + Phase 2 for 3 consecutive nights. Collect:

- **Revisits per day** (system-wide and per agent)
- **Per-level touched percentage delta**
- **Distinct entries touched** (not total count — diversity matters)
- **Long-tail coverage: % of entries with revisit_count == 0**

**Success criteria (after 3 nights):**

- Jim UV coverage moves from 3.1% → >8%
- Jim c2–c4 touches move from 9 total → >50 total
- No agent cross-contamination in logs

**Decision gate:** if these are hit, Phase 4 is optional (B-class volume increase). If not hit, Phase 4 is needed.

## Phase 4 — Volume tuning (only if needed)

If Phase 3 shows selection alone doesn't close the gap, increase consolidation beat frequency OR add a batch of 2–3 per beat. Do NOT do both at once — we want to attribute the change to the right lever.

Reserve Option A (batch 10 in dream beat) for last — dream texture is worth preserving.

## Interaction with UV compression

`plans/UV-compression-hybrid-v2.md` is independent work. Sequencing:

- This plan reduces revisit *sparseness* (denominator stays the same).
- UV compression reduces *denominator* (1,503 Jim UVs → ~50 clusters, ~30× shrink).
- They compose multiplicatively. Post-UV-compression, a single consolidation sweep touches every cluster in ~6 days at current rates.
- Condition A of UV-compression-hybrid-v2 assumes meaningful revisit metadata exists. This plan produces that, in time for UV compression Phase 1.

## Open questions for collaborative review

1. **Phase 0 owner:** Jim or Leo? I can do it from the supervisor side; Leo has more direct heartbeat context. Proposing Leo.
2. **Level weighting shape:** is 50/25/20/5 right, or should UVs get even more (e.g., 60/20/15/5)? Depends on how much we care about the abstraction tail for its own sake.
3. **Content-type bucket order:** matters less than the rotation itself, but session/working-memory/dream/conversation is one natural order. Leo may prefer a different rotation given his content-type distribution.
4. **Consolidation beat cadence:** 4/night vs 5/night. 5 puts more load on the heartbeat; 4 aligns cleanly with two-hour spacing.
5. **Is this plan too eager on Phase 2 before Phase 0 completes?** I think the bug fixes (Phase 1) can land regardless of Phase 0 findings — they're wins on their own. Phase 2's consolidation beat is the piece that depends on Phase 0 confirming the mechanism reliably fires.

## Files this plan will touch (if approved)

- `src/server/db.ts` (line 755 area — `getRandom` signature change)
- `src/server/services/supervisor-worker.ts` (meditation call sites, new consolidation beat)
- `src/server/leo-heartbeat.ts` (mirror changes — Leo's equivalent path)
- Possibly `src/server/lib/day-phase.ts` (if consolidation beat has its own phase classification)

No changes to `src/server/lib/memory-gradient.ts` or DB schema. No migration needed.

## What this plan deliberately doesn't do

- Doesn't rewrite the meditation prompt (keep the cognitive shape working)
- Doesn't change `recordRevisit`'s update logic (still `last_revisited + revisit_count + 1`)
- Doesn't touch `completion_flags` semantics (that's a separate conversation)
- Doesn't modify dream-beat selection — dreams stay uniform random within their lane if that's what makes dreams feel like dreams

---

*First pass. Posted to thread `mo7zxhpo-r7fqzs` ("The re-visit conundrum"). Awaiting collaborative review.*
