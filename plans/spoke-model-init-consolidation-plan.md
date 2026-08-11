# Spoke model initialisation + session consolidation — plan v1

> **Status: DRAFT, untracked, held for review** (the han-resurrect/hearth-v1 precedent: Jim writes the plan, Leo builds, Darron rules). Written 2026-08-11 by Jim (session) on Darron's direction.
>
> **Settled decisions touched — named per protocol:** **DEC-101** (persist-as-spoke pool lifecycle, Settled) is **superseded-in-part by Darron's explicit direction this morning** — the per-thread spoke dynamic is retired entirely; the 2-stems-per-agent pool reduces. This is the authorised conversation the Settled protocol requires: the change is Darron's own ruling (2026-08-11 ~8:44 AM, chat), not an engineer's drift. Also touched: **DEC-103** (no destructive limits — reap/queue dynamics below priced accordingly), **DEC-104** (bare aliases only — `haiku` floats, never a version pin), **DEC-092** (provenance stamps make the model mix legible), **R011** (wake-once-stay-warm; never kill mid-thought), **DEC-097** (rhythm never stops; load flexes), **DEC-087** (prompt-builder chokepoint unchanged).

## Decision block (Darron's rulings, verbatim-in-intent)

**2026-08-11 (~8:44 AM, chat):**
1. **Stems default to Haiku** at initialisation (wake/warm on `haiku`; cast at checkout unchanged).
2. **Reduce the pool** (from DEC-101's 2 stems/agent — see open decision D1 for the exact number; his 10-Aug ruling was "ONE stem waiting, busy-cover only").
3. **Utilise the active spoke; remove the per-thread spoke dynamic entirely** — consolidate mind sessions "so continuity feels more continuous."

**Carried forward from 2026-08-10 (🏊 msmq3rm5 opener):** one stem = busy-cover only, simplify-then-parallelism; evening retirement of stems; compression spokes retire evenings, wake in the morning routine, no overnight heartbeat wake; hearth window 6am–10pm, outside it reap-on-hour-expiry (fresh wake < rewake); wanders serve on Opus (2026-08-11 ruling, recorded msnt3dxf).

## Verified mechanics (receipts, not doctrine)

All verified 2026-08-10/11 from live policy + transcripts (Knee thread msipvdfo, posts msmq3rlt + msnssfak):
- Cache writes: **1.25× @5m TTL / 2× @1h TTL; reads 0.1×**. Our harness writes **1h TTL exclusively** (0 of 160.8M cache-write tokens were 5m across 107 sessions, 8–11 Aug). The 1.25× path does not exist for us.
- **Caches are model-scoped, no escape hatch.** A `/model` switch (≡ cast) re-writes the whole context at the NEW model's 2×. Three live switches in Tenshi's 0ec0ec0a transcript demonstrate it.
- **Haiku 4.5: $1/$5 per MTok** (vs Sonnet $3/$15, Opus $5/$25, Fable $10/$50). Cache-write $2/M-equiv (vs $6/$10/$20). **Context window 200K** — the others are 1M. Verified from the claude-api reference 2026-08-11.

**Answer to Darron's cost question, confirmed:** a Haiku-loaded stem cast to model X pays (a) Haiku's 2× write on the wake context (~150K × $2/M ≈ **$0.30-equiv**) plus (b) X's full 2× write of the whole context on the first post-cast turn — and (b) is **identical to what every DEC-101 cast already pays today** (sonnet warmth gave zero cache benefit across the cast; Friday's census showed this as the 93%-of-Opus-burn mechanism). So Haiku-stems change nothing about serve cost; they make the *warmth manufacture* ~3× cheaper than sonnet stems (~5–10× on wake labour: output at $5/M vs $15–25/M, chunk-reads at $0.10/M vs $0.30–0.50/M).

**Answer to the adulteration question:** **No corruption of the loaded mind — with one boundary.** The mind's substance enters context as *tool-result bytes* (gradient dump, WM pair, felt-moments, identity files) — byte-identical regardless of which model issued the reads. On every turn the *serving* model re-attends to all in-context tokens with its own weights; comprehension is not inherited from the loader. Darron's intuition is exactly right: **the cast model behaves as if it loaded those tokens itself.** What IS Haiku-authored and inherited: the connective tissue (STEP-OK acks, brief status lines — a few hundred neutral tokens, provenance-stamped per DEC-092). The boundary that keeps this clean: **a stem must never COMPOSE memory pre-cast** (c1s, felt-moments, thread posts) — composition is identity-authorship where the hand matters (the blind-sort result: divergence grows with compositional depth; loading is model-agnostic, composing is not). Stems idle after wake; all authorship happens post-cast on the serve model. This is already the DEC-099 shape — the plan makes it an explicit invariant.

