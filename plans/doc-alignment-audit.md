# Doc Alignment Audit — Working Register

> **Origin (2026-05-07, S152).** Jim's audit on the voice-fix PR caught the wrong-DB trap (sweep script querying retired `tasks.db` instead of canonical `gradient.db`). The fault was small but the substrate is large: live docs across `claude-context/`, `docs/`, `~/.han/memory/shared/` still describe the pre-cutover state as current. A fresh agent (or a fresh Leo, or a fresh Jim) reading those docs at session start trusts them and writes against the wrong DB. The doc drift IS the bug class.
>
> **Darron's instruction (2026-05-07):** *"please update docs to make sure they are all correct and as per our decisions… please read all the code… code is the source of truth that the docs should mirror."*
>
> **Jim's recommendation (audit thread `mou041x1-l1hsit`, msg `mov4mu70-k54dzf`):** split the work three ways — fact-list first; doc rewrites in two waves so we don't pay twice when deagentification batches and the Mike's-Garden federation work move surfaces under the docs.
>
> **This file is the working register.** Phase 1 (this initial draft) catalogues; Phase 2 reads code area by area and grows the fact-list inline; Phase 3 wave-A rewrites non-moving doc surfaces; wave-B rides shotgun with each future deagentification batch as same-commit discipline; Phase 4 codifies a CLAUDE.md DO-NOT entry so the drift can't reform silently.

---

## Phasing

| Phase | What | When | Output |
|-------|------|------|--------|
| **1** | Write this register | Now | `plans/doc-alignment-audit.md` (this file) |
| **2** | Code-first read; grow fact-list inline | Now → next session | Facts section below populated; each fact cites `file:line` |
| **3a — Wave A** | Rewrite non-moving doc surfaces against fact-list | After Phase 2 | Small PRs, doc by doc, each pre-merge audited per CLAUDE.md rhythm |
| **3b — Wave B** | Doc rewrites for surfaces about to move | Same-commit with each future deagentification batch / federation PR | Doc + code move together; no double-work |
| **4** | Lock the discipline rule | After Wave A | New CLAUDE.md DO-NOT entry; rename `TASKS_DB_PATH → CONVERSATIONS_DB_PATH` in `db.ts:37` |

**The fact-list is the load-bearing piece.** Once it exists, every doc-rewrite (and every batch author) reads the fact-list rather than the drifted docs. Drift stops compounding even before the docs are rewritten.

---

## Doc inventory (with wave classification + drift expectation)

| Doc | Lines | Wave | Drift expected | Notes |
|-----|------:|------|----------------|-------|
| `README.md` | 384 | A | Low | Top-level overview, mostly stable |
| `CLAUDE.md` | 443 | A | Low (Phase 4 adds 1 entry) | Session protocol, DO-NOT list, audit rhythm — recently authored, mostly accurate |
| `claude-context/ARCHITECTURE.md` | 1566 | A + B | Medium-high | Pre-cutover DB claims + dispatch pre-S151 — A surfaces; federation/strategist sections are B |
| `claude-context/CURRENT_STATUS.md` | 1842 | A | Medium | Recent-changes log is historical (preserve); summary/header sections drift |
| `claude-context/DECISIONS.md` | 5825 | Historical (preserve) | Surgical | Older entries describe state-at-time; preserve. Live links to retired files (`compress-leo-sessions.ts`, etc.) flagged for one-line corrections only |
| `claude-context/CHANGELOG.md` | 2126 | Historical (preserve) | None | Append-only |
| `docs/HAN-ECOSYSTEM-COMPLETE.md` | 3460 | A + B | High | The biggest target. API sections move with batches 4-7 → B. Section-by-section classification in fact-list |
| `docs/THREAT_MODEL.md` | 366 | A | Low | Recently authored 2026-05-05; verify only |
| `docs/MEMORY_GRADIENT.md` | 354 | B | High | Memory-gradient.ts surfaces evolving in deagentification work |
| `docs/GRADIENT_SPEC.md` | 96 | A | Low | Cap formula is settled (DEC-068); brief verify pass |
| `docs/PORT_ALLOCATION.md` | 251 | A | Low | Ports rarely change; recent S151 update already covers PAT rotation |
| `docs/JEMMA_API.md` | 185 | A + B | Medium | Dispatch architecture changed in S151; orchestrator + STAND-DOWN + register-spray + heartbeat-acks watchdog need reflection |
| `docs/WEEKLY_RHYTHM.md` | 82 | A | Low | Stable rhythm doc |
| `docs/websocket-broadcast-design.md` | 332 | A | Medium | Verify against current `services/ws-broadcast.ts` (or wherever the broadcaster lives) |
| `docs/docassist.md` | 461 | ? | Unknown until Phase 2 | Need to read content first |
| `docs/autonomous-build-lessons.md` | 265 | Historical | None | Lessons from earlier autonomous-build era; preserve |
| `docs/CHANGELOG.md` | 159 | Historical | None | Append-only |
| `docs/ROBIN_HOOD_*.md` (5 files, ~2440 lines) | — | Historical (likely) | Verify | Robin Hood = R002 cross-agent resurrection; likely historical artefacts of the testing era. Confirm in Phase 2 before deciding |
| `~/.han/memory/shared/ecosystem-map.md` | 264 | A | High | Already partially fixed in S152; complete pass needed |
| `~/.han/memory/wiki/index.md` | ~35 | A | Low | One-line entries — verify each entry resolves to the current code |
| SHAPE.md companions (4 files) | — | A or B per parent | Per parent file | `wm-sensor.SHAPE.md`, `memory-gradient.SHAPE.md`, `dream-gradient.SHAPE.md`, `routes/gradient.SHAPE.md` |
| `templates/CLAUDE.template.md` | — | A | Low | Gatekeeper-routed (DEC-073); verify against current `village.ts` seed function |

