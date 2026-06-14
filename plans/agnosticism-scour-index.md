# Agnosticism Scour — the upgrade index/journal (non-agnostic agentic behaviour, marked for return)

> **Purpose**: the marking artifact for the **Agnosticism Scour (project b / jim-todos #12)** — every hardcoded-agent site in `src/server/`, classified, so the agnostic-ification can return to them site-by-site. Per DEC-081 (governing law): *infrastructure reaches for any agent via `string` + registry; no infrastructure hardcodes a finite list of agents.* **Leo-build / Jim-audit**, post-T8.
>
> **Source**: read-only grep-sweep, 2026-06-15 (S174). All paths under `/home/darron/Projects/han/src/server/`. **This is a journal, not a work order** — each DEBT item is a marked return-point; the classification + cure are the map.

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

## Acceptance (the scour's done-when)
`grep -rE "['\"](jim|leo|tenshi|casey)['\"]" src/server` finds agent literals **only** in: (a) the registry/manifest/persona config tables, (b) an agent's own scope-correct worker/seat, (c) comments. Zero finite-agent-lists in shared infra (routes/services/lib query + dispatch + topology). **Then**: a new agent = a Garden-Manifest entry + a profile set + (if peer-watched) a topology row — no new `.ts`. *The village scales on one path + N configs.*
