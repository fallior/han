# Level 11 Phase A: Product Pipeline Framework — Implementation Spec

> Status: Complete

## Context

Level 11 is "Autonomous Product Factory" — the final ROADMAP level. You describe a seed idea, and the system researches, designs, architects, builds, tests, documents, and deploys. Phase A lays the pipeline framework: the `products` table, pipeline phase controller, human gate integration, knowledge graph tables, and API endpoints. Everything else builds on this skeleton.

## What Was Built

- **`products` table** — stores product pipelines with seed description, current phase, status, knowledge, cost tracking
- **`product_phases` table** — tracks each phase's state, artifacts, cost, gate status (7 phases per product)
- **`product_knowledge` table** — knowledge graph entries by category (research, design, architecture, build, test, document, deploy)
- **Pipeline constants** — `PIPELINE_PHASES` (7 ordered phases), `GATED_PHASES` (design, architecture, build, deploy require approval)
- **`createProduct(name, seed, config)`** — creates product record, 7 phase records, project directory with CLAUDE.md/README.md, registers in portfolio, kicks off research phase
- **`getKnowledgeSummary(productId)`** — aggregates knowledge entries into text summary (capped at 2000 chars) for context injection into subsequent phases
- **`executePhase(productId, phase)`** — builds phase-specific goal description with accumulated knowledge, calls `createGoal()`, updates phase/product records, broadcasts `pipeline_phase_started`
- **`advancePipeline(productId, completedPhase, goalResult)`** — marks phase completed, extracts knowledge, finds next phase. If gated: sets `gate_status = 'pending'`, broadcasts `pipeline_gate_pending`, sends ntfy push. If not gated: auto-advances. If final phase: marks product completed, sends push.
- **Pipeline wiring** — `updateGoalProgress()` checks if completed goals belong to product phases and calls `advancePipeline()`
- **API endpoints** (8 total):
  - `POST /api/products` — create product pipeline
  - `GET /api/products` — list all products
  - `GET /api/products/:id` — get product with phases and knowledge
  - `DELETE /api/products/:id` — cancel product
  - `POST /api/products/:id/phases/:phase/approve` — approve gate, advance pipeline
  - `POST /api/products/:id/phases/:phase/reject` — reject gate, re-run previous phase
  - `GET /api/products/:id/knowledge` — list knowledge entries (optional `?category=` filter)
  - `POST /api/products/:id/knowledge` — manually add knowledge entry

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Pipeline phases are fixed at 7: research → design → architecture → build → test → document → deploy
- Gated phases (design, architecture, build, deploy) require human approval via push notification + API call; research, test, and document auto-advance
- Rejection re-runs the previous phase (not the rejected phase itself) to generate new input
- Project directory created at `~/Projects/{safe-name}` with basic CLAUDE.md and README.md
- Product automatically registered in portfolio for cost tracking
- Knowledge accumulation: each completed phase stores a summary entry, subsequent phases receive it as context
- Knowledge summary capped at 2000 chars to avoid excessive prompt inflation
- Pipeline advancement wired into existing `updateGoalProgress()` — no separate scheduler needed

## Post-build

- [ ] Restart server: `kill $(cat ~/.claude-remote/server.pid) && node src/server/server.js &`

## Verification

1. `POST /api/products` with `{"name": "Test Product", "seed": "A simple CLI tool"}` — verify product created, 7 phases initialised, research goal spawned
2. `GET /api/products` — verify product listed
3. `GET /api/products/:id` — verify full pipeline state with phases and knowledge
4. Verify `pipeline_phase_started` WebSocket broadcast
5. When research completes → verify gate check: design phase should be gated, `pipeline_gate_pending` broadcast
6. `POST /api/products/:id/phases/design/approve` — verify design phase starts
7. `GET /api/products/:id/knowledge` — verify knowledge entries stored
8. `POST /api/products/:id/knowledge` with manual entry — verify stored

## Drift Notes

None.
