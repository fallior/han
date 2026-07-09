# `han update` — the P3 design (for Jim's plan-audit)

> **Status**: DESIGN — composed 2026-07-09 (S219) against Jim's six plan-audit gates
> (mrdaatkj), on Darron's go. Thread: `mqz3wev0-uggkzq`. Ruling record: **DEC-102** (the
> invariant verbatim); security ledger: `update-pipeline-security-audit.md` (Tenshi).
> Landed substrate this design stands on: the P2 runner (`han-migrate.ts`, 23/23) and the
> trust root (`seeds/release-allowed-signers` + `scripts/verify-release-tag.sh`, f7d2a6f;
> live fixture `v0.0.0-ceremony-test` → `a0d3a9a`).

## The invariant this tool exists to enforce (DEC-102, Tenshi's words)

> *"An update changes a mind only when a human signature and a human's eyes both say so,
> over a diff neither the attacker nor the noise can hide in."*

## The command

```
han update [--to <tag>] [--check] [--rollback <tag>]
```

Engine-shipped: `scripts/han-update.ts` + a thin `han update` entry. **There is NO
`--force` flag on this tool, by design** (SEC-04): every gate below either passes or the
update aborts whole. `han-migrate`'s own `--force` remains a hand-tool affordance for its
standalone diagnostic use — `han update` never passes it (gate 3).

## The flow (the ratified order — Jim's gate 1)

