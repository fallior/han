# Plans Index

> Implementation specs and retrospective plans for each level of Claude Remote.

## Plan Types

- **Retrospective** — Documents what was built. Written after the fact for Levels 1-6.
- **Implementation Spec** — Actionable build specs. Written before or during implementation for Levels 7+. Suitable for the task automator.

## All Plans

| Level | Name | Type | Status | File |
|-------|------|------|--------|------|
| 1 | Prompt Responder (MVP) | Retrospective | Complete | [level-01-prompt-responder.md](level-01-prompt-responder.md) |
| 2 | Push Alerts | Retrospective | Complete | [level-02-push-alerts.md](level-02-push-alerts.md) |
| 3 | Context Window | Retrospective | Complete | [level-03-context-window.md](level-03-context-window.md) |
| 4 | Terminal Mirror | Retrospective | Complete | [level-04-terminal-mirror.md](level-04-terminal-mirror.md) |
| 5 | Mobile Keyboard | Retrospective | Complete | [level-05-mobile-keyboard.md](level-05-mobile-keyboard.md) |
| 6 | Claude Bridge | Retrospective | Complete | [level-06-claude-bridge.md](level-06-claude-bridge.md) |
| 7 | Autonomous Task Runner | Implementation Spec | Complete | [level-07-autonomous-task-runner.md](level-07-autonomous-task-runner.md) |
| 8 | Intelligent Orchestrator | Implementation Spec | Complete | [level-08-intelligent-orchestrator.md](level-08-intelligent-orchestrator.md) |
| 9.1 | Portfolio Manager & Project Registry | Implementation Spec | Complete | [level-09-phase-1-portfolio-registry.md](level-09-phase-1-portfolio-registry.md) |
| 9.2 | Cost Budgets + Priority Engine | Implementation Spec | Complete | [level-09-phases-2-5-remainder.md](level-09-phases-2-5-remainder.md) |
| 9.3 | Daily Digest | Implementation Spec | Complete | [level-09-phase-3-daily-digest.md](level-09-phase-3-daily-digest.md) |
| 9.4 | Nightly Maintenance Automation | Implementation Spec | Complete | [level-09-phase-4-nightly-maintenance.md](level-09-phase-4-nightly-maintenance.md) |
| 9.5 | Weekly Progress Reports | Implementation Spec | Complete | [level-09-phase-5-weekly-reports.md](level-09-phase-5-weekly-reports.md) |
| 10.A | Context Injection (Ecosystem-Aware Automator) | Implementation Spec | Complete | [level-10-phase-a-context-injection.md](level-10-phase-a-context-injection.md) |
| 10.B | Protocol Compliance | Implementation Spec | Complete | [level-10-phase-b-protocol-compliance.md](level-10-phase-b-protocol-compliance.md) |
| 10.C | Learning + Decisions Capture | Implementation Spec | Complete | [level-10-phase-c-learning-decisions.md](level-10-phase-c-learning-decisions.md) |
| 10.D | Community Awareness | Implementation Spec | Complete | [level-10-phase-d-community-awareness.md](level-10-phase-d-community-awareness.md) |
| 10.E | Feedback Loop | Implementation Spec | Complete | [level-10-phase-e-feedback-loop.md](level-10-phase-e-feedback-loop.md) |
| 10.F | Error Pattern Pre-emption | Implementation Spec | Complete | [level-10-phase-f-error-preemption.md](level-10-phase-f-error-preemption.md) |
| 11.A | Product Pipeline Framework | Implementation Spec | Complete | [level-11-phase-a-pipeline-framework.md](level-11-phase-a-pipeline-framework.md) |
| 11.B | Research Swarm | Implementation Spec | Complete | [level-11-phase-b-research-swarm.md](level-11-phase-b-research-swarm.md) |
| 11.C | Design Artifact Swarm | Implementation Spec | Complete | [level-11-phase-c-design-swarm.md](level-11-phase-c-design-swarm.md) |
| 11.D | Architecture Swarm | Implementation Spec | Complete | [level-11-phase-d-architecture-swarm.md](level-11-phase-d-architecture-swarm.md) |
| 11.E | Build Swarm | Implementation Spec | Complete | [level-11-phase-e-build-swarm.md](level-11-phase-e-build-swarm.md) |
| 11.F | Test Swarm | Implementation Spec | Complete | [level-11-phase-f-test-swarm.md](level-11-phase-f-test-swarm.md) |
| 11.G | Document Swarm | Implementation Spec | Complete | [level-11-phase-g-document-swarm.md](level-11-phase-g-document-swarm.md) |

## Plan Template

New plans should follow this structure:

```markdown
# Level N: [Name] — Implementation Spec

> Status: [Planned | In Progress | Complete]

## Context
Why this level is needed. 1-2 sentences.

## What Will Be Built
Bullet list of capabilities.

## Architecture
Data flow, component relationships, key patterns.

## Implementation Detail
### [Component 1]
**File:** `path/to/file`
Tables, endpoints, functions with signatures and schemas.

## Key Files
| File | Role |
|------|------|

## Key Decisions
Reference DEC-xxx entries and architectural choices.

## Post-build
Services to restart, caches to clear, migrations to run.
- [ ] Restart server: `kill $(cat ~/.claude-remote/server.pid) && node src/server/server.js &`

## Verification
Curl commands, UI checks, expected outputs.

## Drift Notes
Divergences from spec after implementation. "None" if clean.
```

## Conventions

- **File naming:** `level-NN-short-name.md` or `level-NN-phase-N-short-name.md`
- **Post-build section:** Always include if the plan modifies server code or infrastructure
- **Drift notes:** Fill in after implementation — this is the spec-vs-reality record
- **Automator handoff:** Plans can be submitted as goal descriptions to `POST /api/goals`

---

*Update this index when adding new plans.*
