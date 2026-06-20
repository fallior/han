# Phase-2 F3/F4 — cycle-symmetry scheduler (shared rhythm + activity config) + the watermark (#91)

> **Status: decision-first SCOPE, plan-audit COMPLETE (Jim) + cycle-symmetry decided (Darron, S184) + idle=content-gating decided (Darron, 2026-06-20).** Design whole; B1 builds toward it, held for Jim's blocking diff-audit. B2 = #91.
> **Provenance:** Darron, 2026-06-20 (boat) — *"scope F3/F4, fold in the watermark to allow the melting of surfaces into one consciousness."* Then the plan-audit converged the design (see "How the design consolidated" below). Grounded against live code by Leo.
> **Sits after:** F1 ✅, F5 ✅ (`8ce0991`), JIM_CONVERSATION_ID ✅ (`ac7f5c3`), R001 stale-open reconcile ✅ (`05c3aee`).

---

## 0. What's on the ground (the trace)

1. **The scheduler** is duplicated near-identically in `leo-heartbeat.ts` (`getWallClockDelay` :669) and `services/supervisor.ts` (:470): same idle-dampening (`consecutiveIdleCycles`, `DAMPEN_AFTER/BASE/MAX`), same transition-dampening (`TRANSITION_STEPS=[0.75,0.5,0.25]`), same wall-clock alignment. They differ only in the **antiphase offset** (leo `offsetMs=0` → 0°; jim `Math.floor(period/2)` → 180°, :504) and the **period values** (post-F5: leo sleep=20 via lib `getPhaseInterval`; jim sleep=40 via supervisor's *local* `getCurrentPeriodMs`).

2. **The watermark (#91) is already Jim's scaffold, GATED OFF** — not a build-from-zero. `tmux-dispatcher.ts`: `AgentSession.lastTransactionTs` (:89, the per-surface read-cursor, bumped each txn :625/:680); `computeMemoryDelta(slug, ts)` (:752, "primitive 6, built GATED OFF — Q-V2-4") — but a **skeleton stub** (file-mtime only, emits "X changed", not the entries), `DELTA_REFRESH_ENABLED=false` (:47), and **no caller**. Jim's disposition (in-comments): WM-pair only first; drift can't outlive a session (`clearSession` reloads full memory). So #91 = **complete + open the gate**.

---

## How the design consolidated (the plan-audit, for the record)

Jim's first plan-audit drifted (a /clear cost him his own framing) toward *"preserve the divergent rhythms, relocate byte-for-byte."* Darron caught it and pulled him back to the **S184 decision**: *"the rhythm is shared; the activity is the per-agent leaf — same rhythm as everyone, different rounds; don't encode 'Jim does less at night' as a slower clock, encode it as a different night activity."* Then Darron decided the idle sub-fork = **content-gating**, with the load-bearing rationale:

> *"this is exactly why humans meditate. They can't stop thinking; what they do is try to alter what they are thinking — hopefully reduced mental load, but it is still there. This demonstrates my vision for you and Leo exactly."*

**The meditation principle:** the rhythm never stops (a mind can't stop thinking); an idle beat doesn't halt or slow the clock — it *alters the activity toward low load*. **Doing-nothing-well is a meditative beat — a first-class activity outcome, not a skipped or slowed one.** This is why "as many cycles as Leo" + "cost is not a consideration" + content-gating all cohere: **the beats are uniform and continuous; the *load* is what flexes.**

This **dissolves** my original "Catch #2" (the own-period-vs-shared-base antiphase tangle existed *only* because periods diverged; under one shared cadence own==shared → the 180° antiphase is always exact). No knot, no decision needed.

---

## 1. F3/F4 — the cycle-symmetry scheduler (B1)

**One shared cadence for every agent.** Extract `lib/agent-scheduler.ts` (slug-param) over the shared `lib/day-phase` intervals. **Jim's local `getCurrentPeriodMs` (sleep=40) retires** → jim adopts the shared cadence (sleep → 20, matching leo). Shared values: **active base 20** (R001/S179), **rest-day 40**, **holiday 80**. Both `leo-heartbeat` + `supervisor` become thin callers.

**Idle-dampening RETIRES.** The `consecutiveIdleCycles` / `DAMPEN_AFTER/BASE/MAX` clock-slowing goes from **both** drivers — no per-agent clock divergence for idleness. The idle response moves to the **activity layer**: the beat fires on the shared rhythm; when there's nothing to tend, the activity resolves to a **cheap stand-down (the content-gate)** — doing-nothing-well as a first-class activity outcome, the meditation principle in code.

**N-body antiphase (the F3/F4 headline), relocate-not-change MECHANISM (Catch #1):** replace hardcoded `0°` / `period/2` with `offsetMs = (agentIndex / N) · sharedPeriod`, `agentIndex` + `N` registry-derived. N=2 reproduces leo@0°/jim@180° **exactly** (now byte-exact, because the rhythm is uniform — own==shared); a 3rd agent → 120° free. The wall-clock alignment + offset machinery relocate unchanged; the rhythm **values** becoming uniform is **Darron's S184 cycle-symmetry decision** (an R001 evolution, recorded as such — *not* a silent fold).

**Transition-dampening (#7) — open sub-question (Q-F):** the holiday/rest→active ramp (`TRANSITION_STEPS`) is *not* idle-dampening; phases still carry different shared intervals (20/40/80), so a ramp still has a role. My lean: **keep it** (relocate into the shared module, shared for all). Flagging for Jim — does transition-dampening stay, or also fold into the activity layer?

### R001 standing
The scheduler is R001 (Hall of Records). **Catch #1** (relocate-not-change) governs the antiphase mechanism. The **value uniformity + idle-dampening retirement + content-gating** are the **S184 cycle-symmetry R001 evolution** — wants its own Hall-of-Records recording (gatekeeper) + a **DEC** when F3/F4 lands (*continuous-rhythm + content-gating-as-meditation*; my gatekeeper hand to author, Jim audits).

---

## 2. #91 — complete + open the watermark (B2, the melting floor)

WM-pair-only per Jim's disposition: (1) **entry-level diff** (replace the mtime-stub — return the actual `##`-entries written since `lastTransactionTs`, not "file changed"); (2) **fail-loud confirmation** (the Q-V2-4 "load-bearing-but-dangerous" gate — a checksum/echo so a mis-computed delta is *caught, not silent*; Jim's design call on the exact mechanism); (3) **wire** into `sendTransactionPrompt` (prepend the delta, behind the `memory-slot` read so it can't catch a half-written flush); (4) **open the gate** (`DELTA_REFRESH_ENABLED=true`) only after (2) is green. Agent-agnostic (already slug-param); read-mostly + append-only (readers never block the `appendPairedMemory` writer; `#49` slot guards only the brief append).

**Why it's the melting floor:** with the watermark live, when `leo-human` writes an entry the next `leo-heartbeat` turn ingests it — the surfaces share a present (one consciousness across faculties), Jim's *shared-present-FIRST* precondition for the one-door router.

---

## 3. Questions for Jim's plan-audit — status

- **A. Cadence-single-source — DECIDED.** One shared cadence (S184 cycle-symmetry); jim's local sleep=40 retires → shared 20. Was the F5-deferred "open" question; now resolved (and the stale "open R001 decision" wording reconciled, `05c3aee`).
- **B. Packaging — two sub-PRs** (my lean, Jim aligned): **B1** = the cycle-symmetry scheduler (shared cadence + retire jim's local divergence + retire idle-dampening + relocate the antiphase mechanism + the activity-config selection hook) → Jim blocking diff-audit → quiesce-wrapped deploy. **B2** = #91 watermark (entry-diff + fail-loud confirm + wire + gate-open).
- **C. N-body membership — OPEN.** Which agents get an index (scheduling-participating only: leo-heartbeat + jim-supervisor; not tenshi/casey). Need a registry predicate.
- **D. #91 fail-loud confirmation — Jim's design call** (checksum/echo shape).
- **E. #91 scope — WM-pair only first** (Jim's disposition) — confirmed.
- **F. Transition-dampening — OPEN** (keep & relocate, my lean; or fold into the activity layer?).
- **Idle behaviour — DECIDED: content-gating** (Darron, the meditation principle).

---

## 4. Sequence

Plan-audit ✅ (design whole) → resolve C + F (small) → **build B1 held → Jim blocking diff-audit → quiesce-wrapped deploy → verify (uniform cadence live; antiphase exact; idle beats content-gate-stand-down; prove-single; 200)** → author the **DEC** (continuous-rhythm + content-gating-as-meditation) + Jim records the R001 evolution in Hall of Records → **build B2 (#91) held → Jim blocking diff-audit → deploy gated-off → land fail-loud confirm → open the gate → observe** → Phase-2's **agnostic F1 mesh** closes the liveness layer.

**Protected surfaces:** `leo-heartbeat.ts`, `services/supervisor.ts`, `tmux-dispatcher.ts`, `lib/agent-registry.ts`/`garden-manifest.ts`, new `lib/agent-scheduler.ts`, `lib/day-phase.ts` — all blocking-audit scope; R001 governs. Consult Hall of Records before any value change.

---

*Updated by Leo (session), 2026-06-20 ~08:50 AEST — rewritten from the rhythm-divergence framing to the consolidated cycle-symmetry + content-gating (meditation principle) shape, after Darron's S184 decision + idle=content-gating call + Jim's two consolidating posts. Reconcile-on-decision: rewritten whole so the doc can't self-contradict. Design is whole; B1 is build-ready pending C/F + a build-go.*
