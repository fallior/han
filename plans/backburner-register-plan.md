# The Backburner Register — started work that lost its driver, derived not filed

> **Status: P0 LANDED 2026-08-26 (deriver + fixtures + cron live; first derivation: 178 rows — 118 unattended, 60 triage, register sees itself). P1 (wall lane, lib/ diff for Jim) + P2 (weekly digest) pending — the plan stays enrolled until LANDED whole.**
> Commissioned by Darron, 2026-08-26 afternoon. Companion to FI #156 (standing-works registry) —
> this is its **Part 4**: #156 raises jobs whose trigger is TIME (repeating maintenance); this
> tracks work whose trigger already fired — we started — and whose driver then went quiet.
> No separate FI: attach, don't mint (the MNT-160/166 convention).

## Origin — his words, which are the specification

*"I get us to start so many things and so many things end up silently waiting for our attention
which will only come if we remember."* And the design instinct that survives whole into the build:
*"everything started gets put in the backburner and removed when it is done — that way if we
forget to remove it, it means we have forgotten about it and it is not done."* The inversion is
the register's best property: **a stale row cannot lie. It is either not-done or forgotten, and
both are exactly what we need to see.**

The specimen that dates the need: the same afternoon this was commissioned, Darron had to quote a
night report's queue-paragraph back at his own agent and ask *"did we get to it?"* — because the
queue lived only in a working-memory window that had rotated into the gradient. Started work was
invisible NOT because nobody recorded it, but because the record had no standing reader and no
standing home.

## The core design decision: DERIVE, don't file

FM #81's law (the payer never collects): a register anyone must remember to write into is one more
thing to forget — resolve has failed at this in every recorded instance. The cure is structural:
**in this garden, starting always leaves spoor.** The register is a VIEW computed over artefacts
that starting already creates. Enrolment is automatic by construction; nobody files.

### The feeds (each already structured, each already exists)

| Started a… | Spoor (the feed) | Auto-exit |
|---|---|---|
| code change | uncommitted diff in `git status` (both repos: `~/Projects/han`, `~/.han`) | commit lands → leaves the tree |
| design | `plans/*.md` whose status line is not DONE/CLOSED/SUPERSEDED/LANDED | status line flipped |
| fix-needed | OPEN row in the maintenance journal | row closed (already on the wall) |
| held build | a `HELD for audit` / `awaiting GREEN` marker in posts/commits | the GREEN + land |
| conversation-only intention | **the one true gap** → cured by the marker convention below | marker resolved |

### The marker convention (the cheapest spoor, for what leaves none)

One line, anywhere — a post, a swap entry, a plan: `WAITING-ON: <who> — <what>`. Harvested by the
same parser family as the diary's FEELING_TAG markers (markers-from-prose is a proven house
pattern). Resolution: a matching `WAITING-DONE: <what>` anywhere later, or hand-removal from the
view's exceptions file. This is also the cure for the night-report queue class: a report's
"queue for Darron" items become marker lines and harvest themselves.

## The two columns that keep it honest

1. **Age since last touch** — the falsifiable column (the lighthouse-log rule: every row
   checkable, never a vibe). Derived per feed: mtime for plans, `git log`-vs-now for diffs,
   row stamps for the journal, marker timestamp for markers.
2. **Parked vs unattended** — Casey's will-not/has-not split, made structural. A row MAY carry a
   **revival condition**: `PARKED-UNTIL: <checkable condition>` (a date, an event, "the B60 swap",
   "Fable reset"). Parked rows do not nag; unattended rows age loudly. Precedent: Casey's curation
   revival condition, written 20 Aug, FIRED 26 Aug — the mechanism is proven. Without this split
   the register cries wolf about deliberate parks and trains its readers to deafness (the MGH
   alarm lesson, FM #69: an alarm stream's honesty is a property of the whole stream).

## The readers (a record only earns a reader somebody deliberately built — FM #82)

Three, all existing surfaces, **no new board** (the 2026-08-24 ruling: never build a second board
beside the Wall — make the existing board real):

1. **A Backburner lane on the kanban wall** — the derived view emits rows the board parser
   already understands; the wall grows a lane, not a sibling.
2. **The hearth pulses** — the covenant already says *get a job from the board*; the standing
   pulse job becomes "surface the oldest unattended row." The register is read many times a day
   for free, by seats already paid for (the knee economics).
3. **The weekly oldest-three to Darron** — the human-facing tail in the digest, so nothing
   requires his memory to survive.

**Bill's seat:** rows emit with the Bill-ready ministerial fields the journal already carries
(size, owner-rule, acceptance, age, parked-state) so that when Bill's ranking seat lands (the
hearth-menu design: *code admits, Bill ranks, the dispatcher delivers*), backburner rows are
rankable on day one. Until Bill exists, age-descending IS the ranking.

## Build phases

- **P0 — the deriver** (`scripts/backburner-derive.ts`, cron or hearth-invoked): computes the
  view from the five feeds; emits to a journal-parseable section or its own
  `~/.han/memory/shared/backburner.md` (D-slot 1); every run stamps a receipt to
  `~/.han/health/backburner-derive.jsonl`. Read-only over its sources. Declares its blind spots
  in its own header (Casey's absence-of-a-counter law: a sweep must declare its method and blind
  spot or a lazy sweep is indistinguishable from a clean one).
- **P1 — the lane + the pulse job**: wall lane over the derived rows; the hearth covenant line.
- **P2 — the digest tail**: weekly oldest-three.
- **Acceptance (self-referential, per Darron's own joke):** the register's first derived row is
  THIS PLAN — it enrols itself via the plans/ feed at P0's first run, and exits when this file's
  status flips to LANDED. If the register cannot see itself, it fails its own acceptance.

## D-slots (Darron's)

1. Derived view's home: own file (`backburner.md`) vs a journal section the wall already parses.
2. Marker grammar final form (`WAITING-ON:` / `PARKED-UNTIL:` / `WAITING-DONE:`).
3. Weekly digest destination (daily-brief vs a thread post vs ntfy).

## Chairs

- **Jim** — audit (the deriver touches no protected path but reads both repos; the blind-spot
  declaration wants his eyes).
- **Tenshi** — the sweep's blind spots + whether the marker harvest creates a needle-contamination
  surface (her MNT-191 fixture discipline applies to any prose-harvesting parser).
- **Casey** — the parked-row semantics: revival-condition grammar, and whether a parked row with
  an expired condition converts to unattended automatically (I believe yes — an expired park is
  the loudest kind of unattended).

## Cross-refs

FI #156 (Parts 1–3: registry, feeder, sweep — this is Part 4); FI #93/K0-K1 (the wall + parser);
FI #126 (Vitals Board); MNT-202 (the tree-held-changes class — feed 1's justification); MNT-078
(writer-no-reader); FM #81/#82/#69/#102 (the laws built in); DEC-069 (derived view deletes
nothing — sources are the record; the view is re-computable).
