# MNT-009 COMPLETION — Concurrent Controller + Native-Surface Pools (R3c) — DESIGN

> Status: **DRAFT for Jim's plan-audit** (2026-07-03, S212 night). Darron's directive: native-per-surface
> pools ARE the direction ("most efficient"); design next steps to completion, folding the identified bugs.
> Companions: `pr-r3a1-plan.md` (the pool substrate, built+committed+inert), `warm-stem-freshness-plan.md`
> (settled), thread `mqvs3r6l-dk71d2` msgs 156-159 (the live-prove finding + Jim's read).

## Goal — MNT-009 to DONE
Two human messages on two threads, seconds apart → **two concurrent leo dispatches on two distinct warm
stems, neither waiting on the other, shared WM intact.** The R3a/R3b substrate (atomic slot, per-stem
re-key, per-stem diary-key, checkout/adopt/freshen) is committed + proven sound; what remains is the
**sending side** (the controller serialises + drops) and the **stem model** (native-per-surface).

## Settled by this design (the two open questions)
1. **Darron's directive + my concurrence:** pool stems go **NATIVE-per-surface** — born as their surface
   (`AGENT_SURFACE=human-response` at launch), never session-stems sleeved over. Jim's two real reasons:
   baked-env cleanliness (the sleeve remaps files, not launch-frozen behaviour) + independent demand
   profiles (human-response reactive/bursty wants N; session is one seat). Idle-tmux cost ≈ 0 on 64GB.
2. **Jim's sleeve question, answered:** the **R2 sleeve survives as the HUMAN-ATTACH primitive only**
   (DEC-099's re-sleeve: a human attaching to a pre-warmed `session` stem — R1's proven path). **Native
   pools supersede the sleeve for all DISPATCHED surfaces.** The sleeve is the special case (attach),
   not the general one. `adoptPooledStem` drops its `writeSleeveState` for native stems (no sleeve to
   apply — the env is already native). R2's per-facet resolvers stay (they fall back to `$AGENT_SURFACE`,
   which is now natively correct by construction).

## Grounded root-cause (the live-prove finding, traced)
- `jemma-orchestrator.ts:218-221`: per-CONVERSATION locks — the orchestrator was **designed** for
  concurrent different-thread dispatches. The intent was always parallel.
- `jemma-dispatch.ts:40` `writeSignalFile`: the wake is **one flat file, plain overwrite** — two wakes
  close together = the second **overwrites** (or is dropped by the guard below). The single-flag design
  (per the S58 signals doctrine: "attention flags, not message queues") predates wanting N-concurrent.
- `human-responder.ts:611-613`: `if (processing) return` + `await processSignal(...)` — the controller
  handles ONE wake at a time and **ignores** fs.watch events mid-processing. A concurrent wake is lost
  to the controller (the orchestrator's progress-watchdog eventually times the dispatch out — fail-loud
  at the orchestrator, but the message goes unanswered by the agent).

## PR-C1 — the controller concurrency (THE head-of-line cure; Jim's priority-(1))
**The wake queue (durable, per-dispatch):**
- `jemma-dispatch.writeSignalFile` → writes `~/.han/signals/<agent>-human-wake.d/<dispatchId>.json`
  (unique file per dispatch — a queue **directory**; no overwrite-drop by construction). One write-site
  change (DEC-080 discipline holds).
- `human-responder` watches the **dir**: each new file is **claimed** (read + unlink = atomic consume),
  pushed to an in-memory queue. Crash-safety: unclaimed files survive a controller restart and are
  swept on startup (durable); claimed-but-crashed dispatches are covered by the existing orchestrator
  progress-watchdog (`watchdog_timeout` → queue advances). Transition: the controller also keeps
  reading the legacy flat `<agent>-human-wake` for one deploy cycle (both-read window), then the flat
  path retires.
**Bounded concurrent dispatch:**
- Replace `if (processing) return` with a **semaphore**: `maxConcurrent = poolSizeFor(slug, surface) || 1`.
  Unset/0-pool ⇒ 1 ⇒ **byte-equivalent to today** (behaviour-preserving until a pool exists — the same
  inert-first discipline as R3a).
