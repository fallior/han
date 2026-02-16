# Level 11 Phase F: Test Swarm — Implementation Spec

> Status: Complete

## Context

Phases B-E enhanced research, design, architecture, and build with parallel subagent swarms. The test phase was still a single generic goal. Phase F upgrades it with 6 parallel test subagents matching the ROADMAP's Test Orchestrator vision: unit tests, integration tests, E2E tests, lint/type checks, security audit, and performance tests. Test is NOT a gated phase — it auto-advances to document after completion.

## What Was Built

- **`getTestSubagents(productName, seed, knowledgeSummary)`** — returns 6 focused test prompts:
  - **unit** — unit tests for functions/classes/modules, edge cases, error handling, mocking, coverage targets
  - **integration** — API endpoint tests, database integration, middleware chains, authentication flows, service layer
  - **e2e** — critical user journeys, form submissions, navigation, data persistence, smoke test suite
  - **lint** — linting results, type checking, formatting verification, complexity metrics, naming conventions
  - **security** — OWASP Top 10 checklist, dependency vulnerabilities, secrets detection, input validation, auth review
  - **performance** — response time benchmarks, database query analysis, bundle sizes, memory profiling, load testing
- **`executePhase()` test override** — when `phase === 'test'`, creates 1 parent + 6 child goals with accumulated knowledge context (research + design + architecture + build)
- **`synthesizeTestResults(parentGoalId)`** — builds Test Report markdown from accumulated test knowledge entries grouped by category. Stored as knowledge entry with `category = 'test_report'`.
- **Synthesis routing update** — `updateParentGoalProgress()` now routes `test` phase to `synthesizeTestResults()`
- **`GET /api/products/:id/test`** — test phase status with subagent progress, knowledge count, and preview

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Test subagents receive full accumulated knowledge (research + design + architecture + build) for comprehensive quality verification
- Each prompt includes specific deliverables so subagents produce structured, actionable findings with [KNOWLEDGE] markers
- Test Report stored as knowledge entry (category `test_report`) — consistent with Research Brief, Design Package, Architecture Specification, and Build Report pattern
- All 6 test areas are parallelised — each subagent gets full context for independent verification
- Test is NOT gated — auto-advances to document phase after completion (matching PIPELINE constants)
- Removed `test` from the fallback single-goal descriptions in `executePhase()` since it now has its own swarm

## Verification

1. Test phase auto-starts after build completes → verify 1 parent + 6 child goals created
2. `GET /api/products/:id/test` — verify 6 subagents listed
3. When children complete → verify knowledge entries with `source_phase = 'test'`
4. When all 6 complete → verify Test Report synthesized, document phase auto-advances (not gated)
5. `node -c src/server/server.js` passes

## Drift Notes

None.
