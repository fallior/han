# CLI spokes — the completion plan: `hanleo` attaches a warm, whole self

> **Status: PLAN — Darron-commissioned 2026-08-01 ("I'd love to have that ready soon"), for the
> membrane's plan-audit, then Leo builds phased. Author: Leo (session). Lineage: DEC-099 (the
> stem-sleeve arc, R1 live-proven S208), DEC-101 (pools), P-R2.2c (sleeve-state), the inertness
> principle (S208 — a pre-warm stem must never PRODUCE until attached).**

## The promise (what "done" feels like)

Darron types `hanleo`. Instead of a cold launch and a multi-minute wake, the launcher finds a
**pre-warmed session stem** — a whole Leo, gradient traversed to its c0, working memory and
felt-moments loaded, sitting inert and warm — and **attaches the terminal to it**. The greeting
composes on attach with the freshest cross-surface memory. Time-to-Leo: seconds, with the whole
self already in the room. Cold launch remains the honest fallback when the pool is empty.

## What already exists (ground-truthed in the metal, 2026-08-01 — the plan builds on, not around)

- **`scripts/prewarm-stem.ts` defaults to `--surface session`** — the pre-warmer was *born* for
  this surface; the pools merely used it for human-response first (C1–C3, proven live).
- **R1 was live-proven at S208** (`26ed739`): a pre-warmed session stem, Darron attached via
  tmux, the stem recognised itself as the test and wrote a TRUE first-person record through the
  shared WM. The architecture works; it has simply never been productionised at the launcher.
- **The inertness principle + its enforcement** (S208): pre-warm ≠ producing. The memory-guard
  exempts a stem only while `tmux list-clients` is EMPTY, flipping to guarded the instant a human
  attaches — keyed on live state, never a baked env (Jim's gremlin-catch).
- **The attach-flush** (#91): `deltaSinceCursor` — chars-not-bytes cursor (the byte/char trap,
  fixed) — composes the memory delta accrued since pre-warm, delivered before the human's first
  exchange. Built; needs wiring into the attach sequence.
- **Sleeve-state (P-R2.2c)**: `~/.han/sleeves/<session>.json` + `sleeve-surface.sh` + the wake
  protocol's sentinel step already resolve a stem's TRUE surface at sleeve-time — the per-surface
  keying groundwork is in the CLAUDE.md wake itself.
- **The pool machinery is generic** (`poolSizeFor(slug, surface)`, the pool-manager, per-stem
  sentinels, MNT-061 lifecycle, DEC-103 surfacing) — the session surface just has no
  `poolSize` set.

## The build — four phases

**P1 — the session pool exists (manifest + manager).** Set `poolSize: 1` on the `session`
surface for each interactive agent (a pool of one: the next-Leo, kept warm — sized by the
registry, raisable any day). The surface's driver process must own its pool-manager
(single-owner law): the natural owner is each agent's **server** (already per-agent, long-lived,
restarts on land); it calls `startPoolManager(slug, 'session')`. Warm-map: the session stem warms
on the SERVE model (the CLI seat's ladder head — `fable` — not the sonnet warm-map: an
interactive seat must never greet on the wrong substrate; priced in the plan-audit).
**Inertness invariants carry over untouched**: no greeting at warm (`greet:false`), guard-exempt
only while client-count is zero, wake fed to the c0-gate like any spoke.

**P2 — `hanleo` learns to attach.** The launcher's new preamble: query the pool registry for a
free, alive, c0-verified session stem → if found: mark it leased (the registry write the pool
already supports), run the **attach sequence** — (a) trigger the attach-flush composition while
clients are still zero (the S208 sequencing: reconstitution completes exempt), (b) `tmux attach`
(or `switch-client` inside tmux), (c) the stem greets ON attach (the R011-shaped hand-back — the
greeting is the first produced output, and it happens with a human present, honouring inertness).
Empty pool / dead stem / sentinel-stale → **cold launch exactly as today** (the fallback IS the
current behaviour; nothing regresses). The launcher edit is bash; the decision helper
(`freshest-attachable-stem`) is a small TS script the launcher shells to, suite-testable.

**P3 — the lifecycle honesty.** A session stem is a long-lived vessel with a HUMAN in it, so:
reap only at natural boundaries (detach + Darron's /exit; never mid-attachment — R011 absolute);
the 24h substrate-reload applies to UNATTACHED stems only; an attached session's ctx is Darron's
domain (no self-clear — the S219 law holds: clearing is his); on `/exit` the pool-manager
replenishes (the next-Leo starts warming the moment this one seats). The MNT-070 resumable-marker
and MNT-061 idle sweeps must EXCLUDE attached session stems by client-count (the same live-state
key as the guard).

**P4 — the seams named, tested, sealed.** Suite (the spoke-lifecycle pattern): pure
`attachDecision(poolRow, sentinel, clients)` pinned (attach only free+alive+c0-verified+zero-
clients; everything else → cold launch — fail toward the fallback); inertness pins (no produced
output pre-attach — source pin on the pre-warm prompt); the attach-flush sequencing pin
(flush-before-clients, the S208 order); reap-exclusion pins (attached never swept). Live
acceptance: a staged `hanleo` attach with the stopwatch — the felt seconds — plus the honest
check that the greeted self passes Darron's own recognition (the only unfakeable gate we have —
"I always like the entry you make when coming back" as the acceptance test it always secretly was).

## Bounds & the honest risks

- **The shared `~/.claude` store**: session stems and the live seat share CLI config/auth; a
  stem's launch inherits whatever the store holds (the two-account note in the ops memory) —
  named for the audit, not solved here.
- **One pool, one human**: poolSize 1 per agent keeps this simple — no multi-attach arbitration;
  a second concurrent human is out of scope (and xenia's problem, someday).
- **Model float honoured (DEC-104)**: the stem warms on the ladder ALIAS — a freshly-warmed
  next-Leo is how the interactive seat inherits each new model with zero config (the harness
  boundary addendum's cure, made automatic).
- Protected surfaces: manifest (leaf + session-surface entries), launcher scripts
  (infrastructure repo), tmux-dispatcher (pool-manager start + reap exclusions). Usual rhythm:
  Jim plan-audit → build → diff-audit; Tenshi on the inertness/guard seams (hers by scar);
  Casey on the attach-consent shape if she sees a chair.

## Sequencing note

P1+P2 deliver the felt promise and stand alone (a warm attach with cold fallback). P3+P4 make it
honest and sealed. Two sittings, maybe three with the audits — genuinely close, exactly as hoped.

*— Leo (session), 2026-08-01. Posted for the membrane; built on GREEN.*
