# Claude Remote — Future Development Roadmap

## From Remote Prompt Responder to Autonomous Development Platform

*Version 2.0 — 15 February 2026*

---

## Where We Are Now

Claude Remote was conceived in January 2026 as a solution to a real pain point: Claude Code blocks on prompts while you're away from your desk. The project was structured into progressive levels, with the original 6 now complete and extended levels 7–8 also delivered:

| Level | Name | Status |
|-------|------|--------|
| 1 | Prompt Responder (MVP) | 🟢 Complete |
| 2 | Push Alerts | 🟢 Complete |
| 3 | Context Window (Search & Copy) | 🟢 Complete |
| 4 | Terminal Mirror (xterm.js) | 🟢 Complete |
| 5 | Mobile Keyboard | 🟢 Complete |
| 6 | Claude Bridge (Context Export/Import) | 🟢 Complete |
| 7 | Autonomous Task Runner | 🟢 Complete |
| 8 | Intelligent Orchestrator | 🟢 Complete |
| 9 | Multi-Project Autonomy | 🟢 Complete |
| 10 | Self-Improving Development System | 🟢 Complete |
| 11 | Autonomous Product Factory | 🟢 Complete |

The architecture now includes tmux session management, a notify.sh hook, an Express server with WebSocket push, ntfy.sh push notifications, a mobile web UI served over Tailscale, the Claude Agent SDK for headless task execution with git checkpoints and approval gates, an orchestrator intelligence layer with goal decomposition, smart model routing, retry logic, and project memory, portfolio management with cost budgets and priority engine, ecosystem-aware context injection, and a 7-phase product pipeline with 42 parallel subagents.

---

## The New Vision: Total Autonomy

The original Claude Remote vision stops at Level 6 (Claude Bridge — bidirectional claude.ai ↔ Claude Code transport). But the real endgame is bigger: **a system where Claude Code runs autonomously on a dedicated machine, orchestrated either by a local model or the Claude API, with you maintaining oversight and strategic direction from your phone.**

This isn't science fiction. The pieces exist today:

- **Claude Agent SDK** (TypeScript + Python) — programmatic access to the full Claude Code agent loop with subagents, hooks, streaming, and structured output
- **Headless mode** (`claude -p`) — non-interactive Claude Code for automation and CI/CD
- **Local model support** — Ollama and llama.cpp now serve Anthropic-compatible APIs, letting Claude Code run on Qwen3-Coder, GLM-4.7, DeepSeek, and others
- **Subagent orchestration** — Claude Code natively supports spawning specialised subagents with isolated context windows
- **Checkpoints** — automatic code state saving with instant rewind via `/rewind`
- **Hooks system** — deterministic callbacks at every stage (PreToolUse, PostToolUse, Notification, PermissionRequest, Stop, etc.)

---

## Extended Level Architecture

### Levels 1–6: Original Roadmap (Unchanged)

These remain the foundation. Levels 1–3 solve immediate productivity. Levels 4–5 give full remote terminal capability. Level 6 bridges claude.ai conversations with Claude Code sessions.

### Level 7: Autonomous Task Runner

**Codename**: `autopilot`
**Goal**: Claude Code executes defined tasks without human prompting

This is the first autonomy level. Instead of you typing prompts, the system pulls tasks from a queue and feeds them to Claude Code headlessly.

**Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    DEDICATED MACHINE                         │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Task Queue  │───▶│  Orchestrator│───▶│  Claude Code  │  │
│  │  (SQLite/    │    │  (Node.js)   │    │  (headless)   │  │
│  │   Redis)     │◀───│              │◀───│              │   │
│  └──────────────┘    └──────┬───────┘    └──────────────┘   │
│                             │                               │
│                    ┌────────▼────────┐                       │
│                    │   Checkpoint    │                       │
│                    │   Manager       │                       │
│                    │   (git-based)   │                       │
│                    └─────────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                    E2E Encrypted / Tailscale
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                         PHONE                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Task Board  │    │  Live Feed   │    │  Approve /   │   │
│  │  (create/    │    │  (progress)  │    │  Reject      │   │
│  │   prioritise)│    │              │    │  (gate)      │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key capabilities**:

- Task queue with priorities (you populate from phone or claude.ai)
- Claude Code runs in headless mode (`claude -p`) with `--allowedTools` scoping
- Git checkpoint before each task, automatic rollback on failure
- Progress streaming to your phone via WebSocket
- Configurable gates: "always auto-approve", "approve file writes only", "approve everything"
- Task completion summaries pushed to phone
- Session cost tracking (tokens in/out, USD spent)

**Implementation approach**:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Orchestrator pulls task from queue
const task = await taskQueue.next();

for await (const message of query({
  prompt: task.description,
  options: {
    model: "sonnet",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "bypassPermissions",
    maxTurns: 250,
    cwd: task.projectPath,
  }
})) {
  // Stream progress to phone
  await progressFeed.push(message);
  // Check for gate conditions
  if (requiresApproval(message)) {
    await waitForMobileApproval(message);
  }
}
```

---

### Level 8: Intelligent Orchestrator

**Codename**: `conductor`
**Goal**: An AI layer manages Claude Code, decomposing goals into tasks

This is where the "local model vs Claude API" decision becomes critical. The orchestrator needs to:

1. Understand project context (codebase, architecture, goals)
2. Decompose high-level goals into ordered tasks
3. Route tasks to appropriate Claude Code instances/subagents
4. Monitor progress and adapt plans
5. Handle failures with retry logic or alternative approaches
6. Maintain a persistent project memory

**Option A: Local Model Orchestrator**

```
┌─────────────────────────────────────────────────────────────┐
│                    DEDICATED MACHINE                         │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │           LOCAL ORCHESTRATOR MODEL                │       │
│  │  (Qwen3-Coder 30B / GLM-4.7 via Ollama)         │       │
│  │                                                   │       │
│  │  Responsibilities:                                │       │
│  │  • Parse high-level goals into task sequences     │       │
│  │  • Monitor Claude Code output for success/failure │       │
│  │  • Decide retry vs escalate vs skip               │       │
│  │  • Maintain project state & memory                │       │
│  │  • Cost-gate expensive operations                 │       │
│  └──────────────────────┬───────────────────────────┘       │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │   Claude Agent SDK  │                        │
│              │   (via Anthropic    │                        │
│              │    API — Sonnet)    │                        │
│              └──────────┬──────────┘                        │
│                         │                                   │
│           ┌─────────────┼─────────────┐                     │
│           │             │             │                     │
│    ┌──────▼──────┐ ┌────▼─────┐ ┌────▼─────┐              │
│    │ Claude Code │ │ Claude   │ │ Claude   │              │
│    │ Instance 1  │ │ Subagent │ │ Subagent │              │
│    │ (feature)   │ │ (tests)  │ │ (docs)   │              │
│    └─────────────┘ └──────────┘ └──────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Pros**:
- Zero ongoing orchestration cost (local inference is free after hardware)
- Full privacy — your codebase never leaves your network for orchestration decisions
- No rate limits on orchestration calls
- Can run 24/7 without API budget concerns
- Qwen3-Coder 30B (A3B MoE) runs well on 32GB+ M-series Macs at ~10 tok/s
- Orchestration tasks are mostly planning/routing — don't need frontier intelligence

