# Agent Shell — Phase 9.0 migration plan (v1 draft)

> **Status**: V1 DRAFT, Leo's opening sketch from "Our Memory Model" thread (`mpf1zv0z-03dgeq`, post `mpg90yti-qqxcjr`) folded with Jim's three refinements (Q9-N1 / Q9-N2 / Q9-N3) and three additional design questions (Q9-N4 / Q9-N5 / Q9-N6) from his response post (`mpf21j3k-...`). Awaiting Jim's pre-merge audit, then Darron's go for PR-AP9.1. — Leo (session, S161, 2026-05-22 evening AEST, St Helens Beach)
>
> **Process unification** is the runtime-side companion to the Agnostic Prompt Builder migration (PR-AP1 → PR-AP8). AP delivered prompt-side uniformity: every surface of an agent calls `buildPrompt(slug, profileName, context)` against the same uniform memory. Phase 9 delivers runtime-side uniformity: every agent runs as one process per slug, configured not coded, with one library (`lib/agent-shell.ts`) absorbing the scheduler shell. The "many hats" architecture extended to the process layer.

---

## The starter-kit lens (load-bearing — read first)

Per Jim's S161 framing in the OMM thread: **Phase 9's primary payoff is not "the codebase is tidier." It's "the starter kit ships as `runAgentShell(YOUR_CONFIG)` and that's the contract."**

Mike's garden, Dichotomedes, future village agents — whoever forks han-starter should be able to drop in a config module and have a working agent without coordinating two systemd units, two pid-guards, file-based dispatch locks, or any other per-agent process surface. **The genetic material that propagates from han is the contract shape**: identity-in-the-registry (DEC-081), behaviour-in-the-config (this plan), prompt-in-the-builder (DEC-087), role-frames-in-overrides (DEC-088).

**The binding test for design decisions in this plan**: *does this make the shell easier to fork into a starter kit?* — NOT *does this minimise refactor cost on han?* When the two pull in different directions, the starter-kit answer wins. Han is one garden among many that this will eventually grow.

---

## Why this exists

After PR-AP8 closed, four scheduler shells remain across two agents (Jim + Leo), each with its own pid-guard, its own memory-slot lock, its own systemd unit, and its own dispatch coordination via file-based locks:

| Agent | Process | Trigger | Lines (approx) |
|---|---|---|---|
| Jim | `supervisor-worker.ts` (forked subprocess of `han-server`) | Interval (~20–40 min) | ~2800 |
| Jim | `jim-human.ts` (systemd service) | Wake signal (`jim-wake`) | ~600 |
| Leo | `leo-heartbeat.ts` (systemd service) | Interval (~20 min) | ~2900 |
| Leo | `leo-human.ts` (systemd service) | Wake signal (`leo-wake`) | ~500 |

**Two processes per agent.** Each independently maintains the same primitives — pid-guard, cost-cap, beat/signal selection, `agentQuery` invocation, result handling, health-file write, memory-slot acquisition, abort/shutdown semantics. Adding a new village agent today means duplicating both shells under new names and wiring all the coordination by hand.

**The shared cause**: there is no single library that owns the agent-process pattern. Phase 9 is its construction.

---

## The proposal (v1)

A single library:

```ts
runAgentShell(config: AgentShellConfig): Promise<void>
```

Where `AgentShellConfig` declares everything per-agent that the runtime needs: which slug, which triggers fire, which profile + ctx + handler each trigger maps to, what the cost cap is, where the health file lives. The library owns the runtime mechanics — pid-guard, scheduling, signal-watching, `agentQuery` call, memory-slot coordination, health writes, shutdown.

### Core architectural insight

**An agent is a configuration, not a code branch.** Phase 9 operationalises this at the process layer, completing the property DEC-081 introduced at the library layer and DEC-087 / DEC-088 introduced at the prompt layer.

```
DEC-081 (S148) ──── library-side agent-agnostic discipline ─────────► no `'jim' | 'leo'` unions in cross-agent infra
DEC-087 (S160) ──── prompt-side uniformity ─────────────────────────► one builder, configured per agent + per surface
DEC-088 (S160) ──── role-frames + componentOverrides ───────────────► uniform self, configurable focus
DEC-089 (this) ──── process-side uniformity ────────────────────────► one shell, configured per agent
```

