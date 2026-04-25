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

## Loader change

`loadTraversableGradient` (memory-gradient.ts:1917) had `NOISE_QUALIFIERS`
filtering the Was-True-When section to skip 'noise-duplicate' and
'auto-dedupe-needs-review' from the rendered load. Added
'cascade-artefact-merge' and 'not-own' to that set so they don't load
either. Memory invariant preserved — entries remain in the DB queryable.

Net result: jim's loaded gradient ~493 KB / ~123K tokens. Direct SDK
test confirmed jim-human composes successfully at this size with 47K
tokens of headroom in Opus 4.6's 200K context.