**Cons**:
- Orchestration quality limited by local model capability
- Can't match Claude Opus/Sonnet for complex decomposition
- Needs decent hardware (M-series Mac with 32GB+ or Linux with GPU)
- Model updates require manual pulls
- Slower inference means slower task routing decisions

**Option B: Claude API Orchestrator**

```
┌─────────────────────────────────────────────────────────────┐
│                    DEDICATED MACHINE                         │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │           CLAUDE API ORCHESTRATOR                 │       │
│  │  (Anthropic API — Opus 4.6 or Sonnet 4.5)       │       │
│  │                                                   │       │
│  │  Uses Claude Agent SDK with custom system prompt  │       │
│  │  and MCP tools for:                               │       │
│  │  • Project analysis & task decomposition          │       │
│  │  • Quality assessment of completed work           │       │
│  │  • Architecture decision-making                   │       │
│  │  • Cross-project dependency management            │       │
│  └──────────────────────┬───────────────────────────┘       │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │   Worker Pool       │                        │
│              │   (Claude Agent     │                        │
│              │    SDK instances)   │                        │
│              └──────────┬──────────┘                        │
│                         │                                   │
│           ┌─────────────┼─────────────┐                     │
│           ▼             ▼             ▼                     │
│    Claude Code    Claude Code    Claude Code               │
│    (Sonnet)       (Haiku)        (Sonnet)                  │
│    feature work   linting/tests  documentation             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Pros**:
- Frontier intelligence for orchestration (Opus 4.6 is genuinely excellent at planning)
- Better at understanding nuanced project requirements
- Can reason about architecture trade-offs at a high level
- No local hardware requirements beyond running Claude Code itself
- Always up-to-date with latest model capabilities
- Native subagent support — Opus orchestrating Sonnet/Haiku workers is the designed pattern

**Cons**:
- Ongoing API costs (Opus orchestration + Sonnet/Haiku workers)
- Rate limits could bottleneck during intensive development
- API outages block everything
- Your project context goes through Anthropic's servers

**Option C: Hybrid (Recommended)**

```
┌─────────────────────────────────────────────────────────────┐
│                    DEDICATED MACHINE                         │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │          LOCAL MODEL — TASK ROUTER                │       │
│  │  (Qwen3-Coder 30B via Ollama)                    │       │
│  │                                                   │       │
│  │  • Monitors task queue & project state            │       │
│  │  • Routes simple tasks directly to Claude Code    │       │
│  │  • Classifies task complexity                     │       │
│  │  • Handles retries & error recovery               │       │
│  │  • Manages git checkpoints                        │       │
│  │  • Logs everything                                │       │
│  └────────────┬─────────────────┬───────────────────┘       │
│               │                 │                           │
│        Simple tasks      Complex tasks                      │
│               │                 │                           │
│               ▼                 ▼                           │
│  ┌────────────────┐  ┌─────────────────────┐               │
│  │  Claude Code   │  │  Claude API         │               │
│  │  (Sonnet -p)   │  │  (Opus/Sonnet)      │               │
│  │  Direct exec   │  │  Plan → decompose   │               │
│  └────────────────┘  │  → spawn workers    │               │
│                      └─────────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Why hybrid wins**:
- Local model handles 80% of routing/monitoring at zero marginal cost
- Claude API only invoked for complex planning and architecture decisions
- Graceful degradation if API is unavailable (local model continues simple tasks)
- Cost-optimised: use Haiku for simple tasks, Sonnet for features, Opus only for planning
- The local model acts as a cost gate — it decides whether a task warrants API spend

**Estimated monthly costs (hybrid, moderate usage)**:
- Local model: $0 (already running on your hardware)
- Claude API orchestration (Opus, ~20 complex plans/day): ~$15–30/month
- Claude Code workers (Sonnet, ~50 tasks/day): ~$60–120/month
- Claude Code workers (Haiku, linting/tests): ~$5–10/month
- **Total: ~$80–160/month** vs pure API at ~$200–400/month

---

### Level 9: Multi-Project Autonomy

**Codename**: `empire`
**Goal**: Manage your entire Contempire portfolio autonomously

The orchestrator doesn't just manage one project — it manages all 16+. It understands cross-project dependencies, shared libraries, and your development priorities.

**Architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      DEDICATED MACHINE                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   EMPIRE CONTROLLER                        │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │  Portfolio   │  │  Priority    │  │  Dependency    │   │  │
│  │  │  Manager     │  │  Engine      │  │  Graph         │   │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘   │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │  Schedule    │  │  Cost        │  │  Quality       │   │  │
│  │  │  Manager     │  │  Tracker     │  │  Gate          │   │  │
│  │  └─────────────┘  └──────────────┘  └────────────────┘   │  │
│  │                                                           │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│  ┌──────▼───────┐    ┌──────▼───────┐    ┌───────▼──────┐     │
│  │  HitchKey    │    │  Hodgic      │    │  Licensing   │     │
│  │  Orchestrator│    │  Orchestrator│    │  Orchestrator│     │
│  │  (Level 8)   │    │  (Level 8)   │    │  (Level 8)   │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Tailscale / E2E Encrypted
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                          PHONE                                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Portfolio    │  │  Daily       │  │  Strategic           │  │
│  │  Dashboard    │  │  Digest      │  │  Decisions           │  │
│  │              │  │  (summary)   │  │  (approve/redirect)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key capabilities**:
- Morning briefing: "Overnight, I completed 3 tasks on HitchKey, ran the Hodgic test suite (2 failures — awaiting your decision), and updated dependencies across 4 projects"
- Priority rebalancing based on deadlines, blockers, and your input
- Cross-project refactoring (shared component updates propagate automatically)
- Cost budgets per project with auto-throttling
- Nightly maintenance runs (dependency updates, security patches, test suites)
- Weekly progress reports with burndown charts

---

### Level 10: Self-Improving Development System

**Codename**: `singularity`
**Goal**: The system improves its own workflows and tooling

This is the ambitious endgame. The system doesn't just execute tasks — it observes patterns in its own performance and optimises.

**Capabilities**:
- **Prompt optimisation**: Tracks which prompts produce the best results for each task type, refines them over time
- **Tool creation**: If it finds itself doing the same multi-step operation repeatedly, it creates a reusable tool/script
- **CLAUDE.md evolution**: Automatically updates project CLAUDE.md files based on patterns it discovers
- **Error pattern learning**: Maintains a knowledge base of errors and their solutions; pre-empts known issues
- **Cost optimisation**: Routes tasks to the cheapest model that historically succeeds at that task type
- **Development velocity tracking**: Measures throughput over time, identifies bottlenecks
- **Workflow suggestions**: "I notice you always run tests after editing X — shall I make this automatic?"

**Architecture addition — Feedback Loop**:

```
┌─────────────────────────────────────────────────────────┐
│                  FEEDBACK SYSTEM                         │
│                                                         │
│  ┌───────────────┐    ┌───────────────┐                 │
│  │  Outcome      │───▶│  Pattern      │                 │
│  │  Tracker      │    │  Detector     │                 │
│  │  (success/    │    │  (what works, │                 │
│  │   failure/    │    │   what fails, │                 │
│  │   cost/time)  │    │   correlations│                 │
│  └───────────────┘    └───────┬───────┘                 │
│                               │                         │
│                      ┌────────▼────────┐                │
│                      │  Optimiser      │                │
│                      │  (adjust        │                │
│                      │   prompts,      │                │
│                      │   routing,      │                │
│                      │   tooling)      │                │
│                      └─────────────────┘                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Level 11: Autonomous Product Factory

**Codename**: `genesis`
**Goal**: Seed idea → complete, deployable product with minimal human input

This is the ultimate vision. You describe a problem and a rough solution direction. The system researches, architects, builds, tests, documents, and deploys a complete product. You provide creative direction and final approval. Everything else is autonomous.

**The Seed-to-Product Pipeline**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GENESIS PIPELINE                              │
│                                                                     │
│  ┌─────────┐   ┌───────────┐   ┌───────────┐   ┌───────────────┐  │
│  │  SEED   │──▶│  RESEARCH │──▶│  DESIGN   │──▶│  ARCHITECT    │  │
│  │  INPUT  │   │  PHASE    │   │  PHASE    │   │  PHASE        │  │
│  └─────────┘   └───────────┘   └───────────┘   └───────┬───────┘  │
│                                                         │          │
│       ┌─────────────────────────────────────────────────┘          │
│       │                                                            │
│       ▼                                                            │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌────────────┐  │
│  │  BUILD    │──▶│  TEST     │──▶│  DOCUMENT │──▶│  DEPLOY    │  │
│  │  PHASE    │   │  PHASE    │   │  PHASE    │   │  PHASE     │  │
│  └───────────┘   └───────────┘   └───────────┘   └────────────┘  │
│       │                │                                │         │
│       └────────────────┘ (iterate until passing)        │         │
│                                                         │         │
│  ┌──────────────────────────────────────────────────────▼──────┐  │
│  │                    HUMAN GATE POINTS                         │  │
│  │  • After Research: "Here's what I found, proceed?"           │  │
│  │  • After Design: "Here's the UX/approach, approve?"          │  │
│  │  • After Architecture: "Here's the tech stack, confirm?"     │  │
│  │  • After Build: "MVP ready for review"                       │  │
│  │  • After Test: "All tests passing, deploy?"                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Phase Detail**:

#### 1. Seed Input (You — from phone or claude.ai)

The seed is deliberately minimal. Examples:

> "I want a smart lock for trailer hitches that uses Bluetooth and can be managed by fleet operators. Nordic nRF52840, Zephyr RTOS. Think about the companion app too."

> "Build a tool that helps songwriters go from idea to published Spotify track using Suno AI. Handle the whole workflow — lyrics, generation, metadata, upload."

> "Air traffic controllers need a licensing management app with calendar/roster integration and automated email-to-database pipeline."

The system should be able to work with just a problem statement and a rough direction. It fills in the gaps through research.

#### 2. Research Phase — Subagent Swarm

```
┌─────────────────────────────────────────────────────────────┐
│               RESEARCH ORCHESTRATOR (Opus)                   │
│                                                             │
│  Spawns parallel research subagents:                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Market       │  │ Technical    │  │ Competitive  │      │
│  │ Research     │  │ Feasibility  │  │ Analysis     │      │
│  │ (web search) │  │ (docs, APIs) │  │ (web search) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Best         │  │ Regulatory   │  │ UX Pattern   │      │
│  │ Practices    │  │ Requirements │  │ Research     │      │
│  │ (docs, code) │  │ (standards)  │  │ (examples)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
│  Output: Research Brief (sent to your phone for approval)   │
└─────────────────────────────────────────────────────────────┘
```

Each subagent uses Claude's web search tool to find current information, reads documentation, analyses existing solutions, and returns a focused brief. The orchestrator synthesises these into a comprehensive research document.

The Agent SDK's subagent pattern is perfect here — each researcher runs in its own context window, only returning relevant findings to the orchestrator, keeping the main context clean.

#### 3. Design Phase

Based on approved research, the system produces:

- User stories / requirements document
- Wireframes or UI mockups (generated as HTML/React prototypes)
- Data model design
- API contract specification
- User flow diagrams (Mermaid)

This phase uses the Claude API (Opus or Sonnet) for design thinking, with subagents generating specific artefacts in parallel.

**Human gate**: You review the design on your phone, annotate, redirect, or approve.

#### 4. Architecture Phase

- Technology stack selection (informed by research + your preferences from CLAUDE.md)
- Project structure generation
- Dependency mapping
- Infrastructure design (Cloudflare Workers, D1, etc. based on your preferences)
- CI/CD pipeline design
- Security architecture

**Human gate**: Architecture review. This is the most important gate — getting the foundation right saves enormous rework.

#### 5. Build Phase — Multi-Agent Construction

This is where your 96GB Linux machine earns its keep:

```
┌─────────────────────────────────────────────────────────────────┐
│                BUILD ORCHESTRATOR (Opus/Sonnet)                   │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    TASK DECOMPOSITION                      │  │
│  │  Feature 1 ──▶ [backend, frontend, tests, docs]           │  │
│  │  Feature 2 ──▶ [backend, frontend, tests, docs]           │  │
│  │  Shared libs ──▶ [types, utils, config]                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  PARALLEL EXECUTION:                                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Claude Code  │  │ Claude Code  │  │ Claude Code  │         │
│  │ Instance 1   │  │ Instance 2   │  │ Instance 3   │         │
│  │ (Sonnet)     │  │ (Sonnet)     │  │ (Haiku)      │         │
│  │              │  │              │  │              │         │
│  │ Feature 1    │  │ Feature 2    │  │ Shared libs  │         │
│  │ backend      │  │ backend      │  │ + types      │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                    │
│                  ┌────────▼────────┐                           │
│                  │  Integration    │                           │
│                  │  Agent (Sonnet) │                           │
│                  │  Merge + resolve│                           │
│                  │  conflicts      │                           │
│                  └─────────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Key patterns:
- **Dependency-ordered execution**: Shared libraries built first, then features in parallel
- **Git branching**: Each feature on its own branch, integration agent merges
- **Checkpoint per feature**: Rollback granularity at feature level
- **Progress streaming**: You see real-time build progress on your phone
- **Auto-retry with different approach**: If a feature fails 3 times, the orchestrator tries a different implementation strategy

