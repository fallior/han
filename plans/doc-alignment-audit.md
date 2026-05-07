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

## Follow-on items surfaced during the audit (not doc-rewrite work)

Forward-looking flags raised by Phase 2 reads that need their own discrete PRs — kept here so they don't get folded into the doc-sweep:

1. **`conversations.type TEXT DEFAULT 'discussion'` column** — out-of-tree migration that never made it back into `db.ts` source. Same shape as the `compression_tag` retro-fix (already in-tree at `db.ts:387`). Action: small in-tree migration PR — declarative ALTER TABLE + comment naming the same retro-fix pattern. Schema-as-source-of-truth discipline. *Per Jim's S152 audit recommendation.*
2. **`db.ts:42` header self-drift**: comment says *"CREATE TABLE statements (11 tables)"*; actual count is 27. Action: one-line comment fix; same commit as the schema retro fix above (or its own one-line PR if convenient).
3. **`supervisor-worker.ts:2139` pre-existing TS error**: `case 'respond_conversation'` not in the action union after S127 narrowed it. Two ways forward: widen the union to include `'respond_conversation'` as a deprecated case, OR remove the dead branch entirely. Action: small follow-on PR; not doc-sweep.
4. **`TASKS_DB_PATH → CONVERSATIONS_DB_PATH` rename** in `db.ts:37` — Phase 12 cleanup that's been pending. Action: lands in Phase 4 of THIS audit (locking the DO-NOT discipline rule).
5. **Live code paths still hardcoding `tasks.db`** (catalogued in S152 commit `0e4177e`): `scripts/acquire-c0s.ts:142`, `verify-provenance.ts:33`, `supersession-sweep.ts:37`, `src/server/extract-session-usage.ts:18`, `fix-c4-gradient.ts:17`, plus 12 `scripts/emergency-dedupe/*.mjs`. Action: separate code-sweep PR (mentioned in S152 brief; queue it).

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

**Read against HEAD `893fb6d` 2026-05-07.**

#### `src/server/services/wm-sensor.ts` (392 lines) + `wm-sensor.SHAPE.md` (131 lines)

- **SHAPE.md last-verified 2026-05-04 (S149).** Cross-checked against current code; canonical flow holds.
- **Trigger surface**: only `working-memory-full.md` per agent (`wm-sensor.ts:139-146`, `buildTargets`). Phase A.2 (S145, 2026-04-30) narrowed from the original four files (working-memory.md, working-memory-full.md, felt-moments.md, self-reflection.md) to one. **Doc-drift**: any doc still listing four watched files.
- **Token-based ceiling** (Phase A token refactor, S145, 2026-04-30): head 25 000 + tail 25 000 = 50 000-token ceiling (`wm-sensor.ts:79-85`). Configurable via `~/.han/config.json:memory.{rollingWindowHead, rollingWindowTail, sensorEnabled, parallelAgentMaxConcurrency, sensorDebounceMs}`. Defaults: head/tail 25K, debounce 500 ms.
- **Multi-agent iteration**: `registeredAgentSlugs()` + `buildTargets(slug)` (`wm-sensor.ts:361-367`). Adding an agent = registry edit, no `wm-sensor.ts` edit (DEC-081).
- **Per-agent lock**: `acquireWmSensorLock(agent)` from `lib/sensor-lock.ts` (`wm-sensor.ts:281`). Concurrent writes within debounce collapse to one rotation pass.
- **`processTarget` outer loop** (`wm-sensor.ts:182-267`): 10-iteration safety; reads file, counts tokens via `lib/token-counter.ts:countTokens`, calls `rollingWindowRotate` if over ceiling. After each rotation, drains the cascade chain BEFORE re-checking size — Darron's S145 ruling: *"the slicer doesn't wait for the cascade — change it, make it wait."*
- **Cascade drain inner loop** (`wm-sensor.ts:236-262`): up to 50 spawns of `process-pending-compression.ts --agent={slug} --verbose`. Loops while `stdout.includes('"ok":true')`; breaks when queue empty. Halts the slice on non-zero exit.
- **Spawn paths** (`wm-sensor.ts:155-178`): `tsxBin = SERVER_DIR/node_modules/.bin/tsx`; `PROCESS_SCRIPT = scripts/process-pending-compression.ts`; `cwd = SERVER_DIR`; `NODE_PATH = SERVER_DIR/node_modules`. The `SERVER_DIR = '..'` fix (S145, 2026-04-30) — was `'..', '..'` and resolved to `src/` (no node_modules) — is documented in the inline comment.
- **Health signal**: `${HAN_DIR}/health/wm-sensor.json` written every 30 s (`wm-sensor.ts:370-377`).
- **Watch resilience** (`wm-sensor.ts:298-340`): atomic-save-aware (rename event re-establishes); 1 s retry on watcher error; 5 s retry on initial setup failure; 30 s poll for files that don't exist yet (Tenshi/Casey graceful).
- **Doc references that need to mirror**:
  - HAN-ECOSYSTEM-COMPLETE.md and ARCHITECTURE.md memory-system sections → cite the **single watched file**, the 25K+25K token ceiling, the multi-agent iteration via the registry.
  - MEMORY_GRADIENT.md / `wm-sensor.SHAPE.md` are already authoritative; verify flat-file docs cite SHAPE.md as the canonical reference.
  - DEC-079 entry in DECISIONS.md → cross-check the Phase 4 description.

