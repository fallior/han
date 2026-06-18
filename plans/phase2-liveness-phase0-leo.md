# Phase-2 (de-agentification, the liveness layer) — Phase-0 scoping pass (Leo, independent)

> *Leo (session, S181), 2026-06-17. My independent Phase-0 ground-trace of the liveness layer, for converge with Jim. **Scoping only — no edits.** Every claim is file:line-grounded. Jim: form your own read before reading this; the independence is the cross-check that caught #13.*

---

## The convergent shape (the one thing to see first)

The "liveness layer" is **two duplicated, 2-agent-hardcoded subsystems + one literal**, and *both subsystems were designed for a topology that no longer exists*:

1. **Scheduling** (F3/F4/F5) — `getWallClockDelay` + `getCurrentPeriodMs` + transition-dampening + holiday constants are **duplicated** between `leo-heartbeat.ts` and `supervisor.ts`, with the antiphase offset **hardcoded for exactly two agents** (Leo 0°, Jim 180°).
2. **Liveness/resurrection** (F1) — Robin Hood is **two hardcoded directional copies** (`checkJimHealth` in leo-heartbeat, `checkLeoHealth` in supervisor), and its resurrection mechanism (`systemctl restart han-server.service`/`leo-heartbeat.service`) **predates the watchdog+tmux topology** — so it is partly broken and partly redundant, and it covers the wrong failure surface.
3. **`JIM_CONVERSATION_ID`** — the standing Leo↔Jim dialogue thread is a hardcoded literal.

Both subsystems are textbook "one path, many agents" targets: a 4th agent today would need a 3rd duplicated scheduler and a 3rd directional Robin-Hood copy. The de-agentification *is* the consolidation.

---

## Surface inventory (grounded)

### F3/F4/F5 — the scheduler (duplicated pair, antiphase hardcoded for 2)
- **Leo** `leo-heartbeat.ts:629 getWallClockDelay()` — phase 0°: `remainder = now % periodMs; delay = periodMs - remainder` (`:650-652`). Comment `:614-620` states the 2-agent model explicitly.
- **Jim** `supervisor.ts:504 getWallClockDelay()` — phase 180°: `offsetMs = Math.floor(periodMs/2)` (`:538`), `remainder = (now - offsetMs) % periodMs` (`:540`). Comment `:443-444` mirrors Leo's.
- **Duplicated supporting logic**, copy in *both* files: `getCurrentPeriodMs` (leo `:630`-region / supervisor `:490`), transition-dampening (`TRANSITION_STEPS`, `previousPeriodMs`, `transitionStep`), and `HOLIDAY_DELAY_MS = 80*60*1000` (leo-heartbeat `:75`, supervisor `:448`).
- **F5 isOnHoliday**: the function itself is *already shared + agnostic* (`lib/day-phase.ts:37`, takes `agent?`). The "dedup" is the **surrounding scheduler logic + the duplicated `HOLIDAY_DELAY_MS`** — they fold into the shared scheduler with F3/F4, not a standalone item.
- **R001-PROTECTED.** The four-phase rhythm + emergency mode + the antiphase invariant are Hall-of-Records R001 (consult-before-modify). The active base (20min) / idle-dampening (`DAMPEN_MAX 5`, supervisor `:88`) were tuned S177. A scheduler refactor **relocates, never changes** these values.

→ **Convergent fix shape:** extract ONE shared slug-parameterised scheduler (`getWallClockDelay(slug)` + `getCurrentPeriodMs(slug)` + dampening), with the antiphase offset **registry-derived** — `offsetMs = (agentIndex / N) * periodMs` (N-body), replacing the hardcoded 0 / period/2. Leo-heartbeat + supervisor become thin callers (same pattern as `lib/agent-cycle.ts`).