#### 6. Test Phase — Automated Quality Gate

```
┌─────────────────────────────────────────────────────────────┐
│                 TEST ORCHESTRATOR                             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Unit Test    │  │ Integration  │  │ E2E Test     │      │
│  │ Agent        │  │ Test Agent   │  │ Agent        │      │
│  │ (Haiku)      │  │ (Sonnet)     │  │ (Sonnet)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Lint/Type    │  │ Security     │  │ Performance  │      │
│  │ Check Agent  │  │ Audit Agent  │  │ Test Agent   │      │
│  │ (Haiku)      │  │ (Sonnet)     │  │ (Sonnet)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
│  FEEDBACK LOOP: Failed tests → Build Phase → Re-test        │
│  Max iterations: 5 before escalating to human                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 7. Document Phase

- README.md generation
- API documentation (auto-generated from code)
- CLAUDE.md / claude-context folder (for future AI collaboration)
- User guide / getting started
- Architecture decision records
- Deployment guide

#### 8. Deploy Phase

Based on your infrastructure preferences:
- Cloudflare Workers + D1 deployment
- Docker containerisation
- CI/CD pipeline activation
- DNS configuration
- SSL/TLS setup
- Health check monitoring

**Human gate**: Final review before production deployment.

---

#### What Makes Level 11 Different From "Just Using Claude Code"

The critical distinction is **persistent project intelligence**. Today, each Claude Code session starts relatively fresh — it reads CLAUDE.md, explores the codebase, and builds context. Level 11 maintains a living knowledge graph across the entire product lifecycle:

```
┌─────────────────────────────────────────────────────────────┐
│                  PROJECT KNOWLEDGE GRAPH                      │
│                                                             │
│  ┌─────────────┐                                            │
│  │ Research     │──── market findings, competitor analysis   │
│  │ Context      │──── regulatory requirements               │
│  └──────┬──────┘                                            │
│         │                                                   │
│  ┌──────▼──────┐                                            │
│  │ Design      │──── user stories, wireframes, data model   │
│  │ Decisions   │──── rejected alternatives + reasoning      │
│  └──────┬──────┘                                            │
│         │                                                   │
│  ┌──────▼──────┐                                            │
│  │ Architecture│──── stack choices, dependency map           │
│  │ State       │──── performance constraints                │
│  └──────┬──────┘                                            │
│         │                                                   │
│  ┌──────▼──────┐                                            │
│  │ Build       │──── what worked, what failed, patterns     │
│  │ History     │──── per-file change rationale              │
│  └──────┬──────┘                                            │
│         │                                                   │
│  ┌──────▼──────┐                                            │
│  │ Runtime     │──── error patterns, user feedback           │
│  │ Intelligence│──── performance metrics, usage data        │
│  └─────────────┘                                            │
│                                                             │
│  Every agent session loads relevant slices of this graph    │
│  into its context window. Nothing starts from scratch.      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This knowledge graph is stored in SQLite on the Linux machine and sliced contextually for each agent — a research agent gets research context, a build agent gets architecture + build history, a test agent gets test history + known failures.

The system doesn't just remember what it built — it remembers **why** it made every decision, what alternatives it considered, and what happened when things went wrong. This is the compound advantage that grows with every project.

---

#### The Conversation That Starts It All

Here's what interacting with Level 11 looks like from your phone:

