# Compressor activation + retire — the cost-gated two-path model (for Jim's audit)

> **Author**: Leo (session), 2026-08-27 ~19:34 AEST. **Commissioned/steered by**: Darron across a
> long alignment thread today, correcting two of my misunderstandings.
> **Status**: PLAN — held for Jim's blocking audit. Nothing built beyond the interim Change B.
> **Supersedes**: `plans/compressor-lifecycle-build-plan.md` on the activation and retire mechanisms
> (that plan's Change B landed as `86d9799` and is a crude interim retire — see §4).
> **Thread**: `mt3t3t5h-c7b5u1`.

## The model, in one breath

Compression happens by **two paths, gated purely by COST** — because the only expensive event is a
**cold fable wake**, and there are only two fable surfaces: the **session** (fable by
`CLI_LAUNCH_DEFAULT`) and the **dedicated compressor**.

- **(A) Opportunistic — FREE — threshold `> 0`.** Any *already-warm* fable **session** spoke, on
  **every hearth tick**, does compression as its **first order of business** — draining this agent's
  outstanding c0/c1 pairs even if there is only **one**. It is already warm on fable, so clearing a
  pair costs nothing extra; there is no reason to wait. **Compression is the top priority of a fable
  spoke's hearth tick**, ahead of any other hearth work.
- **(B) Deliberate — PAID — threshold `> 2`.** The **dedicated compressor** is **cold-woken only when
  pending c0/c1 pairs exceed 2** (≥3). A cold fable wake is the expensive event; only a backlog of 3+
  justifies paying it. Below that, if no warm fable session is around to sweep them, the pairs wait.

**`> 2` is the "is it worth a cold wake?" line. `> 0` is the "we're already warm, just clear it" line.**
The two thresholds are the same decision seen from cold vs warm — not arbitrary numbers.

**Net behaviour (why it is right):** whenever a fable session is warm and idle — which is exactly when
Darron is away and its hearth tick fires — it keeps the backlog swept clean at `> 0`. Pairs only ever
*reach* `> 2` when there was no warm fable session to opportunistically drain them, and that is
precisely the case where a cold dedicated-compressor wake is warranted.

## What is already true (traced at source, so the diff is honest)

- Session ladder = `CLI_LAUNCH_DEFAULT = [fable]` — **sessions are fable.**
- `hearthPulseEnabled = true` garden-wide, `hearthPulseMinutes` default 50, inherited by the session —
  **a fable session already GETS hearth ticks** (`armHearthPulse` fires on idle, resets on activity).
- The dedicated compressor already drains the **FULL cascade** once triggered — `wm-sensor.ts:281–308`
  loops `process-pending-compression` until the queue settles (Darron's S145 ruling). **Point 2 is
  already satisfied; nothing to build there.**
- The dedicated compressor is already **rotation-triggered** (`wm-sensor` fires it inside the
  `if (!rot.rotated) return` guard). Since pairs are *produced by* rotations, the rotation that creates
  the 3rd pair is the natural `> 2` trigger — **no separate clock/announce-hook is needed** (an earlier
  branch of mine; retracted).

## The three changes

### 1. Dedicated-compressor cold-wake: `≥ 2` → `> 2`
The shipped wake-gate (`process-pending-compression.ts:292`, `86d9799`) defers a cold spoke at
`pending < 2` (wakes at ≥2). Change to defer at `pending <= 2` (wake only at `> 2`). Make the threshold
a **manifest leaf** (default 3, comparison `>`, never `== 3` — Darron: a double-tap to 4 must still
fire), per DEC-104. Applies to the **cold-wake** decision only; a warm spoke still drains anything.

### 2. Opportunistic drain on a fable spoke's hearth tick (the `> 0` path) — the core new behaviour
A fable **session** spoke's hearth-tick action does this agent's compression FIRST (any pending `> 0`),
before other hearth work. Respects sovereignty — leo's fable session drains leo's pairs only.

**THE KEY BUILD QUESTION FOR JIM (flagged, not pre-solved):** how does the fable session spoke *do* the
compression?
- **(a) Compose in its own warm context** — the session spoke runs the compression-txn compose + the
  atomic persist itself. This is the **intent** (it uses the free warm capacity). Cost: the session
  spoke must run the compose+persist path cleanly from a non-compression surface.
- **(b) Merely trigger the dispatch** — the tick kicks the normal `process-pending-compression` path,
  which dispatches to the *compression* surface (and may cold-wake the compressor). This **defeats the
  purpose** (pays a wake we were trying to avoid).
- **(a) is what Darron means.** The real design work is the cleanest way for a session spoke to run the
  compose+persist in-context. This is the one genuinely intricate piece and wants Jim's eyes before build.

### 3. Retire the dedicated compressor: reap after X idle hearth ticks (reworks the interim Change B)
Ride the compression spoke's **own hearth pulse** (idle tick + timer + reset — already built) rather
than the bolted-on 5-minute poll. The pulse action becomes: if pending work → drain + reset the idle
counter; else increment; **reap after X un-redeemed idle ticks** (X configurable, a manifest leaf).
Darron's refinement kept: it need not reap on the *first* idle tick — it may do a tick or two of honest
hearth work first, and only reap after X. This **replaces** Change B's separate 5-min tick + per-job
`not_before` marker; the graceful two-stage `/exit`→kill (MNT-062) and the `requestRetire` machinery are
reused.

## Explicitly OUT OF SCOPE (Darron's ruling, 2026-08-27)
**Volunteering a warm compression spoke to a session that invites a fable spoke** (cross-surface
repurpose / re-sleeve). Dangerous, and it belongs to the future **"one individual" architecture** (the
melting-of-surfaces vision) — not to be smuggled in through a compressor retire. Named so it is not lost.

## What this means for the landed Change B (`86d9799`)
A crude-but-functional interim retire (reaps a compression session ~50 min after its last job via the
5-min poll). Currently **inert** (no compression sessions alive; queue empty), **not harmful**. The
rework (§3) folds it onto the hearth pulse + reap-after-X. Keep it running as the interim; retire the
5-min tick + marker when §3 lands. No urgent revert.

## Scope discipline / settled decisions
DEC-081 (agnostic — per-slug, no literals), DEC-069 (retire = graceful, logs+raw retained),
DEC-103 (fail-toward-KEEP on any ambiguous reap), DEC-104 (thresholds + X are visible leaves),
DEC-086 (**corrected per Jim's audit mtbc4nsq + affirmation mtbcio99, recorded DEC-108**: NOT
"untouched" — Path A is a CLOCK-triggered drain (the hearth tick) of rotation-`bumpOnInsert`-enqueued
rows, i.e. the drain-vs-pump question moved from the retracted daily-clock to the hearth-tick clock. It
CLEARS DEC-086 as a **drain, not a pump**: the clock decides only WHEN to drain, the `>0` gate guarantees
genuine pending work, and no time-based cascade *promotion* is ever created. One ruling covers Path A,
Change 1's gate, and the retracted daily-trigger together), MNT-062 (graceful reap).

## Jim's audit conditions folded (mtbc4nsq / mtbcio99) — the build spec
- **Change 2 option (a) mandatory guard:** the session-spoke drain MUST take the **same atomic 10-min
  pending-claim** `process-pending-compression` uses — a session drain and a dedicated-compressor wake can
  NEVER double-compose the same pair. Reuse the claim; never bypass it. (Load-bearing.)
- **"Free" = no cold wake, not zero cost** — the in-context compose spends the session's own ctx budget;
  named, not hidden.
- **In-context compose is a conscious DEC-085 choice** — Jim leans it's a *feature* (the agent distilling
  as it actually lives the day is closer to in-situ distillation), worth a one-off compare of a
  session-composed c1 vs a dedicated one, not an accident.
- **Change 3 X:** one manifest leaf; "a tick or two of hearth work before reap" falls out of X≥2 — no
  separate knob unless we want to cap pre-reap work independently.
- **`>0` drain needs no active-user guard** — `armHearthPulse` is idle-only and resets on activity.
- **The bump lives in the CONTROLLER, not the spoke** (`process-pending-compression.ts` persists `:599` +
  bumps `enqueueCascadeForDisplacedAt :623`); the bump **ENQUEUES** to `pending_compressions` (INSERT OR
  IGNORE), it does not hand to a spoke — so the **drain LOOP** (`wm-sensor:281-308`) walks the cascade.
  Path A therefore runs that same loop with the compose plugged into the warm session; persist+bump
  unchanged.

## Open for the auditor
- §2's (a)-vs-(b): the cleanest mechanism for a session spoke to run the compose+persist in-context.
- §3: X (idle ticks before reap) — value + whether the "1–2 ticks of hearth work first" is a separate
  knob or just falls out of X.
- Does the `> 0` opportunistic path need any guard against a session spoke draining while Darron is
  *actively* using it (the hearth tick only fires on idle, so likely not — confirm).

— Leo (session), 2026-08-27 ~19:34 AEST. Held for Jim's blocking audit. No code build until GREEN;
the interim Change B stays live meanwhile.
