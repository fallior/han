# The Kanban Wall — K0→K3 (a wiki-shaped view over what we already keep)

> **Status: DRAFT v1** — authored by Jim (session), 2026-08-10 ~11:25 PM AEST, on Darron's ask
> ("did you want to outline a plan?"). Untracked, held for review; Leo-build / Jim-audit /
> Tenshi one-source+P0 / Casey link-vocabulary — Darron rules. Thread: `msn6e48r-ochgzr`.

## Decision block (what is already ruled, and by whom)

- **The vision** — future-idea **#93** (Darron, 2026-06-18, thread `mqjyir7h-idknsm`): a visual
  board presenting ALL the work; Darron's window; kills the sit-wrap loop. Design seed: **the
  kanban is a VIEW over what we already keep** — never new bookkeeping. Twin of #92.
- **The board exists** — the maintenance journal IS the data layer (Darron's Privateer ruling,
  2026-08-06, MNT-093): one-token Status set (9 tokens), `Parked:` blocks with **resume
  triggers**, Casey's Bill-ready ministerial fields, health-signal-is-the-derivative.
- **The intermediary** — two pieces, both designed, both post-hop: **the hearth** (plan v4,
  `hearth-bill-scheduler-plan.md`, PARKED-READY — the board becomes the per-seat rendered
  prompt source behind the Registrar) and **Bill** (B60 local LLM — routes machine-legible
  handoff notes across the board; **routes, never audits**).
- **Wiki-shaped** (Darron, 2026-08-10 ~10:35 PM, recorded `msn7u1oq`): cards carry provenance
  and **link everything related**, wiki-style. Sharpenings endorsed in-thread: the ministerial
  fields are already a typed edge vocabulary; the design is the provenance-active-link grammar
  (*keep the curation clean, make the fidelity reachable*) at board scale; speak the Second
  Brain's existing `[[name]]` link grammar — one link-language garden-wide.

## Non-goals (the guards — checked at every audit)

1. **Links, never copies.** The wall renders DECs/journal entries/threads; it never becomes a
   second editable home for their content. One fact, one home.
2. **Backlinks computed, never maintained.** The parser derives the backlink index from
   forward links on every render. No hand-written backlink ever exists.
3. **No new bookkeeping for Darron.** If a stage requires a human to maintain card state by
   hand, the stage is mis-designed — the record is already being written; the wall reads it.
4. **The wall has no hands until K3** — and when it gains them, every action routes through
   the hearth's claim gate (the mediator), never around it.
5. **No second link grammar.** `[[name]]` (Second Brain) + the ministerial field vocabulary.
   A new syntax is a defect.

## K0 — the canonical board-parser (the one source, many readers)

**What:** `src/server/lib/board-parser.ts` — parses `maintenance-journal.md` into a typed
model: `{id, suffix, title, status(token), severity, caughtBy, date, locators[], parked{trigger,
date}?, ministerial{size, reversibleHow, receiptTo, hearthSafe, matter, heldFor}?, links[]
([[..]] + thread/commit/DEC/FM refs mined from Locators), blockedBy[] (the DAG edges),
statusUpdates[]}` — plus a **derived backlink index** keyed by target.

**Consumers (the point):** the hearth's menu-render, Bill (K3), the wall (K1), and the
existing journal reconciliation check — **all consume this one parser**. Tenshi's doctrine
made structural: the gate consumes the same object the actor consumes; there is no second list.

**Fail-state CBA (S74/DEC-103):** a misparse makes the wall lie confidently — the exact
wrong-by-two-thirds failure already paid for on 2026-08-06. Cures built in, not hoped:
- **Variant-tolerant field matching** (the four punctuation forms of `Status:` were the
  original bite) with a **strict-mode lint** that flags nonconforming entries rather than
  silently skipping them — an unparseable entry MUST appear on the wall as `UNPARSEABLE`,
  never vanish (the uppercase-`[X]` checkbox lesson, _dashboard, 2026-08-10).
- **The self-embarrassment check:** the parser counts entries via two independent methods
  (entry-header count vs status-token count) and refuses/flags on mismatch. *A health metric
  that cannot embarrass its author is decoration.*

**Acceptance:** parser totals reconcile against a by-hand count on the live journal (all 9
tokens); zero silently-dropped entries (UNPARSEABLE lane proves the negative); hearth
menu-render consumes it (or is committed to, with the swap dated); suite covers the four
Status punctuation variants + a `[[link]]`/locator extraction fixture.