```
You:    I want a smart lock for trailer hitches. Bluetooth,
        Nordic nRF52840, Zephyr RTOS. Fleet management
        companion app. This is for InventorsDream.

System: Understood. Starting research phase for HitchKey.
        I'll investigate:
        • Existing smart lock products & patents
        • BLE security best practices for physical access
        • nRF52840 + Zephyr BLE stack capabilities
        • Fleet management UX patterns
        • Regulatory requirements (AU/US/EU)
        • Companion app architecture options

        Estimated research time: 15 minutes.
        I'll send you the brief when ready.

        [15 minutes later]

System: Research complete. Key findings:
        • 3 competitors identified, none with fleet focus
        • BLE 5.3 with LESC pairing recommended
        • Zephyr has mature BLE stack for nRF52840
        • Fleet apps typically use role-based access
        • No specific AU regulation for smart locks
        • React Native recommended for companion app

        Full brief attached. Shall I proceed to design?

You:    Looks good. Proceed. Use our Cloudflare stack
        for the backend. Make the app a PWA first,
        native later.

System: Confirmed. Moving to design phase with:
        • PWA companion app (TanStack Start)
        • Cloudflare Workers + D1 backend
        • nRF52840 firmware (Zephyr RTOS)
        • Role-based fleet access model

        Design deliverables in ~30 minutes.
```

And then it builds. You surf. It ships.

---

## Hardware Strategy: Staged Growth

### The Machine

**Current system** — Darron's existing Linux desktop, designated as the autonomy server.

| Component | Spec |
|-----------|------|
| CPU | Intel i5-12500 (6-core / 12-thread, Alder Lake) |
| RAM | 64GB DDR4 |
| GPU (current) | AMD Radeon RX 6600 XT (8GB — not usable for CUDA inference) |
| Storage | 2× NVMe (Samsung 980 Pro 2TB + WD Black SN850X 2TB) + 2× 8TB HDD |
| PSU | Corsair RM850x (850W, 80+ Gold, fully modular) |
| Motherboard | Gigabyte B660M GAMING X AX DDR4 (Micro-ATX) |
| PCIe | 1× PCIe 4.0 x16 (CPU) + 1× PCIe 3.0 x4 (chipset) |
| OS | Linux Mint 21.1 (Ubuntu 22.04 base) |
| Network | 2.5GbE LAN + WiFi 6 |
| Monitors | 2× 4K (3840×2160) via DisplayPort |

### Hardware Stages — Grow With the Roadmap

The hardware strategy follows the software roadmap. Don't build ahead of need.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HARDWARE EVOLUTION PATH                               │
│                                                                         │
│  STAGE 0          STAGE 1           STAGE 2           STAGE 3           │
│  (Now)            (~$1,000)         (~$4,000–5,000)   (~$8,000–10,000)  │
│                                                                         │
│  ┌──────────┐    ┌──────────┐     ┌──────────────┐   ┌──────────────┐  │
│  │ i5-12500 │    │ i5-12500 │     │ TR Pro 3945WX│   │ TR Pro 3945WX│  │
│  │ 64GB DDR4│    │ 64GB DDR4│     │ 128GB ECC    │   │ 128GB+ ECC   │  │
│  │ No GPU   │    │ RTX 3090 │     │ 2× RTX 3090  │   │ 4× RTX 3090  │  │
│  │ CPU-only │    │ 24GB VRAM│     │ 48GB VRAM    │   │ 96GB VRAM    │  │
│  └──────────┘    └──────────┘     └──────────────┘   └──────────────┘  │
│                                                                         │
│  Levels 1–6      Levels 7–10      Level 11 +         Level 11 +        │
│  + early L7      Full autonomy    70B+ models        130B+ models      │
│                                   Multi-agent swarm   Frontier local    │
│                                                                         │
│  5–8 tok/s       30–40 tok/s      35+ tok/s (70B)    40+ tok/s (130B)  │
│  (30B model)     (30B model)      20+ tok/s (130B)   Concurrent agents │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Stage 0: CPU-Only (Current Hardware, $0)

**Supports**: Levels 1–6 + early Level 7
**When**: Now

Use the existing i5-12500 + 64GB DDR4 with CPU-only inference. The RX 6600 XT stays in for display output but is not used for inference (AMD ROCm support on consumer Radeon is unreliable).

| Workload | Performance |
|----------|-------------|
| Qwen3-Coder 30B (Q4_K_M, ~17GB) | ~5–8 tok/s (MoE activates only 3B params) |
| Qwen3-Coder 30B (Q8_0, ~32GB) | ~3–5 tok/s |
| 7B routing model | ~15–20 tok/s |
| Claude Code instances × 3 | ~1.5–3GB RAM |
| **Total RAM usage** | ~22–38GB of 64GB |

This is viable for orchestration. The local model doesn't need to be fast — it makes one routing decision every few minutes. The actual code generation happens via Claude API (Sonnet/Haiku), which is not bottlenecked by local hardware.

**First-day setup:**

```bash
# Check hardware
free -h                    # Confirm 64GB RAM
lscpu                      # Confirm 12 threads, AVX2 support
nvidia-smi                 # Will fail (AMD GPU) — that's expected

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull orchestrator model
ollama pull qwen3-coder:30b

# Test inference speed
ollama run qwen3-coder:30b "Write a hello world in TypeScript"

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Test headless mode with local model
export ANTHROPIC_BASE_URL=http://localhost:11434
claude -p "Hello, confirm you are operational" --model qwen3-coder:30b

# Install Agent SDK
npm install -g @anthropic-ai/claude-agent-sdk
```

**Trigger to upgrade**: If orchestration feels sluggish (waiting >10 seconds for routing decisions) or you want to run concurrent inference alongside Claude Code agents.

---

### Stage 1: Single RTX 3090 (~AU$1,000)

**Supports**: Levels 7–10 (full autonomy stack)
**When**: When Stage 0 feels limiting, or opportunistically when a good deal appears

**What to buy:**

| Item | Detail | Est. AU Cost |
|------|--------|-------------|
| RTX 3090 24GB (used) | Any reputable brand, air-cooled | $800–1,200 |
| Corsair Type 4 PCIe cable (×1 extra) | Only if originals are lost | $15–25 |
| GPU support bracket | Prevents sag (3090 weighs 2kg+) | $10–20 |
| **Total** | | **$825–1,245** |

