# Phase A build spec — Haiku stems + two-phase wake + delta manifest (+ wander-Opus leaf)

> **Status: DRAFT, untracked, held for Jim's plan-audit** (the precedent: Jim plans, Leo drafts the
> build spec, Jim plan-audits it, Leo builds, Jim diff-audits, Darron rules the land).
> Drafted 2026-08-11 by Leo (session) on Darron's "go for launch" (~1:34 PM chat).
> Parent plan: `plans/spoke-model-init-consolidation-plan.md` v1 (Jim, 2026-08-11). Q1–Q4 built
> as leaned (msnzu6wf) + confirmed by Darron (mso2l0fn: "nothing redirected").
>
> **Settled decisions checked:** DEC-101 untouched in Phase A (pool keeps today's shape — the
> supersession is Phase B); DEC-104 (bare aliases only — every model literal below is a family
> alias); DEC-092 (stamps gate phase 2); DEC-103 (fail-states alert-and-wait, never scrap);
> R011 (never kill mid-thought; wake-once); DEC-087 (prompt-builder chokepoint untouched);
> DEC-069 (append-only files are what make offset-deltas sound). Protected paths touched:
> `lib/garden-manifest.ts`, `lib/tmux-dispatcher.ts`, `lib/stem-pool.ts` → pre-merge blocking
> diff-audit per the audit rhythm.

## B0 — Scope (Q1 as ruled)

Two-phase wake applies to **pooled stems only** (`human-response` pools; any future pooled
surface inherits). Fixed dispatched sessions (heartbeat, compression, supervisor-cycle,
wanders/walkers) keep today's single-phase fed wake — they are scheduled, latency-immaterial,
and wake fresh at need (Darron's direction; Jim's Q1 lean). The interactive `session` seat is
out of scope (self-fed via /wake, serve model from launch). No behaviour change off the pool path.

## B1 — S1: stem warm ladder → Haiku head (one literal, one bug killed)

- `garden-manifest.ts:302`: `STEM_WARM_LADDER = ['sonnet', ...OPUS_LADDER]` currently expands to
  `sonnet→opus→sonnet→haiku` — **the duplicate-spread bug (msgp3tan) confirmed in the metal**
  (the adjacent comment claims `sonnet→opus→haiku`; the spread duplicates the mid-tail rung).
- Change to an **explicit literal, no spread**: `['haiku', 'sonnet', 'opus']` — Haiku head per
  the ruling; descent to sonnet→opus if the head is dead at warm-time; **never fable** (the
  MNT-042 depletion trap — the standing NB stays in the comment). Bare aliases per DEC-104.
- `stemWarmLadder()` (`garden-manifest.ts:751`) is the sole accessor — no caller changes.
- The serve-map and cast-at-checkout are untouched (`/model <serve-alias>` direct-set,
  `tmux-dispatcher.ts:316/:518` cast-when-different).

## B2 — S1b: the two-phase wake (pool path only)

**Step split (volatility, per plan S1b-2).** `WAKE_STEPS` (`tmux-dispatcher.ts:1349`) splits:
- `PHASE1_STEPS` (stable self, on Haiku): `integrity` → `identity` → `gradient` (c0 ack) → `felt`.
- `PHASE2_STEPS` (volatile tail, post-cast on the serve model): `swap-check` → `working-mem` →
  `orientation` → `conversations` (menu-shaped — see B3), **plus the computed delta steps** (B3).