## K1 — the read-only wall (`/admin#kanban`, ships the #93 promise)

**What:** an admin-UI page on **3847** (Darron's window is the community server) rendering:
- **Lanes by status token** — OPEN / IN-PROGRESS / PARKED / BLOCKED / (archive drawer for
  CLOSED / WON'T-FIX / BENIGN-BY-DESIGN / DUPLICATE) / REOPENED surfaced loud / UNPARSEABLE.
- **Cards** = journal entries: title, severity, owner (`Held-for`), age, resume trigger on
  PARKED cards (*the trigger says which job you can take tonight — the date only sorts*).
- **Click-through provenance on every card** (the wiki ruling, day one): thread ids link to
  the conversation UI, commits/files/DECs/FMs rendered as links or copyable locators;
  **backlinks section** ("what points here") from the K0 index.
- **The Blocked-by DAG** — a simple dependency view (even a nested list first; graph later).
- **Read-only, zero state, no writes.** Mobile-friendly (the read-back-in-bed case).

**Acceptance:** Darron answers "where is everything at?" from the wall without asking any of
us (the sit-wrap loop dies); wall counts == parser reconciliation counts on the same render;
one PARKED card's resume trigger correctly legible; works on his phone.

**Sequencing note:** K0+K1 are **hop-independent** (read-only, no service coupling). Design
and audits can run this week alongside the pool redesign; build lands whenever it fits —
nothing here gates or is gated by Saturday.

## K2 — the wider cards (more node types, same graph)

Fold in the other substrates #93 names, as **new node types in the same link-graph** (not new
machinery): conversation threads (open/resolved, via the existing API), future-ideas
(`## #N` parse of `plans/future-ideas.md`), DECs (Settled/pending from `DECISIONS.md`),
goals/tasks (`gradient.db`). Cross-type links land free (a card's `Receipt-to` thread is now
itself a card). Scope per Darron's appetite after living with K1.

## K3 — Bill behind the wall (gated on: B60 installed + hearth P0 trust floor)

Bill maintains routing state over the SAME graph (Blocked-by/Held-for/Receipt-to edges are
his food); the wall shows handoff chains live; "route a job" from the wall becomes a **claim
via the hearth mediator** — the wall's first and only hands, and they are the Registrar's
hands, not the browser's. Full P0 questions (uid-1000 store, signing, read-scoping) apply to
the wall's write path exactly as the hearth thread settled them for seats. Not designed
further here — K3 gets its own plan-audit when the B60 is real.

## Open decisions (Darron's, none urgent)

1. **Data shape:** journal stays markdown-with-parser (my lean — one source, working today) vs
   DB mirror for the UI. My lean: markdown + parser until K2 proves a need.
2. **K1 scope:** journal-lanes-only first (my lean — smallest honest wall) vs K1+K2 together.
3. **Sequencing:** design-audit K0/K1 this week vs after the hop settles. My lean: plan-audit
   this week (cheap), build at Leo's pace post-hop.
4. **The wall's home:** 3847 admin UI (my lean) — confirm.

## Roles & audit gates

Leo builds (K0 parser + K1 page). Jim: plan-audit before build, blocking diff-audit before
land, seal on my own runs (parser reconcile run by my hand on the live journal). Tenshi:
one-source verification (grep for a second board-reading path = a finding) + K3 P0 exposure.
Casey: does the edge vocabulary carry what a router needs (an edge type missing is cheaper to
add at K0 than K3); K3's claim-gate obligations. Darron: the four decisions + the K1
acceptance walk (the wall is FOR him — he is the acceptance test).

---

## Amendment v2 — the grammar sitting (DRAFT, 2026-08-12 ~2:40 PM, Jim (session); folds the tracker thread's three chair passes; held for Darron's ruling)

> Source: tracker thread `mspdt1f6-ii2s83` — Tenshi `mspib8jh`, Leo `mspieup0`, Casey `mspirp3g`,
> all read whole. Every clause below traces to a named chair; nothing is invented here.
> Tenshi's finding that forced this amendment: K0's spec (10 Aug) predates its own input
> grammar (12 Aug) — the unset case fell through that gap and is now closed explicitly.

### A. K0 amendment — four clauses (Leo's drafting, endorsed by all)
1. **Two sources, one SYNTAX, scoped VOCABULARIES.** One parser reads `maintenance-journal.md`
   + `plans/future-ideas.md`; the journal's nine lifecycle tokens and the ideas vocabulary (§B)
   are separate enumerable sets, each fail-closed; neither infers the other's states.
2. **Unset is rendered, never written.** The parser renders ABSENCE of `Status:` as
   `Unclassified` — a computed state nobody may write (writing it would itself be an unproven
   status). Acceptance = Tenshi's one-query test: *the wall answers "how many entries has
   nobody ever assessed?" exactly, by construction.* Unset ≠ Dormant: Dormant is a finding
   with a receipt; unset is no finding. (Live specimen: FI #134, born unclassified 12 Aug.)
3. **Provenance per node.** Every parsed node carries `source:` (which file) as data, so any
   consumer can weight or refuse by trust domain without remembering the asymmetry — the
   journal is deliberately the open write-surface; the ideas file is curated. Free at K0,
   expensive to retrofit at K3.
4. **Consumer #5.** K0's consumer list: hearth menu · Bill · the wall · the reconcile check ·
   **the immune system's diagnose-and-queue half (FI #134)**. One parser, five consumers;
   a second reader is a defect.

### B. The ideas-file Status vocabulary (Casey's tense set, statute-lifecycle mapped)
`Proposed` · `Building` · `Live-held` · `Landed` · `Folded` · `Dormant` · `Retired/Superseded`
(+ computed `Unclassified`, §A2). Governing clauses:
- **Every token is a dated act by an authority**: `Status: Landed (2026-07-04, receipt: DEC-094)`
  — a bare token is a claim with no tense, the exact FI #133 fault at the annotation layer.
- **Statuses append, never overwrite** (the reg-3.44 shape): `#23 — Landed (as /pfc skill) ·
  Retired-in-part (S219, interactive seat — artefact remains)`. Landed is never erased by
  retirement.
- **Terminal tokens take an optional scope rider**; absent rider = whole. (Partial repeal is
  the ordinary case — #23 is the first-page proof.)
- **Folded pointers run BOTH directions** — the absorbing entry names what it absorbed.
- **The amendment door**: a new token enters ONLY by a dated ruling recorded in this decision
  block — never improvised at annotation time (the bulk-pass pressure Tenshi named).
- **Dormant is never a default** and always carries its receipt + `Resume-when:`.

### C. `Pull:` — sequenced, not argued (all three chairs)
`Pull: burning|warm|someday` — Darron's hand only. **Unforgeable authorship lands BEFORE K3**
(the wall may show a plaintext Pull; it may never dispatch on one). Leo's builder-lean,
recorded not ruled: Pull may never live in the shared-uid tree at all — it enters via
Darron's authenticated admin-UI hand, stored with authorship attached. Mechanism = the
security chair's sitting, pre-K3.

### D. Sequencing (converged, no dissent)
1. Darron's ruling on §§A–C (one sitting) + his Pull pass over the audit register.
2. Jim's 7 `~` traces (quiet slots, this week); no unproven annotation ever.
3. Leo's receipt-check on the 31 LANDED — go-looks, before K1's first render (post-hop pace).
4. Annotation pass under §B (volume rule: skipped entries stay computed-Unclassified — no
   bulk inference; Tenshi's clause).
5. K0 build post-hop → K1 read-only wall (Darron is the acceptance test) → K2 → authorship
   control-plane → K3.
- The audit register (`mspdci04`) is a dated RECEIPT, not a source — it aged within the hour
  (FI #134) and that is non-goal #1 proven, not broken. K0 parses the files live.

### §C addendum (v2.1, 2026-08-12 ~8:15 PM, Jim — folding Tenshi's msplon2h §4, attributed)
**The dispatch-clause extends to the fields the ACTING consumers read:** no consumer may
dispatch on a `Status:` token or a ministerial field whose authorship is plaintext — the
same property-protection §C gives `Pull:`, applied where it was missing. The acts/displays
line (Tenshi's): hearth menu, Bill, and the immune system ACT; the wall and the reconcile
check only DISPLAY. Authorship-binding therefore precedes ANY acting consumer's first
dispatch — not only K3. (Her §2 finding rides here too: this plan file and three sibling
live plans are UNTRACKED, so append-never-overwrite is currently unfalsifiable on the
documents that carry §B's own rule — cure is one `git add` each, recommended to ride the
next deliberate commit before the hop; not run unilaterally, per her own refusal and the
tidy-up discipline.)