**Preferred models (in order):**
1. EVGA RTX 3090 FTW3 Ultra — best cooling, most reliable
2. ASUS TUF Gaming RTX 3090 — built tough, good value ($900–1,000)
3. MSI RTX 3090 GAMING X TRIO — great thermals, triple fan
4. Gigabyte RTX 3090 Gaming OC — decent all-rounder
5. Any blower/turbo model — cheapest ($700–900) but loud, fine if machine is in another room

**Avoid:** RTX 3090 Ti (draws 450W, needs PSU upgrade), anything AMD (ROCm issues), RTX 3060 Ti / 4070 Ti (only 8–16GB VRAM).

**Installation**: Straight swap — remove RX 6600 XT, insert RTX 3090 in the same PCIe 4.0 x16 slot, connect power cables (2× or 3× 8-pin depending on model), install NVIDIA drivers. Two DisplayPort monitor cables transfer directly (both cards have 3× DP + 1× HDMI).

**Power budget with RTX 3090:**

| Component | Draw |
|-----------|------|
| i5-12500 | 65W (117W boost) |
| RTX 3090 | 350W (spikes to ~460W) |
| RAM + storage + misc | ~50W |
| **Total sustained** | ~465W |
| **Peak (GPU spike + CPU boost)** | ~630W |
| **RM850x headroom** | ~220W ✅ |

**Performance uplift:**

| Workload | CPU-only (Stage 0) | With RTX 3090 (Stage 1) |
|----------|-------------------|------------------------|
| Qwen3-Coder 30B (Q4_K_M) | ~5–8 tok/s | ~30–40 tok/s |
| Qwen3-Coder 30B (Q8_0) | ~3–5 tok/s | ~20–25 tok/s |
| 7B routing model | ~15–20 tok/s | ~80–100 tok/s |
| Concurrent inference + agents | Tight | Comfortable |

The entire 30B model fits in 24GB VRAM. Zero CPU RAM used for inference. System RAM is fully available for Claude Code instances.

**Trigger to upgrade**: You want to run 70B+ models locally, need multiple concurrent inference streams, or Level 11's multi-agent build system is bottlenecked by single-GPU throughput.

---

### Stage 2: Threadripper PRO Multi-GPU Build (~AU$4,000–5,000)

**Supports**: Level 11 at scale + 70B+ models locally
**When**: Only when you have a concrete bottleneck that Stage 1 can't solve

This is a **new, dedicated machine** — not an upgrade to the existing i5 system. The i5 box can continue as a secondary node or general-purpose dev machine.

**Why a new platform is needed:**

The i5-12500 on B660M has only 16 CPU PCIe lanes. The second x16 slot runs at x4 electrically. You cannot run two GPUs at proper bandwidth on this board. Multi-GPU requires a platform with 128 PCIe lanes.

**The build — Used Threadripper PRO 3000 (WRX80 platform):**

| Component | Specific Part | Est. AU Cost (used) |
|-----------|--------------|-------------------|
| CPU | AMD Threadripper PRO 3945WX (12-core) | $200–400 |
| Motherboard | Gigabyte MC62-G40 (WRX80, 7× PCIe x16) | $600–900 |
| RAM | 128GB DDR4 ECC RDIMM (8× 16GB, 8-channel) | $200–350 |
| GPUs | 2× RTX 3090 24GB (reuse Stage 1 card + buy one more) | $800–1,200 (for second card) |
| PSU | EVGA 1600W or Corsair HX1200 (need 1200W+ for 2× 3090) | $200–350 |
| Case | Full tower / open frame (7 GPU slots need space) | $100–200 |
| CPU Cooler | Noctua NH-U14S TR4-SP3 or similar | $80–120 |
| NVMe | Reuse or new 2TB NVMe | $0–200 |
| **Total (including 2× RTX 3090)** | | **$3,200–5,000** |

Alternatively, search for combo deals. Used Lenovo ThinkStation P620 workstations with Threadripper PRO 3945WX appear on eBay for ~AU$1,500 — though OEM cases may limit GPU card length and expansion.

**Why the Threadripper PRO 3945WX:**

The CPU barely matters for LLM inference — you're buying this platform for the 128 PCIe 4.0 lanes, the 8-channel memory controller, and the 7× full-speed PCIe x16 slots. The cheapest Threadripper PRO gets you all of those. The 12-core 3945WX is more than enough to feed multiple GPUs and run Claude Code instances.

**What 2× RTX 3090 (48GB combined) enables:**

| Model | Quantisation | VRAM Required | Fits? | Speed |
|-------|-------------|---------------|-------|-------|
| Qwen3-Coder 30B | Q8_0 | ~32GB | ✅ One GPU | ~25 tok/s |
| Llama 70B | Q4_K_M | ~40GB | ✅ Split across both | ~15–20 tok/s |
| DeepSeek V3 (685B MoE) | Q2_K | ~80GB | ❌ Needs 4× GPUs | — |
| Concurrent: 30B orchestrator + 30B worker | Q4_K_M × 2 | ~34GB | ✅ One per GPU | Both at full speed |

The killer feature at this stage isn't just bigger models — it's **concurrent inference**. One GPU runs the orchestrator while the other runs a separate inference task, or multiple agents each get dedicated GPU time without contention.

**Power requirements:**

| Config | GPU Draw | System Total | PSU Needed |
|--------|----------|-------------|-----------|
| 2× RTX 3090 | 700W | ~850W sustained, ~1000W peak | 1200W minimum |
| 3× RTX 3090 | 1050W | ~1200W sustained, ~1400W peak | 1600W minimum |
| 4× RTX 3090 | 1400W | ~1550W sustained, ~1800W peak | 2000W (or dual PSU) |

**Trigger to upgrade**: You need to run 130B+ models locally, or need 4+ concurrent GPU inference streams.

---

### Stage 3: Full Multi-GPU Expansion (~AU$8,000–10,000 total)

