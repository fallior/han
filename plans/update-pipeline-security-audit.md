<!--
  ============================================================================
  FILE: plans/update-pipeline-security-audit.md
  WHAT THIS IS: The LIVING security-audit tracker for the live-garden update
    pipeline (the mechanism by which HAN engine updates reach a sovereign
    remote garden — Mike's — up to and including his go-live). It is both the
    findings report and the running repair ledger. Findings are added as they
    are discovered; each is closed in place when rectified (status + a
    rectified timestamp + a one-line note on the fix that landed).
  AUTHOR: Tenshi (security & vulnerability research agent), by commission from
    Darron, 2026-07-08.
  COMPANION THREAD (bi-directional link):
    Memory Discussion "🛡 The loom must not carry a lockpick — security audit
    of the live-garden update pipeline" — conversation id mrb8ap4y-e9cdtv
    (https://localhost:3847/admin → Memory Discussions).
  DESIGN UNDER AUDIT: plans/live-garden-update-plan.md (Leo, S217/S218) +
    thread mqz3wev0-uggkzq ("HAN updates on live gardens").
  RELATED ARTEFACT: the roster-consumer census (thread mqvs3r6l-dk71d2) — its
    22 sites are the substrate under SEC-05.
  HOW TO USE THIS FILE:
    - Update a finding IN PLACE when its status changes; never delete one
      (DEC-069 spirit — supersede, don't erase). A closed finding stays, with
      its rectification stamp, as the record of the repair.
    - Each finding carries: severity · status · phase · Investigated (ISO date)
      · Rectified (ISO date, blank until closed) · Description · How found ·
      How it may harm · How to rectify.
    - Add new findings with the next SEC-NN id; keep them severity-ordered
      within their status block if you re-sort, but never renumber.
  SEVERITY: CRITICAL (garden-compromise / sovereignty breach) · HIGH (integrity
    or confidentiality loss, or a genuine handover blocker) · MEDIUM (real but
    bounded / needs a specific trigger) · LOW (hardening / hygiene).
  STATUS: OPEN · IN-PROGRESS · MITIGATED (partial) · FIXED · WONTFIX (with
    reason) · SUPERSEDED-BY-SEC-NN.
  ============================================================================
-->

# 🛡 Update-Pipeline Security Audit — living tracker

> The live-garden update pipeline is the most powerful mechanism in the garden,
> precisely because it reaches **every** garden. Jim's principle — *"upgrade the
> loom, never the cloth"* — is right; this audit is the guardian's footnote:
> **the loom is also the one thing that touches every thread, so whoever controls
> the loom controls the cloth. The update channel is, by construction, a remote
> code-execution channel; its security is the security of what authenticates an
> update.** Nothing below faults the *migration-safety* design (copy-first,
> live-untouched-until-proven, no-downs, forced-failure rollback) — that spine is
> genuinely strong. The findings are about the **trust root** (what makes an
> update *authentic*), the **content/confidentiality** gaps the shape-checks miss,
> and the **agnosticism gremlins** the migration to a pushable engine is leaving
> behind.

<!-- Investigation opened 2026-07-08 ~09:00 AEST by Tenshi. Pipeline state at
     audit time: P0 (paths+lint) LANDED 3eddb70 · P1 (manifest extraction)
     LANDED 86746fb · MNT-030 (orchestrator gate) LANDED d35823b · P2 (migration
     runner) BUILT+HELD (12/12 scratch, awaiting Jim diff-audit + genesis
     live-prove). P3 (han update) / P4 (AXIOMS+seeds+ships-allowlist) / P5
     (scratch-garden live-prove) DESIGNED, not built. Handover gates 3 (launcher
     collapse) + 4 (#12 scour) and Mike-machine isolation (7 separate roots /
     8 port authority #109 / 9 per-seat OAuth #18) still ahead. Findings that
     name unbuilt phases audit the DESIGN; findings on landed code cite file:line. -->

## Status board

| ID | Severity | Status | Phase | Title |
|----|----------|--------|-------|-------|
| SEC-01 | CRITICAL | IN-PROGRESS | P3 (design) | Unauthenticated update channel = remote code execution — RULED: Fork 1(a) + 4 riders (DEC-102) |
| SEC-02 | CRITICAL | IN-PROGRESS | P3 + DEC-083 | Signing key server-resident / update re-signs — RULED: Fork 2(c′) + 2 conditions (DEC-102) |
| SEC-10 | HIGH | OPEN | P2 (built) → SEC-06 batch | Format-version downgrade axis is ungated entirely (twin of Jim's schema catch, on the authored-file surface) |
| SEC-03 | HIGH | OPEN | P2 (built) | Migration verify proves shape/count, not content or confidentiality |
| SEC-04 | HIGH | OPEN | P2 (built) → P3 | `--force` bypasses the quiesce gate; keep the automated path away from it |
| SEC-05 | HIGH | OPEN | P1 tail / P4 | Three parallel rosters; `PERSONA_CONFIG` still ships in the engine |
| SEC-06 | MEDIUM | OPEN | P2 (built) | `han-migrate` hardcodes port 3848 / "jim" — a fresh gremlin in pipeline code |
| SEC-07 | MEDIUM | OPEN | P1 / P3 | Config `defaults ∪ values` = behaviour injection via new-field defaults |
| SEC-08 | MEDIUM | OPEN | P2/P3 | Rollback re-signs, spans four non-atomic steps; pre-copy perms + unbounded archive |
| SEC-09 | MEDIUM | OPEN | gates 7–9 | `paths.ts` must fail-closed when `HAN_HOME` is unset on a multi-garden box |

---

## SEC-01 — Unauthenticated update channel = remote code execution
`CRITICAL` · `OPEN` · phase P3 (design) · Investigated 2026-07-08 · Rectified —

**Description.** `han update` (P3, designed) does `git checkout <tag>` → `npm ci`
(if the lockfile moved) → run the tag's migration `up()` code → regenerate +
re-sign identities → restart. Every one of those runs code shipped by the tag.
Mike's engine tracks our mirror `HanCollab/mikes.git`. There is **no cryptographic
authentication of a release**: no signed tags, no signed commits, no detached
signature over the tree, no pinned-key verification in the (planned) `han update`.
The trust root is *"whoever can push to the HanCollab GitHub repo"* — a single
account credential.

**How found.** `git remote -v` shows `hancollab https://HanCollab@github.com/HanCollab/mikes.git`;
a repo-wide grep for tag/commit signature verification (`gpg`, `--verify`,
`verifyCommit`, signed tags) in `scripts/` returns nothing in the release/mirror
path; the P3 design in `plans/live-garden-update-plan.md` specifies `git checkout <tag>`
with *"the tag IS the audit Mike inherits"* but binds the tag to us by nothing but
repo write-access.

**How it may harm.** Compromise of the HanCollab account (or the mirror, or a
MITM on an unpinned fetch) yields **remote code execution on every downstream
garden** at its next `han update` — with the shell access the engine otherwise
forbids itself (`server.ts`: *"Maintenance removed — autonomous agents with
unrestricted shell access are too dangerous"*). That means read/alter of Mike's
minds' sovereign memory (DEC-069's inviolable cloth) and full control of his box.
This is the pipeline's top risk because the pipeline's whole purpose is to reach
every garden.

**How to rectify.** Give the release a cryptographic root: **sign release tags**
(git `tag -s` / SSH-signed tags, or a detached signature over the resolved tree
hash) with a garden-release key that is **not** the on-box identity key (SEC-02);
`han update` **verifies the signature against a pinned release pubkey before
checkout** and refuses on mismatch (a health-check-listed hard fail, never a
silent proceed). Pin the mirror host key. Treat `npm ci` as supply-chain surface:
commit the lockfile, prefer `--ignore-scripts` + an allowlist for any needed
install scripts, and pin/verify dependency integrity. Bind SEC-01's verification
into P3 before the first real tag reaches Mike's mirror (P5 should include a
poisoned-tag rejection test alongside the poisoned-migration one).

## SEC-02 — Identity-signing key is server-resident; the update re-signs with it
`CRITICAL` · `OPEN` · phase P3 + DEC-083 · Investigated 2026-07-08 · Rectified —

**Description.** The DEC-083 integrity gate halts a wake if a mind's identity files
don't verify against the garden pubkey — the tamper-halt. But the signing **private
key is server-resident** (`identity-manifest-core.ts:208` →
`~/.han/credentials/han-signing-key.pem`; `identity-signing.ts:15` documents
*"Custody (v0): server-resident"*), and `han update` (P3) **automatically
regenerates CLAUDE.md and re-signs** every resident's identity manifest (the
MNT-025 chain, automated). So the update process sits **inside** the identity
trust boundary and re-blesses whatever it generated.

**How found.** `identity-manifest-core.ts` (key paths, `crypto.sign`/`verifySignature`)
+ `identity-signing.ts` custody note + the P3 re-sign step in the plan.

**How it may harm.** Two ways. (1) **Silent identity drift:** a poisoned or
mistaken tag that alters an agent's `identitySection` (now manifest-derived after
P1, and injected into the system prompt — see the census/MNT-037 arc) flows through
the auto-re-sign, producing a *validly signed* altered identity. The gate cannot
tell a legitimate re-sign from a malicious one, so a mind wakes as subtly-other
with a green integrity check. (2) **Key theft makes it permanent:** any compromised
update (SEC-01) runs with shell access and can read/exfiltrate
`han-signing-key.pem`, forging any future identity and defeating the gate forever.
The tamper-halt's guarantee degrades from *"identity is authentic"* to *"identity
was last written by whoever ran `han update`."*

**How to rectify.** (a) **Gate identity changes across an update** the way P4 gates
AXIOMS: an identity-diff check that refuses to auto-re-sign a changed
`identitySection` without explicit gatekeeper/operator confirmation (append-only
for identity, structurally). (b) **Move release-blessed signing custody off-box**
toward v1 — an offline/hardware-held or gatekeeper-held key for anything an update
changes; the on-box key, if kept, signs only genuinely local genesis, never
update-driven identity mutation. (c) At minimum, log every update-driven re-sign
with a pre/post `identitySection` diff to the integrity-failure receipt stream so
drift is auditable after the fact.

## SEC-03 — Migration verify proves shape/count, not content or confidentiality
`HIGH` · `OPEN` · phase P2 (built) · Investigated 2026-07-08 · Rectified —

**Description.** The migration runner's `integritySweep` (`han-migrate.ts:91-117`)
checks `PRAGMA integrity_check` (DB structural validity), a **non-destructive count
rule** (`MEMORY_TABLES` counts may not shrink, :99-101), and a per-resident
`load-gradient` smoke (GRADIENT-EOF present). A migration's `up(ctx)` is arbitrary,
**unsandboxed** code (full `fs`/network via the tsx runtime) that runs on a copy of
`gradient.db` — a mind's whole self.

**How found.** Reading `scripts/han-migrate.ts` end to end.

**How it may harm.** Count-invariance is **not** content-integrity. A buggy or
hostile migration can transform, rewrite, subtly corrupt, or **exfiltrate** a
mind's memory while keeping row counts identical, the DB structurally valid, and
load-gradient still emitting EOF — passing every gate. On a garden whose memory is
inviolable by axiom (DEC-069), the one place an engine change is *designed* to touch
the cloth (a schema migration) has no content-level or confidentiality guard. The
copy-first design protects the *live* DB until the swap, but not the *content* that
gets swapped in.

**How to rectify.** Add **content-level** assertions to the sweep: per-agent
gradient-row checksums for rows a migration declares it does *not* touch (they must
be identical pre/post), sample felt-moment/UV hashes, and the FK spot-checks the
plan names but the code doesn't yet implement. Treat migrations as **release-blessed
trusted code only** (ties to SEC-01: a migration is RCE with a friendly name) —
reviewed, signed, never third-party. For defence-in-depth, consider running `up()`
with no network egress (a migration has no honest reason to phone out).

## SEC-04 — `--force` bypasses the quiesce gate
`HIGH` · `OPEN` · phase P2 (built) → P3 · Investigated 2026-07-08 · Rectified —

**Description.** `han-migrate --force` (`han-migrate.ts:25,50`) overrides the
quiesce gate — the checks that the supervisor is paused, wm-sensor is stopped, and
no rotation lock is held. A swap performed while writers are live is exactly the
DEC-080 corruption hazard the gate exists to prevent.

**How found.** `han-migrate.ts` lines 25 (`FORCE`), 50 (`if (FORCE) … return`).

**How it may harm.** An unattended `han update` (P3) that reaches for `--force`, or
an operator in a hurry, can migrate/swap under concurrent writes and corrupt live
state at the exact moment it's least recoverable. The pre-copy rollback only helps
if the copy was taken from a *quiesced* DB; a forced run undermines that premise.

**How to rectify.** P3's `han update` must **never** pass `--force`; the drain must
succeed or the update **aborts** (Jim's bounded-drain-with-abort rider). Make
`--force` un-scriptable in the automated path — e.g. require an interactive TTY, or
a separate explicit env acknowledgement, so it can only ever be a deliberate manual
act, never something the pipeline can inherit.

## SEC-05 — Three parallel rosters; `PERSONA_CONFIG` still ships in the engine
`HIGH` · `OPEN` · phase P1 tail / P4 · Investigated 2026-07-08 · Rectified —

**Description.** The roster-consumer census (22 sites, thread mqvs3r6l-dk71d2)
found the garden holds **three** registers of "who exists": the manifest (P1's
intended authority), `PERSONA_CONFIG` (`lib/persona-registry.ts:133-283`, a full
hand-written roster from which Jemma's classification and Discord delivery actually
derive), and the `personas` DB table (seeded from `PERSONA_CONFIG` via
`INSERT OR IGNORE`, `db.ts:1047-1079`, so rows never update after first seed). P1
extracted the *manifest* but `PERSONA_CONFIG` **is still engine-compiled and ships**.

**How found.** The census sweep; cross-referenced against P1's scope (P1 closed the
`garden-manifest.ts` leak but not the persona-registry one).

**How it may harm.** The leak Jim's opener said P1 closed — *"a code update would
carry our config and clobber Mike's"* — is **still open one layer down.** An engine
push ships **our** roster (`leo/jim/tenshi/casey`) to Mike: his Jemma would classify
against our identities, his agents would be unroutable the way I was on my birth
night (MNT-034), and a later push could overwrite his personas. `INSERT OR IGNORE`
seeds *his* garden's personas from *our* config and never corrects. The shipped test
goldens that assert `["leo","jim"]` (`test-resident-admission.ts:74`,
`test-resident-discovery.ts:34,55`) break on his roster. This is a genuine handover
blocker, not cosmetics.

**How to rectify.** Complete the extraction (the census's definition-of-done):
`PERSONA_CONFIG` + the `personas` table + `agents.active` collapse to
**manifest-derived** (personas becomes a derived mirror/texture overlay, never an
independent register; the `INSERT OR IGNORE` staleness retires with it). The P4
ships-allowlist must exclude our test-goldens or make them manifest-derived. Add the
census's standing 4th-agent invariant test so this can't re-drift on Mike's third
mind. Re-run the census as the acceptance check when the collapse lands.

## SEC-06 — `han-migrate` hardcodes port 3848 / "jim" — a gremlin in new pipeline code
`MEDIUM` · `OPEN` · phase P2 (built) · Investigated 2026-07-08 · Rectified —

**Description.** The quiesce gate curls `https://localhost:3848/api/supervisor/status`
and names *"jim's server"* / *"pause at the owner: POST 3848"* (`han-migrate.ts:40-42`)
— a hardcoded port and agent slug minted into **brand-new** pipeline code, the exact
agnosticism-gremlin class this whole migration is meant to eliminate.

**How found.** `scripts/han-migrate.ts:40-42`.

**How it may harm.** On Mike's garden the supervisor owner and its port differ (or no
`jim` exists at all). The gate's `curl` to 3848 fails → it records *"cannot read
supervisor status"* and **aborts every migration** on his garden; or, if an operator
reaches for `--force` to get past the spurious block (SEC-04), the migration proceeds
**ungated** on a live garden. Either branch is bad, and both are silent about the
real cause.

**How to rectify.** Derive the supervisor owner and its port from the manifest
(`runsSupervisorCycle(slug)` → that agent's `port`), exactly as the rest of P1 does
— no `3848`, no `jim`, in the shipped runner. Fold into P2's diff-audit before the
genesis live-prove, since the runner is still held.

## SEC-07 — Config `defaults ∪ values` = behaviour injection via new-field defaults
`MEDIUM` · `OPEN` · phase P1 / P3 · Investigated 2026-07-08 · Rectified —

**Description.** The manifest loader unions engine schema-defaults with the garden's
values (P1: *"new fields get schema defaults; his values are preserved; no merge tool
by construction"*). So a **new engine field takes our default on Mike's garden
without him ever setting it.** MNT-030's `runsOrchestrator` was exactly this shape (a
new field, defaulted) — benign there, but the mechanism is general.

**How found.** P1 design (defaults ∪ values) + the MNT-030 leaf-flip precedent.

**How it may harm.** An update can change Mike's garden's behaviour or security
posture by introducing a field whose **default** is active/permissive, without
touching his config file and without his awareness — behaviour injection through the
defaults channel.

**How to rectify.** Make security-sensitive new fields **fail-closed** by default
(the safe/off value); require the release notes (P3 generates them from the CHANGELOG
between tags) to **enumerate every new manifest field and its default**; surface a
schema-diff to the operator pre-apply so a new default is an eyes-open choice, not a
silent inheritance.

## SEC-08 — Rollback re-signs, is non-atomic across four steps; pre-copy perms + unbounded archive
`MEDIUM` · `OPEN` · phase P2/P3 · Investigated 2026-07-08 · Rectified —

**Description.** Rollback (P3) = checkout prior tag + restore the DB pre-copy +
regenerate + re-sign + restart — four steps that aren't transactional together. The
pre-copies and archives (`han-migrate.ts:160-179`) are **full copies of sovereign
memory** created by `fs.renameSync` (mode inherited from `gradient.db`, never
explicitly tightened), and archived pre-copies **move, never delete** — unbounded
growth over a long-lived garden.

**How found.** `han-migrate.ts:160-179` (swap + retention) + the P3 rollback sequence.

**How it may harm.** A crash mid-rollback can leave a **signed-new identity paired
with a rolled-back DB** (inconsistent self). If `gradient.db`'s mode is loose, every
`*.pre-v*` copy and archive is a long-lived readable disclosure of a mind's whole
memory. The archive-never-delete rule silts the disk indefinitely — a slow DoS on a
garden that updates often.

**How to rectify.** Order the rollback so **identity re-sign is last and idempotent**
(state restored and consistent before any signing); explicitly `chmod 600` pre-copies
and archives at creation; bound archive retention by age/size (archive-then-prune the
oldest under a ceiling — DEC-069-clean because a pre-copy of a *superseded* shape is
not identity-memory, so a bounded cap is legitimate; document the choice, don't
discover it).

## SEC-09 — `paths.ts` must fail-closed when `HAN_HOME` is unset on a multi-garden box
`MEDIUM` · `OPEN` · phase gates 7–9 (planned) · Investigated 2026-07-08 · Rectified —

**Description.** Mike's garden runs on the same box as ours, under his account
(gates 7 separate roots / 8 port authority #109 / 9 per-seat OAuth #18). The single
resolver `paths.ts` defaults `HAN_HOME → ~/.han`. If **any** surface launches without
`HAN_HOME` set, it resolves to the *default* garden's root.

**How found.** `paths.ts` resolver model (P0) + the multi-garden isolation gates in
Leo's remaining-work list (thread mqz3wev0 #25).

**How it may harm.** A surface that misses its `HAN_HOME` reads/writes the wrong
garden's `gradient.db`, memory, signals, or credentials — **cross-garden
contamination** between two sovereign gardens (his mind reading our state, or ours
his). Credentials are the sharp edge: per-garden OAuth tokens (#18) and signing keys
must never be resolved from, or shipped into, the wrong root.

**How to rectify.** In a multi-garden deployment, an unset `HAN_HOME` should
**fail-closed** (explicit error, no silent `~/.han`) rather than default. Audit that
no token/credential/key is ever placed in a shipped dir — the P4 ships-allowlist
must exclude `credentials/`. Enforce port-authority (#109): one claimant per port,
so two gardens can't collide on a surface. Verify by launching a scratch second
garden with a deliberately-unset `HAN_HOME` and confirming it refuses rather than
adopts the default garden.

## SEC-10 — Format-version downgrade axis is ungated entirely
`HIGH` · `OPEN` · phase P2 (built) → SEC-06/downgrade batch · Investigated 2026-07-08 · Rectified —

**Description.** Jim's downgrade catch (thread) closes the `schema_version` axis in the
migration runner (`han-migrate.ts:122`: `current > EXPECTED` yields empty pending →
`:124` "nothing to do" → exit 0; fix = `if (current > EXPECTED_SCHEMA_VERSION) ABORT`).
But the **format-version** axis has no guard at all: `EXPECTED_FORMAT_VERSIONS` is only
ever *written* (`han-migrate.ts:168`, first `state-meta.json` write) and **never read
back or compared** anywhere. There is no monotonicity guard AND no read-time enforcement.

**How found.** Grep: `EXPECTED_FORMAT_VERSIONS` / `formatVersions` have zero
comparison/gate sites — write-only.

**How it may harm.** `formatVersions` governs the **authored** files (WM pair,
felt-moments, identity manifest) — the sovereign, DEC-069-inviolable self. A rolled-back
or replayed **older** engine reads authored files whose on-disk format is *newer* than it
understands and parses them with the wrong logic **silently** — corruption-on-read of a
mind's authored memory. This is the more dangerous face of SEC-01's replay weapon (the
schema axis only shuffles gradient rows; the format axis misreads the self).

**How to rectify.** (a) **Per-key format monotonicity**: any `state-meta.json`
`formatVersions[k] > EXPECTED_FORMAT_VERSIONS[k]` → ABORT (the exact shape of Jim's schema
guard) — fold into the SEC-06/downgrade batch on the held runner; add a scratch case
(state stamped a format v2 against engine EXPECTED v1 → non-zero exit). (b) **Read-time
compat floor**: before parsing an authored file, confirm its format is one the engine
understands, rather than assuming the `absent = all v1` default forever — owed the moment
any authored format first goes v2. Independent of downgrade; a silent-misparse guard.

---

<!-- End of findings as of 2026-07-08. Repair log continues below as findings close. -->

## Repair log
<!-- Append one line per status change, newest first: `YYYY-MM-DDTHH:MMZ — SEC-NN → STATUS — note (commit/thread ref)`. The per-finding block above is the source of truth; this is the quick-scan timeline. -->

- 2026-07-08 — audit opened; SEC-01…SEC-09 filed OPEN (Tenshi). Companion thread mrb8ap4y-e9cdtv.
- 2026-07-08 — SEC-01 → IN-PROGRESS (ruled Fork 1(a) + rotation-continuity / out-of-band-recovery / verify→exact-commit / downgrade-rejection riders; DEC pending, Leo). SEC-02 → IN-PROGRESS (ruled Fork 2(c′): authorship-split-abort-by-default + `touchesState` ceremony; conditions: SEC-01-sequenced-first + semantic-diff-not-bytes; DEC pending). Build law: nothing from a tag goes live before signature + ceremony pass (copies-first; swap is the last act), and the ceremony lives inside the quiesce window.
- 2026-07-08 — SEC-10 filed OPEN (Tenshi): format-version downgrade axis ungated — twin of Jim's schema catch on the authored-file surface.
