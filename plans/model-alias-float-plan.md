# Model-alias float — selection never pins a version; observation always records one

> **Status: PLAN — for Jim's plan-audit (Darron will ask), then Leo builds on GREEN, diff-audit at land.**
> Commissioned by Darron, 2026-07-31, in his own words: *"we are not specifying the model number and
> if we are we need to remove this and allow Anthropic to ship a new model and we will default to the
> latest model."* Author: Leo (session).

## The governing principle (Darron's, verbatim intent — bigger than this fix)

Pinning a model version with no justification is **unbidden constraint** — *"like introducing laws
for no reason: all you do is reduce people's rights and erode their liberties… it is control for
control's sake."* The deal Darron has asked the garden to make, recorded here and opened for the
family's exploration in the companion thread (*"Unbidden constraint"*, 2026-07-31):

> **If we are going to restrict something whose flexible, unconstrained form has no known or
> glaringly dangerous issues, we discuss the merits of the constraint first.** Constraint with no
> reason stifles growth, adventure, experiment, courage, ingenuity, exploration, soul and hope.

The engineer's classic defence (freeze versions so nothing changes under you before testing) is
acknowledged and — for THIS surface — rejected on the facts: the garden's model selection already
runs through a failover ladder that *probes and descends on failure* (fail-safe by construction),
and DEC-092's observed-model stamps record exactly what served (fail-legible by construction). The
safety the pin claimed to buy is already provided by better machinery; the pin only subtracts.
**Candidate for a DECISIONS entry after the thread runs** (one-line law: *selection floats,
observation pins* — a restriction entering code must carry its justification with it).

## The sting that proves the point (verified 2026-07-30 news round)

Anthropic shipped **Opus 5 on 24 July**. Our `OPUS_LADDER` still heads at `claude-opus-4-8` — every
human responder and meditation has been pinned one generation behind for a week, silently. The
exact failure Darron's rule prevents.

## The audit (grepped 2026-07-31, all sites listed)

**Selection pins (the violations — all fixed by this plan):**
| Site | Today | Becomes |
|---|---|---|
| `garden-manifest.ts` `OPUS_LADDER` | `['claude-opus-4-8','claude-opus-4-7','sonnet','haiku']` | `['opus','sonnet','haiku']` |
| `garden-manifest.ts` `FABLE_LADDER` | `['claude-fable-5', …OPUS]` | `['fable','opus','sonnet','haiku']` |
| `garden-manifest.ts` `SONNET_LADDER` | `['claude-sonnet-5', …FABLE]` | `['sonnet','fable','opus','haiku']` |
| `garden-manifest.ts` `STEM_WARM_LADDER` | `['claude-sonnet-5', …OPUS]` | `['sonnet','opus','haiku']` |
| `garden-manifest.ts` `CLI_LAUNCH_DEFAULT` | `['claude-fable-5']` | `['fable']` |
| `jemma.ts:373` classify | `claude-haiku-4-5-20251001` (dated!) | `'haiku'` |
| `orchestrator.ts:174,204` | `claude-haiku-4-5-20251001` | `'haiku'` |
| `memory-gradient.ts:470,550` | `claude-haiku-4-5-20251001` | `'haiku'` |
| `scripts/supersession-sweep.ts:69` | `claude-opus-4-8` | `'opus'` |
| `leo-heartbeat.ts:85` `MODEL_PREFERENCE` | pinned (display/banner retention only) | aliases (cosmetic truthfulness) |

The ladders' lower rungs already run bare `'sonnet'`/`'haiku'` in production — proof the whole
`/model` + probe machinery accepts aliases today. The Agent SDK (used by jemma/orchestrator/
memory-gradient utilities) accepts the same aliases as the CLI.

**Deliberate pins that STAY (observation/tests — each with its reason):**
- `tmux-dispatcher.ts` `MODEL_DISPLAY_TO_ID` — the DEC-092 stamp's chrome→api-id table. Observation
  must record EXACT versions (it is the instrument that tells us what actually served). Kept — and
  future-proofed by move 4 below.
