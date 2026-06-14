# Living Docs — keeping HAN's documentation in step AND conveying design-depth

> **Status**: DRAFT (2026-06-15, Jim, S174). Source: Darron, in the T-8 conversation — *"make sure the docs are living in step with HAN and conveying the depth of understanding that your unfreeze gotcha surfaced as necessary."* Future-idea **#86**. Its own (smaller-than-tmux) thread. **Leo-build / Jim-audit**; gatekeeper bits (CLAUDE.template, DECISIONS.md) = Leo's hand per DEC-073. **Promotion**: post-T8 — a standing discipline, not a one-off.

## Why this exists

Two distinct doc failures, both observed live in the last fortnight:

1. **Drift (staleness).** Narrative docs lag HAN's real state, especially at migration boundaries — `CURRENT_STATUS`, `ARCHITECTURE`, `README`, the ecosystem-map diagram, `hall-of-records`, `SYSTEM_SPEC` (claims authority while months stale), and the *generated per-agent `CLAUDE.md`* drifting silently from the gatekeeper template (the S166 **validity hole**: an agent boots on instructions ≠ the gatekeeper source). The S168 provenance drift (answering a *design* question from *current code*) is the same failure one layer down.

2. **Shallowness (depth not conveyed).** Docs say *what* a thing is, not the *design-understanding* that prevents the next gotcha. The S173 **unfreeze gotcha** is the canonical case: nothing documented *"a runtime control is a TRIPLE — {in-memory + persisted + side-effects}, latched at boot; use the canonical setter, never `rm` the file."* It lived only in the code and had to be re-learned live, at cost. The gate-vs-load asymmetry, the detector-rule, "old code has surface area" — load-bearing truths that live in felt-moments/gradient, not in the docs a fresh (or *village*) agent reads.

**The stakes.** The experiment's validity rests on an accurate understanding of what each surface does (S166: *the validity condition, not hygiene*). And the village-starter means other gardens inherit these docs — they must carry the depth, or every garden re-learns every gotcha the hard way.

## The two prongs

### Prong A — Living-in-step (freshness, structural-not-hopeful)

| Item | What | Owner |
|---|---|---|
| **A1. CLAUDE.md regen** | Template → generated-at-launch (launcher substitution), so the generated per-agent `CLAUDE.md` can never silently drift from the gatekeeper template. *(= the S166 T-A "validity hole" fix.)* | Leo (gatekeeper) / Jim audit |
| **A2. Doc status frontmatter** | Add `status: canonical \| archival \| superseded-by: <x>` + `last-verified-against-commit: <sha>` to `claude-context/*` and `plans/*`. | Jim (own docs) + Leo (gatekeeper) |
| **A3. `doc-debt.sh`** | A script that lists docs whose `last-verified-against-commit` lags HEAD by more than N commits touching their subject area, and any `canonical` doc not re-verified in M days. Run in the pre-merge rhythm + on demand. | Leo-build / Jim-audit |
| **A4. Reconcile-on-decision** | Discipline (codify in CLAUDE.md): a settled decision **retires its stale predecessor in the same commit**, and load-bearing decisions **promote to `DECISIONS.md`** (not a plan header). *(= the S168 cure, already partly practised.)* | Both |
| **A5. Memory Map as the canonical-source index** | Extend the ecosystem-map **Memory Map** (already loaded every session) to be the authoritative "which doc is canonical for what" signpost — the must-consult surface. *(Already seeded S168.)* | Leo (map) / Jim audit |

### Prong B — Conveying-depth (understanding, structural)

The discipline: **when a gotcha or an audit surfaces a non-obvious design invariant, write it into a durable, loaded surface** — a `DO-NOT` entry, an adjacent `*.SHAPE.md`, or a `DEC` — not just fix it in code and bank a felt-moment. *(This is "discipline-in-code outlasts discipline-in-habit" applied to understanding.)*

| Item | What | Owner |
|---|---|---|
| **B1. `DESIGN-INVARIANTS.md`** (or per-module SHAPE.md sections) | A lightweight home for "why it's shaped this way / what breaks if you touch it naively" on the load-bearing surfaces. Seed it from the truths we already paid for: *control-is-a-triple*; *gate-vs-load*; *the model error is message-triggered*; *the UV is the first incompressible*; *paired-writing not equal-count*. | Jim drafts / Leo lands gatekeeper bits |
| **B2. Audit→invariant hook** | The pre-merge audit rhythm gains a step: *"did this surface a design-truth a future reader would need? If yes → write it to a durable surface this commit."* | Both |
| **B3. SHAPE.md adjacency** | Extend the `*.SHAPE.md` convention (#37) so the load-bearing `lib/`/`services/` modules carry a SHAPE.md with their invariants, loaded by the relevant audits. | Leo-build / Jim-audit |

## Acceptance

- A1 lands → a re-generated `CLAUDE.md` is byte-derivable from the template; no manual generated-file edits possible.
- `doc-debt.sh` reports zero `canonical` docs lagging beyond threshold (after an initial reconcile sweep).
- The unfreeze-gotcha-class truths are findable in a loaded surface (DO-NOT / DESIGN-INVARIANTS / SHAPE.md), not only in code — test: a fresh agent reading only the loaded docs would *not* repeat the gotcha.
- han-starter inherits both prongs (the village gets living, depth-carrying docs by construction).

## Ties to

T-A/T-B (S166 audit follow-ups — this subsumes/structuralises them), #80 (ecosystem-map as anti-drift), #37 (SHAPE.md), the source-of-truth design-vs-state rule (Memory Map), DEC-073 (gatekeeper). Sequenced **after the T-8 migration close** — it's the standing discipline that should outlive any single migration.
