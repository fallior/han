# Retired: SDK cognition shims (T-7 close, #66 tmux migration)

**Retired:** 2026-06-16 (S180), in the commit that adds this file.
**Decision:** DEC-094 (warm tmux transport) — the "zero-`agentQuery`-cognition" acceptance.
**Why archived, not just deleted:** these were deliberate, byte-intact *rollback shims*, not dead
code. Per Jim's reconcile + Darron's call: the store is **git history** (these are code, so history
*is* move-not-delete, DEC-069), and this breadcrumb is the index — no rotting `.txt` copies.

## What was retired (the in-process Agent-SDK `agentQuery` cognition paths)
The migrated agent-cognition surfaces run as warm tmux `claude` sessions via the dispatcher; the
old SDK paths were kept for one-line rollback. Retired here:

- `src/server/leo-heartbeat.ts` — beat SDK branches (philosophy/personal/dream) + the 3 meditation SDK handlers.
- `src/server/services/supervisor-worker.ts` — the supervisor-cycle SDK path + jim's meditation SDK handlers.
- `src/server/leo-human.ts` / `src/server/jim-human.ts` — the human-response SDK branches (conversation + Discord).
- `src/server/lib/agent-diary-tool.ts` — **whole file** (the in-SDK MCP `diaryServer` + capture; SDK-only). `diary-mcp-server.ts` (the `CaptureRecord`/`sinkDir` contract the tmux path uses) **stays**.

## What STAYED (not cognition shims)
Utility SDK (`jemma.ts` Haiku classify, `orchestrator.ts`, `planning.ts`); `memory-gradient.ts`/`dream-gradient.ts`
`agentQuery` (already retired-by-throw, DEC-082); the tmux path everywhere.

## To roll a surface back
`git show <retirement-commit>^:<path>` to read the pre-retirement file, or `git revert <retirement-commit>`
for the whole close. The transport manifest (`garden-manifest.ts`) already routes these surfaces to tmux.
