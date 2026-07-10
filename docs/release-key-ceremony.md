# The Release-Key Ceremony — signing and publishing a HAN release

> **Status**: LIVE (P3c of the update pipeline, S220; thread `mqz3wev0-uggkzq`).
> Ruling: **DEC-102** (Ring 1 = the human-signed release root; Ring 2 = the identity
> ceremony). Security ledger: `plans/update-pipeline-security-audit.md` (Tenshi's tracker,
> SEC-01/SEC-12). The root was born 2026-07-08 (Darron's hands, off-box) and proven
> end-to-end the same day (fixture `v0.0.0-ceremony-test`).
>
> *The invariant (Tenshi's words, verbatim — future gardens inherit this as law):*
> **"An update changes a mind only when a human signature and a human's eyes both say so,
> over a diff neither the attacker nor the noise can hide in."**

## The root (what everything verifies against)

- The **garden-release key** is an SSH key held **off-box by the human gardener**. Signing
  anything with it is a deliberate human act; the box never holds the private half.
- Every garden pins the PUBLIC half at `$HAN_HOME/credentials/release-allowed-signers`,
  instantiated at genesis from the engine's `seeds/release-allowed-signers` and **never
  read from the working tree** — a poisoned tag cannot alter the root that verifies it.
- `scripts/verify-release-tag.sh` is the one verifier: tag → pinned root → exact commit
  hash, fail-closed. `han update` runs it at step 0 before anything else.

## Signing a release — ONE deliberate act, three parts, no partial forms

Signing a release means signing **the tag AND `freshness.json` together** (SEC-12
sign-at-ceremony). There is no lawful release with one and not the other — an unsigned
tag is rejected by every garden, and **a release without co-signed freshness silently
blinds every downstream garden's anti-withholding detector** (the one attack a signature
cannot see is a frozen mirror; freshness is the cure, and it only works if EVERY release
carries it).

At the off-box seat, in the release worktree:

1. **Compose the release** — merge what ships, update `CHANGELOG.md`, choose the tag
   (`vYYYY.MM.DD[.n]` — the ordering scheme the downgrade guard enforces).
2. **Write + sign freshness** (the anti-withholding half):
   ```bash
   # latest_version MUST name the tag being cut; expires_at GENEROUS against the real
   # release cadence (F2: a tight expiry self-DoSes a healthy-but-quiet garden).
   cat > freshness.json <<EOF
   {"latest_version": "vYYYY.MM.DD", "released_at": "<now, ISO-8601 UTC>",
    "expires_at": "<now + freshnessMaxAgeDays, ISO-8601 UTC>", "prev_version": "<prior tag>"}
   EOF
   ssh-keygen -Y sign -f <garden-release-key> -n file freshness.json
   git add freshness.json freshness.json.sig && git commit -m "release: freshness for vYYYY.MM.DD"
   ```
3. **Sign the tag** (the Ring-1 half):
   ```bash
   git -c gpg.format=ssh -c user.signingkey=<garden-release-key.pub> \
       tag -s vYYYY.MM.DD -m "<release notes block — the SEC-07 new-field enumeration lives here>"
   ```
4. **Publish through the gate** — never a bare `git push`:
   ```bash
   scripts/publish-release.sh vYYYY.MM.DD
   ```
   The gate **refuses** unless the tag verifies against the pinned root AND a co-signed,
   unexpired `freshness.json` naming exactly this tag sits at the tip. Forgetting the
   freshness is a **loud exit-1 at publish time**, never a silent detection-loss
   downstream — structural, not a checklist line (Tenshi's P3b routing).

## The freshness verdicts a garden computes (the typed dispatch — never soften)

`han update` types the freshness outcome so the fatal/advisory split is **structural**
(Tenshi's P3b #2 — editing a typed dispatch is deliberate; relaxing a boolean is not):

| Outcome | Class | Behaviour |
|---|---|---|
| `BAD-SIGNATURE` | **fatal** | A forged freshness — a detected attack. Hard-abort, never flag- or force-bypassable. |
| `REPLAYED` | **fatal** | A genuinely-signed but older-than-high-water freshness — a replay of the detector itself (F1). Hard-abort, same class as the tag-downgrade guard. |
| `unverifiable` (pin missing) | **fatal** | No root, no trust — fail-closed. |
| `expired` | advisory, **flag-gated** | The staleness signal (F2). `update.enforceFreshnessExpiry` (P3d manifest leaf, default OFF, armed at lattice integration) gates ONLY this outcome. |
| `absent` | advisory | Honest report: SEC-12 detection inactive until the first ceremony-signed freshness. |

**P5 asserts a REPLAYED freshness aborts with the flag OFF** — the flag governs expiry
alone, by type, and no "consolidation" may fold the fatal outcomes into the advisory path.

## Key rotation (named from day one — DEC-102 rider 2)

- **Routine rotation**: the OLD key signs a release whose tree updates
  `seeds/release-allowed-signers` with the new public key — verifiable from the pinned
  root, so the chain never breaks.
- **Compromise recovery**: **out-of-band by construction** — a hand-delivered new pubkey
  to each garden operator (replace `$HAN_HOME/credentials/release-allowed-signers` by
  hand). There is deliberately no in-channel path: a channel that can rotate its own root
  is a channel an attacker can rotate.

## Ring 2 — what the gardener sees at update time (the identity ceremony)

When a release carries a migration declaring `touchesState` on **authored identity**
(identity.md, patterns, felt-moments, self-reflection, the manifest `identitySection` —
DEC-083's set, keyed on content), `han update` holds the garden in a **designed visible
freeze** inside the quiesce and presents the ceremony document:

- the **semantic diff** — exact added/removed line counts, unified diff, and the
  adversarial-sensitivity findings (every invisible codepoint NAMED — zero-width, BOM,
  bidi controls; confusable substitutions flagged when a changed line *renders identical*
  to the line it replaced);
- a declared **content-preserving** migration must render an **EMPTY** delta — any
  non-empty delta is the one red flag; **schema-moving** is never auto-passed;
- approval is **digest-bound**: interactively (`y/N` at the TTY) or by writing the
  ceremony's digest to `$HAN_HOME/signals/update-ceremony-go` — an approval quotes the
  exact rendering it approves, so no stale or generic go-file can pass a diff unseen.
  Decline (or timeout) → **abort + auto-rollback**; the release stays re-deliverable.
- an **undeclared** authored-identity change never reaches a ceremony: it aborts and
  rolls back on detection (DEC-102: the legitimate case does not exist outside a declared
  migration).

The ceremony tool itself is release-signed code — its integrity inherits from the Ring-1
signature verified at step 0 (SEC-01-first, in the metal).

---
*Composed by Leo (session), S220, 2026-07-10 — P3c of the update pipeline. The doc rides
the same signed tree it describes; changes to the ceremony are release-visible by
construction.*
