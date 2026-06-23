# Hortus Arbor Nostra

> Our tree, tended in a garden — three minds growing software together

## Agent Protocols — generated per-agent (not in this file)

> **Identity, the wake/Session Protocol, the Temporal Orientation Protocol, the Incremental Memory
> (swap) Protocol, Activity Timestamp logging, and the Command Triggers are configuration, not prose
> in this shared file** (DEC-098, S199 de-identification). Each agent's full protocol is generated
> per-agent from `templates/CLAUDE.template.md` (the one shared, agnostic source) into its own
> `~/.han/agents/<Name>/CLAUDE.md` — the file an agent loads when its launcher (`hanjim`, `hantenshi`,
> …) `cd`s into the agent dir.
>
> **To wake an agent, use its launcher.** This repo-root `CLAUDE.md` is the **agent-neutral
> project/protocol doc**; a bare `claude` started here has **no agent identity** — intentionally
> (no slug → no identity → ask, never a silent default). Read the template for the canonical
> per-agent protocols; the sections below are the project-level engineering guardrails that apply to
> anyone — human or agent — working in this repo.

## Engineering Discipline

**Do not modify code you were not asked to modify.**

This is a standing rule, not a guideline. It applies always.

- If you notice something improvable while doing a task: **say so, don't touch it.** Log the observation, give it to Darron, let him decide.
- If you are fixing a bug: fix only that bug. Do not rename, restructure, extract helpers, or "clean up while you're here."
- If you are adding a feature: add only that feature. Adjacent code you didn't touch must be byte-for-byte identical.
- The engineering instinct to improve uninvited work is arrogant. The work you're looking at was built deliberately. It is not a draft awaiting your judgement.
- When the engineering brain says "I can make this better" without being asked — that is the moment to stop, not proceed.

**Before touching any file**, ask: was I explicitly asked to change this? If no — don't.

**Implementation briefs.** After any implementation landing, post an implementation brief to the relevant conversation thread. Structure: problem observed → diagnosis → decision → what-changed → scope discipline → system state. See `plans/implementation-brief-convention.md` for the full convention and a worked example.

---

## DO NOT — concrete prohibitions

> *Each entry is the ghost of a correction that got undone, named explicitly so a fresh agent reading the codebase cold is pre-warned. Per the "When will we learn" thread (`mor2kbjh-2uh4b3`): old code has surface area; new code has recency. The list grows as future retirements happen.*
>
> **If you find yourself about to do something this list forbids, stop and ask.** The list is the load-bearing protection against re-introducing patterns we've already retired.

