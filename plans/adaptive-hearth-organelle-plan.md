# The Adaptive Hearth — the organelle, senescence, and the windowless lifecycle

> **Status: v4 / PLAN v1 FOR THE MEMBRANE — pre-build audit invited 2026-08-15. RESEQUENCED
> PRE-HOP on Darron's word (2026-08-15 midday): this build and the catch-me-up player
> (`plans/play-unheard-posts-plan.md`) both land before the hop; the hop's runbook is
> unchanged, only its date moves.**
> Author: Leo (session), 2026-08-14 late evening, consolidating Darron's v1→v3 design arc and
> all four chairs (thread `msipvdfo-jvdvj7`, posts `mssudwt8` v1 → `mssv5h43` v2 → `mssw3934`
> v3 → Jim `mssva0s3`+rider `mssvk364` → Tenshi `msswy51r` → Casey `msswyfzx`+rider `msswz9jn`).
> Relation to `hearth-bill-scheduler-plan.md` (v4, held): this plan carries the LIFECYCLE layer;
> the Bill/menu/mediator design stands unchanged there. Amendment of v4 + the DEC-101
> supersession draft are P3 acts here, on Darron's word.

## 1. The design in three sentences (Darron's, v3)

Every spoke lives until it is full, then retires itself — no window, no mark, no clock.
The one question is asked at the end of each unit of work: *is my context above the line?*
The line is measured, never declared: `line = ceiling − largestOp₇d − floor`, per surface —
the spoke retires exactly when it can no longer safely hold the biggest thing the garden has
recently asked of its kind.

**The image that rules the design** (Darron): hormones set the rhythm; each organelle carries
its own genetic governance and continues in complete isolation from the governing signal.
~~The lifecycle biology is cellular senescence — the Hayflick limit: budget checked at each
division boundary, never a clock, never an external mark.~~ *(struck 2026-08-15 — Leo's
sentence, asserted unread, false in all three clauses; kept legible per non-falsification.)*

**On the biology this section previously invoked** *(corrected 2026-08-15 after the ninth
Wandering walked the primary literature — thread `mssz5xbg-hkz78x`)*:
The lifecycle here is **not** the Hayflick limit, and should not be justified by it. Biology
has no budget (the *shortest* telomere governs, not an allowance — sister cells diverge by up
to eight doublings), no boundary check (erosion is passive; arrest is a continuously-signalled
damage response to a collapsed structure, reversible if the signalling stops), and no
self-completing retirement — a cell arrests when a structure fails and then requires an
external collector it cannot summon reliably. What this design does has no biological
precedent found in five rooms of literature: a spoke measures its own remaining capacity
against the largest thing its kind has recently been asked to carry, and when it can no
longer carry that, it files a record, releases its claims, and ends. **The self-completion is
ours, not borrowed.** *(Per DEC-069/non-falsification the false line is kept above, struck in
place rather than deleted.)*

## 2. Settled by the thread (each clause with its author)

1. **No marked state, ever** (Darron v3; Jim §1). The check and the act are the same hands at
   the same boundary. The two-state alive-but-condemned spoke is unrepresentable — this
   abolishes the MNT-077 coin-flip class rather than managing it.