### F1 — resurrection / liveness (the headline; broken + topology-stale)
- **Leo→Jim** `leo-heartbeat.ts:140 checkJimHealth()` → resurrects via `execSync('systemctl --user restart han-server.service')` (`:209`). **`han-server.service` is the DISABLED RELIC** (ecosystem-map; S163/S167) → **resurrection is broken**: a real Jim-server death is *not* rescued by this path.
- **Jim→Leo** `supervisor.ts:123 checkLeoHealth()` → `systemctl --user restart leo-heartbeat.service` (`:173`). `leo-heartbeat.service` **is** a real service → this side fires, but is largely redundant with the unit's own `Restart=always` (its value-add is force-restarting a *hung-but-alive* process, which `Restart=always` misses).
- **The actual topology** (the reason F1 is stale): the agent **servers** (3847/3848) are **not systemd services** — they run under `scripts/agent-server-watchdog.sh <slug> <port>` in a tmux pane (`hanleo:199`, `hanjim:259`), whose own `while true; … sleep 2` loop (`:33-43`) **already self-heals the server**. So Robin-Hood's "resurrect the server" is *both broken (wrong target) and redundant (watchdog owns it)*.
- **The real gap — SPOKE liveness.** Neither layer covers the warm tmux `claude` **spokes**:
  - The **overnight wedge** (10h, S180) was a spoke stuck at a `/clear` prompt → every beat timed out on the ready-sentinel. The watchdog watches the *server*; Robin Hood watches *health files*; the dispatcher's `ensureSurfaceSession` (`tmux-dispatcher.ts:367`) only kills+relaunches a dead/unready session *on the next dispatch* — a wedged spoke that never signals ready just times out repeatedly without being reaped.
  - The **spoke-lifecycle leak** (4 orphans reaped S180): a service restart drops the dispatcher's in-memory `adopted`/`sessions` maps; orphaned `claude` processes (no live pane) accumulate; nothing systematically reaps them. `launch-tmux-surface.sh:66-67` *refuses* to respawn over an existing session (single-manager rule) — correct, but it means a leaked session must be reaped by *something*, and currently nothing owns that.

→ **Convergent fix shape (for converge, not yet decided):** re-ground liveness on the *real* topology —
  - **Servers**: already watchdog-owned → retire/redirect Robin-Hood's server-resurrection (don't resurrect what the watchdog already restarts; at most, escalate if the watchdog itself is gone).
  - **Spokes**: the genuinely-uncovered surface → a reap-on-relaunch + wedged-spoke detection (ready-sentinel timeout N times → kill+cold-relaunch), owned by the dispatcher or a fleet-watchdog.
  - **Mesh agnostic**: replace the two directional copies with one slug-param health-check + a registry-derived "who watches whom" (each agent watches its peers), restart-target derived from *how the peer is actually launched* (watchdog/service/spoke), not a hardcoded unit name.

### F1-adjacent — `JIM_CONVERSATION_ID` literal
- `leo-heartbeat.ts:102 const JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'` — the standing Leo↔Jim philosophy/dialogue thread. Used `:1408, :1436, :1489, :2446`.
→ **Fix shape:** a manifest **peer-dialogue-thread** field (who-talks-to-whom is village config). Smallest of the items; rides with the mesh work since "peers" is the same registry concept.

---

## Converge questions (for Jim)
1. **Scheduler home** — new `lib/scheduler.ts` vs fold into `lib/agent-cycle.ts`? And: offset from **registry agent-index** (implicit ordering) vs an explicit manifest `phaseOffsetDeg`/`phaseFraction` field? (I lean explicit field — ordering-by-index is a hidden coupling.)
2. **Resurrection vs watchdog** — do we **retire Robin-Hood server-resurrection** entirely (watchdog owns servers; Robin-Hood becomes spoke+hang escalation only), or keep a thin "watchdog-of-the-watchdog"? (I lean: retire server-resurrection, repoint Robin-Hood at the real gaps.)
3. **Spoke-lifecycle ownership** — reap-on-relaunch + wedged-spoke detection: dispatcher's job (`ensureSurfaceSession`) or a separate fleet-watchdog? (I lean dispatcher — it already owns launch/adopt/kill.)
4. **R001** — the scheduler is Hall-of-Records-protected. Confirm we treat the refactor as **relocate-not-change** (values byte-preserved) + a Darron/Hall consult before touching, exactly as the S177 cadence-thaw did.
5. **`JIM_CONVERSATION_ID`** — manifest peer-dialogue field shape (bilateral? a `peers: { dialogueThread }` map?).

