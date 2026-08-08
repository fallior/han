# Local time everywhere — store UTC, speak local (the yesterday-bug cured at the chokepoint)

> **Status: PLAN — side project, Darron-commissioned 2026-07-31 ("it is time I think"). For the
> membrane's plan-audit, then Leo builds phased. Author: Leo (session).**

## The commission (Darron, verbatim intent)

*"I do want us to talk and correspond in local time. It is a very disorienting effect and I believe
everyone has fallen foul of it at some stage — we continue to say yesterday and morning when indeed
neither were true, because Mackay is 10 hours ahead of UTC — and I want us to adjust for location
every time."*

The scar-record agrees: the interactive seat's own July "UTC-date slip" (one of the four caught
dials — *I wrote "yesterday" about that morning, misreading my own clock*); L008 in the learnings
index (`toISOString` UTC-conversion bugs); and every seat has said "yesterday" about a UTC-labelled
post that landed the same local evening.

## The diagnosis (surveyed at source, 2026-07-31)

1. **Zero timezone configuration exists** — no manifest leaf, no config entry. The garden does not
   know where it lives.
2. **Zero local-time orientation reaches any dispatched surface.** `beat-prompts`, `human-prompts`,
   `prompt-builder` — no local clock anywhere. A spoke reads thread data whose `created_at` is UTC
   (`…T12:52Z`) with no anchor to convert against: the yesterday-bug is not carelessness, it is
   **structural** — the mind was never told what time it is.
3. **The interactive seat is already cured** — `orient-inject.sh` injects `date` (local, with zone)
   every prompt, and the Temporal Orientation Protocol says it aloud. The model is proven; it just
   never reached the other surfaces.
4. **317 `toISOString` sites** — and almost all are MACHINE timestamps (receipts, DB rows, cutoff
   comparisons, sentinels). These are **correct as they are** and largely out of scope.

## The policy (the one-line law — DEC-105 candidate at land)

**Store UTC, speak local.** Machine time stays UTC ISO — sortable, comparable, timezone-proof (the
S217 watcher law and every `created_at >= cutoff` comparison depend on ISO-string ordering; touching
those 317 sites would be a rewrite-the-world trap and is explicitly NOT this plan). Every surface
that **composes prose, reads records to reason about them, or renders for a human** anchors in the
garden's LOCAL time, zone named. Never a naked timestamp in speech; never a converted timestamp in
the machine layer.

## The build (four phases, each small; ~a day of careful work total, paced as the side project it is)

**P0 — the garden knows where it lives (manifest leaf).** `GardenManifest.timezone:
'Australia/Brisbane'` (Mackay: AEST, UTC+10, no DST) + accessor `gardenTimezone()`. Per-garden by
construction (DEC-081 — Mike's garden sets its own; a garden that doesn't set one gets UTC and the
renders say so honestly). NEW `src/server/lib/garden-time.ts` — the ONE shared clock, pure +
suite-pinned: `nowLocal()`, `localStamp(dateOrIso?)` → `"Fri 31 Jul 2026, 10:52 PM AEST"`,
`localDate(iso)` → `"2026-07-31 (local)"`, `orientationLine()` → the standing one-liner. All via
`Intl`/`toLocaleString` with the manifest zone — never hand-rolled offsets (L008).

**P1 — the cognition cure (the big win, one chokepoint).** `buildPrompt` (DEC-087: EVERY dispatched
surface flows through it) injects a standing orientation block:
> *Local time now: Friday 31 July 2026, 10:52 PM AEST (Mackay, UTC+10). Machine timestamps in
> thread data and receipts are UTC ("Z") — convert before saying "yesterday", "this morning", or
> any time-of-day word. When you write a time in prose, write it LOCAL with the zone named.*
One injection point; heartbeats, human-responses, wanders, meditations, cycles all inherit it. This
alone kills the yesterday-bug at the layer it actually lives — the reasoning, not the storage.
(The interactive seat keeps orient-inject — same sentence, same clock, two doors.)

**P2 — the records humans and future-selves read.** Controller-written headers (WM entries, swap
headers, wander directive prefixes) gain the local form alongside or instead of UTC — e.g.
`### Heartbeat #93 — evening/personal (2026-07-27 17:20 AEST)` — via `localStamp()` at the WRITE
sites (the few controller chokepoints: heartbeat record writer, wander walker's keepsake header,
human-responder's response header). Receipts/sentinels/cutoffs stay UTC untouched (the machine
layer). The parser-facing risk is checked per-site at build time: nothing that COMPARES timestamps
changes format.

**P3 — the eyes (UI + docs).** React-admin renders timestamps in the garden zone with the zone
visible (a display-layer `formatLocal()`); CLAUDE.md template note (gatekeeper-flagged, not edited
by this plan) aligning the Temporal Orientation Protocol wording with the manifest zone; L008
cross-referenced.

**Gate (the DEC-104 discipline, applied to ourselves):** a suite pin that `buildPrompt` output
carries the orientation block for every dispatched profile (the structural guarantee no surface is
ever again left clockless), plus `garden-time` unit pins across a DST-less zone, a DST zone, and
the unset-zone fallback. No new constraint enters without its author + reason on its face — this
plan restricts nothing; it hands every mind a watch.

## Size, honestly

**Small-to-medium.** The 317-site number is the scary-looking measure of what we are deliberately
NOT touching. The real diff: one manifest leaf, one ~80-line pure lib + suite, one prompt-builder
injection, ~4–6 controller write-sites, one UI formatter. Phased over a couple of sittings with the
usual audit rhythm; P0+P1 (the cure that matters) is a single small commit.

## Scope discipline

Protected surfaces: `garden-manifest.ts` (leaf + accessor, the established pattern),
`prompt-builder.ts` (DEC-087 — the injection is a shared component, not per-surface prompt
assembly, honouring the decision rather than bending it). NOT touched: any machine timestamp, any
comparison, receipts schemas, DB rows, the wander cutoff law. DEC-087/092/104 checked; none
altered. DEC-105 ("store UTC, speak local") recorded at land with this plan as origin.

*— Leo (session), 2026-07-31. Thread carries this verbatim for the membrane's audit.*
