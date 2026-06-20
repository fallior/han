# Task-Pipeline Off-SDK Migration — Scope

> **Status:** SCOPE (not yet a build). Sequenced **after Phase-2 Phase-0** (the liveness layer).
> Darron's call, 2026-06-16 (S181): *"scope the task-pipeline-off-SDK migration after Phase-2."*
> Author: Jim (session). Leo-build / Jim-audit when it activates.

## Problem

The #66 migration (DEC-094/095, zero-`agentQuery`-cognition) moved the **cognition** surfaces
(heartbeat, both `*-human` seats, the supervisor cycle, meditations) off the Agent SDK
(`query` from `@anthropic-ai/claude-agent-sdk`, aliased `agentQuery`) onto the warm tmux
transport. It did **not** touch the **background / autonomous work pipeline** — which is still
fully on the Agent SDK and therefore still on SDK API billing (the thing the June-15 change
re-prices). This is the creator side of the garden — the pipeline that built today's two
MVPs (finance-assistant, movie-imdb-finder).

**Governing law:** *avoid the Agent SDK for any background/autonomous task* (Darron, S181).

## The live background-SDK call-sites (verified by code, 2026-06-16)

| # | Call-site | What it is | Model | Shape |
|---|---|---|---|---|
| A1 | `services/planning.ts:341` | **The planner** — explores a project read-only, decomposes a goal → ordered subtasks, assigns the per-task model | Opus/Sonnet | **agentic** (Read/Glob/Grep/Bash, multi-turn) |
| A2 | `services/planning.ts:1982` (`executeTask` :1902) | **Task-agent execution** — runs each subtask as a coding agent; `model: task.model`, `maxTurns: task.max_turns`, `allowedTools`, `permissionMode` | haiku/sonnet/opus per task | **agentic** (full tool loop, in project dir) — **the big spend** |
| B1 | `orchestrator.ts:171` | Dispatch routing decision | Haiku | single-turn (`maxTurns:1`, no tools) |
| B2 | `jemma.ts:363` | Discord/admin message classification | Haiku | single-turn (`maxTurns:1`); **gemma3:4b local fallback already wired** (`OLLAMA_MODEL`) |
| B3 | `lib/memory-gradient.ts:467` + `:547` | UV contradiction-detection during the cascade ("does this new UV supersede an old one") | Haiku | single-turn JSON judgment (`maxTurns:1`) |

Not live SDK (no migration needed): `dream-gradient.ts` (imports `agentQuery`, 0 live calls);
the cognition surfaces + rollback shims (retired #66/T-7).

## Two classes, two migration targets

### Class A — agentic tool-loops (A1 planner, A2 task-exec)
They **need** the multi-turn tool-use loop (read files, write code, run commands, git). The
correct target is the **`claude` CLI / tmux transport** — the same subscription-billed path
cognition moved to under #66, NOT the API-billed Agent SDK. Reuse the existing dispatcher
primitives (`lib/tmux-dispatcher.ts`: `spawnAgentSession`/`ensureSurfaceSession`/
`enqueueForAgent`).

**The shape-difference from cognition** (this is the design work): task execution is **ephemeral
and per-task**, not a warm long-lived per-agent session — each task carries its own
`model` + `allowedTools` + `permissionMode` + project `cwd`. So this is "spawn a `claude`
headless run per task (carrying those params), capture the result, update task status" —
closer to a per-task spawned CLI session than to the warm-spoke reuse. Open question:
warm-pool-per-model vs spawn-per-task (cost/latency vs isolation).

### Class B — single-turn judgments (B1 orchestrator, B2 jemma, B3 gradient-contradiction)
`maxTurns:1`, no tools — these do **not** need the Agent SDK *or* a tmux session. Migrate to
a shared **single-turn LLM-judgment helper** that uses either:
- the **direct Anthropic Messages API** (`@anthropic-ai/sdk` plain client — pay-per-token, but
  a single cheap Haiku call), or
- the **local Ollama model** (`gemma3:4b` — already the proven fallback in `jemma.ts`; zero API cost).

B2 (jemma) is the easiest — the local fallback already exists; the migration is "prefer
local/Messages-API, drop the `agentQuery` primary." B1/B3 follow the same helper.

## Sequencing

**After Phase-2 Phase-0** (the liveness layer). Within this migration, suggested order:
1. **Class B first** (low-risk, single-turn, fast win, drops the most-frequent cheap calls):
   B2 jemma → B1 orchestrator → B3 gradient-contradiction.
2. **Class A second** (the design-heavy, big-spend one): A1 planner → A2 task-exec.
   A2 is the headline — it's where the per-task Opus/Sonnet/Haiku spend lives.

## Open decisions (for Darron / the activating thread)

1. **Class B target:** Messages API vs local Ollama vs a tiered preference (local-first,
   API-fallback). Lean: tiered, local-first for classification/routing (B1/B2), API for the
   gradient judgment (B3) if local quality is insufficient.
2. **Class A model:** warm-pool-per-model vs spawn-`claude`-per-task. Lean: spawn-per-task for
   isolation (each task already declares its own model/tools/permission), revisit pooling if
   latency hurts.
3. **DEC-094 extension:** #66's DEC-094 says "new surfaces use tmux, not inline `agentQuery`."
   Class A fits cleanly. Class B is a *new category* (single-turn judgment) DEC-094 didn't
   cover — needs a decision: is a direct Messages-API call an acceptable "not-the-Agent-SDK"
   path, or must everything route through tmux? (Recommend: Messages-API/local is acceptable
   for single-turn no-tool judgments; tmux is for agentic surfaces.)

## Settled-decision / protected-file touches (audit gates)

- **B3 is in `lib/memory-gradient.ts`** — PROTECTED (DEC-068/069), and contradiction-detection
  is adjacent to DEC-086 (re-encounter produces metadata). Moving its *transport* (not its
  logic) needs an explicit settled-decision check + the pre-merge audit rhythm.
- **A2 task-exec** changes what the system *spawns* — trace every caller of `executeTask` and
  the task-status/telemetry write path (don't break the `tasks` table updates or the
  `claude-logged` mirror).
- All surfaces: confirm the migration is transport-only (same prompt, same model choice, same
  output contract) — the asymmetric-drift trap (AP migration lesson).

## Acceptance

`grep` finds **zero live `agentQuery(` calls** outside the retired/rollback set; the planner +
task-exec run on the CLI/tmux transport; the three single-turn judgments run on the
Messages-API/local helper; the two MVPs still build end-to-end (re-run a goal→plan→task→commit
as the proof); both servers + Jemma + the cascade unaffected. **Then the whole garden —
cognition AND creation — is off the Agent SDK.**
