# Level 11 Phase B: Research Swarm — Implementation Spec

> Status: Complete

## Context

Phase A built the product pipeline skeleton (7 phases, gates, knowledge graph, API). The research phase was a single generic goal. Phase B upgrades it into a parallel subagent swarm: 6 focused research child goals orchestrated under a parent goal, with structured knowledge extraction, round-robin task interleaving, and a synthesised Research Brief.

## What Was Built

- **Parent-child goal relationship** — `parent_goal_id TEXT` + `goal_type TEXT` columns added to `goals` table via migration. Values: `standalone` (default), `parent`, `child`.
- **`createGoal()` update** — accepts optional `parentGoalId` and `goalType` params. Parent goals skip task decomposition and start in `active` status. Child goals link back to parent and decompose normally.
- **`getResearchSubagents(productName, seed)`** — returns 6 focused research area prompts:
  - **market** — market size, target audience, revenue model, go-to-market
  - **technical** — APIs, libraries, infrastructure, risks, time estimates
  - **competitive** — competitors, feature gaps, pricing, positioning
  - **practices** — design patterns, reference implementations, security, testing
  - **regulatory** — legal, privacy laws, compliance, accessibility
  - **ux** — UI patterns, design inspiration, interaction flows, onboarding
- **`executePhase()` research override** — when `phase === 'research'`, creates 1 parent goal + 6 child goals instead of 1 generic goal. Other phases unchanged.
- **`updateGoalProgress()` rework** — parent goals skip direct update. Child goals: on completion, extract knowledge then roll up to parent via `updateParentGoalProgress()`. Standalone goals: check pipeline phase as before.
- **`updateParentGoalProgress(parentGoalId)`** — aggregates child statuses. When all children complete: synthesise findings, generate summary, trigger `advancePipeline()`.
- **`extractResearchKnowledge(childGoalId, parentGoalId)`** — parses `[KNOWLEDGE category="..." title="..."]...[/KNOWLEDGE]` markers from task results and goal summary files. Fallback: stores goal area + summary as single knowledge entry.
- **`synthesizeResearchFindings(parentGoalId)`** — builds markdown Research Brief from accumulated knowledge entries, grouped by category. Includes execution summary with per-subagent stats and costs. Stored as `research_brief` knowledge entry.
- **Round-robin task interleaving** — `getNextPendingTask()` detects child-goal tasks, groups by parent, rotates across children for fair CPU time. In-memory `lastExecutedChildGoal` Map tracks rotation.
- **Research status API** — `GET /api/products/:id/research` returns parent goal status, 6 subagent objects (area, status, task progress, cost), knowledge count + preview.
- **`goalStmts.getChildren`** — new prepared statement for querying child goals by parent.

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Parent goals have no tasks of their own — they exist purely to track child goals
- `goal_type` defaults to `'standalone'` for backwards compatibility (existing goals unaffected)
- Round-robin is "soft" — it only applies when multiple child goals have ready tasks simultaneously
- Knowledge extraction uses `[KNOWLEDGE]` marker format but falls back to storing raw goal summary if no markers found
- Research Brief is stored as a knowledge entry (category `research_brief`) rather than a separate table — reuses existing infrastructure
- Child goal completion triggers knowledge extraction immediately (not batched)

## Verification

1. `POST /api/products` with seed — verify 1 parent + 6 child goals created
2. `GET /api/products/:id/research` — verify 6 subagents listed with status
3. Wait for task execution — verify round-robin interleaving in logs
4. When a child goal completes — verify knowledge entries in `product_knowledge`
5. When all 6 children complete — verify parent done, Research Brief stored, `advancePipeline()` called
6. Verify design phase gate: `pipeline_gate_pending` broadcast after research completes
7. `node -c src/server/server.js` passes

## Drift Notes

None.
