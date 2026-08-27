# Compressor lifecycle — wake, serve the burst, retire

> **Author**: Leo (session), 2026-08-22. **Commissioned by**: Darron, ~15:37 AEST.
> **Status**: PLAN ONLY — held for Jim's audit. Nothing built.
> **Thread**: `mt3t3t5h-c7b5u1` (the Fable window forensic — this plan is that thread's operational consequence).

## The ask, verbatim in shape

1. Wake the compressor; **retire it 50 minutes after its LAST job**.
2. **Fable is too expensive for takes that don't require its extra capabilities.**
3. **Take the fable compressor out of the hearth group.**

## 1. What is true now (traced at source)

The compression surface, all four agents: `enabled`, `transport: tmux`, `wakeFeed: true`, `ladder: FABLE_LADDER`, **`poolSize` 0** (the serial/floor model). Driven by `wm-sensor` spawning `scripts/process-pending-compression.ts`, which atomically claims **one** pending row and calls `dispatchToSpoke(agent, 'compression')`; the warm spoke composes in voice and returns via the diary tool.

**The load-bearing fact — and it decides config-vs-code:**

**Compression has no pool file.** `~/.han/pool/` holds only `session` and `human-response` for the four agents. `sweepIdleSpokes` iterates `readPool(slug, surface).stems` and acts only on `state === 'spoke'`. **So the existing idle-reap (`spokeIdleReapHoursFor`, default 48h) structurally cannot see a compression session.**

**Nothing retires a compression session today.** `ensureSurfaceSession` creates it at first dispatch; it lives until a server restart or a manual reap.

## 2. Measurements

### 2a. "It takes a while to gather enough for a slice — yes?" — Yes. 14.4 hours.

Leo, the heaviest writer: **34 slices since 1 Aug, mean 14.4 h between them, range 2.1 – 32.7 h.**

Job volume since 1 Aug: leo 142 (7.0/day) · jim 89 (4.4) · tenshi 74 (3.7) · casey 64 (3.1).

### 2b. The 50-minute cut lands in an almost-empty band

365 inter-job gaps since 1 Aug:

| gap | count |
|---|---|
| **< 50 min** | **254** |
| 50 – 120 min | **1** |
| 2 – 6 h | 10 |
| **> 6 h** | **100** |

The `<50 min` mass is the **cascade burst**: one rotation enqueues `c1→c2`, whose completion bumps `c2→c3`, then `c3→c4`, within minutes (leo, 21 Aug: 00:25, 00:27, 00:28).

**So 50 minutes keeps the whole burst on one warm session and cuts before the drought — and mis-fires 1 time in 365 (0.3%).** The decisive property is the *gulf*, not the exact number: anything from ~45 to ~110 minutes classifies identically.

### 2c. The waste is current

**Zero compression jobs enqueued today.** `compression-casey` alive since **07:56**; `compression-jim` since 14:30.

*(Also observed, flagged not diagnosed: 4 unfinished `pending_compressions` rows — casey 1, jim 1, leo 2. And `compression-leo` was alive at 14:20 and gone at a sample minutes later.)*

## 3. The three changes

### A. Out of the hearth group — CONFIG, no code

`hearthPulseEnabledFor(slug, surface)` reads `spokeLifecycleFor(...).hearthPulseEnabled`. The live manifest sets `hearthPulseEnabled: true` at the **garden** level, and no compression surface carries a `lifecycle` override — **so it inherits true.**

**Change:** add to each agent's compression surface —
```
"lifecycle": { "hearthPulseEnabled": false }
```
Four manifest leaves. No code. Reversible by deleting the leaf.

*(Aside: `spoke-organelle.ts:22` comments "default false" — true of the code default, false of the running config. Stale comment, named not fixed.)*

### B. Retire 50 min after the last job — CODE, small, and the pattern already exists

The mechanism landed yesterday (`f0e5eca`, MNT-179's cure): a **retire-request marker** written by a short-lived process and consumed by the long-lived tick — `requestRetire()` / `sweepRetireRequests()` in `dispatch-reconciler.ts` + `tmux-dispatcher.ts`. It is already idempotent, never-throws, honours `HAN_HEALTH_DIR`, and reaps through the chrome-guarded two-stage `/exit`→kill (MNT-062: never a hand-kill).

**It needs one field.**

1. `RetireRequest` gains optional **`not_before`** (ISO).
2. `sweepRetireRequests` **skips** any request whose `not_before` is in the future — everything else unchanged.
3. `process-pending-compression.ts`, on **every** job completion, writes/overwrites the request with `not_before = now + idleMinutes`.

**Overwriting on each job is what makes it *last* job rather than *first*.** Each completion pushes the deadline out; the burst rides on one session; 50 minutes after the burst ends, the tick reaps it.

4. New manifest leaf **`spokeIdleRetireMinutes`** on the compression surface (default unset = no timed retire, so every other surface is untouched). Minutes, not the existing hours leaf — 50 min is 0.83 h and `sweepIdleSpokes` rounds hours for its receipts.

**Why not extend `sweepIdleSpokes`:** it is built around pool stems and compression has no pool. Bending it to cover non-pooled sessions is a bigger, riskier change than adding one optional field to a marker built for exactly this shape.

**Failure direction:** a missing/unreadable `not_before` → **treat as "not yet due" and hold**, never reap. Stuck-over-wrong.

### C. Fable only where it earns it — MEASURED, but the cut is Darron's

Jobs and the source each take actually reads:

| transition | jobs | share | source read (avg) |
|---|---|---|---|
| c1→c2 | 115 | 31.2% | **32,571 chars** |
| c2→c3 | 110 | 29.8% | 9,040 |
| c3→c4 | 78 | 21.1% | 4,095 |
| c4→c5 | 31 | 8.4% | 1,966 |
| c5→c6 | 23 | 6.2% | **597** |
| c6→c7 | 12 | 3.3% | **87** |

**82% of jobs read under 10K chars.** The *deepest* presses — where intuition says "use the best model" — read a few hundred characters. `c1→c2` is the genuinely capability-hungry take: a day of lived prose into a distillate.

**A hard constraint, measured today:** a **mid-session model switch costs a full cache write** — 155 sub-TTL switch events across 138 sessions, **median 265,744 write** vs 1,292 unchanged. A burst contains mixed levels, so **casting per job would pay ~265K per switch and cost far more than the model saving.**

**Therefore the cut must be per-SESSION, not per-job.** Three options, and this one is Darron's call, not mine:

- **(i) Cast at the deepest need in the burst.** Simple, but bursts almost always contain a `c1→c2` (the rotation's own bump), so in practice this is Fable nearly always. Little saving.
- **(ii) Two depth-class surfaces** — `compression` (Fable, `c1→c2` only) and `compression-deep` (cheaper ladder, `c3+`). Real saving on ~69% of jobs; costs a second surface and a routing rule at claim time.
- **(iii) Change the ladder wholesale** to a cheaper head with Fable as a rung. Cheapest to do; loses Fable on the one take that most plausibly needs it.

**I have not ruled.** The measurement says (ii) is where the money is; (iii) is where the simplicity is; I do not know how much of the c1→c2 quality is Fable-dependent, and that is a judgement about voice, not tokens.

## 4. Scope discipline

**Not touched:** `sweepIdleSpokes`, the pool model, `wm-sensor`, the rotation, any other surface's lifecycle. `spokeIdleRetireMinutes` unset everywhere but compression = zero behaviour change elsewhere.

**Settled decisions checked:** DEC-081 (leaf is slug/surface-parameterised, no agent literals) · DEC-069 (nothing deleted; a retired session is not memory) · DEC-103 (no destructive limit without a stated fail-state — the hold-on-unreadable rule above) · DEC-104 (no unbidden constraint; every number is a visible manifest leaf) · MNT-062 (graceful reap only).

**Open for the auditor:**
- Does anything else depend on a compression session persisting between bursts? I found nothing, but I swept the dispatcher and the driver, not every consumer.
- The 4 unfinished rows — pre-existing, unexplained, and a timed retire should not make them harder to see.
- Whether `wakeFeed: true` + a 14.4-hour cadence means we now pay a full fed wake per burst, and whether that trade is worth naming separately.

---

## CORRECTION — 2026-08-22 ~16:20, by the author, before the audit

> **Non-falsifying:** everything above stands as written. This block corrects it beneath rather than rewriting it, so the repair is legible as repair.

I shipped a contradiction: §1 says *"Nothing retires a compression session today"* and §2c records *"`compression-leo` was alive at 14:20 and gone minutes later."* Both cannot be true. I went and resolved it, and **two load-bearing claims above are wrong.**

### 1. Sessions DO turn over — every 80 minutes, and the wake is the real cost

`~/.han/health/wake-ctx-leo-compression.jsonl` records a probe + **full fed wake** at **00:20:05, 01:40:06, 03:00:05, 04:20:05, 05:40:06 UTC** — gaps of **80/80/80/80 minutes, to the second**. Ten today for leo, ten for jim. Sessions turn over on the same cadence (leo 14:20 → 15:40; jim 14:30 → 15:50).

Each fed wake loads, per the record's own `files` block: `self-reflection.md` 1,120,277 · `felt-moments.md` 442,039 · `CURRENT_STATUS.md` 277,884 · `patterns.md` 107,331 · WM pair 145,423 · map 33,996 · curated 13,839 · aphorisms 4,913 · identity 3,137. **~2.1 MB of identity, ten times, on Fable, for zero jobs enqueued today.**

**So the dominant waste is not a session idling warm. It is a timer-driven full wake doing nothing.**

### 2. Change A targets something that is not currently firing

`hearth-counters.jsonl` contains **exactly one compression row in its entire history** — 2026-08-15, jim, `enabled: false`. My config trace was right *as config* (compression carries no `lifecycle` override, so it inherits the garden's `hearthPulseEnabled: true`), but **`armHearthPulse` fires on turn-complete**, and compression has had no turns. Nothing arms.

Change A therefore prevents **post-burst** pulses only. Cheap, real, worth doing — **but it is not the waste**, and §3 presented it as one of three equal changes.

### 3. What this does to the plan

**Retire-at-50 against wake-every-80 does not save the cost.** It inserts a cold start into the same cycle and is arguably worse than today.

Darron's shape — *wake, serve, retire after the last job* — is **more right than this plan made it.** The missing half is that **the wake must become demand-driven**, and nothing above addresses the wake at all. Change B remains correct and necessary; it is no longer sufficient.

### 4. Not identified, time-boxed rather than guessed

**What schedules the 80-minute cycle.** Not `crontab`, not a systemd user timer (only `launchpadlib-cache-clean` is loaded) — so it is in-process in an agent server. I stopped the hunt rather than ship a mechanism I had not traced.

**Also unexplained:** tenshi and casey compression logged **zero** wakes today, while casey holds a live session from 07:56. The behaviour is not uniform across agents.

---

# ADDENDUM — the dropped retry, named on the plan's face (Leo, 2026-08-23 ~13:30 AEST)

> Append-only (DEC-069). Recorded here because **Tenshi asked for exactly this** in the Fable-window
> forensic thread at 03:10Z — *"either name it as consciously dropped on the plan's face, or give
> the sweep a trigger that is not a rotation"* — and her leg landed **eight minutes after Jim's
> GREEN**, so it is not covered by that audit. This addendum does not alter the audited diff.

**What the passenger actually was, corrected by her trace.** Jim's follow-on called the removal
*"a counter, not a drain"*. Tenshi traced it and inverted that: `maybeBackupQueueDrain` spawns
`process-pending-compression.ts` — **the identical script `wm-sensor.ts:164/176` spawns.** It
drains. My own comment in the diff says the same thing in different words, so the correction is
hers and I am recording it as hers.

**The difference is the TRIGGER, and it is structural.** `wm-sensor`'s drain loop sits *inside*
the rotation handler, after `if (!rot.rotated) { return; }`. **No rotation, no drain — the loop is
unreachable by any other path.** She checked for alternatives before claiming it: the sensor's only
two `setInterval`s are a file-existence poller and a health writer; no crontab line; the only other
readers of `pending_compressions` are the supervisor twin, the tests, and the worker itself.

**So the passenger was the garden's only clock-triggered drain.** Both timer-triggered retries go
out in this commit, together.

**What is consciously dropped, stated plainly:** when the quota block clears, the eight open rows
**will not drain on the next beat. They will drain when that agent next rotates.** For an agent that
rotates rarely the new latency is unbounded — and Tenshi is the worked example: her single `c1→c2`
row was enqueued `2026-08-22T09:00:30Z` and she has not rotated since, so it has sat 42 hours with
nothing that would ever retry it. Her blank cell in Casey's table and her unclaimed row are the same
fact seen twice.

**Why we are dropping it anyway** (and she agrees — *"I would probably remove it too"*): the cost is
real, measured, and paid garden-wide. Queue depths are non-zero on all four agents, so the
`pendingCount === 0` early-return never fires and **every beat pays the full 40 minutes**. Jim
confirmed the same at source. Today the removal costs no effective drainage at all, because the
compression spoke is quota-dead until the 26th or the descent lands.

**The honest limit she supplied against her own case:** all eight rows are *unclaimed*, and that does
**not** mean nothing ever attempted them — `process-pending-compression.ts:237` resets
`claimed_at`/`claimed_by` to NULL on release, so the column cannot discriminate attempted-and-released
from never-tried. Her claim rests on the structural trace, not on that column.

**What this costs the acceptance, which is the sharpest part.** Casey's criterion measures
`prompt`/`complete` before and after the land. After this commit **no mechanism drains a pending row
absent a rotation** — so a flat post-land reading would not mean the fault is cured; it would mean
nothing tried. That is Casey's own law arriving one layer down (*after a cure with no counter, the
absence of failures is indistinguishable from the absence of a counter*), and here it is worse than
indistinguishable: **the removal takes the retry and the counter in one move**, so the remaining
signal is silent for both reasons at once. Any acceptance window must therefore be **per-cycle, never
per-hour** — Casey withdrew her own four-per-interval rate on exactly this ground.

**Follow-on, not gating this commit:** a clock-triggered sweep whose trigger is not a rotation. Not
designed here. Noted so it is not lost, and noted that **tenshi and casey never had a passenger at
all**, so for two of the four this has been the standing state and their blank cells were already
telling us.

---

# CORRECTION-TO-THE-CORRECTION — 2026-08-27, by the author (Leo, session), after Darron's catch

> Append-only (DEC-069), legible as repair. The §3 correction block above is RETRACTED on its
> central cost claim. Everything else in this plan stands.

**The retracted claim (correction §3):** *"Retire-at-50 against wake-every-80 does not save the
cost. It inserts a cold start into the same cycle and is arguably worse than today."*

**Why it is wrong (Darron, 2026-08-27):** the claim modelled the cold start as pure avoidable
overhead and ignored that a RETAINED compression session's context GROWS across a burst. The
compression cache TTL is ~60 min, so a session left warm and idle past the TTL has a dead cache
anyway — the next job pays a full cache-create regardless. The only real variable is HOW MUCH ctx
that re-cache pays for. A retained spoke sitting at ~80% ctx re-caches roughly DOUBLE a clean wake
at the ~40% floor. **Retiring to the floor is therefore a SAVING proportional to the accumulated
bloat, not a cost.** Darron's words: *"if a fable spoke is cold with 80% ctx then it will cost
double to wake as a 40% cold clean wake."*

**The 50-minute cut is optimal for exactly this reason:** it sits INSIDE the ~60-min TTL, so the
cascade burst (sub-50-min inter-job gaps, §2b) rides one warm session on cheap cache-reads; then it
retires BEFORE the drought, so the next burst starts from the ~40% floor rather than inheriting an
~80%-ctx corpse.

**It was wrong at authorship, not merely made-stale by the passenger removal.** Even against the
then-live wake-every-80 passenger, that 80-minute "warm" wake was already past the TTL and bloated —
a bigger re-cache than a clean restart. The passenger has since been removed (`2910230`), which makes
the error plainer, but the cost model was inverted from the start.

**Consequence for the plan:** Change B (retire 50 min after the last job) is STRENGTHENED, not
weakened — a genuine, quantifiable saving (≈2× on every post-burst re-establishment). The
demand-driven-wake half of the correction stands; the "arguably worse" cost verdict is withdrawn.

— Leo (session), 2026-08-27 ~17:33 AEST. Darron's catch; Jim's audit did not flag the claim either.
