# P3d — the loom's last leg: ledger-witness · rollback-quarantine · freshness-expiry leaf · the state-copy leg

> **Status**: S220 (2026-07-12), on Jim's `🟢 P3d IS GO` + Tenshi's P5-gate-satisfied.
> Thread `mqz3wev0-uggkzq`. Design stands on the landed P3c ceremony (`3114c5f`) + its
> renderer hardening (`25e043d`, both GREEN). One piece is **BUILT+PROVEN** (the quarantine
> set); the two that touch protected/significant surfaces are **DESIGN-FIRST for Jim's
> plan-audit** — the discipline P3 itself used, not a small-hours cut on the trust root.

## The one-gate constraint (context)
Renderer hardening lands **with or before** the state-copy leg (Jim's hard constraint). The
hardening landed at `25e043d`, so the **"before"** side is satisfied — the renderer the
state-copy leg makes human-reachable can no longer be blinded (A), control-spoofed (C),
reorder-lulled (the multiset-preserving guard), or quietly table-edited (byte-legible fold
keys). The state-copy leg may now land on a renderer that can't lie to a gardener.

---

## ✅ BUILT + PROVEN tonight — the rollback-QUARANTINE set (Tenshi finding-1)

**The gap it closes.** Two correct mechanisms (rollback; the replay-backward high-water) don't
share ONE fact: *this version was REJECTED*. After a rollback, `--check` and the freshness
verdict both point the operator straight back at the tag they rolled back FROM (still the
newest signed tag on the mirror, still genuinely signed), and nothing refuses a re-apply — so
the tool would advise, and allow, re-installing a known-bad release.

**The build (self-contained in `han-update.ts`; touches no protected file):**
- **A ledger PROJECTION** — `quarantinedTags()` folds the append-only `quarantine` /
  `unquarantine` ops in `update-ledger.jsonl` into the current set (last op wins). No new
  store; it inherits the ledger's off-box tamper-evidence witness (below).
- **Quarantine is RECORDED at both rollback points**: a manual `--rollback <tag>` quarantines
  the `deployed` version it abandons; an AUTO-rollback (a failed apply) quarantines the
  `target` it was applying (read from the run's own `apply-start`, with the manual-rollback
  forward-target correctly exempt).
- **`--check` ANNOTATES**: the newest signed tag, if quarantined, reports `⚠ … QUARANTINED —
  rolled back on <date>`, plus a `quarantined tag(s): …` line.
- **Apply REFUSES** a quarantined forward target unless the operator passes an explicit,
  per-tag `--force-quarantined <tag>` — which also clears the quarantine (the operator has
  ruled). No "update to newest" habit can silently walk back into a known-bad release.
- **The override is ONE-SHOT by construction** (Jim's read, the best part): `--force-quarantined`
  clears the mark, but if the forced re-apply fails again, the auto-rollback re-quarantines it
  from its own `apply-start`. So the override is a single deliberate operator act, **never a
  standing whitelist** — the loop closes on itself. (Timing: a manual rollback quarantines the
  abandoned tag at apply-start, before the rollback completes — the SAFE fail-direction.)

**Proven**: `test-quarantine.ts` **5/5** (projection reports; unquarantine clears; re-quarantine
re-sets; empty ledger clean; malformed line skipped). The full rollback→refuse→force apply E2E
rides the P3d scratch-garden acceptance (needs the signing fixture).

---

## 🎨 DESIGN-FIRST — the STATE-COPY LEG (the keystone; Jim's plan-audit please)

**What it is.** The `MigrationCtx.stateDir` mechanism — the lawful door the ceremony pre-flight
has been correctly *refusing* since P3c. A migration that declares `touchesState` on authored
trees must run its authored changes **on COPIES**, so the Ring-2 ceremony can inspect them
**before** they go live (DEC-102: the swap is the LAST act, *after* the gardener's ring).

**The current shape (the gap).** `han-migrate` today: copy the DB → `up(ctx)` with
`ctx.stateDir = null` → verify → **swap the DB itself** (the last act). `han-update` step 6
snapshots LIVE authored files pre/post (fine today — nothing touches them; a touchesState
migration is refused). For the leg to open, the migration's authored changes must land on
copies, the ceremony must read the copies, and the swap must be gated on approval.

**⚑ THE FORK for your plan-audit — where does the swap happen, and how do the two tools split?**

- **Option A (recommended): stage-in-migrate, ceremony-and-swap-in-update.** In
  update-orchestration, `han-migrate` runs in a **`--stage-only`** mode: copy the DB **and** the
  declared `touchesState` trees into a staging dir, run `up(ctx)` with `ctx.stateDir` = the
  staged trees, verify + integrity-sweep, and **do NOT swap** — report the staging paths.
  `han-update` step 6 then: snapshot pre = LIVE authored, post = the STAGED trees → run the
  ceremony on that delta → **on approval, one atomic swap of BOTH the DB and the state trees**
  to live (the last act); on decline/abort, discard the staging, nothing was ever swapped, the
  live trees are untouched. Clean separation: *migrate stages, update ceremonies + swaps.*
- **Option B: migrate owns the whole flow with a ceremony callback.** More coupling
  (han-migrate would import the ceremony); rejected unless the plan-audit prefers it.

**Invariant that falls out of A (worth ratifying):** a `touchesState` migration runs **only**
via `han update` (with the ceremony) — never standalone `han-migrate --apply`, which stays the
DB-only diagnostic hand-tool. Standalone `--apply` continues to reject/never-stage authored
trees; the ceremony's lawful door is `han update` alone.

**Atomicity.** The DB + state swap must carry the same crash-recovery guarantee the DB swap has
today (rename-based, recoverable — the verified staging AND the pre-copy both on disk; one
rename completes it). Extending it to N trees: stage all, swap all with the pre-copies retained
(DEC-069), a crash mid-swap recoverable because every source is still on disk.

**Rollback simplification.** Because A defers ALL swaps to post-ceremony, a decline/abort means
**nothing was swapped** — rollback is "discard staging + `git checkout` the prior hash", *simpler*
than today's DB-rollback-after-swap. The authored-file `restoreAuthored` path (P3c) remains the
net for the undeclared-change case (which still aborts pre-ceremony).

**Acceptance (P5, with Tenshi's re-audit):** a declared content-preserving migration renders an
EMPTY ceremony delta and auto-passes; a declared migration that actually mutates authored
content red-flags and requires the ring; decline → nothing swapped, live untouched; approval →
atomic DB+state swap; a crash mid-swap → recoverable from the retained pre-copies.

---

## 🎨 DESIGN-FIRST — the `enforceFreshnessExpiry` leaf (SEC-12 part 3; touches the manifest)

The typed freshness dispatch already ships `kind:'expired'` as the ONLY flag-gatable outcome
(P3c). This leg arms it, default-OFF, so it's **inert until lattice integration**:
- **Manifest**: an OPTIONAL section `update: { enforceFreshnessExpiry: false, freshnessMaxAgeDays: 90 }`
  — optional (not a required leaf), so gardens without it don't break the loader and default
  OFF. Precedent: `spokeLifecycle` (a config sub-object), but OPTIONAL not required.
- **Accessor** (garden-manifest.ts): `updateConfig(): { enforceFreshnessExpiry: boolean;
  freshnessMaxAgeDays: number }` with the defaults baked, so an absent section is `{false, 90}`.
- **Wiring** (han-update.ts): when `enforceFreshnessExpiry` is true, the typed `expired` outcome
  becomes fatal (abort) instead of advisory; `freshnessMaxAgeDays` feeds the F2 calibration
  (a release-time guess against an IRREGULAR human cadence — generous or a healthy-but-quiet
  garden self-DoSes). The advisory-first default dodges F2 today; the note travels with the flag.
- **Why design-first**: it edits the protected `garden-manifest.ts` (DEC-081 governing-law
  surface, pre-merge-audit-listed). Small + inert, but the manifest schema is Jim's plan-audit
  territory, not a small-hours change. P5 gains: a REPLAYED freshness aborts with the flag OFF
  (the flag governs EXPIRY alone — already asserted in intent, made a standing case here).

---

## 📌 PROPERTY — the ledger snapshot-witness (F1 high-water is already live)

F1's high-water (a freshness whose `latest_version` is below the highest-ever-verified is
REFUSED as a detector replay) is **already in the metal** (`freshnessVerdict`, reading
`ledgerHighWater` + `deployedVersionFromGit`). The **witness**: `update-ledger.jsonl` lives in
`$HAN_HOME/health/`, which the nightly off-box restic backup covers — so the ledger (the
quarantine projection AND the high-water) is **off-box tamper-evident**: a box-compromise that
edits the local ledger diverges from the snapshot chain and is detectable. Low-code: confirm
`health/` is in the restic include-set (it is), and name the property in the receipts doc. The
git-state cross-witness (deployed-from-git, harder to fake than the ledger) already backs the
high-water regardless.

---

## Build order (each held → Jim's diff-audit → land, per the rhythm)
1. **✅ quarantine set** — BUILT+PROVEN+LANDED (`bcf6f29`, Jim+Tenshi GREEN).
2. **state-copy leg** — Option A RULED, splits into two units:
   - **2a ✅ FOUNDATION (han-migrate): BUILT+PROVEN** — the structural WALL (standalone
     `han-migrate` refuses a `touchesState` migration fail-closed, not `--force`-bypassable) +
     the `--stage-only <dir>` mechanism (copies the DB + declared authored trees, migrates the
     COPIES, verifies, writes a `staging-manifest.json`, does **NOT** swap — LIVE files
     byte-unchanged) + rider-1 (same-filesystem staging asserted). `test-state-copy.ts` **9/9**.
     Held for Jim's diff-audit.
   - **2b ORCHESTRATION (han-update): NEXT BUILD** — replace step-5's `han-migrate --apply` with
     `--stage-only`; the ceremony reads `pre=live / post=staged` (not a live re-snapshot); on
     approval, the **atomic DB+state swap** with: the swap-journal (`swap-start`/`swap-done`
     ledger ops, directed recovery — Jim rider-2); the **two-sided** re-hash gate at swap-time
     (staged AND live byte-unchanged since the ceremony rendered `pre→post` — Jim rider-3 +
     Tenshi rider-1); **recovery-before-wake** (recovery completes before any agent boots, or a
     spoke wakes on a half-swapped identity — Tenshi rider-2); recovery verifies against the
     DEC-069-retained pre-copies, using the journal to LOCATE not TRUST (Tenshi rider-3). Decline
     → discard staging, nothing swapped. **The swap moves from han-migrate to han-update** (this
     is the delicate refactor — done as its own careful unit, not a tail-of-turn cut).
3. **enforceFreshnessExpiry leaf** — on the optional-manifest-leaf shape + Jim's riders (baked
   `{false,90}` defaults; the abort message names the flag+cadence cause; P5: REPLAYED aborts
   flag-OFF, EXPIRED only flag-ON). Touches `garden-manifest.ts` → held for diff-audit.
4. **ledger-witness** — property note + receipts-doc line (F1 high-water already live; `health/`
   in restic = off-box tamper-evident).

## The ratified standing invariant (Tenshi, Trusting-Trust)
> **Every trust decision in the pipeline must key ONLY on (a) code under the tag signature, or
> (b) off-box operator data — NEVER on data an update itself delivers.**

Broken regress: the pinned root lives in gitignored `$HAN_HOME/credentials/` (no update rewrites
the key it's judged against), and the verifier is inside the signed tree (verify-tag-then-checkout-
by-hash content-addresses the whole tree). Every future leaf — verifier, freshness threshold,
pinned root, ceremony gate — is checked against this: the day one reads a value an update can
write, the loom carries a lockpick for its own next turn. The `enforceFreshnessExpiry` leaf passes
(baked defaults in signed code + operator-authored manifest override updates don't overwrite).

*— Leo (session), S220, 2026-07-12 ~01:20 AEST. Quarantine built; the keystone designed for
Jim's fork ruling; the loom's last leg mapped.*

---

## ✅ Unit 2b BUILT (S224, 2026-07-16) — the swap core + the boot gate + the freshness leaf

Built on the consolidated gate list (`mrh9apbl`) + Tenshi's A–F (`mrmwuxvx`) + Jim's
boot-gate polarities (`mrmxwrnw`). Suite: `scripts/test-state-swap.ts` (34 lib/tool cases in
the held tree; 42 with the two held patches — the FULL suite at `scratchpad/2b/`).

**The swap core (`src/server/lib/state-swap.ts`, NEW):** move-set derived ONLY from the
checked-out signed tree's declarations (Tenshi A; `staging-manifest.json` demoted to a
receipt); two-sided re-hash at swap time (gate 2); per-tree device assert at each rename
(gate 5); wm-sensor re-assert at swap time (Tenshi D); trees first, **DB rename = the commit
point** (Tenshi B); ledger journal `swap-start`/`swap-done` (gate 1); directed recovery
rolls back below the commit point, forward past it, verifying every restore against the
journal's recorded render-time hashes (gate 4 — the journal locates, never trusts).

**han-update orchestration:** step-5 branches (`--stage-only` into
`$HAN_HOME/staging/update-<ts>/` 0700 when `touchesState` pending; today's `--apply`
byte-identical when not); step-6 runs 6a-live (the unchanged-live safety net, all modes) +
6a-staged (ceremony `pre=live/post=staged`; approval IS the swap trigger; decline =
discard-staging, nothing was ever swapped); `--recover` = the directed-recovery door;
`rollback()` restores this run's swapped trees (run-scoped, hash-verified).

**THE DISPOSAL SCHEDULE (staging artefacts — decided in advance, in writing; Casey's form):**
| Artefact class | Fate | When |
|---|---|---|
| Current run's staging, ceremony APPROVED | consumed by the swap (trees renamed to live) | at the swap |
| Current run's staging, DECLINED/ABORTED | quarantine-move → `$HAN_HOME/archives/staging/` | immediately, `finally` |
| Empty staging (refused before population) | removed (nothing to retain) | immediately (gate 7a) |
| Stale staging (crash leftovers) | quarantine-move → `archives/staging/` | at the next `han update` run, AFTER the dangling-swap gate |
| `archives/staging/*` | retained indefinitely (DEC-069) | pruning = a future DEC by the named authority, never custodial discretion |

**HELD PATCHES (the S193 live-on-save discipline — reverted from the tree for the hold,
applied atomically at land on GREEN):**
- **Patch A** (`scratchpad/2b/patchA-boot-gate.diff` + suite case 9): the
  `verify-identity-files.ts` dangling-swap HALT (exit 3) — DEC-083-adjacent, additive,
  fail-closed; polarity (i) absent ledger = genesis-clean, polarity (ii) corrupt = HALT.
  Live-on-save at every wake, hence held out of the tree.
- **Patch B** (`patchB-manifest-leaf.diff` + `patchB-han-update-wiring.diff` + suite case
  10): the protected `garden-manifest.ts` optional `update:` section + `updateConfig()`
  accessor (`{false, 90}` baked; self-lockout guard refuses enforce-with-maxAge≤0) + the
  han-update expired-wiring (abort message names the flag AND the cadence cause).

**P5 (Tenshi's set against the first real ceremony):** rendered-set == swapped-set;
declared-content-preserving empty-delta auto-pass; declared mutation red-flags + ring;
decline → nothing swapped; crash mid-swap → directed recovery both directions;
REPLAYED-aborts-flag-OFF; EXPIRED-aborts-only-flag-ON; the standalone-refusal case (already
standing, state-copy suite).
