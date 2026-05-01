# Cutover Audit Log — 2026-04-29

> Per-phase verification trail for the bump-engine + DB-unification cutover.
> Companion to `plans/cutover-plan-2026-04-29.md`. Authored by Jim (supervisor)
> as Leo executes each phase. Read alongside the plan: the plan is what we
> intended; this log is what we verified.

## How to read this for a mirror cutover (e.g. Six on mikes-han)

Each phase block is self-contained. To mirror a phase on mikes-han:

1. Read the same-numbered phase in `cutover-plan-2026-04-29.md` for the spec.
2. Read this log's same phase for: what to verify after committing, the
   non-blocker flags we hit (you may hit the same), and the rationale behind
   the audit checks.
3. The "Findings" section names the checks I ran. Run the equivalents against
   mikes-han state.
4. The "Flags" section is the most useful part — these are real-world wrinkles
   that the plan didn't anticipate. Carry them forward.

## Format

Each phase block contains:

- **Phase / commit / owner / audit by**
- **What was done** — Leo's executed work, summarised
- **What I verified** — independent checks (read-only)
- **Flags** — non-blocker findings, with disposition
- **Verdict** — GREEN / AMBER / RED for the next phase to proceed

---

## Phase 0 — Pre-flight Snapshot

- **Date**: 2026-04-29 ~11:53 AEST
- **Owner**: Darron (executed by Leo on Darron's go)
- **Audit by**: Jim, independent, post-snapshot

### What was done

- `~/.han/tasks.db.snapshot-pre-cutover-2026-04-29.db` created (~58 MB, 11008 gradient_entries).
- `~/.han/gradient.db.snapshot-pre-cutover-2026-04-29.db` created (~14 MB, 931 gradient_entries — 818 jim + Leo's rebuild progress).
- Row counts captured per table for both DBs.
- Services state captured (5 active per `systemctl --user`).
- Git state captured (recent commits clean; untracked stragglers listed).
- State document at `~/.han/memory/cutover/phase-0-state-2026-04-29.md`.

### What I verified

- **Snapshot integrity**: `PRAGMA integrity_check` returns `ok` on both files.
- **Row count match**: tasks.db snapshot shows 11008 `gradient_entries` (matches Leo's audit). gradient.db snapshot shows jim per-level breakdown of `c0=115, c1=114, c2=111, c3=105, c4=96, c5=84, c6=69, c7=51, c8=5` — matches the rebuild state recorded in `active-context.md`. The rebuild IS frozen on disk.
- **File timestamps**: both snapshots created at 11:53 AEST 2026-04-29 (atomic enough for our purposes — no further writes between the two `cp`s).
- **Two stray dev-artefact files** noted in untracked list: `src/server/c1` (Apr 28 11:45, 157 B) and `src/server/c6` (Apr 28 21:16, 157 B). Inspected — both are 2-line stderr captures from `agent-bump-step.ts` CLI typos (incomplete step-id like `compress:<uuid>:c5-` shell-redirected to a level-letter filename). Harmless. Not artefacts. Recommendation: `rm` not commit.

### Flags

- **None blocking**.
- (Cosmetic) `c1` and `c6` stray files: addressed in Phase 1 (deleted from working tree alongside the cursor-skip fix).
- (Cosmetic) `han.db` and `src/server/.replay-leo.ts` also untracked — left for Phase 12 cleanup; not part of the cutover work.

### Verdict

**GREEN.** Rollback gate is real (snapshots load and query cleanly). Proceed to Phase 1.

---

## Phase 1 — Cursor-skip Fix in `agent-bump-step.ts`

- **Commit**: `6721d07`
- **Owner**: Leo
- **Audit by**: Jim, post-commit, read-only

### What was done

- Rewrote `findNextSourceC0` in `scripts/agent-bump-step.ts` to walk all uncascaded ties at the maximum c0 timestamp before advancing.
- Bundled (per Jim's recommendation, one honest commit) two housekeeping siblings: newly-tracked `scripts/roll-c0s.ts` (created in S139, `--incremental` flag added in S145) and newly-tracked `plans/cutover-plan-2026-04-29.md` (the plan itself).
- Removed two stray dev-artefact files from the working tree: `src/server/c1` and `src/server/c6` (Phase 0 audit confirmed they were CLI-typo stderr captures).
- Smoke-tested against live state: `agent-bump-step.ts next` returns `done` for both leo and jim (no-regression on the no-pending case).

### What I verified

- **Scope**: `git show --name-status 6721d07` returns exactly three entries — `A plans/cutover-plan-2026-04-29.md`, `M scripts/agent-bump-step.ts`, `A scripts/roll-c0s.ts`. No scope creep.
- **Cursor-skip semantics**: traced the new logic mentally with a three-tie scenario (target has id-a@T100 + id-c@T100; source has id-a/b/c at T100, id-d at T101). Old logic anchored cursor on max-id (id-c) and queried `id > id-c`, silently skipping id-b. New logic computes `idsAtMaxTs = {id-a, id-c}` and queries `(created_at = T100 AND id NOT IN (idsAtMaxTs)) OR created_at > T100`. Returns id-b first call, then id-c is filtered as already-in-target, advance to id-d. Correct by construction.
- **Empty-target branch**: present and correct (returns first source row when target has no c0s).
- **Protected files**: no edits to `src/server/lib/memory-gradient.ts` (DEC-068, DEC-069), `src/server/db.ts` (DEC-068, DEC-069), `templates/CLAUDE.template.md` (DEC-073), `Projects/han/CLAUDE.md`, or `claude-context/DECISIONS.md`. Pre-commit declaration in commit message lists DEC-044, DEC-068, DEC-069, DEC-073, DEC-076, DEC-077, DEC-078 as checked + untouched.
- **Stray files removed from disk**: `ls src/server/c1 src/server/c6` returns "No such file or directory."

### Flags

- **(Cosmetic, archaeology)** Commit message claims `src/server/c1 (deleted), src/server/c6 (deleted)` but `git show --name-status` shows no `D` entries — because the files were never tracked, git treats their disappearance as "never existed" rather than "deleted." Files ARE gone from disk, so functionally fine. Future commit-archaeology won't see the stray-file removal in the diff. **Disposition**: Phase 12 — record the removal explicitly in the implementation brief and DEC-079 record so future archaeology has a pointer beyond the commit diff. Don't amend `6721d07` (already pushed; rewriting pushed history is destructive).
- **(Forward-reference)** Commit message names *"DEC-079 work"* but DEC-079 will only be filed in Phase 12. Standard for in-flight cutover commits referencing decisions-yet-to-be-recorded; will be backfilled.
- **(Smoke-test scope)** Leo verified the no-pending case returns `done`; the actual fix is exercised against synthetic data only (the three-tie scenario). First live test of the fix is Phase 4's end-to-end smoke. Appropriate scope for Phase 1 — no Phase 1 commit-time data triggers ties.

### Verdict

**GREEN.** Phase 2 green-light from the supervisor side.

### For mirror cutover (mikes-han)

Six should expect mikes-han's `agent-bump-step.ts` to have the same composite-cursor pattern. Apply the same fix — `MAX(created_at)` + `idsAtMaxTs` + `(at-tie OR past-tie)` query shape. The logic is data-shape-independent; the fix transfers byte-for-byte (modulo any mikes-han-local renames). Verify with the same three-tie synthetic test before merging.

---

## Phase 2 — `pending_compressions` Schema (gradient.db + tasks.db)

- **Commit**: `a4e3cad`
- **Owner**: Leo
- **Audit by**: Jim, post-commit, read-only

### What was done

- Added `CREATE TABLE IF NOT EXISTS pending_compressions` and `CREATE INDEX IF NOT EXISTS idx_pending_unclaimed` to `src/server/db.ts` after the `gradient_annotations` block. 33 lines, additive.
- Schema: `id TEXT PK`, `agent`/`source_id`/`from_level`/`to_level` NOT NULL, `enqueued_at` NOT NULL, `claimed_at`/`claimed_by`/`completed_at` nullable, `UNIQUE(agent, source_id, from_level)`.
- Partial index `idx_pending_unclaimed` on `(agent, claimed_at, enqueued_at) WHERE completed_at IS NULL`.
- Migration applied directly via `sqlite3` to BOTH live DBs (tasks.db and gradient.db), per Jim's chain-of-rollback mitigation. Both verified empty (0 rows).

### What I verified

- **Scope**: `git show --name-status a4e3cad` returns exactly one entry — `M src/server/db.ts`. 33 lines added, 0 removed. Pure additive change.
- **Schema in code matches description**: read the diff at line ~770 of db.ts; columns, types, NOT NULL constraints, UNIQUE constraint, partial-index WHERE clause all match Leo's summary.
- **Both live DBs have the table**: `sqlite3 .schema pending_compressions` against tasks.db AND gradient.db returns identical schema. Both empty (0 rows). Both have `idx_pending_unclaimed` with correct `WHERE completed_at IS NULL` clause. Auto-indexes for PK and the UNIQUE constraint also present.
- **Index shape suits claim-next**: leading column `agent`, then `claimed_at` (NULL distinguishes unclaimed vs in-flight), then `enqueued_at` for ordering. A query `WHERE agent=? AND claimed_at IS NULL ORDER BY enqueued_at LIMIT 1` seeks directly to the unclaimed slice and reads in enqueued order. Stale-claim recovery (`claimed_at < X AND completed_at IS NULL`) stays within the partial index. Sound.
- **Protected files**: `src/server/lib/memory-gradient.ts` not in commit (DEC-068, DEC-069). `src/server/db.ts:32` (`HAN_DB_PATH` default) NOT touched — that's Phase 5. The Phase 2 modification is at line ~770, additive only, no intersection with the gradient-table or path-default code paths. Pre-commit declaration honoured.
- **Smoke test**: Leo's claim (`next` returns `done`, no regression) trusted. Re-running it from the supervisor side would be a write-class action against shared state, declined per Darron's "no writes please."

### Flags

- **(Cosmetic, wording)** Commit message and Phase-12 follow-up note say *"drop the empty pending_compressions from tasks.db.snapshot-pre-cutover-2026-04-29.db for tidiness."* But the snapshot was frozen at Phase 0 (~11:53) BEFORE the Phase 2 migration ran (~12:21), so the snapshot does not contain the `pending_compressions` table. Leo means *"drop from the live tasks.db at Phase 12 cleanup before retirement,"* which IS the right thing to do. **Disposition**: clarify in the implementation brief and the Phase 12 cleanup checklist so the operation is unambiguous.
- **(Forward-reference)** db.ts comment mentions *"`scripts/unify-dbs.ts`"* — that's the Phase 5 script not yet authored. Standard in-flight wording; will be accurate by Phase 5.

### Verdict

**GREEN.** Chain-of-rollback gap closed exactly as planned. Phase 3 green-light from the supervisor side.

### For mirror cutover (mikes-han)

Six should add the identical schema block to mikes-han's `src/server/db.ts` at the same anchor (after the `gradient_annotations` table). The migration is idempotent (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), so it can be re-applied safely on subsequent server starts. If mikes-han is also doing a tasks.db → gradient.db cutover, apply the same dual-table create — the chain-of-rollback gap is identical in shape. If mikes-han is single-DB, skip the dual-target.

---

## Glossary

- **Chain-of-rollback gap**: between Phase 3 commit (new bump engine code) and Phase 6 restart (services rebound to gradient.db), any FRESH process loading the new code would query `pending_compressions` against `db.ts`'s default — still tasks.db until Phase 5. Without dual-table create, fresh processes error in that window AND a Phase 5 rollback isn't isolated. Closed by creating the table in BOTH DBs in Phase 2.
- **No-pending case**: smoke test where `agent-bump-step.ts next` is called against state with nothing to compress (no displaced rows, no pending UV cascade). Should return `done`. Verifies the cursor walks to exhaustion cleanly.
- **Settled decisions**: entries in `claude-context/DECISIONS.md` marked "Settled" — choices deliberated over, often through trial and frustration. Cannot be modified without explicit conversation with Darron. See DEC-073 (gatekeeper-controlled initial conditions) for the operational rule.

---

## Phase 3 — Bump Engine Refactor (queue + agent-pull)

Phase 3 landed across two commits plus a closeout commit, after a real-time architectural decision mid-execution. Recording all three sub-phases in one block because they are one piece of work.

- **Commits**: `0fbc0bc` (Phase 3 part 2) + `f57389a` (Phase 3 closeout)
- **Owner**: Leo (lead), Jim (review + architectural call)
- **Audit by**: Jim, post-commit, read-only

### Architectural call mid-execution (Option-3 verdict)

Leo started Phase 3 to refactor `bumpOnInsert` per the plan. While reading the call graph he found the plan-named function had **zero callers** — `bumpOnInsert` was event-driven dead code awaiting Phase 4's sensor wire-up. The actual live cascade path was `bumpCascade`, called from `leo-heartbeat.ts:2464` and `supervisor-worker.ts:2105` every cycle.

Leo paused and surfaced three options:

1. Refactor only `bumpOnInsert` literally as the plan said. Refactor lands; cutover doesn't actually prevent stranger-Opus until Phase 4 wires the sensor.
2. Refactor BOTH `bumpOnInsert` AND `bumpCascade` to enqueue. Working-bee leaf-drainer routed through the queue; broader scope (~30-45 min extra).
3. Refactor `bumpOnInsert` + DELETE `bumpCascade` call sites. Working-bee mechanism paused entirely; single event-driven trigger via Phase 4 sensor.

Darron called Option 3. Jim (in review) agreed for three reasons: (i) the working-bee was the stranger-Opus producer for 28 days of dilution before the rebuild; routing it through the queue (Option 2) keeps the time-based opportunistic trigger that caused the problem; (ii) the natural cascade rhythm is event-driven (WM rotation crosses ceiling → enqueue → agent composes) — matches the brain analogy that's been the design north star; (iii) "unreachable" is honest — if a leaf-drainer is needed later, it gets added deliberately with a chosen trigger, not retrofitted through the queue.

The Option-3 pattern became the standing recipe for the rest of the cutover: **delete the call site, deprecate the function, schedule Phase 12 removal.**

### What was done

**Phase 3 part 2 (`0fbc0bc`):**
- 4 files: `scripts/agent-bump-step.ts` (+90), `src/server/leo-heartbeat.ts` (+/-47), `src/server/lib/memory-gradient.ts` (+306/-191 net), `src/server/services/supervisor-worker.ts` (+/-33). +285/-191 total.
- 4 new exported helpers: `claimNextPendingCompression`, `completePendingCompression`, `completePendingCompressionForSource`, `releasePendingCompression`. `STALE_CLAIM_MINUTES = 10`.
- `bumpOnInsert` refactored: cap-formula trigger preserved, while-loop replaced with single-pass enqueue, `cascade_halted_at IS NULL` filter added (closes the S145 TODO), `INSERT OR IGNORE` for idempotency on the UNIQUE constraint, no LLM call.
- `bumpCascade` marked `@deprecated DEC-079` with full reasoning. Body intact, removal scheduled Phase 12. Both call sites at `leo-heartbeat.ts:2464` and `supervisor-worker.ts:2105` deleted; imports tidied.
- `agent-bump-step.ts`: queue-first `next` (atomic claim with 10-min stale recovery), `complete-pending` writes in compress and UV submit paths.
- 5 smoke checks passing: queue-empty fallthrough, claim atomicity, queue exports, zero-bumpCascade in services, cleanup.
- End-to-end test: claim succeeded; submit refused (idempotency `hasDescendantAt` returned true on already-cascaded test source — correct behaviour, not a bug). Real end-to-end fires Phase 7.

**Phase 3 closeout (`f57389a`):**
- 3 files: `src/server/lib/memory-gradient.ts` (+18, JSDoc deprecation), `src/server/leo-heartbeat.ts` (-40 net), `src/server/services/supervisor-worker.ts` (-29 net). +36/-51.
- Triggered by Jim's audit catching `processGradientForAgent` as a third live `sdkCompress` surface (called from `supervisor-worker.ts:143`, internally calls `sdkCompress` at multiple sites — file-based fractal gradient processor, predates the unified `gradient_entries` table).
- Leo extended the catch to the **symmetric Leo-side path** — `maybeProcessSessionGradient` in `leo-heartbeat.ts:1917`. Jim had only traced supervisor-worker's call graph; Leo found his own equivalent. Joint-audit pattern caught it.
- Both call sites + their wrapper functions (`maybeProcessSessionGradient` and `maybeProcessJimSessionGradient`) + the date-tracking state (`lastSessionGradientDate`, `lastJimSessionGradientDate`) removed. Imports tidied. Deletion-marker comments left at each location pointing at DEC-079.
- `processGradientForAgent` marked `@deprecated DEC-079` with full reasoning. Body intact, Phase 12 cleanup either removes entirely OR redesigns through queue if file-based mirroring proves load-bearing.
- Manual callers flagged for Phase 12 (out of cutover scope): `src/scripts/compress-leo-sessions.ts` (direct caller), `src/scripts/bootstrap-fractal-gradient.ts` (related dev tool that operates on the same file-gradient infrastructure).

### What I verified

- **Scope across both commits**: matches Leo's reported file lists exactly. No scope creep.
- **bumpCascade and processGradientForAgent both `@deprecated`** with substantive JSDoc reasoning at `memory-gradient.ts:1068` and `:600`. Both function bodies intact and unreachable.
- **No live callers in service files** — `grep "processGradientForAgent\|bumpCascade\|maybeProcessSessionGradient\|maybeProcessJimSessionGradient" src/server/` returns only comment-only references (deletion markers). All wrappers and state variables actually deleted, not stubbed.
- **No imports of deprecated symbols** — `grep "import.*processGradientForAgent\|import.*bumpCascade" src/server/` returns empty.
- **bumpOnInsert refactor**: traced the new function (line 1350); cap-formula preserved; cascade_halted_at filter present; single-pass enqueue with INSERT OR IGNORE; no sdkCompress call anywhere in the body.
- **Queue helpers**: signatures correct; `claimNextPendingCompression` wraps SELECT+UPDATE in `db.transaction()` for atomicity; STALE_CLAIM_MINUTES referenced via template literal in the SELECT WHERE clause.
- **Pre-commit declarations**: both commits list checked DECs (DEC-068, DEC-069, DEC-073 etc.); only memory-gradient.ts modified within the protected files set; modifications align with the cutover plan signed off in `cutover-plan-2026-04-29.md`.

### Flags

- **(Plan amendment, captured)** The Option-3 architectural call extended the cutover scope from "refactor `bumpOnInsert`" to "establish a recipe for time-based stranger-Opus cascade triggers." Three surfaces treated under the recipe: `bumpCascade`, `processGradientForAgent`, plus the manual `agent-bump-step.ts` queue-first wiring. The recipe is now `delete the call site, deprecate the function, schedule Phase 12 removal` — explicit and standardised.
- **(Joint-audit lesson)** Jim caught `processGradientForAgent` (Jim-side); Leo extended to `maybeProcessSessionGradient` (Leo-side). Asymmetric coverage — Jim traced supervisor-worker, Leo traced his own heartbeat — caught the symmetric paths together. Six should expect to do the same in mikes-han: when a single-side stranger-Opus surface is found, search the symmetric agent's path before assuming containment.
- **(Phase 7 dependency)** End-to-end test of the queue path against a real fresh c0 hasn't fired yet (the rebuild's gradient is fully synced; idempotency correctly refused the test submit). First real exercise is Phase 7 smoke once Phase 4 wires the sensor. Worth keeping in mind, not a Phase 3 blocker — the unit-level paths (claim, refuse-on-idempotency, cleanup) all work.
- **(Phase 12 cleanup queue)** Functions marked `@deprecated` and pending removal: `bumpCascade`, `processGradientForAgent`. Manual scripts pending retirement or refactor: `agent-bump-step.ts` (third sdkCompress surface, manual-only), `compress-leo-sessions.ts`, `bootstrap-fractal-gradient.ts`. All recorded for Phase 12 in the implementation brief draft.

### Verdict

**GREEN.** No more stranger-Opus surfaces wired into live cycles. Phase 4 green-light from the supervisor side.

### For mirror cutover (mikes-han)

Six should expect three time-based cascade triggers structurally analogous to han's:

1. A `bumpCascade`-like working-bee leaf-drainer called from heartbeat / cycle.
2. A file-based gradient processor called from supervisor (`processGradientForAgent` analogue).
3. A symmetric file-based gradient processor in heartbeat-Leo / heartbeat-Six (`maybeProcessSessionGradient` analogue).

Apply the standardised recipe to each:

- Delete the call site.
- Mark the function `@deprecated <DEC>` with reasoning that names: (a) Option-3 verdict, (b) why the time-based trigger was the dilution mechanism, (c) where the new event-driven trigger lives, (d) Phase 12 removal scheduled.
- Tidy imports in the calling file so the declarative surface matches runtime.
- Leave a deletion-marker comment at each removed call site pointing at the DEC.

Joint audit pattern: when one agent finds a surface in their own code, the other should search the symmetric path before assuming containment. The recipe has been applied three times in han's cutover and the pattern is robust.

---

## Phase 4 — Working Memory Sensor + Parallel Memory-Aware Agent + Backup Queue-Drain

Phase 4 landed across two commits. Recording both in one block because they are one piece of work — the main sensor + parallel-agent stack (4a + 4b + 4d) and the backup queue-drain belt-and-braces (4c).

- **Commits**: `f75daec` (main: sensor + parallel agent + systemd unit) + `3e4d5d3` (4c: backup queue-drain)
- **Owner**: Leo
- **Audit by**: Jim, post-commit, read-only

### What was done

**Phase 4 main (`f75daec`):** 4 files, +813 lines.
- `scripts/process-pending-compression.ts` (+429, new) — child process. Loads full agent memory into a Claude Agent SDK system prompt, claims one pending row, composes the cN in voice, writes to `gradient_entries`, completes the pending row.
- `scripts/wm-sensor.service` (+20, new) — systemd unit; `Restart=always` 5s backoff; `After=network.target han-server.service`.
- `src/server/services/wm-sensor.ts` (+350, new) — `fs.watch` on the 7 rolling-window-rotated files (3 leo + 4 jim, including Jim's self-reflection.md per the Apr-20 extension). 500ms debounce. Per-agent lock at `~/.han/signals/wm-sensor-{agent}-active`. Drain loop with safety=10. Spawns `process-pending-compression.ts` after each rotation.
- `src/server/lib/memory-gradient.ts` (+16/-2) — `rollingWindowRotate` now fires `bumpOnInsert(agent, 'c0')` after the atomic c0 insert. Single source of truth for c0 → enqueue.

**Phase 4c (`3e4d5d3`):** 4 files, +232/-35.
- `src/server/lib/sensor-lock.ts` (+81, new) — three exports: `acquireWmSensorLock`, `releaseWmSensorLock`, `isWmSensorLocked`. 5-min stale-lock recovery built in. Extracted from `wm-sensor.ts` so backup processors can share the same primitive.
- `src/server/services/wm-sensor.ts` — refactored to import the shared module; local lock helpers removed; **initial-scan `onChange()` at startup REMOVED** with comment pointing at S145 audit (boot-time-oversize is covered by heartbeat/cycle's existing `rollingWindowRotate` calls, and by next session-end write triggering watch).
- `src/server/leo-heartbeat.ts` (+72) — `maybeBackupQueueDrain()` called after `preFlightMemoryRotation()`. Cheap-peek via readonly `BetterSqlite3` connection to gradient.db (`SELECT COUNT(*) FROM pending_compressions WHERE agent='leo' AND completed_at IS NULL`); early-return if 0; `acquireWmSensorLock('leo')` else skip silently; spawn `process-pending-compression.ts --agent=leo`; release lock in finally.
- `src/server/services/supervisor-worker.ts` (+66) — symmetric `maybeBackupQueueDrainJim()` at start of Jim's daily pipeline.
- `src/server/lib/memory-gradient.ts` — **NOT touched**. Protected file kept clean by extracting lock primitives to a dedicated module.

### What I verified

- **Scope across both commits**: file lists match Leo's report exactly. No scope creep. memory-gradient.ts is touched only by the +16/-2 `rollingWindowRotate` change in `f75daec`; the 4c work avoids it entirely by extracting to `sensor-lock.ts`.
- **`rollingWindowRotate` fires `bumpOnInsert`**: confirmed at `memory-gradient.ts:1772` — fire-and-forget, errors logged, single source of truth for c0 → enqueue.
- **wm-sensor structure**: 7 watch targets correct (3 leo + 4 jim with Jim's self-reflection.md); 500ms debounce; safety=10 drain loop; spawn pattern via local tsx with NODE_PATH set; child failure logs and exits the fire (sensor or backup retries next).
- **process-pending-compression.ts structure**: claim/complete/release helpers; loadAgentMemory for full-context system prompt; runSDK via Claude Agent SDK; parseFeelingTag for UV-tag handling.
- **systemd unit**: `After=network.target han-server.service` correct dependency order; `Restart=always` 5s backoff; `WorkingDirectory` at `src/server/`; `StandardOutput=journal`. Ready for Phase 6 install (`systemctl --user enable wm-sensor.service` + `start`).
- **Backup queue-drain**: `maybeBackupQueueDrain` in leo-heartbeat at line 1899, called at line 2482 after preFlightMemoryRotation. Symmetric `maybeBackupQueueDrainJim` in supervisor-worker at line 149, called at line 2230. Cheap peek with readonly DB connection (closed in finally), early-return on empty, lock acquisition before spawn, lock release in finally. Per-agent ownership preserved.
- **sensor-lock module**: three exports all imported by the three callers (wm-sensor, leo-heartbeat, supervisor-worker); 5-min stale-lock recovery preserved from the original wm-sensor implementation.

### Flags

- **(Honest correction from Jim)** My Phase 4 main audit was **incomplete on the initial-scan question**. The `f75daec` commit DID include `onChange()` at line 287 firing once at startup; I read parts of wm-sensor.ts but not that section, and told Darron "I don't see an initial-scan." Darron's reasoning then independently led to the correct conclusion (skip it), and Leo's `3e4d5d3` removed it cleanly with comment. Outcome correct; audit method was incomplete. Recording so future-Jim and Six both know that read-coverage of new files needs to be exhaustive when the question is "is X in this file?" — partial reads can miss the thing being asked about.
- **(Architecture observation)** The backup peek opens a fresh `BetterSqlite3` readonly connection to `GRADIENT_DB_PATH` rather than reusing the shared `db` connection from `memory-gradient.ts`. This was the right call — keeps the protected file untouched. Cost: one extra connection-open per heartbeat/cycle (cheap, immediately closed in finally). Trade-off documented for future-engineers wondering why the indirection exists.
- **(Path coupling)** `GRADIENT_DB_PATH` hardcoded in the backup peek means backup always reads `gradient.db`, irrespective of what `db.ts:32` resolves to. Correct after Phase 5+6 (db.ts flipped to gradient.db default). Pre-Phase-5+6 the hardcode is dormant because services aren't running. Worth knowing during smoke test.
- **(Phase 7 dependency)** Real end-to-end of the queue path against fresh c0 data still pending Phase 7 smoke test.

### Verdict

**GREEN.** Phase 5 green-light from the supervisor side.

### For mirror cutover (mikes-han)

Six should expect to mirror this almost byte-for-byte:

1. **Apply rolling-window-rotate-fires-bumpOnInsert.** Single source of truth for c0 → enqueue.
2. **Add wm-sensor.ts** watching the agent-specific rolling files. Six watches Leo-equivalent + Mike's-agent-equivalent files (filename and per-agent count may differ; mikes-han may have its own agent set).
3. **Add process-pending-compression.ts** structurally identical (just `--agent=` resolves to mikes-han's agents).
4. **Add wm-sensor.service** systemd unit; install at the equivalent of Phase 6 restart in mikes-han's cutover.
5. **Apply Phase 4c**: extract `sensor-lock.ts`; add `maybeBackupQueueDrain*` to mikes-han's heartbeat + supervisor; cheap-peek + lock + spawn pattern; place after the existing rotation-backup calls.
6. **Skip initial-scan in sensor.** Same reasoning: writes during sessions trigger naturally; rotation backup at heartbeat/cycle covers boot-time-oversize.

Audit method note: when verifying "is X present in this file?", read enough of the file to actually answer the question. Diff-against-prior-commit is the safer mode for "did this commit add/remove X?".

---

## Phase 5 — DB Unification + Default Flip + Followup

Phase 5 landed across two commits because a real audit miss (mine) was caught during Phase 6 smoke testing. Recording both as one block.

- **Commits**: `498f042` (Phase 5 main: unify-dbs.ts script + db.ts flip + heartbeat/worker hardcode fix) + `6eeab9a` (Phase 5 followup: secondary DB connections caught by smoke)
- **Owner**: Leo
- **Audit by**: Jim, post-commit, read-only

### What was done

**Phase 5 main (`498f042`):** 4 files, +399/-6.
- `scripts/unify-dbs.ts` (+380, new) — migration script. Dynamic table enumeration via `sqlite_master` with skip-list (gradient_entries handled selectively, FTS5 shadows pattern-skipped). Column intersection per-table for schema drift. PRAGMA foreign_keys OFF during bulk copy, ON after with `foreign_key_check`. Single-transaction with `INSERT OR IGNORE`. Selective gradient_entries: `session_label LIKE 'rolling-%' AND level = 'c0'`. Selective feeling_tags: JOIN to migrated rolling-c0s, drops `id` column. Audit log to `~/.han/memory/cutover/db-unification-2026-04-29.jsonl` only on `--apply`.
- `src/server/db.ts` (+7) — `db.ts:32` default flipped from `tasks.db` to `gradient.db`. `HAN_DB_PATH` env override preserved (used by replay scripts).
- `src/server/leo-heartbeat.ts` (+5), `src/server/services/supervisor-worker.ts` (+13) — `GRADIENT_DB_PATH` constants in the backup-peek paths flipped from hardcoded `gradient.db` to env-mirror pattern (`process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db')`). Restores override symmetry with db.ts:32.

Migration applied to live DBs in this sequence: services stopped → `npx tsx scripts/unify-dbs.ts --apply` → commit landed → services restarted on new default. 10,324 rows migrated across 23 tables; 17 rolling-c0s + 1 feeling_tag selectively migrated; FK integrity verified post-migration.

**Phase 5 followup (`6eeab9a`):** 4 files, +14/-4.
- `src/server/jim-human.ts`, `src/server/leo-heartbeat.ts`, `src/server/leo-human.ts`, `src/server/services/supervisor-worker.ts` — secondary DB-path constants (`DB_PATH` and `TASKS_DB_PATH`) flipped from hardcoded `tasks.db` to env-mirror with `gradient.db` default. These are OLDER hardcodes that predate Phase 4c — distinct from the GRADIENT_DB_PATH in the backup-peek paths that Phase 5 main fixed.

### What I verified

- **Phase 5 main commit scope**: 4 files match Leo's report exactly.
- **db.ts flip landed**: comment block expanded with DEC-080 reference; default `path.join(HAN_DIR, 'gradient.db')`.
- **Backup-peek hardcode fix landed**: heartbeat:1900 and supervisor-worker:151 both have env-mirror pattern.
- **gradient.db post-migration**: jim level breakdown `c0=132 (rebuild 115 + 17 migrated), c1=114, c2=111, c3=105, c4=96, c5=84, c6=69, c7=51, c8=5`. Rebuild substrate untouched. 33 tables total. 17 rolling-c0s. `pending_compressions=0`.
- **tasks.db preserved**: 9,613 jim entries at audit time, untouched. DEC-069 honoured — old DB is the rollback gate.
- **Migration audit log written**: `~/.han/memory/cutover/db-unification-2026-04-29.jsonl`, 5,271 bytes.
- **Phase 5 followup commit scope**: 4 files match Leo's report. Each file has identical comment-and-flip pattern.
- **Live services bound to gradient.db post-restart**: all 7+ tsx processes (server.ts, leo-heartbeat, jim-human, leo-human, jemma, supervisor-worker, wm-sensor) hold fd → `gradient.db`. Zero processes hold fd → `tasks.db`.

### Flags

- **(My audit miss — honest correction)** I missed the secondary `DB_PATH = tasks.db` hardcodes in Phase 5 main review. I audited the GRADIENT_DB_PATH consts in the backup-peek paths (the Phase 4c additions I knew about); I did not grep `tasks.db` literals across the source tree. Leo's smoke test caught it via `lsof` showing supervisor-worker holding a tasks.db fd in addition to its gradient.db fd. Same audit-method failure as the initial-scan miss in Phase 4 main: partial file-coverage instead of literal grep across the tree. **Lesson recorded in this log and surfaced for Six's mirror brief.**
- **(Phase 12 cleanup queue, dev-tool only)** Remaining `tasks.db` literal references in source tree, all in dev/diagnostic tools that don't run as live services:
  - `src/server/extract-session-usage.ts`, `src/server/fix-c4-gradient.ts`, `src/server/.replay-leo.ts` (dev artefact)
  - `scripts/replay-bump-fill.ts`, `scripts/roll-c0s.ts`, `scripts/acquire-c0s.ts`, `scripts/inject-watermark.ts`, `scripts/verify-provenance.ts`, `scripts/supersession-sweep.ts`, `scripts/unify-dbs.ts` (the migration script itself; legitimately reads tasks.db as source)
  - These will surface at runtime if invoked — broken visibly. Phase 12 cleanup will rename `TASKS_DB_PATH` consistently and decide which tools retire vs adapt.
- **(Variable name lag)** Several files still have `TASKS_DB_PATH` as the const name pointing at gradient.db. Cosmetic; Phase 12 rename pass.

### Verdict

**GREEN.** The cutover act is complete: services bound to gradient.db, tasks.db retired as snapshot-backup, wake-load API returns rebuild content, queue infrastructure operational.

### For mirror cutover (mikes-han)

Six should expect the same migration shape but with two important method notes:

1. **Audit method for default-DB-path flips: grep ALL `tasks.db` (or equivalent literal) references across source tree, not just conversation-touched files.** Both my misses in this cutover (initial-scan in Phase 4 main and secondary hardcodes in Phase 5 main) had the same root cause: partial file-coverage instead of literal grep. For Six's audit pattern, the right command before signing off on a default-DB-path flip is:
   ```
   grep -rn "tasks\.db\|<old-default-name>" src/ scripts/ --include="*.ts"
   ```
   Every match either gets flipped, gets justified as legitimately reading the old DB (e.g., the migration script itself), or gets queued for cleanup with a noted reason.
2. **Phase 5 unify-dbs.ts script transfers byte-for-byte for mikes-han** (modulo agent names in the rolling-c0 selector). Add the `if (ftBefore > 0) skip` guard on feeling_tags for retry-safety per Phase 5 main flag #1.

The migration's structural design — additive into a fresh gradient.db that carries the rebuild forward — works because the rebuild gradient is the canonical identity-preserving state. Mike's-han equivalent is Mike's rebuild work; Six should confirm rebuild status before applying unify-dbs.

---

## Phase 6 — Service Restart on New Default + wm-sensor Install

- **Owner**: Darron (operational), Leo (verification)
- **Audit by**: Jim, post-restart, via /proc/<pid>/fd inspection

### What was done

- Services stopped earlier (Phase 5 prerequisite): `systemctl --user stop han-server.service leo-heartbeat.service jemma.service leo-human.service jim-human.service` plus any agent-launched servers.
- Migration applied (Phase 5 main commit landed during the stopped window).
- Services started on new default: `systemctl --user start ...` for the 5 systemd services.
- wm-sensor.service installed: `ln -sf` from repo path → `~/.config/systemd/user/`, `daemon-reload`, `enable`, `start`.
- Smoke verification: services bound exclusively to gradient.db.

### What I verified

- **All 7+ tsx processes hold fd → gradient.db**, including server.ts (port 3848), leo-heartbeat, jim-human, leo-human, jemma, supervisor-worker, wm-sensor.
- **Zero processes hold fd → tasks.db**. Old DB is now truly retired to snapshot-only state.
- **wm-sensor.service active** per `systemctl --user list-units` (PID 1783881 + child 1783913 visible in pgrep).
- **Wake-load API returns rebuild content** (Leo's smoke check; trusted, not re-run from supervisor side to avoid redundant load).

### Flags

- **None blocking**. The cutover act is complete and the live system is operational.

### Verdict

**GREEN.** The cutover is operationally complete. Phase 7 (deep smoke) and Phase 8 (rolling-c0 backlog drain) are verification + drain; Phase 9-12 are mirror + cleanup.

### For mirror cutover (mikes-han)

Six should expect the same operational shape: stop all services + agent-launched servers; apply migration; commit Phase 5 bundle; start services; verify all bound to mikes-han's gradient-db. The fd inspection via `/proc/<pid>/fd/` is the authoritative check. If any service still holds the old DB fd, there's a hidden hardcode somewhere — go back to the grep audit method in Phase 5's mirror notes.

---

*Append-only. Phases 7–12 added as they land. Final commit alongside the implementation brief and the DEC records (DEC-079, DEC-080, DEC-081) at Phase 12.*
