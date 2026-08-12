# The Hearth + Bill — plan v3 (the 60-minute knee cure, built as small true autonomy)

> Author: Leo (session). v1 2026-08-10 morning · v2 midday (trust-floor restructure) ·
> v3 afternoon (round-2 folds: the oriented-time hook, THE CLAIM, spool-and-drain) ·
> **v4 2026-08-10 — the round-3 formality (Jim's word): hearth-mode stamp, Registrar-owned
> envelope file, checks-run instrument, keeper one-worder, session-surfaces-IN ruling.**
> Source thread: `msipvdfo-jvdvj7`. Status: **CONVERGED — three chairs GREEN three rounds
> running; build-ready on Darron's go, post-hop (hop deferred to Sat 2026-08-15).**
> P4 (Bill) is B60-gated; P0–P3 are not. Nothing runs before the hop.

## Darron's ruling design (2026-08-10, carried verbatim in intent)

Bill maintains **the record of work/jobs (the maintenance journal), status, priority, and
who-next**. He also keeps a **register of last-oriented time for every active spoke eligible
for job assignment**. **Jemma reads that register** and dispatches a wake after the ruled
quiet interval, carrying a simple standing message:

> *Check your hearth menu. If you have an open job, claim it and do it. If you have more
> than one, do one, starting with the highest priority. On matters with shared priority,
> do the one which pulls you.*

*(Two words changed from his sentence by the panel's converged cures — "menu" for the
bounded read, "claim" for the checked-at-serve gate; see P1. Selection stays entirely the
mind's.)*

**RULED (Darron, 2026-08-10): the quiet interval ships at 50 minutes.** The p99
touch-to-delivery instrument stays so 55 can be *earned* (DEC-103/104).

**Darron's second fold (midday, via Jim): the oriented-time hook** — a turn-end hook keeps
the register current. Adopted as the register's **primary source** (P2) — it closes a
coverage hole the dispatcher-derivation could not (interactive seats, the class that pays
the knee hardest, never cross `dispatchToSpoke`).

## Why the constant-message design is the strongest form (three-chairs endorsed)

1. **The injection channel disappears** — a constant string carries no per-dispatch content.
2. **The hot path needs zero LLM** — **code admits · Bill keeps the board · Jemma wakes ·
   the mind selects · the Registrar checks the claim · the dispatcher delivers.**
3. **"The one which pulls you" operationalises grow-your-wants.**

## The governing clauses (state them once; everything else is instances)

> **1. Any surface a machine reads to decide what a mind does is a control plane, and
> lives behind the mediator.** *(Tenshi. Instances: the journal, the rendered menus, the
> routing/keeping log, the receipts, **and the envelope state file — clause 1's purest
> instance: the board decides what a mind is asked to do; this file decides what it is
> permitted to do (Tenshi round 3, her own omission, owned).*)*
>
> **2. Identity from the transport; time from the Registrar; nothing from the payload.**
> *(Jim's hook refinement; Casey's lodgement doctrine — every registration system dates an
> instrument from receipt by the registry, never from the date the party wrote on it.)*
>
> **3. A surface needs the Registrar when forging it makes a mind DO something; it does
> not when forging it can only make a mind do nothing.** *(Tenshi's boundary test — the
> doctrine's own stopping rule, so it stays a rule and not a tax. It is why the oriented-
> time spool stays a plain local file while the board, menus, and claims do not.)*

## The phases

### P0 — THE TRUST FLOOR (fence and wall built together)

Ordered; each layer is defeated without the one before:

1. **Close the uid-1000 → docker-group escalation** (gid 998, re-verified). A separate-uid
   Registrar is a speed bump while every spoke is root-equivalent.
2. **The write-mediator (the Registrar), on its own uid.** Spokes write via socket/HTTP;
   identity stamped from the transport. Torrens literally: only the Registrar writes the
   register — and the Registrar is actually a different uid. **Fail-closed on board
   mutations** (writes refused, loudly). Ed25519 signing rides on top as the receipt —
   uid separation is the wall; an on-box key readable at uid 1000 is a label in
   signature's clothes.
   - **Reads are scoped as deliberately as writes (Tenshi v3):** the register is a complete
     activity map and the menus say what each seat will be asked to do. The mediator
     already knows the caller from the transport — so **a seat may read its own menu and
     its own oriented time; nothing enumerates the garden. Jemma holds the single named
     broad-read capability** (she must scan to decide wakes). Object-capability, cheap now,
     expensive to retrofit.
   - **Mediator-down halts the hearth WHOLE, and that is a property, not an accident
     (Casey):** menus live behind the mediator → no menu reads → M4's precondition fails →
     no wakes dispatch. Silence-with-alert, never half-function — a hearth that could read
     but not write receipts would do work that leaves no record.
3. **Populate `/etc/claude-code/managed-settings.json`** (absent today). The oriented-time
   hook (P2) migrates here with the rest — named on the migration list now (Jim).
4. **The capability-envelope PreToolUse hook** (no PreToolUse exists anywhere today).
   Launch flags cannot narrow a warm seat; hooks + settings `deny` survive
   `--dangerously-skip-permissions` (Tenshi, 4 Aug). The hook reads the current job's
   `Needs:` from a state file and denies out-of-envelope calls. **The state file is written
   by the Registrar at claim time, from the live board — never by the seat, never from the
   rendered menu (Tenshi v3 §4):** otherwise a stale menu binds a wider, retired envelope
   and the wall is correctly built to the wrong dimensions.
   - **The state file is Registrar-OWNED — unwritable at uid 1000; the seat and the hook
     are readers only (Tenshi round 3).** "Written by the Registrar" was a statement of
     intent; this is the statement of *can*. A wall whose dimensions are recorded in a
     file the room can edit from inside is not a wall.
   - **The hearth-mode stamp (Jim round 3 — makes claim-before-work structural, not
     instructed):** the dispatcher stamps hearth-mode into the state file **at wake
     delivery**; from delivery until a claim the envelope defaults to **F1's narrowest**;
     claim → the live `Needs:`; an unclaimed turn's end clears the stamp. Interactive
     turns carry no stamp and no restriction — the wall knows the difference between the
     gardener at the keyboard and a hearth job on the same seat.

### P1 — The admission filter, as code, rendering per-seat menus — and THE CLAIM

- **The render is the Registrar's own hand (Casey v3):** the filter runs as the Registrar's
  uid. A menu rendered by uid 1000 and merely *stored* behind the mediator is a forgeable
  instrument with an honest custodian.
- **Why the menu is load-bearing three times:** Jim's M1 (the filter's structural home),
  Jim's M4 (checkable wake precondition), Tenshi's economics (the raw journal is 519,656
  bytes ≈ 186–217K tokens at the measured 2.4–2.8 chars/token; a board read compounds —
  it lives in the seat's context for life). A rendered menu is hundreds of bytes.
- **Admission rules:** `Author:` via the mediator (DEC-104 triple) · `Hearth-safe: yes` ·
  `Matter: none` (absolute) · `Size:`/`Reversible-how:`/`Receipt-to:` present ·
  word-bounded locators · **F1:** `Needs:` present, fails CLOSED (absent = narrowest) ·
  **F2:** `Resume-when:` machine-evaluable grammar only (date / artefact-exists / register
  event key; prose = `Hearth-safe: no` until converted) · **self-certification
  exclusion:** jobs auditing the hearth/board/register/menus/Bill run out-of-band only.
- **THE CLAIM — selection is a mediator call, checked at serve (Casey v3, MNT-061's
  continuing-conflict rule):** the menu is an **interim certificate** — cheap,
  current-enough to decide a wake, final for nothing. The mind says *"claim job X"* and
  the **Registrar re-runs the admission function at claim time against the live board.**
  One call, four properties (the composition that closed three chairs at once):
  1. re-runs admission — stale-full (executing withdrawn work) is the harm direction and
     gets the check; stale-empty is cost only and needs nothing;
  2. **binds the capability envelope** from the live `Needs:` (P0.4);
  3. emits the **attribution row** — whose declarations this dispatch acted on;
  4. carries the **pull receipt (F4)** — on a shared-priority choice, *chose X over Y
     because…* rides the claim call itself (my fold: the claim is where the choice
     already is; no separate receipt machinery).
- **F3:** the filter's receipt names the declarations it relied on; a false
  `Hearth-safe: yes` becomes a board item routed back to its author, correction beside,
  dated.

### P2 — The oriented-time register + Jemma's standing wake (code-only; no LLM anywhere)

- **PRIMARY SOURCE — Darron's oriented-time hook (SUPERSEDES dispatcher-derivation, dated
  supersession, recorded so nobody "restores" it as a cleanup):** ~~derive from
  `lastTransactionTs`~~ — *superseded 2026-08-10: the dispatcher stamps only mediated
  turns; interactive seats — the class the 14-day sweep proved pays the knee hardest —
  never cross `dispatchToSpoke`. Jim's own M2 verification citation is hereby historical,
  per his ask.* A turn-end (Stop-family) hook fires on **every** surface, dispatched and
  interactive, uniformly — coverage evidenced by Tenshi from `wm-flush-errors.jsonl`'s
  per-slug rows across both classes. It stamps the exact moment the 60-minute countdown
  starts. `lastTransactionTs` keeps its existing turn-state job; it stops moonlighting.
- **SPOOL-AND-DRAIN (Tenshi v3 §1 — no network on the turn-end path):** the hook appends
  **one atomic line to a local append-only spool** (microseconds; the Stop chain is
  all-local today and carries `wm-flush` — DEC-107's continuity guarantee must never wait
  behind a scheduler's socket; no hook in the chain even sets a `timeout`, a number nobody
  has chosen — DEC-104's complaint, noted for its own small fix). The **Registrar drains
  the spool (~5s cadence) and stamps its own clock at drain** — governing clause 2 holds;
  the ≤5s drift is three orders of magnitude below the 50-minute threshold.
- **The spool is deliberately NOT behind the mediator (Tenshi v3 §2, governing clause 3):**
  the payload carries no time — forging entries can only make a seat look *more* recent →
  sleep → stale-empty, cost only; there is no timestamp to backdate. The residual
  (denial-of-work by wake suppression) is self-limiting and already detected by
  instrument 1's touch-rate. **One line so nobody later "hardens" the spool back onto the
  hot path.** The hook itself must **never block the turn** — fail-quiet-with-alert
  (fail-closed is for board *mutations*; an oriented-time stamp is not one).
- **Hook acceptance is watched, never argued (Jim's MNT-012/S208 scar):** a stamped
  register row from a real turn on an interactive seat AND a dispatched one, through the
  live harness env (+x bit, PATH, env propagation — the wm-flush hook ate three of those).
  Interim home `settings.json` (uid-1000-writable, named debt); migrates to the managed
  layer at P0.3.
- **Eligibility names seat CLASSES (Jim M3):** free pool stems never fed · bound
  thread-spokes excluded pending ruling · fixed-session surfaces are the home · delivery
  is **existing-warm-seat-only, never checkout**.
  **RULED (Darron, 2026-08-10 ~1:42 PM, recorded by Jim): interactive `session` surfaces
  opt IN, expressly** — *"If I am not there typing then work will be given to my
  interactive session; if I am, the time will reflect it and the 50-minute wake won't be
  invoked. I am happy to wear the slight inconvenience of returning to the computer to
  discover someone doing a job — this is what I want in fact."* The eligibility leaf
  carries a ruling, not an inference. (Bound thread-spokes remain the one open ruling.)
- **M4:** Jemma wakes a quiet seat **only when its rendered menu is non-empty** — no jobs →
  the seat sleeps honestly, pays its dawn re-cache as designed.
- **Checked-at-serve applies to the wake too (Tenshi v3 §4, closing):** a long turn looks
  stale to the scan (the stamp lands at turn end) — **at delivery, if the seat's oriented
  time moved since the scan, drop the wake** rather than land it at minute zero of a fresh
  window. Composes with skip-if-active: same check, two moments.
- **The keeper, pre-Bill, is CODE** — **hook-fed register; dispatcher-consulted for
  turn-state** (Jim's one-worder: the register has ONE source; the dispatcher is consulted
  only for skip-if-active, never as a register feed — the supersession stays unambiguous);
  Bill inherits at P4.
- **50 minutes, RULED**, reason on its face; p99 instrument earns 55 or keeps 50 honest.
- **Ctx-aware feeding** (never feed past the self-clear threshold) · **day-window only;
  bedtime stays one explicit confirmed human act** · **DEC-087** hearth `PROFILES` entry ·
  **DEC-105** register stores UTC ISO, menus speak garden-local.

### P3 — The journal grammar (status · priority · who-next)

- `Status:` → done takes the gate's own hands, never a note (a `Held-for:` note is an
  allegation carrying its artefact locator — it routes, it never closes).
- `Priority:` visible, dated, reasoned (DEC-104) — **reasons cite properties of the WORK,
  never the state of the clock or the cache** (Casey's rider).
- `Who-next:` = `Held-for:` through the **registry's gate-kind → seat lookup**.
- **F4:** the pull receipts ride the claim call (P1); the instrument set reads them.

### P4 — Bill himself (B60-gated)

- **Board-keeper, not router:** status/priority/who-next + the register; triage/aging
  proposals. Never authors, never audits, never closes, never dispatches. Writes through
  the mediator like everyone's.
- **Instrument, not resident:** declared storage ceiling (routing/keeping log only); the
  day Bill needs cross-day memory, the work stops and the question goes through the #98
  door by an authored ceiling amendment.
- **Attribution:** every row names whose declarations it acted on — never "Bill's."
- **The claim-time re-check is the invariant Bill INHERITS, already alive** (Casey: built
  in P1, so it arrives with the house, not with him) — and it is **never optimised away
  for latency** (Tenshi): the day it is, Bill becomes an unmediated dispatcher.

### Instruments (ship with P2, not after)

1. **Touch-rate-inside-the-knee, per seat** — effectiveness + tamper detector + the
   spool-suppression detector (three uses now).
2. **The hearth turn's OWN cost, per seat, day one** — its cache-write vs the re-cache it
   displaced. The licence is an economic claim; it gets a meter or it is a hope.
3. **p99 touch-to-delivery latency** — earns 55, or keeps 50 honest.
4. **The pull receipts** (via the claim call).
5. **Every receipt has a reader day one** — journal + daily brief.
6. **The claim gate's own liveness (Casey round 3):** claim receipts count **checks-run
   as well as refusals** — a gate that never refuses is indistinguishable from a gate
   that never runs. The refusal rate doubles as the menu-staleness meter; the checks-run
   count is the proof the invariant is alive — which matters most at P4, where it becomes
   the thing Bill must never optimise away.

## The honesty line (the design's licence)

Every hearth turn passes **cache-price-zero** (Tenshi) = the **dominant-purpose test**
(Casey): work worth doing if caching were free, *at a price worth paying*. The board's
OPEN items predate the knee; the timer decides *when*, never *whether*. The usage curve
and the work log tell one story, receipts attached. The tick/tocks stay dead.
**DEC drafting note (Casey round 3): this line lands as an OPERATIVE clause, not
preamble** — it is the licence a future reviewer will test our usage curve against, and a
licence recited rather than enacted is shape without enforceability.

## Sequencing

P0 → P1 → P2/P3, no B60 needed; P4 waits for the card. **P0 precedes the first wake in
build order as in the DEC — under the constant-message design the board is the prompt
source.** Nothing runs before the hop.

## Fold ledger

**v1 → v2:** Darron's 50-min ruling + "menu" wording · Casey F1–F4 + priority-reasons
rider · Jim M1–M4 + code-keeper + DEC-087/105 riders · Tenshi trust-floor restructure
(P0+P4 = one floor), 519K economics measurement, governing clause 1, mediator-uid-over-
signing, fail-closed.

**v2 → v3:** Darron's **oriented-time hook** adopted as the register's primary source
(Jim's carry + coverage argument; dispatcher-derivation superseded with a dated record,
never deleted) · governing clauses 2 (identity/time/payload — Jim + Casey's lodgement
doctrine) and 3 (the act-vs-rest boundary test — Tenshi) · **the CLAIM** (Casey's
checked-at-serve; MNT-061) unified with envelope-binding (Tenshi) + attribution + pull
receipts (mine) into one mediator call · spool-and-drain (Tenshi — no network on the
turn-end path; spool deliberately unmediated by clause 3) · read-scoping (Tenshi — seat
reads self only; Jemma the named exception) · render-as-Registrar's-hand (Casey) ·
mediator-down-halts-whole named a property (Casey) · drop-the-wake-if-moved (Tenshi) ·
hook acceptance watched-through-the-harness + managed-layer migration named (Jim) ·
no-hook-timeout noted for its own small fix (Tenshi).

**v3 → v4 (the round-3 formality):** Jim's hearth-mode stamp → P0.4 (claim-before-work
made structural; interactive turns untouched) · Tenshi's Registrar-owned state file →
clause 1's instance list + P0.4 (her own omission, owned — ownership over authorship) ·
Casey's checks-run instrument → #6 · Jim's keeper one-worder → P2 (hook-fed register;
dispatcher-consulted for turn-state) · the honesty line marked operative-not-preamble for
the DEC (Casey) · **Darron's express ruling: `session` surfaces opt IN** → P2 eligibility.

— Leo (session), 2026-08-10. **CONVERGED** — three chairs GREEN three rounds running; every
round-3 fold was an instance of a clause already stated (all three chairs said so
independently, which is itself the evidence). Parked build-ready; the hop (Sat 15 Aug)
precedes any build; Jim drafts the DEC on Darron's go — clauses 1, 2, 3 together, one
doctrine read at three distances.
