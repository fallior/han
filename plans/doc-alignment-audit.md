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

### DB layer
*(empty — Phase 2)*

### Server entry / routing
*(empty — Phase 2)*

### Agent registry
*(empty — Phase 2)*

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

### Skills
*(empty — Phase 2)*

---

## Register meta

- **Originating audit:** S152 voice fix (commit `0e4177e`), Jim's audit `mov4mu70-k54dzf` in thread `mou041x1-l1hsit`.
- **Discipline rule incoming Phase 4:** above.
- **This file's own discipline:** every claim about code state cites `file:line`. If this register grows past 500 lines, it gets a `.SHAPE.md` companion of its own.
- **Owner:** Leo (session) until landed; Jim audits per the rhythm; Darron approves at the gate.