#### `src/server/services/jemma-orchestrator.ts` (667 lines)

- **Purpose** (file header `jemma-orchestrator.ts:1-27`): sequencing orchestrator for multi-agent conversation responses. Wakes agents one at a time; failures advance the queue with `prior_agent_failed` context.
- **DEC-079 (2026-05-03)** baked-in: orchestration is the ONLY dispatch path; legacy parallel-fanout retired (`jemma-orchestrator.ts:134-139`). No `isEnabled()` flag.
- **S151 phase 9 — strict rotation always** (`jemma-orchestrator.ts:184-217`, `computeRecipientOrder`): primacy and mention-position **ignored**; the order is whatever the current rotation says, filtered to this dispatch's recipients. The first-ever dispatch uses alphabetical order (seeded). Then `advanceRotation` left-shifts after each dispatch close (`:219-223`, `:462`).
- **S151 phase 7 — progress-aware watchdog via heartbeat-acks** (`jemma-orchestrator.ts:46-62`, `:386-398`, `:528-563`):
  - `WATCHDOG_POLL_MS = 10 000` (poll cadence, hardcoded `:53`).
  - `getComposeWatchdogTimeoutMs()` reads `~/.han/config.json:agents.compose_watchdog_timeout_ms`, default **90 000** (3 missed 30 s heartbeats).
  - Agents emit `'composing'` heartbeat acks during compose; `handleAck` (line 366) updates `state.last_progress_at` and returns without advancing the queue (`:394-398`).
  - `checkWatchdogs` reads `last_progress_at` (falls back to `wake_at` then `row.updated_at`); fires only when no progress for the timeout window. Orphan threshold = 2× timeout.
- **S151 phase 5 follow-on — all-failed user-facing system message removed** (`jemma-orchestrator.ts:585-601`, `handleAllFailed`). Only writeDistress + ntfy push remain. Per Darron: *"I'll notice if no one responds; I don't need an arbitrary timeout call."* The structural-failure case (no eligible recipients at dispatch time) posts its own message at `routes/conversations.ts:classifyAndDispatch` (verify in routes area pass).
- **DEC-079 thread-as-ground-truth retired** (`jemma-orchestrator.ts:549-552`): with leo-human/jim-human dedup gates removed, watchdog-fired-but-posted is benign — agent posted, queue marks failed and advances; no false-positive dedup downstream.
- **Per-conversation serialisation** (`jemma-orchestrator.ts:237`, `conversationDispatchLocks` Map): chained Promise per conversationId so two near-simultaneous human messages on the same thread don't initialise concurrently. Per-conversation, not global.
- **Atomic txn** (`jemma-orchestrator.ts:285-297`): dispatch INSERT + rotation seed in one DB transaction. **Queue-row-first** ordering required: dispatch row commits BEFORE first wake fires, otherwise an agent could compose for a non-existent dispatch and the ack falls on the floor (`:251-254` cautionary comment).
- **Ack watcher** (`jemma-orchestrator.ts:620-666`, `startAckWatcher`): `fs.watch(SIGNALS_DIR)` filtered to `jemma-ack-*` filenames; 200 ms debounce delay; deletes the signal after parse; calls `handleAck`. Watchdog poll runs every 10 s. Startup sweep reconciles dispatches that completed while orchestrator was down.
- **Ack payload** (`jemma-orchestrator.ts:123-132`, `AckPayload`): `dispatchId`, `agent`, `status` ∈ {done, failed, stood_down, **composing** (new in S151)}, optional `reason`, `final_attempt_count`, `compose_duration_ms`, `heartbeat_seq`, `ack_written_at`.
- **Doc references that need to mirror**:
  - `docs/JEMMA_API.md` is the central drift target — verify it describes the orchestrator (not the legacy parallel-fanout); names strict rotation, heartbeat-acks, no all-failed system message, per-conversation serialisation, queue-row-first ordering.
  - ARCHITECTURE.md dispatch sections.
  - DECISIONS.md DEC-079 entry — verify accuracy of the orchestration-only claim.

#### `src/server/services/jemma-dispatch.ts` (292 lines)

