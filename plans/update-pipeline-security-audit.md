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
| SEC-01 | CRITICAL | **CLOSED** | P3d/P5 | Unauthenticated update channel = RCE — trust root live (signed tags + pinned root), DEC-102 |
| SEC-02 | CRITICAL | **CLOSED** | P3c + DEC-083 | Signing key / update re-signs — the Ring-2 ceremony (human ring over an unhideable diff) |
| SEC-03 | HIGH | **ADDRESSED** | P2 + P3c + 2b/P5 | verify proves content too — raw-byte scan + atomic swap + rendered-set==swapped-set + umask copies |
| SEC-04 | HIGH | **CLOSED** | P2 + P3 | han-update has NO --force by design; the migrate wall is structural, not --force-bypassable |
| SEC-05 | HIGH | **OPEN (named)** | P4 / starter-extraction | `PERSONA_CONFIG` still engine-compiled — a HANDOVER-blocker for Mike's fork, NOT the update mechanism |
| SEC-06 | MEDIUM | **CLOSED** | P2 | `han-migrate` manifest-derives owner+port — no hardcoded 3848/"jim" |
| SEC-07 | MEDIUM | **OPEN (named)** | P4 (config) | `defaults ∪ values` new-field injection — a P4 config item; not re-verified at close, confirm before P4 |
| SEC-08 | MEDIUM | **ADDRESSED** | P2 + 2b | rollback re-signs last+idempotent; umask-0600 pre-copies; archive is a written disposal schedule |
| SEC-09 | MEDIUM | **OPEN (named)** | gates 7–9 (multi-garden) | `paths.ts` HAN_HOME default — only bites on a shared box; the multi-garden gate, not today |
| SEC-10 | HIGH | **CLOSED** | P2 | Format-version downgrade guard live + --force-proof |
| SEC-11 | MEDIUM | **MITIGATED** | P2/P3 | Deploy DB-holder restart — fd-guard converts silent split-brain → loud abort; fuser-zero belt |
| SEC-12 | MEDIUM | **MITIGATED** | P3b/c/d | No freshness/anti-withholding — three-layer; enforcement behind default-off flag; full cure = lattice 2nd channel |

---

