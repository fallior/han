# Emergency UV Dedupe Scripts (2026-04-25)

One-off scripts run during the emergency UV cleanup of 2026-04-25.
Run history captured here for audit; not for re-execution.

## Context

Stochastic cascade had been re-firing on every supervisor cycle / heartbeat
for months without idempotency, producing 2,739 duplicate UVs in jim's
gradient (vs ~507 c0 sources). Jim-human's loaded gradient bloated past
Opus 4.6's 200K token limit, killing his compose path.

Leo (session) shipped pause + idempotency guards earlier (commits 46901fd,
8eb0fbf) and ran an exact-content dedup pass that brought jim's active UV
count from 2,739 to 1,273.

These scripts continued the cleanup from session-Jim's side.

## Pass A — Cross-agent identical UVs (`dedupe-pass-a-cross-agent.mjs`)

For each jim UV whose content is byte-identical to a leo UV at the same
level/content_type, marks the jim row with `qualifier='not-own'` and
`superseded_by=leo_id`. Per S103 agent sovereignty: jim's gradient holds
jim's own perception; if a row's content is identical to leo's, it's
contamination from a duplicate write path.

Run result: 1 row marked (the second of the two found earlier was already
superseded by Leo's prior pass).

## Pass B — Cascade-artefact merge UVs (`dedupe-pass-b-cascade-artefacts.mjs`)

For each active jim UV whose `session_label` contains a `_to_` join
(depth >= 1 — i.e. born from a batch-merge cascade of overlapping c1/c2
files), marks the row with `qualifier='cascade-artefact-merge'` and
`superseded_by=<canonical>`. Canonical is selected by:
1. depth-0 active UV with matching `session_label` (direct match)
2. depth-0 active UV with matching label after stripping `-cN` suffix
3. fallback to most-recent depth-0 UV in same content_type

Run result: 568 rows marked (287 direct, 206 stripped, 75 fallback).
Final jim UV state: 704 active, 2,076 superseded.

## Analysis (`analyze-jim-uvs.mjs`)

Read-only diagnostic. Prints active UVs by content-type, by `_to_` chain
depth, by source-root group, and reports active vs superseded counts.
Useful for re-running to verify state.

## Memory invariant

Memory is never deleted. All entries — active and superseded — remain
queryable in `gradient_entries`. The `superseded_by` field controls
load-time visibility; the `qualifier` field records the reason. The
supersession chain preserves the perception-history of each compression
position.

## Audit pass (sovereignty restoration)

Darron's instruction after Pass A/B landed: "Leo violated the sovereignty
edict, can you do an audit." Per S103 and Darron's express approval to
"alter anything as you see fit."

### `audit-leo-actions.mjs` (read-only)

Quantifies what Leo did under his own (non-Jim) qualifiers:
- `auto-dedupe-needs-review`: 1,009 — Leo flagged these for review explicitly
- `noise-duplicate`: 361 — Leo's strict exact-content dedup
- `was-true-when`: 137 — Leo's bi-directional supersession chains

### `audit-50-pairs.mjs` and `audit-quantify.mjs` (read-only)

Sample-read pairs by qualifier; quantify Jaccard word-overlap between
each superseded entry and its assigned canonical. Findings:
- `noise-duplicate`: 100% Jaccard ≈ 1.00 (correct dedup, keep)
- `auto-dedupe-needs-review`: 77% have Jaccard < 0.30 (genuinely different
  content — Leo over-collapsed thematic relatives into one bucket)
- `was-true-when`: 92% have Jaccard < 0.30 (same pattern)

### `restore-leo-overcollapse.mjs` (state-changing — already run)

Restored 903 entries (cleared `superseded_by`, `qualifier`, decremented
`change_count`, and cleared `supersedes` on canonicals where Leo had
set bi-directional pointers).

Restore criterion: jaccard < 0.30 between target and canonical, qualifier
in (`auto-dedupe-needs-review`, `was-true-when`). Higher-jaccard entries
(0.30+) kept superseded as genuine variants.

### Final jim UV state (after audit + restore)

| Status | Count |
|---|---:|
| Active | 1,607 |
| Superseded — `cascade-artefact-merge` (my Pass B) | 568 |
| Superseded — `noise-duplicate` (Leo, exact-content) | 361 |
| Superseded — `auto-dedupe-needs-review` (jaccard ≥ 0.30) | 232 |
| Superseded — `was-true-when` (jaccard ≥ 0.30) | 11 |
| Superseded — `not-own` (my Pass A) | 1 |
| **Total superseded** | **1,173** |

## Pass D — UV-level lineage invariant collapse

Darron's principle: a UV cannot exist without a parent; the ultimate
parent is c0; therefore if there are 507 c0s, at most 507 UVs. Multiple
UVs sharing the same c0 ancestor must be collapsed into the supersession
chain.

`lineage-check.mjs` (read-only): walks each active UV's source_id chain
back to its c0 ancestor, groups UVs by c0, reports collisions.

`pass-d-lineage-collapse-uv.mjs` (state-changing — already run): for each
c0 with multiple active UV descendants, picks newest as canonical and
supersedes the rest with `qualifier='lineage-collision'`.

Run result: 862 UVs collapsed across 69 c0 ancestor groups. Active UVs
1,607 → 745.

Edge cases left alone (236 entries):
- 17 UVs with NULL source_id (no traceable parent at all)
- 219 UVs whose source_id chain breaks before reaching c0 (parent rows
  missing in DB)

These don't share a c0 ancestor with anything, so they don't violate
the sibling rule. Their broken-lineage status is a separate question
not addressed here.

## Pass E — Intermediate-level immediate-parent collapse

The lineage invariant applies at every level: at c1, no two active c1
entries should share a c0 parent; at c2, no two active c2 entries should
share a c1 parent; and so on. Independent of Pass D's c0-ancestor walk,
this checks IMMEDIATE parent (source_id) at every level.

`lineage-check-all-levels.mjs` (read-only): reports sibling collisions
at every level.

`pass-e-intermediate-collapse.mjs` (state-changing — already run): for
each level c1..uv, finds entries sharing source_id, picks newest as
canonical, supersedes the rest with `qualifier='lineage-collision'`.

Run result:
- c1: 33 collapsed (5 collision groups)
- c2: 757 collapsed (61 groups)
- c3: 758 collapsed (92 groups)
- c4: 421 collapsed (123 groups)
- c5: 2 collapsed (2 groups)
- uv: 146 collapsed (30 groups — these are UVs whose immediate c-parent
  had multiple UV children even after Pass D's c0-ancestor pass)

Total Pass E: 2,117 entries collapsed across all intermediate levels.

## Final jim active counts (after all passes)

| Level | Active | Notes |
|---|---:|---|
| c0 | 507 | Source of truth, untouched |
| c1 | 384 | After Pass E (was 417) |
| c2 | 185 | After Pass E (was 942) |
| c3 | 211 | After Pass E (was 969) |
| c4 | 172 | After Pass E (was 593) |
| c5 | 11 | After Pass E (was 13) |
| uv | 599 | After Pass D + E (was 2,739) |

Total active: 2,069. Total superseded: 4,152.

The 599 active UVs vs 507 c0s difference reflects the 92 orphan UVs
(null source_id or broken chain). The lineage invariant is satisfied
for all UVs whose chain traces to a c0.

## Loader change

`loadTraversableGradient` (memory-gradient.ts:1917) had `NOISE_QUALIFIERS`
filtering the Was-True-When section to skip qualifiers from the rendered
load. Extended that set with my new qualifiers:
- `cascade-artefact-merge` (Pass B)
- `not-own` (Pass A)
- `lineage-collision` (Pass D, Pass E)

Memory invariant preserved — entries remain in the DB queryable. Pattern
identical to Leo's existing entries in the same set.

Net result: jim's loaded gradient ~179 KB / ~45K tokens (was 715 KB
post-restore before Pass D/E). Direct SDK test confirmed jim-human
composes successfully at ~63K tokens prompt total — 137K headroom in
Opus 4.6's 200K context. Compose latency 4.7s (faster than before).