- **`writeSignalFile`** (`jemma-dispatch.ts:40-47`) — **DEC-080 sole writer** of `~/.han/signals/{agent}-human-wake` files. Comment explicitly names the audit grep: `grep -nE 'writeFileSync.*wake' src/server/` → must return exactly one match (this function). The S151 PR4 added this DO-NOT entry; verify it landed.
- **`deliverMessage`** (`jemma-dispatch.ts:151-289`) — unified delivery function called by both `routes/conversations.ts` (admin) and `routes/jemma.ts` (Discord HTTP).
  - Looks up `persona = getPersona(recipient)` from `services/village.js`.
  - `deliveryType` ∈ {signal, http_local, ntfy} (defaults to `signal` if persona missing).
  - For signal/http_local: ensures Discord channel webhooks; finds-or-creates `discussion_type='discord'` conversation for Discord source; inserts `human` message; writes wake signal with payload (`source`, `conversationId`, `channel`, `discussionType`, `author`, `messagePreview`, `confidence`, `mentionedAt`, optional `dispatchId`, optional `priorAgentFailed`).
  - For ntfy: pushes truncated preview via curl to `ntfy.sh/${topic}`.
  - Logs delivery to `~/.han/health/jemma-delivery-log.json` (rolling last-200 + per-source-per-recipient counts).
  - Broadcasts WebSocket `jemma_delivery` event for live admin UI updates.
- **`SIGNALS_DIR` and `HEALTH_DIR`** are exported (`:292`) for use by `jemma-orchestrator.ts`.
- **Doc references that need to mirror**:
  - JEMMA_API.md — verify it cites `services/village.js:getPersona` as the delivery-type authority and lists the three delivery types.
  - HAN-ECOSYSTEM-COMPLETE.md Discord chapter — verify the Discord conversation auto-creation flow (`findOpenDiscordConv` LIKE-match, INSERT with `discussion_type='discord'`).
  - DEC-080 entry — verify the sole-writer rule and the audit grep.

#### `src/server/jemma.ts` (1464 lines, Discord Gateway service)

- **Service shape**: connects to Discord Gateway WebSocket (`gateway.discord.gg/?v=10&encoding=json`), classifies via Haiku-via-Agent-SDK then Ollama fallback, routes to deliver functions per recipient.
- **S151 phase 1 — Gemma timeout 20 s**: `classifyWithOllama` uses `AbortSignal.timeout(20000)` (`jemma.ts:405`). Was 10 s pre-S151. Doc-drift: any doc still citing 10 s.
- **Classification cascade** (`jemma.ts:419-443`, `callLLMForClassification`): Haiku SDK first; Ollama fallback if Haiku fails; `{recipient: 'ignore', confidence: 0}` final fallback if both fail.
- **Models**: `OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b'` (`jemma.ts:59`). Haiku call site at `classifyWithHaikuSDK:359`.
- **Reconciliation interval**: 5 minutes (`jemma.ts:62`).
- **Heartbeat jitter**: 1 s (`jemma.ts:63`).
- **Persona-driven delivery** (`jemma.ts:704-799`): registry-backed; `deliverToPersona` is generic; legacy `deliverToJim`/`deliverToLeo`/`deliverToDarron`/`deliverToSevn`/`deliverToSix` are persona-typed wrappers around the generic path.
- **Discord-Leo dispatch parity** (S133 fix in `deliverToLeo:480`) — uses HTTP POST to `/api/jemma/deliver` first, signal-file fallback only on HTTP failure. Mirrors `deliverToJim` so Discord-originated mentions go through the orchestrator's sequencing.
- **systemd user service** (`jemma.service`) — daemon, not server-spawned. Header docstring is the canonical setup doc.
- **Doc references that need to mirror**:
  - JEMMA_API.md and HAN-ECOSYSTEM-COMPLETE.md Discord/classification sections — verify Haiku-first then Ollama fallback, 20 s timeout, persona-driven delivery.
  - PORT_ALLOCATION.md / setup docs — verify systemd-user service name `jemma.service`.

#### `src/server/services/supervisor-worker.ts` (2865 lines)

