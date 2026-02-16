# Level 10 Phase C: Learning + Decisions Capture — Implementation Spec

> Status: Complete

## Context

The automator reads ecosystem context (Phase A) and generates documentation (Phase B), but knowledge flows one way. When automated tasks solve problems or make architectural choices, that knowledge is trapped in task logs. Phase C closes the loop: agents flag insights using structured markers, the server parses them into a review queue, and on human approval they're written to official learnings/decisions files.

## What Was Built

- **Context injection update** — agents instructed to output `[LEARNING]...[/LEARNING]` and `[DECISION]...[/DECISION]` markers for genuinely reusable insights
- **Marker parsers** — `parseMarkerFields()`, `extractProposedLearnings()`, `extractProposedDecisions()` extract structured data from result text
- **Proposals table** — `task_proposals` in SQLite with status lifecycle: pending → approved/rejected
- **Post-task extraction** — `extractAndStoreProposals()` scans successful task results, stores proposals
- **Review API** — `GET /api/proposals`, `POST /api/proposals/:id/approve`, `POST /api/proposals/:id/reject`
- **Approval handlers** — `writeLearning()` creates file in `~/Projects/_learnings/` + updates INDEX.md, `writeDecision()` appends to DECISIONS.md with next DEC number
- **WebSocket broadcast** — `proposals_new` message when proposals are extracted

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |
| `~/Projects/_learnings/INDEX.md` | Target for approved learnings |
| `claude-context/DECISIONS.md` | Target for approved decisions |

## Verification

1. Submit task that solves a problem — check for `[LEARNING]` markers in result
2. `GET /api/proposals` — verify extracted proposals appear with `pending` status
3. `POST /api/proposals/:id/approve` for learning — verify file + INDEX.md updated
4. `POST /api/proposals/:id/approve` for decision — verify DECISIONS.md entry added
5. `POST /api/proposals/:id/reject` — verify status changes

## Drift Notes

None.