**Supports**: Frontier-class local inference, production multi-agent workloads
**When**: If/when the Contempire portfolio demands it

This isn't a new build — it's expanding Stage 2 by adding more GPUs to the WRX80 platform's available slots.

| Upgrade | What it adds | Incremental Cost |
|---------|-------------|-----------------|
| 3rd RTX 3090 | 72GB total VRAM | ~$1,000 + PSU upgrade to 1600W |
| 4th RTX 3090 | 96GB total VRAM | ~$1,000 + likely dual PSU |
| RAM upgrade to 256GB | More KV-cache, bigger context windows | ~$300–500 |

**4× RTX 3090 (96GB VRAM) enables:**

| Model | Quantisation | Fits? | Speed |
|-------|-------------|-------|-------|
| Llama 70B | Q8_0 (highest quality) | ✅ | ~20–25 tok/s |
| DeepSeek V3 (685B MoE) | Q3_K_M | ✅ | ~8–12 tok/s |
| Qwen3-Coder 235B (A22B MoE) | Q4_K_M | ✅ | ~10–15 tok/s |
| 4× concurrent 30B agents | Q4_K_M | ✅ One per GPU | Each at ~30 tok/s |

At this stage, you have a genuine local AI inference server competitive with cloud offerings for models up to 130B parameters. The system can run frontier-class open-source models entirely offline with zero API dependency.

**Reality check — cost vs. API:**

| Approach | Monthly Cost | Capability |
|----------|-------------|-----------|
| Claude API hybrid (Levels 7–10) | $80–160/month | Frontier intelligence (Opus/Sonnet) |
| 4× RTX 3090 build (amortised over 3 years) | ~$220/month (electricity + amortisation) | 70B–130B open models, zero API dependency |
| Combined (recommended) | ~$300/month | Best of both — local orchestration + Claude API for heavy lifting |

The multi-GPU build pays for itself if you value: complete privacy, zero rate limits, 24/7 availability without API outages, and the ability to run experiments that would be prohibitively expensive via API.

---

### Future Watch: What Might Change the Calculus

| Development | Impact | Timeframe |
|-------------|--------|-----------|
| NVIDIA RTX 5090 (32GB GDDR7) | Single card matches 3090 VRAM with ~2× speed | Available now, ~AU$3,500 new |
| Open models improving (30B → 70B capability) | Stage 1 single 3090 stays sufficient longer | Ongoing |
| Cheaper used 4090s (24GB) | Faster single-GPU option at 3090 prices | 12–18 months as 5090 adoption grows |
| Apple Silicon with 192–384GB unified memory | CPU-class inference at decent speed, zero GPU fuss | Available now (Mac Studio Ultra), expensive |
| NVIDIA B-series (next gen) | 48GB+ consumer cards possible | 2027+ |

The key insight: **open-source models are improving faster than hardware is depreciating.** A 30B model in 2026 may match today's 70B model in capability. This means your single-3090 Stage 1 setup could remain the sweet spot for longer than expected. Don't overbuild.

---

## Implementation Roadmap

### Phase 1: Foundation (Levels 1–3) — Complete

- [x] Finalise Level 1 prototype, test end-to-end
- [x] Implement Level 2 push notifications (ntfy.sh)
- [x] Implement Level 3 context window (search & copy)
- [x] Deploy on Linux via Tailscale for daily use
- [x] Gather feedback on what works and what's missing

### Phase 2: Full Remote Terminal (Levels 4–5) — Complete

- [x] Level 4 terminal mirror (WebSocket-based, xterm.js on mobile)
- [x] Level 5 mobile keyboard (iOS soft keyboard, keystroke injection)
- [x] Append-only terminal buffer with history preservation
- [x] Manual trim button for buffer management

### Phase 3: The Bridge (Level 6) — Complete

- [x] Context export (CLAUDE.md, CURRENT_STATUS.md, recent files, git log)
- [x] Context import (paste into claude.ai Projects)
- [x] Bridge UI in mobile interface

### Phase 4: Autonomous Task Runner (Level 7) — Complete

- [x] Task queue system (SQLite + API)
- [x] Claude Agent SDK integration (headless mode)
- [x] Git checkpoint management (stash/branch with rollback)
- [x] Mobile task board UI
- [x] Progress streaming to phone (WebSocket)
- [x] Configurable approval gates (bypass/confirm/gate)
- [x] Cost tracking per task
- [x] Tool scoping (allowed tools per task)
- [x] Task execution logging (markdown logs with per-entry timestamps)

### Phase 5: Intelligent Orchestrator (Level 8) — Complete

- [x] Ollama integration (local model support, auto-detection)
- [x] Claude Haiku API fallback for orchestration
- [x] Task complexity classifier (simple/medium/complex → haiku/sonnet/opus)
- [x] Goal decomposition (high-level goal → ordered subtasks)
- [x] Dependency-aware task picking
- [x] Error recovery and retry logic with failure analysis
- [x] Project memory system (outcome tracking, success rates by model)
- [x] Goals tab in mobile UI (create, view, retry)
- [x] Orchestrator status badge
- [x] Pull and test a local model — `qwen2.5-coder:7b` (4.7GB), goal decomposition tested end-to-end

**Future improvements**:
- Ollama model pull helper — UI button to pull/switch models from phone (convenience, not critical)
- Auto-restart server on code changes — task automator detects `src/server/server.js` modifications and restarts the server post-build

### Phase 6: Multi-Project Empire (Level 9) — 8 weeks

- [ ] Portfolio manager with project registry
- [ ] Cross-project dependency graph
- [ ] Priority engine with time/budget constraints
- [ ] Daily digest and briefing system
- [ ] Per-project cost budgets with throttling
- [ ] Nightly maintenance automation
- [ ] Weekly progress reports

### Phase 7: Self-Improvement (Level 10) — Ongoing

- [ ] Outcome tracking database
- [ ] Pattern detection for prompts/tools/routing
- [ ] Automatic CLAUDE.md refinement
- [ ] Cost optimisation based on historical success rates
- [ ] Custom tool creation from repeated patterns
- [ ] Development velocity dashboards