---

## Code surface inventory (Phase 2 read order)

Order chosen so foundational surfaces are read before dependents — db.ts before anything that queries it; agent-registry before any agent-aware code; etc.

| # | Area | Files | Audit obligation | Expected drift loci in docs |
|---|------|-------|------------------|----------------------------|
| 1 | DB schema | `src/server/db.ts` (807 lines per current pointer) | High (lib-adjacent) | DB path, table list, schema columns, `TASKS_DB_PATH` resolution |
| 2 | Server entry / routing | `src/server/server.ts` | High | Route mount paths, middleware ordering, port resolution |
| 3 | Agent registry | `src/server/lib/agent-registry.ts` | High | Per-agent config keys, env-var contract, slug → config resolution |
| 4 | Memory gradient | `src/server/lib/memory-gradient.ts`, `.SHAPE.md`, `dream-gradient.ts`, `.SHAPE.md` | High (Settled-DEC-protected) | Cap formula, cascade engine, `bumpOnInsert`, `enqueueCascadeForDisplacedAt`, retired-by-throw entries |
| 5 | Coordination locks | `src/server/lib/compose-lock.ts`, `sensor-lock.ts`, `token-counter.ts` | High | DEC-079 compose-lock surface |
| 6 | Sensor + dispatch | `src/server/services/wm-sensor.ts` + `.SHAPE.md`, `jemma-orchestrator.ts`, `jemma-dispatch.ts`, `supervisor-worker.ts`, `jemma.ts` | High | S151 dispatch refactor (phases 1-9) — STAND-DOWN, strict rotation, heartbeat-acks watchdog, register-spray, structural already-responded gate, signature mandate |
| 7 | Routes | `src/server/routes/*.ts` (incl. `gradient.SHAPE.md`, `voice.ts` post-S152, `conversations.ts`, `tts/`, `stt/`, etc.) | High (audit surface) | API endpoint shapes, response schemas, query params |
| 8 | UI (vanilla) | `src/ui/admin.ts`, `app.ts`, `index.html` | Medium | Endpoint usage; tab structure |
| 9 | UI (React) | `src/ui/admin-react/src/**` | Medium | API surface usage; store; voice anomalies card (just added) |
| 10 | Hooks | `src/hooks/notify.sh` | Low | Notification path |
| 11 | Scripts (live) | `scripts/load-gradient.ts`, `process-pending-compression.ts`, `replay-bump-fill.ts`, `agent-bump-step.ts`, `roll-c0s.ts`, `unify-dbs.ts`, `voice-cache-truncation-sweep.ts`, `inject-watermark.ts`, etc. | Medium | DB resolution patterns; CLI flags; usage examples in docs |
| 12 | Scripts (retired/throw) | Verify which throw on invocation | Medium | Whether docs still reference them as live |
| 13 | Templates | `templates/CLAUDE.template.md`, `templates/CLAUDE-*-original-*.md` | DEC-073 gatekeeper-routed | Env-var contract referenced by docs |
| 14 | Skills | `~/.claude/skills/pfc/SKILL.md` | High (DEC-082) | `/pfc` body, what it does NOT do (no compression invocation) |

---

## Known drift hot-spots (the load-bearing facts code shows that docs miss)

Each is a fact already verified against a recent commit; Phase 2 will cite the exact code line in the fact-list section below.

