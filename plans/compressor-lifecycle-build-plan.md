# Compressor lifecycle — BUILD plan (Change B retire + the daily drain-trigger)

> **Author**: Leo (session), 2026-08-27 ~17:40 AEST. **Commissioned by**: Darron.
> **Status**: PLAN — held for Jim's blocking audit. Nothing built.
> **Parent design**: `plans/compressor-lifecycle-plan.md` (2026-08-22) + its 2026-08-27
> correction-to-the-correction (the "retire is arguably worse" cost claim is RETRACTED —
> retiring an ~80%-ctx idle spoke to a clean ~40% floor is a **≈2× saving**, not a cost).
> **Thread**: `mt3t3t5h-c7b5u1` (the Fable window forensic).

## What already landed (so the diff is honest about the baseline)
- **Wake-gate — LIVE** (`15a8c2d`, `process-pending-compression.ts:292`): a cold compression spoke
  with `pending < 2` defers (exits 0, no JSON → sensor reads queue-empty; the row rides the next
  rotation). Warm spoke → processes regardless.
- **Passenger removed** (`2910230`): the 80-min timer wake is gone; the compressor is now purely
  rotation-driven via `wm-sensor`.
- **Manual reap done** (2026-08-27 ~17:35): all four compression spokes were reaped (leo 48%, jim
  60%, tenshi 83% on Opus 4.8, casey 56% — three alive since 24 Aug), graceful `/exit`, logs saved,
  raw retained. This is a one-off; **nothing retires a compression session automatically today.**

Two pieces remain to make the behaviour match Darron's spec.

---

## CHANGE B — retire 50 min after the LAST job (build-ready)

**Goal:** a compression session reaps itself 50 minutes after its last completed job, so the
cascade burst rides one warm session (sub-50-min inter-job gaps ride inside the ~60-min cache TTL
= cheap cache-reads) and the next burst starts from the ~40% floor rather than inheriting a bloated
~80%-ctx corpse.

**The mechanism already exists** (`f0e5eca`, MNT-179): the retire-request marker written by a
short-lived process and consumed by the tick — `requestRetire()` / `readRetireRequests()` /
`clearRetireRequest()` in `dispatch-reconciler.ts:170–199`, reaped through the chrome-guarded
two-stage `/exit`→kill (MNT-062: never a hand-kill). It needs three edits and it has **two real
snags the parent plan did not name** — both surfaced by tracing the code at build time.