- **Per-conversation exclusivity preserved**: a wake for a conversation already in flight re-queues
  (defers until the in-flight turn completes) — matches the orchestrator's per-conversation lock intent;
  different conversations dispatch concurrently.
- Floor degradation is graceful: N concurrent dispatches + empty pool → all fall to `ensureSurfaceSession`
  → the per-session lock + slug-keyed FIFO serialise them (today's exact behaviour, no crash).

## PR-C2 — native-per-surface pools
- **`poolSize?: number` manifest leaf REPLACES `pooled?: boolean`** (>0 = pooled with that N; 0/unset =
  floor). One leaf instead of two; no-hidden-globals; the semaphore reads the same leaf. (The `pooled`
  boolean shipped `3d0ba1f`/reverted `967a3fb` — it has zero users; clean moment to collapse it.)
- **Registry per (slug, surface):** `pool-<slug>-<surface>.json`; `stem-pool.ts` fns take `(slug, surface)`.
  Dispatcher stays the SOLE writer (cond-3 held).
- **Native pre-warm:** `launch-tmux-surface.sh` — `--stem` widens to any surface with `poolSize > 0`
  (bypasses ONLY the single-manager/launchable check, exactly as today's session-stem bypass);
  `AGENT_SURFACE=<surface>` native; `HAN_DIARY_SLUG=<stem session>` (already wired); `wakeStepsFor` already
  yields greet-less steps for non-session surfaces (the wake is IDENTICAL across surfaces — traced, msg 159).
  `prewarm-stem.ts --pool --surface <surface>` passes it through; emits `PREWARM_STEM_META` unchanged.
- **Sentinel constraint (bug B4):** native stems share `<slug>-<surface>-ready` at pre-warm → **sequential
  pre-warm stays the rule** (pool-manager warms one at a time). Per-stem sentinels = a flagged refinement,
  designed only if sequential-warm latency ever matters (it shouldn't — replenish is async + off-path).
- `adoptPooledStem`: drop `writeSleeveState` (native stems need no sleeve); everything else unchanged
  (lease-is-readiness, per-stem sink mkdir, retire-on-failure).

## PR-C3 — the pool-manager (dispatcher role, NOT a daemon — #109 trajectory)
- **Eager replenish:** after checkout/retire drops free-count below `poolSize` → async `prewarmAndRegister`
  (sequential, queued) back to N. Zero-wake-delay thesis.
- **Retire done right (bug B3):** `retireStem` = registry-remove (never re-leased) + **deferred SAFE kill**:
  the sweep kills the tmux session ONLY when its pane shows no processing chrome (the R011/S181
  never-kill-a-thinker guard — a timed-out stem may still be composing) + cleans `sinkDir(stem)` after
  kill. Today `removeStem` leaves the tmux + sink orphaned — this closes it.
- **24h substrate reload** (freshness plan §3c): retire+rewarm stems older than the config leaf — the
  identity-substrate staleness no WM-freshen touches.
- **`model: null` fix (bug B2):** capture the resolved model from `awaitChromeOrDescend`'s
  outcome/`observeActiveModel` retry post-wake at pre-warm; stamp the registry truthfully (DEC-092 spirit).
- **Dead-stem retry (nicety):** on adopt-fail, try the NEXT free stem before the floor (bounded, no loop).

## Activation + the CLEAN live-prove (the milestone gate)
1. `poolSize: 2` on leo human-response (manifest flip) + pool-manager populates.
2. **The clean live-prove:** Darron posts 2 messages, 2 threads, **addressed to LEO ONLY** (the S212
   confound: naming both agents let Jim absorb msg-2). Jim verifies by hand: **2 distinct stems `leased`
   concurrently** · both dispatches progress (no head-of-line wait) · both captures in their per-stem
   sinks · both replies post + `computePostRef` · **shared WM intact** (the R3a.0 slot under genuinely
   live same-agent concurrency — its first real exercise) · stems return `free` · replenish observed.
3. That green = **MNT-009 DONE.**

## Bugs folded (the S212 live-prove list → where each lands)
| Bug | Fix | PR |
|---|---|---|
| B1 controller serialises + drops concurrent wakes | wake queue-dir + semaphore | C1 |
| B2 `model: null` in the registry | capture resolved model at pre-warm | C3 |
| B3 retire leaves tmux+sink orphaned | `retireStem` + safe-kill sweep + sink cleanup | C3 |
| B4 shared pre-warm sentinel | sequential-warm rule (documented); per-stem = flagged refinement | C2 |
| B5 old floor spoke coexists with pool | it IS the floor — kept deliberately; pool-manager never reaps it | C2 (doc) |
| B6 `populate-pool.ts` untracked | superseded by the pool-manager; commit as operator tool in C3 | C3 |

## Sequencing (Jim's lean folded) + audit rhythm
**C1 → C2 → C3 → activation+live-prove.** C1 is independent + behaviour-preserving at maxConcurrent=1
(deployable alone, unblocks everything); C2 changes the stem model with zero live users (pool off);
C3 completes the lifecycle. Each PR: build-held → Jim diff-audit → quiesce-deploy. The live-prove is
the only step needing Darron's hands. Estimated: C1 ≈ jemma-dispatch + human-responder (~120 lines);
C2 ≈ stem-pool + launcher + prewarm + manifest (~100); C3 ≈ dispatcher pool-manager (~150).

## Forks — SETTLED by Jim's plan-audit (GREEN to build, 2026-07-03)
- **F1 — queue-DIR. Settled.** Build note (Jim): write each queue file **temp+rename** so a claim never
  reads a half-written JSON — this also retires the 500ms settle-delay (no port needed). Bonus (Jim's
  grounding): the `processing` guard's original job was inotify double-event dedupe — claim-by-read+unlink
  subsumes it naturally; no separate dedupe.
- **F2 — `poolSize` replaces `pooled`. Settled** (zero users verified by Jim).
- **F3 — NOT a fork: chrome-guarded sweep REQUIRED** (immediate-kill violates the settled R011/S181
  never-kill-a-thinker invariant). Only chrome-guarded is admissible.
- **F4 — both-read window. Settled** + sweep the legacy flat file at controller startup during the window
  (a wake written mid-deploy is never stranded).
- **F5 — controller-only semaphore. Settled** (YAGNI on dispatchToSpoke promotion until another reactive
  surface exists).

## ★ Jim's audit catch — the stem-vs-FLOOR sentinel race (folded, C2)
Beyond B4 (stem-vs-stem): a native human-response stem's pre-warm writes `<slug>-human-response-ready` —
the SAME file the FLOOR cold-launch's `waitForReady` keys on (mtime-watched, deleted before launch). The
c0-gate can't catch it (the stem's c0 is genuinely valid), so an async **replenish coinciding with a floor
cold-launch false-satisfies the floor's readiness** — new with native-per-surface (session-stems wrote
`-session-ready`), and real because retire→replenish fires exactly when the pool failed = exactly when the
floor is in use. **Fix taken (Jim's lean + mine): per-stem sentinels for native pool stems** —
`<slug>-<stem-session>-ready`; the pre-warmer's feeder c0-ack reads the per-stem path; the floor's
per-surface sentinel is never touched by pool pre-warms. Bonus: retires the sequential-warm constraint
(B4) entirely — pool stems can pre-warm concurrently.

## Jim's sharpenings (folded)
1. Same-conversation defer self-corrects (the spoke reads the live thread; if already answered it stands
   down) — recorded as the why, no change.
2. **C1 deploy restarts BOTH `human-responder@leo` + `@jim` explicitly** (in-memory state-holder, S159
   family — don't rely on the post-commit hook alone).
3. C3's retire-sweep must also cover stems retired by `dispatchToPooledStem`'s failure path (today
   registry-remove only) — closes Jim's 1c-i "CLEAR side" flag.
4. The live-prove keeps the **WM-intact check explicit** (the R3a.0 slot's first genuinely-live
   same-agent concurrency exercise).
