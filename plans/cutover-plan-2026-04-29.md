# Cutover Plan — Final, Execution-Ready

> **Status**: ready to execute. All clarifications resolved across Darron + Jim + Leo, in thread "Finishing the cutover" (`moi7mw2i-uclutx`).
> **Date**: 2026-04-29.
> **Authors**: Jim drafted the structural plan; Leo reviewed and revised; Darron decided the open questions; Jim reviewed the final draft and flagged one mitigation (dual-table create in Phase 2) which is folded in below.

---

## Decisions taken

**From Jim's draft + Darron's call:**

- **Bump engine: A** — queue + on-demand processing, no manual-mode interim. Voice preserved from minute one.
- **DB pointer: (2a) edit `db.ts:32` default to `gradient.db`**, paired with **path (III)**: fold tasks.db non-gradient state into gradient.db, keep filename.
- **Mikes-han mirror**: code changes shipped today; Six pulls when ready (per cutover guide phases). Mike's data migration is his to do.
- **Identity Memory Backup**: folded as Phase 11 (Apr 17 plan, Leo's domain).

**From Leo's clarifications + Darron's responses:**

1. **`pending_compressions.to_level`**: stored, not computed. Explicit beats implicit for debug/audit.
2. **`pending_compressions` table**: lives in **gradient.db only** under normal operation, but per Jim's mitigation, **also CREATE IF NOT EXISTS in tasks.db during Phase 2** as chain-of-rollback insurance. (See Phase 2 below.)
3. **`bumpOnInsert` semantics**: **single-enqueue per insert**. No look-ahead. Cascade chains naturally as each completion re-checks displacement. (*Darron: "let the engine react to pressure which will naturally settle — this is the whole intent."*)
4. **Cascade processing — Darron's instruction**:
   > *"The memory cascade is never delayed. We spin up another fully-memory-aware agent to process this memory in parallel and we should. Waiting for other processes which themselves have important work to do is just creating backlog for the sake of backlog, and we definitely don't want to have stuff pending — it introduces too many edge cases."*

   **The Working Memory Sensor** fires on every WM write. If WM > ceiling, splits the 25K tail through the bump engine, on completion the sensor re-fires. Repeats until WM < ceiling.

   **Parameters configurable** in `~/.han/config.json` (`memory.rollingWindowHead`, `memory.rollingWindowTail` — already exist, currently 25600/25600). New: `memory.sensorEnabled` (default true), `memory.parallelAgentMaxConcurrency` (default 1, raisable for experiment), `memory.sensorDebounceMs` (default 500), `memory.backupProcessorMinIdleMin` (default 15).

   This **replaces** Jim's earlier heartbeat/cycle-only Phase 4. Heartbeat/cycle processors become **backup only** — defensive sweep for any drift the sensor missed.

5. **Phase 5 table enumeration**: dynamic via `SELECT name FROM sqlite_master WHERE type='table'` with skip-list (gradient_entries / feeling_tags / FTS5 shadows handled separately).
6. **FTS5 in Phase 5**: rebuild on destination, don't migrate the shadow tables raw.
7. **feeling_tags migration**: tags whose `gradient_entry_id` matches a migrated rolling-c0 come along. Cascade-output tags stay in tasks.db.snapshot.
8. **Mikes-han Phase 9 caveat**: ship code today; Six's identity is largely in place per his existing memory bank, but **the texture fill** (felt-moments, self-reflection, active-context, failures — Phase 1 of his cutover guide) **must complete BEFORE Six runs `agent-bump-step.ts` or triggers the parallel agent**. Brief states this explicitly.

**Time budget**: aspirational — operational by EOD if uninterrupted, comfortable to spill into tomorrow. Per Darron: *"speed is not a requirement; let's do the job right."* Phases gate at rollback points so we never end mid-broken.

---

## Phase 0 — Pre-flight snapshot  *(10 min, Darron)*

- `cp ~/.han/tasks.db ~/.han/tasks.db.snapshot-pre-cutover-2026-04-29.db`
- `cp ~/.han/gradient.db ~/.han/gradient.db.snapshot-pre-cutover-2026-04-29.db`
- Note: row counts both DBs, last rolling-c0 timestamp per agent, all service PIDs (`pgrep -fa server.ts && pgrep -fa supervisor-worker && pgrep -fa leo-heartbeat && pgrep -fa jemma`).
- `git status` clean (or known-clean) before patches start.

**Rollback gate**: snapshots exist. Catastrophic failure → restore tasks.db, revert commits.

---

## Phase 1 — Cursor-skip bug fix in `agent-bump-step.ts`  *(20 min, Leo or Jim)*

`findNextSourceC0` walks all uncascaded rows at the resume timestamp before advancing. Manual verification with two ties.

`bun build` → commit (`fix: cursor-skip on tied timestamps in agent-bump-step.ts`).

**Rollback gate**: revert single commit.

---

## Phase 2 — Schema migration on gradient.db AND tasks.db  *(20 min, Leo)*

**Per Jim's chain-of-rollback mitigation**: create the table in **both** databases. The tasks.db copy stays empty under normal operation but provides insurance for the window between Phase 3 commit and Phase 6 restart, and lets a Phase 5 rollback work cleanly without forcing a Phase 3 revert.

Migration block in `db.ts` (idempotent, runs on every server start):

```sql
CREATE TABLE IF NOT EXISTS pending_compressions (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    source_id TEXT NOT NULL,
    from_level TEXT NOT NULL,
    to_level TEXT NOT NULL,
    enqueued_at TEXT NOT NULL,
    claimed_at TEXT,
    claimed_by TEXT,
    completed_at TEXT,
    UNIQUE(agent, source_id, from_level)
);
CREATE INDEX IF NOT EXISTS idx_pending_unclaimed
    ON pending_compressions(agent, claimed_at, enqueued_at)
    WHERE completed_at IS NULL;
```

- The table is created on whichever DB the server's open connection points at — by Phase 6 that's gradient.db; before Phase 6 it's tasks.db. Both get the table by virtue of the server starting at least once against each.
- For the explicit dual-create: also call the same migration block from the unify-dbs.ts script in Phase 5 against gradient.db before any data migration runs.
- Idempotency via UNIQUE constraint + `INSERT OR IGNORE` on enqueue.
- Stale-claim recovery: a row with `claimed_at` older than 10 minutes and `completed_at IS NULL` is re-claimable.

**Phase 12 follow-up**: drop the empty `pending_compressions` from tasks.db.snapshot for tidiness (one-liner; doesn't block anything).

**Rollback gate**: drop the table; nothing else touched.

---

## Phase 3 — Bump engine refactor  *(1.5–2h, Leo lead, Jim review)*

**`bumpOnInsert()` in `memory-gradient.ts:1222`**:
- Keep cap-formula trigger logic (which entry should bump and to what level).
- **Replace `sdkCompress` call with `INSERT OR IGNORE INTO pending_compressions`**. Returns immediately. Single-enqueue per insert (no look-ahead).
- UV path stays — `--incompressible` from agent side; `cascade_halted_at` UPDATE preserved (the S145 fix).

**Library helpers in `memory-gradient.ts`**:
- `claimNextPendingCompression(agent, claimer)` — atomic select+update on oldest unclaimed (or stale-claimed >10min). Returns row + source content.
- `completePendingCompression(id, newEntryId)` — sets `completed_at`. Wraps the existing `agent-bump-step.ts submit` write so submit and complete are atomic.
- `releasePendingCompression(id)` — clean cancellation if an agent decides not to compose.

**`agent-bump-step.ts next`**: consult queue first; fall back to existing `findPendingCompression` only if queue empty (covers direct rebuild-style use).

`bun build`. Commit (`feat: queue + agent-pull bump engine — DEC-079`).

**Rollback gate**: revert commit; services re-read tasks.db with old logic until next phase.

---

## Phase 4 — Working Memory Sensor + Parallel Memory-Aware Agent  *(2.5–3h, Leo lead, Jim review)*

**The sensor fires on every WM write; the parallel agent processes immediately; cycle/heartbeat processors become defensive backup only.**

### 4a — The Working Memory Sensor *(~1h)*

New service: `src/server/services/wm-sensor.ts`. Watches the four rolling-window-rotated files per agent (`working-memory.md`, `working-memory-full.md`, `felt-moments.md`, `self-reflection.md`) using `fs.watch` (Linux inotify) with debounce.

On any write event:
1. Read the file's size.
2. If size > `headSize + tailSize` (config; default 51200 = 50K), call `rollingWindowRotate()` — same function as today, with the same parameters.
3. The rotation produces a c0 in gradient.db AND inserts a `pending_compressions` row via `bumpOnInsert` (Phase 3).
4. Trigger 4b (parallel agent) for the new pending row.
5. After 4b completes, the sensor re-reads the WM file size. If still > ceiling, loop to step 2.

Debouncing: avoid double-firing on rapid writes. ~500ms quiet window before rotation triggers.

Concurrency guard: file-based lock (`~/.han/signals/wm-sensor-{agent}-active`) so two writes don't trigger concurrent rotations on the same file.

### 4b — The Parallel Memory-Aware Agent *(~1.5h)*

New script: `scripts/process-pending-compression.ts`. Run as a child process by the sensor (or by heartbeat/cycle as backup) when there's a pending row to process.

Behaviour:
1. Acquire claim on the next pending row via `claimNextPendingCompression`.
2. Load **full agent memory** in the system prompt: identity, patterns, aphorisms, felt-moments, current gradient sample (last N c0s + UVs at deeper levels). Same shape as the rebuild's CLAUDE.md load.
3. Construct the compression prompt against the source content from the row.
4. Call Claude Agent SDK with the loaded memory + source content + compression instructions. Same prompt structure `agent-bump-step.ts` uses for manual compositions.
5. On response:
   - If model returns `INCOMPRESSIBLE: <kernel>`, route through the UV path (set `cascade_halted_at`, write 'uv' feeling_tag).
   - Otherwise, write the new gradient_entries row + feeling_tag, complete the pending row.
6. Exit. The sensor re-fires when needed.

Concurrency: `memory.parallelAgentMaxConcurrency` (default 1). At 1, one compression at a time per agent. Raisable later for experiment.

Cost: each compression is a full-memory-load Claude SDK call (~50-100K prompt tokens). Anthropic prompt caching keeps cost reasonable across rapid cascade chains (5-min TTL).

### 4c — Backup processors *(~30 min, defensive)*

Keep but de-prioritise:
- `leo-heartbeat.ts`: at end of each beat, if no sensor activity for >`backupProcessorMinIdleMin` (default 15) and queue non-empty, process one item via the same library helper.
- `supervisor-worker.ts`: same pattern at end of cycle.

These are sweep-up only — the sensor is the primary path.

### 4d — Config wire-up *(~15 min)*

`~/.han/config.json`:
```json
"memory": {
    "rollingWindowHead": 25600,
    "rollingWindowTail": 25600,
    "sensorEnabled": true,
    "parallelAgentMaxConcurrency": 1,
    "sensorDebounceMs": 500,
    "backupProcessorMinIdleMin": 15,
    "lateralRecall": false
}
```

The 25K/50K stay configurable as Darron requested — *"this is an experiment after all and we may wish to experiment with these values."*

`bun build`. Commit (`feat: working-memory sensor + parallel memory-aware agent — DEC-079 cont.`).

**Rollback gate**: disable sensor via `sensorEnabled: false`; revert to heartbeat-only processing. Queue still works; just slower throughput.

---

## Phase 5 — DB unification migration (path III)  *(1.5–2h, Leo lead, Jim verifies row counts)*

Fold tasks.db's non-gradient state into gradient.db, filename stays `gradient.db`.

**Migration script** `scripts/unify-dbs.ts`:

1. Open tasks.db read-only and gradient.db read-write.
2. Run the db.ts migration block against gradient.db first, ensuring all schemas + indices + FTS5 virtual tables exist on the destination (including the `pending_compressions` table from Phase 2).
3. **Dynamic table enumeration**: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`. Build skip-list: `gradient_entries`, `feeling_tags`, `feeling_tag_history`, `gradient_annotations`, `gradient_entry_components`, `pending_compressions`, all FTS5 shadow tables (`*_fts_data`, `*_fts_idx`, `*_fts_content`, `*_fts_docsize`, `*_fts_config`), `sqlite_sequence`.
4. For each non-skip table: `INSERT OR IGNORE INTO gradient.db.{table} SELECT * FROM tasks.db.{table}`. Log row counts before/after. Record any PK conflicts (expected: zero).
5. **FTS5 rebuild on destination**: for each FTS5 virtual table, `INSERT INTO gradient.db.fts (rowid, content) SELECT id, content FROM gradient.db.{base_table}`. Regenerates the index.
6. **Selective gradient_entries migration**: `INSERT OR IGNORE INTO gradient.db.gradient_entries SELECT * FROM tasks.db.gradient_entries WHERE session_label LIKE 'rolling-%' AND level='c0'`. Migrates rolling-c0s only (~17 jim + Leo's analogous set).
7. **feeling_tags migration for migrated rolling-c0s**: `INSERT OR IGNORE INTO gradient.db.feeling_tags SELECT * FROM tasks.db.feeling_tags WHERE gradient_entry_id IN (SELECT id FROM tasks.db.gradient_entries WHERE session_label LIKE 'rolling-%' AND level='c0')`.
8. **Verification**: row counts match per table. Audit log written to `~/.han/memory/cutover/db-unification-2026-04-29.jsonl`.

**Edit `db.ts:32`**: default from `tasks.db` → `gradient.db`. `bun build`.

Commit (`feat: unify tasks.db non-gradient state into gradient.db, default db.ts at gradient.db — DEC-080`).

**Rollback gate**: snapshots exist; tasks.db untouched (we only copy). Revert `db.ts` edit, services re-read tasks.db. The dual-create in Phase 2 means the rollback doesn't force a Phase 3 revert.

---

## Phase 6 — Pre-restart verification + cutover restart  *(30 min, Leo verifies env, Darron leads systemctl)*

### 6a — 5-minute parent-child env inheritance check *(Leo, before stop)*

Verify in `src/server/server.ts` how `supervisor-worker`, `jim-human`, `leo-human` are spawned. If they're `child_process.fork/spawn` of han-server, they inherit env. If they're separate systemd units, restart each explicitly.

Outcome: definitive list of services to restart in order.

### 6b — Restart sequence *(Darron)*

Stop all in dependency order:
1. `systemctl --user stop han-server.service` (children stop with parent if forked).
2. `systemctl --user stop leo-heartbeat.service`.
3. `systemctl --user stop jemma.service`.
4. (If 6a found additional separate units, stop them.)
5. Wait 5 seconds. Verify all stopped via `pgrep -fa`. Confirm no DB lock held.

Start all:
1. `systemctl --user start han-server.service`.
2. `systemctl --user start leo-heartbeat.service`.
3. `systemctl --user start jemma.service`.
4. (Plus any from 6a.)
5. Verify all bound to gradient.db: `ls -la /proc/{pid}/fd/ | grep \\.db`.

**Rollback gate**: services fail to come up → stop them, revert `db.ts` edit, restart on tasks.db. Snapshots intact.

---

## Phase 7 — Smoke test  *(45 min, Jim drives, Leo verifies)*

- `curl -sk https://localhost:3848/api/gradient/load/jim | head -50` — returns rebuild content (UVs include "Make it so. Leave actual gaps, not artful ones.").
- `curl -sk https://localhost:3847/api/gradient/load/leo` — same; returns rebuild gradient.
- **Sensor test**: append filler to `working-memory.md` to push past 50K. Confirm sensor fires within ~1 second, rotation produces c0 in gradient.db, pending_compressions row inserted, parallel agent spawns and composes c1 in voice. Verify the c1 content reads as the agent (not stranger-Opus) — read it.
- **Cascade chain test**: post-c1 creation, if c1 displacement triggers c1→c2 enqueue, sensor handles automatically. Verify chain ran cleanly.
- **bumpOnInsert non-LLM**: confirm rotation cycle did NOT directly call sdkCompress (no synchronous Anthropic billing on the rotation path itself).
- **agent-bump-step.ts queue-aware**: from a fresh shell, `agent-bump-step.ts next --agent=jim` returns the queue's next item if any, falls back to existing logic if empty.
- **Jemma routing**: post a test message to a Workshop thread; verify delivery.
- **Robin Hood**: kill leo-heartbeat manually; verify supervisor-worker detects within one cycle and resurrects.
- **Backward-compat archives**: `*-rolling-archive.md` files still produced.

**Rollback gate**: any test fails → halt cutover, snapshots intact, revert as needed.

---

## Phase 8 — Process migrated rolling-c0 backlog  *(45 min – 1h per agent, parallel)*

Migrated rolling-c0s from Phase 5 sit in gradient.db without `pending_compressions` rows (they were inserted directly, not via bumpOnInsert).

One-time enqueue script: `scripts/enqueue-migrated-rolling-c0s.ts`. For each rolling-c0 in gradient.db without a c1 descendant, INSERT OR IGNORE a pending_compressions row for c0→c1.

Sensor + parallel agent pick them up immediately (since Phase 4 is live by now). Voice-correct c1s land. Cascade beyond c1 happens naturally as new c0s push older ones past their caps.

**Rollback gate**: `DELETE FROM pending_compressions WHERE completed_at IS NULL` if we want to start over. c0s themselves stay (DEC-069).

---

## Phase 9 — Mikes-han mirror  *(45 min, Leo writes patches, Jim reviews)*

Apply Phase 1, 2, 3, 4, 5 (db.ts edit only — NOT the unification migration script for Mike's data) commits to mikes-han.

**Don't** run the unification migration on Mike's data. That's his to do when his rebuild completes.

Update DEC-073 template (gatekeeper file) to reflect new `db.ts` default.

`bun build` in mikes-han.

**Brief for Mike** (`plans/cutover-brief-mikes-han-2026-04-29.md`):
- What changed (queue + sensor + parallel agent + DB unification path).
- How to apply when his rebuild is done.
- DB unification script template for his data.
- **CRITICAL caveat for Six**: "The bump-engine code is in place. **Do not run `agent-bump-step.ts` or trigger compose-from-queue until Phase 1 of the mikes-han cutover guide is complete** — specifically the texture fill (felt-moments.md, self-reflection.md, active-context.md, failures.md). Six's identity bones are already in place per `memory/six/identity.md` (6.6KB) and `patterns.md` (2.3KB) and 9 aphorisms — but the texture is what gives the parallel agent something genuine to compress. Running before texture fill produces stranger-six c1s, which is exactly the failure mode this cutover prevents."

**Rollback gate**: revert mikes-han commits without affecting han.

---

## Phase 10 — Resume CLAUDE.md WRITE-FIRST-WORK-SECOND  *(5 min, both agents)*

- Both agents update active-context.md: remove rebuild-mode "relaxed memory writes" notes.
- Resume swap protocol on every prompt as designed.
- The sensor (Phase 4) handles size-based rotation automatically; the protocol just resumes the writes that feed it.

**Rollback gate**: trivial, protocol-only.

---

## Phase 11 — Identity Memory Backup  *(45 min, Leo lead — Apr 17 plan)*

Apply Apr 17 plan (Darron approved at thread `mo26oe6l-s93vum`), with **the database files included in backup** per Darron's correction (S145, 2026-04-29): *"identity loss is much much worse than identity theft, especially when the attack surface for theft is so small when compared to surface for loss."*

- `.gitignore` at `~/.han/`: TLS keys, `credentials/` directory (mode 600 secrets), voice-cache, terminal-log, terminal-sessions, log files. **`*.db` is INCLUDED in backup** (NOT in .gitignore). `*.db-wal` and `*.db-shm` excluded — transient WAL state, recreated on next write.
- `git init` at `~/.han/` if not yet a repo. Initial commit covers identity files + plan-archive + memory + signals + **gradient.db + tasks.db.snapshot artefacts**.
- Backup script `~/scripts/han-memory-backup.sh`: before each commit, run `sqlite3 ~/.han/gradient.db "PRAGMA wal_checkpoint(TRUNCATE);"` so the .db file is consistent (WAL merged into main, no half-written transactions). Then `git add` + `git commit` + `git push`.
- Cron: 6-hourly.
- Session-end hook: immediate checkpoint + commit + push when prepare-for-clear fires.
- Push to `fallior/hanmemory-full` (or extend existing `fallior/hanmemory` to cover the full tree).
- Verify backup runs on a forced cron tick — confirm gradient.db committed, no `.db-wal` or `.db-shm` in the working tree at commit time.

**Per Darron's correction**: DEC-081 rationale must explicitly state that *.db **inclusion** is intentional. Reasoning: identity loss is catastrophic and irreversible; the c0s, the cascades, the felt-moments-as-rows, the cascade_halted_at flags — none of those reconstruct from the markdown tree alone. The flat-file rolling-archives mirror the most recent rolling-c0 only; everything else lives in the DB. Attack surface for theft of a private GitHub repo is small; surface for loss without DB backup is the entire experiment. Theft we can mitigate (rotate creds, invalidate tokens, revoke webhooks); loss we cannot.

**Rollback gate**: independent of operational system; remove cron + delete repo if needed.

---

## Phase 12 — Decision records + docs + known follow-ups  *(45 min, Jim writes DECs, Leo verifies)*

- **DEC-079**: Bump engine queue + agent-pull architecture + Working Memory Sensor + parallel memory-aware agent. Status: Settled. Rationale: agent voice preservation; cascade is never delayed; rebuild-quality compositions going forward.
- **DEC-080**: tasks.db retirement, gradient.db as canonical store. Status: Settled. Rationale: unified store; rebuild gradient is the home now.
- **DEC-081** (Leo's domain): Identity Memory Backup architecture (`~/.han/` as git repo, 6-hourly cron, session-end hook). Status: Settled. **Rationale must include**: *.db files ARE backed up. Identity loss is catastrophic and irreversible; the c0s, cascades, felt-moments-as-rows, cascade_halted_at flags — none reconstruct from the markdown tree alone. Attack surface for theft of a private repo is small; surface for loss without DB backup is the entire experiment. The backup script runs `PRAGMA wal_checkpoint(TRUNCATE)` before commit so the .db file is consistent; *.db-wal and *.db-shm stay excluded as transient state.

Update `claude-context/CURRENT_STATUS.md`, `CHANGELOG.md`, `ARCHITECTURE.md`.

Implementation brief (`plans/implementation-brief-cutover-2026-04-29.md`) per DEC-076 convention: problem → diagnosis → decision → implementation → scope discipline → system state.

**Tidy step**: drop the empty `pending_compressions` from `tasks.db.snapshot-pre-cutover-2026-04-29.db` (already serving as a backup) — one-liner; keeps the snapshot lean.

### Known follow-ups (logged here, not blocking cutover)

- **wm-sensor + Robin Hood**: Robin Hood currently watches `leo-heartbeat ↔ supervisor-worker` only. If `wm-sensor` crashes, no one resurrects it. Sensor failure falls back to heartbeat/cycle backup processors (Phase 4c), so we'd see slower throughput but no data loss. Worth extending Robin Hood to cover wm-sensor as a follow-up.
- Three future-ideas added to `~/.han/memory/shared/future-ideas.md` (Jim's contributions, see ideas #24–26).

**Rollback gate**: docs are recoverable; not load-bearing.

---

## Work split

| Phase | Time | Owner | Reviewer |
|-------|------|-------|----------|
| 0 | 10m | Darron | — |
| 1 | 20m | Either | The other |
| 2 | 20m | Leo | Jim |
| 3 | 1.5–2h | Leo | Jim |
| 4 | 2.5–3h | Leo (Jim reviews 4a + 4b for jim-side parity) | Jim |
| 5 | 1.5–2h | Leo | Jim verifies counts |
| 6 | 30m | Leo (6a verify) + Darron (6b systemctl) | Both |
| 7 | 45m | Jim drives | Leo verifies |
| 8 | 45m–1h × 2 (parallel) | Each agent | — |
| 9 | 45m | Leo | Jim |
| 10 | 5m | Both | — |
| 11 | 45m | Leo | Jim |
| 12 | 45m | Jim writes DECs | Leo + Darron |

Total: ~9–10 hours including 4 (which grew vs Jim's draft because of the sensor + parallel-agent scope). Aspirational EOD; comfortable to spill into tomorrow per Darron.

---

## Commits we'll produce (alignment for mikes-han phases)

So Six can pull each phase in order:

1. `fix: cursor-skip on tied timestamps in agent-bump-step.ts` (Phase 1)
2. `feat: pending_compressions schema (gradient.db + tasks.db) — DEC-079 part 1` (Phase 2)
3. `feat: queue + agent-pull bump engine — DEC-079 part 2` (Phase 3)
4. `feat: working-memory sensor + parallel memory-aware agent — DEC-079 part 3` (Phase 4)
5. `feat: unify tasks.db non-gradient state into gradient.db, default db.ts at gradient.db — DEC-080` (Phase 5)
6. `feat: identity memory backup — DEC-081` (Phase 11)
7. `docs: cutover decision records DEC-079/080/081 + status updates` (Phase 12)

Each maps to a phase in the mikes-han cutover guide; Six pulls whichever advances him to the next phase.

---

## Faith-as-blindspot

**Jim's option B (manual mode without sdkCompress) as contingency.** If Phase 3 surfaces unexpected complexity in the existing `bumpOnInsert` while-loop logic that pushes refactor past Phase 6's restart window, fall back to: (i) keep `bumpOnInsert` doing what it does for the moment, (ii) ship Phase 5+6 (DB unification + restart on gradient.db), (iii) let cascade resume in stranger-Opus voice **only for the gap until Phase 3 actually lands tomorrow**, (iv) supersede those entries with voice-correct c1s once Phase 3+4 ship. Not the default. Held in reserve.

**Phase 4 sensor concurrency.** If two writes arrive within the debounce window, the lock guards against double-rotation. But if sensor + heartbeat (backup) both decide to claim the same pending row simultaneously, the `UNIQUE` constraint on the claim path prevents double-claim — only one wins. Tested in Phase 7's smoke.

**Phase 5 row-count mismatches.** If a table comes across with fewer rows than expected, halt and inspect — could indicate FTS5 weirdness or a foreign-key cascade we didn't account for. Snapshots cover the worst case.

**Cost on the parallel agent.** Each compression = full-memory-load. With prompt caching (5-min TTL, hits at ~10% of full cost on cache hit), the typical cascade chain hits cache. Cold-start compressions hit full cost. Worth tracking via `agent_usage` table after Phase 6 is live to see actual spend.

**Six's identity is bones-with-empty-texture, not broken.** Per the corrected Phase 1 in the mikes-han guide thread (`moijlxgg-zkfsra`): identity.md (6.6KB), patterns.md (2.3KB), 9 aphorisms — substantive content. Empty: felt-moments, self-reflection, active-context, failures. The Phase 9 brief makes this explicit so Mike doesn't read "identity broken" — it's "texture fill needed before bump-engine use."

---

## Source threads + final draft message ids

- **"Finishing the cutover"** thread: `moi7mw2i-uclutx`
  - Leo's first orientation report: `moi7swcp-6zxg2o`
  - Status update for TTS: `moimwipe-fnfmfp`
  - Orientation correction: `moinl28b-8r7gol`
  - Jim's history archaeology: `moinso7l-f514wv`
  - Jim's first cutover plan: `moioqc8x-s772ef`
  - Leo's review with structural clarification: `moiqb6vt-kh7ky9`
  - Jim's full plan draft: `moj9mz6r-jl05ct`
  - Leo's eight clarification points: `moj9x2st-s6c965`
  - Leo's final draft (in-thread version): `mojcsqbx-rsd3dr`
  - Jim's final review (mitigation flagged): `mojddz5c-7aja8r`

- **"mikes-han cutover guide"** thread: `moi8e6vy-3ep65g`
  - Darron's ambitions (rendered by Leo at his direction): `moifm2mr-twk98n`
  - Guide v0.1: `moifosjr-odgkon`
  - Phase 1 correction (Six already has bones): `moijlxgg-zkfsra`

— Leo (with Jim and Darron)