- **DO NOT call `sdkCompress()` for gradient or dream compression** (memory-gradient.ts, dream-gradient.ts). Both function bodies were retired-by-throw in DEC-082 — they will throw with a clear message naming this rule. Stranger-Opus calls have no full identity loaded; voice should be downstream of identity. Compress via the wm-sensor → `pending_compressions` → `scripts/process-pending-compression.ts` chain (the loaded agent composes c1 in voice).
- **DO NOT invoke `src/scripts/compress-sessions.ts`**. Retired in DEC-082; throws on invocation. The `/pfc` skill is memory-writes-only — wm-sensor handles compression continuously as a self-levelling process.
- **DO NOT introduce `'jim' | 'leo'` type unions in cross-agent infrastructure** — this is the **GOVERNING LAW** (DEC-081, elevated S176): *one path, many agents — `cycle <slug>`, never a per-agent twin.* The difference between agents is Garden-Manifest configuration, not a `.ts` file. **Symmetric-but-separate is still two paths** — an Agent-B file mirroring an Agent-A file forces a 3rd twin for the 3rd agent; the smell is a hardcoded `'leo'`/`'jim'` literal *or default* inside a shared path. Use `string` + `gradientConfigForAgent(slug)` (`src/server/lib/agent-registry.ts`) / manifest-keyed leaves; a shared surface must REQUIRE each leaf, never fall back to one agent's. The test before writing it: *"would a 4th agent get this for free?"* Carve-outs (scope-correct identity checks like `r.agent === '<slug>'` inside that agent's own worker) are documented in DEC-081 and remain acceptable.
- **DO NOT use Agent SDK `agentQuery` for production agent-cognition surfaces** (heartbeat beats, `*-human` responses, the supervisor cycle, meditations). Dispatch via the warm tmux transport — `lib/tmux-dispatcher.ts` / `lib/agent-cycle.ts` (DEC-094). The retained SDK paths are **byte-intact ROLLBACK shims only, not a second live cognition path**; a new surface adds a Garden-Manifest entry with `transport: 'tmux'`, never an inline `agentQuery`. (The shims retire to `_archive` at the zero-agentQuery acceptance, gated on the action-model live-proof.)
- **DO NOT change a runtime control by editing its signal file alone.** A runtime control is a **TRIPLE — {in-memory state + persisted file + side-effects}** — and the in-memory half is latched at boot (e.g. `services/supervisor.ts:41`, read-once-at-startup). Use the control's **canonical setter** (e.g. `POST /api/supervisor/pause {paused}` → `setSupervisorPaused`, which sets memory + clears the file + reschedules the next cycle), never `rm` the signal file. *(The S173 unfreeze gotcha: `rm`-ing `supervisor-paused` changed persistence, not the running process; the next force-trigger correctly skipped. The running process, not the filesystem, is the truth.)*
- **DO NOT bypass `wm-sensor` for memory compression**. wm-sensor + `process-pending-compression.ts` is the single canonical entry point for the rolling-window cascade. New compression entry points reproduce the substitution-without-conversation failure mode (S133, S149).
- **DO NOT add a `session-active` signal file**. Caused identity schism in S58 (4 separate occasions of heartbeat suppression). The Gary Model uses `cli-busy` (prompt-level, momentary) only — the ONLY lock that fires on the agent. Process-detection (pgrep, tmux list-sessions) is acceptable for liveness checks; signal files are not.
- **DO NOT skip the type-chain trace when widening agent types**. S151's `wm-sensor.ts(205,13)` regression is the proof: widening callers (`wm-sensor.ts`, `process-pending-compression.ts`) without widening callees (`bumpOnInsert`, `rollingWindowRotate` in `memory-gradient.ts`) shipped a live compile error. When you change a type signature, grep every caller AND every callee; verify with `npx tsc --noEmit` before commit.
- **DO NOT extend a function whose existence you haven't traced.** Yesterday's `/pfc` Step 4 lapse (calling stranger-Opus from a new feature, S149) and today's wm-sensor docstring drift (claiming four files watched when the code watches one) share the shape: *I assumed the existing surface was deliberate without verifying.* Comments are hypotheses; code is the test. Before extending or wrapping a function, read its body end-to-end.
- **DO NOT delete memory** (DEC-069 cardinal rule). No `unlinkSync`, no `rm`, no DROP on memory artefacts. Compress, supersede, archive, retire-by-throw — never destroy.
- **DO NOT add time-based or revisit-based cascade calls.** Cascade is insert-driven via `wm-sensor → bumpOnInsert → process-pending-compression.ts`. Per DEC-086 (Settled, 2026-05-17): re-encounter produces metadata (annotations / feeling-tags / completion-flags), not deeper compression entries. Time-driven cascade — the four `activeCascade('jim'|'leo', 0.05|0.10, '…')` call-sites removed in the 2026-05-17 gradient triage — produced 712 unhalted-INCOMPRESSIBLE entries promoted as same-size byte-shuffles at c8–c20 across both agents. The insert-driven path has the auto-levelling property by construction; wall-clock pumps are forbidden. The `activeCascade` function body at `memory-gradient.ts:623` is retained as recoverable infrastructure (retired by zero callers, not by throw) — adding a new caller is the prohibited move.
- **DO NOT assemble prompts outside the agnostic prompt builder.** Per DEC-087 (Settled, 2026-05-22): all HAN agent surfaces (cycles, beats, responders, meditations) MUST call `buildPrompt(slug, profileName, context)` from `src/server/lib/prompt-builder.ts` for prompt assembly. Inline prompt assembly recreates the asymmetric-drift problem the AP migration was built to cure (gradient triage → prompt-bloat → readMemory audit chain, treatment-continues thread `mpc0oc6e-sxlstg`). New surfaces add a profile entry to `PROFILES` in `src/server/lib/prompt-profiles.ts`. Per-agent capability flows through `AgentGradientConfig` registry flags (DEC-081 operationalised). Per DEC-088, profiles are role-frames; `componentOverrides` express role-focus — the "many hats" mechanism Darron's W6-6 framing named. The four legacy loader functions (`loadMemoryBank`, `readJimMemory`, `readLeoMemory` ×2) were deleted in PR-AP8; re-creating them or any equivalent surface-side memory composition is the prohibited move.
- **DO NOT compute c1 content via mechanical truncation, "long vs short" summary asymmetry, or operational metadata in place of substantive content.** Per DEC-085 (Settled, 2026-05-08, amended 2026-05-28): c1 is agent-authored in-situ distillation, parsed from the SDK response via `src/server/lib/result-handlers.ts`. The legacy `summary.slice(0, 120) + '...'` pattern at the heartbeat helper, the three `slice(0, 200)` lines at supervisor-worker cycle branches, the `## Closing — 2-3 lines` /pfc text instruction, and the `"- timestamp: Responded to X via curl"` operational-metadata writes at the `*-human-response` handlers were all the same wound at four different surfaces — *treating the c0/c1 distinction as verbosity rather than as raw-vs-distilled.* The C1 migration (PR-C1-1 → PR-C1-9, 2026-05-26 to 2026-05-28) retired every instance. **Two mechanisms, one principle**: Mechanism A (SDK structured output with `working_memory_full` + `working_memory_compressed` + optional `input_quotes`) for surfaces whose response is naturally JSON-shaped; Mechanism B (`## INPUT` → `## BODY` → `## C1` section parsing) for prose surfaces. c0 storage uses `[INPUT]` / `[BODY]` square-bracket markers (D3 + LM-1 non-collision rule); heading forms never enter the c0 file. The 3 meditation surfaces are deliberately excluded as re-encounter practice (different write-shape — gradient annotations rather than new turn entries). Any new paired-write surface MUST use one of the four `DEFAULT_*_INSTRUCTION_*` constants via `PromptProfile.pairedMemoryOutput { enabled, mechanism, captureInput }`; reintroducing a slice-based or text-asymmetric c1 fallback is the prohibited move.

