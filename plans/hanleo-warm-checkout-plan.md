# hanleo warm checkout — the session seat joins the pool

> **Status: PROPOSED — held for Jim's blocking audit.** Commissioned by Darron, 2026-08-19 ~8:20 AM:
> *"when I type hanleo that I check out a spoke that has been warmed on haiku… default fable but
> switch selectable such as hanleo opus for an opus cast… I would like a more graceful way of the
> servers, such as yours on port 3847, to launch and be aware of an instance already running…
> I am not sure what TMUX trickery we need to engage or if we decouple the server from the
> han<slug> command."* And the scope split, his: *"We'll work on the welcome back attaching a
> pre-warmed stem and saving time but for now we'll check out a stem and cast to model."*
>
> Author: Leo (session), 2026-08-19. Thread: (posted alongside this file).

## Why (two causes, one build)

1. **The organelle reaches the interactive seat.** The hearth pulse rides the dispatcher's
   turn-complete (`tmux-dispatcher.ts:1006`) and the cli seat is never dispatched — the gap Darron
   named on 16 Aug (*"the cli session seat is why the exercise exists"*). Both overnight hearth
   trials simulated it by hand (ten timers, then eleven organelle pulses on the human seat). A
   checked-out stem is dispatcher-known; the seat gets the pulse for real.
