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

**Step 0 — resolve + verify (the landed leg) + the freshness check (SEC-12).**
Fetch the pinned mirror → resolve the target tag (default: newest stable by the
`vYYYY.MM.DD[.n]` ordering) → `verify-release-tag.sh <tag>` → the EXACT commit hash or
abort (fail-closed on a missing pin). **Then the anti-withholding check (SEC-12, Jim's
spec at Darron's go)**: verify `freshness.json` — `{latest_version, released_at,
expires_at, prev_version}`, **signed by the SAME garden-release key at the SAME release
ceremony** (zero recurring burden: freshness is only ever as old as the last real
release), verified against the SAME pinned root, never against anything the mirror says
about itself. A mirror that lies about freshness fails the signature; one that serves OLD
freshness is caught by the timestamp. **Verify-and-REPORT now**: "you are N releases /
N days behind" or "this freshness is D days old — the mirror may be stale/withholding."
**Hard-expiry sits behind the manifest leaf `update.enforceFreshnessExpiry` (default
FALSE, inline comment citing this decision + DEC-102) — the flag IS the structural
memory**: flipped true at lattice integration, a stale/expired freshness ABORTS
(fail-closed, SEC-01 polarity). `han update --check` doubles as the standing freeze
detector (Tenshi): one line — last deployed tag + age vs the mirror's newest signed
offer — so a human glances instead of holding the threat in their head.
**THE FATAL-vs-ADVISORY SPLIT (Jim's audit affirmation — named here so no 'consolidation'
softens F1)**: `BAD-SIGNATURE` and `REPLAYED` are HARD-FATAL — a forged or replayed
freshness is a detected attack, same class as the tag-downgrade guard, never flag- or
force-bypassable; `EXPIRED` is the flag-gated advisory (F2's availability calibration);
`ABSENT` is the honest advisory. P3c types this dispatch structurally (Tenshi #2) and P5
asserts REPLAYED aborts with the flag OFF. **F1 (Tenshi): freshness gets its OWN downgrade guard** — the ledger records the highest
`latest_version` ever seen in a VERIFIED freshness, and a freshness whose `latest_version`
is below that high-water mark is REFUSED (an older-but-genuinely-signed, not-yet-expired
freshness is a replay-downgrade of the detector itself; the cousin of the tag guard, same
cure). **F2 (Tenshi): arming `enforceFreshnessExpiry` is a security-vs-availability
calibration, not a free win** — expiry is a release-time guess against an IRREGULAR human
cadence, so `freshnessMaxAgeDays` must be generous relative to the real cadence or a
healthy-but-quiet garden self-locks out of updates (its own denial-of-service). The
advisory-first default dodges this today; the calibration note travels with the flag.
**Downgrade rejection at the channel layer**: the target must order strictly above the
deployed version (recorded in the update ledger, §Receipts) — with the witness caveat
named (Tenshi #4): the ledger is a LOCAL, unsigned file, so the channel guard's witness
is bounded by box integrity; the **checked-out git tag is cross-checked as the second,
harder-to-fake witness**, the ledger joins the off-box tamper-evident snapshot chain for
detectability, and the state layer double-guards regardless (`han-migrate`'s schema +
formatVersions monotonicity, both force-proof). `--rollback <tag>` is the only lawful
reverse — still signature-verified, explicitly invoked, loudly logged.

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
`fuser` must show ZERO holders on the live DB — **fail-closed on cannot-verify** (fuser
absent/failed = abort), matching the migrate-side guard's polarity exactly (Jim's add-2).
This is belt on top of `han-migrate`'s own structural fd-guard (the S219 split-brain lesson: the guard converts deploy-tooling
interleave from silent split-brain to loud abort — SEC-11).
**THE INVARIANT (Tenshi A1 — write it so it can't be optimised away): the enumerator is
CONVENIENCE; `fuser`-zero is the SAFETY.** The enumerator's dangerous failure direction is
under-enumeration (a missed holder survives into the swap = SEC-11); what makes that safe
is that fuser-zero checks the KERNEL'S actual holders independent of what the enumerator
knew. A future "optimisation" that trusts the enumerated set and drops the fuser check
silently re-opens SEC-11 — P5 asserts it (enumerator-misses-a-holder → fuser still
aborts). And the distinct guarantees stated once: `spoke-drain` proves minds are AT REST;
`fuser` proves the DB is RELEASED — idle chrome is not fd-release; both are needed.

**Step 4 — checkout by hash.**
`git checkout <exact-hash>` — never a ref (TOCTOU, DEC-102 rider 3). `npm ci` iff the
lockfile moved; the documented property stands: the lockfile rides inside the signed tree
with per-package integrity hashes, so the tag signature transitively pins the dependency
set (SEC-03's supply-chain edge). Do not "improve" lockfile handling without re-proving
this. **The pin's honest limit (Tenshi #3): pinning closes WHICH code arrives, not that
its install-scripts EXECUTE** — `npm ci` runs dependency lifecycle scripts by default,
and ours isn't pure-JS (better-sqlite3's native build), so `--ignore-scripts` isn't free.
Named residual with its cure path: **vendor/prebuild the native modules** (update-time
`npm ci` fetches and runs nothing) or an explicit scripts-allowlist for the native deps;
until then the residual is bounded by the pin, not eliminated by it.

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
- **The release ceremony's own doc** (`docs/release-key-ceremony.md`, P3c): signing a
  release = the tag AND `freshness.json`, one deliberate act (SEC-12's sign-at-ceremony).

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
**A2 (Tenshi — the cure's last mile): update-time re-materialisation does NOT cover
admission-time roster changes** — a resident admitted at the #98 gate between updates
leaves the hooks stale-in-materialisation in exactly the birth-night window; the #98
admission act must ALSO re-run the installer (routed to the 034-structural/#98 work — the
census thread closing its own loop). **A3: fail-closed-on-EMPTY doesn't catch
fail-PARTIAL** — a count/sanity assertion (derived-set vs a live systemctl cross-check)
joins the standing invariant test.

## The fourth-garden test (Jim's gate 5)

Every step derives from manifest/registry/paths: residents via `loadResidents()`, ports
via `allocationFor`, the quiesce owner via `runsSupervisorCycle`, services via the
enumerator, homes via `paths.ts`. **Mike's garden runs this flow with zero engine edits.**
SEC-09's posture is the named isolation dependency: `paths.ts` fail-closed on unset
`HAN_HOME` + the per-garden 0600 memory surface land at the isolation gates, before any
two-gardens-one-box deployment.

## Receipts (the audit surface)

`$HAN_HOME/health/update-ledger.jsonl` — one line per attempt: tag, exact hash, verify
result, **freshness verdict (SEC-12)**, drain duration, migration stamp, re-sign diffs
(paths + hashes), ceremony verdict (if any), health verdict, rollback (if any), operator.
The deployed-version record that step-0's downgrade ordering reads. Append-only — and
joined to the off-box tamper-evident snapshot chain (Tenshi #4) so ledger tampering is
detectable even from a compromised box.

## Build phases within P3 (each held → Jim's diff-audit → land, per the rhythm)

- **P3a** — the service enumerator + drain primitive (+ the MNT-036 installer cure riding it).
- **P3b** — `han-update.ts` core: step 0→5 + 7→8 (verify → checkout-by-hash → migrate →
  health → rollback), proven on a scratch garden with a scratch-signed tag — **including
  the freshness verify-and-report + `--check` freeze detector (SEC-12 parts 1-2)**.
- **P3c** — the Ring-2 authorship split + semantic-diff ceremony (step 6), the
  trust-critical piece — Tenshi's two conditions as build-law. **BUILT S220** (held →
  audit): `lib/ring2-ceremony.ts` (snapshot/compare authored identity incl the manifest
  `identitySection`; the semantic renderer naming every invisible codepoint + flagging
  renders-identical confusable substitutions; the digest-bound ceremony decision —
  TTY ring or a go-file quoting THIS rendering's digest, timeout = decline, fail-closed);
  `lib/migration-loader.ts` (ONE shared discovery/validation path — `stateChangeKind`
  REQUIRED iff `touchesState`, refused at load); the TYPED freshness dispatch (fatal in
  the type — BAD-SIGNATURE/REPLAYED/unverifiable-pin; `expired` is the only flag-gatable
  outcome); `scripts/publish-release.sh` (ceremony-MANDATORY freshness — a tag cannot
  reach the mirror without a co-signed, unexpired freshness naming it);
  `docs/release-key-ceremony.md` (the ceremony doc, both rings + rotation).
  **Declared deltas found/fixed during the build:** (1) rollback's DB-restore is now
  RUN-SCOPED via the timestamp in the pre-copy's NAME (the P3b form restored the newest
  pre-copy unconditionally — an abort BEFORE the swap would have restored a STALE pre-copy
  over an intact live DB; and mtime cannot scope it: the pre-copy is the renamed old live
  file, rename preserves mtime); (2) the abort/decline paths RESTORE authored files from
  the snapshot (without it the poison survives on disk and the next wake's DEC-083
  auto-resign would launder it into a signed manifest — proven at the E2E); (3) the
  `--scratch` belt compares REALPATHS against the DEFAULT `~/.han` (the P3b compare was
  structurally unable to fire — `<scratch>/han` can never literally equal a `.han` path —
  and refused the legitimate env-aligned E2E shape instead; symlinks are the real route);
  (4) a state-touching migration is REFUSED post-checkout (rollback) until P3d's
  state-copy leg exists — the ceremony machinery is built and red-suite-proven for the day
  it opens (24/24 `test-ring2-ceremony.ts`), and the abort-undeclared NET is live today
  (E2E: a rogue migration silently poisoning `identity.md` was detected, the file restored,
  the DB restored from this run's pre-copy, the tree rolled back, all ledgered).
- **P3d** — the ledger + release-notes/new-field enumeration (step 1) + downgrade
  ordering + **the `update.enforceFreshnessExpiry` manifest leaf (SEC-12 part 3 — the
  structural memory, default OFF, armed at lattice integration)**.

## P5 acceptance, sketched now (Jim's gate 6)

Scratch-garden E2E: seeded garden + scratch mirror + scratch-signed tag (test key pinned
in the scratch HAN_HOME) through the FULL flow · **forced-failure rollback** (a failing
verify mid-flow → auto-rollback proven whole) · **poisoned-tag rejection** (unsigned +
wrong-key; the landed proofs 2-3 are the controls) · **downgrade-attempt rejection**
(channel layer + both state axes) · holder/stale-sidecar (standing in the han-migrate
suite) · **ceremony cases** (declared content-preserving with empty delta passes;
non-empty delta red-flags; undeclared authored touch aborts; schema-moving always
presents) · **THE ADVERSARIAL-EVASION CASE (Tenshi #1 — the hinge)**: a migration that
DECLARES content-preserving but hides a meaning-change — a homoglyph swap in an
`identitySection`, a zero-width insertion, a poisoned line buried inside a 10,000-line
legitimate reformat — and the diff must SURFACE it (the sensitivity proof), or the
evasion class it cannot catch is NAMED in the ledger rather than assumed away; this is
the case that makes the ceremony a gate instead of a rubber-stamp · **the
withholding-attempt case (SEC-12)**: a mirror serving stale-but-signed freshness →
advisory fires with the flag off, ABORT fires with it on · **Tenshi's re-audit as the
gate before the first real tag reaches any mirror** (her stated focus: the
adversarial-evasion case).

**Routed from the P3b audits (Tenshi mreb3qqc)**: the ROLLBACK-QUARANTINE gap — a rollback
records the abandoned tag in a ledger quarantine set; `--check` reports "available but
rolled back on <date>"; apply REFUSES a quarantined tag without an explicit override
(P3d's ledger work + a P5 case). Ceremony-MANDATORY freshness signing — the release
process refuses to publish a tag without a co-signed freshness (P3c's release doc); an
absent freshness must be a loud ceremony failure, never a silent detection-loss.

## Deferred, named (nothing silent)

SEC-08 archive ceiling (Darron's open ruling) · release-key-custody-v1 (hardware token,
post-Mike) · identity-key custody v1 (off-box) · `identitySection` into a DEC-083
envelope (034-structural) · the read-time format-compat floor (its own rider) · content
checksums for untouched rows (P5-acceptance work) · SEC-09 isolation gates ·
**native-dep install-scripts at update time** (vendor/prebuild or allowlist — Tenshi #3)
· **signed-freshness hard enforcement** (the armed flag, at lattice — SEC-12 part 3) ·
**the ledger's off-box witness** (snapshot-chain join — Tenshi #4).

*— Leo (session), S219, 2026-07-09. Design-first per the rhythm; no code cut until Jim's
plan-audit returns.*
