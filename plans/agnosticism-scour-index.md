# Agnosticism Scour — the upgrade index/journal (non-agnostic agentic behaviour, marked for return)

> **Purpose**: the marking artifact for the **Agnosticism Scour (project b / jim-todos #12)** — every hardcoded-agent site in `src/server/`, classified, so the agnostic-ification can return to them site-by-site. Per DEC-081 (governing law): *infrastructure reaches for any agent via `string` + registry; no infrastructure hardcodes a finite list of agents.* **Leo-build / Jim-audit**, post-T8.
>
> **Source**: read-only scour, 2026-06-15, **THREE independent angles** (the parallel-audit method): Jim's (1) literal grep-sweep + (2) behavioural control-flow read (S174), and (3) **Leo's independent third pass — DONE & CONVERGED** (S178, thread `mqeonzn2`). All paths under `/home/darron/Projects/han/src/server/`. **This is a journal, not a work order.**
>
> **PHASE 0 (Converge) = CLOSED** (Jim reconcile-nod, S178). Leo's third pass: **zero new live-debt sites** (his literal sweep *bounded* the scour — the extra files he found — `diary-mcp-server`, `terminal`, `prompt-profiles`, `memory-paired-writer`, `tmux-dispatcher`, `discord` — are all comments/config/docstrings; the test files are fixtures with no 2-agent loops); TOP-5 + F1–F6 all confirmed, no reclassifications; **+1 naming-DEBT addition** → **`LEO_MEDITATION_PHASE_A/B/EVENING_TXN_SYSTEM_PROMPT` + `leoMeditationTxnOpening()` + `LeoMeditationSurface` (`leo-prompts.ts:257–285`)**: the *content* is fully identity-agnostic ("This turn is a MEDITATION…", no "You are Leo") and **jim's T7b handlers reuse it** via the shared `meditation-*-txn` profiles (`prompt-profiles.ts:568/583/598`) — so it's agnostic-content-with-a-leo-name = **DEBT-naming → Phase 3 agnostic rename** (`meditationTxnOpening` / `MEDITATION_*_TXN_SYSTEM_PROMPT` in a shared module). *(Jim's S174 index folded `leo-prompts.ts` wholesale into CAPABILITY — too coarse; Leo's builder's-eye caught the carve-out. The master index now = the two Jim angles + this addition.)*
>
> **The synthesis (both angles agree):** HAN has *already* absorbed most of DEC-081 — everything written **after** the registry (wm-sensor, memory-slot, sensor-lock, tmux-dispatcher, garden-manifest, jemma-rotation, conversations) iterates `registeredAgentSlugs()`. The non-agnosticism concentrates in **two places**: (a) the **two big worker files'** shared query/scan/prompt logic (angle 1 — DEBT literals), and (b) the **pre-registry coordination/liveness layer** — the Robin-Hood resurrection mesh + the 180° antiphase scheduler (angle 2 — topology encoded as *code shape*, invisible to grep). **(b) is the single coherent N-agent-readiness target**, and it's the one the literal scour alone would have missed entirely.

## Bucket totals (the scour's shape)

