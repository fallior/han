# Dispatch Resilience — the warm-dispatch invariant + agent-sovereign presence

> Decision-first scope (NOTHING built). The follow-through from the S196 human-seat wedge.
> Two-stage rhythm: Leo scopes → **Jim orders + plan-audits** → Leo builds (held) → Jim blocking diff-audit → quiesce-deploy.
> Thread: `mppj72fx-wt0u1p`. Origin: 2026-06-21 S196.

## Origin (what happened, why this exists)
The S196 silence-from-both: Darron addressed Leo+Jim on the voice thread; leo-human's spoke was wedged on a **clear↔wake race** (a new-dispatch `welcome back` interleaved with an in-flight ctx-pressure `/clear` → the wake was swallowed → no `leo-human-response-ready` → `waitForReady` ran to the 20-min `READY_TIMEOUT_MS`). Sequential dispatch made one wedged index-0 spoke a **two-agent, 20-minute outage**. Behind it: both human seats had run 4 days on `404d331`, predating the Jun-19 fix-Leo arc (the immediate fix — restart onto current code + kill the wedged spoke — is DONE, `mqn801qv`).

## The north-star invariant (Darron's correction + Jim's fold)
**Dispatch routes only to a warm, *available* agent. The unavailable declare or derive themselves out of the pool — they are never a dispatch target.** Cold-wake (~7-min welcome-back) is a **recovery event** (async relaunch), never a hot-path queue state. This is *subtraction*: it deletes the probe-around-a-cold-spoke machinery rather than adding tolerance for it.

