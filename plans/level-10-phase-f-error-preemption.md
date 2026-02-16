# Level 10 Phase F: Error Pattern Pre-emption — Implementation Spec

> Status: Complete

## Context

The automator records failed task outcomes in `project_memory` (including `error_summary`) and `analyseFailure()` decides on retry strategy. But this knowledge is ephemeral — when a new task runs on the same project, the agent has no awareness of past failures. Phase F closes this gap: recent failure patterns are queried, deduplicated, and injected into task context as "Known Pitfalls" so agents avoid repeating the same mistakes.

## What Was Built

- **`getRecentFailures(projectPath)`** — Queries `project_memory` for failed outcomes from the last 30 days, deduplicates by normalised error pattern (strips hashes and numbers), returns top 5 by frequency with model and recency data
- **Context injection** — "Known Pitfalls (Recent Failures)" section added to `buildTaskContext()` after learnings and before ecosystem, warning agents about past errors with occurrence count and last-seen date
- **Error patterns API** — `GET /api/errors/:project` returns categorised error patterns, total failure count, and failure rate for a project
- **Failure learnings extraction** — `extractAndStoreProposals()` now called on failed tasks too (previously success-only), with `resultText` hoisted to function scope for catch block access

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Error deduplication uses normalised first 100 chars (lowercase, hex hashes → `...`, numbers → `N`) for pattern matching
- Pitfalls capped at 5 patterns to avoid context bloat
- 30-day rolling window prevents stale errors from cluttering context
- Inline `db.prepare()` for infrequent queries rather than adding prepared statements

## Verification

1. `GET /api/errors/:project` — verify error patterns returned for a project with failed tasks
2. Submit a task that fails → verify "Known Pitfalls" appears in next task's injected context
3. Check that `extractAndStoreProposals()` is called for both success and failure paths
4. Verify context injection stays within reasonable token limits

## Drift Notes

None.