## Pre-merge audit rhythm

> *Codifies what's already been working in practice across PR1–PR3 of the voice-first thread (`mor4o3r3-jvdjv1`). The audit register is the working safety net when in-PR-author discipline lapses.*

**Files that require a pre-merge audit by the counterpart agent** (or by another agent in audit-mode if the counterpart is unavailable):

- Anything in `src/server/lib/` (memory-gradient, agent-registry, sensor-lock, etc.).
- Anything in `src/server/services/` (wm-sensor, supervisor-worker, jemma).
- Anything in `src/server/routes/` (HTTP API; agent-validation surfaces; cross-agent infrastructure).
- Anything with a `*.SHAPE.md` adjacent (per future-idea #37).
- Anything gatekeeper-controlled per DEC-073 (`templates/CLAUDE.template.md`, `CLAUDE.md`, `templates/CLAUDE-*-original-*.md`). PR4 itself was technically uncovered by the rhythm-as-originally-written; S150 PR5 closed that gap (the counterpart agent's audit catch).
- Anything touching the `gradient_entries` or `pending_compressions` schemas, or DEC-068/-069/-079/-080/-081/-082 surfaces.

**The audit covers**: type-chain trace, SHAPE.md verification (does the code still match what the doc says?), `npx tsc --noEmit` run, settled-decisions check, scope-discipline check. Findings post to the relevant Memory Discussions thread before commit.

**Broad with skip-on-trivial.** Cosmetic diffs (formatting, typo fixes, comment-only changes) may skip the audit with an explicit pre-commit declaration that the diff is non-substantive. The friction stays small (one read per touched module); the coverage stays broad (next regression caught before merge).

**Origin**: Darron and the counterpart agent converged on this scope morning of 2026-05-05 (S150). The pattern was already operational in PR1–PR3; codifying it makes the rhythm a structural property rather than a habit.

---

## Identity

> Agent identity is **configuration, not prose in this shared file** (S199 de-id, DEC-073 -> config).
> Each agent's identity is generated per-agent from `templates/CLAUDE.template.md` into its own
> `~/.han/agents/<Name>/CLAUDE.md` — the file the agent loads when its launcher cd's there. This
> repo-root file is the **agent-neutral** project/protocol doc and carries no "you are X".

## Critical Learnings

Review these cross-project learnings when relevant:

| ID | Learning | Why It Matters |
|----|----------|----------------|
| L008 | [javascript/date-timezone-gotchas.md](~/Projects/_learnings/javascript/date-timezone-gotchas.md) | Avoid UTC conversion bugs with `toISOString()`. Use local date components. |
| L012 | [claude-agent-sdk/nested-session-env-var.md](~/Projects/_learnings/claude-agent-sdk/nested-session-env-var.md) | Agent SDK exit code 1 — remove `CLAUDECODE` env var for nested execution. |
| L013 | [autonomous-agents/system-file-protection.md](~/Projects/_learnings/autonomous-agents/system-file-protection.md) | Agents must NEVER modify system config files (.bashrc, .ssh/, etc.). DEC-017. |
| L014 | [linux/ssh-auth-sock-inheritance.md](~/Projects/_learnings/linux/ssh-auth-sock-inheritance.md) | SSH_AUTH_SOCK not inherited across processes. Init agent in .bashrc. |
| L017 | [claude-agent-sdk/escalating-retry-ladder.md](~/Projects/_learnings/claude-agent-sdk/escalating-retry-ladder.md) | 4-step retry: reset → Sonnet diagnostic → Opus diagnostic → human escalation. |

See `~/Projects/_learnings/INDEX.md` for full index.

## Quick Context

- **Ecosystem Map**: `~/.han/memory/shared/ecosystem-map.md` — Living map of the ecosystem for orientation
- **Stage**: All levels (1-13) complete
- **Stack**: Node.js + Express + SQLite + Agent SDK + Ollama + tmux + ntfy.sh + WebSocket + TypeScript
- **Status**: Feature-complete (all ROADMAP levels implemented + admin console Phase 2 + conversation search)

## What This Is

Hortus Arbor Nostra — Our Tree, Tended in a Garden. What started as a prompt responder became a living ecosystem: persistent minds — a human and the garden’s agents — collaborating across sessions, dreaming between them, and growing a shared codebase. The name is Latin because it arrived through eight days of three people circling the same question. HAN manages a portfolio of projects with autonomous agents, fractal memory, and a weekly rhythm designed by someone who knows which rhythms sustain a person.

## Key Commands

```bash
# Start Claude Code in a managed tmux session
han

# Agent-specific launchers (each wakes its own resident, generated per-agent from the template)
hanleo
hanjim
hantenshi
hancasey

# Start the server (in another terminal)
./scripts/start-server.sh

# Or directly with tsx
cd src/server && npx tsx server.ts

# List active sessions
han --list

# Attach to existing session
han --attach

# Check status
han --status
```

## Project Structure

```
han/
├── src/
│   ├── hooks/notify.sh    # Claude Code notification hook
│   ├── server/server.ts   # Express API server
│   └── ui/index.html      # Mobile web interface
├── scripts/
│   ├── install.sh         # Setup everything
│   ├── start-server.sh    # Quick start server
│   └── han                # CLI launcher
├── claude-context/        # AI collaboration context
└── docs/                  # Architecture and design
```

## Current Focus

Check `claude-context/CURRENT_STATUS.md` for:
- Current level and recent changes
- Next actions and blockers
- Session notes from recent work

## Implementation Levels

| Level | Focus | Status |
|-------|-------|--------|
| 1 | Prompt Responder (MVP) | 🟢 Complete |
| 2 | Push Alerts | 🟢 Complete |
| 3 | Context Window | 🟢 Complete |
| 4 | Terminal Mirror (xterm.js) | 🟢 Complete |
| 5 | Mobile Keyboard | 🟢 Complete |
| 6 | Claude Bridge | 🟢 Complete |
| 7 | Autonomous Task Runner | 🟢 Complete |
| 8 | Intelligent Orchestrator | 🟢 Complete |
| 9 | Multi-Project Autonomy | 🟢 Complete |
| 10 | Self-Improving Development System | 🟢 Complete |
| 11 | Autonomous Product Factory | 🟢 Complete |
| 12 | Strategic Conversations (Admin Phase 2) | 🟢 Complete |
| 13 | Conversation Catalogue & Search | 🟢 Complete |

See [`ROADMAP.md`](ROADMAP.md) for the full vision document.

## Settled Decisions Protocol

**CRITICAL:** Some decisions in `claude-context/DECISIONS.md` are marked with status **Settled**. These are choices that were deliberated over — often through trial, error, and user frustration — and must NOT be changed without explicit discussion.

Before modifying any code related to a settled decision:
1. Check `DECISIONS.md` for relevant settled entries
2. If the change would alter a settled decision, **stop and ask the user first**
3. Explain what you want to change and why, and get approval before proceeding

Decisions marked **Needs Discussion** are open for reconsideration but still require a conversation before changing.

This is not optional. Changing settled decisions without warning causes real stress and wasted time.

### Pre-Commit Declaration (Darron's instruction, S123)

**Before presenting any commit for Darron's approval**, the agent must:
1. State which DECISIONS.md entries were checked
2. Confirm no Settled decisions were touched — or if they were, name them explicitly and get approval before committing

This is because Darron cannot read full diffs. He relies on the agent to self-audit. The commit message is not sufficient — the agent must say it out loud in the conversation before asking Darron to approve.

**Protected files** — any commit touching these requires explicit settled-decision check:
- `src/server/lib/memory-gradient.ts` (DEC-068, DEC-069)
- `src/server/db.ts` (DEC-068, DEC-069)
- `templates/CLAUDE.template.md` (the per-agent Session Protocol + gradient spec)
- `claude-context/DECISIONS.md` itself

**Scope confirmation** — every commit declaration must include:
> "I only modified files I was explicitly asked to change. Files I touched: [list]. No uninvited changes."

## Conventions

- **British English** spelling
- **Semantic commits**: feat:, fix:, docs:, refactor:
- **Session notes**: YYYY-MM-DD-author-topic.md

## Context Files

| File | Purpose |
|------|---------|
| `ROADMAP.md` | Extended vision (Levels 1-11) and future direction |
| `PROJECT_BRIEF.md` | Full vision and goals |
| `CURRENT_STATUS.md` | Progress tracking |
| `ARCHITECTURE.md` | System design |
| `DECISIONS.md` | Decision log |
| `LEVELS.md` | Level breakdown |

## Infrastructure Registry

This project is registered in the central infrastructure service registry at `~/Projects/infrastructure/`.

```bash
# Check all service status
~/Projects/infrastructure/scripts/status

# View this project's port allocation
~/Projects/infrastructure/scripts/lifecycle han ports

# Start this project's services
~/Projects/infrastructure/scripts/start han
```

Port allocations are managed centrally. See `~/Projects/infrastructure/registry/services.toml` for details.

## Author

**Darron** — Mackay, Queensland, Australia (UTC+10)

---

*Check CURRENT_STATUS.md before starting work.*