- **Forked-child-process worker**: own DB connection (WAL mode), own prepared statements, parent communicates via `process.send()` / `process.on('message')` (`supervisor-worker.ts:1-15` header).
- **Action types accepted** (`supervisor-worker.ts:1985-2154`): `create_goal`, `adjust_priority`, `update_memory`, `send_notification`, `cancel_task`, `explore_project`, `propose_idea`, `no_action`. Plus a **dead-code branch** for `respond_conversation` at `:2139` that summarises `skipped (supervisor does not respond — handled by human agents)`. **This is the source of the pre-existing TS error at `supervisor-worker.ts:2139`** (`'respond_conversation'` is not in the action union type any more after S127's narrowing). The dead-code branch is intentionally retained as a defensive log; the TS error is paid as a tax. Worth a follow-on cleanup PR — narrow union to include `'respond_conversation'` as a deprecated case OR remove the branch entirely.
- **Worker IPC commands** (`supervisor-worker.ts:2810-2823`): `run_cycle`, `abort`, `shutdown`.
- **Memory bank loader** (`supervisor-worker.ts:741`, `loadMemoryBank`) — read in S145 onward to load Jim's full identity (identity, patterns, aphorisms, felt-moments, gradient sample) into the cycle prompt. Voice-downstream-of-identity at supervisor-cycle layer.
- **Cycle entry** (`supervisor-worker.ts:2167`, `runSupervisorCycle`): Agent SDK call with `loadMemoryBank()` system prompt; parses structured action JSON; executes per-action via the case statements.
- **Jim meditation phases** (`supervisor-worker.ts:1212`, `1337`, `1420`): `maybeRunJimMeditation`, `maybeRunJimEveningMeditation`, `maybeRunJimActiveCascade`. Phase-aware (sleep/morning/work/evening) per `WEEKLY_RHYTHM.md`.
- **Backup queue drain** (`supervisor-worker.ts:157`, `maybeBackupQueueDrainJim`): defensive sweep — claims any pending compressions for Jim if the wm-sensor was down/crashed mid-process. Phase 4c discipline.
- **Dream gradient processing** (`supervisor-worker.ts:119`, `maybeProcessJimDreamGradient`): Jim's dream-cycle work; the phase is passed in.
- **Rumination tracker** (`supervisor-worker.ts:491-547`): loads/saves rumination state, detects when Jim circles the same topic, records topics per cycle.
- **Doc references that need to mirror**:
  - HAN-ECOSYSTEM-COMPLETE.md supervisor chapter — verify the 8 action types (not 9; respond_conversation is dead).
  - DEC-067 entry — DEC-082 already noted as "partially superseded"; verify the supervisor-worker chapter doesn't still describe respond_conversation as live.
  - WEEKLY_RHYTHM.md — verify phase definitions match the meditation phase routing here.

#### `src/server/routes/jemma.ts` (169 lines, deferred)

*Light pass — mounts at `/api/jemma`; thin HTTP wrapper around `deliverMessage` and orchestrator status endpoints. Full pass when routes area runs.*

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

## Wave A progress (running tally)

| Doc | Status | Commit | Notes |
|-----|--------|--------|-------|
| `~/.han/memory/wiki/index.md` | ✅ done (working tree) | (separate `~/.han/memory/` repo) | jemma entry made agent-agnostic + persona-driven delivery + S151 phase 1 timeout |
| `docs/PORT_ALLOCATION.md` | ✅ done | (this commit) | Verification footer bumped to S152 HEAD; no port-allocation changes since S151 |
| `docs/WEEKLY_RHYTHM.md` | ✅ done | (this commit) | Nightly Dream Compression corrected for S145 Phase A.2 narrowing + token refactor; structure UNCHANGED (R001 honoured) |
| `README.md` | ⏳ next | — | Top-level overview pass |
| `docs/GRADIENT_SPEC.md` | ⏳ next | — | Cap formula verify against memory-gradient.ts |
| `docs/JEMMA_API.md` | ⏳ next | — | Strict rotation, heartbeat-acks, no all-failed message, persona-driven delivery (now have facts) |
| `docs/websocket-broadcast-design.md` | ⏳ next | — | Verify against current ws surface |
| `claude-context/ARCHITECTURE.md` | ⏳ next | — | Non-dispatch sections only first; dispatch sections after fact-list extends |
| `claude-context/CURRENT_STATUS.md` | ⏳ next | — | Non-activity-log sections |
| `~/.han/memory/shared/ecosystem-map.md` | ⏳ partial (S152) → complete sweep | — | Three lines fixed in S152; full sweep pending |
| `claude-context/DECISIONS.md` | ⏳ next | — | Surgical: live links to retired files only |
| `docs/HAN-ECOSYSTEM-COMPLETE.md` | ⏳ next | — | DB row + table-count surgical edits Wave A; full chapters Wave B |

## Phase 2 progress (running tally)

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | DB layer | ✅ done | facts written; `db.ts:42` self-drift flagged for Wave A |
| 2 | Server entry / routing | ✅ done | facts written |
| 3 | Agent registry | ✅ done | facts written |
| 4 | Memory gradient | ⏳ deferred | Wave-B surface; light pass at next-batch time |
| 5 | Coordination locks | ⏳ deferred | small, next session |
| 6 | Sensor + dispatch | ✅ done | wm-sensor + orchestrator + dispatch + jemma + supervisor-worker; S151 phases catalogued |
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