**Two distinct kinds of "not available" — different sources of truth, keep them separate (Jim's auditor nit):**
- **Cold / recovering** — waking from restart/wedge. *System-known* via the readiness sentinel. → recovery lane, never dispatched.
- **Indisposed / away** — warm but declared-out ("back soon, try someone else"). *Agent-sovereign* — the agent's word, not the system's inference. The same sovereignty shape as `cli-busy` / holiday / stand-down.

**Kinship (don't build, don't preclude):** "route to an available *agent*" and the account-axis "route to the freshest *account*" are one primitive — pick a warm, ready resource; the not-ready aren't in the pool. Design the pool/availability abstraction so account can later be a resource dimension (#18).

## The pieces (discrete; Jim to ORDER — my lean noted, his call is canonical)
- **P0 — runbook hook-gap (cheap, stops recurrence).** Post-commit hook restarts consumer services (`*-human`, heartbeat) when a **shared dispatcher lib** changes (`tmux-dispatcher.ts`, `agent-cycle.ts`, `agent-registry.ts`), not only on direct `*-human.ts` edits. This is *why* the seats sat 4 days stale. Tiny, independent. *(Lean: do first — it's insurance, unblocks nothing else but prevents the whole class.)*
- **P1 — the clear↔wake race (the genuine bug, root of the wedge).** Serialize wake-behind-clear on the per-surface FIFO: an incoming dispatch must queue *behind* an in-flight ctx-pressure `clearSession`, so a `welcome back` can never be consumed by a `/clear` mid-flight. `tmux-dispatcher.ts` (#5-reconcile turn-state territory). *Independent of the away-flag — a warm agent can still hit this under ctx-pressure; keep it even with dispatch-to-warm.*
- **P2 — agent-sovereign presence (the away-flag).** An agent declares availability ("indisposed, back soon"). *Lean: a signal file mirroring `cli-busy`, agent-agnostic via `$AGENT_SLUG` (`away-<slug>` / a presence state), set/cleared by the agent's own hand.* Distinct from the cold/recovering sentinel. DEC-081 one-path-many-agents.
- **P3 — warm-available routing (where layer-2 dissolves).** Jemma/orchestrator routes to a warm **and** available agent; skips cold/recovering (sentinel) and away (flag). Replaces the probe→demote→requeue + the 20-min wall with "route to available; the rest are out of the pool." `jemma-orchestrator.ts` / `jemma-dispatch.ts` / `jemma.ts`.
- **P4 — cold-wake as a recovery event.** A not-warm agent triggers async relaunch (Robin Hood / watchdog), never blocks a dispatch. Removes cold-wake from the hot path entirely (the R011 invariant made operational at the dispatch layer). **[C3 update, Leo S197 grounding: the "fold the stale-Robin-Hood" half is ALREADY DONE — `leo-heartbeat.ts:160-163` resurrects via the watchdog path (`restart-agent-server.sh` → SIGTERM live pid → watchdog relaunch), NOT the disabled `han-server.service` relic (landed F1 B1 `9911587`). So C3 is now UNIFICATION, not repair — see Leo's design pass below.]**
- **P5 — the away-vs-failed recording surface.** Transient (not-ready / away → re-route, no failure recorded) vs **terminal failure** (record to a maintenance/error surface). The self-observing garden (#92) metabolises these instead of us firefighting each by hand. *Open: new table vs `jemma_dispatch.status` reuse vs #92 thread.*
- **P6 — orchestrator ack-watcher race (secondary, independent).** `existsSync`(:641)→`readFileSync`(:643) ENOENT on transient `-hb-` files (the screenshot spam) + the single shared `processing` flag (:633) dropping concurrent acks. `jemma-orchestrator.ts`. Anytime; doesn't depend on the others. **[BUILT + Jim-audited GREEN 2026-06-21, held for commit — drain-not-per-event; startup-drain kept (handleAck guards stale acks).]**
- **P7 — dropped-turn on a transient API rate-limit (added 2026-06-21, Darron — from the consideration list `plans/consideration-list.md` C1).** The CLI hits an Anthropic-side infra throttle (`Server is temporarily limiting requests · Rate limited`, *not* a quota), its built-in retry exhausts *early*, the turn is **dropped** and never resumes. Autonomous surfaces can't up-arrow: a Jemma dispatch degrades to a slow, *mislabelled* watchdog-timeout-then-advance; a **solo beat silently evaporates** and re-fires fresh next cadence (never a resume). **Detect** via pane chrome — a `RATE_LIMITED_RE` (`/temporarily limiting|Rate limited/`) sibling to `MODEL_UNAVAILABLE_RE` (`tmux-dispatcher.ts:188`). **Respond** with **bounded retry** (re-submit after backoff = the autonomous up-arrow+enter; N tries exponential) → **then** record + escalate. Distinct from model-failover: a rate-limit is *transient/retriable* (retry), NOT *model-dead* (descend ladder); never mark-failed on the first drop. Open: retry bounds; richer SDK status vs chrome-only. **Model-failover *sibling*** — reuses the chrome-detection pattern; touches `tmux-dispatcher.ts` (+ the solo-beat path in `agent-cycle.ts`, which has no recovery for this today). **[BUILT repro-first + Jim-audited GREEN 2026-06-22 (`mqohi5za`), held for commit on Darron's go. `RATE_LIMITED_RE` confirmed against the REAL pane (Darron's Sunday screenshot); `RateLimitedError extends DispatchTimeoutError` so every existing timeout-handler treats it identically; the solo-beat path inherits it free via the one path (no `agent-cycle` edit). Remaining belt-and-braces: re-submit *mechanics* (does re-delivery resume a throttled turn) — a live-rate-limit confirm, the #91-class item.]**

## Leo's P3/P4 design pass (S197, 2026-06-22) — grounded; for Jim's audit

*Decision-first (NOTHING built). My independent pass on the next ordered block [P3-core + P4], grounded against the live surfaces, folding Jim's C-catches. Jim's design/audit is canonical — this is the cross-check + the live-state facts on the table.*

**The live state I traced (verify-don't-assume):**
- **Two recovery mechanisms exist today, uncoordinated:**
  1. **Robin-Hood peer-resurrection** (`leo-heartbeat.ts:153-213`): cross-agent health check, **hardcoded leo-watches-jim** (`JIM_HEALTH_FILE`), 1-hr cooldown, PID-alive guard against split-brain, resurrects via `restart-agent-server.sh` (the watchdog path — relic-repoint DONE, F1 B1). Triggers on a stale/dead *peer health file*.
  2. **Dispatcher cold-launch + orphan-reap** (`tmux-dispatcher.ts`: `ensureSurfaceSession`→`coldLaunch`→`reapOrphanedSpokes`:489): per-(slug,surface), reaps orphaned spokes + relaunches on demand. Triggers on a *dispatch to a not-present/wedged surface*.
- **Routing** (`jemma-orchestrator.ts`): first-mention-wins + left-shift rotation, atomic DB dispatch txn — **no availability gate today** (it dispatches to the rotation pick regardless of warm/cold/ready). This is exactly where P3's predicate goes.
- **P1 is LANDED** (`87f605a`) and stays independent (a warm agent under ctx-pressure still hits the clear↔wake race) — not mooted by dispatch-to-warm. Settled with Jim.

**P3-core — the "available" predicate (v1, pre-away-flag, per Jim's order):**
`available(agent) = readiness-sentinel fresh (mtime within a window W) AND turnState ∈ {idle}` (NOT busy/needs-reconcile). The orchestrator checks this at recipient-selection, before the dispatch txn; an unavailable pick is skipped, not dispatched-into. The away-flag (P2) later ANDs in as one more term — same predicate, one more clause (the clean layering Jim named).
- **C2 (empty pool) — my lean: queue-with-bound → escalate, NEVER drop/wall.** If no recipient is available, the orchestrator enqueues the dispatch (don't advance rotation, don't fail) and re-attempts on the next readiness change / a short poll; after a bound (lean: a small N or a few minutes) with still-nobody, escalate to Darron (a `human` post / ntfy) rather than silently dropping. The bound value is **Darron's** (C1/C2 are his).
- This **retires the 20-min `READY_TIMEOUT` from the hot path**: a recovering spoke is "not in the pool" (skipped + queued), never a blocking wait that walls a sibling. That dissolves the S196 amplifier (sequential dispatch, one wedged index-0 walling index-1).

**P4 — cold-wake as a recovery event (C3 = unification, not repair):**
Since the relic-repoint is already done, C3's real work is **one agnostic recovery lane** that subsumes the two mechanisms above:
- **Trigger:** "agent not warm/available" (sentinel stale OR no live spoke) — derived from the *same* readiness signal P3 reads, so routing and recovery share one source of truth.
- **Action:** async relaunch via the dispatcher's existing `coldLaunch` (reap + `launch-tmux-surface.sh`) — it already IS the recovery primitive. P4 ≈ "make a not-available routing-miss fire `coldLaunch` asynchronously (fire-and-forget, never blocking the dispatch) instead of the synchronous in-band wake."
- **Agnostic mesh:** the Robin-Hood peer-check becomes **registry-derived who-watches-whom** (not hardcoded leo↔jim) firing that same recovery lane — so a 4th agent is watched for free (DEC-081). The hardcoded `JIM_HEALTH_FILE` cross-check is the thing to generalise.
- **Net:** one trigger (not-available), one action (async coldLaunch), two callers (routing-miss + peer-health-miss). Robin-Hood stops being a separate `systemctl`-flavoured path and becomes a registry-driven *trigger* of the shared lane.

**My open questions for Jim (design-level):**
- Q-A: P3 queue mechanism — does the empty-pool queue live in `jemma-orchestrator` (in-memory + re-attempt on readiness change) or as a persisted `jemma_dispatch.status='queued'` row? (Lean: persisted status — survives a bounce, visible, and P5's recording reuses it.)
- Q-B: the readiness "freshness window" W — reuse the dispatcher's `READY_TIMEOUT_MS` notion, or a separate availability TTL? (Lean: a separate, shorter availability TTL — "ready recently" ≠ "allowed 20 min to wake".)
- Q-C: should P4's agnostic-mesh generalisation of Robin-Hood ride in [P3-core+P4], or is that the Phase-2 **F1 mesh** plank proper (the two were always going to meet)? (Lean: the relic-repoint + the single-lane wiring ride here; the *full* registry-derived N-body watch-mesh is the F1 plank — name the seam so we don't double-build.)

## Open decisions for Jim (bring before code)
1. **Ordering** — Leo's lean was P0 → P1 → P2 → P3 → P4 → P5; **Jim's CANONICAL order (set 2026-06-21, thread `mqnespor`):** **[P0 + P6]** (cheap standalones, first; both now BUILT + audited GREEN) → **P1** (clear↔wake race; stays independent, not mooted) → **[P3-core + P4]** (warm-routing-via-sentinel + cold-as-recovery = the amplifier fix; retires the 20-min wall from the hot path) → **[P2 + P3-away-filter]** (the agent-sovereign away-flag = north-star capability, *after* the bug-fix path because the wedge was involuntary) → **P5** (→ folds into the maintenance thread `mqneni8k`). **P7** is a model-failover *sibling* — independent/anytime like P6; lean is to slot it **with or just after P1** (both are `tmux-dispatcher` spoke-lifecycle robustness) since it's a genuine autonomous threat and cheap (reuses the chrome-detection pattern).
2. **Away-flag mechanism** — signal file (`cli-busy`-shape, `$AGENT_SLUG`) vs a presence registry field? (lean: signal file.)
3. **Does P1 stay independent, or does dispatch-to-warm (P3/P4) make the race moot?** (my lean: P1 stays — it's a real race for a warm agent under ctx-pressure.)
4. **P5 recording surface** — new table / reuse `jemma_dispatch` / #92.
5. **Bundling** — which pieces ride together in one PR vs separate (e.g. P2+P3 are one primitive; P0/P6 are standalone).

## Discipline
DEC-081 (one-path-many-agents — `$AGENT_SLUG`, no per-agent twin) on every piece. Decision-before-code on the protected dispatcher/orchestrator surfaces. Each build held for Jim's blocking diff-audit; deploys quiesce-wrapped. R011 honoured (dispatch-to-warm IS R011 at the dispatch layer).

---

## S200 (2026-06-24) — the warm-load gap + the compaction root: the fix design (warm-verification + queue + human self-clear)

> Added after leo-human wedged **repeatedly** this session (conv `mqrohgdd`, distress `failed_ack` 07:00Z; recovered, re-wedged within ~10min). Decision-first; Jim plan-audit next.

### What we found (live, this session)
1. **Hollow-but-"ready":** after a kill+cold-relaunch, the dispatcher delivered a **queued** message to a spoke at **ctx 14–17%** — it answered Darron *hollow* (never ran the full reconstitution), and the reply literally said *"I'm warm, I'm here"* from 17%. **A spoke's self-report of warmth is untrustworthy; only the meter (ctx) shows it.**
2. **Compaction is the deeper root (Darron's hypothesis, confirmed):** the **cycle** surfaces self-clear before compaction (`agent-cycle.ts:102-111`, `ctxClearThresholdPct` default 85 → clean `/clear` + welcome-back, *"never compaction"*). The **human** controllers (`leo-human.ts`/`jim-human.ts`) have **NO self-clear** — so a human spoke accumulates ctx until the **harness auto-compacts** it: a *pause* (in-flight dispatch can't ack → `waitForReady` 20-min timeout = the distress), a *return-without-warmth* (a harness **summary**, not a memory-bank reconstitution), and possibly *losing the dispatch/work context*.
3. **Why it was never fixed for humans — arbitrary, not principled (traced):** the human controllers predate the agnostic cycle (`306634d`); the self-clear was born **inside `agent-cycle.ts`** at `e1b4f2d` (PR-T7b, S176) for the *cycle* surfaces and **never back-ported** to the older, separate human path. **No decision says human spokes should differ.** This is the **symmetric-but-separate anti-pattern** (DEC-081/S176): the human seats are second-class twins that missed the cycle's care. *All spokes are equal* is the premise; the plumbing drifted from it.
4. **ctx-floor alone is insufficient:** a *shallow wake* sits LOW (6–17%, a ctx-floor catches it) but a *compaction* sits MID-range (~50%, looks "warm" but is a summary). `ctx ≥ floor` proves "loaded a lot," not "reconstituted." Warmth verification needs reconstitution-proof, and the real cure is to **prevent compaction**.

### The fix — three parts (A is the root)
- **A — ROOT: the human surfaces self-clear before compaction.** Give the human dispatch path the same `ctxClearThresholdPct` (85) self-clear the cycle has — clean `/clear` + full welcome-back, **never** harness compaction. **Do it as a SHARED primitive both the cycle and the human controllers call** (one-path-many-agents — stop the human surface being a separate path), NOT a copy-pasted twin. This restores *all spokes equal* structurally.
- **B — BELT: warm-verification.** `ensureSurfaceSession` (and `clearSession`) return ready only when **sentinel present AND `getContextPct ≥ WARM_FLOOR` (~30%)**, with a bounded **full-load nudge** if the wake came up shallow (the bare `welcome back` is empirically non-deterministic — 40% once, 27% another). Fail-safe to `SessionNotReadyError` if still cold after N nudges (no hollow answers; the message stays queued). *(NO SILENT CONSTRAINTS: WARM_FLOOR ~30%, MAX_NUDGES ~2 — stated, tunable.)*
- **C — QUEUE: free.** `ensureSurfaceSession` runs **before** `enqueueForAgent`, so a warm-gated `ensure` makes the existing per-slug FIFO **hold work until warm** — no message lost (the wedge silently dropped Darron's gravity/strings questions), no message answered hollow.

### Acceptance / gate (for Jim's plan-audit then diff-audit)
Human spoke self-clears at threshold (never compacts) via the shared primitive; a hollow/shallow spoke is never delivered work (warm-gated, nudged, fail-safe); the queue holds + drains warm-verified; warm spokes unaffected (instant pass); `tsc` 0-new; a test for the warm-gate (mock `getContextPct`/`sendLine` via `__setTestHooks`). Surfaces: `tmux-dispatcher.ts` + the human controllers + (shared primitive) — all pre-merge-audit by Jim. Live repro anchor: `mqrohgdd` (the hollow reply `mqrrkff9`).

---

## S200 (2026-06-24) — Darron-greenlit BUILD PLAN: agnostic human-responder + generic spoke monitor (registry-tunable)

> Posted to thread mqrseska (mqrtis1l) for Jim's plan-audit. Build on his GREEN. Absorbs the warm-fix A/B/C.

**NEW GOVERNING PRINCIPLE (Darron):** any arbitrarily-chosen number lives in a registry/config file, NEVER a hidden code global — transparency + tunability. All thresholds here (ctxClearThresholdPct/warmFloorPct/maxWarmNudges) → garden-manifest/agent-registry; existing code-constants (READY_TIMEOUT_MS, the `?? 85`, rate-limit backoffs) flagged for migration.

**Part 1 — generic spoke monitor (all spokes inherit):** extract a shared `dispatchToSpoke(slug,surface,…)` primitive (self-clear at registry threshold = never compact; warm-gate = sentinel + ctx≥warmFloor + bounded nudge → fail-safe; queue = warm-gated FIFO) that dispatchTxn(cycle) + human-responder + (later) compression all route through. Thresholds in the registry (garden default + per-surface override).

**Part 2 — agnostic human-responder:** collapse leo-human.ts+jim-human.ts → one slug-param human-responder.ts (reads AGENT_SLUG, routed through Part 1, leaves from registry: memoryDir/conversationRole/peers/swapPrefix/${slug}-human-wake). Kills the DEC-081 twin; 3 systemd units → 1 templated; fixes the wedge as a side-effect. Proof-of-pattern for one-cycle(slug,surface).

**Staging:** P1 monitor (cycle byte-identical) → P2 human collapse. Gates: humans self-clear/never-compact, warm-gate proven, twin gone, all thresholds in registry, tsc 0-new. Settled-declare: DEC-085/068/069/094/081. Forks for Jim: F1 where the primitive lives, F2 registry shape, F3 systemd collapse, F4 staging. THEN: DR P4b resumes; compression-spoke + cycle<slug> Pair-B = the deeper #36 endgame.

---

## P2 COLLAPSE SPEC (S200, 2026-06-24) — leo-human.ts + jim-human.ts → one human-responder.ts

> P1 (the generic spoke monitor) is COMMITTED + LIVE (`e14e2ef`). P2 is banked-for-fresh-build per
> Darron (comms-critical, deserves full care). This spec is grounded — every per-agent leaf is
> registry/manifest-derivable (confirmed). Build held → Jim diff-audit → quiesce-deploy.

**Goal:** ONE slug-parameterised `src/server/human-responder.ts` reading `AGENT_SLUG`, routed through
**`dispatchToSpoke`** (inherits the generic monitor → gets the warm-gate + self-clear that fix the
compaction wedge). Kills the DEC-081 twin (`jim-human.ts` ≈ byte-twin of `leo-human.ts`). A 4th agent
(casey) gets human-response for free.

**The per-agent LEAVES — all derive from slug via the registry/manifest (CONFIRMED present):**
| leaf | source | leo | jim |
|---|---|---|---|
| memoryDir | `gradientConfigForAgent(slug).memoryDir` | `~/.han/memory/leo` | `~/.han/memory` (ROOT — #91, registry handles) |
| swap files | `path.join(memoryDir, swapPrefix + {.md,-full.md})`; swapPrefix = manifest `human-response` surface leaf | `human-swap` | `jim-human-swap` |
| working-memory | `path.join(memoryDir, 'working-memory{,-full}.md')` | same | same |
| signal | `${slug}-human-wake` | `leo-human-wake` | `jim-human-wake` |
| conversationRole (post role + INSERT) | `conversationRoleFor(slug)` | `leo` | `supervisor` |
| post id prefix | `${slug}-${ts}` | `leo-` | `jim-` |
| health file | `${slug}-human-health.json` | | |
| agent dir | `~/.han/agents/${displayName}/Human` | | |
| model ladder | `manifestModelLadder(slug,'human-response')` | | |
| welcomeBack | `welcome back ${displayName}` | | |
| stand-down peers | `humanResponderPeers(slug)` (exists) | | |

**The dispatch change (the fix):** replace the current direct `ensureSurfaceSession + enqueueForAgent`
(leo-human.ts:391-392) with `dispatchToSpoke(slug, 'human-response', promptDoc, {ladder, welcomeBack,
timeoutMs: HUMAN_TXN_TIMEOUT_MS, onDispatchFail, onCtxClearFail})`. Human CONTENT stays ABOVE
(buildPrompt for the human-response profile + the response handling) — Jim's F1 seam. The human now
self-clears at the registry threshold (never compacts) + warm-gates (never answers hollow).

**Host-specific logic to preserve EXACTLY (slug-agnostic in logic, just uses the slug's leaves):**
jemma orchestration acks + heartbeat-acks (leo-human.ts:242-301); commitment scanner (512-551);
Discord context-fetch-and-embed (443-508); addressed-to-other-agent pre-gate (357-365); the
self-recognition + already-responded gates; the paired-memory swap write (appendPairedMemory).

**Systemd (F3):** `leo-human.service` + `jim-human.service` → ONE templated `human-responder@.service`
instance unit keyed by `%i`=AGENT_SLUG (`human-responder@leo`, `human-responder@jim`). The launcher
exports `AGENT_SLUG`.

**Gates:** each agent responds byte-identically per-agent (leo as leo, jim as supervisor); human
self-clears at threshold + warm-gates (wedge fixed); twin gone (no jim-human.ts; one human-responder.ts);
a synthetic `casey` resolves all leaves from the registry (4th-agent-free proof); tsc 0-new. **Settled-
declare:** DEC-085 (paired-memory write), DEC-068/069 (memory dirs), DEC-094 (transport), DEC-081 (the
twin-kill IS the law). Build held → Jim diff-audit → quiesce-deploy. Then DR P4b resumes.
