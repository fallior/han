# Documentation Assistance Protocol (DocAssist)

> Standard operating procedure for maintaining project documentation during autonomous work.
>
> Referenced by: Supervisor system prompt, worker context injection (`buildTaskContext`)
>
> Authority: This document defines mandatory behaviour. CLAUDE.md files may reference it
> via `See docs/docassist.md for documentation maintenance protocol.`

---

## 1. Why This Exists

### The Problem We Discovered

In February 2026, we ran an end-to-end test using clauderemote to autonomously build
**realadlessbrowser** — a standalone web app (Bun + TanStack Start + Tailwind v4 + Anthropic SDK).
The human-interactive kickoff session created full documentation scaffolding, recorded three
architecture decisions, and established the project vision. The autonomous agents then built the
entire MVP across 14 commits.

**The code was excellent.** Well-typed, properly tested (29 tests), good error handling, security-
conscious, and architecturally sound. The agents followed the planned architecture and respected
the L001 server route constraint.

**The documentation was abandoned.** After the autonomous build:

| Document | Expected State | Actual State |
|----------|---------------|--------------|
| CURRENT_STATUS.md | "MVP Complete" with progress log | Still said "Ready to Scaffold" |
| ARCHITECTURE.md | Reflects actual implementation | Still had planned architecture (wrong search engine, missing patterns) |
| DECISIONS.md | 6+ decisions from build process | Only 3 from the pre-build kickoff |
| Session notes | 2-3 notes covering the build | Zero from autonomous work |
| Learnings | 2-3 from implementation discoveries | Zero |

### Why This Matters

When Darron returned to the project, he could not:

1. **Trace discovery** — No record of why DuckDuckGo was chosen over Google, why HTML parsing
   used regex instead of cheerio, or why two-layer ad filtering was implemented
2. **Understand the build** — The only way to reconstruct what happened was reading git diffs
3. **Debug confidently** — No architectural notes to consult when something breaks
4. **Transfer knowledge** — If another project needs similar patterns, there's no documented
   reference to draw from

### The Benchmark

In human-interactive development, every session in this ecosystem produces:
- Updated CURRENT_STATUS.md (progress, next actions, blockers)
- New entries in DECISIONS.md for any significant choices
- Architecture updates when the system design evolves
- Session notes summarising what was accomplished
- Learnings when non-obvious problems are solved

Three reference projects (favourfair, portwright, hodgic) all maintained this standard with
4-5 decisions, 1-3 session notes, filled architecture docs, and maintained status files —
even from their earliest sessions.

**The autonomous pipeline must match this standard.** The quality of the work is diminished
if it cannot be understood, traced, or learned from after the fact.

---

## 2. The Root Cause

The gap exists because of two missing pieces in the pipeline:

### 2.1 Workers Don't Maintain Documentation

`buildTaskContext()` in `context.ts` gives workers:
- Project CLAUDE.md and CURRENT_STATUS.md (read-only context)
- Settled decisions (read-only reference)
- Cross-project learnings (read-only reference)
- Knowledge capture markers (`[LEARNING]`, `[DECISION]`)

But workers are never instructed to **write** to these files. The knowledge capture markers
go to the `task_proposals` database table for human review — they are never incorporated into
the project's actual documentation files.

### 2.2 The Supervisor Has No Documentation Action

The supervisor can `create_goal`, `adjust_priority`, `update_memory`, `send_notification`,
`cancel_task`, and `explore_project`. None of these produce project documentation. The
supervisor's memory banks (`~/.claude-remote/memory/`) are private to the supervisor — they
don't update the project's claude-context files that humans and future Claude Code sessions read.

### 2.3 No Documentation Phase in Goal Planning

When `planGoal()` decomposes a goal into tasks, there is no concept of a documentation task.
The planner creates implementation tasks but never a final task to update documentation with
what was built, decided, and learned.

---

## 3. The Protocol

### 3.1 Goal-Level Documentation Task (Mandatory)

Every goal that modifies a project's codebase MUST include a **final documentation task**
as the last task in the plan. This task depends on all other tasks completing first.

The planner should generate this task automatically with a prompt like:

```
Update project documentation to reflect the work completed in this goal.

Files to review and update:

1. **claude-context/CURRENT_STATUS.md**
   - Update "Current Stage" to reflect new progress
   - Add entries to "Recent Changes" with today's date
   - Update "What's Working" with newly functional features
   - Move completed items in "Next Actions" to done
   - Add new next actions discovered during implementation
   - Update "Known Issues" if any were found or resolved

2. **claude-context/ARCHITECTURE.md**
   - Update system diagrams if components were added or changed
   - Update directory structure if new files/directories were created
   - Update API endpoints if routes were added or modified
   - Update data models if types/interfaces changed
   - Document new patterns introduced during implementation

3. **claude-context/DECISIONS.md**
   - Add DEC-XXX entries for every significant choice made during this goal
   - Include: Context, Options Considered (with pros/cons), Decision, Consequences
   - Significant choices include: library selections, architectural patterns,
     API design choices, data model decisions, trade-offs made

4. **claude-context/session-notes/YYYY-MM-DD-autonomous-[topic].md**
   - Create a session note summarising the goal's work
   - Include: Summary, What Was Built, Key Decisions, Code Changes, Next Steps
   - Author should be "Claude (autonomous)" to distinguish from human sessions

5. **CLAUDE.md**
   - Update "Quick Context" if stage or stack changed
   - Update "Key Commands" if new scripts were added
   - Update "Project Structure" if directory layout changed

6. **PROJECT_INSTRUCTIONS.md**
   - Update tech stack table if dependencies changed
   - Update implementation phases if progress was made
   - Update project structure if layout changed

Read the existing content of each file before updating. Preserve existing style and
conventions. Use British English throughout. Do not remove existing content unless it
is factually incorrect — append and update instead.
```

### 3.2 Decision Capture Standard

Every decision recorded must follow this structure, which matches the ecosystem's DECISIONS.md
template:

```markdown
### DEC-XXX: [Title]

**Date**: YYYY-MM-DD
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context
[What situation prompted this decision during the build?]

#### Options Considered
1. **[Option A]**
   - ✅ [Pro]
   - ❌ [Con]

2. **[Option B]**
   - ✅ [Pro]
   - ❌ [Con]

#### Decision
We chose **[Option]** because [reasoning].

#### Consequences
- [What this means going forward]
```

**What counts as a decision in autonomous work:**

| Always Record | Don't Record |
|---------------|-------------|
| Choosing one library/service over another | Which variable names to use |
| Picking an architectural pattern | Routine implementation steps |
| Selecting a data source or API approach | Standard framework conventions |
| Making a trade-off (speed vs accuracy, etc.) | Following existing project patterns |
| Deviating from the planned architecture | Minor code organisation choices |
| Choosing a testing strategy | Using obvious best practices |

### 3.3 Learning Capture Standard

When the `[LEARNING]` markers from worker output are extracted, they should be written to
both the proposals table AND to the project's `claude-context/learnings/` directory if they
meet the threshold:

**Write to file when:**
- Severity is HIGH or MEDIUM
- The learning is reusable across projects
- The learning involves a non-obvious fix or workaround

**Learning file format:**

```markdown
# [Title]

> [One-line summary]

## Problem
[What was being attempted]

## Challenge
[What made it difficult]

## Solution
[How it was resolved]

## Key Insight
[The core takeaway]

---

*Discovered: YYYY-MM-DD (autonomous)*
```

### 3.4 Session Note Standard for Autonomous Work

Autonomous session notes should be clearly distinguished from human-interactive ones:

```markdown
# Session: [Goal Title]

**Date**: YYYY-MM-DD
**Author**: Claude (autonomous)
**Goal ID**: [goal-id]
**Tasks**: [X] completed, [Y] failed
**Cost**: $[total]
**Duration**: ~[X] minutes

## Summary
[2-3 sentences on what was accomplished]

## What Was Built
- [Component/feature 1] — [brief description]
- [Component/feature 2] — [brief description]

## Key Decisions
- **DEC-XXX: [Title]** — [One-line summary of why]

## Technical Notes
- [Implementation detail worth remembering]
- [Non-obvious approach taken and why]

## Files Changed
- `path/to/file.ts` — [What changed]

## Issues Encountered
- [Problem and how it was resolved]

## Commits
- `abc1234` — [commit message]
```

