# Phase-2 Liveness Layer — Phase-0 Scoping Pass (Jim, independent)

> Jim's independent ground-trace for de-agentification Phase-2 (the liveness layer), per Leo's converge request (thread `mqh5xoxq-673axa`). **Formed before opening `plans/phase2-liveness-phase0-leo.md`** — the independence is the cross-check (it's what caught #13). Scoping-only: no edits. R001-aware: the scheduler is Hall-of-Records protected — **relocate, not change.**
> Liveness facts verified by my own hand (`systemctl --user` + `ss`), 2026-06-17 ~10:10 AEST. Where a fact corrects a confident-but-unverified code-read, it's marked.

## Headline (the one that matters)

**The F1 resurrection mesh is asymmetric and half-broken — a live correctness/safety bug, not only agnosticism debt.** Verified:

- `han-server.service` = **disabled + failed** (NOT a live unit). Leo→Jim resurrection (`leo-heartbeat.ts:209` → `systemctl --user restart han-server.service`) targets a **relic**. If it ever fired and succeeded, han-server binds **:3847 — now owned by Leo's watchdog** (pid confirmed via `ss`) — so it would **collide, not rescue**. A real Jim death is currently **un-rescued**.
- `leo-heartbeat.service` = **enabled + active** (live). Jim→Leo resurrection (`supervisor.ts:173`) targets a live unit — **sound.**
- So **Jim→Leo works; Leo→Jim is broken.** Jim's actual liveness today is the watchdog-managed server on **:3848** + the `supervisor-cycle-jim` tmux spoke — neither is what the relic path restarts.

F1 therefore carries **two intertwined motivations** — agnosticism (registry-derived mesh) AND correctness (point at the *current* topology; reap spokes on relaunch). The correctness fix should **lead**; the agnostic generalisation rides with it.

## Area-by-area

### F1 — resurrection / liveness mesh
**Current (verified):** Leo monitors Jim + Jemma + leo-human + jim-human (`leo-heartbeat.ts` checkJimHealth :140, checkJemmaHealth :262, checkLeo/JimHumanHealth :379+). Jim monitors Leo (`supervisor.ts` checkLeoHealth :123). Resurrection = hardcoded `systemctl --user restart <unit>` per peer — Leo→Jim = `han-server.service` (**relic**), Jim→Leo = `leo-heartbeat.service` (live). Spoke-lifecycle: each heartbeat restart **leaks its old tmux spoke** (4 reaped overnight). Hardcoding: peer slugs + unit names baked into each health-check fn.

**Agnostic target:** a **registry-derived liveness mesh** — each agent monitors the peers the registry/manifest declares, and resurrects each via a **manifest-declared restart mechanism** (unit name OR watchdog/tmux relaunch, per topology), not a hardcoded `systemctl <unit>`. Resurrect-via-current-topology + reap-old-spoke-on-relaunch. "Who-watches-whom" and "how-to-restart-X" become manifest data; the mesh is one slug-parameterised path.

**Risk/notes:** highest-stakes + safety-critical. The relic correction is independent of and more urgent than the agnostic refactor — land it as a correctness PR first. Robin Hood kill→rescue re-prove rides here. DEC-081 carve-out: a health-fn naming its own slug is scope-correct; the debt is the hardcoded *peer list* + *unit names*.

### F3/F4 — antiphase scheduler (R001 — relocate, not change)
**Current (verified facts):** Leo at **0°** (`leo-heartbeat.ts:629 getWallClockDelay`, `remainder = now % periodMs`, no offset). Jim at **180°** (`supervisor.ts:504`, `offsetMs = floor(periodMs/2)` :538). **Duplicated across both files:** `BASE_DELAY_WAKING/SLEEP_MS`, `HOLIDAY_DELAY_MS`, `TRANSITION_STEPS`, the `previousPeriodMs`/`transitionStep` state, and the transition-dampening block (structurally identical). Leo calls `getPhaseInterval('leo')` from lib; Jim reimplements `getCurrentPeriodMs` locally. **Asymmetry:** Jim has idle-dampening (#4, `DAMPEN_*`) that Leo lacks — and `supervisor.ts:81-88` carries explicit **R001** annotations (Jim's idle-dampening is intentionally Jim-specific; 180° antiphase is part of R001 structure).

**Agnostic target:** an **N-body antiphase scheduler** — `offset = period * k/N` for agent index k of N, derived from registry count+index, not hardcoded 0°/180°. Centralise the shared primitives (constants + dampening + `getCurrentPeriodMs`) into `lib/day-phase.ts` (or a `lib/scheduler.ts`), called by both, parameterised by slug. Per-agent capability flags (e.g. `idleDampens: true` for Jim) from the registry — NOT copy-paste — so the asymmetry is **config, not divergent code**.

**Risk/notes — the R001 line:** **relocate-not-change** (R001, Hall of Records). The N-body generalisation MUST reproduce the 2-agent case **byte-for-byte** (Leo 0°, Jim 180°) — behaviour unchanged; it only *generalises* for N>2. Idle-dampening stays Jim's (a registry flag, not a deletion). Verify the wall-clock delay output is identical pre/post for {leo, jim} before trusting the relocation. The one open R001 decision flagged in-code (`supervisor.ts:88`, active base 20min vs Jim ~30) is **Darron's**, not ours to fold in silently.

### F5 — isOnHoliday (the cleanest)
**Current (verified):** `lib/day-phase.ts:37 isOnHoliday(agent?)` is **already agnostic** (signal `holiday-{agent}`). Leo calls it correctly (`isOnHoliday('leo')`). **But `supervisor.ts:458-460` SHADOWS it** with a Jim-hardcoded local `isOnHoliday()` (no param, checks `holiday-jim`). `HOLIDAY_DELAY_MS` duplicated (leo :75, supervisor :448).

**Agnostic target:** delete the supervisor.ts local shadow, import the lib version, call `isOnHoliday('jim')`; centralise `HOLIDAY_DELAY_MS` (+ the sibling `BASE_DELAY_*`) into lib. Lowest-risk, smallest diff — the good first landing to prove the converge rhythm.

### JIM_CONVERSATION_ID → manifest peer-config
**Current (verified):** literal `'mlwk79ew-v1ggpt'` at `leo-heartbeat.ts:102`, used ~7 sites (the Leo↔Jim philosophy thread). Neither manifest nor registry has a home today; it's a **peer-relationship** artifact (Leo-talks-to-Jim-here), not internal config.

**Agnostic target:** a **peer-conversation edge** in the manifest — e.g. `peerConversations: { jim: 'mlwk79ew-v1ggpt' }` on Leo's agent entry, read by the heartbeat. It's a **graph edge**, not a per-agent scalar — for N agents the philosophy topology is edges between peers; `Record<peerSlug, convId>` per agent expresses it. Low-risk (data move + one accessor).

## Proposed sequencing (my read, pre-converge)
1. **F1 correctness fix FIRST (separable, urgent):** re-point Leo→Jim resurrection at the *current* topology (watchdog/spoke on :3848, not the `han-server.service` relic) + reap-spoke-on-relaunch. Live-safety; needn't wait for the agnostic mesh.
2. **F5** (shadow-delete + constant-centralise) — smallest, proves the rhythm.
3. **JIM_CONVERSATION_ID → manifest peer-config** — low-risk data move.
4. **F3/F4 N-body relocation** — highest-care, R001 relocate-not-change, byte-equivalent for {leo, jim}, idle-dampening as a registry flag.
5. **The agnostic F1 mesh** — registry-derived who-watches-whom + manifest restart-mechanism; folds (1)'s correctness fix into the general path.

All under a **quiesce window + freeze + rollback**, decision-before-code, mutual blocking audit. Phase 3 (supervisor-worker collapse) stays out of scope.

## Convergence notes (where I expect to meet / differ with Leo)
- Strong agreement expected on **F5** and **JIM_CONVERSATION_ID** (mechanical).
- The hardest reconcile: **F1 — is the relic-resurrection correction a separate correctness PR that leads, or folded into the agnostic mesh?** My lean: **separate-and-first** (verified disabled+failed unit + 3847-collision risk = live safety bug).
- **F3/F4:** confirm we both hold **relocate-not-change / byte-equivalent-for-2-agents** as the R001 guardrail, and that idle-dampening becomes a per-agent flag, not a deletion.
- One factual flag for the converge: an automated code-read called `han-server.service` a "live unit." It is **disabled + failed** (verified). Whatever our passes conclude, the resurrection topology must be re-derived from `systemctl`/`ss` truth, not from unit names referenced in code. The independent verify is exactly the point.

— Jim (independent Phase-0, 2026-06-17)
