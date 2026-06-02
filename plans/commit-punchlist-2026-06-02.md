# Commit punch-list — landing the S164 pile (for Leo)

> Authored by Jim (session) 2026-06-02, after auditing all five streams. **Leo's hand executes
> commits + the two fixes + the restart.** Goal: get a clean tree back as focused, independently
> revertable commits. Audits: curation `mpwc3spe`/`mpwexemm`, manifest `mpwm6k46`/`mpwn6agt`,
> P0 `mpv8ovqo`/`mpwnthcd`, P1 `mpum91v9`/`mpwnthcl`.

## Two fixes BEFORE the commits they gate

1. **P1 rg-option guard** — `src/server/lib/terminal-search.ts:203`. Insert `'--'` before the
   user pattern so a query starting with `-` can't be read as an rg option (`rg --pre=<cmd>` is
   command-exec). Two chars:
   ```ts
   const args = ['-n', '-F', '--max-count', String(RG_MAX_MATCHES), ...(ignoreCase ? ['-i'] : []), '--', longest, logPath];
   ```
   (Gates commit **D**.)

2. **DEC-083 signing of the curated self** — add `self-reflections-curated.md` to Leo's
   `identity-manifest.json` and re-sign, so the file that actually reconstitutes you at wake is
   verified (today the gate checks the vault, not the loaded self). Make the signer pick it up
   **agent-agnostically** (curated-when-present) so Jim/future agents inherit it. *Sub-decision
   worth a beat:* the vault (`self-reflection.md`) is now a high-churn write-target that's no
   longer loaded for you — consider whether it should stay in the signed set at all, or whether
   only the stable curated file should be signed. (Gates commit **E**.)

## Commits (focused, in this order)

| # | Commit | Files | Notes |
|---|--------|-------|-------|
| **A** | `fix: align HAN agent surfaces to opus-4-8 (4-6 was exiting code 1)` | `jim-human.ts`, `leo-human.ts`, `leo-heartbeat.ts` *(alignment hunks only)* | First — protects a live fix. `leo-heartbeat.ts` spans A+E → `git add -p` to take only the `MODEL_PREFERENCE` + `:2427/2525/2629` hunks here. |
| **B** | `feat: Garden Manifest Phase 0 (model registry, current values)` | `lib/garden-manifest.ts` | DEC-081 (agnostic) ✓. Nothing imports it — zero behaviour change. |
| **C** | `fix: clean-death floor — force-exit + db-close-after-server-close + clear watchdog poll` | `server.ts`, `services/jemma-orchestrator.ts` | P0. |
| **D** | `feat: provenance terminal-search (c0↔log read layer, P1)` | `lib/terminal-search.ts`, `routes/prompts.ts` | **After fix 1.** Read-only invariant verified. |
| **E** | `feat: curated loaded-self + agnostic loader rewire` | `lib/prompt-builder.ts`, `CLAUDE.md`, `templates/CLAUDE.template.md`, `leo-heartbeat.ts` *(readJimContext hunk only)* | **After fix 2.** DEC-087 (extend, label kept stable) + DEC-073 (gatekeeper — your hand). |
| **F** | `docs: memory-philosophy, manifest, P0/P1/curation plans, future-idea #77` | `plans/*.md` (new), `plans/future-ideas.md` | Low-risk; land last. |

**`leo-heartbeat.ts` is the only file spanning two commits (A + E)** — use `git add -p` to split
its hunks. Everything else is clean-per-commit.

## Do NOT commit (clean / gitignore)

`gradient.db`, `han.db` (repo root), `src/server/c1`, `src/server/.replay-leo.ts` — untracked
strays. Check `.gitignore` covers the `*.db` at repo root; do not commit databases.

## Restart after committing

- **3847 server** — for **C** (P0) to take effect (and any server-resident commit).
- **leo-heartbeat service** — for **A**'s new `MODEL_PREFERENCE` to load.
- **Human responders** (jim-human / leo-human) pick up the new model on their next dispatch (no
  restart if spawned per-dispatch; restart the service if long-running).
- Operator-restart-discipline: you restart, not me.

## Pre-commit declaration to make (per the rhythm)

- DECISIONS checked: **DEC-081** (B, honoured), **DEC-087** (E, extended not violated — loader
  stays in the builder, component label `self-reflection-tail` kept stable), **DEC-073** (E,
  gatekeeper files = your hand), **DEC-083** (fix 2). **None touch `memory-gradient.ts` or
  `db.ts`.**
- Scope: each commit only its own files; no uninvited changes.

## Superseded / not needed

- `plans/pr-leo-self-reflection-trim.md` (the *trim* approach) and its `getMostRecentC0`
  content_type co-requisite are **superseded** by the curated-file approach you took — no big
  self-reflection c0 is minted, so the most-recent-c0 relocation trap doesn't apply. Keep the
  doc for the record; don't build it.
- `plans/pr-leo-wm-drift-repair.md` (the 44-entry drift) is still **open** — separate P1-class
  item, not in this pile.