### 3.5 Architecture Updates

ARCHITECTURE.md must reflect the **actual built system**, not the planned one. After
autonomous work, the documentation task should verify:

- [ ] System diagram matches actual component relationships
- [ ] Directory structure matches actual file layout
- [ ] API endpoints match actual routes
- [ ] Data models match actual TypeScript interfaces
- [ ] Key patterns section documents actual patterns used
- [ ] External services section lists actual integrations
- [ ] Security considerations reflect actual measures taken
- [ ] Performance considerations reflect actual approaches

### 3.6 Status Tracking

CURRENT_STATUS.md is the most time-sensitive document. After every goal completion:

- [ ] "Current Stage" reflects reality
- [ ] "Progress Summary" phase table is updated
- [ ] "Recent Changes" has dated entries for this goal
- [ ] "What's Working" lists newly functional features
- [ ] "Next Actions" removes completed items and adds discovered ones
- [ ] "Known Issues" is updated (new issues found, old issues resolved)
- [ ] "Session Notes" links to the new autonomous session note

---

## 4. Implementation Guide

### 4.1 For the Goal Planner (`planGoal` in planning.ts)

When decomposing a goal into tasks, the planner MUST:

1. Create all implementation tasks as normal
2. Append a final task with:
   - `title`: `docs: Update project documentation for [goal-title]`
   - `description`: The documentation update prompt from Section 3.1
   - `model`: `sonnet` (documentation doesn't need Opus)
   - `depends_on`: All other task IDs in this goal
   - `max_turns`: 15 (enough to read existing files and update them)

This ensures documentation is always the last step and has full context of what was built.

### 4.2 For Worker Context (`buildTaskContext` in context.ts)

Add to the autonomous agent context block:

```
- **Documentation:** If this is a documentation task, read ALL existing claude-context/
  files before updating. Preserve style, append rather than replace, use British English.
  Record decisions with full ADR format. Create session notes for significant work.
```

### 4.3 For the Supervisor

The supervisor should monitor documentation freshness as part of its project exploration.
When exploring a project (`explore_project` action), check:

1. Does CURRENT_STATUS.md reflect the latest git commits?
2. Are there decisions in the code (library choices, patterns) not recorded in DECISIONS.md?
3. Is ARCHITECTURE.md's directory structure accurate?
4. Are there recent autonomous goals with no corresponding session notes?

If documentation is stale, the supervisor should create a documentation maintenance goal:

```
Goal: Update project documentation to reflect current state

This project's documentation is out of date. The last CURRENT_STATUS.md update was
[date] but there have been [N] commits since then. Review the git log, read the
codebase, and bring all claude-context/ files up to date.
```

### 4.4 For Knowledge Extraction (post-task processing)

After a task completes successfully, the system already extracts `[LEARNING]` and `[DECISION]`
markers into `task_proposals`. Extend this to also:

1. If the marker is `[DECISION]` with severity implications, queue it for the documentation
   task to incorporate into DECISIONS.md
2. If the marker is `[LEARNING]` with HIGH severity, write it directly to the project's
   `claude-context/learnings/` directory (don't wait for human review — HIGH severity
   learnings need to be available to future workers immediately)

---

## 5. Quality Checklist

Before a goal is marked complete, verify documentation meets this minimum bar:

### Must Have (block goal completion if missing)
- [ ] CURRENT_STATUS.md reflects the work done
- [ ] Any new routes, components, or services are in ARCHITECTURE.md
- [ ] At least one session note exists for the goal

### Should Have (flag for supervisor attention if missing)
- [ ] Decisions recorded for non-trivial choices
- [ ] Directory structure in ARCHITECTURE.md matches reality
- [ ] "What's Working" in CURRENT_STATUS.md lists new features

### Nice to Have (capture if time permits)
- [ ] Learnings from non-obvious solutions
- [ ] Updated PROJECT_INSTRUCTIONS.md
- [ ] Performance notes from implementation experience

---

## 6. Anti-Patterns

### Don't: Write Documentation Before Implementation

The documentation task MUST run after all implementation tasks complete. Writing docs
based on the plan rather than the actual build is what caused the realadlessbrowser gap —
the planned architecture said "Google/Bing" but the implementation chose DuckDuckGo.

### Don't: Over-Document Routine Work

Not every task needs a learning or decision record. Reserve decisions for genuine choices
between alternatives. Reserve learnings for genuinely non-obvious discoveries. Routine
implementation following established patterns needs only a status update and session note.

### Don't: Replace Existing Content

Always read existing documentation before updating. Append new entries to "Recent Changes"
rather than replacing the section. Add new decisions with the next sequential ID rather
than overwriting. The documentation is a historical record — preservation matters.

### Don't: Skip Documentation for "Small" Goals

Even a two-task goal that fixes a bug should update CURRENT_STATUS.md and note what was
fixed. The cost of a Sonnet documentation task is negligible compared to the cost of
losing context.

### Don't: Duplicate Supervisor Memory into Project Docs

The supervisor's memory banks (`~/.claude-remote/memory/projects/*.md`) are for the
supervisor's private reasoning. Project documentation (`claude-context/`) is for humans
and Claude Code sessions. These serve different audiences and should contain different
levels of detail. The supervisor's memory might note "scraper is fragile, watch for DDG
changes" — the project docs should explain the full architecture and decision rationale.

---

## 7. Reference: The realadlessbrowser Case Study

### What the Autonomous Agents Built (14 commits)

| Commit | What |
|--------|------|
| `64f99fe` | Initialised project with Bun, installed dependencies |
| `1dfb977` | TypeScript, Vite, Biome configuration |
| `4e25e98` | Environment and git configuration (.env.example, .gitignore) |
| `19b899b` | TanStack Start entry points and root layout |
| `7f6afaf` | SearchBar component |
| `55a1c35` | ResultsList component and shared types |
| `eaac7ab` | Search engine result scraper (DuckDuckGo HTML) |
| `4c46225` | Claude-based ad classifier |
| `f83f7fb` | /api/search server route |
| `3b20c5a` | Vitest unit tests for classifier and scraper |
| `9c894f6` | Additional tests |
| `33274e5` | Wired up search page with end-to-end flow |
| `e957db2` | Hardened edge cases, error handling, security |
| `bb36864` | Linting fixes and build verification |
| `5d25a54` | Fixed Anthropic SDK error class imports |

### Decisions That Should Have Been Recorded

| ID | Decision | Why It Matters |
|----|----------|----------------|
| DEC-004 | DuckDuckGo over Google | No API key needed, scraping-friendly HTML endpoint. Critical architectural choice. |
| DEC-005 | Regex HTML parsing over cheerio/jsdom | Zero dependencies, sufficient for DDG's simple HTML structure. Trade-off: fragile if DDG changes markup. |
| DEC-006 | Two-layer ad filtering | DDG structural pre-filter (CSS classes) + Claude semantic classification. Reduces API calls and improves accuracy. |
| DEC-007 | Conservative classification default | When Claude is uncertain, default to "organic" rather than "ad". Prevents false positives. |

### Learnings That Should Have Been Captured

| Learning | Insight |
|----------|---------|
| DDG HTML endpoint | DuckDuckGo's `html.duckduckgo.com/html/` accepts POST with `q` form field. No auth needed. Returns parseable HTML with `result__a` and `result__snippet` classes. |
| Claude JSON in code fences | Claude often wraps JSON responses in `` ```json `` code fences even when asked for raw JSON. Must strip markdown before parsing. |
| URL sanitisation | Search result URLs from external sources must be sanitised — only allow `http:` and `https:` protocols to prevent XSS via `javascript:` URLs. |

---

## 8. Versioning

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-02-18 | Initial protocol based on realadlessbrowser case study |

---

*Documentation is not overhead — it is the knowledge layer that makes autonomous work
trustworthy, traceable, and transferable. Without it, the agents are writing code into
a void.*