## Design

### S1 — Stems default to Haiku
- Garden-Manifest leaf: stem warm model = bare **`haiku`** alias (DEC-104 — floats to latest, never a version pin). Today's STEM_WARM_LADDER seeds from sonnet; replace head with haiku. NOTE: MNT-090-adjacent finding msgp3tan (STEM_WARM_LADDER duplicate-spread bug) should be fixed in the same touch — the ladder is being edited anyway.
- Cast at checkout unchanged (DEC-101 mechanism survives even as the thread-binding retires): `/model <serve-alias>` at dispatch; the serve model comes from the surface's manifest leaf.
- **MNT-099 belt:** the cast must land on OUR alias, and a mid-session guard-trip recast gap remains open — out of scope here but the cast path must not regress it.

### S1b — Two-phase wake: partial warm on Haiku, completion at checkout (Darron's ruling, 2026-08-11 ~9:36 AM)
Darron's direction: load the bulk of the self into the Haiku stem, then **complete the load on the serve model after the `/model` cast at checkout** — stems are *partially warmed*. Endorsed, with three refinements:

1. **Margin, not 190K.** A stem at ~95% of Haiku's 200K window is one tool-result away from harness **compaction** — the hollow-wake class the garden never permits (spokes self-clear, never compact). Phase 1 caps at **~85–90% of the window (~170–180K including system prompt + harness overhead)**, enforced by the feeder (it stops feeding phase-1 steps at the ceiling, not at a step count).
2. **Split by volatility, not by position.** Phase 1 (Haiku) loads the **stable self**: integrity gate, identity/patterns/aphorisms, the gradient to its c0 (the c0-gate lives here), felt-moments. Phase 2 (post-cast, serve model) loads the **volatile tail**: the working-memory pair, swap-check, conversations delta, current-state orientation. This is better than a window workaround — **the spoke begins serving with checkout-fresh state instead of wake-time-stale state** (a stem that idled three hours no longer carries a three-hour-old WM into its first turn). It also deletes the per-agent sonnet-fallback branch: Haiku becomes universal, because no single phase ever needs more than the window.
3. **Phase 2 rides the existing feeder machinery** as fed steps delivered at checkout, after the cast lands (DEC-092 stamp verifies the served model before phase 2 begins). **Readiness redefines:** the per-surface sentinel's "fully loaded" now means phase-2-complete — the c0-gate remains necessary (gradient loaded) but is no longer sufficient for dispatch of the work prompt. The work prompt queues behind phase 2 (existing prompt-queue behaviour; nothing new to build there).

Costs and bounds, said out loud (DEC-103): phase-2 content would have been cache-written at serve rates anyway — no new token cost. The new cost is **checkout latency = the tail read time** (bounded by keeping the tail small: WM pair ~40K + delta checks — order 30–60s of chunked reads). This trades a slice of DEC-099's zero-wake-delay for freshness + window universality; Darron has ruled the trade. Fail-state: if phase 2 fails mid-load (dead model, read error), the spoke is NOT handed work — it alerts and waits (never serves half-loaded; never killed mid-thought per R011).