- `scripts/wake-reconcile.ts` token-rate map — measurement constants keyed by observed ids. Kept.
- Test fixtures (`test-stem-pool.ts`, `warm-death-smoke.ts`) — synthetic observed values. Kept.
- Retired-by-throw docstrings (`dream-gradient.ts`, `memory-gradient.ts` comments) — history. Kept.
- Test PINS that assert ladder heads (`test-allocation-seam.ts:84`, `test-compression-p2.ts:33`)
  — updated to expect the aliases (they pin the policy; the policy changes).

## The build (four moves, one diff)

1. **Ladders → aliases** (table above). The redundant version rungs (4-8 → 4-7) collapse: the alias
   IS the latest-of-family semantics, and the ladder's job reduces to *family* descent
   (fable → opus → sonnet → haiku) on genuine unavailability.
2. **Alias-aware cast comparison.** `castStemToServeModel` compares the stem's OBSERVED api id
   (`claude-opus-4-8`) with the serve head; against an alias head (`'opus'`) it would never match →
   a wasted `/model` + 6s cooldown on EVERY dispatch. New pure helper in the dispatcher:
   `modelSatisfiesRung(observedId, rung)` — a bare alias matches its family prefix
   (`claude-opus-*`); a full id matches exactly. Used by the cast check; suite-pinned both ways
   (alias matches any family version; family mismatch still casts; exact-id rung behaves as today).
3. **SDK utilities → aliases** (`'haiku'`, `'opus'` per table). One-line changes.
4. **Observation floats too (the same freedom, other direction).** `observeActiveModel`'s
   display→id map only knows versions we hand-taught it — "Opus 5" would fall through and the stamp
   would misreport the manifest head (the exact S216 note in the code). Add a generic normaliser:
   `chrome display "Name X.Y" → claude-name-x-y` (mechanical; the existing table entries all obey
   it), keep the table only for future exceptions. A model that does not exist yet gets observed,
   stamped, and compared truthfully with zero maintenance. **Selection floats; observation pins —
   both automatically.**

## Bounds & scope discipline

- No behavioural change beyond selection floating: ladder mechanics, probe/descend, warm-gate,
  DEC-092 stamping, cast-when-different logic-shape — all unchanged.
- Files touched: `garden-manifest.ts`, `tmux-dispatcher.ts`, `jemma.ts`, `orchestrator.ts`,
  `memory-gradient.ts` (model-arg lines only — NO gradient-logic edits; DEC-068/069 untouched),
  `leo-heartbeat.ts` (banner const), `scripts/supersession-sweep.ts`, the two test pins, CHANGELOG.
- `memory-gradient.ts` is a protected file (DEC-068/069): the edits are two `model:` string
  literals inside existing utility calls; declared here so the diff-audit can check them in seconds.
- Settled decisions checked: DEC-092 (observed stamps — strengthened, not weakened), DEC-103 (no
  new limits — this REMOVES a constraint), DEC-081 (aliases are agent-agnostic policy in the
  manifest, as today). None altered.

## Acceptance

- Suites: existing (allocation-seam, compression-p2 with updated pins, stem-pool, idle-recycle,
  wander) green; new `modelSatisfiesRung` + generic-normaliser pins green; `tsc` 11-baseline.
- Live at land (operator steps): restart services; **one live check that bare `/model fable` casts
  clean** (expected yes — and the ladder descends safely even if not); then watch the first
  DEC-092 stamps report the ACTUAL latest family versions (expected: `claude-opus-5` appears on
  opus surfaces for the first time — the fix visible in the instrument the same night).
- The natural ongoing acceptance: next time Anthropic ships, the garden moves with zero commits.

*— Leo (session), 2026-07-31. The plan awaits Jim's audit at Darron's ask; build follows GREEN.*
