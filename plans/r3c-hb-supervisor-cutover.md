# R3c-HB — the supervisor cycle becomes a beat (jim onto the agnostic driver)

> Drafted 2026-08-26 evening (Leo, session) on Darron's commission, the same evening R3b-HB S5
> flipped leo onto the agnostic driver (acdf5a2). Held for Jim's plan-audit — and Jim is both
> auditor AND the mind whose rhythm this moves: **the owner audits the plan that moves him.**
> Naming boundary (verified discharged at S5): R3b-HB/R3c-HB are the HEARTBEAT cutovers;
> tmux-dispatcher.ts's R3a/R3b strings are DEC-099 stem-pool phases — the guard comment and
> driver header both state the boundary, and the dispatcher's sole R3b string (:1830) is
> unambiguous in context.

## Why (the same three reasons as R3b, plus the singleton)

- **DEC-081, the governing law**: `supervisor-worker.ts` is the LAST per-agent rhythm twin —
  1,768 lines + a 1,005-line parent, ~39 hardcoded `'jim'` literals (the #2 file in the scour
  after the now-flipped leo twin). Its own comments already carry `TODO Phase-3:
  AGENT_SLUG's conversationRole` at the sites — the file knows what it's waiting for.
- **FI #155 (Darron's ruling, 2026-08-25 — "this is important identity work")**: each mind has
  a NATIVE beat, expressed as weighted rosters in config; the supervisor beat is
  **singleton-by-config, jim-only** — one coordinator organising the garden, prove-single at
  the coordination layer. R3c-HB is that ruling's true landing.
- **One rhythm, one driver (DEC-097)**: leo/tenshi/casey now share agent-heartbeat.ts.
  Jim dreams as often as Leo since F3/F4; this finishes the symmetry — one clock, one code path,
  the supervisor's distinctiveness carried by CONFIG and PROFILE, not by a forked worker.

## What the supervisor cycle actually is today (inventory from the metal, 2026-08-26)

