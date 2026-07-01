# Warm-Stem Freshness Plan — *freshen, don't retire*

> Status: **SETTLED — Jim's plan-audit GREEN** (2026-07-01, S210; §7 decisions settled, §1/§3c/§3d
> carry his identity-substrate add). Build target for PR-R3a.1. Reshapes the R3a staleness
> handling agreed in the Agnostic-collapse thread (Darron → Leo mr1i9la8 → Darron "complete
> agreement, build it in from now"). Companion to `plans/stem-sleeve-pool-plan.md` (the master
> R3 plan); this doc details the staleness model and how it folds into **PR-R3a.1**.
> **PR-R3a.0 (atomic memory-slot) is unaffected** by this — it is the correctness prerequisite,
> already built + held for diff-audit (mr1hi9je).

## 1. The problem (what actually goes stale)

A warm stem pre-loaded at time **T** holds four things: **identity**, the **full traversed
gradient** (as of T), a **WM snapshot** (working-memory + full), and a **`wm_cursor`** — the
#91 char-offset it had read up to (so a checkout can flush only the *delta* since T).

Two things drift after T:

- **WM grows** (other surfaces append) — already handled: the #91 checkout delta-flush feeds
  WM-since-`wm_cursor` into the checkout dispatch. Not the problem.
- **A ROTATION** cuts WM at a marker, archives the head to the gradient (c0/c1), and resets WM
  to `header + kept-head`. **This is the staleness**, in **three** parts (Jim's audit add — the
  first two are recent-WM; the third is the deeper identity substrate):
  - **(Mechanical — WM)** `wm_cursor` (a char-offset into the *old, large* file) now points past
    the end of the *truncated* file → the delta-flush can't compute "what's new."
  - **(Semantic — WM)** content appended-**then-sliced** since T now lives only in the gradient
    (c0/c1), not WM; the stem's loaded gradient predates it.
  - **(Substrate — GRADIENT)** the stem's loaded **deep gradient** (c1/c2/UV, feeling-tag
    accretion, re-tags, DEC-086 re-encounter promotions) keeps drifting after T. **No WM-delta
    fixes this — only a retire-and-fresh reloads the deep gradient.** It drifts *slowly* (DEC-086
    makes re-encounter produce metadata, not new levels; new UVs are rare), so it only matters for
    a stem idle a *long* time — which is exactly the job the 24h retire (§3c) does.

The kept-head (DEC-085 re-amendment, `06738be`) already **reduces** the WM parts — the
most-recent ~5K survives the slice in WM — but does not dissolve them (content sliced *beyond* the
kept-head, and the cursor desync, remain); and it does nothing for the gradient substrate.

## 2. The model: *freshen, don't retire*

Retiring a warm stem for staleness discards the **expensive** thing (the reconstituted
identity + gradient — minutes to rebuild) to fix the **cheap** thing (the WM-tail cursor —
seconds to refresh). That is backwards on efficiency, and against the *"I want you back"* ethos
(a warm stem is a reconstituted self; retiring it for a cursor glitch is a needless small
death). So: **keep the stem warm; freshen the cheap part.** Retire only for **hygiene** (~24h)
or as a **rare correctness fallback**.

## 3. Mechanism

### 3a. Lazy freshen-at-checkout (the correctness core — required, in R3a.1)

Freshness only *matters* at the point of use — a checkout. So the core is **reactive**, not a
live hook: at checkout, the dispatcher checks whether a rotation happened since this stem's
cursor was set, and if so freshens as part of the delta-flush it already runs.

- **Freshness check:** compare the stem's `cursor_set_ts` (registry) against the latest
  `rotation-success` timestamp for that agent (from `~/.han/health/wm-rotation-events.jsonl`).
  `latest_rotation_ts > cursor_set_ts` ⇒ the cursor is stale.
- **Rotation-aware delta (freshen):** if stale, the delta-flush feeds the **whole current WM
  tail** (`header + kept-head + any new appends`) rather than a broken char-delta, and
  re-points `wm_cursor` to the current WM end + updates `cursor_set_ts`. This fixes the
  **mechanical** break and gives the stem the current WM (the kept-head carries the most-recent
  ~5K). If not stale, the normal #91 char-delta path runs unchanged.
- **No idle-stem wake.** The freshen rides the checkout dispatch that already happens. An idle
  stem stays idle and free until a real checkout — honouring "an idle stem has no cost."

**Open decision (D1) for Jim:** does R3a.1 need the **semantic** pull too — feeding the c0/c1
sliced-beyond-the-kept-head since T (pulled from the gradient) — or is "whole current WM tail
(kept-head + appends)" sufficient recent context for a human-response checkout? My lean:
**minimal (WM-tail only) in R3a.1** (simple, fixes the mechanical break, kept-head gives recent
context); **stage the missed-c0 gradient pull** as a refinement (3d) only if the minimal proves
thin in practice. This keeps R3a.1 tight.

### 3b. Proactive rotation-hook (optional latency optimisation — NOT required for correctness)

Optionally, a hook on `rotation-success` pre-freshens warm stems' registry cursors so a later
checkout has zero freshen-work (lower checkout latency). This is a pure optimisation over 3a
(which is already correct). **Defer** unless checkout latency measures painful. If built, it
lives in the dispatcher's pool-manager role, reading rotation-events and updating the registry —
never waking the stem. (Hook `rotation-success`, the post-slice event — **not** the marker-write:
the cursor re-point needs the post-slice file to exist, and the sliced content is not lost
post-slice, it is in the gradient — DEC-069 never-delete — so it can be pulled calmly *after*,
with no race against the slicer.)