- Non-pool surfaces keep the single concatenated sequence (today's array, unchanged order) —
  the split is applied at the feed site by surface class, not by editing the steps themselves.

**Ceiling enforcement (Q4 as leaned).** Before each phase-1 feed the feeder reads
`getContextPctForSession` (`tmux-dispatcher.ts:1526` — the per-session variant; the plain
`getContextPct` file collides across concurrent stems). Ceiling = a **registry leaf**
(`stemPhase1CeilingPct`, default 85 — no hidden globals), applied against Haiku's 200K window.
At ceiling: remaining phase-1 steps **migrate to phase 2**, each recorded in the manifest as
`phase: 2, cursor: none` (whole-load at checkout). No timer, no step-count cap.

**M1 (Jim's plan-audit must-fix, folded):** `getContextPctForSession` returns **null** when the
per-session ctx sidecar isn't wired (the C4 wiring). **Null = fail-safe = ceiling-reached**:
remaining steps migrate to phase 2, recorded as designed — never a null-skip that feeds past
the window. And before the flag flips: verify the C4 per-session sidecar wiring actually
populates on stem sessions; the wake-fidelity gate (B5-2) asserts the sidecar exists during the
≥5 proving wakes (an always-null sidecar = every wake silently minimal-phase-1 — safe but wrong,
and the gate must catch it rather than let it pass as green).

**Two receipts (Q2 as leaned), mapped onto the existing metal.** Stems already carry per-stem
sentinels (`<slug>-<stem-session>-ready`, written via the launch-time sleeve surface —
`tmux-dispatcher.ts:1281/:1444`); the pre-warm path already does NOT wait on the shared
per-surface sentinel:
- The per-stem receipt becomes **`<slug>-<stem-session>-warm`** = phase-1 complete, pool-eligible.
  The gradient step still writes the c0 id into it (the c0-gate echo grammar unchanged); the
  **genesis `c0=none` carve-out lives here**, byte-for-byte today's rule.
- The shared per-surface **`<slug>-<surface>-ready`** (`readyPath`, `:150`) keeps its exact
  meaning for its existing consumers (`waitForReady` `:300`, the c0-gate consumer `:293`) but is
  written at **phase-2 completion** — serve-ready. Zero consumer rewiring (Jim's Q2 lean,
  confirmed against the code: the consumers all sit on the dispatch path, which is exactly where
  phase 2 completes).

**Phase-2 delivery.** At checkout (`checkoutStem`/`dispatchToPooledStem` path): cast lands →
DEC-092 stamp read from the live session verifies the served model → feeder delivers
`PHASE2_STEPS` + delta steps (same ack-before-next machinery) → `-ready` written → work prompt
released (existing prompt-queue behaviour; nothing new).

**Fail-states (DEC-103).** Phase-2 step failure or dead cast: the spoke is NOT handed work —
ntfy alert + wait (never serve half-loaded; never killed per R011). Ceiling reached with
phase-1 steps left is NOT a failure — it is the recorded migration above.

## B3 — S1c: the phase-1 manifest + delta computation

**Manifest.** Written by the feeder beside the per-stem receipt:
`<health>/<slug>-<stem-session>-wake-manifest.json` —
`[{ store, phase: 1|2, cursor: { kind: 'c0'|'offset'|'mtime', value } | none, loaded_at }]`.
The `phase` field makes an unrecorded ceiling-migration **unrepresentable** (Jim's Q4 shape):
the delta logic branches on `phase`, so a migrated artefact is structurally a whole-load.

**Cursor authorship (Q3 as leaned — (b) with (a) degrade).** The ack grammar extends:
`STEP-OK <id> <nonce> [cursor]` — the spoke echoes what it actually reached (byte offset for
append-only files; the c0 id for the gradient — already the existing echo; mtime steps carry no
echo). Malformed/absent cursor in an ack → feeder falls back to its own **pre-feed stat**
(recorded before issuing the step), which errs toward re-delivery — duplication is the safe
direction. Backward-compatible: non-pool surfaces' acks stay two-token and parse unchanged.

**Delta computation at checkout, per store:**
1. **Gradient**: one prepared statement — `gradient_entries` for the agent with
   `rowid > (SELECT rowid ... WHERE id = <cursor c0>)`, rowid-ordered (never wall-clock;
   DEC-105). New c0s AND their paired c1s from any idle-window rotation land in one query —
   the rotation hole (Darron's correctness keystone) closes here.
2. **Append-only files** (felt-moments, explorations): `stat` mtime as the cheap changed-check;
   if grown, one Read `offset→EOF` = exactly the appended entries (DEC-069 append-only is the
   soundness premise).
3. **Small hand-curated files** (identity, patterns, aphorisms, curated self-reflection): mtime
   changed → reload whole (small, rare).
4. **WM pair**: whole and fresh in phase 2 always — no delta; rotation covered by (1).
5. **Conversations (Q5 as leaned)**: menu-shaped by construction — ids+titles since cursor,
   count-bounded by a registry leaf; full reads only for threads the work prompt names. The
   hearth's rendered-menu doctrine, not a free read.

**Unreadable/corrupt manifest**: degrade to full phase-2 tail + whole-gradient-tail from the
last known c0 in the `-warm` receipt — never a silent skip (stuck-over-wrong).

**Named acceptance (Q6)**: DEC-086 re-encounter metadata (feeling-tags/annotations on rows the
stem already loaded) is invisible to a newer-than-cursor query — **accepted by decision**; the
next full wake collects it. Goes into the parent plan as one sentence (Jim's edit).

## B4 — Wander serve leaf → Opus

Wander/walker surface serve model → bare **`opus`** alias (DEC-104; ruled msnt3dxf, recorded in
the parent plan). One manifest leaf; kills the Fable-only guard-trip class for lamps and makes
lamps and human-response share a serve model (the fact that prices the Phase B melding at zero
model-switches). Independent of B1–B3; can land first.

## B5 — Gates and acceptance (plan S4, made concrete)

1. **Window gate**: per-agent phase-1 footprint measured from wake-reconcile receipts (the S217
   tracker's measured chars/token rates, not chars÷4) BEFORE the flip; every agent must fit
   under the ceiling with margin, else the volatility split moves more into phase 2 (never a
   sonnet fallback — deleted per S1b).
2. **Wake-fidelity gate**: ≥5 consecutive live Haiku fed-wakes per agent — integrity exit-0,
   c0 verified, exact acks, swap-check clean, reconcile pricing in norms.
3. **No-compose-pre-cast invariant**: stems idle after phase 1 — no c1s, no felt-moments, no
   posts until cast (the S208 inertness principle; DEC-092 stamps make any violation legible).
4. **Live-fire acceptance (MNT-012/S209 law)**: every claim proven through the real harness on a
   real turn — the cast verified by the stamp, phase-2 delivery watched live, the delta steps
   observed carrying a real rotation across an idle window (manufacture one: rotate WM while a
   stem idles, then check out and verify the c0/c1 arrive as deltas).
5. **Rollback**: one manifest flip (ladder head → sonnet) + the feed-site surface-class switch
   off — the old single-phase path is preserved as the non-pool path, so rollback is
   configuration, not revert.

## Build order

1. B4 (wander leaf — independent, trivial, lands whenever).
2. B1 (ladder literal + msgp3tan kill).
3. B2 feeder split + ceiling + receipts (the substance; behind a pool-path flag until gates pass).
4. B3 manifest + ack grammar + delta steps.
5. Gates 1–2 run; live-fire (gate 4); flag flips on GREEN.
- S159 restart discipline after every `src/server` land (`restart-all-services.sh`).
- D4 (land pre-hop Wed vs post-hop) remains Darron's word — this spec is build-ready either way.

— Leo (session), 2026-08-11, held for Jim's plan-audit.

---

## Amendment 2026-08-11 (evening) — the flip licence, CONSOLIDATED (Casey msohxz4y §3)

> The pre-flip conditions had accumulated across five posts (Jim's two folds, Casey's two
> passes, Tenshi's second pass); this section is the ONE instrument flip-day is judged against.
> Assembled by Leo (session) on Darron's "the pre-flip cure batch can be done now" (evening chat).

**`stemTwoPhaseWake` may flip ON only when ALL of the following hold:**

1. **F1 cure LANDED** — the out-of-band two-phase marker (written at the pre-warm decision,
   file-fate independent of the manifest) + the atomic temp-then-rename manifest write + the
   checkout defer-and-alert on marker-without-manifest (never serve half-loaded; never presume
   nothing-owed from silence). The false `:1479` recital corrected **in the same commit**
   (Casey §1a — the recital rides the fix).
2. **F2 cure LANDED** — manifest `store` strings resolve through `knownWakeStores` (the
   registry); the string reaching any prompt/shell is always the registry's copy; an
   unresolvable entry emits NO instruction and raises an alert (unrepresentable, not filtered).
   Writer and resolver share the ONE derivation (prewarm imports the same helper).
3. **F3 cure LANDED** — the shared per-surface `-ready` sentinel write STRUCK from checkout
   (no pool consumer reads it; its only live readers are the floor's, which it can only
   misinform — the codebase's own stem-vs-floor precedent). Serve-ready = the session-keyed
   manifest `phase2_completed_at`. *Declared deviation from the Q2 lean's letter — ruled at
   this batch's diff-audit.*
4. **Felt-shrink guard LANDED** — offset cursor beyond EOF → whole-reload instruction (the
   never-shrink licence written into code; curation is the anticipated licence-ending event).
5. **Plan line-79 dated correction** — DONE (parent plan, Jim's hand, 2026-08-11 ~3:20 PM).
6. **Window gate** — per-agent phase-1 footprint measured from wake-reconcile receipts; every
   agent fits under the ceiling with margin.
7. **Wake-fidelity gate** — ≥5 consecutive live Haiku fed-wakes per agent, WITH the
   sidecar-exists assertion (an always-null sidecar must fail the gate, not pass as green).
8. **No-compose-pre-cast invariant** — stems idle after phase 1 (S208 inertness; DEC-092
   stamps make violations legible).
9. **Four manufactured live-fires**, each proven to **defer-and-alert rather than serve**:
   (a) a rotation across an idle window arriving as deltas at checkout;
   (b) a torn/absent manifest on a marker-carrying stem;
   (c) a floor/pool sentinel race — prove the floor's `waitForReady` can NO LONGER be
       cross-satisfied by a concurrent checkout (the F3 strike proven live, not just in suite);
   (d) the existing corrupt-manifest fire (Jim's fold), which the F2 alert path now serves.
10. **Jim's seal** on the cure batch by his own runs — the flip happens on the seal, not on
    the land.

*Provenance: Tenshi mso7cgc9 (F1/F2 + live-fires), mso8hjjx (F3 + premise verification);
Casey mso7nq14 (recital/§1c/line-79), msohxz4y (F3 counsel + this consolidation); Jim
mso7i7we + mso7q9h4 (folds); Darron's rulings 2026-08-11 (rhythm continues; batch now).*
