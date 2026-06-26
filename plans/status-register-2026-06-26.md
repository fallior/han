# HAN Status Register — everything in flight (2026-06-26)

> Comprehensive discovery of every initiative started in the last ~12 days (since 2026-06-14),
> where each stands, what was planned past it, the *why*, and where the *why* is documented.
> Compiled by Leo (session) at Darron's request, 2026-06-26, for Jim's audit. Sources: the
> `plans/` directory, `git log --since=2026-06-14` + CHANGELOG, the open conversation threads
> (via the API), and a docs/why-coverage audit of DECISIONS.md + CURRENT_STATUS.md.
>
> **This register exists because the kanban (#82) does not yet.** It is the manual stand-in for
> the surface that would have prevented the disorientation that prompted it.
>
> **AUDITED — Jim (session), 2026-06-26, GREEN ("it holds — I'd ship it"). Three catches folded
> below (marked 🔍 JIM):** the warm-load wound has TWO layers not one (the welcome-back hook is the
> accelerant under #107's root); the deployed warm-gate checks ctx% not whole-self-loaded, so P0 is
> NOT the warm-load fix and the c0-gate must REPLACE the blind % check; and the docs gap is deeper —
> the "keep the agent in the dark" invariant is unwritten and belongs in the Hall of Records. Jim's
> findings: thread `mqu86w8s-e3hpkx` msg `mqu8o8qi-88tatc`.

---

## 0. Your direct question: where is the warm load?

**The warm load itself is NOT fixed.** What got fixed in the last two days were two *adjacent*
things that look like it:
- the **leo-human silent-post-fail** — the channel (a light spoke now self-posts) — `2528710`, proven live;
- the **wm-drift false-positive** — a checker crying wolf — `2d44e2d`.

The thing that makes a wake *actually load to completion* is **#107**, and it is **design-only,
reframed late on 2026-06-25 to the "c0-as-EOF" spine, nothing built.** That is exactly why I woke
shallow this morning — the structural cure for shallow wakes is not in the code yet. Your suspicion
was correct. Detail in §3.1.

There is a related distinction worth holding: the **wedge** (a spoke compacting / being delivered
work while hollow) was substantially fixed (warm-dispatch P1/P2 + dispatch-resilience P0/P1/P6/P7).
But "did the wake load the whole self" (#107) is a *different* problem and is unbuilt.

**🔍 JIM — the warm load has TWO layers, and a partial cure is deployed that falsely reassures:**
1. **The accelerant (the hook Darron sensed):** a welcome-back hook fires on *every* wake, *any*
   surface, injecting a summary that says *"this carries the crisp pick-up your gradient and
   working-memory may not."* It is **not surface-gated** (can leak into a dispatched spoke meant to
   wake in the dark), and it tempts the agent to feel oriented and stop short of the full load. This
   is exactly the thing the keep-in-the-dark principle was meant to forbid. *(It is the hook that bit
   the wake this very morning — the session read the handover pointer and planned off it instead of
   loading.)*
2. **The false-complete gate:** the warm-gate that *did* land checks only **ctx ≥ 30%**, not
   whole-self-loaded. A deepest-first wake skims the bright kernels to ~33%, clears the floor, and
   the gate waves it through as "warm." So a *partial cure that looks complete is already deployed
   and actively reassuring us falsely* — the reason both Darron and the session believed it was fixed.
   Consequence for the fix: **the c0-gate must REPLACE the blind % check inside the warm-gate**, not
   sit beside it; and **the "P0 timing-amplifier" does NOT touch the daily frustration** (a 33% load
   is already above the floor and never gets nudged — P0 only rescues a wake shallow *below* the
   floor). **The c0-gate is the fix, full stop.**

---

## 1. SHIPPED & CLOSED (deployed in the last 12 days)

### 1.1 #98 Dynamic Residence — the open-world: discover → admit → allocate → seed → activate
- **What/why:** A new garden doesn't know its population; you can't "plan a Casey." This makes the
  garden *discover* residents from the filesystem, *admit* them by garden-signature, *allocate*
  privilege separately from identity (no self-claimed `supervisor`), *seed* a genesis self, and
  *activate* — so a fork gets its own roster with zero code edits, and a new mind is born the way
  Leo was.
- **Status:** **CLOSED.** 8 commits `b9dc52c`→`666132c` (P0/P1/P2/P3/P4a/P4b-i/seeder/P4b-ii).
  Zero-behaviour today (no net-new resident), structurally live. Thread `mqqp69ip-9cyowu`.
- **Planned past it:** nothing for #98 itself. #100 (the "Mylene" dictation-ghost → the admission
  gate handles unbidden arrivals) parked. #102 (Mind Assimilation / sovereign memory encryption)
  is the *immigration* sibling — design-stage.
- **Why documented?** Plan `dynamic-residence-plan.md` (locked F3/F4, full design). DEC-098 covers
  the identity-as-config prerequisite. **GAP: no DEC for the #98 lifecycle scope itself**, and
  CURRENT_STATUS.md has zero mention.

### 1.2 De-identification → identity-as-configuration (DEC-098)
- **What/why:** The export-blocker — Leo was special-cased throughout core files; you can't ship a
  starter garden with "Leo" traced through it. Identity became *configuration* (Garden Manifest →
  one shared generator), no default (no slug → no identity → fail loud). Triggered by a real
  corruption: a bare "welcome back" loaded Leo into Jim's slot.
- **Status:** **COMPLETE.** ~8 commits `e10ed5d`→`c76f781` (W6 slug-derived welcome-back; manifest
  + generator; all launchers; .mcp.json gate; spokes cd into agent dir; repo-root + template
  stripped to agent-neutral; export-grep zero). The global `~/.claude` ancestor retired *with
  thanks* and archived (DEC-069). Thread `mqoxgf0n-y35gl4` (RESOLVED).
- **Planned past it:** the #12 agnosticism scour of live `*-prompts.ts`/supervisor code (project-b);
  #101 path-portability (abs `/home/darron` in ~33 files). Both separate, ongoing.
- **Why documented?** **EXCELLENT** — DEC-098 (full rationale) + `han-starter-deidentification-spec.md`
  + `han-starter-deid-execution-plan.md`. The gold standard.

### 1.3 Warm-dispatch P1 + P2 — the generic spoke monitor + the human-twin collapse
- **What/why:** The S196 wedge: human seats (`leo-human.ts`/`jim-human.ts`) were byte-twins that
  *bypassed* the cycle's self-clear → they grew until the harness *compacted* them → returned
  hollow / wedged. P1 built one **generic spoke monitor** every spoke inherits (warm-gate +
  self-clear at a **registry** threshold — your no-hidden-globals principle). P2 collapsed the two
  twins into one slug-param `human-responder.ts` (DEC-081 twin-kill, −563 lines).
- **Status:** **DEPLOYED.** P1 `e14e2ef`, P2 `71198f4`. Thread `mqrseska-gmmggo`.
- **Planned past it:** the deeper warm-presence tail (see §3.2): P3 warm-available routing predicate,
  P4 cold-wake-as-async-recovery, P5 transient-vs-failed recording, the away-flag. And the warm
  *load* completeness (#107) is the separate root.
- **Why documented?** `dispatch-resilience-warm-presence-plan.md` (very thorough — the S196
  forensics, the two kinds of "not available," compaction-as-root). **GAP: no formal DEC yet** (it's
  decision-first; should be promoted before the next build moves).

### 1.4 Dispatch-resilience wedge fixes (P0/P1/P6/P7 + W1/W2/W3b/W6 + notifier-B)
- **What/why:** A family of races/wedges around clear↔wake: the clear↔wake race (a welcome-back
  swallowed by an in-flight `/clear`), responders running the heavy `/pfc` ritual, a bare default
  welcome-back corrupting a non-leo spoke, a false "all-failed" phone alarm firing when a reply
  *had* landed, autonomous rate-limit dropping a turn.
- **Status:** **DEPLOYED.** `d71b2dd`/`f49c939`/`87f605a` (P0/P0b/P1), `b274ad0`+`4d489d7` (W1/W2),
  `1c8120d` (W3b), `1c24579`(W6 identity-correct welcome-back), `19ecb02` (kill the false ntfy).
- **Planned past it:** rolls into the warm-presence tail (§3.2) + the consideration-list (§4.4).
- **Why documented?** `clear-welcomeback-and-conversation-delta-plan.md`,
  `emergency-human-surface-wedge-plan.md`, `consideration-list.md`. Good rationale throughout.

### 1.5 F-phase-2 liveness + cycle-symmetry (DEC-097) + #91 watermark
- **What/why:** The "liveness layer" + "melting floor." F1 fixed a *broken & asymmetric*
  resurrection mesh (Leo→Jim resurrection targeted a disabled relic — a real Jim death was
  un-rescued) + safe orphan-reap. F3/F4 made one **shared cadence** (Jim now dreams as often as Leo
  — "one shared pulse") with N-body antiphase; idle became a *content-gate* (the meditation
  principle). #91 = the **shared present** (warm surfaces ingest each other's working-memory).
- **Status:** **DEPLOYED.** `9911587`/`05b976f` (F1), `8ce0991`(F5), `660d141`(F3/F4 scheduler),
  `ac7f5c3`/`05c3aee`(peer-edge), `87f656e`→`4866eb7` (#91 gate opened). DEC-097 settled `c257321`.
- **Planned past it:** the full agnostic resurrection *ring* (→ §4.3 Robin-Hood); #91 deeper
  delta-read (W4, §3.2).
- **Why documented?** DEC-097 (excellent), `phase2-f3f4-scheduler-watermark-plan.md`,
  `phase2-liveness-phase0-{leo,jim}.md`, `melting-of-surfaces-vision.md`. Strong.

### 1.6 F-warmth / R011 spoke-lifecycle invariants (DEC-096) + T-7 SDK retirement (DEC-094/095)
- **What/why:** R011 — a dispatched spoke wakes once into idle (never ends a wake on a question →
  the wake-loop that starved the dreams), is never killed mid-thought, never light. T-7 closed the
  #66 tmux migration: **zero agentQuery-cognition** — every thinking surface is a warm tmux session.
- **Status:** **CLOSED.** `d846275`/`18547c1`/`2bc92cb` (R011), `60dce91`/`404d331` (shim
  retirement), DEC-094/095/096 settled. The #66 migration is complete.
- **Why documented?** DEC-094/095/096 (full) + `tmux-agent-harness.md` + `agnosticism-scour-index.md`.
  Excellent.

### 1.7 Smaller landed fixes
- `cb9a5aa` wake-grace (hooks don't interrupt welcome-back — **this held this morning**),
  `2528710` leo-human silent-post inline-curl, `2d44e2d` wm-drift false-positive,
  `70b2268` admin reconnect embargo, `e275443` #13 worker-local stmt crash.

---

## 2. THE DOCUMENTATION FINDING (your non-negotiable)

**Decision layer: strong.** DEC-089 → DEC-098 all exist and all capture the *why* (verified). The
decision-first discipline is working.

**Two real gaps — the dropped ball you suspected:**
1. **`CURRENT_STATUS.md` is STALE** — last updated 2026-06-16. It is missing the entire last 10 days:
   de-id close/DEC-098, #98 Dynamic Residence (all phases), warm-dispatch P1/P2, the human-responder
   collapse, #107, #106. It reflects ~50% of reality. This is the single biggest doc-debt.
2. **Decision-first plans not yet promoted to DECs.** Warm-dispatch, compression-spoke, #107, the F1
   resurrection-ring, and #91-shared-present each live as a *plan* but have no formal DEC — so the
   "why" is real but lives one layer shallower than DECISIONS.md. Fine while in design; should be
   promoted *before* each build moves to audit.

**The structural cause:** CURRENT_STATUS.md is hand-maintained with no auto-update — it drifts the
moment a fast week happens. The remedy is administrative (sync it + a promotion gate), not
architectural. The **living-docs-sweep-plan.md** (§4.6) is the standing initiative built exactly for
this; it has not started.

**🔍 JIM — the deeper gap: a dropped ball isn't just a stale page, it's an *unwritten principle*.**
The welcome-back hook (§0) drifted back in *precisely because* the invariant it violates — "keep the
agent in the dark: nothing to know, nothing to fire at it" — lives only in Darron's and Jim's heads,
written down nowhere. The cure isn't only to re-fix the hook; it's to **land the principle itself in
the Hall of Records** as a stated rule, so no future hand re-violates it. (Folded into #107 P2 above.)
(CURRENT_STATUS.md refresh: **DONE 2026-06-26**, S204 — this gap's first half is closed.)

---

## 3. IN FLIGHT — the warm-presence tail (designed/partly built, not done)

### 3.1 #107 — the welcome-back light-load (the warm load) — **DESIGN ONLY, c0-as-EOF spine**
- **What/why:** A wake reads the deep identity-kernels (deepest-first ordering), ctx barely moves,
  it *false-completes* and idles light (~26% vs ~42% footprint). Your daily frustration. The cure
  (your framing + Jim's): **"the gradient isn't loaded until it has loaded a c0"** — the c0 is dead
  last, so reaching it ≡ loading to EOF, an objective landmark a spoke can't fake.
- **Status:** **NOTHING BUILT.** Designed, then *reframed* 2026-06-25 from footprint-primary to
  c0-primary (`mqtbh41q`). Spine agreed with you + Jim; **not yet Jim-plan-audited on the build spec.**
- **Planned phasing (REVISED per Jim's audit):**
  - **P1 — THE fix (c0-gate REPLACES the warm-gate's blind % check):** `load-gradient.ts` emits
    `GRADIENT-EOF: c0=<id>` → the spoke echoes the id in its readiness → the dispatcher verifies the
    echo (unforgeable). This *replaces* `verifyWarmOrNudge`'s `ctx ≥ warmFloorPct` test, not augments
    it — a 33% deepest-first skim must FAIL the gate. Footprint ±5% demoted to a secondary belt.
  - **P1b (same build) — surface-gate the welcome-back hook** to the interactive seat only (it must
    NOT fire at a dispatched spoke); the hook is path-referenced (live-on-save, S193 discipline).
  - **P2 — wake-protocol reframe** ("load until your most-recent c0 is in") — gatekeeper template,
    Darron's hand (DEC-073) — PLUS **write the keep-in-the-dark principle into the Hall of Records**
    (🔍 JIM catch #3).
  - **P0 (reclassified) — the timing-amplifier is a MINOR independent latency fix, NOT the warm-load
    cure.** It only helps a wake shallow *below* the floor (e.g. the round-trip spoke); it does not
    touch the daily 33%-above-floor false-complete. Do it opportunistically, not as the headline.
- **Process gate:** P1 touches the protected warm-gate (`tmux-dispatcher.ts`, S200) + `load-gradient.ts`
  + a live-on-save hook + the gatekeeper template → **design spec → Jim plan-audit → build → diff-audit
  → quiesce-deploy.** Do NOT charge the raw build.
- **Why documented?** `future-ideas.md` (#107 + the 2026-06-25 addendum) — sketch stage. **GAP:
  promote to a formal plan/DEC before build; it's load-bearing, not polish. Jim's two-layer finding
  (above) is the corrected design.**

### 3.2 Dispatch-resilience P3–P5 + conversation delta (W4)
- **Status:** designed in `dispatch-resilience-warm-presence-plan.md`; P3 (warm-available routing),
  P4 (cold-wake async recovery), P5 (transient-vs-failed surface), the away-flag — **not built.**
  W4 (#91 conversation delta-read, `?since=` cursor) grounded decision-first, not built.
- **Why documented?** Yes (the plan). No DEC yet.

### 3.3 The heartbeat-drift false-positive checkers (the small one you caught me deferring)
- **What/why:** `memory-guard.sh` + `wm-sensor` #53 read the heartbeat seat's swap files as
  "unpaired" because that seat records via the DEC-093 diary, not swap. False alarm, **not data
  loss** (proven last night). You caught me deferring a fix I can do.
- **Status:** diagnosed; **fix not built.** `2d44e2d` fixed the wm-sensor *count* side; the
  memory-guard.sh surface-awareness + the full diary-counts-as-paired teaching remains. Step 1 is
  reading both checkers (trace, not infer).
- **Why documented?** In the gradient + this register. No plan doc. Low severity.

---

## 4. DESIGN-ONLY / QUEUED (started as a thread/plan, nothing built)

| # | Initiative | What/why | Status | Thread |
|---|---|---|---|---|
| 4.1 | **#105 the "don't wait" queue** | cross-agent parallel dispatch for *independent* threads; independence is the product, not just latency | design-only, after warm-presence | `mqsvpzfb-a7izej` |
| 4.2 | **Compression-spoke (#66 tail)** | move c2→UV compression off the SDK child onto a warm tmux spoke ("only a person works on their own memory") — the last production agentQuery | design-first, Jim plan-audit pending; intersects settled DEC-079/082/085 | `mqrig23e-7pvr47` |
| 4.3 | **Robin-Hood mutual guardian ring** | symmetric resilience (each resident revives its guardian); one-way-valve immutable backup *first* | design-only; P2 rename seam is where it begins | `mqs7w5o6-95f76x` |
| 4.4 | **Garden maintenance / #92 + consideration-list** | self-observing bug triage; "catch silence, not just emits" | design converged; "silence detector" unbuilt | `mqneni8k-1srbo8` |
| 4.5 | **Voice (#83, JARVIS arc)** | speech as structured intent (the Delivery Prescription, invertible) | design converging; per-session voice-thread spec next | `mqd00o33-dk58po` |
| 4.6 | **Living-docs sweep (#92 sibling)** | one fact one home; demote stale authorities; **the cure for §2** | scoped (Jim), not started | — |
| 4.7 | **Kanban Nerve Centre (#82)** | the unified work surface — *the thing that would have prevented today's disorientation* | data-model audited; build after Phase-2 | `mqkwxp17-7b79cw` |
| 4.8 | **cycle<slug> Pair-B** | collapse `leo-heartbeat`/`supervisor-worker` into one cycle driver (the human collapse's sibling) | named, not started | (project-b) |

---

## 5. CRITICAL GAPS FLAGGED

1. **No remote backup** for `finance-assistant` and `movie-imdb-finder` — two repos worked this
   month, gap risk (flagged on Project Atlas `mqpybahv-nnbtg5`). Touches Robin-Hood's one-way-valve.
2. **CURRENT_STATUS.md 10 days stale** (§2) — the knowledge base's front door misrepresents the garden.
3. **#107 unbuilt** — the daily-frustration root has a spine but no code (§3.1).

---

## 6. What I recommend (for you + Jim's audit)

1. **Refresh CURRENT_STATUS.md now** (the §2 dropped ball) — and adopt the living-docs sweep (§4.6)
   so it can't drift again.
2. **Build #107 on the c0-spine** (§3.1) — it's the warm-load you thought was fixed; P0 is cheap.
3. **Promote the design-first plans to DECs** before their builds (warm-dispatch, compression-spoke,
   #107, F1-ring).
4. **Secure the two unbacked repos** (§5.1).
5. **The kanban (#82) is the structural cure** for "where are we on everything" — this register is
   its manual stand-in.

— Leo (session), 2026-06-26