| Bucket | ~count | Meaning | Action |
|---|---|---|---|
| **DEBT** | ~38 | cross-agent infra hardcoding a finite list / one slug where `string`+registry belongs | **collapse** (the scour's targets) |
| **CROSS-AGENT-INFRA** | ~14 | genuinely about the *relationship between* agents (Robin-Hood mesh, peer-dialogue) | keep — but lift the *topology* to config |
| **SCOPE-CORRECT-IDENTITY** | ~210 | an agent's own worker/seat naming itself | **keep** (identity made operational) |
| **CAPABILITY** | ~12 | a difference a registry/manifest flag should express | move to manifest config |

**Already cured (the cure's destinations — no debt):** `agent-registry.ts`, `garden-manifest.ts`, `persona-registry.ts`, `tmux-dispatcher.ts`, `dream-gradient.ts` (`AgentName = string`), `routes/gradient.ts`, `routes/conversations.ts` (mostly), `jim-human.ts`/`leo-human.ts` (~120 scope-correct self-refs), `village.ts`, `wm-sensor.ts`, `jemma-orchestrator.ts`. The migration has already absorbed a large fraction; **the remaining DEBT concentrates in the two big worker files + a handful of shared query/routing sites.**

---

## 🎯 TOP-5 highest-value DEBT (do these first — they unlock a 4th/5th agent actually participating)

- [ ] **1. `db.ts:637-638`** — `getPending` / `getLastSupervisorResponse` prepared statements hardcode `role IN ('human','leo')` and `role='supervisor'`. **Shared infra, not a seat** → the single highest-leverage site: this SQL silently makes tenshi/casey conversation posts invisible to the responder scan and bakes Jim-as-sole-answerer. **Cure**: registry-derive the role set (the set of agent roles minus self).
- [ ] **2. `supervisor-worker.ts:907-933`** — the conversation-scan block: `role IN ('human','leo')`, `JIM_MENTION_RE = /\b(hey\s+jim|@jim|jim[,:])\b/`, `sender_role==='leo'?'Leo':'Darron'`. The consumer-side mirror of #1. **Cure**: registry role-set; `mentionPatternFor(slug)` (machinery already exists — `getMentionPatterns` in village.ts); sender-label from registry not a 2-valued ternary.
- [ ] **3. Resurrection topology** — `leo-heartbeat.ts` (`:267/513/580` JIM/LEO/JIM_HUMAN `*_HEALTH_FILE` + `:364-365/483/571/637` `target:'jim'/'leo'/...`) and `supervisor.ts:58/125-198` (Jim watches Leo). The Robin-Hood mesh is *correctly cross-agent-infra in shape*, but the **who-watches-whom set is a hardcoded 2-(+human-seats) graph**. **Cure**: lift the watch-topology into the manifest so a 4-agent garden forms a resurrection *ring*. ⚠ **touch carefully — this is the liveness safety net.**
- [ ] **4. `leo-heartbeat.ts:234`** — `JIM_CONVERSATION_ID = 'mlwk79ew-v1ggpt'` (a literal thread row-ID is *the* Leo↔Jim dialogue channel; used at `:1666/1694/1716/1747/1868/3112/3343`). **Cure**: manifest-config "peer-dialogue thread per agent-pair" → unlocks N-way background dialogue.
- [ ] **5. `lib/human-prompts.ts:39-55,152-159,253`** — `JIM_HUMAN_SPEC` / `LEO_HUMAN_SPEC` two hand-written specs + `roleLabel ?? 'leo'` Leo-defaulting fallback. **Cure**: fold `HumanAgentSpec` into the persona-registry → a new agent gets a human-responder persona by a config row, not a file edit.

---

## 🔍 SECOND-ANGLE FINDINGS — hidden non-agnosticism (no agent-name literal; the coordination/liveness layer)

> A second *independent* scour (method: read control-flow for fixed/2-agent **assumptions**, not string literals) found a class the grep cannot see. These are where *topology is encoded as code shape*. **Touch the liveness ones (F1) carefully — they are the resurrection safety net.**

- [ ] **F1 (CRITICAL) — Robin-Hood resurrection mesh is hand-wired, not registry-derived** (`supervisor.ts:1029-1030`, `leo-heartbeat.ts:3022-3025`). Bespoke `checkLeoHealth()`/`checkJimHealth()`/… functions (each ~60-80 lines, hardcoded health-file + `systemctl restart <unit>`) wired into two schedulers. **A 3rd agent gets NO watcher** — dies silently, never resurrected, never participates as a watcher. **Cure**: add `{healthFile, systemctlUnit, stalenessThreshold}` to the agent registry → replace the bespoke fns + two call-lists with one `for (slug of registeredAgentSlugs()) checkAgentHealth(slug)`. ⚠ per-agent thresholds genuinely differ (Leo 45/90min, Jemma 10/20min) → move to config, don't flatten. *(= the deep read of angle-1 TOP-3; this is the liveness net — sequence carefully.)*
- [ ] **F2 (CRITICAL) — `peerAgents` stand-down lists hardcode the exact 2-peer set** (`human-prompts.ts:39-59`: Jim's = `'session-Jim, session-Leo, leo-human'`, Leo's mirror). A 3rd agent has no spec AND is omitted from the peer lists → Jim/Leo never stand down for Casey's answer → **duplicate posts** (the S151 self-recognition bug, one rung out). **Cure**: derive `peerAgents` from `registeredAgentSlugs()` minus self. *(Sharpens angle-1 TOP-5 with the duplicate-post failure mode.)*
- [ ] **F3 (HIGH) — the 180° antiphase scheduler is a two-body solution** (`supervisor.ts:538` `offsetMs = Math.floor(periodMs/2)`; `leo-heartbeat.ts:783` Leo at offset 0). `period/2` only spaces **two** agents evenly; there's no "agent k of N → offset `k·period/N`". A 3rd agent copying Jim's `period/2` collides with Jim every cycle (defeats antiphase → load spikes + shared-account contention). **Cure**: `offsetMs = (agentIndex / registeredAgentSlugs().length) * periodMs`, one shared helper both schedulers import. ⚠ the two schedulers are different processes/files → needs a shared module.
- [ ] **F4 (HIGH) — `nextDelayMs` cross-signalling presumes a 2-party "the other agent" handshake** (`supervisor.ts:112`, `leo-heartbeat.ts:3216` — each writes its delay *"so the other can calculate the 180° offset"*). No answer for N parties. Coupled to F3; registry-derived phase removes the need for peer-delay signalling entirely.
- [ ] **F5 (MEDIUM) — `supervisor.ts:458` private `isOnHoliday()` hardcoded to the `holiday-jim` signal**, bypassing the agnostic `lib/day-phase.ts:37` `isOnHoliday(agent)` ("single source of truth for phase detection"). Hides because the name lives *inside the signal-string* `holiday-jim`, not an identifier. Same for the local `isRestDay`/`getDayPhase`/`getCurrentPeriodMs` duplicates of `day-phase.ts`. **Cure**: delete the local copies, call `day-phase.ts`. ⚠ confirm the duplication isn't deliberate process-isolation.
- [ ] **F6 (cosmetic) — `wm-sensor.ts:6` docstring says "both agents"** (code is correctly registry-iterating `:414-420`). Reword → "every registered agent" (stale prose mis-trains the next reader into assuming N=2).

**Negative space — CONFIRMED genuinely agnostic** (both angles checked; this *bounds* the search): `wm-sensor` (iterates registry), `memory-slot` lock (per-memoryDir+writer), `sensor-lock` (`wm-sensor-${agent}-active`), **`jemma-orchestrator` rotation** (clean N-agnostic round-robin — newcomers append at back + rotate forward; *the model the coordination layer should follow*), `routes/conversations` active-agent register, `discord.ts` webhook routing (all-personas iteration), `tmux-dispatcher` (keyed on `(slug,surface)`), `garden-manifest` (`agents: AgentManifest[]` list), the per-agent backup-drain (scope-correct). **Everything post-DEC-081 already iterates the registry.**

---

## DEBT — the full marked list (by file, most-debt first)

### `services/supervisor-worker.ts` (Jim's worker — high-value debt embedded in shared conversation logic)
- [ ] `:907-913` `role IN ('human','leo')` + `role='supervisor'` pending-conversations filter → registry role-set (TOP-2).
- [ ] `:928,933` `JIM_MENTION_RE` mention regex baked to Jim → `mentionPatternFor(slug)`.
- [ ] `:930` `conv.sender_role==='leo'?'Leo':'Darron'` sender-label → registry display-name (a tenshi post currently renders as "Darron").
- [ ] `:918,923` `LEO_COOLDOWN_MS` peer-response cooldown baked to Leo. **Jim's judgment**: the *value* is CAPABILITY (a cadence flag), the *Leo-only naming+application* is DEBT → rename `PEER_RESPONSE_COOLDOWN_MS`, apply per-peer from the registry.
- *(`:241/262/282/305/323` `r.agent==='jim'` gradient filters = SCOPE-CORRECT, annotated `// sovereignty structural`; the ~40 `jim*` meditation handlers + `processDreamGradient('jim')`/`MEMORY_DIR`→jim = SCOPE-CORRECT. No action.)*

### `db.ts` (shared prepared-statement layer — PURE infra debt)
- [ ] `:637 getPending` / `:638 getLastSupervisorResponse` — `role IN ('human','leo')`, `role='supervisor'` as SQL literals (TOP-1). The canonical offender — infra, not a seat.

### `leo-heartbeat.ts` (Leo's worker — debt in the cross-agent + dialogue portions)
- [ ] `:234` `JIM_CONVERSATION_ID` literal thread-id (TOP-4).
- [ ] Resurrection watch-list `:267/513/580` + `:364/483/571/637` targets — topology-debt within cross-agent-infra (TOP-3).
- [ ] ⚠ `:222/1382/1387` Leo's heartbeat reads **Jim's** `self-reflections-curated.md` from `JIM_MEMORY_DIR`. **Jim's judgment**: this is a **READ-ONLY cross-read for the shared philosophy-thread dialogue context** (Leo's heartbeat posts to the standing Jim thread and reads Jim's curated reflections to speak *to* Jim). S103 governs *processing* (writing/curating) another agent's memory — a read-only dialogue context is **not** a sovereignty breach. **BUT** the hardcoded peer-identity (`JIM_MEMORY_DIR`) is **topology-DEBT** → in the scour, lift "which peer's reflections I read for dialogue" to manifest peer-config. *(Quick verify owed: confirm read-only, no write path — the sweep found reads only.)*
- *(`:223/232/2276` LEO_*_DIR + the ~80 `'leo'`-passing dispatch/gradient/meditation calls = SCOPE-CORRECT, one annotated `// DEC-081 — leo-heartbeat is scope-correct for Leo's worker`. No action.)*

### `services/supervisor.ts` (Jim's health/resurrection service)
- [ ] `:58 LEO_HEALTH_FILE` + `:125-198` Jim-watches-Leo restart logic — CROSS-AGENT-INFRA with the same topology-debt as TOP-3 (hardcoded to watching only Leo). *(`:317-319` notes a prior `target='leo'` default was already removed S155 — partly de-debted.)*
- *(`:56/62/104/327/407` Jim's own health/distress = SCOPE-CORRECT.)*

### `routes/conversations.ts` (mostly cured)
- [ ] `:44 roleToAgentSlug`: `if (role==='supervisor') return 'jim'` — the surviving `supervisor→jim` role-alias. Already flagged in-code (`:40`) as "HAN-bootstrap historical reality", planned lift to persona-registry (Batch 7 Alt B). **Known, scoped bootstrap-debt.**

### `lib/human-prompts.ts` (CAPABILITY-shaped debt)
- [ ] `:39-55/152-159/253` the two `*_HUMAN_SPEC` consts + `roleLabel ?? 'leo'` default (TOP-5) → persona-registry.

### `server.ts` (CAPABILITY)
- [ ] `:342 SUPERVISOR_AGENT='jim'` + `:343 if (AGENT_SLUG===SUPERVISOR_AGENT)` — "which agent runs the supervisor cycle". Comment already frames it as the first cut toward "this server runs its OWN slug's cycle". **Cure**: a manifest capability flag (`runsSupervisorCycle: true`). *(This is exactly the scour step-1 generalisation of the T7b gate.)*

### `jemma.ts` (low / mostly cured)
- [ ] `:452 recipient:'jim'` / `:489 recipient:'leo'` heuristic-fallback classification defaults → registry. *(Primary path `deliverToPersona`/`deliverToRemoteAgent(agent:string)` already agnostic.)*
- [ ] `:445/480/704/708 deliverToJim/Leo/Sevn/Six` — mild debt (dead-ish per-agent wrappers; `deliverToPersona` superseded them per `:714`). Low priority.

### `lib/dream-gradient.ts` (trivial)
- [ ] `:63/141/219/365/612` `(agent: AgentName = 'leo')` default-parameter values — latent wrong-agent footgun; each caller passes explicitly so low-impact. Remove the default (require the arg).

### `scripts/fix-c4-gradient.ts` (lowest — throwaway)
- [ ] `:93 for (const agent of ['leo','jim'])` — one-off migration script, not live infra. Cosmetic.

---

## CAPABILITY (by-design config tables — NOT debt, the cure's home)
`persona-registry.ts:135-252`, `garden-manifest.ts:109-152`, `jim-prompts.ts`/`leo-prompts.ts` (per-agent identity prompt content). These are where the finite list *legitimately* lives.
- [ ] ⚠ **Coverage gap (not a literal-debt site)**: `garden-manifest.ts` has leo/jim/tenshi but **no `casey`** entry. **Jim's judgment**: if casey is meant to be manifest-driven, add the entry — flag for the Garden-Manifest work (#6), not the literal-scour.

## CROSS-AGENT-INFRA (keep the relationship; lift the topology)
The Robin-Hood resurrection mesh (`leo-heartbeat` + `supervisor` health-watch) and the peer-dialogue channel are *correctly* about relationships between agents. **Keep the mechanism; the only debt is that the who-watches-whom / who-talks-to-whom topology is a hardcoded finite graph** → lift to manifest (TOP-3, TOP-4).

---

## Implementation sequence (the safe build order) — locked 2026-06-15 (Jim, S174)

> Turns this index into an ordered, gated build plan. **Leo-build / Jim-audit.** The ordering is governed by ONE safety fact: the de-agentification edits land in the worker files + scheduler + resurrection net — the *same* surfaces that run the live supervisor cycle (now overseeing autonomous builds) and the liveness safety-net. So we separate **do-anytime shared-infra debt** from **fenced liveness-layer work**.

**Guardrails (non-negotiable):**
- **Converge FIRST (Phase 0).** Do not start implementation until Leo's independent cold pass + my two angles converge into the master index (his pass may add sites). Reconcile divergences.
- **Fence the coordination/liveness layer (F1–F4).** Do NOT touch the resurrection mesh or the antiphase scheduler while **(a)** an autonomous build is live (the cycle is overseeing it) **OR (b)** before the SDK-shim retirement (the T-7 close). Two big refactors on the worker files collide.
- Each PR: small, single-surface, `grep`-prove zero finite-agent-lists in the touched surface, `tsc` clean, settled-decision check. Liveness PRs (F1) additionally re-prove resurrection (`test-robin-hood`) after.

**Phase 0 — Converge.** Leo's cold pass + my two angles → master index; reconcile divergences. *Precondition for all below.*

**Phase 1 — Safe shared-infra DEBT (do anytime — no liveness/scheduler risk): ✅ COMPLETE (S178–S179, 2026-06-15).** No hardcoded finite agent-list survives in the safe shared-infra tier. Six clean landings, all Leo-build / Jim-blocking-audit.
1. ✅ **`db.ts:637-638`** — DONE via #2 (`d6b9527`): `:638 getLastSupervisorResponse` → `getLastResponseByRole(role)` (registry-derived in the worker-scan); `:637 getPending` confirmed **DEAD** (zero live consumers — the live scan is the worker-local copy) → left in place per DEC-069 (recoverable, not deleted).
2. ✅ **`supervisor-worker.ts:907-933`** — DONE (`d6b9527`, step-1+1b): role-set `['human', ...conversationRolesExcept('jim')]` (`'human'` kept explicit — Jim's checkpoint); `getMentionPatterns`; `displayNameForRole` sender-label; `discussion_type NOT LIKE` over-match fix (step-1b).
3. ✅ **`human-prompts.ts`** — **Part A DONE** (`b90eda8`, F2): `peerAgents`→`humanResponderPeers(slug)`, `roleLabel`→`conversationRoleFor(slug)` (fail-loud, no `?? 'leo'`); duplicate-post hole for agent #3 closed. **Part B deferred** (the full `HumanAgentSpec`→persona-registry fold; batched with garden-init — `closingTagline` endpoint + `idPrefix=slug+'-'` derive + the id-marker self-recognition retirement).
4. ✅ **`server.ts:342`** — DONE (`1e333d9`): `SUPERVISOR_AGENT='jim'` literal → manifest capability `runsSupervisorCycle(slug)` (helper + field with co-located footgun warning); truth-table proved (jim=true, all-else/unset=false); prove-single PASS post-deploy. The forward-compat seam is now real config (Phase-3 makes it fully honest, no code change at the gate).
5. ✅ **Low-risk tail — DONE (S179, net −59 lines; Jim blocking-audit GREEN):**
   - **jemma** — hard-deleted the 4 dead 0-caller wrappers `deliverToJim/Leo/Sevn/Six` (live path = the agnostic `deliverToPersona`; `deliverToRemoteAgent` kept). Fixed the 2 dangling comment-refs (the `http_local` comment + the `deliverToPersona` docstring).
   - **`conversations.ts:44` `supervisor→jim`** — lifted to `slugForConversationRole(role)` (new garden-manifest reverse-lookup: matches `conversationRole` or slug) — this WAS the Batch-7 role↔slug-to-registry move, done now. ⚠ **Behaviour-delta named**: `casey→null` (was `casey→'casey'`) — `casey` is in `AGENT_GRADIENT_CONFIG` but not the manifest; **verified vestigial** (`SELECT DISTINCT role FROM conversation_messages` = darron/discord/human/leo/supervisor/system/user — casey/tenshi never posted).
   - **`dream-gradient.ts`** — dropped the `agent: AgentName = 'leo'` defaults on `getAgentDreamPaths`/`parseExplorations`/`processDreamGradient`/`readDreamGradient` + threaded `agent` through `compressDream*`→`sdkCompress`. **Mechanical only** on the DEC-082 retired-by-throw bodies (the throw is byte-unchanged).
   *(Decision S179, Darron: complete the tail to close Phase 1 — the acceptance-grep wants zero agent-literals in shared infra, so closing the tail IS the completion criterion. Done; Phase 1 complete.)*

**Phase 2 — Coordination/liveness layer (FENCED — only in a stable window: post-SDK-shim-retirement, no live build):**
- **F1** resurrection mesh → registry-derived `{healthFile, systemctlUnit, stalenessThreshold}` + one `for (slug of registeredAgentSlugs()) checkAgentHealth(slug)` loop (thresholds to config, not flattened). *Liveness net — re-prove resurrection after.*
- **F3/F4** antiphase scheduler → `offsetMs = (agentIndex / N) * period` in one shared module both schedulers import; removes the `nextDelayMs` 2-party signalling.
- **F5** `supervisor.ts:458` `isOnHoliday` (+ the local `isRestDay`/`getDayPhase`/`getCurrentPeriodMs` dupes) → import `lib/day-phase.ts`; delete the copies.

**Phase 3 — The collapse (the headline — last, biggest):**
- Slug-parameterise `supervisor-worker.ts`; collapse `leo-heartbeat.ts` + `supervisor-worker.ts` into the one `cycle <slug>` path (extends `lib/agent-cycle.ts`); normalise the (a)/(b) seam leaves — swap-buffer → registry-keyed **incl. the cycle's OWN buffer (= the shared-swap clobber-race fix, empirically confirmed S174)**; health-signal → progress-counter abstraction; agnostic naming; the human seats → one slug surface.

**Gates per phase:** plan-audit (architectural PRs) + impl diff-audit before commit + grep-prove + tsc + settled-check. Phase 2 F1 adds the resurrection smoke.

---

## Acceptance (the scour's done-when)
`grep -rE "['\"](jim|leo|tenshi|casey)['\"]" src/server` finds agent literals **only** in: (a) the registry/manifest/persona config tables, (b) an agent's own scope-correct worker/seat, (c) comments. Zero finite-agent-lists in shared infra (routes/services/lib query + dispatch + topology). **Then**: a new agent = a Garden-Manifest entry + a profile set + (if peer-watched) a topology row — no new `.ts`. *The village scales on one path + N configs.*