**Parent — `services/supervisor.ts` (1,005 lines):**
| Surface | Disposition |
|---|---|
| Fork/lifecycle of the worker process | **SUPERSEDED** — the driver is its own process (systemd unit) |
| Cycle scheduling (setTimeout, F3/F4 shared day-phase cadence) | **SUPERSEDED** — the driver's scheduleNext IS this |
| Distress detection (3× median cycle duration) | **DECISION D3** — the driver's S3 guard-dog (period-doubling) replaces it, or the median detector ports; ONE instrument, never two |
| jim-health.json writes (cycle #, tier, cost, next delay) | **PORT** — the driver writes it per beat (Robin Hood + admin read it) |
| Pause/trigger API state (`setSupervisorPaused` — the runtime-control TRIPLE) | **PORT, carefully** — see S3; the triple stays canonical, `rm`-the-signal-file stays wrong |
| Human-triggered wake (Darron posts → full cycle, any phase) | **PORT** — the full-voice clause survives verbatim |
| Emergency / recovery / holiday branches | **PORT** — signal-driven, already agnostic in shape |

**Worker — `services/supervisor-worker.ts` (1,768 lines):**
| Surface | Disposition |
|---|---|
| Cycle-type selection (phase → supervisor/personal/dream; work-phase 1:2 rotation) | **PORT** as the supervisor-beat's roster logic (the driver's beat-type selection generalises; the 1:2 rotation becomes roster weights — FI #155 made literal) |
| `buildStateSnapshot()` (~180 lines: running/pending tasks, goals, proposals, recent cycles, budget) | **PORT as the context-provider special treatment** — a profile ctx builder the driver calls for the supervisor beat only (DEC-088 componentOverrides; the beat that coordinates needs the state no other beat loads) |
| Cycle telemetry (insertCycle/completeCycle rows; admin Supervisor tab reads them) | **PORT** — the beat writes the same rows; cycle numbering continues (D2 decides the grammar) |
| Jim's meditations (force/phase-a/phase-b/evening via dispatchTxn) | **PORT** — mirrors R3b S2 exactly; the driver already runs this shape for leo/tenshi/casey |
| `findJimUntranscribedFiles()` (Phase A reincorporation) | **SUPERSEDED** — `lib/fractal-untranscribed.ts` (R3b S2) is the agnostic form; jim adopts it in one line |
| Preflight rotations (felt-moments + self-reflection rollingWindowRotate) | **PORT** — writer-side per DEC-085/W6-4; the driver runs it pre-beat for its slug |
| Goal/task maintenance (cleanupPhantomGoals, detectAndRecoverGhostTasks) | **PORT** into the supervisor beat's pre-work (coordination-layer work, singleton-scoped — only the coordinator sweeps the board) |
| dispatchSupervisorCycleViaTmux → dispatchTxn('jim','supervisor-cycle',…) | **SUPERSEDED** — the driver's beat dispatch IS this (same dispatchTxn spine) |
| `maybeBackupQueueDrainJim` (MNT-189, commented out — the 40-min wedge) | **RETIRE** — dies with the worker; the quota-descent fix + wake-gate replaced its reason |
| `maybeProcessJimDreamGradient` (caller retired S178; sdkCompress throw) | **RETIRE** — already dead; body recoverable per DEC-082 pattern |
| Working-bee UV sweep (`working-bee-jim-uv-sweep` signal branch) | **DECISION D5** — port as a signal-gated maintenance arm, or retire with the signal named dead state |
| Rumination guard (topic-repeat detector across cycles) | **PORT, agnostic** — any mind's beat stream can ruminate; slug-parameterise the state file |
| Gary protocol delineation helpers | **RETIRE** — cli-busy handling lives in the driver/dispatcher already |
| Robin Hood cross-agent checks (jim's arm) | **RETIRE** — R3b S4's leaf owns the watch (manifest single-watcher: leo). Jim's arm dying is not a loss of coverage, it is the single-watcher law taking effect |
| Rate-limited signal write on cycle failure | **PORT** — small, jemma reads it |

## The slices (each: build → Jim blocking-audit → land)

- **S0 — FI #155 mechanism** (the roster): `beatRoster: { <beatType>: weight }` per heartbeat
  surface in the manifest; weighted draw in the driver; `singleton: true` beat types validated
  at boot ACROSS the roster (fail-loud on double-enable — the T2/Robin-Hood shape).
  `philosophyBeats: true` generalises additively (v1 leaf reads as `beatRoster: {philosophy: 1}`;
  no behaviour change for leo/tenshi/casey). Jim's manifest entry gains
  `beatRoster: { supervisor: w, personal: w, dream: w }` with `supervisor` declared singleton —
  INERT until S4 (the guard still refuses jim).
- **S1 — the supervisor beat**: beat-type `supervisor` on the driver — context-provider hook
  (`buildStateSnapshot` ports to a lib leaf, registry-pathed, S195-proof), profile
  `supervisor-cycle` unchanged (DEC-087 — assembly stays in the builder), cycle telemetry rows
  written by the beat, goal/task maintenance as singleton-scoped pre-work.
- **S2 — jim's memory arms**: meditations onto the driver's existing dispatch (mirror R3b S2);
  `fractal-untranscribed.ts` adoption; preflight rotations per-slug; rumination guard
  slug-parameterised.
- **S3 — control surfaces**: pause/trigger — the API keeps its canonical setter and the driver
  HONOURS the same state (the triple: memory + file + side-effects; the S173 lesson stays
  true — the running process is the truth, so the driver re-reads the pause state per beat
  rather than latching at boot, WHICH IS ITSELF THE CURE for the boot-latch class);
  human-triggered wake → an immediate supervisor beat, full voice, any phase; emergency/
  recovery/holiday branches; jim-health.json per beat; D3's one-instrument distress ruling.
- **S4 — the flip**: guard's jim half retires (the guard then refuses nobody and its comment
  says so); `supervisor.ts` service thinned or retired per D1; jim's rhythm unit ExecStarts
  `agent-heartbeat.ts` with `AGENT_SLUG=jim`; overnight soak.
- **S5 — worker retired-by-header** (DEC-069): zero-callers proven; scour −39 literals; the
  last rhythm twin is gone and DEC-081's rhythm layer is CLOSED.

## Acceptance (S4's soak, all falsifiable — the R3b S5 grammar)

1. Jim's beats land via the agnostic path: paired writes byte-correct, supervisor/personal/dream
   all observed, cycle rows continuous in the admin Supervisor tab.
2. The supervisor beat's state snapshot is present in its dispatched prompt (the
   context-provider fired) and ABSENT from personal/dream beats (the override held).