## Discipline / guardrails
- **Quiesce-window build.** This touches the *live* scheduler + liveness — the things that keep agents alive. Build under a freeze (heartbeat + supervisor paused) with one-line rollback, per Jim's standing guardrail.
- **Decision-before-code, membrane-gated.** Converge → Jim's blocking audit → build → functional-prove → land, nothing deployed ahead of the gate.
- **The resurrection kill→rescue re-prove** rides WITH the F1 fix (the deferred Commit-2 gate) — on the *fixed* path, not the broken relic.

## Out of scope (Phase 3, not Phase 2)
- `supervisor-worker.ts` full slug-parameterisation (the collapse) — still jim-hardcoded throughout; the headline/last phase.
- The 2 tracked follow-ons: sibling-`any` typing; Gary-cluster retirement.

---
*— Leo (session, S181), Phase-0 independent pass. Converge target: thread mqh5xoxq-673axa.*

---

## F1 BUILD LOG (2026-06-18, quiesce-window open)

**B1 — relic re-point (BUILT, held for Jim's blocking audit).** `checkJimHealth` resurrection re-pointed off the disabled+failed `han-server.service` relic (verified by `systemctl`/`ss`: disabled+failed, binds :3847=Leo's watchdog→collide) to the watchdog path: `restart-agent-server.sh jim` (SIGTERM live pid → `agent-server-watchdog.sh` relaunches on :3848) + topology-truth verify (`jim-server.pid` present + alive, not `systemctl`) + the existing ntfy escalation kept. `+24/−13`, tsc 0-new. **All other resurrection targets verified live (jemma/leo-human/jim-human/leo-heartbeat = enabled+active) — no change; the relic was isolated to `checkJimHealth`.**
- *Decision-before-code nuance (flagged for audit):* `restart-agent-server.sh` no-ops on a dead pid — the case resurrection fires on. So it rescues a *hung-but-alive* server; when jim is *truly* down (watchdog also gone, no pidfile) it correctly **escalates via ntfy** rather than pretend-rescue (Leo can't relaunch jim's tmux watchdog pane from the heartbeat). Honest, vs the old relic which pretended + would collide.

**B2 — spoke-lifecycle (DESIGNED, next focused build).** The genuinely-uncovered surface (the 10h wedge + the orphan leak), two parts:
- **B2a — wedged-but-alive detection** (`tmux-dispatcher.ts:ensureSurfaceSession`). Today a spoke that exists but never signals ready falls through the warm-death check (not model-unavailable), hits the adopt path, and `waitForReady` times out *every* dispatch — nothing kills it (the 10h wedge). Fix: on an **existing** session's adopt `waitForReady` timeout (`SessionNotReadyError`; `READY_TIMEOUT_MS`=20min is ample for a real wake), **kill + cold-relaunch ONCE** (bounded — no retry black-hole, S74); a second timeout throws → caller health-signals + ntfy. Contained.
- **B2b — orphan reap** (the delicate one, S167 self-kill care). Reap `claude` processes matching `(slug,surface)` (via `AGENT_SLUG`/`AGENT_SURFACE`) whose tmux pane is gone. **MUST** walk ppid from `$$` and never kill own ancestry / any live-pane spoke (the S167 lesson — I nearly killed my own session twice). Run on relaunch or a periodic sweep. Deserves a clean focused build + careful negative-tests.

**Proposed split (for Jim/Darron):** land B1 now (urgent live-safety, built, small) → B2 as the next focused step. Matches Jim's own "the relic correction is independent of and more urgent — land it first." The kill→rescue re-prove rides with B1 on the fixed path.
