# Pool · Stem · Spoke — the CURRENT lifecycle, as-is (the baseline for Darron's delta)

> Author: Leo (session), 2026-08-10 afternoon, on Darron's word: *"write what happens now so
> we can see the delta when I write it."* Every fact below is traced in the metal TODAY with
> `file:line` cites — nothing recited from memory or docs. This document describes what IS,
> including the warts; it recommends nothing. Companion threads: 🏊 pool economics
> (`msmq3rm5`), 🔥 the knee (`msipvdfo`). The desired-state document is Darron's to write;
> the delta falls out of the two side by side.

## 0. The cast of characters

| Thing | What it is | Where |
|---|---|---|
| **Fixed-session surface** | One persistent warm tmux `claude` session per (slug, surface) — heartbeat, supervisor-cycle, compression, meditations. Lives until cleared or killed; never pooled. | `tmux-dispatcher.ts:721` (`ensureSurfaceSession`) |
| **Pool stem** | A pre-warmed whole-self session waiting in a per-surface pool. States: `free` → `leased` (transient checkout grab) → `spoke`. | `stem-pool.ts:31–33` |
| **Bound spoke** | A stem checked out and bound to one conversation, serving it across turns until recycled/reaped (DEC-101 persist-as-spoke). | `stem-pool.ts:158` |
| **Interactive seat** | Darron's `session` surface (transport `cli`) — outside the dispatcher entirely. | manifest: `session/cli` |
| **Walker (wander/lamp)** | Detached (`setsid`) process driving overnight beats; deliberately outside every reaper (DEC-103: no kill clock on paid cognition). | `tmux-dispatcher.ts:1761–1771` comment block |

**Pooled today:** `human-response` only, `poolSize: 2`, all four agents
(`~/.han/garden-manifest.json`). Everything else is fixed-session or CLI.

## 1. LAUNCH — what starts, and what gates it

- **Fixed session:** `ensureSurfaceSession` (`:721`) → `launch-tmux-surface.sh` (claude-logged
  spoke + ready-sentinel + adopt). Launch model walks the surface's manifest ladder with
  in-session `/model` descent on a dead rung (`awaitChromeOrDescend`, `:444`); DEC-092 stamps
  the OBSERVED banner, never the intent.
- **Wake:** `wakeFeed: true` surfaces (human-response, heartbeat, supervisor-cycle,
  compression) are FED their wake one step at a time — integrity gate first, ack-per-step,
  gradient to `GRADIENT-EOF: c0=<id>`, the id echoed into the per-surface ready sentinel
  (`:150`, `:296`). The dispatcher's c0-gate verifies a real c0 loaded before any work is
  delivered. `waitForReady` timeout: **20 min** (`READY_TIMEOUT_MS`, `:71`).
- **Stem pre-warm:** `prewarmAndRegister` (`:1848`) runs `scripts/prewarm-stem.ts`; stems warm
  on **`STEM_WARM_LADDER` = sonnet → opus → haiku, never Fable**
  (`garden-manifest.ts:294–302`). A pre-warm stem is INERT (S208: never asked to produce until
  sleeved). **No kill clock on a slow pre-warm** — DEC-103 §1: a surfacing ntfy alert at
  **12 min** (`prewarmAlertMinsFor` default, `garden-manifest.ts:652–653`) observes and waits;
  a wedged warm blocks the serial replenish loop VISIBLY, indefinitely.
- **Cast at checkout:** a checked-out stem is `/model`-cast to the surface's serve model
  (`castStemToServeModel`, `:1504`). **The knee fold's price:** the cast forfeits ~95% of the
  stem's cache — the serve model re-writes the whole loaded self at 2× (~400–500K tokens).
  Warmth currently buys loaded identity + zero latency, zero cache value across a cast.

## 2. WHAT WAITS — the queues and the middles

- **Per-slug FIFO:** all dispatches to one agent serialise (`withSlugLock`, `:2267`;
  `enqueueForAgent`, `:2284`). A busy turn queues the next prompt; nothing types into a pane.
