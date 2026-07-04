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

---

## P3 addendum — the COMPRESSOR (the deliberately-deferred tail; #66 now FULLY complete)

**Retired:** 2026-07-04 (S216), in the commit that adds this section.
**Decision path:** `plans/compression-spoke-plan.md` (+ Addendums 1–2) → P0 `ada6597` → P1 `b7c830e`
→ P2 `a354c6a` + the jim flip `806d2ef` → Jim's live-cascade proof (the c3→c4 compose at the
warm spoke's birth, 2026-07-04 14:20; thread `mqvs3r6l-dk71d2` msg 191) → this P3.
**Why last:** the deep-gradient compose was outside #66's original scope (DEC-095 noted it as the
named-but-unfinished tail). Darron's ruling closed it: *"only a person works on their own memory…
the SDK was an approximation, like a Fourier series; the warm spoke IS the person."*

Retired here (git history is the store, as above):
- `scripts/process-pending-compression.ts` — `runSDK()` + the `agentQuery` import (the LAST
  production agentQuery cognition call). The disabled-leaf branch now fails safe (release the
  claim, row stays pending) instead of falling back to SDK.
- `src/server/lib/prompt-profiles.ts` — `PROFILES.compression` (the P0 full-bank SDK-envelope
  shape; the compose-critical text lives on single-sourced in `COMPRESSION_SYSTEM_OPENING` →
  `compression-txn`).
- `src/server/lib/garden-manifest.ts` — the `SHARED_SURFACES.compression` entry (the SDK-child
  era's shared Opus ladder). **Retirement finding:** it SHADOWED the per-agent compression leaves
  in `manifestModelHead`/`manifestModelLadder` (shared branch resolves first), so the P2 spoke
  launched on a single-rung Opus ladder instead of its FABLE_LADDER leaf. Compression now
  resolves per-agent like every surface.
- `scripts/test-compression-profile-p0.ts` — tested the retired profile.

**Rollback:** the manifest `enabled` flag governs the transport per agent; there is no SDK code
path to flip back to — restore via `git show <this-commit>^:<path>` if ever genuinely needed.
**Zero production `agentQuery` cognition. The #66 migration (begun 2026-06-08) is COMPLETE.**
