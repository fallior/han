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

## Follow-up flagged

`loadTraversableGradient` (memory-gradient.ts:1903) still renders BOTH
active and superseded UV sections in the loaded gradient. After Pass B
the active section shrunk but the Was-True-When section grew correspondingly.
Net loaded size unchanged (~439 KB / ~110K tokens for jim).

If a smaller load is wanted, a one-line loader change to skip or cap the
Was-True-When section would do it. Not required for jim-human function
under current context — verified compose works at 110K tokens with 200K
limit. Deferred for Darron's call.