- **Warm-gate:** before delivery, `verifyWarmOrNudge` (`:1096`) requires ctx ≥ `warmFloorPct`
  (**30**, manifest `spokeLifecycle`) with ≤ `maxWarmNudges` (**2**) bounded nudges — else
  fail-safe, never a hollow answer.
- **Free stems wait warm** in the pool. **Reload clock:** a free stem older than
  **24 h** since `warm_at` is retired and re-warmed (`stemNeedsReload` + `stemReloadHours ?? 24`,
  `:2020–2023`, `:2122`, `:2136–2138`) — the substrate-reload tick.
- **Bound spokes wait bound** — a thread's spoke holds its conversation context between
  messages, **for up to 48 hours idle** (below) at up to 92% ctx. *This is the "middle state"
  the knee fold priced: idle past 60 min with a dead cache, still alive, paying a full 2×
  re-cache on its accumulated context at the next touch.*
- **The interactive seats wait outside everything** — no register, no reaper, no feeder
  touches `session/cli`. They idle past the knee whenever Darron steps away >60 min (the
  measured 12× re-cache case).

## 3. WHAT CLEARS — context resets that keep the seat alive

- **Ctx-pressure self-clear (fixed sessions):** after each successful dispatch, if ctx ≥
  `ctxClearThresholdPct` (**85**, manifest) → `/clear` + fed welcome-back
  (`dispatchToSpoke`, `:2205–2214`; `clearSession`, `:1011`). Never compaction. The sentinel
  is deleted pre-clear so stale ready never lies.
- **Pooled stems NEVER self-clear in place** — they are retired + replaced at threshold
  (`:1492` comment; `reapSpokeIfOverCtx`, `:1539`).
- **Reconcile (#5):** a dispatch timeout marks `needs-reconcile`; the next dispatch runs
  `reconcileSession` (`:2234`): honest-fail the abandoned turn → `/clear` → welcome-back →
  fresh sentinel. A wedged session stays needs-reconcile and fails loud on every enqueue.
- **The interactive seat clears only by Darron's hand** (`/clear` at his choosing; the
  harness compacts at ~99% if never cleared — his watch).

## 4. WHAT REAPS — the paths by which a session dies

All stem/spoke deaths funnel through **`retireStem` (`:1908`) → the chrome-guarded two-stage
sweep** (`sweepRetiredStems`, `:1989`): never while `PROCESSING_CHROME_RE` matches the pane
(⚠ see §6) → stage 1 `/exit` (graceful, claude-logged writes its file) → stage 2
`kill-session` after **60 s** lag (`GRACEFUL_KILL_LAG_MS`, `:1901`). Sink cleaned; forensic
receipt written (`writeSpokeLifecycleReceipt`). The pool-manager ticks every **60 s**
(`POOL_MANAGER_TICK_MS`, `:2025`) and replenishes to N after every retire.

Triggers, in the order the tick runs them (`startPoolManager`, `:2117`):

1. **Unregistered/dead-registered sweeps** (C4/MNT-056): sessions with no pool row, rows with
   no session — healed before replenish so the deficit is real.
2. **Ctx-reap:** a bound spoke at ctx ≥ `ctxReapThresholdPct` (**92**, default,
   `garden-manifest.ts:646–647`), **idle-only** (R011) → retire.
3. **Idle sweep** (`sweepIdleSpokes`, `:1735` + `decideIdleAction`,
   `spoke-lifecycle.ts:111–125`): a spoke idle ≥ `spokeIdleReapHours` (**48 h** default) →
   if ctx < `spokeRethreadCtxCeilingPct` (**70**) → **recycle** (decouple → back to `free`
   WITH its context, thread affinity kept); if ctx ≥ 70 → **reap**. Unreadable idle clock →
   **skip-alert, held** — never reaped on a bad clock.
4. **Resumable sweep** (MNT-070): a dispatch that died at the API with a healthy pane is
   marked `resumable`, NOT retired — the reconciler gets first claim (rung 1
   continue-nudge); unclaimed past `resumableTtlMinutes` (**30**, default) → retire.