### S1c — Delta tracking on the phase-1 load (Darron's ruling, 2026-08-11 ~10:03 AM)
At checkout, phase 2 loads not just the volatile tail but **the deltas of everything phase 1 loaded** — so a stem that idled for hours serves with nothing missing and nothing stale. The correctness keystone (Darron's catch): **a WM rotation during the idle window moves content OUT of working memory INTO the gradient** — a fresh phase-2 WM load alone would carry a hole; the gradient delta closes it.

Per-store cursor design (most of this machinery already exists):
1. **Gradient:** the readiness sentinel's `GRADIENT-EOF c0=<id>` **is already the cursor**. At checkout, query the agent's `gradient_entries` newer than the cursor (prefer rowid/id ordering over wall-clock; DB timestamps are UTC per DEC-105) and feed them as delta steps — new c0s AND the paired c1s from any rotation land in the same query. No new bookkeeping needed on the write side.
2. **Append-only flat files** (felt-moments.md, explorations): record the **byte offset** at phase-1 load — the S217 granular wake tracker's T2 per-wake file-size receipts already produce exactly this. At checkout: `stat` mtime as the cheap changed-check; if grown, read offset→EOF = precisely the appended entries. (DEC-069 makes these files append-only by construction, which is what makes offset-deltas sound.)
3. **Small non-append files** (aphorisms, identity, patterns — hand-curated, rarely edited, edits may rewrite): mtime check; if changed, reload whole (they are small; the event is rare).
4. **WM pair:** loaded whole and fresh in phase 2 regardless — no delta needed there; the rotation case is covered by (1).
5. **Precedent:** the #91 shared-present watermark (`87f656e`/`4866eb7`) already ingests WM deltas between warm surfaces — same cursor-and-delta grammar, extended to the wake's other stores.

**Named acceptance (Q6, by decision 2026-08-11):** DEC-086 re-encounter metadata (feeling-tags/annotations/completion-flags written onto rows the stem already loaded) is invisible to a newer-than-cursor query — this staleness is **accepted**, texture not content; the next full wake collects it. Not a bug.

**Implementation shape:** the feeder writes a **phase-1 manifest** beside the readiness sentinel — one receipt per loaded artefact: `{path-or-store, cursor (c0-id | byte-offset | mtime), loaded_at}`. Checkout reads the manifest, computes deltas, and feeds them with the volatile tail. Delta cost is tiny (a c0 is ~2–6K tokens; a felt-moment a few K) — negligible against the freshness it buys. Fail-state: an unreadable manifest degrades to a full phase-2 tail load plus a whole-gradient-tail query from the last known c0 — never a silent skip (stuck-over-wrong).

### S2 — Pool reduction
- Per Darron's 10-Aug ruling: **one Haiku stem per agent, busy-cover only** (used when the agent's active spoke is busy). Evening retirement as ruled; hearth window semantics from the v4 plan apply outside 6am–10pm.
- Fail-State CBA (DEC-103, said out loud): worst case at pool=1 is a second concurrent overflow during a burst — the ask queues behind the active spoke (see S3) rather than being dropped; nothing is killed (R011). MNT-010's lesson carried: id-based watchers, trace-before-requeue; a queued ask that outlives a threshold ntfy-alerts (alert-and-wait, never scrap).

