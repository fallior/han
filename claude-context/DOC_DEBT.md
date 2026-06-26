# Doc-Debt Ledger (#69 follow-up)

> Every commit that used a `Docs-skipped:` trailer to bypass the parallel-doc
> gate creates **doc-debt**. The gate validates a skip *reason* is specific; it
> does NOT verify the promised doc ever lands. This ledger is the **source of
> truth for repayment status**, and `scripts/doc-debt.sh` surfaces anything
> OUTSTANDING so it nags until paid.
>
> **A debt is PAID** when the promised doc landed — a later commit references
> the hash, or the named doc surface was updated. Mark it `PAID (<hash>)`.
> **The rule (Darron, S166):** if you allow a doc-skip, the reminder keeps
> firing — and past a threshold a commit must either pay a debt or carry
> `Doc-debt-ack: <hash> still-deferred: <why>`. Annoying by design.

| Hash | Date | Code changed | Reason (abridged) | Status |
|---|---|---|---|---|
| `fea1a6d` | 2026-06-02 | model pin 4-6→4-8 | rationale in Garden-Manifest thread + docs commit | **PAID** (`fc36a9e`) |
| `ebdab9e` | 2026-06-02 | garden-manifest Phase 0 | design doc lands in docs commit | **PAID** (`fc36a9e`) |
| `4040405` | 2026-06-02 | P0 clean-death | diagnosis in server-fleet plan + docs commit | **PAID** (`fc36a9e`) |
| `73b000c` | 2026-06-02 | P1 terminal-search | design in provenance plan + docs commit | **PAID** (`fc36a9e`) |
| `2ff2c8e` | 2026-06-03 | gradient-load fix | CHANGELOG lands w/ paired felt-moments commit | **PAID** (`4f73df5`, verified S166) |
| `30598c1` | 2026-05-31 | the hook itself | n/a — *mentions* the trailer, satisfied via `plans/` | **N/A** (not a real skip) |

**Outstanding: 0.** (5 real skips, 5 paid — verified by the S166 audit; `git show 4f73df5 --stat` confirms +10 lines to CHANGELOG referencing `2ff2c8e`.)

— Seeded by Leo, S166 2026-06-03. Planned: `commit-msg` hook auto-appends new skips here as OUTSTANDING; `pre-commit` runs `doc-debt.sh` and escalates the nag by age.

---

## Living-docs sweep — named follow-on rewrites (S204, 2026-06-26)

These are NOT doc-skips — they are *deliberately-deferred full rewrites*, bannered-not-rewritten in the sweep (banner is sufficient per Jim's rule; the full rewrite is its own tracked batch). Recorded here so they nag until done.

| Follow-on | Doc | Why deferred | Status |
|---|---|---|---|
| Full **Step-5 rewrite** (drop the relic "main server" framing; describe watchdog-fleet natively) | `docs/PORT_ALLOCATION.md` | a 251-line rewrite; banner + "never restart" prohibition neutralised the danger | **OUTSTANDING** |
| Full **transport/AI-section refresh** (SDK-era → warm-tmux per DEC-094/095) | `claude-context/ARCHITECTURE.md` | broad pre-#66 narrative; banner flags it; no harmful instruction | **OUTSTANDING** |
| Update **"Agent SDK — task execution"** line when the off-SDK task-pipeline lands (#8) | `README.md` | true today; flagged for #8 | **DEFERRED (gated on #8)** |
| Promote the **`status:`/`last-verified` frontmatter convention** to a small DEC + lint | (DECISIONS.md + `scripts/doc-debt.sh`) | stated in `living-docs-sweep-plan.md`; promote with refined-order step 3 | **OUTSTANDING** |
| Full rewrite of the **Robin-Hood resurrection docs** (drop the `han-server.service` relic topology) | `docs/ROBIN_HOOD_EXECUTION_GUIDE.md` + `docs/ROBIN_HOOD_README.md` | danger-bannered this pass (Jim's Q5 catch); full rewrite rides the mutual-guardian-ring redesign | **OUTSTANDING** (rides `mqs7w5o6`) |

Archived/bannered this sweep (banner-not-delete, DEC-069): `claude-context/LEVELS.md`, `claude-context/PROJECT_BRIEF.md` (Batch E); `claude-context/SYSTEM_SPEC.md`, `docs/CHANGELOG.md` (Batch A/B); `docs/HAN-ECOSYSTEM-COMPLETE.md` (referencing-demotion, B); `docs/PORT_ALLOCATION.md`, `claude-context/ARCHITECTURE.md` (front-door banners, C); `docs/ROBIN_HOOD_EXECUTION_GUIDE.md`, `docs/ROBIN_HOOD_README.md` (danger-banners, Q5).