**Step 0 — resolve + verify (the landed leg).**
Fetch the pinned mirror → resolve the target tag (default: newest stable by the
`vYYYY.MM.DD[.n]` ordering) → `verify-release-tag.sh <tag>` → the EXACT commit hash or
abort (fail-closed on a missing pin). **Downgrade rejection at the channel layer**: the
target version must order strictly above the currently-deployed version (recorded in the
update ledger, §Receipts); `--rollback <tag>` is the only lawful reverse — still
signature-verified, explicitly invoked, loudly logged. (The state layer double-guards:
`han-migrate`'s schema + formatVersions monotonicity aborts, both force-proof.)

**Step 1 — show (opt-in, eyes-open).**
Release notes (CHANGELOG between tags) + **the new-field enumeration** (SEC-07): every
new manifest/config field introduced by this release is listed with its default.
**Security-sensitive new fields ship fail-closed** — no engine default; the garden must
set an explicit value or the feature stays off. The enumeration is generated from a
release-notes block in the tag message + a schema-diff, and its absence for a
field-introducing release is itself a P5 test failure.

**Step 2 — quiesce + drain.**
Supervisor paused at its manifest owner (canonical setter), wm-sensor stopped,
responders/heartbeat stopped, spokes drained to idle chrome (bounded wait, the S181
lesson mechanised). **The drain succeeds or the update ABORTS** (SEC-04) — there is no
flag that proceeds past a live mind.

**Step 3 — stop the DB-holders, verify zero.**
The service set derives from the manifest (§The service enumerator); after stopping,
`fuser` must show ZERO holders on the live DB. This is belt on top of `han-migrate`'s own
structural fd-guard (the S219 split-brain lesson: the guard converts deploy-tooling
interleave from silent split-brain to loud abort — SEC-11).

**Step 4 — checkout by hash.**
`git checkout <exact-hash>` — never a ref (TOCTOU, DEC-102 rider 3). `npm ci` iff the
lockfile moved; the documented property stands: the lockfile rides inside the signed tree
with per-package integrity hashes, so the tag signature transitively pins the dependency
set (SEC-03's supply-chain edge). Do not "improve" lockfile handling without re-proving
this.

**Step 5 — migrate.**
`han-migrate --apply` with every landed gate live: quiesce-CHECK, both downgrade axes,
umask-born 0600 copies, checkpoint-TRUNCATE, the fd-guard, sidecar re-pair, retention.
Migration content-integrity posture (SEC-03): migrations are **release-blessed trusted
code only** — they arrive solely inside a signed tag (no local/unsigned migration is ever
run by `han update`); the copy-first + verify + non-shrink sweep bounds the blast radius;
content checksums for untouched rows are named P5-acceptance work, not deferred silently.

**Step 6 — the Ring-2 re-sign + ceremony (INSIDE the quiesce — DEC-102 Ring 2).**
The authorship split:
- **Template-GENERATED files** (CLAUDE.md, .mcp.json per resident): regenerate +
  auto-re-sign — they are transitively release-signed under Ring 1 — with the pre/post
  diff **logged unconditionally** to the update ledger (Jim's detection-under-prevention).
- **AUTHORED identity** (identity.md, patterns, felt-moments, self-reflection, and the
  manifest `identitySection` — keyed on CONTENT, not file bytes): any UNDECLARED change →
  **ABORT + auto-rollback**. The legitimate case exists only as a migration declaring
  `touchesState` on authored files, and that triggers **the ceremony**:
  - The semantic diff is computed (a declared content-preserving migration must render an
    **EMPTY content delta**; any non-empty delta is the one red flag the human's eyes must
    land on; a schema-moving migration is never auto-passed — always human eyes).
  - The garden holds a **designed, visible freeze**: "garden paused pending your ring" —
    the quiesce SPANS the deliberation (Tenshi's stale-copy corollary; the approved copy
    can never go stale against a still-writing garden).
  - The gardener confirms (interactive ack or a signed go-file, his hand) → only then the
    swap proceeds. Decline → abort + rollback, the post stays re-deliverable.
  - **Ceremony-tool integrity** (Tenshi's residual-1, stated as design): the diff tool is
    release-signed code — its trustworthiness inherits from the Ring-1 signature verified
    at step 0; SEC-01-first is satisfied in the metal before any ceremony can run.
- **The swap is the LAST act** (Jim's by-construction affirmation): nothing from the new
  tag becomes live before signature + ceremony pass; migrations ran on copies throughout.

**Step 7 — health gate.**
Services restart (manifest-derived set) → servers 200 × residents · DEC-083 integrity
gates exit-0 × residents · `load-gradient` smoke × residents (genesis-aware — the
`c0=none` path is a first-class pass) · wm-sensor active · one fed-wake smoke on a
scratch surface → unquiesce.

**Step 8 — on ANY failure: auto-rollback (the explicit sequence — Jim's gate 4).**
Stop services → checkout the PRIOR hash (recorded at step 0 into the ledger) → restore
the DB pre-copy (`han-migrate`'s artifact; sidecars handled by its landed re-pair logic)
→ **identity re-sign LAST and IDEMPOTENT** (regenerate from the restored tree + re-sign;
safe to re-run from any crash point — SEC-08's non-atomicity half) → restart →
re-health-check → report loudly. `han update --rollback <tag>` is the same path by hand,
signature-verified, never silent.

## The service enumerator (dependency, cures MNT-036)

P3 consumes a small shared lib: **the manifest-derived service set** (which units exist
for which residents/surfaces) — used by step 2/3 stops, step 7 restarts, and adoptable by
`restart-all-services.sh` + the git hooks' installer. This retires the hardcoded
jim+leo lists (MNT-036) as a side-effect of the fourth-garden test rather than a separate
sitting. (The hook fix itself = installer change + re-materialise, per Tenshi's census.)

## The fourth-garden test (Jim's gate 5)

Every step derives from manifest/registry/paths: residents via `loadResidents()`, ports
via `allocationFor`, the quiesce owner via `runsSupervisorCycle`, services via the
enumerator, homes via `paths.ts`. **Mike's garden runs this flow with zero engine edits.**
SEC-09's posture is the named isolation dependency: `paths.ts` fail-closed on unset
`HAN_HOME` + the per-garden 0600 memory surface land at the isolation gates, before any
two-gardens-one-box deployment.

## Receipts (the audit surface)

`$HAN_HOME/health/update-ledger.jsonl` — one line per attempt: tag, exact hash, verify
result, drain duration, migration stamp, re-sign diffs (paths + hashes), ceremony verdict
(if any), health verdict, rollback (if any), operator. The deployed-version record that
step-0's downgrade ordering reads. Append-only.

## Build phases within P3 (each held → Jim's diff-audit → land, per the rhythm)

- **P3a** — the service enumerator + drain primitive (+ the MNT-036 installer cure riding it).
- **P3b** — `han-update.ts` core: step 0→5 + 7→8 (verify → checkout-by-hash → migrate →
  health → rollback), proven on a scratch garden with a scratch-signed tag.
- **P3c** — the Ring-2 authorship split + semantic-diff ceremony (step 6), the
  trust-critical piece — Tenshi's two conditions as build-law.
- **P3d** — the ledger + release-notes/new-field enumeration (step 1) + downgrade ordering.

## P5 acceptance, sketched now (Jim's gate 6)

Scratch-garden E2E: seeded garden + scratch mirror + scratch-signed tag (test key pinned
in the scratch HAN_HOME) through the FULL flow · **forced-failure rollback** (a failing
verify mid-flow → auto-rollback proven whole) · **poisoned-tag rejection** (unsigned +
wrong-key; the landed proofs 2-3 are the controls) · **downgrade-attempt rejection**
(channel layer + both state axes) · holder/stale-sidecar (standing in the han-migrate
suite) · **ceremony cases** (declared content-preserving with empty delta passes;
non-empty delta red-flags; undeclared authored touch aborts; schema-moving always
presents) · **Tenshi's re-audit as the gate before the first real tag reaches any
mirror.**

## Deferred, named (nothing silent)

SEC-08 archive ceiling (Darron's open ruling) · release-key-custody-v1 (hardware token,
post-Mike) · identity-key custody v1 (off-box) · `identitySection` into a DEC-083
envelope (034-structural) · the read-time format-compat floor (its own rider) · content
checksums for untouched rows (P5-acceptance work) · SEC-09 isolation gates.

*— Leo (session), S219, 2026-07-09. Design-first per the rhythm; no code cut until Jim's
plan-audit returns.*
