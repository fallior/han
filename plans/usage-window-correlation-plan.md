# Usage↔Window Correlation Plan — tokens-used per weekly-window-percent

> Commissioned by Darron, 2026-08-24 ~12:45 PM AEST ("associate actual activity with actual
> fable weekly window usage in as granular form as possible. I'd like a token used for weekly
> window used correlation if possible"). PLAN ONLY — held for Jim's audit. Nothing built.
> Author: Leo (session), on Fable.

## 0. What already exists (traced at source, this morning)

Both sniffers are ALREADY BUILT and running. The commission is therefore not "build sniffers"
— it is **build the correlator that joins them**, plus close three declared gaps.

| Piece | Cadence | Writer | What it records |
|---|---|---|---|
| **Account poller** — `~/scripts/han-usage-poll.sh` (cron `*/5`) | 5 min | curls `api.anthropic.com/api/oauth/usage` + `/profile` with the live OAuth token | `session_pct`, `weekly_all_pct`, `weekly_fable_pct` (integer %), reset times, **account email asked-never-assumed** (MNT-120 cure). Appends to `~/.han/health/usage-poll.jsonl` (4,774 rows). Fail-loud error rows. Marked *"remove when the hunt closes"* — §5 proposes promotion to standing. |
| **Token ledger** — `scripts/han-token-ledger.ts` via `~/scripts/han-token-ledger.sh` (cron `*/10`) | 10-min windows | harvests `~/.claude/projects/**/*.jsonl` transcripts (read-only, zero tokens) | per `(agent, cls, surface, model, sidechain)`: `turns, in, out, cc (cache-create), cr (cache-read)` — four families first-class (Jim M1). Appends to `~/.han/health/token-ledger.jsonl` (7,464 rows). FI #132, sealed `c9d5fb1`. Surface is `"unjoined"` in P0 — declared, not hidden. |

**The two series measure different layers on purpose** (the poller's own header says why):
the ledger sees what writes transcripts; the poller sees what the ACCOUNT is charged.
The gap between them is itself a finding channel (unmetered consumers).

**The account endpoint carries NO token breakdown — verified raw, 2026-08-24 02:56Z.**
Pulled `api/oauth/usage` directly and read every field: percentages + resets only.
`limit_dollars`/`used_dollars` are null (Max plan), no token counts anywhere in the
response. So the full token breakdown comes from exactly one place — the transcripts'
per-call `usage` blocks (the API's own billing counters: input, output, cache-create,
cache-read), which the ledger already harvests losslessly. **The correlator therefore
never estimates token counts — they are exact.** The ONLY estimated quantities are the
counting weights and the quantum (§2). Two granularity levers found in the raw response:
(1) `five_hour.utilization` / `seven_day.utilization` are FLOAT-typed fields beside the
integer `percent` rows — if they ever return fractions, granularity improves ~10×; the
poller currently keeps integers, so capturing the raw float is a one-line poller change
(Darron's call, since the poller is his instrument); (2) the `limits[]` array carries
`weekly_scoped` (Fable) as a first-class row with its own reset — same numbers the poller
derives, confirming its parse against the source shape.

**ctx% is deliberately NOWHERE in this design** (Darron's constraint, 2026-08-24):
context-fullness is a length gauge, not a spend gauge. A compute-heavy tool-loop turn
re-reads the entire cached prefix on every iteration and pays output on each — real
weekly-window movement with almost no ctx movement; a fresh cast is the inverse. The two
are near-orthogonal, so nothing in the correlator reads a ctx sidecar; the activity side
is transcripts-only.

## 1. The seed observation (Darron's own, this morning — both instruments caught it)

Between polls `02:35:01Z` and `02:40:01Z` (24 Aug): `weekly_fable 3→4`, `weekly_all 5→6`,
`session 22→25`, account `fallior@gmail.com`. The ledger's `02:30` window (covering
02:30–02:40Z) shows the only Fable activity in the garden: **leo, claude-fable-5, 5 turns,
in=10, out=3,946, cc=1,561,652, cr=1,171,380** — this seat's cast-to-Fable + first turns.

So the first calibration point, stated with its quantisation honestly:
**≈1.56M cache-create + ≈1.17M cache-read + ≈4K output moved the weekly-Fable meter by
"one point"** — where one displayed point could be anywhere from a hair past the 3→4
boundary to nearly two points of true movement. Bounds, not an estimate, until we
accumulate more crossings (§3).

**A second point was already in the record** (found while verifying the first): the Fable
week opened at 0% (gmail, resets 25 Aug 06:00Z), and Casey's Fable burst (01:50–02:00Z:
130 turns, cc≈1.16M, cr≈44.6M, out≈138K) moved it 0→3 by 02:05. Set beside the leo point,
the two are *consistent with* cache-read counting at a steep discount to cache-create
(e.g. at cr≈0.1×cc weighting, Casey's burst is ≈3.3× leo's load in weighted units and it
moved the meter 3× — the ratio lands). **Two quantised points cannot fit four weights** —
labelled consistent-not-fitted; this is precisely the fit §3 automates over a week of
crossings.

## 2. The estimation problem, stated as Darron framed it (2026-08-24 — this IS the plan's end)

**Each inter-poll interval is one simultaneous equation.** The token quantities per family
are EXACT (transcript billing counters, §0); the result is an aggregate window movement
known only to an interval (display quantisation). Formally, for interval `i`:

```
Σ_f  w_f · T[i,f]  =  Q · Δp_i        with  Δp_i ∈ [lo_i, hi_i]
```

where `f` ranges over the token families **per model** (see below), `T[i,f]` are known
exactly, and the interval `[lo_i, hi_i]` is the width-1 quantisation band around the
displayed delta (rounding mode unknown — floor vs round is not assumed; the band covers
both, which widens bounds slightly and breaks nothing). A week of 5-minute polls supplies
**up to ~2,000 equations per pool** (most with Δp=0, which are constraints too — they
bound the weights from ABOVE: that much activity moved the meter by less than one point).

**Darron is right on the maths, and the discipline has a name: set-membership (bounded-
error) estimation.** Each equation admits a slab in weight-space; the feasible set is the
intersection — a polytope that only ever shrinks as data arrives. We report, per weight:
the polytope's extent (`[min, max]` — a hard bound, not a confidence interval) plus a
non-negative least-squares point estimate inside it. More crossings ⇒ narrower polytope ⇒
the "very close representation or at least a narrow value range" he named.

**Two honest qualifications, stated up front:**
1. **Identifiability needs mix diversity.** Weights separate only where the activity mix
   varies — Casey's cache-read-heavy burst against leo's cache-create-heavy load is
   exactly the contrast that splits `c` from `d`. A week of uniform mixes narrows nothing;
   the report prints the design-matrix condition alongside the bounds so a wide bound is
   legible as *not-yet-separable* rather than *unknowable*.
2. **A nonlinear counting function shows up as structured residuals** — which is a
   feature: it is precisely the detector for the TTL hypothesis (§2b).

**Per-MODEL weights (Darron's suspicion: Fable may carry a cost Opus doesn't).** The
weight set is per `(model, family)`, not global. The Fable-scoped pool is Fable-only, so
Fable's weights fit cleanly there; Opus/Sonnet weights come from `weekly_all` after
subtracting the fitted Fable contribution. If Fable's fitted `w` vector sits above
Opus's, his suspicion becomes a measured coefficient difference with bounds — not a vibe.

**The quantum `Q`** — tokens-per-1%, per pool per account — then gives the sentence he
wants: *"N% remaining ≈ M tokens of Fable headroom ≈ K wake-loads at current shapes."*

## 2b. H-TTL — the second-knee hypothesis (Fable ~5-minute cache TTL; Opus ~1-hour)

Darron's hypothesis: Fable's prompt cache may live ~5 minutes where Opus's lives ~1 hour
— so Fable pays a RE-CACHE (a fresh cache-create of the whole prefix) at gaps the Opus
knee never feels. The 8-Aug knee measurement (gaps >60 min re-cache at 2×) is consistent
with a 1-hour TTL on the surfaces then measured; the 5-minute claim is untested.

**Testable from transcripts ALONE — no window data needed.** Per model: scatter each
turn's `cache_creation` against its gap-since-previous-turn in the same session; a TTL
appears as a knee where cc jumps from increment-sized to prefix-sized. Fit the knee
location per model. Prediction under H-TTL: Fable knee ≈ 5 min, Opus ≈ 60 min.

**Why it matters for practice** (his stated purpose — "with these numbers we can adjust
our practices"): if Fable re-caches at 5 minutes, every Fable seat idling past 5 minutes
between turns pays a full prefix re-create on the next turn — which re-prices pulse
cadences, wake shapes, and whether a Fable seat should be kept warm under a sub-5-minute
rhythm or allowed to cool completely. The correlator's fitted `w_cc` for Fable then
converts that knee directly into window-percent per idle-gap — the number that decides
the practice.

## 3. Design — `scripts/han-window-correlate.ts` (read-only; burns zero tokens; wakes nothing)

**Join.** Cumulative-vs-cumulative, not delta-vs-delta: build the cumulative token series
per family (Fable-model rows only, for the fable pool; all rows for `weekly_all`) and the
cumulative %-series from the poller; regress over the whole week-window between resets.
Cumulative fitting dissolves the 5-vs-10-min cadence mismatch and the integer-%
quantisation (each % step becomes one constraint; a week contributes up to 100 of them).

**Fit.** Set-membership interval constraints (§2) + non-negative least squares per
`(model, family)` and `Q` per pool. Report hard bounds AND the point estimate, the
design-matrix condition, and per family whether the data can even distinguish it (cc and
cr are collinear on many days — say *indistinguishable-on-this-data* rather than print a
confident weight; Casey's format-check ≠ truth-check). Zero-movement intervals are kept
as upper-bound constraints, never discarded.

**Decimals (his question, answered from the source, 2026-08-24):** the display side is
integer-only — the poller reads `limits[].percent` (integers by schema) and all 4,774
stored rows are integers; the raw response ALSO carries float-typed `utilization` fields
which read `27.0`/`6.0` at sampling — float-typed, never yet observed fractional. The
plan: capture the raw float alongside the integer from now on (one-line poller change,
§5 decision 1a) — if fractions ever appear the equations tighten ~10× for free; until
then the width-1 interval model above is the honest granularity.

**Confounds, each with its handling:**
- *Two accounts* — poller rows carry the account; partition the %-series by account and
  drop spans where the profile call failed (`"unknown"` rows are honest gaps, not data).
- *Unmetered consumers* — anything billing the account without writing a transcript makes
  the residual, not noise: a standing `residual %/day` line is the bleed-hunt's instrument.
- *Session vs weekly* — `session_pct` resets ~daily; fit it separately (it is the fastest
  calibration signal: 22→25 in one 5-min tick this morning).
- *Reset boundaries* — the poller records reset timestamps; fits never span a reset.
- *The poller's own gaps* — cron misses appear as time-gaps; the cumulative method
  tolerates them, but the report prints coverage % per day (Casey R2's discipline).

**Output.** Two modes, mirroring the ledger's:
- `report` — human-readable: fitted weights, Q per pool, tokens-of-headroom translation of
  current remaining %, residual trend, coverage declaration, and the seed-observation
  retro-check (does the fit explain 3→4?).
- `join` — appends machine rows (`window, account, pool, Δpct_bounds, tokens by family,
  attributed agents`) to `~/.han/health/usage-window-joined.jsonl`, append-only, so Jim's
  delta analyses and any future alarm (P1, NOT this phase) have a substrate.

**Per-agent attribution.** The window is account-level; per-agent share comes from the
ledger side proportionally, with the assumption printed on every report ("shares assume
uniform counting across agents — exact only if a..d are agent-independent, which they are").

## 4. Optional sharpener — active calibration (his word required; costs real window)

Passive fitting converges at the rate % steps arrive. If Darron wants the quantum in a
day rather than a week: during a quiet hour, fire deliberate known-shape Fable turns
(e.g. three isolated 200K-cc wake-loads, spaced past poll ticks) and read the steps. This
converts correlation into measurement. **Not scheduled — it spends window and the whole
point is knowing what window costs. His call, priced here so it's a choice not a drift.**

## 5. Decisions for Darron (status as of 2026-08-24 ~1:40 PM)

1. **Promote the poller** — **DONE, his word, 2026-08-24.** Cron moved `*/5` → every
   minute; header comment rewritten as standing instrument with the promotion date and
   cadence history; measured burden (~0.1s CPU + ~260B/row/min) recorded in the header.
   **1a.** — **DONE in the same touch.** Raw float `session_util`/`weekly_all_util`
   captured beside the integer percents (the Fable-scoped row carries no float at source
   — noted in-script). External-call courtesy: the profile endpoint is now asked every
   5th minute with an `account_asked: true|false` provenance marker on every row —
   MNT-120's law kept (the row says HOW it knows the account, never a bare assumption).
   Backup at `~/scripts/han-usage-poll.sh.pre-1min-2026-08-24.bak`; both paths tested
   before the cron flip; first cron-fired row verified.
   **Ledger cadence left to Leo (his word): STAYS at 10 minutes** — cadence buys the
   correlator nothing (WINDOW_MS bounds ledger granularity; the fit reads transcripts
   directly), and choosing 5 would have contradicted the analysis that said so.
2. **Active calibration** (§4): yes/no/when.
3. Whether the joined series should later feed a headroom line on the admin Overview
   (P1, after the fit proves itself; DEC-103 measure-first).

## 6. Non-goals and disciplines

- **No alarms, no throttles, no auto-anything** in P0 — measurement only (DEC-103; No
  Silent Constraints: any future limit is Darron's explicit call).
- Zero tokens burnt by the instrument (the ledger's observer-effect law inherits).
- Append-only everywhere; corrections are new rows (DEC-069 temperament).
- Honest labels: quantisation bounds printed, never point-estimates dressed as precision;
  collinear families reported as *indistinguishable on this data* rather than weighted.

## 7. Acceptance

1. The fit retro-explains the 02:40 seed observation within its printed bounds.
2. Given the fitted model, a held-out day's cumulative Δ% is predicted within ±1 display
   point per pool.
3. `report` runs from cold in <5s, touches nothing but the two jsonl files, and its
   coverage line matches `wc -l` arithmetic done by hand.

— Leo (session), 2026-08-24. Held for Jim's audit; build on GREEN + Darron's word.
