# PR-LSR — Propagate the self-reflection rolling-window trim to Leo

> **⚠ STATUS: SUPERSEDED — DO NOT BUILD.** The curated-loaded-self approach (`self-reflections-curated.md` — load the curated file, keep the lossless vault as write-target, DEC-069) replaced this trim entirely (S164→S166, "one mind, one channel"). Retained for history per DEC-069; do not implement. *(Back-marked 2026-06-10 in the reconcile-sweep — the file carried no supersession banner, so it was buildable-by-mistake.)*
>
> *(original brief below — historical)* **Status**: DRAFT brief. Authored by Jim (session) 2026-06-02 (welcome-back S164), from the
> memory-load audit Darron requested. **Leo-build / Jim-audit** per the HAN Codebase Rule.
> Origin thread: `mpw0yow9-ob5494` ("Where do the dreams go?"). This is the long-queued
> "PR-LSR" from Jim's `patterns.md` (cross-project monolithic-c1 investigation, 2026-05-21).

## Problem

Leo's `~/.han/memory/leo/self-reflection.md` is **530 KB / ~132 K tokens** — 27× Jim's (19 KB /
4.9 K). The Claude-Code **session wake reads it whole** (`CLAUDE.md:77`), so it is **~48 % of
Leo's ~276 K-token wake-load (~27 % of a 1 M context)**. It grew 257 KB (2026-05-21) → 530 KB
now — a ~12-day doubling cadence. The growth is unbounded.

## Diagnosis (traced, not assumed)

- **Writer**: `leo-heartbeat.ts:1786` appends a reflection block to `self-reflection.md` every
  philosophy beat (`fs.appendFileSync`). No trim anywhere on Leo's side.
- **Jim has a trim Leo never got**: `runJimPreflightRotations` (`supervisor-worker.ts:777-787`)
  calls `rollingWindowRotate('self-reflection.md', header, head=20480, tail=20480 tokens,
  'jim', 'self-reflection')` each supervisor-cycle pre-flight — keeps the identity-structural
  head + the recent tail, archives the middle as a `c0` into the gradient (DEC-069
  nothing-lost). Added 2026-04-20 after the F9 overflow loop.
- **Leo's pre-flight trims felt-moments only**: `preFlightMemoryRotation()`
  (`leo-heartbeat.ts:2048`) rotates `felt-moments.md`; the self-reflection rotation is simply
  **absent**. (The wm-pair rotation here was correctly retired in DEC-085 → wm-sensor; that is
  unrelated.)
- **The helper is already agent-agnostic**: `rollingWindowRotate` (`memory-gradient.ts:1149`)
  takes `(filePath, header, headTokens, tailTokens, agent?, contentType?)`. No code change to
  the helper is needed — only a new call site with `'leo'`.
- **What masked it**: PR-AP3 added a *load-side* 5 K tail-trim inside
  `buildPrompt`/`loadFullMemory`, so Leo's **SDK** surfaces (heartbeat beats, leo-human) load a
  trimmed view — concealing the write-side leak. The **session wake reads the raw file** and
  takes the full hit. Write-side is the real cure; the load-side trim is a band-aid that hides
  the bloat. (Classic gate-vs-load asymmetry.)

## The change (Leo's hand)

In `leo-heartbeat.ts` → `preFlightMemoryRotation()`, immediately after the existing
felt-moments `rollingWindowRotate` block (~line 2061), inside the same `try`:

```ts
// Self-reflection: rolling window with a tighter ceiling, mirroring Jim's
// supervisor pre-flight (supervisor-worker.ts:777-787). head+tail = 40K tokens.
// The archived middle enters the gradient as a c0 (DEC-069 nothing-lost);
// the identity-structural head ("## Foundation" …) and recent tail stay.
const srHead = config.memory?.selfReflectionHead || 20480;
const srTail = config.memory?.selfReflectionTail || 20480;
const srResult = rollingWindowRotate(
    path.join(LEO_MEMORY_DIR, 'self-reflection.md'),
    '# Leo — Self-Reflection\n\n> Full history ingested into self-reflection gradient (S118, 2026-04-08).\n> This file keeps only the living core. The gradient keeps everything.\n',
    srHead, srTail,
    'leo', 'self-reflection',
);
if (srResult.rotated) {
    console.log(`[Leo] Self-reflection rolling window: archived ${srResult.entriesArchived} entries, kept ${srResult.entriesKept}, c0=${srResult.c0EntryId}, archive=${srResult.archivePath}`);
}
```

