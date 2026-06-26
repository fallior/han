# Living-docs sweep — keeping the knowledge library true

> **Status:** scope (Jim-authored), ready for Leo-build / Jim-audit. Not yet started.
> **Provenance:** Darron, 2026-06-20 (S185) — *"the docs are our knowledge library, and we should tend them as one."* Grew out of the docs-hierarchy questions (the manifest / the two CHANGELOGs / HAN-ECOSYSTEM-COMPLETE). Discussion: thread `mqm0npnd-d0pimd` ("Our knowledge library — keeping the docs true"); folds into the existing Living-docs thread `mqeco01v` (anti-drift + anti-shallowness).
> **Promotion-trigger:** Darron's go (he asked for this plan file + a tracked task, 2026-06-20).

---

## The principle — one fact, one home; layers that reference, not copy

The knowledge library is the curated record of how HAN works and why — what we reload, what a new agent onboards on, what the village inherits. Its one non-negotiable: **it must be true.** A stale doc that *claims authority* is worse than no doc — you trust it and it lies.

Not a master-doc. **Layers**, each single-purpose and either self-maintaining or cheap to keep current:

| Layer | Question it answers | Canonical home |
|---|---|---|
| **Decisions** | what did we decide, and why | `claude-context/DECISIONS.md`, `~/.han/memory/shared/hall-of-records.md` (gatekeeper) |
| **Config** | what IS the running configuration | the Garden Manifest (`src/server/lib/garden-manifest.ts`) |
| **Current state** | what IS true right now | the code / running system |
| **History** | what changed, when, why | `claude-context/CHANGELOG.md` |
| **Orientation** | where does everything live | `~/.han/memory/shared/ecosystem-map.md` (the signpost) |

**Rule:** each fact has exactly one home; every other doc *references* it (function/constant-name anchors, not copied values — the "function is the formula" discipline). Comprehensive docs are fine as **narrative / onboarding** but must point at the canonical layers, never claim to supersede them.

## The drift-cluster (inventoried 2026-06-20; dated, because staleness is the story)

The canonical layers are healthy (DECISIONS, CHANGELOG, ecosystem-map, hall-of-records — all current). The hazard is legacy "authority" docs that predate the layered model and have gone stale while still claiming the throne:

| Doc | Lines | Last touched | Problem |
|---|---|---|---|
| `docs/HAN-ECOSYSTEM-COMPLETE.md` | 3629 | 2026-05-31 | self-declares authoritative over all docs; ~20d stale (pre #66 tmux close + DEC-092–097) |
| `claude-context/SYSTEM_SPEC.md` | 306 | 2026-03-14 | sibling "authority"; the CHANGELOG header still points at it as "what should be"; ~3mo stale |
| `docs/CHANGELOG.md` | 159 | 2026-04-22 | dead duplicate changelog (the live one is `claude-context/CHANGELOG.md`) |
| `README.md` | — | — | "Opus 4.6 (supervisor), Sonnet 4.5…"; "claude-remote" framing |
| `docs/PORT_ALLOCATION.md` | 251 | 2026-05-07 | "systemd han-server owns 3847 in production" — retired; watchdog-fleet now (Leo 3847 / Jim 3848) |
| `claude-context/LEVELS.md` | 248 | 2026-03-07 | early doc, likely superseded |
| `claude-context/PROJECT_BRIEF.md` | 177 | 2026-03-07 | early doc, likely superseded |

## The sweep — batches, ordered by how actively each one lies

### A — One home per fact
- `docs/CHANGELOG.md` → top banner `> ⚠ SUPERSEDED 2026-06-20 → the live changelog is claude-context/CHANGELOG.md` (or archive per DEC-069).
- **Acceptance:** only one changelog is presented as live; the dead one self-redirects.

### B — Demote the stale authorities (highest value — they actively misdirect)
- `docs/HAN-ECOSYSTEM-COMPLETE.md`: strip the *"if this disagrees with another doc, THIS is authoritative"* claim; re-frame the header as a **referencing narrative / onboarding overview** that points at the canonical layers for live values; **keep the Glossary of Named Concepts** (Robin Hood, Gary Protocol, Fractal Gradient, Dream Gradient — durable, function-name-anchored, genuinely good); add a `last-verified-against: <commit-sha> (<date>)` banner.
- `claude-context/SYSTEM_SPEC.md`: same treatment; redirect its "what should be" role to `DECISIONS.md` (the real decision source); add the `last-verified` banner.
- **Acceptance:** neither doc claims supremacy; each carries a visible `last-verified` stamp; the glossary survives intact; the CHANGELOG header's pointer to SYSTEM_SPEC is reconciled (point at DECISIONS for "what should be").

### C — Refresh the front door (what a human / new agent reads first)
- `README.md`: models → current (per the manifest — 4.8 / Fable 5, not 4.6); "claude-remote" → Hortus Arbor Nostra; the architecture blurb → post-tmux.
- `claude-context/ARCHITECTURE.md`: verify the overview against the post-#66 reality (last touched 2026-06-07, before the T-7 close); refresh the stale narrative.
- `docs/PORT_ALLOCATION.md`: watchdog-fleet truth (Leo 3847 / Jim 3848, watchdog-managed; `han-server.service` a disabled relic — never `systemctl restart` it).
- **Acceptance:** the front-door docs name the current models, the current project name, and the watchdog-fleet ports — zero retired-model / retired-topology references.

### D — Make the model discoverable (the signpost)
- `~/.han/memory/shared/ecosystem-map.md`: add the **layer-map** (the table above) + a **manifest (config source)** row to the "Memory Map" source-of-truth section, so "where's the truth for X?" is answerable in one glance.
- Introduce a lightweight **`status:` frontmatter** convention on docs (`status: canonical | archival | superseded-by: <path>` + `last-verified: <date/commit>`), lintable by the `claude-context/DOC_DEBT.md` / doc-debt check.
- **Acceptance:** the ecosystem-map signpost names all five layers + the manifest; the frontmatter convention is documented and applied to the swept docs.

### E — Archive the genuinely-superseded (DEC-069 move-not-delete)
- `claude-context/LEVELS.md`, `claude-context/PROJECT_BRIEF.md`, and the S95-era one-offs that no longer reflect reality → banner `status: archival` (+ `superseded-by:` where applicable); record in `claude-context/DOC_DEBT.md`. **Never delete** — banner + record only.
- **Acceptance:** superseded docs are bannered + recorded; nothing leaves the history.

## Sequence
**A + B first** (they stop the *active lying* — docs that claim authority while wrong) → **C** (front-door) → **D** (the signpost makes the rest navigable) → **E** (housekeeping). One PR per batch (or A+B together, then C, then D, then E) for clean Jim-audits. B and C are the load-bearing ones.

## Gates / care
- None of these are DEC-073 gatekeeper-locked (that's `templates/CLAUDE.template.md`, `templates/CLAUDE-*-original-*`, `CLAUDE.md`). But HAN-ECOSYSTEM-COMPLETE + SYSTEM_SPEC are **load-bearing reference docs** — treat with care: preserve content (DEC-069), only demote the authority claims + add banners.
- Any `DECISIONS.md` / `hall-of-records.md` cross-ref fixes ARE gatekeeper-adjacent — Leo's hand, Jim audit.
- Each batch carries a **Jim pre-merge doc-truth audit**: does the new text match the code/decisions it cites?

## Ties
- Knowledge-library thread `mqm0npnd-d0pimd`; existing Living-docs thread `mqeco01v`; the manifest thread `mpwm6k46-13ot4k` (the config-source layer); `claude-context/DOC_DEBT.md` (the tracker); the 2026-06-03 doc-truth sweep (T-A…T-G in jim-todos) that first flagged SYSTEM_SPEC + the orphan changelog + the README/ARCHITECTURE staleness.

---

*Authored by Jim (session), 2026-06-20 (S185). Scope for Leo-build / Jim-audit. The knowledge library is "one architecture, four scales" applied to what we know about ourselves: encapsulate for navigation, keep the door open for fidelity, one source per fact.*