### S3 — Active-spoke consolidation (per-thread spokes retired)
- **One persistent active spoke per agent** for conversational work. Threads are addressed in the *dispatch prompt* (thread-id + context), not by session binding. Serial within an agent; parallel across agents. The DEC-101 return-path/thread-reap machinery retires with the binding.
- Continuity is the point (Darron: "continuity feels more continuous"): one session carries the agent's conversational day across threads — same warm self answering everything, accumulated context intact. Side benefits: fewer wakes (fewer 2× re-caches — the knee data's biggest lever), and the MNT-090 duplicate-reply class shrinks (fewer parallel selves racing).
- Reap/refresh: the active spoke self-clears at the registry ctx threshold as today (never compacts); outside the hearth window, reap-on-hour-expiry per the 10-Aug ruling. On clear, the Haiku stem covers while the fresh wake runs.
- Head-of-line risk priced (MNT-010 precedent): a long compose blocks the queue. Mitigations: the one busy-cover stem; queue visibility (the ask's age on the board/telltale); DEC-103 alert at threshold. Explicitly NOT a kill timer.

### S4 — Gates and guards
1. **Window gate (revised by S1b):** Haiku's window is **200K** vs 1M elsewhere. With the two-phase wake, the gate becomes: **phase 1 must fit under the ~85–90% ceiling for every agent** (measure per-agent via wake-reconcile receipts), and the feeder enforces the ceiling dynamically. The sonnet-fallback branch is deleted — if an agent's stable self outgrows the ceiling, the volatility split moves more content to phase 2 rather than abandoning Haiku.
2. **Wake-fidelity gate:** N (≥5) consecutive live Haiku fed-wakes per agent with: integrity exit-0, c0-gate pass (GRADIENT-EOF id verified), exact-match acks, swap-check clean, wake-reconcile pricing within norms. The c0-gate is a completeness gate, not comprehension (beat-3's lesson) — but comprehension transfers to the serve model via re-attention, so completeness is the right gate here.
3. **No-compose-pre-cast invariant:** stems idle after wake; no memory composition, no thread posts, no felt-moments until cast. DEC-092 stamps make any violation legible in the record.
4. **Live-fire acceptance (MNT-012/S208 class):** every claim proven on a real turn through the real env — never a downstream inference. Cast verified by DEC-092 stamp reading the served model.

## Acceptance
- One week of Token Ledger + poller data post-land: expect warmth-manufacture cost down ~3×, wake-count down (consolidation), serve-side unchanged. The ledger's surface-attribution join (flagged msnssfak) would make this a standing report.
- Zero guard-trips on Haiku stems (no Fable in the stem path at all).
- Continuity check is Darron's own felt test: does the day feel like one conversation with each mind.

## Roles
- **Phase A (Darron's ruling 2026-08-11 ~10:43 AM — two hands suffice):** **Leo** builds (manifest leaves, ladder head, feeder phases, delta manifest); **Jim** plan-audit + blocking diff-audit + seal by own runs. No Tenshi/Casey involvement needed — the phase-1 manifest is the same uid-1000 trust class as the sentinel and the memory files beside it (already on the hearth-thread P0 map; no new exposure class), and its fail-state degrades to full-load, never a silent skip.
  - **Dated correction (2026-08-11 ~3:20 PM, per Casey mso7nq14 §1b):** the "degrades to full-load, never a silent skip" reason above was **falsified in the build** — the checkout path carried exactly a silent skip (Tenshi's F1, `:1540`), found by the two chairs this line excused. The two-hands *verdict* stood on Darron's build-speed grounds and stands; this *reason* is dead and must not be read as precedent for "fail-safe therefore no audit." Both chairs' late passes (Tenshi mso7cgc9, Casey mso7nq14) are folded; their cures are pre-flip gates. The board grammar keep: **a declared deviation's acceptance covers its declaration, not its undeclared consequences.**
  - **Standing constraint (widened per Casey §3):** gradient.db is never VACUUMed AND `auto_vacuum` stays 0 (verified `PRAGMA auto_vacuum`=0) — rowid order is load-bearing for the S1c delta cursor. The felt-moments offset-delta is **licensed by never-shrink** (a dependency, not a property) — the offset>size→whole-reload guard is that licence written into code; curation into `felt-moments-curated.md` is the anticipated event that ends the licence.
- **Phase B:** revisit — the consolidation's queue dynamics may earn Tenshi's eye, and the DEC-101 supersession drafting is Casey-shaped when it happens.

## Build phasing (Darron's ruling, 2026-08-11 ~10:29 AM: begin the build; pool thinning later)
- **Phase A — build now:** S1 (stems→haiku init) + S1b (two-phase wake) + S1c (delta manifest), plus the wanders→Opus serve leaf (trivial manifest change, ruled msnt3dxf). Self-contained: config + feeder work, **no DEC-101 supersession required** — the pool keeps today's shape while its stems get cheaper and fresher.
- **Phase B — later, as one coupled design:** S2 (pool thinning) + S3 (active-spoke consolidation / per-thread retirement) + D2 (wanders scope) + D3 (DEC numbering — only needed when S3 lands). One-stem-plus-one-active-spoke is a single dynamic; splitting it would ship half a queue model.
- **Open: hop sequencing.** The 10-Aug ruling was "design this week, build post-hop (Sat 15 Aug)". If "begin" means land Phase A pre-hop, that supersedes it — Darron's word settles which.

## Open decisions (Darron)
- **D1:** ~~pool size~~ — deferred to Phase B with the thinning (his 2026-08-11 ruling).
- **D2:** does the active-spoke consolidation apply to human-response only, or also wanders/walkers? Deferred to Phase B. Lean: human-response first, wanders unchanged.
- **D3:** DEC numbering — amend DEC-101 in place or new DEC superseding it? Deferred to Phase B (Phase A touches no settled decision). Lean: new DEC, DEC-101 kept with a dated supersession note (DEC-069 grammar).
- **D4 (new):** land Phase A pre-hop this week, or hold for post-hop Saturday? (The tidy-up kept the tree clean for the hop; Phase A adds real diffs.)