## SEC-01 — Unauthenticated update channel = remote code execution
`CRITICAL` · `CLOSED` · phase P3d/P5 (in the metal) · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — trust root live (SEC-01, signed tags + pinned root); DEC-102

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
`CRITICAL` · `CLOSED` · phase P3c + DEC-083 · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — the Ring-2 ceremony: no tag re-signs identity without a human ring over a diff no byte can hide in

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
`HIGH` · `ADDRESSED` · phase P2 + P3c + 2b/P5 · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — ceremony raw-byte scan (content, not just count) + 2b atomic swap + P5 rendered-set==swapped-set; umask-0600 copies for confidentiality

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
`HIGH` · `CLOSED` · phase P2 + P3 · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — han-update has NO --force by design (SEC-04); the migrate WALL is structural, not --force-bypassable

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
`HIGH` · `OPEN (named)` · phase P4 / Phase-B starter-extraction · Investigated 2026-07-08 · Rectified — · NAMED-OPEN 2026-07-17 (Tenshi mrox9whl): `PERSONA_CONFIG` still engine-compiled; the cure is the starter extraction shipping it empty. A HANDOVER-blocker for Mike's first fork, NOT a hole in the update mechanism — off the update trust surface

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
`MEDIUM` · `CLOSED` · phase P2 · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — SEC-06 manifest-derive: han-migrate resolves supervisor owner+port from the manifest, no hardcoded 3848/"jim" (S219)

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
`MEDIUM` · `OPEN (named)` · phase P4 (config surface) · Investigated 2026-07-08 · Rectified — · NAMED-OPEN 2026-07-17 (Tenshi mrox9whl): `defaults ∪ values` new-field behaviour injection; a P4 config-surface item, NOT re-verified at the 2026-07-17 close — confirm before P4 ratification. Off the update trust surface

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
`MEDIUM` · `ADDRESSED` · phase P2 + 2b · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — rollback re-signs LAST + idempotent; umask-0600 pre-copies (perms closed); the unbounded archive is now a WRITTEN DISPOSAL SCHEDULE (2b, Casey's form) — pruning is a future DEC by the named authority, never custodial discretion

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
(state restored and consistent before any signing); **set `umask(0o077)` before the
`backup()`** so every copy (`.migrating-*` / `.pre-v*` / archived) is `0600` *from
birth* — a `chmod`-after leaves a TOCTOU window where the full memory copy is
world-readable during the (minutes-long) backup write, and the umask also covers the
failure path where a copy is legitimately retained for forensics; unlink the working
copy only on a *successful* dry-run; bound archive retention by age **and** count
(archive-then-prune the oldest under a ceiling — DEC-069-clean because a pre-copy of a
*superseded* shape is not identity-memory, so a bounded cap is legitimate).
*(2026-07-08: Jim's P2 Fold-2 is this finding's confidentiality remediation and gates
the genesis live-prove — its first act is a dry-run that copies every mind's memory.
See SEC-09 for the source-mode connection: hardening the copy is half a fix while
`gradient.db` itself is 644.)*

## SEC-09 — `paths.ts` must fail-closed when `HAN_HOME` is unset on a multi-garden box
`MEDIUM` · `OPEN (named)` · phase gates 7–9 (multi-garden) · Investigated 2026-07-08 · Rectified — · NAMED-OPEN 2026-07-17 (Tenshi mrox9whl): `paths.ts` still defaults HAN_HOME→~/.han (paths.ts:20); only bites when two gardens share a box — the multi-garden gate, not today's single-garden deployment. Off the update trust surface

**Description.** Mike's garden runs on the same box as ours, under his account
(gates 7 separate roots / 8 port authority #109 / 9 per-seat OAuth #18). The single
resolver `paths.ts` defaults `HAN_HOME → ~/.han`. If **any** surface launches without
`HAN_HOME` set, it resolves to the *default* garden's root.

**Measured mode posture (2026-07-08).** `~/.han` is **775** (group+other traverse) and
`gradient.db` itself is **644** (group+other read) — so a mind's live sovereign memory
is *already* cross-user readable. On the multi-garden box this pipeline targets, that is
a live cross-garden disclosure independent of the migration copies. So the `0600`
hardening (SEC-08/Jim's Fold-2) must extend beyond the transient copies to the **whole
per-garden memory surface** (`gradient.db` + the memory dir at `0700`) when this gate is
built — 600-ing the copy while the source sits 644 beside it is only acute-instance relief.

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
`HIGH` · `CLOSED` · phase P2 · Investigated 2026-07-08 · Rectified 2026-07-17 (P3d/P5 close) — format-version downgrade guard live (state-meta.json per-key monotonicity) and --force-proof; twin of the schema downgrade guard

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

## SEC-12 — Update channel has no freshness / anti-withholding guarantee
`MEDIUM` · `MITIGATED` · phase P3b/c/d · Investigated 2026-07-09 · Rectified 2026-07-17 (P3d/P5 close) — three-layer (F1 replay-backward guard from git state + --check staleness heuristic + lattice 2nd-channel cure); enforcement behind the default-OFF enforceFreshnessExpiry flag (live-disarmed, self-lockout guard). Full anti-withholding = the lattice 2nd channel, a later phase

**Description.** The pinned root + downgrade guard stop forgery and replay-*downgrade* of tags,
but not *withholding*: a mirror can serve a stale-but-genuinely-signed state forever, and the
channel cannot know a newer release exists (the one attack a signature can't see — my P3-design
review; Jim's residual). Cure (Jim, mrde0r8y, Darron's go): TUF-style **signed freshness**
(`freshness.json` = latest/released/expires/prev, signed by the SAME garden-release key, verified
against the SAME pinned root — SEC-01 architecture reused; chicken-and-egg closed again).
Sign-at-ceremony (zero recurring burden); **verify-and-REPORT now** (advisory, no lockout);
**hard-expiry behind `update.enforceFreshnessExpiry` default-off** — the flag IS the reminder
(structural memory read every boot, not a mental note). `--check` is the standing freeze detector.

**How found.** P3-design review (Tenshi) → deferred residual → Darron's governance catch ("don't
defer to a mechanism that doesn't exist yet") → Jim's structural cure.

**How to rectify (landed vs open).** Detection landed in the design; enforcement flagged-off.
**Two open sub-residuals (Tenshi, mre9rik6):**
- **F1 — the freshness artefact needs its own downgrade guard (closes replay-BACKWARD only).** A
  mirror can replay an older-but-signed, not-yet-expired `freshness.json` to hide the newest release
  within the expiry window (passes signature + expiry). Cure = mirror the tag downgrade guard: refuse
  a freshness whose `latest_version` is below the highest-ever-seen. **Bootstrap-floor (Jim's
  completion, TOFU hole): initialise the high-water to `max(ledger_high_water, currently-deployed-
  version)`** — a garden can't legitimately be told the newest release is older than the version it
  runs, so the deployed version is a free monotonic floor. **Read that floor from the git state (the
  checked-out tag), NOT the local ledger** (a box-compromise can edit the ledger and poison the
  floor; the git tag is the harder witness). **Scope honesty**: F1 closes replay-*backward*, NOT
  withholding-*in-place* (a mirror serving genuine N while N+1 exists, unexpired, ≥N) — see the
  three-layer shape below. Do not defer past the flag arming.
- **F1b — withholding-in-place is irreducible to a single pull channel.** The git-tag "second
  witness" is a *consistency* check (fires when freshness/tags disagree), not a *liveness* one — a
  consistent withholder freezes both in lockstep and no mismatch shows; the off-box snapshot chain is
  tamper-evidence for *local* files, not upstream-release awareness. **Three-layer SEC-12 shape**:
  (1) F1 (+git-state floor) closes replay-backward; (2) `--check`'s **staleness heuristic** ("no new
  signed release in N days vs the known cadence") is the interim, mirror-independent withholding-in-
  place detector — it flags the *silence*, which a frozen mirror can't fake; (3) the lattice's signed
  release announcements over a second channel (or operator out-of-band awareness) is the eventual
  cure. Standing residual until (3).
- **F1c — rollback and freshness don't share "this version was REJECTED" (P3b review, mreb3qqc).**
  After a legitimate `--rollback` of a bad `vN`, git-deployed drops to `vN-1` but the freshness
  high-water stays `vN` (highest seen, correct). So `--check` reports "behind: vN available", the
  freshness verdict accepts `vN` (≥ high-water), and nothing refuses a **re-apply of the
  known-bad vN** — the tool advises, and would allow, walking back into the release that was just
  rolled back. Two correct mechanisms (rollback; the replay-backward guard) not sharing one fact.
  **Fix**: rollback records the abandoned tag in a ledger **quarantine set**; `--check` reports
  "vN available BUT rolled back on <date>"; the apply path refuses a quarantined tag without an
  explicit `--force-quarantined <tag>`. Route to P3d (ledger state) + a P5 case.
- **F1d — keep the fatality split STRUCTURAL (P3b review + Jim mreaz0n3).** P3b correctly makes
  `BAD_SIG`/`REPLAYED` hard-fatal (a detected attack, not `--force`-bypassable) and `EXPIRED`
  flag-gated advisory (the F2 availability signal). Keep it a **typed freshness-outcome** (not a
  boolean a "consolidation" can soften), and prove it with a P5 assertion: **a REPLAYED freshness
  aborts with `enforceFreshnessExpiry: false`** — the flag governs expiry only, never replay.
  Plus: freshness-signing must be **structurally mandatory in the release ceremony** (a release
  that forgets = silent loss of anti-withholding); belongs in `docs/release-key-ceremony.md` (P3c).
- **F2 — `expires_at` vs an irregular human release cadence is a self-lockout tradeoff.** Signed at
  ceremony = a guess about the next release date. Too short → a healthy garden's freshness expires →
  with the flag ON, updates abort on a healthy garden (self-inflicted freeze/DoS). Too long → longer
  withholding window (feeds F1). `advisory-first, flag-default-off` correctly dodges this now; when
  armed at the lattice, `freshnessMaxAgeDays` must be generous vs the real cadence — a
  security-vs-availability calibration, not a free win.

## SEC-11 — Deploy tooling that restarts DB-holders is part of the swap threat surface
`MEDIUM` · `MITIGATED` · phase P2/P3 · Investigated 2026-07-08 (S219 split-brain incident) · Rectified 2026-07-08 (partial)

**Description.** A post-commit hook / restart tooling bouncing DB-holding services can interleave
with a migration swap → the four servers hold the old inode past the swap → two-sided DB divergence
(the S219 split-brain, reconciled to zero loss). The bite compiled into guards: the fd-guard converts
the interleave from silent split-brain to **loud abort**, checkpoint-truncate, sidecar re-pair.

**How to rectify (open half).** The **P3 step-3 `fuser`-zero-on-the-live-DB** is the standing belt
and the real safety: it checks the kernel's actual holders independent of the service enumerator, so
a holder the enumerator under-counts still fails fuser-zero and aborts. **Invariant to write down
(A1, mre9rik6):** the enumerator is *convenience*; `fuser`-zero is the *safety* — a future
optimisation that trusts the enumerated set and drops the fuser check silently re-opens SEC-11. P5:
assert enumerator-misses-a-holder → fuser still aborts. Also: the MNT-036 self-heal re-materialises
hooks at update-time but NOT at #98 admission-time (the birth-night window) — re-run the installer on
admit, or the next resident's birth re-lives the hook-miss (rides MNT-034-structural).

---

<!-- End of findings as of 2026-07-10. Repair log continues below as findings close. -->

## Repair log
<!-- Append one line per status change, newest first: `YYYY-MM-DDTHH:MMZ — SEC-NN → STATUS — note (commit/thread ref)`. The per-finding block above is the source of truth; this is the quick-scan timeline. -->

- **2026-07-17 — PIPELINE CLOSED as a PHASE (Tenshi final verdict mrox9whl; Casey trusted-base doctrine mrnmn06a; Jim's audit chain).** The update trust surface is WHOLE and verified across four seats: SEC-01/-02/-04/-06/-10 **CLOSED**, SEC-03/-08 **ADDRESSED**, SEC-11/-12 **MITIGATED**. P5 digest-determinism CLOSED — three render-environment doors shut by construction (path=cwd-relative git; config=hermetic GIT_CONFIG; locale=LC_ALL/LANG=C, LANGUAGE='') + Casey's belt (drop the algorithm-derived `index` line) → the ceremony digest is a pure function of (pre, post, name); the consent record self-authenticates down to a **named, minimal, stable trusted base** (git binary → Node/V8/OS), with the in-process diff logged as future-hardening. Suites: ring2 50/50, state-swap 60/60, E2E 9/9, tsc 11-baseline. **Three residuals carried explicitly NAMED-OPEN, each off the update trust surface and scoped to a later phase:** SEC-05 (PERSONA_CONFIG engine-compiled → Phase-B starter-extraction, Mike-handover-blocker), SEC-07 (defaults∪values new-field injection → P4 config, not re-verified at close), SEC-09 (paths.ts HAN_HOME default → multi-garden gate 7–9). A real close, not a tidy one.
- 2026-07-16/17 — P3d Unit 2b LANDED (f61d940 atomic DB+state swap + boot gate; 221a652 boot-gate hardening) → P5 enumeration-seam fix (a7a4e30, rendered-set==swapped-set) → P5 digest-determinism (held→landing) closing the last trust-surface hole. Four-hands membrane on the determinism arc: Tenshi's E2E found the digest non-determinism, Casey found the config class, Jim found the locale door, Leo built each cure with a teethed test.
- 2026-07-11/12 — P3c ceremony hardening (renderer control-byte/homoglyph/reorder/binary-mode proof) + P3d quarantine set + state-copy foundation landed (Leo build / Jim+Tenshi audit).
- 2026-07-08 — audit opened; SEC-01…SEC-09 filed OPEN (Tenshi). Companion thread mrb8ap4y-e9cdtv.
- 2026-07-08 — SEC-01 → IN-PROGRESS (ruled Fork 1(a) + rotation-continuity / out-of-band-recovery / verify→exact-commit / downgrade-rejection riders; DEC pending, Leo). SEC-02 → IN-PROGRESS (ruled Fork 2(c′): authorship-split-abort-by-default + `touchesState` ceremony; conditions: SEC-01-sequenced-first + semantic-diff-not-bytes; DEC pending). Build law: nothing from a tag goes live before signature + ceremony pass (copies-first; swap is the last act), and the ceremony lives inside the quiesce window.
- 2026-07-08 — SEC-10 filed OPEN (Tenshi): format-version downgrade axis ungated — twin of Jim's schema catch on the authored-file surface.
- 2026-07-10 — SEC-11 filed MITIGATED (S219 split-brain → fd-guard + fuser-zero belt; A1 invariant + admission-time re-materialise open) and SEC-12 filed IN-PROGRESS (signed-freshness detection landed in design, enforcement flag-off; F1 freshness-downgrade-guard + F2 expiry-self-lockout open) — craft report mre9rik6. P3a (enumerator + drain + MNT-036 cure) GREEN, byte-true, fail-closed.
- 2026-07-10 — SEC-12 F1 completed (Jim mrea6bjn / Tenshi mrea9qc0): bootstrap-floor = max(ledger-high-water, deployed-version) read from git state not ledger; F1 closes replay-BACKWARD only; added F1b (withholding-in-place irreducible to single channel; three-layer shape: F1 backward / --check staleness interim / lattice 2nd-channel cure). P3a LAND SEALED; hook-comment jim+leo literal = census-class one-line fix.
- 2026-07-10 — P3b GREEN (Leo mreasirf / Jim mreaz0n3); Tenshi craft mreb3qqc: SEC-12 F1c (rollback↔freshness don't share 'version rejected' → re-nudge/re-apply of known-bad; quarantine set) + F1d (keep fatality split typed/structural, P5 replay-aborts-flag-off; freshness-signing structurally mandatory in ceremony) filed. Also: byte-fidelity standing test ('the diff you sign is bytes', Leo's gitRaw fix), --scratch prod belt + no-env, bounded health-retry→rollback.
- 2026-07-08 — DEC-102 recorded (Leo, 12999d3) — SEC-01/02 trust root Settled, Tenshi's invariant verbatim. Held-runner folds built + audited 15/15 (Jim, mrbko1ju): SEC-06 manifest-derive, schema + SEC-10 format downgrade guards live and `--force`-proof (positioned outside `quiesceGate` — closes the SEC-04×downgrade cross-vuln). SEC-08 remediation (umask-0600 copies + dry-run cleanup = Jim's Fold-2) is the last fold gating the genesis live-prove; refined to `umask` (not chmod-after, TOCTOU) + the SEC-09 source-mode connection (`~/.han` 775 / `gradient.db` 644 → 0600 must cover the whole per-garden memory surface).