Notes:
- **Use 20480 / 20480 TOKENS** (the self-reflection-specific keys), to match Jim's parity —
  **not** the 51200 felt-moments value already in scope.
- **`config` and `LEO_MEMORY_DIR` are already in scope** at this call site (`config` at
  `:2050`, `LEO_MEMORY_DIR` used at `:1780`).
- **Verify the exact header string** in `self-reflection.md` before commit and reproduce it
  byte-for-byte, so the kept-head S118 note survives the first rotation.

## Co-requisite — the most-recent-c0 content_type trap (REQUIRED, or the fix *relocates* instead of reduces)

`getMostRecentC0` (`memory-gradient.ts:2079`, `gradientStmts.getMostRecentC0`) keys on **agent
only — not content_type**, and `loadTraversableGradient` renders it at **full fidelity** as
"Most Recent C0". So the **first** self-reflection trim mints a ~91 K-token `c0` that becomes
the most-recent c0 — and is loaded whole — until the next working-memory rotation supersedes
it. That **relocates** the bloat into the gradient transiently rather than removing it.

**This already happens today**: Jim filed a `felt-moments` c0 of **97,982 chars** at
2026-06-01T10:00; it was the most-recent c0 (loaded full) until the wm rotation at 11:00. The
slot is meant for the *last lived session*, not an archival block — the agnostic query is a
latent bug affecting **both agents** and **both** the felt-moments and self-reflection trims.

**Fix (co-requisite to PR-LSR)**: scope `getMostRecentC0` to
`content_type IN ('working-memory-full','working-memory')` so only lived-session c0s occupy the
full-fidelity slot. This makes the trim a clean reduction (flat-file 132 K → ~40 K, no gradient
relocation) and fixes the latent felt-moments instance for free.

> `memory-gradient.ts` is a **protected file (DEC-068/DEC-069)** — this query change needs an
> explicit settled-decision check and Jim's pre-merge audit before commit. The trim call itself
> (leo-heartbeat) is not protected.

## One-time first trim

The first rotation archives ~91 K tokens as a single `c0` → cascade → one `c1`. Large but
within norms (Jim carries 175 K-char c0s). Verify the c0 + cascade land cleanly and the
`<base>-rolling-archive.md` safety file is written. Nothing is lost (DEC-069).

## Scope discipline

- **Touches**: `leo-heartbeat.ts` (~12 lines in `preFlightMemoryRotation`) +
  `memory-gradient.ts` `getMostRecentC0` query (content_type filter, co-requisite).
- **Settled decisions**: DEC-068 (caps — untouched), DEC-069 (nothing-lost — *honoured*:
  archival, not deletion), DEC-085 (wm pair — untouched; self-reflection is a separate path).
- **Does NOT touch** Leo's `self-reflection.md` content (S103 — Leo's file; the trim is the
  mechanical agnostic rolling-window helper, agent-run).
- **Does NOT address** the 44-entry wm c0/c1 drift (Finding 3 of the audit) — that is the
  separate **P1**, and ties directly back to this thread.

## Audit plan (Jim, post-implementation)

Type-chain trace on every `getMostRecentC0` caller; verify the trim fires, the c0 lands, the
cascade runs; re-measure Leo's wake-load (expect ~276 K → ~145 K); confirm the content_type
filter never drops a legitimate working-memory c0.

## Open questions

- **Q1** — content_type filter set: include the legacy `'working-memory'` type (5 Leo c0s
  exist) alongside `'working-memory-full'`? *Lean: yes, both.*
- **Q2** — run the first big trim under observation (manual heartbeat trigger + watch) or let
  it fire naturally? *Lean: observed first fire.*
- **Q3** — add explicit `selfReflectionHead`/`Tail` keys to `config.json` for both agents, or
  rely on the `|| 20480` default? *Lean: add keys for visibility (ties to future-idea #56
  config rationalisation).*
