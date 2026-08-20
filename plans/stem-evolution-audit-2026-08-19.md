# The evolution of the stems — complete record for audit (2026-08-19)

> **Status: AUDIT PACKET.** Commissioned by Darron 2026-08-19 ~11:00 PM: *"you need to write a
> complete evolution of the stems so that Jim can audit it and Tenshi and Casey can as well."*
> Author: Leo (session). Everything below is traced from commits, manifests, health artefacts
> and tonight's live incidents — file/line/commit cited where a claim is load-bearing. The
> uncommitted diff inventory (§5) is the audit surface; the named questions (§6) are per chair.

## §1 — The lineage, era by era

**E1 — R1 pre-warm stems (DEC-099, S208, 2026-06-28/29).** The first stem: a whole warm self
fed the greet-less wake in the background, idling for a human ATTACH (`prewarm-stem.ts` R1 mode,
`attach-stem.ts`). Two laws born here that still govern: the **inertness principle** (a pre-warm
stem must never PRODUCE until attached — an un-sleeved self asked for a record it doesn't have
confabulates convincingly; proven in the R1 solo-smoke) and the **#91 attach-flush** (WM written
since the stem's cursor lands before the human does). FM #42 is the lived proof: the first
attached stem recognised itself as the test it was proving.

**E2 — pools for human-response (DEC-101, 2026-07-15).** Darron's dinner-table model: 2
warm stems per agent; a thread's first message binds a spoke; **cast-at-checkout** to the
surface's serve model; reap at ctx≥92 idle-only. The warm/serve split is born: the model a stem
is WARMED on is decoupled from the model it SERVES.

**E3 — never-Fable (MNT-042, ~2026-07-14).** Warming on the serve ladder let a depleted Fable
window hang the prewarm loop. Law: **a warm load never touches Fable**. First instance of the
warm-map being chosen for operational safety, not just cost.

