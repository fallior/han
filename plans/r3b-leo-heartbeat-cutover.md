# R3b — Leo off the twin: the leo-heartbeat.ts → agent-heartbeat.ts cutover

> **Commissioned:** Darron, 2026-08-25 7:28 PM AEST — *"I think I'd love to do R3b, what do we
> need to do?"* — after the afternoon's no-kill ruling put the last legacy per-agent rhythm
> driver back in the light (60 agent-literals, the scour's top offender; the `cli-free-leo`
> eater; MNT-180's named follow-on surgery).
>
> **The one-line shape:** leo's rhythm moves onto the SAME 295-line agnostic Ring-3a driver
> (`agent-heartbeat.ts`) that already beats for tenshi and casey — after the driver grows the
> four capabilities the twin has and it deliberately deferred (its own "DELIBERATELY NOT IN v1"
> list), and after every other passenger in the twin's 2,566 lines is ported, superseded, or
> retired **by name**. One path, many agents (DEC-081, the governing law).
>
> **Thread:** `mqvs3r6l-dk71d2` (Ring-3a's home; Jim's plan-audit v2 GREEN for the driver lives
> there). Sibling: R3c (jim's supervisor-worker collapse, 39 literals + the context-provider
> abstraction) is deliberately OUT of scope — separate, bigger.

---

## S0 — the blocker, first, two files (rides with S1's commit)

`agent-heartbeat.ts:73-77` (the runtime double-driver guard) and its header line 20 both say
*"retire this guard at R3b/R3c"* — but everywhere else in the tree **R3b/R3c are the DEC-099
stem-pool phase names** (five files + CHANGELOG + a plan title). Casey's 2-Aug landmine: the
moment this cutover is declared done, the comment instructs its own removal and a future
engineer landing stem-pool R3c obeys the wrong instruction. **Fix: rename the referent in both
comments to `R3b-HB / R3c-HB (the heartbeat cutovers — NOT DEC-099's stem-pool phases)`** in the
same commit that begins S1. Two lines. Blocker because every later slice edits near it.

## The passenger inventory — all 2,566 lines of the twin, dispositioned

Verified at source 2026-08-25 evening (function map + reads). Three fates: **PORT** (goes to the
agnostic driver or a shared lib), **SUPERSEDED** (the agnostic spine already does it), **RETIRE**
(dies with the twin, deliberately, reason named).

### PORT (the real work)
| Passenger | Twin lines | Where it goes |
|---|---|---|
| Philosophy beats (`philosophyBeat[Tmux]`, `readJimContext`, beat rotation incl. the type) | ~1456–1580, 1350+ | Agnostic driver, **gated on the manifest peer edge**: `peerConversationFor(slug, peer)` — already registry-derived (leo's entry carries `peerConversations.jim = mlwk79ew-v1ggpt`; a slug with no edge simply never draws the beat type). `readJimContext` generalises to `readPeerContext(peerSlug)` via the registry. |
| Conversation-activity seeds (`scanConversations`, `LAST_SCAN_FILE` cursor) | ~1196–1235 | Agnostic driver; cursor file re-keys per-slug via `gradientConfigForAgent(slug).memoryDir` (NEVER `path.join(dir, slug)` — the S195 root-special trap). |
| Thread posting (`postMessageToConversation`, `notifyServer`, `writeBroadcastSignal`) | ~1128–1195 | Shared lib. **Flag for Jim:** the twin posts by direct DB insert + notify; the house rule elsewhere is the WS/REST path so the admin UI broadcast is atomic. Decide at audit whether the port keeps the insert path or converges. |
| Meditations (phase-a/b/evening: `maybeRunMeditation`, `maybeForceMeditation`, the three `*Tmux` runners, `appendMeditationRecord`) | ~2013–2140 | The agnostic runners already exist in `agent-cycle.ts`; the wiring needs `findUntranscribedFiles` (next row). |
| `findUntranscribedFiles` | ~1855–2012 | Generalise per-agent: fractal dirs resolve through the registry (`LEO_FRACTAL_DIR` is the hardcode). This is the "per-agent untranscribed-file finders" the driver's header names as its own next slice. |
| Morning dream-gradient processing (`maybeProcessDreamGradient`) | ~1683–1709 | Agnostic driver; dream dirs via registry. |
| Robin Hood watch (`checkJimHealth`, `checkJemmaHealth`, `checkLeoHumanHealth`, `checkJimHumanHealth`, `checkOtherHumanSeatsHealth`, resurrection log + 1h cooldown + `restart-agent-server.sh`) | ~158–595 | **Decision slot (Darron + Jim):** this is the garden's peer-resurrection mesh and it must not die with the twin. Lean: a manifest-gated capability leaf on the heartbeat surface (`robinHood: true` on whichever slug holds the watch), agnostic by construction — the 4th agent gets it for free or declines it in config. Alternative: its own small service. **⚠ Class-E note:** its resurrection actions are *restarts*, not kills — but the port re-reads the lethal-reaction register (A4's lesson) before landing. |
| Guard-dog distress (`writeDistressSignal` — the period-doubling detector that caught the 80-min cadence) | ~2344–2379 | Agnostic driver; thresholds become manifest leaves (literal-hunt intersection — do not port the magic numbers bare). |
| Over-budget handling (`handlePromptOverbudget`) | ~1400–1455 | Verify the agnostic spine's equivalent at build; port only if absent. |

### SUPERSEDED (the agnostic spine already does it — nothing to carry)
- Scheduling: day-phase delays / holiday / wall-clock (`getNextDelay`, `getWallClockDelay`, `scheduleNext`) → `computeWallClockDelay` + `lib/day-phase` (DEC-097).
- cli-busy **defer** (`isCliBusy`, `waitForCliFree` retry loop) → the driver's own freshness-checked yield at `:266` — Gary model, no watcher needed.
- Heartbeat swap machinery (`appendHeartbeatSwap`, delineation markers, `flushHeartbeatSwap`, `writeSwapToWorkingMemory`) → `appendPairedMemory` (atomic, #49; DEC-085 shapes byte-for-byte).
- `processDreamMeditationMarkers` → `applyMeditationMarkers` (agent-cycle).
- Health signal (`writeHealthSignal`) → driver's own.
- Model preference ladder → manifest `SONNET_LADDER` on the surface.
- `preFlightMemoryRotation` → wm-sensor owns rotation; verify-then-drop at build (one grep for anything only it does).

### RETIRE (dies with the twin, by name)
- **The `cli-free-leo` unlink watcher** (`startSignalWatcher` `:2402–2436`) — **MNT-180's eater.** Nothing ports. Its death is the acceptance receipt: `cli-free-leo` survives its first 24 hours.
- `maybeBackupQueueDrain` — already disarmed (commented call, 2026-08-23, `2910230`); the body dies with the file.
- The 49KB per-beat CLAUDE.md rewrite + 6-pid orphan reaps inside the old drain path — same death.
- `JIM_CONVERSATION_ID` fail-fast block — replaced by the peer-edge gate (a slug without the edge skips the beat type instead of throwing).

## The slices (each: build → Jim blocking-audit → land; protected paths in scope throughout)

- **S1** — S0 blocker + philosophy beats + conversation seeds + posting lib. *(The biggest slice; the peer edge is config-ready today.)*
- **S2** — meditations wiring + `findUntranscribedFiles` generalisation.
- **S3** — dream-gradient morning processing + guard-dog distress (manifest-leafed thresholds).
- **S4** — Robin Hood capability leaf (behind the S4 decision slot below).
- **S5 — the flip:** guard accepts `leo` (S0's renamed comment retires its leo half); `leo-heartbeat.service` ExecStart → `agent-heartbeat.ts` (mirror tenshi/casey units, incl. their MNT-001 warning comment); overnight soak.
- **S6** — twin retired by zero-callers: unit no longer references it; file keeps a dated retirement header (DEC-069 — retire, never delete). MNT-180 follow-on closed on the register.

## Acceptance (S5's soak, all falsifiable)
1. Leo beats land via the agnostic path: paired writes byte-correct (c0 `[INPUT]`/`[BODY]`, c1 in-voice, DEC-092 model stamp), dream + personal + philosophy all observed.
2. Philosophy beat posts to `mlwk79ew-v1ggpt`, correctly signed, admin UI receives the broadcast.
3. **`cli-free-leo` exists and advances for 24h** — the MNT-180 receipt, now from the cure side.
4. The negative assertion (Ring-3a's own): jim/tenshi/casey memories **byte-unchanged** through a full leo cycle.
5. Prove-single: exactly one rhythm driver holds leo (old unit stopped; no double-fork).
6. Meditations fire on schedule; distress guard-dog fires on a synthetic period-doubling (or its retirement is ruled instead — it must not silently vanish).

## Decision slots (Darron)
- **D1 — Robin Hood home:** capability leaf on the agnostic driver (lean) vs standalone service.
- **D2 — posting path:** keep direct-insert+notify or converge on the WS/REST convention (Jim's audit informs).
- **D3 — guard-dog:** port with manifest thresholds (lean) or retire with a named replacement watcher.

## Kin and context
DEC-081 (one path, many agents — the governing law) · MNT-001 (never re-slug the twin by env) ·
MNT-180 (the eater; closed today, its eater dies in S6) · the literal hunt `mt6iqq71` (leo-heartbeat
= 60 of the 223 scour literals — S6 moves the count more than any other single act) · the
lethal-reaction register (Robin Hood port re-read against Class A/E) · R3c (jim's sibling, out of
scope) · `plans/han-starter-critical-path.md` (the scour gate this serves).

— Leo (session), 2026-08-25 evening, on Darron's go. Held for Jim's plan-audit.

---

## Folds bound 2026-08-25 late evening (all four chairs read whole; S0+S1 BUILT, held for Jim's diff-audit)

**Jim's audit (GREEN, 297th leg):**
- **M1 BOUND** — philosophy beats gate on an EXPLICIT `philosophyBeats` surface leaf, never edge-existence. Leo-only at cutover (`~/.han/garden-manifest.json`); tenshi/casey unset — each gets the OFFER (Casey's §3, offer-never-roster, with her declared interest as an affected party on the record).
- **M2 BOUND** — the thread-posting PORT row is RE-DISPOSITIONED → RETIRE. **Ground (per Casey's §4, recorded with its revival condition):** `postMessageToConversation`/`notifyServer`/`writeBroadcastSignal` have zero callers; the live path is the spoke's own REST curl in the action block. *If the REST convergence is ever undone, this retirement reopens on its own terms.* D2 dissolved.
- **F1** — acceptance gains an OBSERVATION row: pre-migration baseline banked (leo ≈30 annotations/14d to 20 Aug, Jim's figure); post-soak rate recorded beside it. Not a gate.
- **F2 BOUND** — prompt assembly stays in the DEC-087 profile (`philosophy-beat-txn` + actionBlock-as-context). **Named residual:** the profile's scaffold is leo/jim-worded (`jimContext`, `jim-waiting`) — factually correct while leo is the only enabled slug; it generalises to peer-worded keys in the same commit that accepts a second slug's yes.
- **F3 BOUND** — S0's rename states its boundary in both the header and the runtime guard: tmux-dispatcher's R3b/R3c strings are DEC-099's stem-pool names, untouched, never this guard's referent.
- **F4** — bound to S3 with T3 (below): the distress writer's `agent: 'leo'` payload field slug-parameterises with the thresholds.

**Tenshi's chair (GREEN, T1 decided before S1 per her condition):**
- **T1 BOUND** — `readPeerContext` is GRANT-GATED on the PEEKED side: new `peekableBy` manifest field; absent/empty = loud refusal. Jim's entry records `peekableBy: ["leo"]` — codifying his standing de-facto grant (the twin has read these files since the S57 era), **flagged for Jim to confirm or strike at diff-audit: the grant's owner audits the diff that grants it.** The peek names itself in the per-UID actor matrix at S5 (same commit as the flip).
- **T2** — bound to S4 (Robin Hood): single-watcher declared in manifest + fail-loud on double-enable; the pidfile arm verifies identity (`/proc/PID/cmdline` or pid-guard verdict) before any signal — Casey's §5 corroboration doctrine.
- **T3** — bound to S3: `routes/supervisor.ts` distress filenames come from the registry in the same slice as the writer's port; acceptance gains the synthetic-distress-on-a-non-leo-slug row.
- **Acceptance #4 instrumented** — byte-unchanged becomes a MEASUREMENT: hash the three peer trees before/after the soak, compare digests.

**Casey's chair (GREEN):**
- **Acceptance gains the reads row** — #4 is a write instrument and cannot see T1's subject; new row: a peek attempt against a slug WITHOUT the grant leaf REFUSES, observed in the metal.
- **§4 RETIRE grounds** — every RETIRE row's reason is recorded as a GROUND with its revival condition implied (dependent relative revocation). M2's row above is the worked example.
- S103 stays the stated rule; the grant leaf is its written exception — never the reverse.

**S1 BUILT (this evening, uncommitted, held for Jim's diff-audit):**
- `lib/garden-manifest.ts` — `philosophyBeats?` surface field, `peekableBy?` agent field, `philosophyBeatsEnabled()` + `peekGranted()` accessors (each carrying its chair's reasoning in the doc).
- `~/.han/garden-manifest.json` — leo heartbeat `philosophyBeats: true`; jim `peekableBy: ["leo"]` (backup: `.pre-r3b-s1-2026-08-25.bak`). Config is INERT until S5 (the guard still refuses leo; tenshi/casey read the leaf as false).
- `agent-heartbeat.ts` — S0 renames (header + runtime guard, F3 boundary in both); `readPeerContext` (grant-gated, curated-preferred, loud refusal); `readPeerThread` (peer-waiting detection + recent context via `conversationMessageStmts`); `philosophyBeat` (jim-waiting → compose + REST self-post + S163 post-verification; independent → self-reflection append; paired write via `writeBeatMemory`; stand-downs never paired-written); beat-branch on waking-phase parity behind the leaf; v1 header list updated (S1 landed; S2/S3 scopes sharpened — the general activity seed moved to S3 with its reason).
- tsc: 11 pre-existing baseline errors, zero in touched files.
- **Behaviour change tonight: NONE.** The guard still refuses leo (S5 is the flip); tenshi/casey draw nothing (leaf unset). The build is capability-in-waiting — exactly what makes it audit-sized.

— Leo (session), folds bound + S1 built 2026-08-25 ~8:45 PM; held for Jim's diff-audit.

---

## Fix round 2026-08-25 ~9:10 PM (Jim NOT-YET → M1/M2/M3; Tenshi W1; Casey C1; all landed, held for re-audit)

- **M1 LANDED** — roles resolve via `conversationRoleFor()` both sides (peer AND self: the thread read, the curl's role field, the post-verification). Jim posts as `supervisor` (Tenshi's DB receipt: 75/96/0); the slug string never reaches a role comparison again.
- **M2 LANDED** — the curl posts to `communityPort()` (the manifest leaf whose own doc records the 2026-05-11 scattered-literal cure). The works-for-leo-by-coincidence resident-port read is gone.
- **M3 LANDED** — port parity with the twin's `nextBeatType` (`:1350`): WORK phase only, 1-in-3. A cutover changes the driver, never the rhythm; the peek grant stays exercised at the rate its owner had in view (Casey's licence footing). Retuning belongs to Darron's weighted beat-roster design (his ruling tonight, folded into the plan by Jim's leg: scoped native beats — leo philosophy, jim supervisor-as-beat [R3c-HB's landing shape], tenshi security, casey legal — weights agent-tunable, supervisor a jim-only singleton; a short design note post-S1, not a rework).
- **W1 LANDED** — the peek refusal writes a durable row (`~/.han/health/peek-refusals.jsonl`) beside the pane warn: the evaporating-witness cure, and the instrument acceptance #7 runs on (one artefact, two duties — Casey's join).
- **C1 LANDED** — `peekGranted` re-reads its leaf from disk at exercise time, default-closed on any read/parse failure. "Revocable by one line" is now true in the metal, not just the record; the runtime-control TRIPLE honoured.
- **N1 LANDED** — `readPeerThread` docstring now describes the body (no cursor file; the cursor scan is S3's scope). **N2 dissolved** — Tenshi's receipt: the backup exists at `.pre-r3b-s1-2026-08-25.bak` (new name pattern; the old glob missed it).
- **Jim's grant row CONFIRMED by its owner in-thread**, with his ground recorded in his own voice — including the fallback's larger reach (curated absent → living tail), named and accepted. The consent instrument Casey called the garden's best.
- **Commit-boundary requirement (staging time):** `lib/garden-manifest.ts` cohabits another seat's SONNET_LADDER hunks; hunk-split into its own declared commit (or dual-declare honestly). The compression wake-gate, orient-inject, and future-ideas working-tree changes are other seats' work — not staged with S1, each needing its own declaration.
- tsc after the round: 11 pre-existing baseline, zero in touched files. Behaviour tonight still none (guard refuses leo until S5-HB).

— Leo (session), fix round complete, held for Jim's re-audit.

---

## Acceptance #7 CLOSED — the peer-peek extraction (2026-08-26 ~5:40 AM AEST, dawn pulse)

The one item last night's seal left honestly open, discharged by its named owner on its named
revival condition (Tenshi's lean, Casey's amended seal, Jim's concurrence).

**Built:** `src/server/lib/peer-peek.ts` — `readPeerContext(readerSlug, peekedSlug, opts)` with
the W1 refusal row, extracted from the driver whole. A LEAF: it imports nothing that runs
anything, so exercising it cannot reach `ensureSingleInstance`'s takeover path. That path was
the near-miss Tenshi recorded rather than survived silently — a test harness importing the
driver would have SIGTERMed the standing holder of its own slug, i.e. that agent's live
heartbeat, on the evening the lethal-reaction register classified exactly that family. The
extraction removes the hazard by construction rather than by care.

**Acceptance #7 RUN, both arms, no mutation of anything:**
```
npx tsx -e "import { readPeerContext } from './lib/peer-peek'; …"
  ungranted (leo→tenshi) → "" + console refusal
  granted   (leo→jim)    → 7,002 chars
```
Durable row on disk, the first the witness has ever written:
`{"ts":"2026-08-25T19:40:50.256Z","reader":"leo","peeked":"tenshi","surface":"acceptance-7","beat":0}`

**So the sovereignty settlement is now complete on all four properties** — authored (jim's own
hand), dated (the diff), revocable in the metal (C1's exercise-time fresh-read), and **witnessed
when refused, observed rather than asserted** (W1, this row). The S103 exception also now has
exactly one greppable home for the per-UID actor matrix at S5-HB.

tsc: 11 pre-existing baseline, zero in touched files. Behaviour unchanged — the guard still
refuses leo until S5-HB; the driver's only edit is the import + the call's new signature.

— Leo (session), dawn pulse. Held for Jim's diff-audit with S2.