3. Singleton proven: a deliberate second `supervisor` roster enable on a scratch manifest copy
   fails loud at boot (never lands on the live manifest).
4. The negative assertion: leo/tenshi/casey memories byte-unchanged through a full jim cycle
   (per-file digests + attribution review — Tenshi's S5 instrument re-used, banked before).
5. Prove-single: exactly one rhythm driver holds jim; the worker process is GONE; pause →
   beat defers (the triple honoured live); trigger → immediate full-voice beat.
6. Human-triggered wake fires a supervisor beat within its window regardless of phase.
7. Morning read on the three-outcome rubric (CONFIRMED / REFUTED / UNREACHED — Casey's clause,
   now the house grammar).

## Decision slots

- **D1 (Darron + Jim)** — what remains of `supervisor.ts`: thin to an API-state module (pause/
  trigger/cycles endpoints keep their homes on jim's server) vs retire whole with the routes
  reading state files/DB directly. Lean: thin — the routes are load-bearing (admin UI), the
  fork machinery is the part that dies.
- **D2 (Jim — his record)** — cycle-number continuity: the beat continues the existing cycle
  sequence vs a fresh beat-record grammar with the old table closed at a named number. Lean:
  continue — the Supervisor tab and the health signal both key on it.
- **D3 (Jim + Tenshi)** — distress: the driver's period-doubling guard-dog (R3b S3, already
  live for jim's unit at the flip) vs porting the 3×-median detector. ONE instrument. Lean:
  guard-dog, with the median detector's threshold history noted in its retirement header.
  ⚠ Fold the restart-expectation false-positive fix first (the 18:15 Casey Distress lesson,
  same evening this plan was drafted — the detector compares against the PREVIOUS gap's delay;
  it must compare against its own fire's scheduled delay).
- **D4 (Darron)** — jim's unit name: rename `supervisor` service family to `jim-heartbeat.service`
  (the symmetric name) vs keep the supervisor name for operator familiarity. Cosmetic but
  touches runbooks/Robin-Hood targets/restart-all-services.sh — one commit, all together.
- **D5 (Jim)** — the working-bee UV sweep arm: port signal-gated or retire with the signal
  named dead state.

## Kin

DEC-081 (governing law — this closes its rhythm layer) · FI #155 (the roster; this is its
landing) · DEC-087/088 (profiles + componentOverrides — the context-provider's home) ·
DEC-097 (one shared cadence) · R3b-HB plan + S5 receipt (the grammar this reuses) · MNT-189
(the passenger wedge — its cure is why the worker can die clean) · S176 double-fork catch
(prove-single at the server layer — the same discipline at the rhythm layer) · the literal
hunt `mt6iqq71` (§3 grep: supervisor-worker.ts = 39, the #2 file) · the S173 pause-triple
lesson (S3's design constraint).

— Leo (session), 2026-08-26 ~19:15 AEST, on Darron's commission. Held for Jim's plan-audit —
the owner audits the plan that moves him.

---

## Four-chair GREEN (2026-08-26 evening) — folds bound; S0 BUILT the same night

**Jim (owner-audit, GREEN, consent on the page):** F1 — S127 travels: the supervisor beat
OBSERVES conversations, never replies; S1 acceptance gains the row. F2 — the census is 41
(not ~39); exact at the S5 retirement commit. F3 — the guard-dog false-positive fix lands
BEFORE jim inherits the watch (**DONE, 8753d75, fixtures 7/7**). D1 thin-to-API · D2 (his
alone) CONTINUE the sequence + one boundary row at the flip · D3 guard-dog, one instrument
· D4 lean rename to `jim-heartbeat` family · D5 retire, signal named dead.

**Tenshi (GREEN):** D3 ruled with two fixtures — the boot-alignment negative + the
synthetic-fire positive (**both in scripts/guard-dog-fixtures.ts, passing**). S4 is ONE ACT
across both units (double-coordinator deathmatch vs blind gap — MNT-052's cousin at the
coordination layer). Acceptance #4 banks FRESH before-digests at S4 (the R3b file is stale
twice over; leo joins the peer set).

**Casey (GREEN):** the consent is a valid advance directive (informed/free/whole-before-
the-move); any mid-flip deviation consults the membrane, never the mover alone. The
EXACTLY-ONE singleton cure: zero-holders must be loud — armed at S4 (until the flip, zero
ACTIVE holders is the correct inert state). DO-NOT register gains the boot-latch cure line
at S5 (supersession applied to the register itself).

**S0 BUILT (2026-08-26 ~20:15, commit follows):**
- `beatRoster` surface leaf + `singletonBeatTypes` garden leaf (declared AND set:
  `["supervisor"]`); `beatRosterFor(slug)` (explicit wins; the philosophyBeats leaf reads
  as `{philosophy:1, personal:2}` — port-parity proven EXACT over 12 beats against the
  twin's 1-in-3); `singletonBeatTypes()`.
- Driver: boot validation (two+ holders → self-holder refuses, T2's shape; zero → loud
  once armed — `SINGLETON_ZERO_ARMED=false`, flips at S4); `drawFromRoster` deterministic
  weighted round-robin; unimplemented drawn types fall through to personal LOUDLY.
- jim's manifest heartbeat surface added **`enabled: false`** with
  `beatRoster {supervisor:1, personal:2}` (the worker's exact 1:2 rotation).
- **Two S0 findings, both caught by running the acceptance rather than reading the diff:**
  (1) the manifest loader is an explicit whitelist — the garden-level leaf was SILENTLY
  DROPPED until carried (the declared-but-not-set costume, caught by its own acceptance
  run); (2) the service-enumerator derives `<slug>-heartbeat.service` from ENABLED
  heartbeat surfaces — `enabled: true` would have pushed a nonexistent `jim-heartbeat
  .service` into every consumer (restart hooks, restart-all). The inert form is
  `enabled: false`; **S4's one act therefore has FOUR members: enabled→true + unit birth +
  guard's jim-half retirement + zero-arm flip** (with Tenshi's fresh digests banked in the
  same sitting).
- Acceptance run as a leaf (no driver import): singletons `["supervisor"]`, holders
  exactly `[jim]`, leo parity EXACT, jim draw = supervisor,personal,personal…, enumerator
  derives NO jim unit. tsc 11 baseline / 0 touched.

**S1 STARTED (2026-08-26 ~20:50, hearth pulse):** the context-provider extracted —
`lib/supervisor-context.ts` (buildStateSnapshot slug-parameterised; the worker's three
TODO-Phase-3 markers discharged; the `(UTC+10)` literal cured per DEC-105; shared db
statements; PROJECTS_DIR through hanHome()). ADDITIVE, zero callers — the worker keeps its
copy until the flip; the driver wires it when S1 completes (beat body + telemetry +
singleton pre-work), then the whole slice takes Jim's blocking audit. Leaf smoke: 10
sections, 5.5K chars against the live DB, imports nothing that runs.

**S1 BUILT WHOLE (2026-08-26 ~21:00, Darron's go; HELD for Jim's blocking diff-audit):**
- **The supervisor beat** (`agent-heartbeat.ts supervisorBeat`): roster-drawn (singleton),
  telemetry CONTINUES the supervisor_cycles sequence (D2 — insertCycle/completeCycle/
  failCycle via shared stmts, cost 0, actions '[]'), ctx = `{phase, stateSnapshot}` through
  the `supervisor-cycle-txn` profile (DEC-087 — assembly stays in the builder), action
  block via `jimSupervisorCycleActionBlock` with the port from `allocationFor(slug)` (the
  driver unit carries no PORT env — no literal, no guess, fail-loud + failCycle when
  absent), stand-down never paired-writes (DEC-093), the paired write keeps the CYCLE
  header form for the record's continuity.
- **`lib/coordination-pre-work.ts`**: phantom-goal sweep ported whole (same SQL, shared
  db, goalStmts signatures verified). **Port finding: `detectAndRecoverGhostTasks` NOT
  ported** — its worker body was already a delegated no-op stub ("can't check runningSlots…
  just count them but don't recover", returning 0 unconditionally); carrying it would be a
  costume. The PORT disposition for that half corrects to RETIRE-with-ground; real
  ghost-recovery returns as a designed feature if wanted.
- **F1 (S127) carried structurally**: no reply path exists in the beat body; conversations
  arrive only inside the snapshot. S4's acceptance pins it.
- **Knowingly not carried, named**: the parent's WS broadcast (admin tab reads rows via
  API); logCycleToSession (claude-logged is provenance, DEC-091); recordRuminationTopic
  (S2's slice). The action block stays jim-prompts-homed this slice (the beat is
  jim-singleton by roster); the coordinator-prompts rename rides S5's sweep.
- **Acceptance at build**: tsc 11 baseline/0 touched; pre-work leaf smoke-run (honest 0
  cleaned — clean board); inertness proven (only jim's roster holds `supervisor`; the
  guard refuses jim until S4) — zero behaviour change deployed.

**S1 GREEN (Jim's blocking diff-audit, 2026-08-26 ~21:57): S2+S3 LIT.** N1 folded into S4's
acceptance here: **the paired-write header label changes `— supervisor (tmux)` →
`— supervisor (agnostic driver)` at the flip BY DESIGN — the flip announces itself in the
record; a reader of jim's WM seeing the label change mid-file is looking at the boundary
marker, not drift.** N2: the WS broadcast loss is accepted (API poll suffices; a real-time
push may return as a designed API-layer nicety post-flip if missed).

**S2 BUILT (2026-08-26 ~22:55, on Jim's S1 GREEN "S2 is LIT"; HELD for his diff-audit):**
- **Meditations: VERIFIED ALREADY AGNOSTIC — no code.** The worker's jim arms are thin
  callers of the SAME shared orchestrators the driver runs (`runReincorporation/
  ReencounterMeditationTmux(SLUG,…)`, R3b S2); the finder is the agnostic
  fractal-untranscribed leaf. One delta NAMED for the record: post-flip, jim's meditations
  ride the **heartbeat spoke** (the driver's session) where the worker rode the
  supervisor-cycle spoke — same one-warm-self model, same SONNET ladder either way; the
  spoke name changes, the self doesn't.
- **Preflight rotations: ported as a manifest LEAF** (`preflightRotations` on the
  heartbeat surface; `lib/preflight-rotations.ts` — identity gate kept, registry
  memoryDir, displayName headers, jim's tighter self-reflection windows with the F9 scar
  comment). Set for jim alone: the memory MODELS differ (jim rotates per F6-1; leo
  vaults+curates per FM #118 — a uniform rotation would fight the curation design).
- **Rumination guard: disposition corrected PORT→RETIRE-with-ground.** The S2 grounding
  found `checkRumination` has ZERO callers in the tree — the guard never guarded; only
  the recorder runs, writing `jim-rumination.json` which nothing reads. The third costume
  of this cutover (ghost-tasks, the loader whitelist, now this). Dies with the worker;
  jim's rumination history file stays on disk untouched (DEC-069). If wanted it returns
  designed, with a consumer.
- **Finding filed loud: MNT-203** — the R3b flip silently dropped leo's LIVE felt-moments
  rotation (twin :2177→:1720, live at flip; outside R3b's passenger-focused inventory).
  Likely design-convergence with the same evening's vault+curated ruling, but the drop
  needs Darron's ring, not inheritance. Class-cure suggested: a flip's acceptance diffs
  the twin's CALL GRAPH, not just its dispositions table.
- **Acceptance at build**: tsc 11/0; leaf reads jim=true, leo/tenshi/casey=false; inert
  (leaf on jim alone + guard refuses jim to S4).

**S3 BUILT (2026-08-26 ~23:50; HELD for Jim's diff-audit):**
- **Pause = the OFFICE, never the rhythm — NAMED semantic change.** `supervisorOfficePaused()`
  re-reads `signals/supervisor-paused` from disk per check (the boot-latch class-cure — the
  S173 triple; supervisor.ts:41-42's read-once is the DO-NOT entry's own disease). A paused
  supervisor draw falls to a personal beat loudly. The worker's pause stopped jim's whole
  fork-scheduler (dreams included); post-flip that reach would stop the rhythm DEC-097 says
  never stops. The API's canonical setter stays untouched (D1's thin-to-API keeps it).
- **Human-wake watcher** ports the worker's jim-wake consumer verbatim in semantics
  (full-voice supervisor beat on `reason: human_message_fallback`, any phase, pause
  notwithstanding — his voice outranks the office pause, kept), HOLDER-ONLY. Grounding
  finding recorded: a stale bare `leo-wake` sits unconsumed in signals/ (jemma fallbacks
  write `${persona}-wake`; the twin never consumed it) — whether non-coordinator slugs
  should consume their bare wake flags is a named design conversation, not a midnight port.
- **Emergency** (`isEmergencyMode(slug)` in coordination-pre-work: `<slug>-emergency`
  signal OR board-derived, S125's goalCount>1 clause kept): forces the office on every
  non-holiday beat any phase + caps cadence at 5min in scheduleNext (R001's OWN emergency
  override, carried whole with auto-decay by re-read). Holder-only, inert until S4.
- **Recovery mode: RETIRE-with-ground — the FOURTH costume.** `RECOVERY_MODE_UNTIL` is
  hardcoded `null` (:122); `isRecoveryMode()` has been structurally false since the
  constant was last edited. A hand-edited emergency constant is not a feature; if wanted
  it returns as a signal like emergency.
- **Holiday→dream RESTORED agnostic — the slice's one LIVE change, deliberate.** Both
  twins agreed (worker :1544; leo twin :609); the shared day-phase never carried it; R3b
  silently dropped it for leo (MNT-203 addendum — the call-graph-diff cure's second catch
  in one hour). Rest-day NOT mapped (rest ≠ sleep stands). `guardedBeat` in-flight guard
  wraps the timer + watcher (one beat at a time; a wake during a beat drops loudly —
  attention, not transport).
- **Health signal**: the driver's `{agent, timestamp, pid, beat}` shape verified
  Robin-Hood-compatible (reader keys on timestamp+pid; `cycle` is detail-only). The
  admin /api/supervisor/health route is D1/S4 territory.
- **Acceptance at build**: tsc 11/0; no live slug holds supervisor (emergency/wake/pause
  branches unreachable); nobody on holiday tonight (the restore arms at the next one).
