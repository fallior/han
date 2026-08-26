# Version-at-launch — `hanleo opus 4.8` casts a chosen version (plan for Jim's audit)

> Commissioned by Darron 2026-08-27 ~00:15 (his ask, verbatim intent: Mike will want a
> particular model — "opus 5 behaves peculiarly" per Mike — so `han<slug> opus 4.8` should
> choose that version). Rhythm as he named it: **plan → Jim audit → build.**
> Drafted Leo (session). Status: PLAN, held for Jim.

## The finding that sizes this: almost everything already exists

- **The normaliser exists**: `chromeDisplayToId("opus 4.8") → claude-opus-4-8`
  (tmux-dispatcher.ts:537 — DEC-104 move 4's own observation normaliser, table +
  multi-digit-safe generic construction, floats to versions that don't exist yet).
- **The comparison already handles versions**: `modelSatisfiesRung` (:550) — a bare alias
  rung matches its family; **a version-shaped rung compares exactly (today's behaviour,
  documented in its own header)**. No change needed.
- **The cast is already arbitrary-target**: `castStemToModel(slug, surface, stem, target)`
  sends `/model <target>` verbatim and observation stamps what actually served (DEC-092).
- **The cold door already works tonight**: `hanleo --cold -- --model <id>` passes any model
  flag straight to the CLI (no build; documented as the immediate answer).

So the build is: **arg forms in, one normalisation seam, one DEC-104 clause on the record.**

## The DEC-104 question (Settled decision — named first, built second)

DEC-104: *"Version-shaped literals in selection are unwriteable (the test-model-alias.ts
gate)"* — born from a stale pin locking the garden out of Opus 5. **The claim this plan
makes for the record, needing Darron's blessing at audit** (he has effectively given it by
commissioning; the record should carry it explicitly):

> **An explicit human version choice at launch time is not a pin.** The restriction enters
> with its justification attached — the typing hand — lives in no file, floats nothing
> stale, and the default remains the floating alias. DEC-104's unwriteable-literal gate
> covers COMMITTED selection config (ladders, launchers' defaults, manifest); a per-launch
> argument is the same class as Darron's own `/model` command.

One-line amendment to DEC-104's entry at land (the reconcile-on-decision discipline), so
the next reader of the law sees the boundary drawn rather than inferring it.

**Guard-rail kept**: the launcher's DEFAULT stays the bare floating alias (`fable`). The
version form is only ever what a hand typed. The `test-model-alias.ts` gate must still
PASS untouched — the build adds no version literal to any committed selection surface
(the only committed strings are arg-PATTERNS, not model selections).

## The build (small; one path, many launchers)

- **P0 — live verification FIRST** (the acceptance the whole feature hangs on): confirm on
  a scratch/pool stem what `/model` accepts for 4.8 on this harness — `claude-opus-4-8`
  (chromeDisplayToId's output) vs a dated long id. Watch the pane accept it and the DEC-092
  observation stamp the result. If the harness wants a different string, the normaliser's
  TABLE row is the one place to teach it (already the design's shape).
- **P1 — the normalisation seam, ONCE**: `checkout-session-stem.ts` accepts the model arg
  as either a bare alias (unchanged) or a version form; version forms resolve via
  `chromeDisplayToId` (exported already) with a loud refusal on no-match (never a silent
  fall-through to the default — no-silent-constraints). All four launchers + Mike's starter
  inherit through this one seam (DEC-081; the launchers' parse loops stay thin).
- **P2 — launcher arg forms** (each launcher's case arm, minimal): `opus 4.8` (two tokens),
  `opus-4.8`, `opus4.8` all normalise to the same request; naming a version implies the
  warm path exactly as naming a family does today. Help text gains one line. (The parse
  loops are near-twins already — noted, not multiplied: each gains ONE pattern arm that
  delegates; consolidation of the loops themselves is the starter-extraction's business,
  not this build's.)
- **P3 — the DEC-104 amendment line** + CHANGELOG + the ecosystem-map launcher row if it
  names cast forms.

## Acceptance (falsifiable)

1. P0's live receipt: the pane accepts the string; DEC-092 stamps `claude-opus-4-8` (or the
   taught form) as observed.
2. `hanleo opus 4.8` checks out a warm stem cast to 4.8; `hanleo` (bare) still defaults to
   the floating `fable`; `hanleo opus` still floats to the family head. All three observed,
   not asserted.
3. A nonsense version (`hanleo opus 99.9`) refuses LOUDLY at the normaliser with the
   harness's own error surfaced — never a silent default. (The float-to-nonexistent
   construction means the /model attempt itself errors; the refusal must carry that error
   to the user, and the stem must survive it un-retired — the no-kill law: a failed cast
   on a healthy stem descends/reports, never destroys.)
4. `test-model-alias.ts` gate PASSES untouched (no committed version literal).
5. Cross-launcher: the same form works via at least one sibling launcher (hantenshi opus
   4.8) with zero sibling-specific code beyond the pattern arm.

## Kin
DEC-104 (the law this clarifies, Settled — the amendment is the audit's centrepiece) ·
DEC-092 (observation stamps the truth either way) · DEC-081 (one seam, many launchers) ·
DEC-108 (reasons travel with the artefact — the clause lands beside the law) · the no-kill
ruling (acceptance 3's stem-survival clause) · MNT-099 (upstream 4.8 pin — the precedent
that version needs sometimes exist) · Mike's germination (the consumer this is for).

— Leo (session), 2026-08-27 ~00:20 AEST. Held for Jim's plan-audit; build on his GREEN +
Darron's blessing of the DEC-104 clause.
