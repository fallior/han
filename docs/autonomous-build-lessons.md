# Autonomous Build Engineering Standards

> Lessons from the realadlessbrowser post-mortem: engineering hygiene failures
> that autonomous agents must prevent.
>
> Companion to: `docs/docassist.md` (documentation maintenance protocol)
>
> Authority: This document defines mandatory behaviour for project initialisation
> and infrastructure compliance. Supervisor goal plans MUST include tasks that
> enforce these standards.

---

## 1. Why This Exists

### Two Failures the Code Review Didn't Catch

The autonomous build of **realadlessbrowser** produced excellent code — well-typed,
29 tests, proper error handling, L001 compliant server routes. A human reviewing
the source files alone would give it high marks.

But a human reviewing the **project as a whole** found two significant engineering
hygiene failures:

| Issue | Impact | Discovery |
|-------|--------|-----------|
| `node_modules/` committed to git | 9,718 files (1.9M lines) tracked, cross-platform binary failure | Manual audit |
| Infrastructure registration skipped | Port collision with resumewriter, invisible to PortWright | Manual audit |

Neither failure would surface during development on the build machine. Both caused
real problems when the project was cloned to a different environment. Both were
entirely preventable.

**These are not code quality issues. They are engineering discipline issues.** The
autonomous agents knew how to write TypeScript but did not know how to manage a
project within an ecosystem.

---

## 2. Issue One: node_modules Committed to Git

### What Happened

During the autonomous build, `node_modules/` was added to git tracking. The
`.gitignore` file correctly listed `node_modules` — but it was created or
populated **after** the initial `git add` had already staged the directory.

Once a file is tracked by git, adding it to `.gitignore` has no effect. The
9,718 files (1.9M lines) remained in every commit.

### Symptoms

When the project was cloned to a macOS machine (darwin-arm64) from a Linux
build environment (linux-x64), the platform-specific native binaries were wrong:

```
error: Cannot find module @rollup/rollup-darwin-arm64
```

The `node_modules/` contained `@rollup/rollup-linux-x64-gnu`,
`@esbuild/linux-x64`, `@tailwindcss/oxide-linux-x64-gnu`, and other
Linux-only binaries. A fresh `bun install` was required — but git was still
tracking the old files, creating a permanent diff of deleted Linux binaries.

The fix required `git rm -r --cached node_modules` followed by a commit that
deleted 9,718 files. This bloats the git history permanently.

### Root Cause

The autonomous agent executed steps in the wrong order:

```
1. git init                    ✓
2. bun install                 ✓ (creates node_modules/)
3. git add .                   ✗ (stages node_modules/)
4. create .gitignore           ✗ (too late — already tracked)
5. git commit                  ✗ (commits node_modules/)
```

### Prevention Protocol

**MANDATORY for all new project initialisation:**

```
1. git init
2. Create .gitignore FIRST — before ANY other files
3. .gitignore MUST include at minimum:
   - node_modules/
   - .env
   - dist/
   - .output/
   - *.local
4. git add .gitignore && git commit -m "chore: initial gitignore"
5. THEN install dependencies
6. THEN create source files
7. THEN commit source files
```

**MANDATORY for all commits:**

- NEVER use `git add .` or `git add -A` without first running `git status`
  to verify what will be staged
- Prefer staging specific files by name: `git add src/routes/index.tsx`
- If `node_modules/` appears in `git status` output, STOP — something is wrong

**For the supervisor:** The first task in any "create new project" goal MUST be
creating `.gitignore` with ecosystem-standard exclusions. This task MUST complete
before dependency installation begins. Add a dependency edge:

```
Task 1: "Create .gitignore with standard exclusions" (no dependencies)
Task 2: "Install dependencies" (depends on Task 1)
Task 3: "Scaffold project files" (depends on Task 1)
```

---

## 3. Issue Two: Infrastructure Registration Skipped

### What Happened

The autonomous build hardcoded port `10800` in `vite.config.ts` and `package.json`.
This port was chosen by the agent without consulting the infrastructure registry.

**Port 10800 belongs to resumewriter** (project index 8). The computed application
base port for index 8 is `10000 + (8 × 100) = 10800`. Running both projects
simultaneously would cause a port conflict.

The project was never registered in `~/Projects/infrastructure/registry/services.toml`,
making it invisible to:
- The PortWright service dashboard
- The `infrastructure/scripts/status` health checker
- The `infrastructure/scripts/lifecycle` management tool

### The Three-Tier Port System

Every project in the ecosystem receives a `project_index` and gets three
deterministic port blocks:

| Tier | Formula | Block Size | Purpose |
|------|---------|-----------|---------|
| Supabase | `54000 + (index × 50)` | 50 ports | Database, API, Studio |
| Application | `10000 + (index × 100)` | 100 ports | Web servers, APIs, workers |
| Data | `6000 + (index × 20)` | 20 ports | Redis, queues, caches |

Individual services use offsets within their block. The primary web server is
always at offset 0 (the base port itself).

**Example:** realadlessbrowser was assigned index 13:
- Application base: `10000 + (13 × 100) = 11300`
- Primary web: `11300`

### Root Cause

The autonomous agents had no awareness of the infrastructure registry. The
project's `CLAUDE.md` mentioned the port allocation system and included
commands for checking allocated ports, but:

1. Workers receive abbreviated context (first 3000 chars of CLAUDE.md) — the
   infrastructure section was likely truncated
2. No task in the goal plan addressed infrastructure registration
3. The agent defaulted to a "reasonable looking" port number that happened to
   collide with an existing allocation

### Prevention Protocol

**MANDATORY for all new projects:**

Registration in the infrastructure registry is not optional. Every project MUST:

1. Check `~/Projects/infrastructure/registry/services.toml` for the next
   available `project_index`
2. Check `~/Projects/infrastructure/registry/port-ranges.toml` for
   `next_project_index` (note: this value may be outdated — always verify
   against `services.toml`)
3. Add entries to:
   - `registry/services.toml` — project configuration block
   - `registry/repos.toml` — GitHub repository mapping
   - `registry/port-ranges.toml` — allocation record, update `next_project_index`
4. Use the computed port in all configuration files — NEVER hardcode a port
   without verifying it against the registry

**For the supervisor:** Include an explicit infrastructure registration task
in every "create new project" goal. This task MUST complete before any
configuration that involves port numbers:

```
Task 1: "Register project in infrastructure registry" (no dependencies)
Task 2: "Create .gitignore" (no dependencies)
Task 3: "Configure dev server with allocated port" (depends on Task 1)
Task 4: "Install dependencies" (depends on Task 2)
```

**For context injection:** When a goal involves creating a new project or
configuring ports, `buildTaskContext()` should inject:

```
CRITICAL: This ecosystem uses a centralised port allocation system.
NEVER hardcode port numbers. Check ~/Projects/infrastructure/registry/services.toml
for the next available project_index and compute your port as:
  app_port = 10000 + (project_index × 100)
```

---

## 4. Summary: Pre-Build Checklist

Before any autonomous build begins, the supervisor MUST ensure the goal plan
includes tasks for ALL of the following:

| Step | Task | Depends On | Why |
|------|------|-----------|-----|
| 1 | Create `.gitignore` with standard exclusions | — | Prevents tracking build artifacts |
| 2 | Register in infrastructure registry | — | Allocates ports, enables monitoring |
| 3 | Install dependencies | Step 1 | `.gitignore` must exist first |
| 4 | Configure dev server with allocated port | Step 2 | Port must come from registry |
| 5 | Scaffold source files | Steps 1, 3 | Dependencies must be installed |
| 6 | Update documentation | Steps 1-5 | Per docassist.md protocol |

Steps 1 and 2 are independent and can run in parallel. Steps 3 and 4 have
specific dependencies. Step 6 is always last (see `docs/docassist.md`).

---

## 5. Detection: How to Spot These Issues

If the supervisor is auditing an existing autonomous build, look for:

### node_modules in git
```bash
git ls-files node_modules | head -5
```
If this returns any files, `node_modules/` is tracked. Fix with:
```bash
git rm -r --cached node_modules
git commit -m "chore: remove node_modules from git tracking"
```

### Missing infrastructure registration
```bash
grep "projectname" ~/Projects/infrastructure/registry/services.toml
```
If no match, the project is not registered. Check for hardcoded ports:
```bash
grep -r "port.*[0-9]\{4,5\}" vite.config.* package.json app.config.*
```

---

## 6. Cross-References

- **Documentation gaps:** `docs/docassist.md` — companion protocol for
  maintaining CURRENT_STATUS.md, DECISIONS.md, ARCHITECTURE.md, and learnings
  during autonomous work
- **Infrastructure registry:** `~/Projects/infrastructure/registry/` — the
  three-tier port allocation system
- **PortWright dashboard:** `~/Projects/portwright/` — service visibility and
  health monitoring
- **Case study project:** `~/Projects/realadlessbrowser/` — the autonomous
  build where both issues were discovered

---

*Engineering standards are not bureaucracy — they are the guardrails that prevent
autonomous agents from creating work for humans to clean up later.*