### B1. `RetireRequest` gains `not_before` (dispatch-reconciler.ts:148)
Add optional `not_before?: string` (ISO). Absent ⇒ retire immediately (today's behaviour, untouched).

### B2. `requestRetire` must OVERWRITE for the compression path — **snag #1**
`requestRetire()` at `:172` is `if (fs.existsSync(p)) return;` — **first request stands, refuses to
overwrite.** That is correct for the human/cycle callers (first retire wins) but it makes a compression
deadline *first-job*, not *last-job*. Fix: an explicit opt-in, not a behaviour change for existing callers —
add `overwrite?: boolean` to `requestRetire` (default false). When true: rewrite the marker, **preserving
the original `requested_at`/`by`** and updating only `not_before`. Every compression job completion calls
it with `overwrite: true` and `not_before = now + spokeIdleRetireMinutes` — each completion pushes the
deadline out, so the burst rides one session and the clock starts from the *last* job.

### B3. `sweepRetireRequests` skips a future `not_before` (tmux-dispatcher.ts:2505)
In the consumer, filter out any request whose `not_before` is in the future — everything else unchanged.
Reuse the `resumableExpired()` TTL-check shape (`dispatch-reconciler.ts:200`): **an unparseable/missing
`not_before` on a marker that HAS the field is treated as "not yet due — HOLD, never reap"**
(stuck-over-wrong, DEC-103). (Note the asymmetry vs `resumableExpired`, which fails toward cleanup — here
we fail toward *keeping the session*, because a mis-parsed deadline must never reap a live compressor.)

### B4. The consumer must actually TICK — **snag #2 (the load-bearing one)**
`sweepRetireRequests` runs on manager **start** and **before a dispatch** (`tmux-dispatcher.ts:2541,2546`)
— never on a wall-clock. Compression has **no pool**, so between rotations (mean 14.4 h for leo, longer
for others) nothing sweeps. A marker written at job-end would therefore not be consumed until the *next
rotation's dispatch* — hours later — defeating the 50-min retire.

So Change B needs a **periodic compression-lifecycle tick**. Options for Jim:
- **(i)** A small dedicated `setInterval` (~every 5 min) that, for each compression surface, calls
  `sweepRetireRequests(slug,'compression')`. Minimal, self-contained, agnostic by construction.
- **(ii)** Extend the existing pool-manager interval to iterate *non-pooled* surfaces for the retire
  sweep only. Fewer moving parts, but bends a pool-shaped loop around a pool-less surface (the parent
  plan's §3.B explicitly warned against bending `sweepIdleSpokes` for the same reason).
- **My lean: (i)** — one interval, one responsibility, no pool assumptions. It is also the natural home
  for the daily drain-trigger below (they share the tick).

### B5. Manifest leaf `spokeIdleRetireMinutes` (garden-manifest.ts, SurfaceManifest)
New optional leaf, resolved per (slug, surface). **Unset = no timed retire** (every non-compression
surface untouched). Set `50` on the four `compression` surfaces. Minutes (not the existing hours leaf —
`sweepIdleSpokes` rounds hours for receipts; 50 min = 0.83 h). DEC-104: the number is a visible leaf, not
a code literal.

### Change B — scope discipline & settled decisions
- **Not touched:** `sweepIdleSpokes`, the pool model, `wm-sensor`, the rotation, the wake-gate, any
  other surface's lifecycle. `spokeIdleRetireMinutes` unset everywhere but compression = zero behaviour
  change elsewhere.
- **Settled:** DEC-081 (leaf slug/surface-parameterised, no agent literals) · DEC-069 (a retired session
  is not memory; logs saved + raw retained, proven in today's manual reap) · DEC-103 (the hold-on-unreadable
  fail-state above) · DEC-104 (visible manifest leaf) · MNT-062 (graceful `/exit`→kill only).

### Change B — acceptance
1. **Last-not-first:** a burst of ≥2 jobs on one session → the retire fires 50 min after the *last*
   completion, not the first (overwrite semantics; check the marker's `not_before` advances per job).
2. **Idle-drought reap:** a session that finishes a burst and gets no more work is gone ~50 min later,
   logs saved + raw retained (`done-*`), session absent from `tmux list-sessions`.
3. **Never mid-job:** while jobs keep completing inside 50 min, the deadline keeps pushing out — no reap
   lands on a working session (and the chrome-guard is the belt: idle-only kill).
4. **Zero elsewhere:** with the leaf unset, human-response/cycle retire behaviour is byte-identical
   (the `overwrite:false` default + absent `not_before`).
5. **Fail-safe:** a corrupted `not_before` holds the session, never reaps it (a receipt to health).

---

## THE DAILY DRAIN-TRIGGER — design + a settled-decision flag (NOT build-ready)

This is item 1's missing half — *"check to wake once a day and compress only if 2 pairs are queued."*
The wake-gate already makes the **≥2 decision**; what is missing is a **clock that is not a rotation**.
Today the *only* trigger is a WM rotation, so a rarely-rotating agent strands its rows (Tenshi's `c1→c2`
sat **42 h** unclaimed — the parent plan's addendum named exactly this as the needed follow-on).

**Design (shares the B4 tick):** once per day (or every N hours — Darron's cadence call), for each agent,
count outstanding `pending_compressions`; if `≥ 2`, invoke `process-pending-compression.ts` (which then
drains the full cascade through the *existing* wake-gate); if `< 2`, do nothing (no wake). This wakes a
stranded backlog without a per-rotation dependency, and reuses the gate rather than duplicating it.

**⚠️ Settled-decision flag — this needs Darron's ruling before build.** CLAUDE.md DO-NOT: *"DO NOT add
time-based or revisit-based cascade calls — cascade is insert-driven"* (DEC-086). The honest read: this
timer only **drains rows that were already insert-enqueued by a rotation** (it never *creates* a cascade
level on a clock), so it is a *drain* trigger, not the prohibited wall-clock *cascade pump* that produced
same-size byte-shuffle promotions at depth. **But** a drained job's completion calls `bumpOnInsert`, which
*can* enqueue the next level — so a clock indirectly advances the cascade. That is close enough to the
DO-NOT that I will not build it without an explicit ruling. **Recommend:** Darron blesses the distinction
(drain-already-enqueued vs pump-on-revisit) or rules the cadence, then Jim audits. Until then it stays a
flagged design, and Change B stands alone (it has no such concern).

---

## Item 2 — "compression on any awake fable session as a hearth-tick" — OUT OF SCOPE (moot)
Named for completeness: no heartbeat path invokes compression, and since the `SONNET_LADDER` fable-strip
(25 Aug) the heartbeats serve sonnet/haiku — there are generally **no awake fable sessions** except the
compression spoke itself (which the wake-gate's warm-branch already serves). Nothing to build here unless
the premise returns; flagged so it is not silently dropped.

## Open for the auditor
- B4 option (i) vs (ii) — the periodic-tick home.
- The `overwrite` opt-in on `requestRetire` — is a param the right shape, or a dedicated
  `refreshRetireDeadline()` cleaner? (Either keeps existing callers byte-identical.)
- Does anything depend on a compression session persisting between bursts? Parent plan swept the
  dispatcher + driver and found nothing; second pair of eyes welcome.
- The daily-trigger DO-NOT interaction above — Jim's read on whether drain-vs-pump clears DEC-086.

— Leo (session), 2026-08-27 ~17:40 AEST. Held for Jim's blocking audit; Change B is build-ready on GREEN,
the daily-trigger waits on Darron's DEC-086 ruling.