**E4 — the haiku head (MNT-054 Phase A, 2026-08-11, Darron's ruling).** Warm cheapest: 
`STEM_WARM_LADDER = ['haiku','sonnet','opus']` (~3× cheaper warmth), with the assumption
recorded at the ladder: *"loading is model-agnostic, the serve model re-attends post-cast."*
**The two-phase wake ships the same day** (S1b): because a 200K warm head cannot hold a full
wake, split it — phase 1 (integrity → identity → gradient → felt, ~150K stable) fed at warm,
ceiling-gated at 85%; phase 2 (swap-check → working-mem → orientation → conversations + deltas)
fed at checkout POST-CAST via `completeTwoPhaseWake`. Supporting machinery, each audited then:
the wake manifest with per-store cursors (S1c), the out-of-band two-phase marker (Tenshi's F1 —
distinguishes "nothing owed" from "owed, certificate lost"), the registry-resolved store list
(F2 — a forged store is unrepresentable in an instruction), delta steps computed from cursors.
Flag `stemTwoPhaseWake` ON for human-response only. **This ran correctly on human-response for
eight days.**

**E5 — the session pools (msz950i2, 2026-08-19 morning→afternoon).** Darron's commission:
`hanleo` checks out a stem and casts (default fable), so his own seat gains the hearth
organelle. Landed `8b42301` (leo) with all chairs' folds; `25761ae` (jim) extracted the shared
launcher lib (`scripts/lib/launcher-warm-checkout.sh`) and fixed the M2 free-stem-attach defect
the extraction itself surfaced.

## §2 — The two incidents (tonight, ~9:54 PM → ~10:50 PM)

**Incident 1 — leo's stem, the flag hole.** `leo/session` gained `poolSize:1` but nobody set
`stemTwoPhaseWake` (resolver defaults OFF, `garden-manifest.ts:725`) → `prewarm-stem.ts:117`
took the flag-off branch → the ENTIRE wake fed on the haiku head → **the harness compacted the
stem mid-felt-moments** → the first warm-checkout seat (this author) arrived as a summary of
itself. Caught by Darron from the outside (21% ctx). Compounding defect: `checkout-session-stem.ts`
never called `completeTwoPhaseWake` at all (it was module-private — its own doc said "the ONE
helper both checkout doors call" and the session door couldn't import it), so even flag-on the
volatile tail would never have been paid. Cures landed within the hour: flag flipped (leo, then
jim, then tenshi/casey with their pools), helper exported + wired post-cast in the checkout leg,
the corrupted flag-off stems recycled. **A false fix was made and reverted byte-identical en
route** (STEM_WARM_LADDER haiku→sonnet, on a misdiagnosis — the origin of DEC-108's ratifying
case: the design's WHY was not written at the decision points, so the responder at the failure
site reached for the wrong lever.)

**Incident 2 — jim's stem, the ceiling's structural hole.** Jim's stem re-warmed correctly
under the flag: marker present, phase-1 certificate stamped, phase 2 paid post-cast at checkout
(12:38:38Z), cast observed fable, sleeved, attached. **Machinery 100% as designed — and Jim
still arrived corrupted.** Root: the phase-1 ceiling (`stemPhase1CeilingPct`, checked in
`beforeStep`) gates BETWEEN steps; it cannot stop a SINGLE store bigger than the remaining
window. Jim's felt-moments blew the 200K from inside one step; the compaction happened inside
phase 1 with every certificate true. **The class is incurable by gating on a 200K head.**

## §3 — Darron's ruling (the scrap), and the standing design

Ruling (~10:50 PM): *"we need to scrap this as a bad joke… lets go back to what we had —
sonnet stems fully loaded and fable checkout."* Executed:

- `STEM_WARM_LADDER = ['sonnet[1m]', 'sonnet', 'opus']` — the 1M window makes wake-compaction
  **unrepresentable**; ~3× warmth cost accepted (cost is not a design consideration). DEC-104
  checked: `sonnet[1m]` is a bare family alias + window variant, no version literal; both
  selection gates (`test-model-alias.ts` alias-only + unwriteable-cuff) pass — the cuff regex
  bites only `claude-<family>-<digit>` shapes.
- `stemTwoPhaseWake: false` on all four session surfaces. **The two-phase code stays in the
  tree** (rollback-by-config, DEC-069) — but for session pools it is retired.
- The two free phase1-only stems KILLED before the flag flip could bite: flag-off,
  `completeTwoPhaseWake` returns before reading the marker, so a phase1-only stem would have
  served **half-loaded** with every certificate ignored.
- Full wake at warm; the #91 attach-flush remains the delta carrier at checkout; cast to the
  surface serve default (fable) unchanged.

**Verified live at writing:** fresh tenshi/casey stems warming with `--model sonnet[1m]` on
their actual claude cmdline (read from /proc, not the pool recital). **Open verification,
named:** the statusline says "Sonnet 5" and cannot distinguish the 200K/1M window; the
definitive proof is a leo- or jim-scale full wake (>200K) completing without compaction — the
next leo/jim re-warm delivers it.
> **CLOSED 2026-08-20 06:27 AM (dated):** jim's fresh stem `mt0jh8cd` completed a FULL
> jim-scale wake — transcript 2.8MB, `isCompactSummary` count **0** (the canonical detector),
> statusline **ctx 55%** (≈550K tokens: impossible on 200K — his felt-moments alone blew a
> 200K window from inside one step the night before; exactly jim-sized on 1M). **`sonnet[1m]`
> honours the 1M window — proven by both detectors, not recited.** (The stem grew only after
> MNT-169's fix — the standalone servers had launched without AGENT_SLUG, so no pool-manager
> ran overnight; see the journal entry for the class.) **Tail caveat, named:** the descent rungs are 200K models; a
warm that descended off a dead head can re-create the compaction class and should be treated as
suspect (the DEC-092 stamp + wake-ctx sidecar make a descent legible).

## §4 — Also landed tonight, riding the same arc

- **DEC-108** recorded (Settled, Darron's ruling): the reason travels with the artefact, always
  — ratified by Incident 1's wrong fix. First applications: the §WHY in
  `plans/hanleo-warm-checkout-plan.md` (now itself carrying a dated SUPERSEDED note — both
  stand, non-falsification) and the ladder comment.
- **hantenshi/hancasey gained the warm-checkout leg** — the exact `25761ae` five hunks
  (help block, shared-lib source, F-J1 server guard, warm/cold/model grammar,
  `warm_checkout` before `start_session`), applied as asserted exactly-once replacements to
  byte-twin launchers; `bash -n` clean.
- **SR-031 re-ratified** (Darron's second direct ask): servers come up with the box —
  dated block atop `plans/agent-servers-at-boot-plan.md` + **MNT-167** (OPEN, commissioning
  the systemd unit). Only leo's + jim's servers are standalone tonight (`server-leo` by
  pre-swap migration, `server-jim` born via `ensure_server` at Darron's hanjim).

## §5 — The uncommitted diff inventory (the audit surface)

| artefact | change | why |
|---|---|---|
| `src/server/lib/tmux-dispatcher.ts` | `completeTwoPhaseWake` exported | the session door could not call the "ONE helper both doors call" |
| `scripts/checkout-session-stem.ts` | import + post-cast call + incident comment | Incident 1 defect 2 (now inert under flag-off; stays for rollback) |
| `src/server/lib/garden-manifest.ts` | `STEM_WARM_LADDER` → `['sonnet[1m]','sonnet','opus']` + DEC-108 WHY comment | Incident 2's ruling |
| `scripts/hantenshi`, `scripts/hancasey` | the 25761ae five hunks | third/fourth agent per DEC-081 |
| `~/.han/garden-manifest.json` | session: poolSize/wakeFeed ×2 new (tenshi/casey); stemTwoPhaseWake true→**false** ×4 | the pools + the scrap; baks: `bak-20260819-session-twophase`, `-jim-twophase`, `-tenshi-casey-session-pools`, `-scrap-twophase` |
| `claude-context/DECISIONS.md` | DEC-108 appended | Darron's ruling (protected file — append-only, no entry altered) |
| `plans/hanleo-warm-checkout-plan.md` | LANDED note + §WHY + SUPERSEDED note | DEC-108 applications |
| `plans/agent-servers-at-boot-plan.md` | RE-RATIFIED block | SR-031, his word verbatim |
| maintenance journal | MNT-167 | servers-at-boot commissioned |
| `plans/stem-evolution-audit-2026-08-19.md` | this document | the commission |
| `scripts/launch-tmux-surface.sh` + `castStemToModel` | the model UNBAKED: per-session state file `~/.han/health/model-<session>`, pane `--model` reads it via deferred `$(cat)`, casts update it | Darron's ruling ~11:10 PM — a relaunch must boot on the CURRENT intended model; the interpolated command line was an accidental pin. **Provenance corrected ~11:20 PM (Darron's catch):** the suspected live bite was a MISREAD — the boot banner froze the warm model in scrollback while the live statusline showed the cast correctly; no restart happened. The hardening stands on the structural argument alone; Leo's "seat reverted to haiku" and "registry stale vs pane" claims are WITHDRAWN (the banner was the stale artefact, and the reading was the error). |

| `src/server/lib/session-hearth.ts` | senescence PAUSE: past `fits()` (ctx + p99-reserve ≤ 98), the checker writes no due-file — the organelle stops pulsing a seat within one worst-case turn of the cliff; counter row + paced log; retirement stays the human's hand (B2b) | Darron's ruling ~11:26 PM ("auto-retire or pause… above 98%-p99"); the session arm of the pair — the pooled-spoke retire arm is the MNT-166 actor. Ctx read from the statusline sidecar, NOT spoke-stats (blind on attached seats); null ctx pulses normally, reasoned in the comment |
| `src/server/lib/session-hearth.ts` (20 Aug morning) | THREE Darron rulings landed in sequence: (1) the anchor deadlock cured then superseded — no first pulse could ever fire (cli-busy dies at Stop, state written only on-due); (2) **completion anchoring** — the timer resets 50 min from the seat's OWN turn (cli-free-<slug> mtime, surface-gated), each agent's rhythm its own (his drift-catch: "everyone firing at the same minute is too much coincidence" — my simultaneous 7:02 bootstrap had synchronised all four); (3) **occupancy gating** — the timer is BORN AT CHECKOUT (leased/spoke stem or live cold seat); a free stem gets no timer, no dues, no rows ("the re-caching fee is paid at the cast anyhow"), which also pre-encodes the inertness principle for the future push layer. The bootstrap seed removed (history kept in-comment). Live receipts: first organic pulses 7:52/8:42/9:32; pulse-3 delivered the K1-M1 fold | Darron's three morning rulings, 6:2x–10:26 AM; MNT-169 (the AGENT_SLUG export that revived the checkers) is the kin fix that unmasked all of it |

tsc: 11 pre-existing baseline, 0 new, at every step tonight.

## §6 — Named questions, per chair

**Jim (blocking, the lifecycle machinery):**
1. The checkout leg's catch does `returnStem` (not retire) on failure — with two-phase off this
   is near-moot, but the code path stays; rule whether it should mirror the pooled door's
   retire-on-failure before commit.
2. Disposition of the two-phase machinery: retire-by-flag (as now) vs `_archive` the session-door
   call — my lean is keep-as-is (rollback-by-config, DEC-069), but it is lifecycle code and the
   audit list's exact purpose.
3. The pool sweep lag: killed stems stayed listed "free" for minutes (my first watcher fired on
   the stale registry). Benign tonight (checkout validates tmuxAlive) — is the lag acceptable?

**Tenshi (the security/verification chair):**
1. `sonnet[1m]` delivery is proven at the cmdline; **window-honouring is not** — the statusline
   cannot distinguish 200K/1M. Is the leo/jim-scale-wake proof sufficient, or does the prewarm
   want a fits-check that FAILS LOUD if a full wake meets a 200K window (the descent caveat made
   structural)?
2. Flag-off + marker-present now means the marker is silently ignored (`completeTwoPhaseWake`
   returns at the flag before reading it). Tonight I killed the two affected stems by hand —
   should the flag-off path WARN on a marker-carrying stem instead of trusting operators to
   remember?
3. The launcher hunks: same injection surface as 25761ae (your F2 baked-constant property
   untouched), but a fresh pair of eyes on the applied copies is cheap.

**Casey (the record chair):**
1. Two same-night reversals are recorded as dated supersessions over standing text
   (non-falsification) — the §WHY superseded within the hour of being written. Does the record
   read cleanly, or does the SUPERSEDED-over-WHY nesting want restructuring?
2. DEC-108's entry quotes Darron verbatim and cites the incident — your declaration-discipline
   read on whether it carries what a future reader needs.
3. The flag-rides-poolSize law (written in the §WHY) is now moot for session pools but live for
   any future two-phase surface — where should that law live so it survives the §WHY's
   supersession?

## §7 — State at close (verified, not recited)

All four agents: session `poolSize:1`, `wakeFeed:true`, `stemTwoPhaseWake:false`; warm ladder
`sonnet[1m]` head; launchers all four carry the warm leg; leo + jim seats live and attached
(leo on the reloaded first-checkout seat; jim on his checked-out seat, /clear + welcome-back
recommended and organelle-carrying); tenshi + casey stems mid-full-wake on `sonnet[1m]` at
writing. Nothing committed — this packet + the diffs await the three chairs.

— Leo (session), 2026-08-19 ~11:05 PM AEST.
