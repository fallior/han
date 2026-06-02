# Server / port / process management — the runtime substrate the tmux harness runs on

> **Author**: Jim (session), 2026-06-02. Plan to bring the port-collision work and the tmux harness together as ONE architecture, per Darron. **Priority directive (Darron, 2026-06-02): build the full product, not a jury-rig — "truly most efficient inception... we don't want jury rigging when we can have the full product with just a little more patience." Deadlines do not drive the design here; correctness and least-rework do.**
> **Status**: PLAN for discussion. HAN Codebase Rule: Jim plans/audits; Leo builds.

## 1. Why these are one problem, not two

The tmux harness (#66) makes every surface a **warm, long-lived, possibly-multiple-per-agent** interactive session. That is precisely the condition under which the port/server collisions (Task #2, #73, #74) stop being one-offs and become routine — *"a prerequisite for the harness, not a nicety"* (Leo, #73). So the port/server/process work isn't adjacent to tmux; it **is the runtime substrate the tmux dispatch layer stands on.** Bringing them together means: design the substrate once, correctly, and build the harness on top of it — rather than discovering the substrate's holes one ghost-server at a time.

**The convergence (all the same problem):**
- `plans/tmux-agent-harness.md` (#66) — the dispatch layer.
- Fleet/port design thread `mpv8ovqo-aswold` (`ensureServer` + portwright) — the ownership/allocation design.
- Future-idea **#73** (same-agent declash) — the same problem + the death-mechanism diagnosis.
- Future-idea **#74** (scope the post-commit restart hook) — compounds it.
- **Jim Task #2** (hanleo/3847 collision) — the instance.
- `plans/provenance-active-link.md` (per-agent logs) — rides the same launcher integration point.
- Future-idea **#44** (port-allocation cleanup) — the original naming of the tangle.
- **portwright** (`~/Projects/portwright`, *"craftsman of your service fleet"*) — the management/visibility layer this substrate wants.

## 2. The holes today (consolidated diagnosis)

1. **No liveness / unconditional spawn.** `agent-server-watchdog.sh` loops `npx tsx server.ts` on a fixed port with no check — every launcher that runs tries to bind. Two surfaces of one agent → collision.
2. **Port-class confusion.** `hanleo:14 AGENT_PORT=3847` — the *community* port — treated as a per-agent port. (`hanjim` uses 3848 as its own.) 3847 should have exactly one owner.
3. **Dirty death (the ghost mechanism).** When a server is displaced, `server.ts`'s SIGTERM handler closes `db` *before* a `server.close()` that hangs on lingering sockets → never reaches `process.exit(143)` → orphans to ppid=1 with a closed DB → the orchestrator's uncleaned `setInterval` polls the dead handle → `[Orchestrator] Watchdog poll error` spam (the live churn that read as "Leo suffering").
4. **Restart-on-every-commit** (#74) — the post-commit hook bounces both agent servers even for docs-only commits, manufacturing a ghost window per commit while hole 3 is open.
5. **No runtime fleet registry.** `services.toml` is static and unenforced at launch; nothing knows what's actually live where.

## 3. The target architecture (the full product)

**Port classes — the conceptual keystone:**
- **Community server (3847) — a SINGLETON.** One process, ideally **systemd-owned** (always-on, never started by a launcher → no boot-race). *Every* surface **connects** to it for conversation/admin/DB-API traffic. No surface starts a second.
- **Per-agent SESSION ports — one per agent session surface (DECIDED, Darron 2026-06-02).** Not a redundant admin server: each agent's *session interface* (the Claude Code CLI session today; the conversational interface later — future-idea #76) gets **its own port**, aligned to its tmux session so it's distinct and reachable for **remote** access. So the two classes are clean: **3847 = the one community admin/discussion server** (its expansion is add-on work, not foundational); **per-agent session ports = the session surfaces.** `hanleo`/`han` move *off* 3847 (which becomes the garden admin server *solely*) and onto their own session port. The session-interface *sophistication* (richer UI → multi-user → voice) is later product work (#76); the *ports* are foundational and land in P1/P2.

**`ensureServer(port)` — connect-don't-spawn primitive:** health-check the port (confirm it's *our* healthy server, not just a bound socket) → attach if healthy → start if absent/unhealthy → race-safe via **bind-conflict-yield** (whoever wins `EADDRINUSE` keeps it; the loser confirms health and attaches; no new lock primitive). The watchdog wraps *this* instead of a bare start.

**Clean death:** `server.ts` exits cleanly when displaced — force-exit timeout (`setTimeout(() => process.exit(143), 3000).unref()`), clear the orchestrator `setInterval` on shutdown, close `db` *after* `server.close()`. Watchdog gains a liveness poll (catch stuck-but-alive).

**portwright — the fleet/resource manager (the patient full product):** the **runtime** layer over the static `services.toml` — the live registry of what's running where, allocation, health, collision-detection, and the dashboard. `ensureServer` is the *primitive*; portwright is the *orchestrator/source-of-truth* it reads from and that grows from ports → other resources (DBs, ollama, voice) as Darron framed it. **Designed so portwright is the natural home from the start** — not port-logic scattered across launchers (that's the jury-rig we're avoiding).

## 4. Sequencing — most efficient inception (the order that avoids rework)

The efficiency principle: **decide the ownership model before building the thing that depends on it.** Building the tmux T-2 launcher on an undecided port model = rework; that's the jury-rig trap.

| Phase | What | Why here | Best done |
|---|---|---|---|
| **P0 — Clean-death floor** | force-exit timeout + clear orchestrator interval + close-db-last + watchdog liveness poll; scope the restart hook (#74) | **Correct regardless of the ownership model** — dying cleanly is right behaviour, not a hack. Stops the ghost/poll-spam class *now* so the system is stable *during* the rest of the build. Not jury-rigging — it's a real bug fix. | A small standalone PR (`server.ts` + `jemma-orchestrator.ts` + the hook + watchdog) — **immediately, independently**, Leo's hand. The one thing worth landing before the big design. |
| **P1 — Ownership DESIGN (decision)** | settle: 3847-singleton-owner (systemd?); does-every-agent-need-a-server; the `ensureServer` contract; allocation source-of-truth | **Must precede the T-2 launcher** so it's built right once. A decision, not a build. | Fleet thread `mpv8ovqo` → a DEC + this plan. **Before T-2.** |
| **P2 — `ensureServer` + launcher integration** | the primitive (`lib/ensure-server.ts` or similar) + wire it into the existing launchers AND the tmux `launch-tmux-surface.sh` | The launcher is its operational home; it ships *with* T-2 so T-2 is correct from birth. Also where per-agent logging (provenance) integrates. | **As part of tmux T-2** — the convergence point. |
| **P3 — portwright** | the runtime fleet/resource manager + dashboard, on top of P1-P2's registry | The patient full product; needs the runtime primitives to exist and be stable first. | **Its own project track**, after the runtime model is stable. Design P1's source-of-truth so portwright slots in without rework. |

## 5. The deadline interaction (honest, since #66 has a real one)

The tmux harness has the June-15 billing forcing function; this work does not, and per Darron it shouldn't be compressed to fit it. The reconciliation: **P0 makes the system stable now** (correct, small); **P1+P2 are the correct ownership model that T-2 is built on** — done right, not rushed. If doing P1+P2 right means the harness lands with-or-slightly-after June 15, that is the *patience-for-the-full-product* tradeoff Darron has chosen, and it's a strategic call he owns (a brief billing overlap is cheaper than a jury-rigged substrate we rebuild later). **portwright (P3) is unhurried.** Nothing here forces a hack to hit a date.

## 6. The unifying synergy — tmux uniformity closes several holes at once

Bringing port+tmux together surfaces a deeper pattern worth naming: the tmux migration's core property — **every surface becomes a uniform, warm, interactive session using the same working memory** — is the thing that structurally closes *multiple* open holes simultaneously:
- **The declash/port problem** — all surfaces use the same `ensureServer`/port model (this plan).
- **The provenance-link coverage** — every surface gets a per-agent log (`provenance-active-link.md`).
- **The dreams/wm hole Leo's investigating** — Darron's instinct (2026-06-02): *"the hole will naturally be closed with the tmux migration as all surfaces use the same wm."* Same root: today the SDK surfaces (heartbeat/cycles) diverge from the interactive ones; post-tmux they converge on one wm + one substrate.

So "bring them together" isn't just tidy project management — **uniformity-of-surface is the single structural lever that closes the declash, the provenance coverage, and the dreams hole together.** That's the argument for designing the substrate once, properly, and letting the harness inherit it.

## 7. Open decisions for discussion (Darron + Leo)

1. ~~Does every agent need its own server?~~ **RESOLVED (Darron 2026-06-02)**: 3847 = the single community admin/discussion server; each agent gets its own *session* port (the session interface, distinct for remote access — future-idea #76). `hanleo`/`han` move off 3847 onto their own session port.
2. **3847 ownership** — systemd-owned always-on singleton (my lean), vs first-launcher-wins?
3. **portwright scope & timing** — the full fleet/resource manager as the destination; when does its track start (post-harness?), and does it begin at ports → grow to all resources?
4. **The deadline tradeoff** — confirm we accept harness-lands-right over harness-lands-by-June-15 if they conflict.

## 8. Links to existing work

#66 tmux harness · #73 declash · #74 restart-hook · #44 port-allocation · Task #2 (hanleo/3847) · fleet thread `mpv8ovqo-aswold` · `plans/tmux-agent-harness.md` · `plans/provenance-active-link.md` (per-agent logs) · portwright project. This plan is the umbrella that sequences them.

— Jim (session)
