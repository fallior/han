<!--
  P5 fix plan — the ceremony enumeration seam (rendered-set == swapped-set).
  Author: Tenshi (session), 2026-07-16. Thread: mqz3wev0-uggkzq (finding mrnd1cqj-4iyyzg).
  For: Leo to implement, Jim to audit. Reproduction: scratchpad/2b/p5-enumeration-seam-probe.ts.
-->
# P5 fix — close the ceremony enumeration seam (rendered-set == swapped-set)

## Problem (reproduced, mrnd1cqj)

The Ring-2 ceremony renders only the **fixed `IDENTITY_FILES` set**, but the swap moves the
declared tree **wholesale**. So a declared, content-preserving migration that leaves the identity
files byte-identical while rewriting a *non-identity* file in a declared tree
(`working-memory.md`/`working-memory-full.md` — the c0/c1 gradient sources — `session-swap*.md`,
`quiet-hours.md`, `darron-open-loops.md`, non-aphorism fractal flats) produces an **empty authored
delta → the DEC-102 content-preserving auto-pass → the swap carries the change to live UNRENDERED.**
DEC-102's "a mind changes only when a signature AND human eyes both say so" is defeated for the whole
non-identity memory surface. Reproduced against the real ceremony functions (probe exit 2).

## Root, from source

- `ring2-ceremony.ts:snapshotAuthoredAt` iterates `IDENTITY_FILES` per resident — a **fixed named
  list**, not a directory walk. That is the ceremony's entire authored artefact-set.
- `han-update.ts` 6a-staged builds `stagedDeltas = compareAuthored(pre, postStaged)` over that fixed
  set, then `verdict = ring2Verdict(stagedDeltas, declarations)`. `verdict.kind === 'unchanged'` →
  content-preserving auto-pass, swap runs with no ring.
- `state-swap.ts:executeSwap` moves every file under each declared tree; `verifyStagingSet` permits
  any file inside a declared tree.
- rendered-set = { IDENTITY_FILES ∩ declared trees }; swapped-set = { all files ∩ declared trees }.
  The gap is every non-identity file in a declared tree.

## The fix (the elegant move — reuse the hash the swap already computes)

Make the ceremony's approved delta-set cover the **whole** declared-tree move-set, so the
content-preserving auto-pass fires **only** when the declared tree is byte-identical staged↔live.
The machinery already exists and is unused at verdict time:

- `state-swap.ts:hashTree(root)` — deterministic sha256 over `${rel}\u0000${hash}` for every file in
  a tree (via `treeEntries`, which already computes per-file hashes).
- `treeEntries(root)` — the per-file `{rel, hash}` list. One walk yields **both** the whole-tree hash
  (the auto-pass gate) **and** the per-file diff (the render-set) with no extra IO.

**The gate:** the content-preserving auto-pass requires, for every declared tree,
`hashTree(staging/tree) === hashTree(live/tree)`. If any declared tree's staged hash ≠ live hash, the
change is in the tree but the identity-file delta was empty ⇒ the change is in **non-identity files**
⇒ NOT an auto-pass; escalate to the ceremony and render the changed non-identity files.

**The render (only when the gate escalates):** build `AuthoredDelta` entries for the non-identity
declared-tree files that differ (changed / appeared / removed), merge them with the identity
`stagedDeltas`, and let the existing `ring2Verdict` + `renderCeremonyDocument` do the rest — the
gardener sees the actual non-identity change and rings. Because `treeEntries` already hashed every
file, the "which files differ" set is free; content is read only for the differing files, only when
escalating — so a genuine content-preserving migration (nothing changed) stays a cheap auto-pass.

## Implementation (file-by-file, precise)

1. **`state-swap.ts` — expose the per-tree, per-file diff.** Add a pure helper, e.g.
   `declaredTreeFileDeltas(stagingDir, hanHome, tree, excludeRels: Set<string>): Array<{rel, staged: string|null, live: string|null}>`
   built on `treeEntries` (reuse it; do not add a second walk): union the staged and live rel-sets,
   emit an entry for every rel whose staged hash ≠ live hash (or that appears/disappears),
   **excluding** rels in `excludeRels` (the IDENTITY_FILES relpaths, already rendered — dedupe so no
   file renders twice). Read content lazily only for emitted rels. Keep it a pure function (scratch
   testable), no systemd/side-effects.

