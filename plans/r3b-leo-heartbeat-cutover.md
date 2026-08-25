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