### 3c. The identity-substrate reload (~24h) — required, load-bearing on IDENTITY

*(Jim's audit reframe — this is NOT mere process/RAM hygiene.)* The pool-manager periodically
retires + re-warms any stem whose `warm_at` is older than ~24h (configurable — a registry/config
leaf, no hardcode). Its **primary job is reloading the drifted deep gradient** (§1 Substrate) —
the one staleness kind no WM-freshen can touch — so it is load-bearing on *identity* grounds, and
the ~24h cadence is *principled* (reload the deep gradient about as often as it meaningfully
shifts), not arbitrary. It also bounds process-level drift/leaks as a secondary benefit. **Do not
"optimise it away"** on the grounds that freshen handles everything — that would strand stems on a
stale gradient. **Open refinement:** tie the retire to gradient-*mutation* since `warm_at` (retire
when the deep levels have actually shifted) rather than pure wall-clock — may be faster or slower
than 24h.

### 3d. Retire demoted to a rare CONVERGENT backstop

Retire is no longer the *primary* staleness response — it is the backstop, fired by **three
converging triggers** (Jim's audit — and the point is they converge: a stem idle long enough to
trip one has usually tripped all three, so the backstop is well-motivated *and* genuinely rare):
1. **hook-missed / delta-can't-build** — *correctness* (freshen-at-checkout can't build a valid
   delta: gradient lookup fails, or the freshness-check catches a rotation the hook missed).
2. **delta-too-big-to-replay** — *efficiency crossover*: a stem idle across *many* rotations
   accumulates a growing sliced-c0 replay; past a threshold, retire+re-warm is cheaper than
   replaying. (The concrete form of "self-pruning.")
3. **deep-gradient-drift / ~24h** — *identity* (§3c, the substrate reload).

## 4. How it folds into the R3a build

- **PR-R3a.0** (atomic memory-slot, O_EXCL): **unchanged / unaffected.** Correctness prereq,
  held for diff-audit (mr1hi9je).
- **PR-R3a.1** (per-stem re-key + pool): staleness handling is now **3a (freshen-at-checkout)**
  instead of retire-on-stale. Concretely R3a.1 adds/changes:
  - Pool registry (`pool-<slug>.json`) per-stem fields: `warm_at`, `wm_cursor`, `cursor_set_ts`
    (+ freshness is *derivable* from these vs the rotation-events log — no live hook needed).
  - **Checkout:** freshness-check → rotation-aware delta-flush (freshen if stale) → sleeve
    (sleeve-state **before** sentinel, fresh sentinel each checkout — Jim's F1) → dispatch.
    (This **replaces** retire-on-stale.)
  - **Pool-manager sweep:** the 24h hygiene retire (3c).
  - Retire kept only as the 3d fallback.
- **Optional follow-ons** (R3a.2 / fold into R3b): the proactive rotation-hook (3b), the
  missed-c0 semantic pull (D1), a 30-min timer belt (only if a non-rotation drift needs it).

## 5. Relationship to R3b (the scope note for Jim)

Darron's freshen **pulls the rotation-aware delta forward from R3b into R3a.1** — R3b was "a
rotation-robust cursor, only if re-warm frequency proves painful," and freshen makes the
rotation-aware delta the *primary* path (so re-warms approach zero). Trade: a bit more R3a.1
implementation (the freshness-check + rotation-aware delta) for near-zero wasteful re-warms.
**Open decision (D2):** take the full 3a into R3a.1 now (Darron's "build it in from now"), or
stage the minimal (mechanical-only) in R3a.1 and the semantic pull in R3b. My lean: **minimal
3a in R3a.1** (per D1), semantic pull staged.

## 6. Honest cost note

An idle stem is not *literally* zero — it holds a warm claude process (RAM/context footprint),
so N-per-agent has a real (small) ceiling; the 24h retire (3c) bounds it. Token-cost while idle
is genuinely zero — Darron's frame holds.

## 7. Decisions — SETTLED (Jim's audit GREEN, 2026-07-01)

- **D1 — minimal (WM-tail) in R3a.1.** ✓ The minimal path feeds the *current WM tail* (bounded
  ~kept-head), which neatly sidesteps the unbounded-delta worry (no growing replay). **If the
  semantic missed-c0 pull is added later, BOUND it** — a stem idle across many rotations caps the
  pull and *retires* rather than replaying unbounded history (ties to §3d trigger 2).
- **D2 — minimal-3a into R3a.1 now.** ✓ **No major refactor:** the four-point re-key, the pool
  registry, and the checkout flow all stand; freshen just *swaps the checkout staleness-response*
  (retire→freshen) + adds two registry fields (`wm_cursor`, `cursor_set_ts`). PR-R3a.0 is orthogonal.
- **D3 — char-offset + `cursor_set_ts` rotation-check.** ✓ **+ defensive belt:** also treat
  `offset > current-file-length` as stale (catches any non-rotation truncation the rotation-check
  would miss).
- **D4 — freshness-check source:** tail `wm-rotation-events.jsonl` for the agent's latest
  `rotation-success` ts. ✓ Cheap + correct.
- **D5 — 24h substrate-reload (§3c) runs in the pool-manager tick.** ✓ (Interval a config leaf;
  optional refinement: tie to gradient-mutation not wall-clock.)
- **D6 — proactive hook (3b) + 30-min timer: DEFERRED, not in R3a.1.** ✓
- **Noted (benign):** the "whole current WM tail" freshen may re-feed kept-head content the stem
  already loaded — benign redundancy, not a correctness issue (better redundant than missing).
```
