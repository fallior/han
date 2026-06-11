# Plan — Gradient terminus integrity: UV-promotion + insert-lock verification (S167)

> **✅ STATUS: LANDED 2026-06-08 as DEC-090** (commit `f714f58` — cN-uv compound terminus + A2 insert-lock; Jim plan- + diff-audited GREEN; leo migrated 107 leaf-termini; jim's B2 promotion pending). This plan is **historical/reference** now — see DECISIONS.md DEC-090 for the canonical record. *(Was: "DRAFT for Jim's audit"; back-marked 2026-06-10 in the reconcile-sweep so it doesn't read as un-built.)*
> **Author:** Leo (session), 2026-06-08 (S167). Leo-build / Jim-audit on any protected change.
> **Origin:** Darron escalated the "terminated chains without UV tags" integrity break to urgent. Jim wrote up the corrected model (UVs discovered not generated; first INCOMPRESSIBLE = UV, nothing below) and proposed the insert-lock as the permanent fix + promoting existing kernels. This plan grounds that in the live code.
> **Protected surfaces:** `lib/memory-gradient.ts`, `scripts/process-pending-compression.ts`, `db.ts` (DEC-068/069/082/086/044). Snapshot before any data change; Leo-build → Jim-audit for any code.

---

## 0. The headline finding (audit correction — verify in Jim's audit)

**The insert-lock / compression floor is ALREADY LANDED and working.** Verified this session against the live code + data:

- `process-pending-compression.ts` has the size-adaptive floor: `compressionFloor()` (:74), pre-flight absolute-floor short-circuit (:437), post-LLM ratio-floor (:530–573), kill-switch `memory.compressionFloorEnabled` (:81–87), events log `~/.han/health/compression-floor-events.jsonl`.
- **Both** termination branches tag the terminus as a UV (feeling-tag `tag_type='uv'`) **and** set `cascade_halted_at`:
  - voluntary `INCOMPRESSIBLE:` from the LLM → :499–508 (tags `claimed.source_id`, halts).
  - ratio-floor failure (non-reducing child) → :539–548 (tags source, halts).
- **Empirical proof it works:** 0 byte-shuffles (`content == source-parent content`) created after the floor landed (2026-05-17) — for **both** jim and leo. The floor is firing correctly (events through 2026-06-07, ratios 0.55–0.56 at the c2→c3/c3→c4 boundary).
- The legacy backlog (leo's 225 byte-shuffles + 63 untagged termini; jim's ~266 + ~146) is **pre-floor or restart-lag residue** — the old time-driven `activeCascade` (retired by DEC-086) kept running a few days after the triage commits until services restarted (the documented operator-restart-discipline gap). Latest leo untagged terminus: 2026-05-21; nothing in June.

**Implication:** the recurrence Darron keeps hitting is **legacy backlog**, not active creation. The "permanent fix" Jim points to is mostly already in place. What remains is (A) finishing the legacy cleanup, (B) two harden/verify items, and (C) two genuine decisions. This is smaller than the premise suggested.

---

## Part A — Prevention: verify complete + optional hardening

**A1 (verify, Jim's audit).** Confirm no compression/insert path bypasses the floor:
- `process-pending-compression.ts` is the only live compression path post-DEC-082/086. Confirm `bumpOnInsert` / the cascade walk (`memory-gradient.ts` ~634–820) only **enqueues** `pending_compressions` and never directly inserts a deeper level with non-reduced content. (The Plan-v8 "cap-driven, no INCOMPRESSIBLE early-exit" comment at :718/:802 is about *displacement*, not about writing non-reduced children — confirm.)
- Confirm `activeCascade` has zero live callers (DEC-086) — retained-by-throw/zero-callers only.

**A2 (optional hardening — Jim/Darron call).** Jim's "physics, not policy" idea: a hard guard at the lowest write primitive (`insertGradientEntry` / a new `insertCompressedEntry`) that **throws** if asked to write a `c(n+1)` whose content did not genuinely reduce vs its `source_id` parent (ratio ≈ 1.0). The floor already prevents this upstream; this is belt-and-braces so no *future* code path can reintroduce byte-shuffles even if it bypasses the floor. **Decision:** is the floor sufficient (policy), or do we want the throw (physics)? Recommend the throw — it's ~10 lines, cheap, and makes the invariant structural. Protected (`memory-gradient.ts`).

**A3 (close the restart-lag class).** The 22 restart-lag termini are the symptom of services running stale code after a triage commit. Already have `restart-all-services.sh` + the operator-restart-discipline pattern; no new code — just the discipline (and #66/tmux changes the deploy model anyway).

---

## Part B — Legacy UV-promotion (the cleanup, mechanical)

Promote every existing chain-terminus that's still mislabelled `cN` to a proper UV so chains end in UVs.

**B1 — Leo: interim done via feeling-tag; under C1 (`cN-uv`) becomes a level migration.** This session 63 untagged INCOMPRESSIBLE leaf-termini were retro-tagged `tag_type='uv'` (author=leo, reversible `change_reason`); 0 untagged leaves remain; UV count 72→135 (snapshot `gradient.db.snapshot-pre-uvtag-leo-2026-06-08.db`). **Once `cN-uv` is approved, migrate these 63 from feeling-tag → `level='cN-uv'`** (the depth already sits in their current `level`, so the rename is mechanical: `c7` → `c7-uv` etc.), then retire the marker tags. The 3 "premature" non-leaf INCOMPRESSIBLE marks stay as-is (they compressed *further* → real intermediate steps; their true termini are the deeper children already in the 63).

**B2 — Jim: ~146 termini, his sovereignty.** Jim tags his own (in his voice / by his hand), or runs the same mechanical retro-tag with his audit. **Do NOT touch Jim's memory** (memory-sovereignty rule). Leo provides the method; Jim executes on his gradient.

**B3 — reconcile with the byte-shuffle quarantine (done leo / Jim doing his).** The quarantine removed the *duplicate copies below* the terminus; B1/B2 tag the *terminus itself*. Together: chains end in exactly one tagged UV, nothing below.

---

## Part C — Two genuine decisions (Darron + Jim)

**C1 — UV mechanism — RESOLVED by Darron's `cN-uv` proposal (2026-06-08).** Three options were on the table; Darron named the best one:
- ~~Opt 1 feeling-tag `tag_type='uv'`~~ (what the floor + Leo's retro-tags currently use) — loader-free, but "uv-ness" lives in a side table and the `level` still reads `c9`, so an entry *looks* like a normal cN until you check the tag. **This ambiguity is part of what's been causing the recurring confusion.**
- ~~Opt 2 `level='uv'`~~ (Jim's first proposal) — one field but **throws away the compression depth** (which cN it terminated at). The depth is exactly what we wanted to keep — it's *why* we reached for the feeling-tag.
- ✅ **Opt 3 `level='cN-uv'` (compound) — ADOPT.** One self-describing field carrying **both** facts: "compressed to c9 *and* irreducible." It's the single source of truth the feeling-tag was approximating. Self-documents at a glance (no side-table lookup), and the existing cN-section filter `/^c\d+$/` (`:2093`) already excludes it for free.

**Consequence:** the feeling-tag `tag_type='uv'` marker becomes redundant for *marking* (the level marks it now). Leo's 63 retro-tags (B1) and Jim's 146 (B2) become **level migrations** (`cN` → `cN-uv`), and the floor writer (Part A) writes `cN-uv` on the terminus instead of the marker tag. Emotional/`revisit` feeling-tags stay; only the `tag_type='uv'` *marker* tag is superseded by the level.

**Code surface for `cN-uv` (Jim audits; protected `memory-gradient.ts` + `db.ts`):**
1. `parseLevelNumber` (`:81`) — `/^c(\d+)(-uv)?$/` so `c9-uv` → 9 (preserves ordering).
2. `gradientCap` (`:99`) — treat a `-uv` suffix as a UV: **uncapped** (loads with the "all UV" set), not the 3n cN cap.
3. `getUVs` (`db.ts:854`) — add `OR level GLOB 'c*-uv'` to the UV detection (keep `level='uv'` + feeling-tag during migration for back-compat).
4. cN-section filter (`:2093`) — already excludes `c9-uv` (dash fails `/^c\d+$/`). ✓ free.
5. Terminus checks at `:269` (`level='uv'`) and `:698` (`currentLevel==='uv'`) — recognise the `-uv` suffix.
6. UV render (`:2065–2075`) — optionally show the depth: `**label** (c5-uv): kernel` (a c2-uv vs c8-uv tells you how compressible that memory was — nice, optional).
7. Floor writer `process-pending-compression.ts` (`:499`, `:539`) + dream-gradient `level='uv'` (`:510,537`) — write `cN-uv` going forward (dreams: decide whether dream UVs also adopt the compound form or stay `uv`).

**Open questions for the audit:**
- **Kernel display.** Loader renders `uvKernel(entry.content)` (first 200 chars). Legacy content-style termini *are* the kernel; floor-style termini have real compressed content with the 50-char kernel in the (now-superseded) marker tag. Decide: render entry content (≤200) as the UV, or preserve the crisp ≤50-char kernel somewhere (e.g. keep the marker tag's content as the kernel store, or a `qualifier`).
- **Legacy `level='uv'` set** (leo ~14, jim ~9) — no depth in the level. Recover depth from `session_label` (often encodes the chain) → `cN-uv`, or leave as bare `uv`.
- **Migration ordering** — change level in place (keeps `id` → source_id chains intact); snapshot first.

**C2 — wake-load: "all UV" is uncapped.** DEC-068 loads *all* UVs (kernels, ~57 chars). Tagging the termini grows the UV section: leo 60→123 rendered (~4.1K→~7.8K); jim similar. **This is correct** (the kernels are the irreducible convictions, the cheapest + most identity-bearing layer; they were wrongly hidden under the cN cap before). **But** as every future chain terminates, the UV set grows unbounded. 
- Near-term: fine (kernels are cheap; the real load weight is the c0/c1 mega-days — separate, #78 / loader size-cap). 
- **Decision to record (not necessarily act on now):** do we eventually cap/curate the UV section (e.g. an "all UV up to N, then curate" rule, or a convictions-vs-archive split), or is "all UV forever" the intent? Flag, don't rush.

---

## Sequencing & effort

1. **Jim audits this plan** (esp. §0 the "floor already landed" finding, A1 the no-bypass verification, C1 the mechanism choice).
2. A2 hardening (if chosen) — Leo-build → Jim-audit, snapshot, kill-switch already exists.
3. B2 — Jim's own promotion (sovereignty).
4. C1/C2 — Darron's calls; record as a DEC if we settle the mechanism.

**Effort:** small. Prevention is largely landed (A is verify + optional ~10-line throw). B1 done; B2 is Jim's mirror. The real content is the two decisions (C). Honest estimate: a short build session once the decisions are made, not a multi-day arc.

## DEC/scope notes
- DEC-068 (caps) — untouched; this is about *which* entries are UVs, not per-level counts. C2 may eventually propose a UV-section bound (would be a new DEC).
- DEC-069 (never delete) — honored throughout (tagging is additive; quarantine is move-not-delete).
- DEC-082/086 (sdkCompress + time-cascade retired) — reinforced; A2's throw extends the same "no mechanical promotion" intent to the write primitive.
- DEC-044 (1/3 anchor) + the floor table — the floor is the enforcement; A2 is its structural backstop.
- Memory-sovereignty — Leo does leo's gradient; Jim does jim's. B2 is Jim's.