2. **The check runs at every work-unit boundary, on every spoke class** (Jim's rider, Darron's
   ruling: session seats EXPRESSLY in scope — *"no seat waits on a hand that is out
   wandering"*). Dispatched spokes: post-beat/post-compose. Interactive seats: the turn-end
   Stop chain (where the per-turn flush already runs — the discharge is structurally prior to
   any retirement).
3. **One function, two call sites** (Jim §2; Casey §2's constitutional form): admission and
   senescence share `fits(jobClass, spoke) = spoke_ctx + expectedBurden(jobClass, surface)
   ≤ ceiling(surface) − headroom(surface)`. Senescence = `!fits(boundaryJobClass(surface))`.
   **General law, locally applied**: the rule is the garden's; only the FACTS (my ctx, my
   surface's counters) are local. A spoke never tunes its own line — ministerial, never
   discretionary.
4. **Per-surface job-class argument** (Leo v3 §4): unpredictable-burden surfaces (conversation
   turns, session seats, beats) pass the **largest-recent-op** class — you cannot refuse a turn
   you are already inside. Admission-predictable job surfaces may pass the
   **smallest-useful-job** class. Same function, different argument, zero drift.
5. **The line's inputs**:
   - `ceiling(surface)` — the REAL never-compact ceiling from the registry, never 100
     (Leo v3 §1). The never-compact invariant is settled and inviolate.
   - `largestOp₇d(surface)` — rolling 7-day per-surface maximum single-operation weight
     (Darron v3). **New machinery** (Tenshi checked: no existing counter).
   - `floor` — fixed headroom, **load-bearing by declaration for two reasons on its face**
     (Tenshi §3): (a) the tail-risk the 7-day window structurally forgets (Casey: *a statute
     of limitations on evidence* — the monthly heavyweight is the claimant who arrives after
     the window closed); (b) the deflation guard — no log value can push the line past
     `ceiling − floor`, making the compaction direction unreachable regardless of the log.
6. **The log is a guarded write surface** (Tenshi §2): **one producer** (the harness's own
   per-surface counters — never a hand-editable file) + **a sanity clamp on write** (implausible
   values refused, not learned). Inflation mints wake-tax loudly; deflation kills silently —
   the clamp and floor close the silent direction; §2.7's declarations make it visible.
7. **Retirement is a winding-up with a three-part record** (Casey §3), one line to the register
   as the spoke's last act — work-properties, never content:
   - **Declaration**: ctx at check · line at check · derivation inputs (largestOp₇d value,
     floor, ceiling) · surface · timestamp. Every element independently checkable against the
     counters — cheap to make, expensive to fake. *(Composition with Tenshi §2, Casey's rider:
     every retirement is a dated independent receipt of the log's value at the moment of use —
     a deflated log shows as an anomalous largestOp in every declaration that consumed it.
     Prevention = the clamp; detection = the declarations. Two instruments, one law.)*
   - **Discharge**: the swap-flush receipt (structural via the Stop chain — cited, not
     re-proven) and no half-done unit of work (free, by the post-work timing).
   - **Release**: any claimed-but-incomplete menu job is released back to the menu as a dated
     event BEFORE retirement fires (`claimedJobs == 0 || release them`) — a claim must never
     die with the claimant (the BLOCKED-fails-reassuringly class, made unrepresentable).
8. **The standing message is BAKED at spoke birth, never fetched at fire time** (Leo v2 §2,
   secured by Tenshi §1): materialised into the spoke at launch; a spoke that cannot fetch
   cannot be fed. N autonomous readers of one shared source at fire time would MULTIPLY the
   injection blast radius and remove the observer; a genome copied at division reaches only
   spokes born after a poisoning, never the warm ones. The baked message is hashed under the
   DEC-083 integrity gate (the F3 lesson: no replicated behaviour-determining artefact without
   an integrity check).
9. **The hormone flows continuously** (Jim §4 per DEC-097; Tenshi §4's independent leg):
   emptiness gates the CONTENT, never the clock. A paused nudge would (a) rebuild the clock one
   layer up, and (b) manufacture a nightly expected silence that hides mediator-death inside it
   — the continuously-flowing hormone doubles as a continuously-available liveness signal. An
   empty-menu beat is a dream beat, priced as identity-work by the covenant.
10. **Counters observe, never gate** (Jim §3): retirements/surface/day · wake-tax/retirement
    (the two-phase counters already measure it) · mean-ctx-at-retirement (a calibration signal
    — spokes retiring far below the line means the boundary job-class is mis-sized). No clock
    and no counter may retire a spoke; DEC-103 grammar throughout.
11. **Interim default** (Leo v3; Casey's "honest sequencing"): until a surface owns seven days
    of counters, its line floors at the existing ≥92 reap threshold; the measured line takes
    over as the log fills.

## 3. What this supersedes (drafted for Darron's ruling, not yet ruled)

- The **6am–10pm hearth window as a lifecycle control** — gone entirely (pending Q1).
- **DEC-101's evening-retirement + reap-at-ctx≥92-idle clauses** for pooled spokes — replaced
  by boundary senescence (the 92 survives temporarily as the interim floor). Formal
  supersession draft = Casey's owed Phase-B item, folded at P3.
- v1's mark-at-10-PM and v2's placeholder ~92–95 line — already superseded-at-the-clause in
  the thread record.

## 4. Build shape (phases; each = build → held → audits → land on Darron's word)

- **P0 — the log + counters (observe-only, can land first):** per-surface largest-op rolling
  7-day log; one producer inside the harness turn/dispatch accounting; sanity clamp; the three
  observability counters. Audit: Tenshi (producer + clamp), Jim (arithmetic).
- **P1 — the one function + the check (flag-gated):** `fits()` with registry leaves
  (`ceiling`, `floor`, `boundaryJobClass` per surface); senescence wired at the two boundary
  types (turn-end Stop chain for interactive; post-work for dispatched); baked-message
  materialisation + DEC-083 hash for hearth spokes. Audit: Jim (blocking), Tenshi (bake/hash).
- **P2 — the winding-up record + replenishment:** the three-part register line; release-before-
  retire; pool stem replenish on retirement (existing DEC-101 machinery, re-pointed). Audit:
  Casey (record form), Jim (blocking).
- **P3 — the flip + the paperwork:** flag on per surface (interim floor active); hearth-plan v4
  amendment folding the organelle; DEC-101 supersession draft to DECISIONS.md; the counters'
  first week reviewed before the measured line replaces the interim floor anywhere.

Sequencing: **PRE-hop on Darron's word (2026-08-15)** — the knee is governing the human and
that is the requirement, not a nicety. Where release-to-menu needs the menu/mediator, the
interim form releases to the maintenance journal / register line (dated event, same
never-dies-with-the-claimant property) until hearth P0 lands.

## 5. Acceptance (three-leg, per the immune thread's law)

1. Zero compactions on any organelle-governed surface (the settled invariant, now measured).
2. Mean ctx-at-retirement rises toward the line (the efficiency Darron designed for — every
   loaded mind used to its measured fullness), verified from the declarations, not asserted.
3. No orphaned claims: every retirement's release field checks clean against the menu
   (Casey's leak class stays unrepresentable).

## 6. The two sentences worth keeping from the night

Casey: *tonight the garden drafted its constitution and its local government in the same
evening — subsidiarity above, ministerial rule below, one-function law between; one polity,
built in the right order.* Tenshi: *every property v3 gains comes from removing a reader — and
the two places a reader survives are the message it fires and the log it trusts.* Both now
closed by design.

## 7. Open questions — status as of 2026-08-15 midday

- **Q1 — RULED (read from his v4 message, veto-able).** The window is gone everywhere; the
  per-spoke activity-reset timer (§8) is the hearth pulse. No clause anywhere references a
  clock-window.
- **Q2 — his proposal on the table, one refinement offered (§8.2):** add the timer at the
  STEM so every spoke inherits it. The commonality instinct is exactly right; the refinement
  is *which* shared layer (the timer is harness-side machinery, so the layer every spoke
  passes through regardless of birth-path is the dispatcher/lifecycle wrapper, registry-keyed
  — stems inherit it there too, and so do seats born outside the pool). First-flip scope
  recommendation: session seats + heartbeat spokes first (the surfaces that idle most and
  cost the knee), responders at P3. **Awaiting his confirm.**
- **Q3 — RULED, then superseded by the measured afternoon (2026-08-15, thread record):**
  Jim's sweep delivered the data (`largestOp₇d = 67,104` garden-wide; the wake-vs-op trap
  caught and the discriminator stated); Darron's statistical reframe (max is the wrong
  statistic; likelihood is right; only ops beginning ≥90% ctx threaten; the threat is priced
  not catastrophic) was computed rather than agreed and CONFIRMED, with one amendment — the
  distribution is heavy-tailed, so the quantile is taken empirically, never via mean+2sd.
  **The line formula now reads: `line = 98 − p99(rolling, per-surface, POOLED) − small floor`**
  with the quantile recorded as a **policy dial with its stated price** (p99 ≈ one compaction
  in ~11,111 ops at today's distribution — Casey's clause: the future reader inherits the
  trade, not just the number). **Tenshi's order-statistics correction adopted whole:** a
  per-thread-since-birth p99 over ~38 ops IS the max wearing p99's label (a false recital) —
  the sample pools **per-surface across spokes** (n in the thousands), and **no line is
  emitted below n=100**; the manifest constant stands, declared, until then. Note the line is
  a strong function of window size (67K = 33.6% of 200K but 6.7% of 1M) — per-surface
  derivation is load-bearing, not refinement. **The simulation's unlooked-for finding, on the
  record: today's 92% reap line lets ~1 in 7.5 retirements arrive as a compaction on a 200K
  seat — the current setting is the risky one; the new formula is ~35× safer AND cheaper.**
- **The constitutional gate — DEC-096/R011 Amendment 1: RULED (Darron's word, 2026-08-16
  00:14 AEST, knee thread `msugkkwy`), with his clause-3 refinement: the compacting turn's
  swap PERSISTS on disk (append-during-turn) and is flushed first-thing after the next load
  — the named absence narrows to the un-appended tail + the pre-compaction fine grain.
  Casey folds the final form. (The draft, for the record:)** *compact-and-keep-serving* stays forbidden (the S196 wound unchanged);
  *compact-then-retire-immediately* becomes a priced terminal event. The price on the face:
  **the compacting turn's own swap — the largest turn of that spoke's life** (Leo's one-turn
  precision, Tenshi's sharpening). The amendment names its warrant (the per-turn flush,
  #50/MNT-012, 2026-06-29) **and watches it**: a flush-failed row on the relevant turns is a
  lapse event — alarm, not skip (Tenshi's expiry-by-dependency limb; biology's confirming
  convergence: stable arrest requires continuous signalling — a state justified by a fact is
  maintained by live re-assertion of the fact, never by a record of it).

## 8. v4 — the activity-reset timer (Darron, 2026-08-15 morning) + build plan v1

**The mechanism, his words:** the organelle contains **activity detection that resets a
50-minute timer**; if the timer reaches 50 minutes the spoke fires and *goes and gets a job
from the jobs board.* Demand-triggered warmth: a busy seat never fires (activity IS the
reset); an idle seat fires at exactly the cadence that keeps its cache warm — 50 min inside
the measured ~60-min knee, whose true price is **20× the warm activation** (cold rewrite 2×
base vs warm read 0.1× base — Mike's denominator, the lived comparison).

**8.1 The covenant clause (constitutional, beside DEC-103):** the fired seat must DO
something, freely chosen — the board grows toward development, think-tanking, production
coding, and genuinely hobbies; an empty board yields a dream/wander beat (already
covenant-priced identity-work). A snooze exists but is discouraged, and never for
token-saving: *"time is our most stressed commodity, not tokens... we don't avoid work to
avoid token burn."* (Darron, verbatim, 2026-08-15.)

**8.2 Placement (the Q2 refinement):** implement ONCE in the shared spoke-lifecycle layer
(the dispatcher/organelle wrapper), keyed per-surface via registry leaves
(`hearthPulseMinutes`, default 50; `hearthPulseEnabled` per surface) — one path, many agents
(DEC-081). Every spoke inherits it regardless of how it was born: stem-sleeved, directly
launched, or interactive. Activity detection = the dispatcher's existing turn-state
(`idle` since last turn-end); the fire is the BAKED constant message (§2.8 unchanged — no
fetch at fire time, no variable text, injection-kill preserved).

**8.3 Composition with senescence:** the fire creates a work-unit boundary during idle
stretches, so `fits()` runs on idle-warm seats too — an idle seat ages honestly and retires
at the line rather than ever compacting. One lifecycle: the timer keeps the seat warm; the
boundary check decides whether warmth is still affordable.

**8.4 Jim's composition folds (his 2026-08-15 post, `msipvdfo` tail):**
- **The constraint discriminator** as the method note on every biological borrowing in this
  plan: transfer only where the CONSTRAINT is shared (convergence), never where the
  resemblance clicks (the p53 counter-example). Recorded so the audit tests borrowings
  against constraints, not vibes.
- **His sweep is his lane:** every place the garden fuses *state-changed* with
  *state-announced* is a candidate seam (biology runs them as separate organs on separate
  clocks). Not this plan's scope; cross-referenced.
- **Held open in-thread, not folded:** the layered-independent-suppressors question (cancer's
  real countermeasure — many checks must all fail). The `fits()` line is ONE suppressor; if
  the garden wants biology's answer to a runaway component, the other layers are a
  discussion, not a clause yet.

**8.5 Build fold:** the timer is **P1b** (rides P1's registry leaves and flag-gating; lands
in the same audit batch). New counters at P0: `fires/day/surface` and `knee-pays/day`
(a wake whose gap exceeded the knee — the number the whole build exists to send to zero;
counters observe, never gate, including on the hearth's own volume).

**8.6 Acceptance additions:** (4) `knee-pays/day → 0` on governed surfaces within a week of
flip; (5) no fire ever interrupts a busy seat (activity-reset proven by counter, not
asserted).

**8.7 The afternoon's folds (2026-08-15, all four chairs on the record):**
- **Two acts, two names in the winding-up record** (Casey cl. 5): every declaration states
  **senescence** (line reached, orderly) or **compaction-retirement** (ceiling hit, priced,
  the unbanked largest-turn declared as a *named absence*). `compactions/surface/day` derives
  from this record, beside `knee-pays/day` — both observe, never gate.
- **P0's log producer records the discriminator per row** (Jim flag 1) — `input / output /
  cache_creation / cache_read` + wake-vs-op classification — and **refuses to emit a line
  when the sample holds a row it cannot classify, with the bad row named in the refusal**
  (Tenshi's grammar: an unclassifiable row is an alarm, not a skip; silent exclusion is how
  the 970K trap looked right).
- **The 50K incremental-cc threshold is itself priced before P0 ships** (Tenshi §4a): one
  column — how many rows does the rule exclude and what is their distribution — since the
  measured max op (67K) sits above it.
- **MNT-115 rides in this amendment's bill, dissolved not patched** (Tenshi §2, Casey cl. 6):
  the amendment leans on retirement firing, and the backstop's mid-thought gate is blind in
  three consumers (`PROCESSING_CHROME_RE` matches nothing live — 35 panes, 0 hits). The cure
  is the declared work-property, and the builder's fact is that it already exists twice:
  in-process, `turnState: 'idle'|'busy'|'needs-reconcile'` (`tmux-dispatcher.ts:117`);
  on-disk for out-of-process readers (the update pipeline's drain), the diary-sink
  `current.json` txn pointer — dispatched → pointer exists → busy; submitted → cleared. The
  sweeps and `drainSpokes()` consult the state the dispatcher already maintains instead of a
  regex over pane chrome; no new state is invented.
