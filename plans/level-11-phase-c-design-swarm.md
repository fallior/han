# Level 11 Phase C: Design Artifact Swarm — Implementation Spec

> Status: Complete

## Context

Phase B enhanced the research phase with 6 parallel subagents. The design phase was still a single generic goal. Phase C upgrades it into a parallel subagent swarm producing structured design artifacts, and generalizes Phase B's knowledge extraction so it works for any swarm phase.

## What Was Built

- **Generalized `extractChildGoalKnowledge()`** — renamed from `extractResearchKnowledge()`. Now determines `source_phase` dynamically from the parent's `product_phases` record instead of hardcoding `'research'`. Works for any swarm phase.
- **Phase-aware synthesis routing** — `updateParentGoalProgress()` now looks up which pipeline phase the parent belongs to and routes to the correct synthesis function: `research` → `synthesizeResearchFindings()`, `design` → `synthesizeDesignArtifacts()`.
- **`getDesignSubagents(productName, seed, knowledgeSummary)`** — returns 6 focused design artifact prompts:
  - **requirements** — user stories, acceptance criteria, functional + non-functional requirements, edge cases, priority classification
  - **datamodel** — entity-relationship design, database schema, validation rules, migration plan, storage projections
  - **api** — REST endpoint listing, request/response schemas, auth model, error format, rate limiting, versioning
  - **ux** — page inventory, wireframe descriptions, component hierarchy, navigation, responsive strategy, design system
  - **interactions** — user flow diagrams (Mermaid), state management, form flows, loading/empty/error states, real-time patterns
  - **accessibility** — WCAG 2.1 AA checklist, keyboard navigation map, ARIA annotations, contrast plan, touch targets
- **`executePhase()` design override** — when `phase === 'design'`, creates 1 parent + 6 child goals with research knowledge context. Same pattern as research swarm.
- **`synthesizeDesignArtifacts(parentGoalId)`** — builds Design Package markdown from accumulated design knowledge entries grouped by category. Stored as knowledge entry with `category = 'design_package'`.
- **`GET /api/products/:id/design`** — design phase status with subagent progress, knowledge count, and preview.

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Generalized extraction function works for all swarm phases (not just research/design) — future phases automatically benefit
- Design subagents receive accumulated research knowledge via `getKnowledgeSummary()` for full context
- Design Package stored as knowledge entry (category `design_package`) — consistent with Research Brief pattern
- Synthesis routing is explicit (if/else on phase name) rather than dynamic dispatch — simpler, easier to debug
- Each design prompt includes specific deliverables so subagents produce structured, actionable output

## Verification

1. Verify research swarm still works (no regression from extraction rename)
2. `POST /api/products` → research completes → design gates → approve → verify 1 parent + 6 child design goals
3. `GET /api/products/:id/design` — verify 6 subagents listed
4. When design children complete → verify knowledge entries with `source_phase = 'design'`
5. When all 6 complete → verify Design Package synthesized, architecture phase gates
6. `node -c src/server/server.js` passes

## Drift Notes

None.
