# MNT-077 — the watchdog learns the agent has one seat: defer-when-busy-elsewhere

> **Status: PLAN — for the membrane's audit, then build on GREEN. Author: Leo (session),
> 2026-08-01 (the same evening as the trace). No code touched.**

## The critter (journal MNT-077 — the MNT-075 F2 trace's third animal)

Both of the 2026-08-01 watchdog fires (`06e9057b` jim, `7d7ff3ee` casey — one thread,
overlapping dispatches) were **an agent alive and mid-compose on the concurrent SIBLING
dispatch**: jim was composing for A when B woke him; casey the exact mirror. The
composing-heartbeat machinery is **sound** — every completed turn shows healthy
`last_progress_at` ticks; the failed turns show `attempts: 0`, no pickup at all, because
a single-threaded responder was honestly busy. The watchdog measured true *per-dispatch*
silence and never asked the one question its own table could answer: *is this agent
demonstrably alive and working on another of my rows right now?*

## Two traced facts the fix stands on (both verified in the metal tonight)

1. **Same-thread concurrent dispatches are BY DESIGN.** The per-conversation
   serialisation (`conversationDispatchLocks`, jemma-orchestrator.ts ~:229) chains only
   dispatch **initialisation** — *"the chain holds only until `orchestrate()` returns
   (i.e. until the first wake has been written)"* (DEC-079: the init-race cure). Two
   human messages minutes apart legally run their recipient queues concurrently. The
   concurrency is not the bug; the watchdog's one-row-at-a-time view of it is.
2. **The deferred wake is not lost — more strongly than first written.** *(Corrected at
   the audit — Jim's C1, Tenshi-verified: the original text here recited the single-flag
   overwrite case, which describes RETIRED code.)* The flat `{agent}-human-wake` flag
   was replaced by the **durable per-dispatch wake QUEUE** (`lib/wake-queue.ts`, PR-C1 /
   MNT-009): one file per dispatch under `<signal>.d/`, temp+rename, claim = atomic
   read+unlink, unclaimed files surviving a controller restart — *no overwrite-drop, by
   construction*. Jim's spoke picked up B's wake after finishing A this morning *because
   of the queue*. Waiting is therefore even more correct than the plan first argued.
   **The one TRUE residual loss case — consumed-then-died:** claim is read+unlink, so a
   controller that claims B's wake file and then dies has consumed the wake with no post
   and no ack; the queue cannot re-offer what was claimed. That residual is R2's.

## The cure — borrowed progress, plus one re-wake

**R1 — the busy-elsewhere defer (the root cure, ~20 lines).** A pure helper in
`lib/dispatch-reconcile.ts` (the shared home MNT-075 built):

```
busyElsewhere(agent, rows, nowMs, timeoutMs): { dispatchId, progressAtMs } | null
```

— scans ALL in-progress dispatch rows (any conversation — the contended resource is the
agent's seat, not the thread): is `agent` the CURRENT recipient elsewhere with a
progress anchor fresher than the timeout? In `checkWatchdogs`, when `elapsed ≥ timeout`:
consult it **before labelling**. If busy-elsewhere → **defer**: adopt the sibling's
fresh anchor as this row's `last_progress_at` (*borrowed progress* — honest: the agent
IS progressing, just not here), stamp `deferred_busy_on: <siblingDispatchId>` on the
recipient state (observability — the deferral is visible in the row, never silent),
log at info, and do NOT fire. Re-evaluated every poll; the defer ends by itself the
moment the sibling stops progressing.

**R2 — one re-wake at defer-exit (the consumed-then-died belt).** *(Re-justified at
the audit — the originally-recited flag-clobber case is structurally impossible under
the wake queue; this is the TRUE reason, per Jim's C1 + Tenshi's ruling + Casey's
false-recital covenant point.)* When a previously-deferred recipient's sibling has
stopped progressing and no progress arrives here within one further timeout window,
**re-fire the wake ONCE** (`deferred_rewake: true` on the state — a receipt BEFORE the
act, the reconciler's crash-safe pattern) and give it one fresh window. Exactly one:
S74's law — a retry that can loop is a token black hole; one re-wake then the honest
path. **The benefit is not relabelling — it is recovering the UNANSWERED HUMAN**
(Tenshi's availability argument: dropping R2 would leave consumed-then-died resolving
to a truthful `failed` label while the human's message to that agent goes unanswered
forever; a wasted re-wake is cheaper than a dropped human message). The MNT-070
"one bounded recovery, then the honest hold" shape, at the wake layer.

**R3 — the honest tail (already built).** If the agent never comes (defer ended,
re-wake spent, still silent), the watchdog fires exactly as today — and lands on
MNT-075's R1 reconcile: the label checks the record before it speaks, and the preamble
seams stay fail-closed. The tail of THIS plan is the head of the one that landed
tonight; nothing new needed.

## Deliberately NOT in scope

- **Per-agent dispatch serialisation at the orchestrator** (queue B's wake until A
  completes): rejected — it holds every OTHER recipient in B's queue hostage to one
  busy agent, inverting the rotation's latency for zero correctness gain (the defer
  achieves the same patience without restructuring dispatch order).
- **Widening the 90s window** — still the wrong axis (MNT-075's ruling stands).
- **FI #105 (parallel fan-out)** — not built here, but R1 is designed FOR its world:
  the check keys on (agent, sibling-row) pairs regardless of fan-out mode, so when
  `independent: true` makes same-thread concurrency routine, the defer is already
  load-bearing (the journal's cross-ref, honoured). Same for FI #131: `deferred_busy_on`
  is precisely the "thinking-elsewhere" signal the telltale's lamp wants.

## Gates (the suite — extending `test-mnt075-reconcile.ts`'s harness, scratch-db gated)

- **G1 (pure pins):** agent current elsewhere + fresh progress ⇒ defer; sibling stale ⇒
  no defer (honest fire); agent not current elsewhere ⇒ no defer; the defer adopts the
  sibling's anchor and stamps `deferred_busy_on`.
- **G2 (the live replay):** the two real timelines (`06e9057b`/`7d7ff3ee`, timestamps
  from the DB rows) fabricated ⇒ the defer holds BOTH fires that bit on 2026-08-01 —
  neither labels while its sibling ticks.
- **G3 (the one-re-wake bound, reshaped to the true case):** a claimed-but-never-
  progressed recipient at defer-exit ⇒ exactly one re-wake (receipt written before the
  act; gated on a PRIOR defer — never a general retry); a second defer-exit goes to
  the honest timeout.
- **G-atomicity (Casey):** the borrow and the stamp are ONE act — no
  `last_progress_at` borrow without its `deferred_busy_on` memo line, suite-pinned.
- **G-never-throw (Tenshi):** a poisoned scan (bad row JSON) returns null and the
  watchdog loop survives; the progress-not-aliveness invariant is recorded in the
  code beside the helper.
- **G4 (DEC-103/104 self-test):** no cap, no kill, no destructive clock enters — this
  plan REMOVES a false clock; the single bounded re-wake carries its author + reason +
  bound (1) on its face.

## Scope discipline

Build-time files: `lib/dispatch-reconcile.ts` (the pure helper), `services/
jemma-orchestrator.ts` (the defer + re-wake at `checkWatchdogs`), suite additions.
Protected surface (services/) — Jim's blocking diff-audit at land, per the rhythm.
DEC-079 honoured (init-chain untouched; the defer reads state, reorders nothing);
DEC-103/104/S74 checked; none altered. Size: small — one careful sitting.

*— Leo (session), 2026-08-01 ~23:50 AEST. For the membrane's audit; build on GREEN.*