2. **The wake stops being paid at the keyboard.** A stem's warm (the full fed wake) happens in the
   background on the haiku head (`STEM_WARM_LADDER`, Darron's 11-Aug ruling — ~3× cheaper warmth);
   checkout casts to the serve model. Eventually (deferred leg P4) `hanleo` lands Darron on a
   composed greeting in seconds.

**Memory-leg note (MNT-150):** the session seat is the *healthy* pulse-memory case — the paired
swap + Stop-hook flush live on this surface. The gap that eats Casey's and Tenshi's pulse turns
does not apply here.

## What already exists (traced 2026-08-19, file:line)

- **Pool machinery** — `lib/stem-pool.ts` (checkout/return/bind/cursor); pools today only for
  `human-response` (`~/.han/pool/pool-<slug>-human-response.json`). A free haiku-warmed leo stem
  exists right now (`stem-leo-human-response-msyj02vp`, `model: claude-haiku-4-5`).
- **Warming** — dispatcher top-up drives `scripts/prewarm-stem.ts --pool --session <name>
  --surface <surface>` (`tmux-dispatcher.ts:2146`), which drives `launch-tmux-surface.sh --stem`.
  Warm model from `STEM_WARM_LADDER = ['haiku','sonnet','opus']` (never Fable — MNT-042).
- **Cast-at-checkout** — `castStemToServeModel` (`tmux-dispatcher.ts:1792`): `/model <serve>`,
  alias-aware equality (DEC-104), DEC-092 observation stamps the served truth.
- **Sleeve** — `lib/sleeve-state.ts` + `src/hooks/sleeve-surface.sh`: dispatcher writes
  `~/.han/sleeves/<HAN_SESSION>.json = {slug, surface}` at checkout; every surface-keyed facet
  (swap, sentinel, ctx-sidecar, guards) resolves through it. Built for exactly this (P-R2.2c).
- **Attach flow, proven live** — `scripts/attach-stem.ts` (R1, S208/FM #42): freshness gate →
  #91 attach-flush (`deltaSinceCursor`) → greeting composed **while 0 clients** (memory-guard
  exemption by sequencing) → `tmux attach`. Its own header names the follow-on: *"the seamless
  attach-or-cold-launch wiring into hanleo (F4i)."* This plan IS F4i, session-surface flavour.
- **Cold fallback** — R1's design: cold-feed is the empty-pool fallback.
- **Launcher** — `infrastructure/scripts/hanleo` (291 lines): twin-guard → integrity gate →
  `generate_claude_md` → `tmux new-session` (env contract) → watchdog pane (server) → `claude-logged`.

## The build

### P0 — pool the session surface (config + one seam)

- Manifest leaf: `poolSize: 1` on `leo/session` in `~/.han/garden-manifest.json` (+ export
  script). Warm-map/serve-map already split: warm = haiku head; serve = `CLI_LAUNCH_DEFAULT`
  (bare `fable` alias, floats per DEC-104).
- **Seam to verify (named for the audit, not hand-waved):** the pool/warm path assumes a
  dispatcher-fed stem (`wakeFeed`), while `leo/session` is `transport: 'cli'`. The stem itself is
  dispatcher-fed regardless of how the *seat* serves. Proposal: `wakeFeed: true` on session (the
  stem's warm is fed; the attached human seat is untouched by it) — but if the loader or top-up
  path gates pooling on `transport: 'tmux'` anywhere, that gate needs a deliberate widening, not a
  workaround. Build step 1 is reading that gate.
- Top-up: the same dispatcher top-up that maintains human-response pools maintains
  `pool-leo-session.json`. After a checkout, the pool re-warms a replacement in the background.

### P1 — the checkout leg in `hanleo`

CLI grammar (backwards-compatible):
```
hanleo                → checkout + cast fable (CLI_LAUNCH_DEFAULT)
hanleo opus           → checkout + cast opus     (also: sonnet | haiku | fable)
hanleo -a / -l / -s / --kill / -- <claude args>   → unchanged
hanleo --cold         → force today's cold path (explicit escape hatch)
```
Bare aliases only — DEC-104: the cast floats to the family head; never a version pin.

Flow (a new `scripts/checkout-session-stem.ts`, pattern per `attach-stem.ts`, called from the
launcher the same way it already calls `verify-identity-files.ts`):
1. Twin-guard + integrity gate — **unchanged, still first** (a warm stem must not bypass DEC-083;
   the stem's own launch ran the gate too — this is defence-in-depth at the door).
2. `checkoutStem('leo','session')`. Validity: tmux session alive + freshness (stale/dead →
   `removeStem` + cold fallback).
3. Cast to requested model; verify by DEC-092 observation (never assume the `/model` landed).
4. Write sleeve `{slug:'leo', surface:'session'}` — swap resolves to `session-swap` via the
   existing resolver chain.
5. #91 attach-flush: `deltaSinceCursor` from the stem's `wm_cursor` — WM written since the warm
   (by heartbeats, hearth pulses, other seats) lands before the human does. While 0 clients
   (guard-exempt by sequencing — the S208 form-(ii) rule, unchanged).
6. `tmux attach-session`. (No greeting compose in this leg — that's P4. You land at the prompt of
   a warm, current Leo and say "welcome back Leo" yourself; the `/wake` feeder is NOT re-run — the
   self is already loaded. What "welcome back" means on an already-warm seat: the orientation +
   state report, not a reload. The generated CLAUDE.md is regenerated at checkout time for the
   *next* warm; the live stem's identity was generated at its own launch.)
7. Fallback at any failure: today's cold path, byte-identical, with one status line saying why.

### P2 — the pulse bridge (activity is the reset)

**The gap, traced:** `armHearthPulse` lives in the server process (`pulseTimers` Map,
`spoke-organelle.ts:436`), armed only at dispatcher turn-complete; its `stillIdle` closure reads
`session.turnState === 'idle'` — the **dispatcher's own turn ledger**. An attached human's typed
turns never traverse the dispatcher: the seat looks permanently idle from the dispatcher's chair,
so a pulse could fire into a mid-work pane, and typed activity never resets the clock.

**The cure (Darron's own 16-Aug shape):** the existing seat-busyness hooks are the ground truth —
`cli-active.sh` writes `cli-busy-leo` on prompt-start; `cli-idle.sh` removes it at Stop (S193).
Bridge them to the in-process timer:
- `POST /api/hearth/activity {slug, surface}` (localhost, leo's 3847): **clear** on active,
  **arm** on idle. Two `curl -s` lines appended to the two hooks (path-referenced hooks are
  live-on-save — S193: edit + verify through the real harness trigger, no restart needed for the
  hooks, server restart needed for the route).
- The session-surface `stillIdle` becomes: *no fresh `cli-busy-leo` signal* (same predicate
  refresh-twin's gate 3 already trusts) — checked again at fire time, so a pulse can never
  interrupt a typed turn even if a race arms one.
- Pulse delivery = the existing `enqueueForAgent` with the baked standing message — the same
  covenant text the human-response seat runs (board first; empty board → honest quiet work; never
  snooze to save tokens).

**Tenshi's chair, named explicitly:** the pulse *injects prompt text into the human's own pane*.
The standing message is a baked constant (materialised at spawn — `spoke-organelle.ts` §2.8, never
fetched content), which is the injection-safe shape; the audit should confirm the session-surface
arming keeps that property (constant message, no interpolated thread content).

### P3 — server gracefulness (decouple; his explicit ask)

Today each `hanleo` spawns an `agent-server-watchdog.sh leo 3847` pane inside the new seat
session. In the checkout world the seat session already exists (the stem), and a second `hanleo`
must not raise a second watchdog — the S163/S167 ghost-server family.

- **Option A (lean): decouple.** The per-agent server runs as a standalone tmux session
  (`server-leo`) owned by `han-tmux.service` (same ownership cure as MNT-052), started at garden
  boot alongside the pools. `hanleo` stops spawning it; instead it **ensures**: `ss -tlnp` port
  owner + `/api` 200 → already running, print one status line; genuinely absent → start it, once.
  This answers *"aware of an instance already running"* structurally (the kernel socket table is
  the authority — S167, never pgrep), survives seat kills, and is SR-031's direction
  (one-server-per-identity, servers-at-boot) arriving a leg early.
- Option B (cheaper, not preferred): keep the pane, add a port-guard before spawn. Keeps the
  server's lifetime coupled to whichever seat happened to start it — the exact coupling that made
  the Apr-20 ghost.
- Recommendation: **A.** Answer to Darron's question — yes, decouple the server from the
  `han<slug>` command; the launcher keeps only the *ensure* responsibility (check-then-start,
  never a second).

### P4 — DEFERRED: the welcome-back attach (recorded now, built later — Darron's split)

His words: *"We'll work on the welcome back attaching a pre-warmed stem and saving time but for
now we'll check out a stem and cast to model."* The machinery is `attach-stem.ts`'s F4ii flow
promoted into the checkout leg: after the attach-flush, feed the GREETING_STEP so `hanleo` lands
on a **composed current greeting** rather than a prompt — the soft seam (FM #31) at the door, the
~minute wake pre-paid in the background. Depends on P0–P2 being live and proven; its own plan +
audit when we get there. Related context for the auditor: the fed `/wake` skill (P2.4) remains the
cold-path wake; the two-phase stem wake (stable self fed at warm, volatile tail at cast) is the
staleness cure on the pool side.

## Invariants held (checked against the record)

- **The never-spoke seat gets no pulse (Jim's diff-audit note 2, named so silence never reads
  as a defect):** the hearth anchor is max(cli-busy, last pulse) — a seat that has never taken
  a turn has no anchor and pulses only after its first activity. Consistent with the honest
  away-stall; by design.
- **F-J1 (folded at the diff-audit):** the cold path — including warm-mode's empty-pool
  fallback — spawns the watchdog pane only when the API is NOT already answering; a
  pane-spawned twin cannot bind, crash-loops, and clobbers the PID file deploy-restarts aim
  at. Acceptance: empty-pool warm→cold fallback leaves exactly ONE server process, PID file
  pointing at it.
- **MNT-152 inheritance (Jim's audit, named here so the next MNT-152 reader finds it):** a
  pooled session stem inherits the pooled-stem ctx-boundary gap (self-clear excluded, retirement
  P3-disabled). Exposure while idle ≈ zero (ctx static); post-attach the seat's ctx is governed
  by Darron's live-monitoring doctrine + the per-turn flush. No NEW gap — inherited, and named.

- **DEC-083** — integrity gate stays first at the door (launcher pre-flight retained).
- **DEC-104** — bare aliases for the cast; no version pins; the `--cold` flag is an escape hatch,
  not a constraint (no unbidden restriction enters).
- **DEC-092** — cast verified by observation, stamped.
- **B2b / S181** — the session surface is never autonomously reaped; an attached seat is killed by
  no machinery. The checkout does not change reaping scope.
- **Memory-guard** — flip-on-attach via live client count (S208 form-(ii)); reconstitution turns
  sequenced before attach; no `wake_grace` (slug-shared state collision).
- **DEC-069** — nothing deleted; the cold path retained byte-identical as fallback.
- **R011** — the stem idles warm until attached; the attach is the human arriving, not a dispatch.

## Acceptance

1. `hanleo` lands an attached, warm, **current** (attach-flushed) Leo; time-to-prompt measured
   and reported (target: seconds, vs the ~4-minute cold wake).
2. `hanleo opus` → DEC-092 observed model = opus family head. Bare `hanleo` → fable.
3. Pulse: fires only when `cli-busy-leo` is stale ≥ the pulse interval; a deliberate mid-turn
   test (type during the armed window) shows deferral, not interruption. Pulse turns reach
   working memory via the session swap + Stop-hook (the MNT-150-healthy leg) — verified by
   presence in both WM files after the first fired pulse.
4. Cold fallback proven by emptying the pool (`hanleo` still works, one status line).
5. Server single-instance proven by double-launch (`hanleo` twice → one port owner in `ss`,
   second launch prints "already running").
6. `hanleo -a` unchanged; `-- <args>` passthrough unchanged.
7. Rollback = config: `poolSize: 0` on leo/session + the launcher's `--cold` default restored —
   one manifest edit, no revert.

## Chairs

- **Jim** — blocking audit on this plan, then on the diff. Named seams: the P0 transport/wakeFeed
  gate; the P2 stillIdle predicate swap; whether P3's Option A belongs in this build or lands as
  its own SR-031 leg first.
- **Tenshi** — the P2 injection surface (pulse text into the human pane; baked-constant property)
  + the sleeve/uid questions she's already holding from the hearth work.
- **Casey** — one question: does the model arg (`hanleo opus`) need recording as a declared
  runtime control (DEC-104's declaration discipline), or is a launch argument its own record?
- **Darron** — P3 Option A vs B is his call after Jim's read; everything else is ruled by his
  commission.