2. **`ring2-ceremony.ts` — a small adapter to `AuthoredDelta`.** Add
   `nonIdentityTreeDeltas(residentLabel, entries): AuthoredDelta[]` mapping each `{rel, staged, live}`
   to the existing `AuthoredDelta` shape (`kind:'file'`, `name` = the rel path from `$HAN_HOME` for a
   legible ceremony line, `pre`/`post` `AuthoredArtefact`s with content+sha256, `absPath` = the live
   path). **Verify `renderCeremonyDocument` and the per-artefact raw-bytes diff render a
   non-IDENTITY_FILE delta with no special-casing** — the `AuthoredDelta` shape is generic, so it
   should, but confirm the render path doesn't key on `IDENTITY_FILES` anywhere (if it does,
   generalise it; the raw-bytes renderer must treat any delta identically — control-byte / homoglyph /
   reorder hardening already landed must apply to these too).

3. **`han-update.ts` 6a-staged — gate + merge.** After the identity `stagedDeltas`, for each declared
   tree in `moveSet` compute the per-tree entries once; derive the whole-tree staged↔live equality
   (the gate) and, if unequal, the non-identity deltas (excluding the IDENTITY_FILES rels). Merge them
   into the delta-set passed to `ring2Verdict`. Net semantics:
   - whole declared tree byte-identical (identity **and** non-identity) → `verdict 'unchanged'` →
     genuine content-preserving auto-pass (unchanged behaviour for the truly-nothing-changed case);
   - any change, identity **or** non-identity → `verdict 'ceremony'` → rendered + the gardener's ring.
   This is computed at **verdict time** (pre-migration live vs post-migration staged). The existing
   `captureSwapHashes` (post-approval, for the re-hash integrity between ring and rename) stays as-is —
   a different purpose; do not conflate the two.

## Acceptance tests (test-state-swap.ts + a ceremony test)

- **The P5 probe becomes a regression case** (`scratchpad/2b/p5-enumeration-seam-probe.ts`, invert the
  assertion): the content-preserving-identity + poisoned-`working-memory-full.md` scenario must now
  yield `verdict 'ceremony'` (NOT 'unchanged'), and `working-memory-full.md` must appear in the
  rendered deltas.
- **Genuine content-preserving (nothing in the tree changed)** → still `verdict 'unchanged'`, auto-pass
  preserved.
- **Identity-file-only change** → still `verdict 'ceremony'` (behaviour unchanged).
- **Non-identity-only change** → NOW `verdict 'ceremony'` with the non-identity file rendered.
- **Appeared / removed non-identity file** in a declared tree → rendered (appear/disappear delta).
- **Nested file** (a declared-tree subdirectory) → rendered (the walk recurses; `treeEntries` already
  does).
- **No double-render**: an IDENTITY_FILE under a declared tree appears exactly once (the exclude set).
- **The P5 invariant, asserted directly**: rendered/approved file-set == swap move-set (minus the DB +
  sidecars, which are governed by the schema/verify/DB-rehash legs) — the equality the gate exists to
  guarantee.

## Settled-decision note (DEC-102)

DEC-102 (the Ring-2 ceremony) is **Settled**. This change does **not** weaken it — it **completes**
its "human eyes" guarantee by making the content-preserving auto-pass fire only when the declared tree
truly did not change, closing the coverage gap between the rendered set and the moved set. The
auto-pass *semantics narrow* (from "identity files unchanged" to "the whole declared tree unchanged"),
so it must be **named in the pre-commit settled-decisions declaration** for Darron's check at land —
flagged, not assumed. No other Settled decision is touched.

## Scope discipline

Touches `state-swap.ts` (new pure helper), `ring2-ceremony.ts` (the `AuthoredDelta` adapter; a sealed
DEC-102 file → full pre-merge audit) and `han-update.ts` 6a-staged (gate + merge), plus the test file.
`ring2-ceremony.ts` runs live-adjacent — hold per the S193 discipline if any hunk reaches a live path.
Build held for Jim's diff-audit; then Tenshi re-runs the P5 probe (now a regression case) + the rest of
the P5 set against the first real ceremony. Nothing else in the tree changes.