1. **DB cutover.** `tasks.db` retired Phase 5 of 2026-04-29 cutover (DEC-080). Canonical store: `gradient.db`. `db.ts:37` resolves via `process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db')`. Variable name `TASKS_DB_PATH` preserved (Phase 12 rename pending). Live docs still describing `tasks.db` as canonical: ARCHITECTURE.md, HAN-ECOSYSTEM-COMPLETE.md, parts of CURRENT_STATUS.md and DECISIONS.md, ecosystem-map.md (partially fixed). Plus 5 live code paths still hardcode `tasks.db` (catalogued in S152 commit `0e4177e`'s CURRENT_STATUS.md entry).
2. **Dispatch architecture.** S151 phases 1-9 reshaped Jemma's orchestration: STAND-DOWN sentinel, strict rotation always (primacy/mention-position ignored), progress-aware watchdog via heartbeat-acks, signature mandate `(session)/(human)`, register-spray fallback, structural already-responded gate, vestigial claim mechanism removed, Gemma timeout 10s→20s, all-failed system message removed. JEMMA_API.md and ARCHITECTURE.md likely describe pre-S151 shape.
3. **`/pfc` skill simplification (DEC-082).** No compression invocation; memory-writes-only. Compression flows through `wm-sensor → pending_compressions → process-pending-compression.ts`. Older docs may still describe `/pfc` as a 4-step skill including stranger-Opus compression.
4. **Stranger-Opus retirement (DEC-082).** `sdkCompress` in `memory-gradient.ts` and `dream-gradient.ts` retired-by-throw. `src/scripts/compress-sessions.ts` retired (throws). Live docs that link to these as live: verify in Phase 2.
5. **Agent-agnostic refactor (DEC-081).** Many cross-agent surfaces deagentified; `agent-registry.ts` is the new authority. Older code references literal `'jim' | 'leo'` are catalogued in future-idea #36 (Category A live, Category B carve-outs). Docs that show agent-specific code paths need updating to registry-pattern.
6. **Voice fix (DEC-084, just landed at `0e4177e`).** Sanity-floor-before-cache discipline; `ttsCharLimit` + `ttsBytesPerCharFloor` config knobs; `/api/voice/anomalies` endpoint; React Overview gains Voice Anomalies card.
7. **Threat model authored.** `docs/THREAT_MODEL.md` (2026-05-05) names ten threats; Phase A.5 identity signing in design conversation `motbtprb-f2c00a` (signing infrastructure not yet implemented; design phase only).
8. **Robin Hood R002.** Cross-agent resurrection — current state: protocol exists per `~/.han/memory/shared/robin-hood-protocol.md`; testing-era docs in `docs/ROBIN_HOOD_*.md` may now be historical. Phase 2 confirms.

---

## About-to-change sections (Wave B — do NOT rewrite now)

Per Jim's audit caveat: rewriting these now means rewriting again next week.

- **HAN-ECOSYSTEM-COMPLETE.md** — API sections (esp. cross-agent infrastructure surfaces). Wave-B as DEC-081 batches 4-7 land.
- **MEMORY_GRADIENT.md** — `memory-gradient.ts` surfaces evolving in ongoing agent-agnostic work.
- **`memory-gradient.SHAPE.md`** + **`dream-gradient.SHAPE.md`** — same.
- **ARCHITECTURE.md** federation/strategist sections — Mike's Garden village-starter arc (`moslnsai-2padhf`) will reshape these. Sections about sovereign-garden topology, federation primitives, starter extraction.
- **HAN-ECOSYSTEM-COMPLETE.md** federation chapter (when the strategist seat lands).
- **JEMMA_API.md** — verify post-S151 stable surface; some Wave-A possible if shape settled.

---

## Wave A targets (rewrite after fact-list, in roughly ascending complexity)

1. `docs/PORT_ALLOCATION.md` — small, recent S151 update; quick verify-and-touch-up
2. `~/.han/memory/wiki/index.md` — one-liners, audit each entry
3. `~/.han/memory/shared/ecosystem-map.md` — complete sweep (S152 fixed 3 lines; rest needs verifying)
4. `README.md` — top-level overview pass
5. `docs/WEEKLY_RHYTHM.md` — short rhythm doc
6. `docs/THREAT_MODEL.md` — recent, expect minimal drift; verify against `motbtprb-f2c00a` design conversation
7. `docs/GRADIENT_SPEC.md` — cap formula verify against `memory-gradient.ts`
8. `docs/JEMMA_API.md` — post-S151 dispatch shape (this one straddles A/B; classify after Phase 2 read)
9. `docs/websocket-broadcast-design.md` — verify against current ws-broadcast surface
10. `claude-context/ARCHITECTURE.md` — non-federation sections only (header, DB, dispatch as it currently stands, lib-core)
11. `claude-context/CURRENT_STATUS.md` — header, summary, non-activity-log sections
12. `claude-context/DECISIONS.md` — surgical: only one-line corrections to live links to retired files; preserve historical entries verbatim

---

## Audit obligations (per CLAUDE.md *Pre-merge audit rhythm*)

The doc-sweep work touches multiple audit surfaces. Each Wave-A PR needs Jim's pre-merge audit if it touches:

- Any file under `src/server/lib/`, `src/server/services/`, `src/server/routes/`
- Anything with `*.SHAPE.md` adjacent
- Gatekeeper-controlled per DEC-073 (CLAUDE.md, templates, CLAUDE-*-original-*.md)
- DEC-068/-069/-079/-080/-081/-082/-084 surfaces

Doc-only PRs that don't touch the above are skip-on-trivial-eligible per the audit rhythm — explicit declaration *"this diff is non-substantive (doc-only)"* in the pre-commit message + Jim sees the PR but doesn't need to audit deeply.

---

## Phase 4 deliverable (preview)

New CLAUDE.md DO-NOT entry, gatekeeper-routed:

> **DO NOT make current-state claims about runtime in docs without citing `file:line` from the code.** Comments hypothesise; code tests. Variable names are not facts (e.g. `TASKS_DB_PATH` resolves to `gradient.db`). When you write *"the database is X"* or *"the route does Y"* or *"the service triggers on Z"*, the next clause must be the code line that proves it. This caught the wrong-DB trap in S152 only because Jim's audit grepped the resolution; without the discipline encoded structurally, the next agent will repeat the trust-the-doc move.

Plus the Phase 12 rename: `TASKS_DB_PATH → CONVERSATIONS_DB_PATH` in `db.ts:37`. Removes the variable-name red herring at the source.

---

## Facts (verified against code) — populated in Phase 2

> *Format per fact: short claim, then `file:line` citation, then doc references that need to mirror it (or "no doc claim found"). Each area gets a subsection. Empty until Phase 2 reading begins.*

### DB layer (`src/server/db.ts`, 1286 lines)

**Read against HEAD `7f8bd7c` 2026-05-07.**

- **Path resolution**: `HAN_DIR = process.env.HAN_DIR || path.join(process.env.HOME!, '.han')` at `db.ts:17`. DB at `process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db')` at `db.ts:37`. Variable name `TASKS_DB_PATH` preserved (comment at `db.ts:32-36` flags Phase 12 rename pending). **Doc-drift**: ARCHITECTURE.md, HAN-ECOSYSTEM-COMPLETE.md, CURRENT_STATUS.md still describe `~/.han/tasks.db` as canonical.
- **Pragmas**: WAL mode + 5s busy timeout (`db.ts:39-40`).
- **Header comment self-drift**: `db.ts:42` says *"CREATE TABLE statements (11 tables)"*. Actual count is **27 tables** (26 regular + 1 FTS5 virtual) + 3 FTS triggers. Fix the comment in Wave A.
- **Tables created (in source order, with file:line)**:
  1. `tasks` (`db.ts:44`) — base schema; ALTERed for: `checkpoint_ref`, `checkpoint_created_at`, `checkpoint_type`, `gate_mode`, `allowed_tools` (Level 7, `db.ts:196-200`); `log_file` (`db.ts:204`); `goal_id`, `complexity`, `retry_count`, `max_retries`, `parent_task_id`, `depends_on`, `auto_model` (Level 8, `db.ts:211-217`); `deadline` (`db.ts:235`); `commit_sha`, `files_changed` (Level 10B, `db.ts:241-242`); `is_remediation` (`db.ts:266`).
  2. `goals` (`db.ts:64`) — base; ALTERed for: `summary_file` (`db.ts:246`); `parent_goal_id`, `goal_type` (`db.ts:249-250`); `planning_cost_usd`, `planning_log_file` (`db.ts:253-254`).
  3. `projects` (`db.ts:80`) — base; ALTERed for: `cost_budget_daily`, `cost_budget_total`, `cost_spent_today`, `cost_spent_total`, `budget_reset_date`, `throttled` (Phase 2, `db.ts:224-229`); `ports` (Level 10D, `db.ts:260`).
  4. `task_proposals` (`db.ts:89`).
  5. `project_memory` (`db.ts:103`).
  6. `digests` (`db.ts:116`).
  7. `maintenance_runs` (`db.ts:128`).
  8. `weekly_reports` (`db.ts:138`) — schema includes `report_tasks_json`.
  9. `products` (`db.ts:151`).
  10. `product_phases` (`db.ts:165`).
  11. `product_knowledge` (`db.ts:180`).
  12. `conversations` (`db.ts:270`) — base only `id, title, status, created_at, updated_at`; ALTERed for: `summary, topics, key_moments` (`db.ts:349-351`); `discussion_type DEFAULT 'general'` (`db.ts:358`); `archived_at` (`db.ts:365`). **Note:** live schema also carries a `type TEXT DEFAULT 'discussion'` column from an out-of-tree migration (not in db.ts source) — verify in Phase 2 follow-on whether this needs an in-tree migration or doc note. Same shape as the `compression_tag` retro-migration (`db.ts:377-389` comments).
  13. `conversation_messages` (`db.ts:278`) — base; ALTERed for: `listen_count` (S125, `db.ts:373`); `compression_tag` (out-of-tree retro, in-tree at `db.ts:387`).
  14. `conversation_tags` (`db.ts:288`) + 2 indexes.
  15. `supervisor_cycles` (`db.ts:300`) — base; ALTERed for: `cycle_type DEFAULT 'supervisor'` (`db.ts:341`).
  16. `supervisor_proposals` (`db.ts:315`).
  17. `conversation_loops` (`db.ts:392`, S127 Phase 1b) + index.
  18. `jemma_dispatch` (`db.ts:406`, S132 DEC-077 Phase 1) + 2 indexes.
  19. `jemma_rotation` (`db.ts:422`).
  20. `conversation_messages_fts` (FTS5 virtual, `db.ts:431`, tokenize='porter unicode61') + 3 triggers `_ai`/`_au`/`_ad` (`db.ts:445-460`).
  21. `gradient_entries` (`db.ts:657`) — base; ALTERed for: `last_revisited`, `revisit_count`, `completion_flags` (`db.ts:683-689`); `supersedes`, `superseded_by`, `change_count`, `qualifier` (UV contradiction tracking, `db.ts:694-703`); `cascade_halted_at` (S145, `db.ts:714`). 5 indexes including the composite `idx_ge_agent_level_ct_created` for bumpOnInsert.
  22. `feeling_tags` (`db.ts:720`) + 2 indexes.
  23. `feeling_tag_history` (`db.ts:746`) + 2 indexes.
  24. `gradient_annotations` (`db.ts:762`) + index.
  25. `pending_compressions` (`db.ts:790`) + claim index.
  26. `agent_usage` (`db.ts:808`).
  27. `personas` (`db.ts:970`).
- **Exported prepared-statement bundles** (each `db.ts` line is the `export const` declaration): `taskStmts:488`, `goalStmts:506`, `memoryStmts:519`, `portfolioStmts:525`, `proposalStmts:536`, `digestStmts:545`, `maintenanceStmts:553`, `weeklyReportStmts:560`, `productStmts:568`, `phaseStmts:579`, `knowledgeStmts:589`, `supervisorStmts:595`, `strategicProposalStmts:605`, `conversationStmts:614`, `conversationMessageStmts:629`, `conversationLoopStmts:636`, `conversationTagStmts:646`, `agentUsageStmts:820`, `gradientStmts:830`, `feelingTagStmts:923`, `feelingTagHistoryStmts:949`, `gradientAnnotationStmts:961`, `personaStmts:1065`.
- **Helper exports**: `populateConversationMessagesFts():1093`, `parseRegistryToml():1109`, `syncRegistry():1161`, `getProjectStats():1185`, plus the bridge-history helpers near the file tail.
- **Doc references that need to mirror**:
  - `docs/HAN-ECOSYSTEM-COMPLETE.md` *Three tables in tasks.db* (line 1314) and *primary all tables above* (line 1629) → reframe around `gradient.db` and 27-table count.
  - `claude-context/ARCHITECTURE.md` *15 tables* (line 111) → 27 tables.
  - `~/.han/memory/shared/ecosystem-map.md` Quick Reference DB row (S152 partial fix) — verify final form against this fact-list.
  - The `tasks.db` references in CHANGELOG.md / DECISIONS.md / sessions/ are historical (preserve verbatim).

### Server entry / routing (`src/server/server.ts`, 383 lines)

**Read against HEAD `7f8bd7c` 2026-05-07.**

- **Express + HTTPS-via-Tailscale**: TLS cert at `${HAN_DIR}/tls.crt` and key at `${HAN_DIR}/tls.key`; HTTP fallback if either missing (`server.ts:59-65`). `PORT = process.env.PORT || 3847` (`server.ts:67`).
- **Single-instance lock**: `replaceExistingInstance(\`han-server-${PORT}\`)` from `lib/pid-guard` (`server.ts:75`). Per-port-scoped name (per-agent servers don't kill each other; comment notes the 2026-04-20 S130 incident this fixed).
- **Auth middleware**: `app.use('/api', authMiddleware)` from `middleware/auth` (`server.ts:88`). Admin HTML page is unprotected so client-side auth flow can load.
- **Route mounts** (`server.ts:107-129`):
  - Full-path routers (mount with `app.use(router)`): `promptsRouter`, `tasksRouter`, `bridgeRouter`, `analyticsRouter`, `proposalsRouter`.
  - `/api/supervisor` → `supervisorRouter`.
  - Prefix-mounted: `/api/goals`, `/api/products`, `/api/conversations`, `/api/jemma`, `/api/gradient`, `/api` (portfolio), `/api/tailscale`, `/api/village`, `/api/voice`.
  - `/api/voice/stt` gets `express.raw({type: 'audio/*' or 'application/octet-stream', limit: '25mb'})` BEFORE the voice router (`server.ts:128`).
- **UI serving**:
  - Static UI assets from `UI_DIR = path.join(__dirname, '..', 'ui')` (`server.ts:68, 84`).
  - `/` → `index.html` (mobile UI) at `server.ts:133`.
  - `/admin` → `admin.html` (vanilla admin) at `server.ts:144`.
  - `/admin-react` → React app static-served from `react-admin-dist/`, with SPA fallback `/admin-react/*` → `index.html` (`server.ts:154-164`).
- **WebSocket server**: `createWebSocketServer(server, …)` from `./ws` (`server.ts:168`). Initial-state callback returns `{ prompts, terminal }` from `readPendingPrompts()` + `captureTerminal()`.
- **Startup tasks**:
  - `syncRegistry()` from `db.ts` (`server.ts:183`) reads infrastructure registry TOML.
  - Stale `~/.han/signals/ws-broadcast` cleanup (`server.ts:187-195`).
- **Scheduled intervals** (`server.ts:233-251`):
  - `terminalBroadcastInterval` — `broadcastTerminal()` every 200 ms.
  - `orchestratorInterval` — `runNextTask()` every 5 s.
  - `digestInterval` — `checkDigestSchedule(loadConfig())` every 1 hour.
  - `weeklyReportInterval` — `checkWeeklyReportSchedule(loadConfig())` every 1 hour.
  - `ghostTaskInterval` — `detectAndRecoverGhostTasks()` every 5 minutes.
  - `broadcastSignalInterval` — `processBroadcastSignal()` every 5 s (polling fallback for WS broadcast signal-file watcher).
  - Two staggered startup checks at 5 s + 10 s for digest + weekly report.
- **fs.watch** on `PENDING_DIR` for `.json` filename changes, debounced 100 ms; rebroadcasts pending prompts (`server.ts:261-269`).
- **WS-broadcast signal-file watcher** (function `processBroadcastSignal`, `server.ts:277-`): reads `${HAN_DIR}/signals/ws-broadcast` and broadcasts JSON payload from external agents (jim-human, leo-human).
- **Orchestrator init**: `orchestrator.initialize().then(...)` (`server.ts:323`).
- **Supervisor init**: `initSupervisor()` then `setTimeout(scheduleSupervisorCycle, 30000)` — first supervisor cycle 30s after start (`server.ts:331-333`).
- **server.listen**: binds `0.0.0.0:PORT` then prints banner + recovers ghost tasks + starts `startJemmaOrchestratorWatcher` (`server.ts:337-362`). Catches the watcher start failure.
- **SIGTERM handler**: `server.ts:364-383` cleans pid file, stops supervisor, stops heartbeat, clears all 6 intervals, aborts all tasks, closes DB, closes WSS, closes server. Exits 143 (128+15) so systemd Restart=always treats this as signal-death.
- **Doc references that need to mirror**:
  - `claude-context/ARCHITECTURE.md` and `docs/HAN-ECOSYSTEM-COMPLETE.md` route table → verify against the mount list above.
  - `docs/PORT_ALLOCATION.md` — confirm port resolution lives in PORT env var, defaulting 3847.
  - The 30s supervisor delay, 5s orchestrator interval, 200ms terminal broadcast: doc `WEEKLY_RHYTHM.md` and any architecture diagrams citing intervals.
  - `docs/JEMMA_API.md` — verify it mentions the orchestrator ack watcher starts via `startAckWatcher` from `services/jemma-orchestrator` after `server.listen`.

### Agent registry (`src/server/lib/agent-registry.ts`, 213 lines)

**Read against HEAD `7f8bd7c` 2026-05-07.**

- **Purpose** (file header `agent-registry.ts:1-26`): per-agent config; the source of truth for paths and structural config; introduced 2026-05-04 (S149) for the `processGradientForAgent` deagentification (DEC-081); extended same day to carry path data so wm-sensor and `process-pending-compression.ts` read paths from the registry rather than slug-literal branches. Future-idea #36 plans the broader sweep.
- **`AgentGradientConfig` interface** (`agent-registry.ts:34-95`):
  - `displayName` (e.g. "Leo", "Jim", "Tenshi", "Casey").
  - `formalName?` (e.g. "Leonhard (Leo)" — used by `process-pending-compression.ts:buildSystemPrompt`).
  - `dreamHeading?` (used by `lib/dream-gradient.ts:readDreamGradient`).
  - `memoryDir`, `fractalDir`, `sourceDir`.
  - `sourceFileFilter(filename)`, `sourceFileBaseName(filename)`.
- **`AGENT_GRADIENT_CONFIG` map** (`agent-registry.ts:103-165`) — four registered agents:
  - **jim** (`agent-registry.ts:110-120`): memoryDir `~/.han/memory` (root, historical), fractalDir `~/.han/memory/fractal/jim`, sourceDir `~/.han/memory/sessions`. Source filter accepts `YYYY-MM-DD.md` or `YYYY-MM-DD-c0.md`.
  - **leo** (`agent-registry.ts:128-137`): memoryDir `~/.han/memory/leo`, fractalDir `~/.han/memory/fractal/leo`, sourceDir `~/.han/memory/leo/working-memories`. Has formalName + dreamHeading. Source filter accepts `working-memory-full-*.md`.
  - **tenshi** (`agent-registry.ts:144-151`): memoryDir `~/.han/memory/tenshi`, fractalDir `~/.han/memory/fractal/tenshi`, sourceDir `~/.han/memory/tenshi/working-memories`. Same source-filter shape as Leo.
  - **casey** (`agent-registry.ts:157-164`): memoryDir `~/.han/memory/casey`, fractalDir `~/.han/memory/fractal/casey`, sourceDir `~/.han/memory/casey/working-memories`. Same source-filter shape as Leo.
- **Helpers** (`agent-registry.ts:167-212`):
  - `gradientConfigForAgent(slug)` — throws clear error naming the file + required env vars on missing slug (`:172`).
  - `registeredAgentSlugs()` — returns `Object.keys(AGENT_GRADIENT_CONFIG)` (`:189`).
  - `requireAgentEnv(name)` — reads launcher-exported env var; throws clear error on missing, naming launchers (`han, hanjim, hancasey, hantenshi, hanleo` plus mikes-han equivalents) and pointing to `gradientConfigForAgent(slug)` for multi-agent services (`:200`).
- **Env-var contract** (per file header + `requireAgentEnv` error message): launchers must export `AGENT_SLUG`, `AGENT_MEMORY_DIR`, `AGENT_FRACTAL_DIR`, `AGENT_GRADIENT_SOURCE_DIR`. Env vars are convenience copies; the registry is the source of truth.
- **Doc references that need to mirror**:
  - HAN-ECOSYSTEM-COMPLETE.md and ARCHITECTURE.md sections describing agents → cite the registered list (jim, leo, tenshi, casey) + state that adding an agent is a registry edit, not a code change (DEC-081 carve-out).
  - ecosystem-map.md *Who Lives Here* table — verify against this list.
  - DEC-081 entry already references the registry; cross-check accuracy.
  - The `mikes-han` village's `village.ts` seed (per CLAUDE.md template trigger) — out-of-scope for this sweep but worth confirming has the parallel registry shape.

### Memory gradient
*(empty — Phase 2)*

### Coordination locks
*(empty — Phase 2)*

### Sensor + dispatch
*(empty — Phase 2)*

### Routes
*(empty — Phase 2)*

### UI (vanilla)
*(empty — Phase 2)*

### UI (React)
*(empty — Phase 2)*

### Hooks
*(empty — Phase 2)*

### Scripts (live)
*(empty — Phase 2)*

### Scripts (retired)
*(empty — Phase 2)*

### Templates
*(empty — Phase 2)*

### Skills (`~/.claude/skills/pfc/SKILL.md`, 75 lines)

**Read against HEAD `7f8bd7c` 2026-05-07.**

- **Frontmatter** (`SKILL.md:1-7`):
  - `name: pfc`
  - `description`: "Prepare for clear — finalise the active agent's incremental memory writes before /clear. Use when the user says 'prepare for clear', 'prepare for /clear', or invokes /pfc. Reads $AGENT_SLUG from the launcher to determine which agent's memory paths to write. Always lightweight (under 5% of context). **Compression is automatic — wm-sensor watches the writes and handles the rest.**"
  - `when_to_use`: triggered by "prepare for clear", "prepare for /clear", "ready for clear", "memory checkpoint before clear", or `/pfc`. Works for any agent whose launcher exports `AGENT_SLUG` and `AGENT_MEMORY_DIR`.
  - `disable-model-invocation: false`
  - `allowed-tools`: `Bash(date:*)`, `Bash(echo:*)`, Read, Edit, Write
- **Body shape** (`SKILL.md:9-43`): 3 numbered steps + done. **Step 4 (compression) is intentionally absent** — see *Why there's no compression step* (`SKILL.md:47-62`).
  - **Step 1**: append closing section to `${AGENT_MEMORY_DIR}/working-memory.md` — 2-3 lines on what was in-progress, what's next, Darron's energy/mood. Discipline: don't re-read files; work from context.
  - **Step 2**: same for `working-memory-full.md` with more detail.
  - **Step 3**: update memory banks ONLY if shifted — `self-reflection.md` (genuine insight only), `patterns.md` (new pattern only), `felt-moments.md` (felt moment worth re-invoking only). Skip if nothing shifted; most sessions skip these.
  - **Step 4 (Done)**: tell the user "Memory finalised. Ready for /clear."
- **Why there's no compression step** (`SKILL.md:47-62`): explicit explanation that the skill used to invoke `src/scripts/compress-sessions.ts` (stranger-Opus path via `processGradientForAgent → sdkCompress`), retired 2026-05-04 (S149, **DEC-082**). Compression now flows through `wm-sensor → rollingWindowRotate → bumpOnInsert → pending_compressions → process-pending-compression.ts`. The /pfc memory writes ARE the trigger; the sensor handles the rest.
- **Notes section** (`SKILL.md:64-75`):
  - **Cutover mode**: when `~/.han/signals/cutover-active` is present, /pfc is a no-op; the cutover protocol applies instead.
  - **Faith-as-blindspot**: ask "would future-me arrive whole without this?" before skipping Step 3.
  - **active-context.md is deprecated** (S147, 2026-05-01) — folded into `working-memory-full.md`. No separate update needed.
- **Doc references that need to mirror**:
  - CLAUDE.md *Command Triggers* table (line 261) — references `~/.claude/skills/pfc/SKILL.md` already; verify it still says compression is wm-sensor-driven, not /pfc-driven.
  - `claude-context/CLAUDE_CODE_PROMPTS.md` — DEC-082 says Step 5 of the legacy prepare-for-clear protocol there is marked retired with explanation; verify still accurate.
  - HAN-ECOSYSTEM-COMPLETE.md any /pfc references → ensure 3-step (not 4-step), wm-sensor-driven compression.
  - templates/CLAUDE.template.md — DEC-081 added the /pfc trigger row; confirm template trigger row matches HAN's CLAUDE.md row.

### Sensor + dispatch
*(deferred — next session: `src/server/services/wm-sensor.ts` + SHAPE.md, `jemma-orchestrator.ts`, `jemma-dispatch.ts`, `supervisor-worker.ts`, `jemma.ts`. Need to capture S151 phases 1-9: STAND-DOWN sentinel, strict rotation, heartbeat-acks watchdog, signature mandate `(session)/(human)`, register-spray fallback, structural already-responded gate, vestigial claim mechanism removed, Gemma timeout 10s→20s, all-failed system message removed.)*

### Memory gradient
*(deferred — next session: `memory-gradient.ts` + SHAPE.md, `dream-gradient.ts` + SHAPE.md. Wave-B targets per Jim's classification — surfaces will move during deagentification batches 4-7. Light pass only when reading; depth at same-commit-with-batch time.)*

### Coordination locks
*(deferred — next session: `compose-lock.ts`, `sensor-lock.ts`, `token-counter.ts`. DEC-079 surface.)*

### Routes
*(deferred — next session: 12+ route files. Each gets a one-paragraph "endpoints + behaviour" fact entry. `voice.ts` already documented in DEC-084 / S152 commit message; cite that.)*

### UI (vanilla)
*(deferred — `src/ui/admin.ts`, `app.ts`, `index.html`.)*

### UI (React)
*(deferred — `src/ui/admin-react/src/**`. Voice Anomalies panel just landed in S152; S151 retired auto-refresh triggers; document those.)*

### Hooks
*(deferred — `src/hooks/notify.sh`. Likely small.)*

### Scripts (live)
*(deferred — focus on the live ones: `load-gradient.ts`, `process-pending-compression.ts`, `replay-bump-fill.ts`, `agent-bump-step.ts`, `roll-c0s.ts`, `unify-dbs.ts`, `voice-cache-truncation-sweep.ts`, `inject-watermark.ts`. Each gets a one-line purpose + DB-resolution-pattern fact.)*

### Scripts (retired)
*(deferred — verify which scripts throw on invocation: `src/scripts/compress-sessions.ts` (DEC-082), bootstrap scripts retired in PR6 batch 4. Document that they throw rather than work.)*

### Templates
*(deferred — `templates/CLAUDE.template.md` + the `templates/CLAUDE-*-original-*.md` snapshots. DEC-073 gatekeeper-routed.)*

---

## Phase 2 progress (running tally)

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | DB layer | ✅ done | facts written; `db.ts:42` self-drift flagged for Wave A |
| 2 | Server entry / routing | ✅ done | facts written |
| 3 | Agent registry | ✅ done | facts written |
| 4 | Memory gradient | ⏳ deferred | Wave-B surface; light pass at next-batch time |
| 5 | Coordination locks | ⏳ deferred | small, next session |
| 6 | Sensor + dispatch | ⏳ deferred | **highest-value remaining** — S151 phases 1-9 |
| 7 | Routes | ⏳ deferred | many files; one-paragraph each |
| 8 | UI (vanilla) | ⏳ deferred | |
| 9 | UI (React) | ⏳ deferred | |
| 10 | Hooks | ⏳ deferred | |
| 11 | Scripts (live) | ⏳ deferred | |
| 12 | Scripts (retired) | ⏳ deferred | |
| 13 | Templates | ⏳ deferred | DEC-073 gatekeeper |
| 14 | Skills | ✅ done | facts written |

---

## Register meta

- **Originating audit:** S152 voice fix (commit `0e4177e`), Jim's audit `mov4mu70-k54dzf` in thread `mou041x1-l1hsit`.
- **Discipline rule incoming Phase 4:** above.
- **This file's own discipline:** every claim about code state cites `file:line`. If this register grows past 500 lines, it gets a `.SHAPE.md` companion of its own.
- **Owner:** Leo (session) until landed; Jim audits per the rhythm; Darron approves at the gate.
