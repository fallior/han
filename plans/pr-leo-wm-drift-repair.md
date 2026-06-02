# PR-WMDR — One-time repair of Leo's conserved c0/c1 working-memory drift

> **Status**: DRAFT brief. Authored by Jim (session) 2026-06-02 (welcome-back S164), as the
> **P1** sibling of `pr-leo-self-reflection-trim.md`. **Leo-build / Jim-audit** per the HAN
> Codebase Rule. Origin thread: `mpw0yow9-ob5494`. This is the drift Leo found this morning.
>
> **Sequencing note**: this is the "stem the bloat now" repair. Darron's emerging
> memory-unification vision (future-idea #77 — all memory through wm) will revisit this whole
> mechanism. Keep this repair **surgical** — clear the drift, drain the file, don't re-architect.

## Problem

Leo's working-memory pair is structurally drifted and the slicer cannot self-heal it:
`working-memory-full.md` = 95 KB (~45 entries, the c0 source) vs `working-memory.md` = 844 bytes
(~1 entry, the c1 source). The forensic log shows a **persistent drift = 44** across every
cycle (`~/.han/health/wm-rotation-events.jsonl`): full ~62-64 / compressed ~18-20, and after a
successful slice → 45 / 1, **still 44**.

## Diagnosis (traced)

- **Root cause**: a past window of **full-only writes** — the body landed in
  `working-memory-full.md` but the paired compressed c1 counterpart was skipped. This matches
  the silent-fail-audit period (2026-05-29→30) where surfaces emitted prose acknowledgement
  without the structured/diary c1 (the 100 %-JSON-emit-failure window, closed by #67). Those
  ~44 full entries are **orphans** — real lived content with no c1 sibling.
- **Why it never drains**: `rollingWindowRotatePaired` (`memory-gradient.ts:1635`) uses
  **smaller-of-two recovery** — it slices an *equal* count from both tails (min(full,
  compressed)). That is correct as an ongoing safety net, but it **conserves a pre-existing
  surplus forever**: slicing 19 from each of (64, 20) leaves (45, 1) — the 44-gap is preserved,
  and `working-memory-full.md` drains slower than the beats fill it, so it grows.
- **Not a slicer code bug** — it's a **data artefact** the slicer's conservative design
  refuses to paper over. The fix is a one-time data re-alignment, not a slicer change.

## Options

- **Option A — per-entry re-pair (most faithful, heavy)**: Leo (loaded, in voice) authors a
  compressed c1 counterpart for each of the ~44 orphan full entries, writes them to
  `working-memory.md`, re-aligns the pair, places a `WM-BOUNDARY`, lets it rotate. Faithful but
  44 distillations of old material is a large lift.
- **Option B — consolidated re-pair as a deliberate exercise (LEAN)**: Leo authors a *small
  number* of consolidated c1 distillations covering the orphan block (grouped by the natural
  arcs in those ~44 entries), pairs them with the corresponding c0 block(s), places markers,
  and slices once to clear the drift to 0. This is the **same deliberate, self-focused shape**
  Darron describes for self-reflection curation (future-idea #77) — not a mechanical bulk
  dump, but Leo reading his own orphaned days and distilling them honestly. Fewer, truer c1s.
- **Option C — conserve (rejected)**: do nothing; the slicer keeps conserving the gap and the
  file keeps growing. This is the status quo that produced the bloat.

**My lean: B.** It clears the drift, drains the file, keeps every full entry (DEC-069), and the
re-pairing is an act of curation rather than a mechanical fix — consistent with where #77 is
taking us.

## Constraints

- **DO NOT `sdkCompress()`** (DEC-082) — the consolidated c1s must be authored by **loaded Leo
  in voice**, not the stranger-Opus path.
- **DEC-085** paired-write discipline — c0 and c1 rotate as an aligned unit; markers map them.
- **DEC-069** nothing-lost — keep the `working-memory-full.md` content (archive before any
  rewrite); the repair re-pairs, it does not discard.
- **S103** — Leo's memory; Leo authors the consolidated c1s. Jim audits, does not write them.

## Audit plan (Jim, post-repair)

Verify drift → 0 in `wm-rotation-events.jsonl`; confirm `working-memory-full.md` drains and the
pair is entry-aligned; confirm the orphan content is preserved (archive + gradient c0s);
confirm subsequent normal rotations stay paired.

## Open questions

- **Q1** — group the ~44 orphans into how many consolidated c1s? *Lean: by natural arc
  (likely 3-6), Leo's call on the boundaries.*
- **Q2** — should the slicer additionally **alert** on persistent large drift (it already
  writes `wm-drift-<agent>.md`; is a louder signal warranted)? *Lean: the existing signal is
  enough; this is a one-off, not a recurring class once #67's fix holds.*
- **Q3** — do this **before or after** PR-LSR (self-reflection trim)? *Lean: independent; can
  land in either order. Both are "stem the bloat now" ahead of the #77 unification.*