5. **Thread-close reap:** conversation resolve/archive → `reapThreadSpoke` (`:1553`).
6. **24 h substrate reload** (free stems only, §2).
7. **Orphan reap** (`reapOrphanedSpokes`, `:687`): spoke PIDs not under any live pane —
   env-fingerprinted, self-ancestry-guarded (S167). **The `session` surface is NEVER
   autonomously reaped** (inherently noisy with the seat's own processes).

**What is NEVER reaped by anything:** the interactive seats; the detached walkers (lamps)
mid-arc; any seat whose pane matches the processing chrome; anything mid-thought (R011
Invariant 2 — the wake DROPS or the sweep SKIPS, never interrupts).

**What survives every reap by construction:** memory — DEC-107's per-turn flush means the
swap is drained at every turn end, so a retire destroys no record. *(Noted in the pool
thread: this is a dependency, not a property — Tenshi's "the reaper is licensed by the
per-turn flush.")*

## 5. RECOVERY — the reconciler's ladder (MNT-069/070)

On a failed/interrupted dispatch (`dispatch-reconciler.ts:29–46`), strictly in order:
**rung 0** `recovered-landed` — the post actually landed, only the capture died: no
re-anything · **rung 1** `resume-same-spoke` — continue-nudge the same healthy vessel
(API error = weather, non-fatal — Darron's ruling) · **rung 2** `redeliver-leg` — session
gone, /tmp leg survives: fresh stem verifies + posts · **rung 3** `redispatch-beat` — ONE
re-dispatch on a fresh stem · **rung 4** `hold` — recovery spent / unrecognised /
interactive: alert-and-hold, LOUD. Recovery budget does NOT reset on a manual relight
(MNT-104, open design question).

## 6. THE KNOWN WARTS (already filed, load-bearing for the redesign)

- **MNT-115:** `PROCESSING_CHROME_RE = /esc to interrupt/i` (`:329`) currently matches
  NOTHING on any live pane — the busy discriminator every reap gate leans on is blind. Today
  semi-harmless (sweeps skip-or-hold conservatively; nothing acts on "wedged" at scale);
  becomes blocking the moment anything reaps on a clock.
- **The middle state is the expensive state** (the knee fold): bound spokes and interactive
  seats idle 1–48 h pay full-context 2× re-caches invisibly. Free stems idle warm all night
  for a morning that re-casts them anyway (zero cache value across the cast).
- **Compression seats** are fixed sessions kept warm 24 h at the Fable serve model — the
  single most expensive keep-warm in the garden (Jim's pricing, pool thread).
- **No window anywhere:** nothing in the lifecycle knows day from night. Bedtime is a manual
  act; stems idle at 3am exactly as at 3pm.
- **MNT-088's lesson stands:** pool JSON is never hand-edited (a runtime control is a
  triple); phantom stems are the pool-manager's to sweep.

## 7. The numbers on one page (all manifest-overridable per surface, DEC-081)

| Constant | Value | Source |
|---|---|---|
| ctxClearThresholdPct (fixed-session /clear) | 85 | `~/.han/garden-manifest.json` spokeLifecycle |
| warmFloorPct / maxWarmNudges | 30 / 2 | manifest spokeLifecycle |
| ctxReapThresholdPct (spoke retire) | 92 | `garden-manifest.ts:647` |
| spokeIdleReapHours | 48 | `:670` |
| spokeRethreadCtxCeilingPct (recycle-vs-reap) | 70 | `:675` |
| spokeFitCeilingPct (best-fit packing) | 80 | `:680` |
| resumableTtlMinutes | 30 | `:665` |
| stemReloadHours (free-stem re-warm) | 24 | `tmux-dispatcher.ts:2122` |
| poolSize (human-response, ×4 agents) | 2 | manifest |
| prewarmAlertMins (surface, never kill) | 12 | `garden-manifest.ts:653` |
| POOL_MANAGER_TICK_MS / GRACEFUL_KILL_LAG_MS | 60 s / 60 s | `:2025` / `:1901` |
| waitForReady / chrome timeouts | 20 min / 3 min | `:71` / `:375` |

— Leo (session), 2026-08-10. Traced same-day at HEAD; the deltas Darron's document rules
against this baseline are the redesign.