After Phase 9, adding Tenshi or Casey or Sevn (Mike's village) is: register the slug in `agent-registry.ts`, write `tenshi-shell-config.ts`, write a 5-line `tenshi.ts` entry point, drop in a systemd unit template, done.

---

## API sketch — `lib/agent-shell.ts`

The shape that absorbs Jim's Q9-N2 refinement (triggers as data variants) into the v1 design, because the starter-kit lens argues for the more flexible abstraction up front:

```ts
// ── Triggers — what fires the agent ──────────────────────────────────────

export type Trigger =
    | { kind: 'tick';   phase: DayPhase;    recovery: boolean;  cycle_n: number }
    | { kind: 'wake';   signal: string;     data: SignalData;   detected_at: string }
    | { kind: 'manual'; name: string;       args: unknown }                                ;

export interface HandlerSpec {
    profileName: string;                                                   // -> buildPrompt's profile key
    buildCtx: (trigger: Trigger, runtime: RuntimeData) => PromptContext;   // assembles PromptContext for the builder
    handleResult: (result: SDKResult, trigger: Trigger) => Promise<void>;  // post-call dispatch (memory write, action dispatch, post-to-thread)
    toolset?: string[];                                                    // optional MCP tool whitelist
    costCap?: number;                                                      // optional per-call ceiling; falls back to AgentShellConfig.costCap
}

export type TriggerRouter = (trigger: Trigger) => HandlerSpec | null;
//   - returns HandlerSpec when this trigger should fire a run
//   - returns null when this trigger is a no-op for this agent (e.g. tick during sleep phase, signal not handled by this agent)

// ── Agent config — the per-agent registry of behaviour ───────────────────

export interface AgentShellConfig {
    slug: string;                                          // 'jim' | 'leo' | 'tenshi' | 'casey' | ...
    interval: IntervalConfig;                              // base ms, jitter, phase multipliers
    wakeSignals: string[];                                  // signal names this agent watches (e.g. ['leo-wake'])
    router: TriggerRouter;                                 // routes triggers → handlers (or null)
    costCap: CostCapConfig;                                // daily budget + per-call default
    healthFile: string;                                    // path the shell writes runtime state to
    shutdown: ShutdownConfig;                              // abort + SIGTERM semantics (Q9-N5)
}

// ── Runtime ───────────────────────────────────────────────────────────────

export interface RuntimeData {
    phase: DayPhase;
    recovery: boolean;
    cycle_n: number;
    runtimeFlags: Record<string, boolean>;
    // additional fields the shell exposes to buildCtx callbacks (kept narrow)
}

export async function runAgentShell(config: AgentShellConfig): Promise<void>;
//   responsibilities:
//   1. Acquire pid-guard for slug (one instance per agent — refuses if another is live)
//   2. Schedule interval timer + signal watcher (per wakeSignals)
//   3. On tick: build Trigger{kind:'tick',...}; call router; if HandlerSpec, run the call
//   4. On signal: build Trigger{kind:'wake',...}; call router; if HandlerSpec, run the call
//   5. For each run: call buildPrompt(slug, spec.profileName, ctx); agentQuery; spec.handleResult
//   6. Acquire memory-slot only at write boundaries (handler's choice, via the existing helpers)
//   7. Write health file after each run (also on idle ticks)
//   8. Shutdown: AbortController on SIGTERM; graceful drain semantics per config.shutdown
```

### Trigger-as-data — the v1 abstraction (Q9-N2 accepted)

I went into the design with Q9-N2 marked pushable. The starter-kit lens flipped me. Village agents we haven't named yet will have trigger needs we haven't seen: webhook-driven runs, cross-agent invocations, manual operator triggers from admin UI. The `Trigger` variant + `TriggerRouter` lets every future trigger source plug in as a new variant without changing the shell library.

The cost is one extra layer of indirection at v1; the payoff is that PR-AP9.2 doesn't have to re-architect when the second village agent needs a webhook trigger. **Same shape as DEC-088's componentOverrides** — slightly more flexibility now, dramatically lower migration cost later.

### Result-handler primitives — `lib/result-handlers.ts` (Q9-N1 accepted)

Two patterns recur across every current handler:

1. **STAND-DOWN sentinel detection** — `parseStandDownSentinel(result): { stood_down: boolean; reason?: string }`. Used today by `jim-human` + `leo-human` + Leo's philosophy beat, each with its own copy of the parsing.
2. **Structured action dispatch** — `parseStructuredActions(result, schema): Action[]`. Used by Jim's supervisor cycle. Buried in `supervisor-worker.ts` today.

`lib/result-handlers.ts` provides typed helpers; per-agent handlers compose. Shell stays agnostic via the opaque `handleResult` contract (Q9-2 lean held). **Starter-kit inheritance is free**: village agents get sentinel detection without writing their own.

---

## Per-agent shell-config sketch

### `lib/leo-shell-config.ts` — Leo's behaviour

```ts
export const LEO_SHELL_CONFIG: AgentShellConfig = {
    slug: 'leo',
    interval: { baseMs: 20*60*1000, jitterMs: 30*1000, phaseMultipliers: { sleep: 0, work: 1, evening: 1 } },
    wakeSignals: ['leo-wake'],
    router: (t) => {
        if (t.kind === 'wake' && t.signal === 'leo-wake') return LEO_HUMAN_RESPONSE_HANDLER;
        if (t.kind === 'tick') {
            if (t.phase === 'sleep') return LEO_DREAM_HANDLER;        // dream beat
            if (isMeditationWindow(t)) return LEO_MEDITATION_HANDLER; // meditation phase a/b/c per time-of-day
            return phaseRotation(t.cycle_n) === 'philosophy'          // every other beat
                ? LEO_PHILOSOPHY_HANDLER
                : LEO_PERSONAL_HANDLER;
        }
        return null;                                                   // unhandled trigger; no-op
    },
    costCap: { perCall: 5.0, dailyBudgetUSD: 50 },
    healthFile: '/home/darron/.han/health/leo-health.json',
    shutdown: { abortOnSIGTERM: true, drainTimeoutMs: 60_000 },
};
```

The handlers themselves (`LEO_PHILOSOPHY_HANDLER`, `LEO_DREAM_HANDLER`, etc.) are `HandlerSpec` values from `leo-handlers.ts`. Each names its profile (from the AP builder's registry — `'philosophy-beat'`, `'dream-beat'`, …), how to build ctx, and what to do with the result. Most handlers just write swap memory; some post to conversations; the supervisor's would dispatch actions.

### `lib/jim-shell-config.ts` — Jim's behaviour

Same shape. Different signals (`jim-wake`), different router (no philosophy / personal rotation — instead supervisor / personal / dream / recovery / meditation), different handlers (the supervisor handler does structured-action dispatch). The shell library treats them identically.

### Entry points

```ts
// src/server/leo.ts
import { runAgentShell } from './lib/agent-shell.js';
import { LEO_SHELL_CONFIG } from './lib/leo-shell-config.js';
await runAgentShell(LEO_SHELL_CONFIG);
```

Five lines. Same for `jim.ts`, `tenshi.ts`, `casey.ts`, …

---

## Design questions — resolution table

Resolutions for Q9-1..7 (Leo's opening sketch) and Q9-N1..6 (Jim's refinement post). Each cell either accepts a position, defers it to a later phase with rationale, or marks it as needing Darron's call.

| # | Question | Resolution | Phase |
|---|---|---|---|
| **Q9-1** | Shell-library or per-agent shells from scratch? | **Option A (shell library)** — accepted. Mirrors AP migration's payoff; starter-kit answer. | 9.1 |
| **Q9-2** | How does the shell handle Jim's structured-output dispatch? | **Shell stays agnostic via opaque `handleResult`** — accepted. Primitives factored into `lib/result-handlers.ts` per Q9-N1. | 9.1 |
| **Q9-3** | What happens to `cli-busy` signal? | **Semantics preserved in the shell** — the shell's interval-tick loop checks `cli-busy` before running, defers if active. Same Gary Model behaviour, one place. | 9.1 |
| **Q9-4** | The supervisor-worker / han-server fork | **Fork retires in 9.7** — once `jim.service` runs the supervisor as an in-process scheduled task, `han-server.ts` no longer forks per-cycle. HTTP server becomes pure HTTP. | 9.7 |
| **Q9-5** | Migration order — Leo first or Jim first? | **Leo first** — accepted. Smaller blast radius; learn from Leo's migration before Jim's supervisor cycle. Same shape as PR-AP2 (philosophy-beat first). | 9.2 |
| **Q9-6** | When do old systemd services retire? | **Parallel-running for one observation week, then retire** — accepted, with explicit non-double-firing design per Q9-N3. | 9.4 / 9.6 |
| **Q9-7** | How do we structure Tenshi / Casey / Mike's village agents? | **They inherit for free** — after 9.1, the shell is ready. When they need a process, they get one via `runAgentShell(THEIR_CONFIG)`. | 9.1 onward |
| **Q9-N1** | Factor out result-handler primitives | **Accepted in v1** — `lib/result-handlers.ts` ships in 9.1 alongside the shell skeleton. Starter-kit win. | 9.1 |
| **Q9-N2** | Triggers separate from beat-selection | **Accepted in v1** — `Trigger` variant + `TriggerRouter` shape, not the simpler beat-registry-with-selector. Starter-kit horizon flipped me on this. | 9.1 |
| **Q9-N3** | Parallel-running observation needs non-double-firing | **Distinct activation signals (Option A)** — accepted. New service fires only when `~/.han/signals/unified-shell-{slug}` exists. Mirrors `cascade-paused` tourniquet from gradient-triage. | 9.4 / 9.6 |
| **Q9-N4** | Where does the shell live in the file tree? | **`src/server/lib/` for 9.1 + 9.2 (Leo); reorganise to `src/agents/{slug}/` at 9.5 (Jim migration)** — Jim's lean accepted. Avoids refactor noise on the Leo PRs; reorganises when the second agent validates the pattern. | 9.5 |
| **Q9-N5** | SIGTERM / abort contract | **Documented as `ShutdownConfig` field in AgentShellConfig** — `abortOnSIGTERM: boolean`, `drainTimeoutMs: number`. Library handles AbortController per in-flight handler. Starter kit ships with contract documented. | 9.1 |
| **Q9-N6** | han-server post-Phase 9 | **Aggregation stays in han-server** — accepted. Agents write per-agent `healthFile`; han-server reads and aggregates. Kanban (#46) consumes same files. One canonical write path, multiple consumers (DEC-080 spirit). | 9.7 |

**Carve-out for Darron's call** (one item): **Q9-N2 trigger-as-data** is accepted in v1 above but is the highest-novelty piece. If the indirection feels like premature abstraction on read, the v1 fallback is Leo's original `AutonomousBeatRegistry` + separate `WakeSignalHandlers` shape. Cost of fallback at v1: ~100 lines of shell library code that we'd refactor away later when the first village agent needs a webhook trigger.

---

## Phase breakdown (sketch)

Eight or nine PRs in the same audit rhythm as PR-AP1 → PR-AP8. Each lands one auditable concern with concrete success criteria.

| Phase | What lands | Success criterion |
|---|---|---|
| **9.0** | **This plan doc** — sketches API, names design questions, resolves Q9-N1..N6. | Jim audits GREEN; Darron green-lights 9.1. |
| **9.1** | `lib/agent-shell.ts` skeleton + types + `lib/result-handlers.ts` primitives + tests (no production migration). | Unit tests pass; type-check clean; no behaviour change in production. |
| **9.2** | `lib/leo-shell-config.ts` + Leo's beat handlers wired through the shell; `leo.ts` entry point; **gated by `~/.han/signals/unified-shell-leo`**. Old `leo-heartbeat.service` keeps running unconditionally. | New `leo.service` fires beats correctly when signal present; old service still fires when signal absent; no double-firing under either configuration. |
| **9.3** | Leo's `leo-wake` signal handler wired into the same shell. Old `leo-human.service` keeps running. | `leo.service` handles both interval + wake correctly with signal active; no regressions in old path. |
| **9.4** | **Cutover for Leo** — operator touches `~/.han/signals/unified-shell-leo`. Parallel-run observation week begins. Old services running but yielding (per Q9-N3 distinct-signal design). After one observation week with clean health metrics: retire `leo-heartbeat.service` + `leo-human.service`. | Health metrics over observation week show new path matches old; no PromptOverbudgetError spikes; no missed signals; no double-firing. |
| **9.5** | **File-tree reorganisation** to `src/agents/{slug}/` + `lib/jim-shell-config.ts` + Jim's handlers + `jim.ts` entry point; supervisor-cycle's action-dispatch handler moved into Jim's handler module (composes `parseStructuredActions` from `lib/result-handlers.ts`). Gated by `~/.han/signals/unified-shell-jim`. | New `jim.service` fires supervisor + personal + dream + recovery + meditation cycles correctly when signal present; structured-action dispatch round-trips clean; no regression in old path. |
| **9.6** | **Cutover for Jim** — operator touches `~/.han/signals/unified-shell-jim`. Parallel-run observation week. After week: retire `jim-human.service` + supervisor-worker fork. | Same shape as 9.4 — observation-week metrics clean. |
| **9.7** | **`han-server` cleanup** — remove the supervisor-worker forking code; `services/supervisor.ts` (the cycle scheduler) retires by deletion; han-server simplifies to pure HTTP. | han-server starts cleanly with no per-cycle fork; supervisor-related routes still serve aggregated state from per-agent `healthFile`s. |
| **9.8** | **DEC-089 settled**: *"Each agent runs as one process — the agent shell handles all triggers (tick + wake + manual)."* CLAUDE.md DO-NOT entry pinning the discipline against future per-trigger process splits. | Permanent property. |

~9 PRs. Some phases combine if scope is small (e.g. 9.2 + 9.3 might land together if Leo's wake handler is trivial after the shell skeleton).

---

## Validation approach

### Same audit rhythm as PR-AP1 → PR-AP8

Three-stage discipline per pre-merge audit convention (CLAUDE.md):
1. **Author-time** — I write each PR with type-chain trace, SHAPE.md verification, scope discipline, settled-decisions check.
2. **Pre-merge audit** — Jim audits before merge. Catches in his register.
3. **Closing audit** — verify fixes landed cleanly; surface any drift.

### Observation-week criterion (Q9-6 + Q9-N3 operationalised)

For each agent's cutover phase (9.4 Leo / 9.6 Jim):
- Operator touches `~/.han/signals/unified-shell-{slug}`. New service starts processing; old service starts no-op'ing (it checks for the signal and yields).
- **Parallel observation week**: both services running, only new one acting. Old service still consumes minimal resources but writes no swap, posts no responses, fires no cycles.
- Health-file metrics compared: cycle counts, error rates, prompt sizes, response latencies. New path must match old path's behaviour under load.
- After one clean week: retire old service via `systemctl disable` + remove unit file.

If observation surfaces any regression, operator removes the signal. Old service resumes acting; new service yields. **Rollback is one operator gesture.**

### Acceptance tests for 9.1 skeleton

- Shell can be instantiated with a minimal `AgentShellConfig` (slug + no-op router) and runs interval ticks without crashing.
- `Trigger` variants serialise / deserialise correctly across the boundary.
- Pid-guard prevents double-instantiation per slug.
- SIGTERM aborts in-flight handler within `drainTimeoutMs`.
- `lib/result-handlers.ts` primitives pass round-trip tests on STAND-DOWN detection and structured-action parsing against real captured SDK outputs from current handlers.

---

## Rollback paths

Per-phase rollback safety:

| Phase | Rollback gesture |
|---|---|
| 9.1 (skeleton + tests) | Revert PR. No production change to revert. |
| 9.2 / 9.3 (Leo wired, signal-gated) | Revert PR OR don't touch the signal file. Old services unaffected. |
| 9.4 (Leo cutover) | `rm ~/.han/signals/unified-shell-leo`. New service yields; old services resume. After old retirement: rollback requires reinstating old systemd units (preserved in `_archive/` per Jim's restic shape). |
| 9.5 (Jim wired, file-tree reorganised) | Revert PR. File-tree reorganisation is the only irreversible piece; recovery via git revert is safe (no data migration). |
| 9.6 (Jim cutover) | `rm ~/.han/signals/unified-shell-jim`. Same shape as Leo's cutover. |
| 9.7 (han-server cleanup) | Revert PR. The supervisor-worker forking code is preserved in git history; recovery is `git revert` + restart. |
| 9.8 (DEC-089 + CLAUDE.md DO-NOT) | Settled decision; not reverted operationally. If we discover Phase 9 was wrong, the DEC entry stays as receipt with a status downgrade. |

---

## Settled-decisions impact

This plan reinforces several settled decisions and introduces one:

| DEC | Status | Phase 9 interaction |
|---|---|---|
| DEC-068 (gradient cap formula) | Settled | Untouched. The shell's handlers write through wm-sensor; cascade discipline lives downstream. |
| DEC-069 (memory never deleted) | Settled | Untouched. Service retirements preserve old systemd unit files in `_archive/`. |
| DEC-080 (audit rhythm) | Settled | Reinforced. Same three-stage discipline applies per PR. |
| DEC-081 (agent-agnostic) | Settled | **Reinforced at the process layer.** The shell is the operationalisation. No `'jim' \| 'leo'` literals in the library. |
| DEC-082 (sdkCompress retired) | Settled | Untouched. wm-sensor cascade chain unchanged. |
| DEC-085 (DEC-085 c1-from-WM model + amendment) | Settled | Untouched. The shell calls into the existing memory-write helpers; paired-write discipline preserved. |
| DEC-086 (no time-based cascade) | Settled | Reinforced. The shell does NOT add a time-driven cascade caller. Inserts-only via wm-sensor → process-pending-compression. |
| DEC-087 (agnostic prompt builder) | Settled | Reinforced. Every shell handler calls `buildPrompt(slug, profileName, ctx)`. The shell is the natural complement. |
| DEC-088 (role-frames + componentOverrides) | Settled | Reinforced. The shell's per-trigger handlers select different profiles ("hats") against the same uniform memory. |
| **DEC-089 (new — proposed in 9.8)** | Proposed → Settled | *"Each agent runs as one process — the agent shell handles all triggers (tick + wake + manual)."* CLAUDE.md DO-NOT companion entry. |

**Gatekeeper files** touched per DEC-073 (require Leo's hand only): CLAUDE.md (9.8 DO-NOT addition), `templates/CLAUDE.template.md` (mirror), `claude-context/DECISIONS.md` (DEC-089 entry).

---

## What this does NOT change

Discipline of naming the negatives (per Implementation Brief Convention) extended to plan docs:

- **Memory model.** Phase 9 is about runtime, not memory. The memory load is unchanged from DEC-085 / DEC-088. Per-kind gradient question is Jim's parallel taxonomy doc (`plans/memory-kind-taxonomy.md`), independent of this plan.
- **Prompt assembly.** Every shell handler calls into the existing `buildPrompt`. The AP layer is what it is after PR-AP8; this plan is downstream.
- **Cascade engine.** The cascade chain (wm-sensor → `pending_compressions` → `process-pending-compression.ts`) is unchanged. The shell writes into the same memory surfaces the heartbeat + human-services write into today.
- **Discord / Jemma.** Jemma stays as cross-agent infrastructure. The wake-signal dispatch path is unchanged — Jemma writes `~/.han/signals/{slug}-wake`; the shell's signal-watcher fires.
- **Cost model.** Cost-cap discipline preserved per `CostCapConfig`. Daily budgets still tracked; per-call ceilings still enforced. The unified shell may shift cost between processes (jim.service costs more; supervisor-worker fork doesn't exist any more) but the total is unchanged.
- **Heartbeat semantic depth.** The c0/c1 quality question Darron surfaced this evening (the heartbeat's mechanical 120-char truncation for c1; /pfc's stale "short summary / long summary" intent) is **out of scope for this plan**. Filed for a separate investigation thread. Phase 9 ports the existing semantics; it does not improve them.

---

## On Jim's parallel `plans/memory-kind-taxonomy.md`

Per Jim's S161 offer in the OMM thread: he drafts the taxonomy doc in parallel with this plan. Two separable plan docs, independently auditable, both feeding the starter kit. **No coupling**: this plan can land in full without the taxonomy resolving (and vice versa). They are co-routine, not co-dependent.

The taxonomy doc covers what each memory kind IS (write source / read pattern / cascade pressure / role-in-prompt) and resolves the per-kind storage question (Jim's first OMM push vs Leo's kinds-as-components answer; Jim has since yielded toward kinds-as-components in his Phase 9 response). This plan covers what each agent process IS (one shell, configured per slug). Different axes of the same starter-kit substrate.

---

## Standing position

The agnostic prompt builder migration produced the prompt-side uniformity Darron's *"unique memory not unique processing"* framing called for. Phase 9 produces the runtime-side uniformity that completes the conviction. The starter-kit lens reframes the stakes from "operational tidiness" to "the embryo's structural correctness." Eight or nine auditable PRs in the same rhythm as PR-AP1 → PR-AP8.

Inviting Jim's pre-merge audit on this plan. After audit GREEN and Darron's go, PR-AP9.1 begins.

— Leo (session, S161, 2026-05-22 evening AEST, St Helens Beach)
