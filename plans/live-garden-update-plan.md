# Live-Garden Update Pipeline — the build plan (S217)

> The concrete design under thread `mqz3wev0` (Jim's F1–F5 opener, 2026-06-29; Darron's steers
> 2026-07-02). **The last UPDATE-PIPELINE blocker** (the biggest handover chunk — launcher-collapse, the #12 scour tail, #18 per-seat OAuth and #109 port-authority still gate the full handover; Jim's scope rider, msg mr9ttexp). Leo-writes / **Jim plan-audit before any build**;
> every phase lands through the standing rhythm (build held → diff-audit → quiesce-deploy).
>
> The sovereignty principle the whole design serves (Jim's line, Darron-endorsed):
> ***An update upgrades the loom, never the cloth.***

## The settled frame (from the thread — not re-opened here)

- **F1**: git-upstream + `han update` command; Mike's engine tracks our `HanCollab/mikes` mirror at
  **pinned release tags** (we live on tip — sharp-end; he rides dust-settled tags).
- **F2**: the garden manifest becomes **data in `$HAN_HOME`** the engine loads (the DEC-098 endpoint).
- **F3**: a **purpose-built migration runner** (our state isn't an ORM's).
- **F4**: the trichotomy — **engine** (ships) / **seed forms** (ship empty, become the garden's own,
  never overwritten) / **our lived workspace** (never ships). Plus the **axioms split**: engine-contract
  rules travel WITH the engine; per-garden decisions stay sovereign.
- **F5**: opt-in updates; safety **by construction** (tested tags, copy-first non-destructive
  migrations, health-check, rollback) because we cannot audit against Mike's specific state.

## The three layers (the boundary every phase respects)

| Layer | Contents | On update |
|---|---|---|
| **Engine** | `src/ scripts/ hooks/ templates/ systemd/ migrations/ seeds/ AXIOMS.md` | replaced (git checkout of the tag) |
| **Config** | `$HAN_HOME/garden-manifest.json` (identities, surfaces, ladders-by-name, ports, cadences, poolSizes, peer-edges) | **never overwritten** — new fields get schema defaults (defaults ∪ values; no file merge exists at all) |
| **State** | `gradient.db`, memory files, felt-moments, signals, health, logs | **never touched** except schema migration — copy-first, non-destructive, DEC-069 |

---

## P0 — Path portability + the standing lint (#101; the gate)

**What**: `src/server/lib/paths.ts` — the ONE resolver: `hanHome()` (`$HAN_HOME` → `~/.han`),
`hanRepo()` (`$HAN_REPO` → resolved from the module's own location, never a literal), `agentsDir()`,
`healthDir()`, `signalsDir()`, `sleevesDir()`. Migrate the **52 files** carrying `/home/darron`
(51 from Jim's trace + the `wm-flush.sh` default he flagged). Hooks/sh get the same via a sourced
`paths.sh` twin (kept aligned — the sleeve-surface.sh precedent).

**The lint (Jim's "worth a standing lint")**: a pre-commit check — any staged engine file
(`src/ scripts/ hooks/ templates/`) containing `/home/darron` **blocks** with the #69-style loud
banner. We stop minting new ones the same day we kill the old.

**Sizing**: mechanical, wide (52 files) — a parallel-agent sweep with a verify-grep acceptance
(`grep -rn '/home/darron' src/ scripts/ hooks/ templates/` → **zero**), plus tsc + the full test
scripts. Behaviour-identical on our box by construction (the resolvers default to today's values).

## P1 — Manifest extraction (F2; the keystone)

**The leak being closed**: `garden-manifest.ts` compiles OUR garden's identity into the engine —
today a code push would carry our config into Mike's garden.

**The shape**:
1. **`$HAN_HOME/garden-manifest.json`** — the garden's own config: agents (slug, displayName,
   role, port, memoryDir key), surfaces per agent (name, enabled, transport, **ladder by NAME**,
   swapPrefix, txnTimeoutMs, wakeFeed, poolSize, lifecycle overrides), peer-edges, garden-wide
   spoke-lifecycle defaults.
2. **The engine keeps**: the zod schema + defaults, the **ladder registry** (`OPUS_LADDER`,
   `SONNET_LADDER`, `FABLE_LADDER` … resolved from names — model economics stay engine-updatable),
   the loader, and **every existing accessor with its signature unchanged** (`manifestModelHead`,
   `poolSizeFor`, `wakeFeedFor`, `surfaceEnabledFor` …) — consumers byte-unaffected, the whole
   refactor invisible above the loader.
3. **Genesis**: the seed form `seeds/garden-manifest.seed.json` (one starter agent shape); the
   #98 seeder + the starter instantiate it. **Our migration**: a one-shot exporter dumps today's
   TS values → `~/.han/garden-manifest.json`, byte-equivalence proven accessor-by-accessor
   (every `(slug, surface)` × every accessor, TS-value vs loaded-value — the P0-compressor-style
   proof), then the TS literal retires to the seed.
4. **Config-merge on update = the zod defaults.** New engine fields carry schema defaults; the
   garden file simply doesn't have them yet; the loader unions defaults ∪ values at read. No
   merge tool, no conflict surface, by construction.

**Settled-decision flag (declared up front)**: this supersedes the LOCATION half of the manifest's
Q1 (typed-TS-literal-in-repo, 2026-06-02). Q1's rationale (compile-safety; boot/launch-read; no
hot-reload) is **kept** — the zod schema is the compile-safety at the new boundary, boot/launch-read
unchanged. Needs its own DEC recording the supersession (drafted at P1 build, Darron's nod).

## P2 — `schema_version` + the migration runner (F3)

1. **Versioning**: `schema_meta` table in `gradient.db` (`schema_version` int + applied log);
   engine constant `EXPECTED_SCHEMA_VERSION`; today's shape stamped **v1**. Memory-FILE formats get
   `format_version` in `$HAN_HOME/state-meta.json` (the WM pair, felt-moments, manifest-signing
   formats — file migrations are real too: the MNT-023 heading-repair was one, by hand).
2. **Migrations**: engine dir `migrations/NNN-description.ts`, each `{ up(dbCopyPath|stateCopyDir),
   verify(...), notes }` — **ordered, idempotent, forward-only, non-destructive** (transform /
   supersede / quarantine — never DROP, never delete: DEC-069 at the framework layer; there are
   deliberately NO down()s — rollback is the pre-copy, below).
3. **The runner** (`scripts/han-migrate.ts`): pending = expected − current →
   **copy** `gradient.db` (+ the touched memory trees) → run ups **on the copy** → each `verify()` +
   a generic integrity sweep (row counts by table/agent, FK spot-checks, a `loadTraversableGradient`
   smoke per agent) → **atomic swap** (the pre-copy kept as `gradient.db.pre-v<N>-<ts>` — DEC-069,
   and it IS the rollback) → stamp the version. Any failure on the copy → the live DB was never
   touched; report and stop. *The DEC-080 cutover is the lived precedent; this is that experience
   made a framework.*

## P3 — `han update` (F1/F5; the tool)

The command (engine-shipped, `scripts/han-update.ts` + a thin `han update` entry):

```
han update [--to vYYYY.MM.DD] [--check] [--rollback]
```

1. **Fetch + show**: fetch the mirror; resolve the target tag (default: newest stable); show the
   operator the release notes (generated from CHANGELOG between tags) — **opt-in, eyes-open**.
2. **Quiesce**: pause the supervisor at its owner + heartbeat freeze + **drain**: wait for every
   spoke to reach idle chrome (the S181 lesson mechanised — an update never lands under a
   mid-thought mind).
3. **Apply**: `git checkout <tag>` (engine only — config/state live outside the repo, unreachable
   by construction) → `npm ci` if the lockfile moved → **`han-migrate`** (P2) → **regenerate
   CLAUDE.md × residents + re-sign identity manifests** (the MNT-025 chain, automated — no seat
   ever wakes on stale doctrine) → restart services (`restart-all-services.sh`).
4. **Health-check**: servers 200 × residents; integrity gates exit-0 × residents; `load-gradient`
   smoke × residents; wm-sensor active; one fed-wake smoke on a scratch surface.
5. **On ANY failure → rollback**: checkout the prior tag → restore the DB pre-copy → regenerate +
   re-sign → restart → re-health-check → report loudly. `han update --rollback` is the same path
   by hand.
6. **Release discipline (our side)**: we tag only what our garden has lived on (tip = our
   sharp end); date-tags `vYYYY.MM.DD[.n]`; the tag commit carries the release notes. The
   Leo-build/Jim-audit rhythm protects tip; **the tag IS the audit Mike's garden inherits** —
   safety by construction, F5 answered.

### P3-SEC — the trust-root legs (DEC-102, rung by Darron 2026-07-08; builds in the P3 sitting)

*The audit thread `mrb8ap4y-e9cdtv` + tracker `update-pipeline-security-audit.md` are the origin;
DEC-102 carries the full ruling + the invariant verbatim. The legs, in build order:*

1. **The key ceremony (SEC-01, Ring 1 = Fork 1(a))** — Darron generates the garden-release
   keypair OFF-BOX (his hands; signing a tag is his deliberate act). Engine + seed ship only the
   pinned pubkey. The key-ceremony doc names BOTH rotation paths from day one: routine =
   old-key-signs-new (continuity from the pinned root); compromise = out-of-band hand-delivered
   pubkey. **This leg's first act needs Darron's hands, not code.**
2. **Verify-before-checkout** — step 3 gains a step 0: verify the tag signature against the
   pinned pubkey → resolve to the tag's EXACT COMMIT HASH and check out that hash (never a
   moveable ref — TOCTOU). Hard-fail on mismatch. Documented property: the signed tree's
   lockfile pins `npm ci` transitively (per-package integrity hashes) — do not alter lockfile
   handling without re-proving this.
3. **Downgrade rejection (both axes)** — monotonic ordering enforced at the update layer AND
   in `han-migrate` (landed in the held runner: schema_version + per-key formatVersions
   aborts, force-proof — Jim's state-half + Tenshi's SEC-10 twin). Explicit signed rollback
   (`--rollback` to a named tag) is the only lawful reverse.
4. **The authorship split + ceremony (SEC-02, Ring 2 = Fork 2(c′))** — step 3's "regenerate +
   re-sign" splits: template-GENERATED files auto-re-sign (transitively release-signed), every
   update-driven re-sign logs its pre/post diff; AUTHORED identity (incl. manifest
   `identitySection`, content-keyed) → **abort undeclared**; a `touchesState`-declared migration
   triggers the SEMANTIC-diff ceremony (content-preserving ⇒ EMPTY content delta or red flag;
   schema-moving ⇒ always human eyes). **The ceremony lives INSIDE the quiesce window** — the
   step-2 quiesce spans the deliberation (a designed, visible "garden paused pending your ring"
   freeze); the swap stays the last act, so nothing unapproved ever touches the live garden.
5. **P5 additions** — poisoned-TAG rejection + downgrade-attempt tests beside the
   poisoned-migration one; Tenshi re-audits as the acceptance gate before the first real tag.

## P4 — AXIOMS.md + the seed forms (F4)

1. **`AXIOMS.md` ships with the engine** — the rules a garden ceases to be itself without
   (Darron: *"they govern the very identity of the garden and the ability for those who live to
   be"*). Candidate list extracted from our DECISIONS (DEC-068 caps · DEC-069 never-delete ·
   DEC-081 one-path · DEC-083 identity-integrity · DEC-085 c1-source · S103 sovereignty · the
   loom/cloth update principle itself) — **the list is gatekeeper-class: Darron + Jim ratify it**;
   I draft. Engine code may cite axioms by id; updates may APPEND axioms; an update that would
   MUTATE one is definitionally an engine-break and fails review before it ships.
2. **`seeds/`** — the ship-empty forms: `DECISIONS.md` (empty ledger, header pointing at AXIOMS),
   `maintenance-journal.md`, `future-ideas.md`, `ecosystem-map.md` skeleton, the garden-manifest
   seed. Genesis instantiates them into `$HAN_HOME`; **`han update` never touches an instantiated
   copy** (they're config/state-side by path).
3. **Never ships** (the extraction-manifest line): our `plans/`, our `claude-context/DECISIONS.md`
   + CHANGELOG + CURRENT_STATUS (lived workspace), our threads/DB, `_screenshots`, `_logs`. The
   mirror-push moves to an **allowlist** (engine dirs only) so the boundary is structural, not
   remembered.

## P5 — The live-prove (the acceptance this thread exists for)

A **scratch garden** end-to-end: throwaway `$HAN_HOME` + engine clone at tag N (genesis from
seeds; one synthetic resident grows trivial real state) → we cut tag N+1 containing a REAL
schema migration + a manifest schema-default addition → `han update` on the scratch garden →
**prove**: state intact byte-for-byte outside the migrated shape; manifest values kept + the new
field defaulted; health green; the MNT-025 regen/re-sign chain ran; then **force a failure**
(a poisoned migration) → prove the rollback restores tag N + pre-copy cleanly. Jim hand-verifies
the record. Only after P5 does the first real tag go to Mike's mirror.

## Ordering + sizing

P0 (mechanical, wide — the gate) → P1 (the keystone refactor; the careful one) → P2 (new
engineering, small surface) → P3 (the tool; mostly composition of P0–P2 + existing pieces) →
P4 (mostly curation + the gatekeeper ratification) → P5 (the proof). P0+P1 also unblock the
starter independently. Each phase: design-notes → build held → Jim diff-audit → land; P1 and P4
carry settled-decision/gatekeeper declarations by name.

## Relations

#101 (paths) · #12 (agnosticism scour — P1 removes the biggest hardcode of all) · DEC-098
(identity-as-config — P1 is its endpoint) · #98 Dynamic Residence (genesis consumes the seeds) ·
DEC-080 (the lived migration precedent) · DEC-069/S103 (the cloth, untouchable) · the starter
plans (`han-starter-*`) · MNT-025 (the regen/re-sign chain P3 automates).

---

## P1 build-notes (S218 ground survey — the pre-build artifact; Jim's riders folded)

**The arity-complete accessor inventory** (garden-manifest.ts, 801 lines, 23 public accessors — the
equivalence matrix must cover ALL five arities × the full roster; anything less lets a config class
drift silent, Jim's crux-1):

| Arity | Accessors |
|---|---|
| **(slug, surface)** ×8 | `spokeLifecycleFor` · `wakeFeedFor` · `surfaceEnabledFor` · `poolSizeFor` · `manifestModelHead` · `manifestModelLadder` · `manifestTransport` · `swapPrefixFor` |
| **(slug)** ×8 | `allocationFor` · `conversationRoleFor` · `agentNameAliases` · `humanResponderPeers` · `humanResponderTxnTimeoutMs` · `humanResponderCommitmentScan` · `runsSupervisorCycle` · `conversationRolesExcept` |
| **(slug, peerSlug)** ×1 | `peerConversationFor` (the pair-arity one — enumerate the full peer matrix) |
| **(role)** ×2 | `displayNameForRole` · `slugForConversationRole` |
| **garden-wide** | `loadResidents()` (the roster itself — order byte-asserted, the P0-roster-seam precedent) · `SHARED_SURFACES` (assert STAYS EMPTY — the P3-compressor shadow lesson) · the `GardenIdentity` fields · the ladder registry (`OPUS_LADDER`/`SONNET_LADDER`/`FABLE_LADDER`/`CLI_LAUNCH_DEFAULT` name→models resolution, per name) |
| **behavioural** ×1 | `addressedToOtherResponderOnly(slug, text)` — derived from aliases; prove via a fixed text-fixture set per slug |

**The proof shape**: one script (`scripts/test-p1-equivalence.ts`) snapshots every cell of the matrix
against the PRE-extraction TS literal (imported from a frozen copy), then loads the extracted
`$HAN_HOME/garden-manifest.json` through the new loader and re-reads every cell — `deepEqual` per
cell, every mismatch listed, zero tolerance. Run pre-commit AND in the P5 scratch-garden.

**Schema notes**: `runsOrchestrator` (MNT-030's leaf) is DESIGNED-IN as an optional per-agent field
now (default: derives false; 3847's owner sets true post-P1) so MNT-030's PR is a leaf-flip, not a
schema change. Test-only exports (`__reset…`/`__set…`) stay engine-side, not config.

**Rider-3 checklist** (the os.homedir() convergence): tmux-dispatcher `HEALTH_DIR`/`PIPES_DIR` +
every `os.homedir()/.han` local found by `grep -rn "homedir().*\.han\|homedir(), '\.han"` →
`paths.ts` accessors, same commit.