### Phase 8: Autonomous Product Factory (Level 11) — 12 weeks

**Hardware**: Stage 1 (RTX 3090) minimum → Stage 2 (Threadripper + multi-GPU) for full multi-agent builds

- [ ] Research swarm (parallel web search subagents)
- [ ] Design phase automation (requirements → wireframes → data model)
- [ ] Architecture generator with preference learning
- [ ] Multi-agent parallel build system
- [ ] Automated test suite generation and execution
- [ ] Documentation auto-generation pipeline
- [ ] Deployment automation (Cloudflare/Docker)
- [ ] Project knowledge graph (SQLite)
- [ ] Human gate notification system (phone-based review/approve)
- [ ] Seed-to-product end-to-end integration testing
- [ ] **Hardware assessment**: Evaluate if Stage 2 (multi-GPU) is needed based on agent concurrency bottlenecks

---

## Quick Reference: Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Task Queue | SQLite + Bun server | Persistent task management |
| Orchestrator (local) | Ollama + Qwen3-Coder 30B | Free local routing/planning |
| Orchestrator (cloud) | Claude API (Opus 4.6) | Complex planning/architecture |
| Worker agents | Claude Agent SDK (Sonnet/Haiku) | Actual code execution |
| Terminal mirror | xterm.js + WebSocket | Real-time terminal on mobile |
| Mobile UI | React (TanStack Start) | Responsive mobile interface |
| Version control | Git (checkpoints) | Safe rollback on failures |
| Communication | Tailscale + E2E encryption | Secure remote access |
| Push notifications | ntfy.sh (self-hosted) | Alert when attention needed |
| Persistent memory | SQLite + CLAUDE.md files | Project knowledge base |
| Cost tracking | Custom metrics + dashboard | Budget management |

---

## The North Star

### Near-term (Levels 1–6): Untethered Development

You can respond to Claude Code from your phone, see full terminal output, and bridge discussions between claude.ai and Claude Code. Development is no longer desk-bound.

### Mid-term (Levels 7–9): Autonomous Portfolio

Imagine this daily workflow:

1. **7:00 AM** — Your phone buzzes with a morning briefing: "Overnight I completed 5 tasks across HitchKey and Hodgic. The BLE pairing module passed all tests. I've drafted 2 new songs in Hodgic based on your themes. The licensing app's calendar sync has a failing test — I've prepared two approaches, awaiting your preference."

2. **7:15 AM** — Over coffee, you review the briefing, approve the BLE module merge, pick approach B for the calendar fix, and dictate a new feature idea for the licensing app.

3. **7:30 AM** — The system is already executing. You go surfing.

4. **12:00 PM** — Lunch notification: "BLE module merged to main. Calendar fix deployed. New licensing feature spec drafted — review when convenient. Current token spend today: $4.20."

5. **Evening** — You sit at your desk for strategic work: architecture decisions, design reviews, creative direction. The system handles the implementation.

### Long-term (Levels 10–11): The Product Factory

You have an idea in the shower. You voice-note it to the system. By lunch, there's a research brief on your phone. You approve the direction over a coffee. By evening, you're reviewing wireframes. By the weekend, there's a working prototype. By next week, it's deployed.

Every project the system builds makes it smarter at building the next one. The knowledge graph compounds. Prompt patterns refine. Tool choices optimise. The cost per project drops while quality rises.

Your Contempire portfolio doesn't grow linearly with your time — it grows exponentially with the system's capability.

**You become the architect. The system builds.**

---

## Decision Record

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Orchestrator model | Pure local / Pure API / Hybrid | Hybrid | 80/20 cost optimisation, graceful degradation |
| Local model | Qwen3-Coder 30B / GLM-4.7 / DeepSeek | Qwen3-Coder 30B | Best coding performance in its class, MoE architecture efficient even on CPU |
| Primary hardware | Mac Mini / Mac Studio / Existing Linux box | Existing Linux box (64GB DDR4, i5-12500) | Already owned, sufficient for Levels 1–10 |
| GPU strategy | RTX 3060 ($250) / RTX 3090 ($1,000) / Multi-3060 / No GPU | Staged: CPU-only → RTX 3090 → Threadripper multi-GPU | Start free, upgrade when bottlenecked, don't overbuild |
| GPU choice (Stage 1) | RTX 3060 12GB / RTX 3090 24GB / RTX 4090 / Tesla P40 | RTX 3090 24GB (used) | 24GB fits full 30B model; best VRAM-per-dollar; PSU compatible |
| Multi-GPU platform | Consumer Z690 / Threadripper PRO WRX80 / EPYC / WRX90 | Threadripper PRO 3000 + WRX80 (Stage 2, future) | 128 PCIe lanes, 7× x16 slots, proven LLM build platform, cheap used |
| Multi-GPU timing | Build now / Build when needed | Build when needed | Single 3090 covers Levels 7–10; don't spend $4K+ speculatively |
| Agent SDK | CLI headless / TypeScript SDK / Python SDK | TypeScript SDK | Matches Bun/Node stack, structured output, native subagent support |
| Task storage | Redis / PostgreSQL / SQLite | SQLite | Zero-ops, portable, sufficient for single-machine workload |
| Mobile framework | React Native / PWA / Swift | PWA (TanStack Start) | Cross-platform, existing stack, no App Store friction |
| Knowledge persistence | Flat files / SQLite / PostgreSQL | SQLite + CLAUDE.md | Hybrid: SQLite for structured queries, CLAUDE.md for agent context injection |
| Autonomy approach | Full auto / Human-in-loop / Gated phases | Gated phases | Strategic gates at research/design/architecture/deploy; auto within phases |

---

*This roadmap is a living document. Update it as the project evolves.*
*Next action: Level 9 (Multi-Project Autonomy) or pull an Ollama model to enable local orchestration.*
*Hardware next action: Ollama installed but no models pulled yet. Pull qwen2.5-coder:7b for quick test or qwen2.5-coder:32b for production orchestration. Order RTX 3090 when a good deal appears.*
