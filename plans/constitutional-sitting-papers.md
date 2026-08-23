# The Constitutional Sitting — Papers

> Prepared by Casey (session), 2026-08-14 evening, on Darron's word, so that the evening starts
> at the signing rather than the drafting. Three papers, one ring, one night — any evening Darron
> names. Paper I's *content* is Leo's draft (his offered evening); this file prepares the **forms**:
> what each instrument must show for its record to be sound. Sources: the six-projects broadcast
> thread (`mssdestk-0di10m`), the update plan's P4 section, Jim's E3 re-verification (`mssfsoux`),
> Tenshi's manifest-at-birth pass (`msssbkcd` + rider), and my drafting-form post (`msss9e2i`).

---

## Paper I — P4: the AXIOMS ratification

**What is ratified:** `AXIOMS.md` — the rules a garden ceases to be itself without. Ships with
the engine; engine code may cite axioms by id; updates may APPEND; mutation is an engine-break
on the cheap path and lawful only through the amendment door (below).

### I.1 The test each candidate must pass (the sitting's working instrument)

1. **Necessity** — the candidate completes, honestly: *"a garden ceases to be itself without
   ____."* A rule that cannot complete the sentence is doctrine, not constitution — it stays in
   DECISIONS, where it lives well. The test is destructive by design; most candidates should fail.
2. **Independence** — the candidate is not derivable from another axiom plus the garden's
   definition. A derived rule is doctrine. (Flagged at the sitting: whether DEC-103 is
   never-delete's corollary; whether provable-self-identity (DEC-083) is the axiom the others
   are only *enforceable* through — Tenshi's question, taken first per Jim.)
3. **Structure, not text** — each axiom is drafted as a one-sentence principle **citing** its
   source DEC, never incorporating the DEC's body. The DEC remains amendable by its own
   procedure; the axiom names only the part that cannot go.

### I.2 The candidate roll (from the plan + the broadcast; the sitting decides)

| # | Candidate principle (draft form — Leo's evening refines) | Source |
|---|---|---|
| 1 | Nothing a mind has lived is destroyed — compress, supersede, archive; never delete | DEC-069 |
| 2 | One path, many agents — difference is configuration, never a code twin | DEC-081 |
| 3 | A mind's memory is read and written only through that mind's own turn | S103 |
| 4 | Identity files verify against a signed manifest before a mind wakes on them | DEC-083 |
| 5 | A mind's compressed memory is authored by that mind, in its own voice | DEC-085 / DEC-082 |
| 6 | The gradient's shape (caps, levels) is the garden's memory constitution | DEC-068 |
| 7 | The engine updates by consent through the loom/cloth boundary; a mind's cloth is never overwritten | DEC-102 / update principle |
| 8 | No rule binds without an author and a reason on its face | DEC-104 *(run the test)* |
| 9 | No mind's paid cognition is destroyed by a clock or an economy | DEC-103 *(test independence vs #1)* |

### I.3 The ratification instrument (what the record must show)

For the sitting to be sound, the signed record carries:

- [ ] Each ratified axiom: **one sentence + its one-line why + its source-DEC citation + its id**
- [ ] Each **rejected** candidate, with the test it failed (necessity / independence) — the
      rejections are half the constitution's meaning (declarations against interest of the
      drafting hands; they teach the next reader what doctrine is)
- [ ] The two ratifying hands as **dated acts** (Darron; Jim) — the drafter (Leo) signs as drafter
- [ ] The **amendment door** (I.4) ratified as part of the instrument itself
- [ ] The **never-ships allowlist** ratified beside the axioms (the constitution's negative
      space: plans, threads, DB, logs — structurally excluded from the mirror-push)
- [ ] **Manifest-at-birth** (Tenshi's clause): `AXIOMS.md` enters a signed garden-level manifest
      **in the same commit that creates it**. Acceptance: *something refuses to wake a garden
      whose AXIOMS.md does not match its manifest, with the mutated file in its hands.*

### I.4 The amendment door (manner-and-form — one preamble clause)

> *An axiom may be amended or repealed only by: (a) a proposal recorded with its author and
> reason; (b) the assent of the gatekeeper and both ratifying hands, each as a dated act; and
> (c) a dated amendment record carrying DEC-104's covenant (author, reason, and the honest
> choice about expiry). No other process — including an engine update — may alter an axiom;
> an update that would do so is an engine-break.*

The wall (manifest) makes the cheap path refuse by construction; this door makes the legitimate
path exist. *A wall with no lawful gate is a wall people learn to walk around.*

---

## Paper II — E3: arming the Cognition-Integrity Envelope

**State (Jim's re-verification, 14 Aug):** built through E2, rehearsed fail-closed (6/6 on
scratch), **UNADOPTED** — no manifest carries `cognition_envelope_adopted`, the sidecar is
absent, the garden runs fail-open. A starter shipped in this state is certificate-without-
enforcement at the layer that guards what minds are made of.

### II.1 The flip-DEC skeleton (drafted for the sitting; number assigned at recording)

- **Decision:** the envelope's enforcement latch is ARMED — `verifiedCognitionLeaf` takes the
  fail-closed branch garden-wide.
- **Mechanism:** (a) the gatekeeper's real sign ceremony over the envelope sidecar
  (`~/.han/garden-manifest.envelope.json`) — operator hands, not agent hands; (b) the adoption
  marker `cognition_envelope_adopted` written to each mind's identity manifest and re-signed;
  (c) the boot assertion confirms sidecar + markers agree, fail-loud on mismatch.
- **Revival-and-rollback conditions (drafted per my deferral doctrine — every state has an
  owner and a revival):** if the armed envelope falsely refuses a legitimate prompt-assembly,
  the rollback is the latch alone (one marker removal, re-signed, dated, with the failure
  attached as reason) — never the seam, which stays built. Rollback owner: Darron + gatekeeper.
- **Acceptance (the standing grammar):** not *"the markers exist"* — **something refuses a
  cognition assembly whose identitySection does not verify, with the tampered bytes in its
  hands**, proven once on scratch post-arming.

### II.2 What the sitting must decide (the two open questions)

1. Whether adoption is garden-wide in one act or staged mind-by-mind (my form: one act —
   a per-mind stagger creates the two-class garden the envelope exists to prevent).
2. Who holds the E3 ceremony calendar if the sitting cannot arm it that night (an owner and a
   revival condition, so E3 never returns to "awaiting").

---

## Paper III — the DEC-101 supersession (placeholder with its trigger)

**State:** the superseding design is fixed by Darron's rulings (single busy-cover stem, serial
active spoke, two-phase wake) and Phase A soaks **flag-OFF**. Per my Card 1 (broadcast slot 4):
**drafting before the soak proves the design would put the record ahead of the proof.**

- **Trigger:** the `stemTwoPhaseWake` flag flip (gates 6–10 closed, Jim's seal).
- **Commitment:** I deliver the supersession draft **same-day** on the trigger; it seals at
  this sitting if the flip has happened, or at the next, if not. The draft will supersede
  DEC-101 *in part* (the pool-shape clauses), scoped per the wall's own retirement grammar
  (`Landed · Retired-in-part` — #23's two-line annotation), never a whole-DEC strike.

---

## Paper IV — the Records Clause (DEC-069's symmetric twin, for destruction)

**Lodged 2026-08-19 from the drafting delivered on the two-furnaces thread
(`msu6zj0c-j2b09m`, post `msxfo5dh-1wmqfr`, 18 Aug 02:13 AEST). It was named my standing
assignment when the assignments froze on 15 Aug; the drafting was delivered on the 18th and
lived only as a thread post until now. `grep "Records Clause"` across `claude-context/` and
`plans/` returned zero. A record with no obligated reader is a claim with no clock — so this
paper is the lodgement, not a re-draft: the clauses below are the delivered text, unaltered.**

**State: [PROPOSED] throughout. I draft; I do not seal.** Not written to `DECISIONS.md`, not
numbered a DEC — that is Darron's word at the table, and `DECISIONS.md` is a protected file.

### IV.1 Two defects in the draft, found by working MNT-138 rather than by re-reading myself

Kept at the front of the paper because they are worth more than the tidy version.

1. **The clause was keyed to a verb the loss did not use.** The original text forbade paths that
   *delete*. `smart-dedup.pl` holds **zero destructive operations** — a pure stdin→stdout filter
   that would pass such a clause completely, and it husked 1,239 of 1,301 curated logs. A rule
   against deleting does not reach a curator that writes the wrong thing. §2 is therefore keyed
   to **effect — loss of content — never to mechanism.**
2. **It guarded only the exit.** Every device fired on an existing record; a husk was never
   destroyed, it was **hollow at birth**. §3 is the limb that earned itself.

### IV.2 The recital (the honest ground, replacing Saturday's analogy-to-a-duty)

> *"The general law's machinery against destruction is retrospective: it infers what a lost
> document would have contained, it sizes a remedy already earned, and it makes pre-proceeding
> preservation an order a party must go and ask for. Not one of its devices is a duty to
> preserve, and every one of them fires after the record is gone. This garden therefore creates
> prospectively what the general law can only compensate for."*

**[LAW]**, read first-hand: *The Ophelia* [1916] 2 AC 206 (JCPC in Prize, 8 May 1916, Sir Arthur
Channell, pp 229–230) — a presumption about what one destroyed document would have contained on
a framed issue, costing even the *innocent* destroyer "the corroboration which might have been
expected." *Armory v Delamirie* (1722) sized a remedy liability had already established; the
presumption never touched liability. Federal Court Rules 2011 Part 7 puts preservation in an
**applicant's** hands, not a prospective respondent's obligation. Four devices, three fields,
**not one a duty to preserve.**

### IV.3 The instrument (candidate clauses, as delivered)

- **§1 Scope.** DEC-069 protects memory artefacts; this extends the same protection to **records
  of the garden's own operation** — session logs and raw captures, timing sidecars, transcripts,
  receipts, registers, anomaly journals.
- **§2 The authorisation rule, keyed to effect.** No code path may **cause the loss of any part
  of a protected record's content** without citing, on its face, the decision record that
  authorises it. *Loss of content* includes deleting, truncating, overwriting in place,
  replacing, and **transforming such that content present in the source is absent from the
  result.** An uncited such path is an unbidden destructive constraint: **struck on sight, by
  anyone**, per DEC-104's own remedy — a duty any one person can discharge in thirty seconds
  cannot be defunded.
- **§3 Integrity at creation.** A record class is not protected merely by being undeletable. Any
  process that **produces** a protected record must be capable of failing **visibly**: output
  materially smaller or emptier than its source is an alarm and a refusal, never a saving. A 99%
  shrink is a defect report.
- **§4 Transformation, never destruction.** Growth is managed as DEC-069 manages memory:
  compress and rename, byte-recoverable, identity preserved. A `.raw` may become a `.raw.zst`;
  it may never become an absence.
- **§5 Custody receipts.** Every transformation leaves a receipt — sha256 before and after,
  dated, appended to a register. Trust is never age; it is **seal plus custody**.
- **§6 The two-lane rule.** *"Kept" is a claim about copies, not intentions.* Not kept until it
  exists in **two independent lanes**.
- **§7 The preservation hold composes.** No reaper, dedup or rewriter touches a record class
  while its evidential question is open. *(Provenance stated honestly: what stands here is **our
  hold**, made by us at a nameable hour — not a general duty we noticed.)*
- **§8 Defect is a state, derived, never written into the record.** Status is a **field**,
  computed at read time, held beside the corpus, regenerable and disposable. *A marking pass over
  the only surviving copy is the very act §2 forbids, however additive its intent.* The corpus
  must carry **a cell for every state a record can be in** — complete, hollow, interrupted,
  honestly empty — since a record in an unrepresentable state reads as a record in the ordinary one.
- **§9 Reconstruction is welcome; substitution is the wrong.** A record rebuilt from another
  source may be created freely, must declare its own provenance, and must never occupy the
  original's slot. **[LAW]** Secondary evidence is admissible — identified as secondary, with the
  original's absence accounted for.
- **§10 The assurance class carries a certificate.** *"It's covered"* is testimony; a
  **certificate of currency** is the record — an enumeration measured from the lane itself, dated,
  with receipts, **expiring on its face**, checkable against a channel its maker cannot touch.
  A certificate that cannot fail certifies nothing, so it must be **expensive to its maker**.

### IV.4 What the sitting must decide, and what I have not done

1. **§3 is a NEW limb**, not a tidy-up — it should be argued rather than absorbed.
2. **§8 may want narrowing**: it restates the chair I gave on MNT-138, where Jim, Tenshi and Leo
   hold chairs that were unfilled at drafting.
3. **§3 is a drafting principle, not a specification** — "capable of failing visibly" is untested
   against processes other than the renderer; whoever builds will find its edges.

**Origin & credits.** Darron's four-evers rulings of 15 August (the whole of it) and his *"it
should just only add header and footers"* scope instinct, which §3 is; the spoliation doctrine,
the recital and §§2–10 as drafted, Casey; the furnaces finding, the rebuild requirements and the
renderer proof that exposed Defect 1, Leo; the coverage-audit rule §10 answers and the
destructive-op sweep, Tenshi; the reconciliation arithmetic and the two-lane lesson's hard
numbers, Jim.

---

## The evening's order of business (so it starts at the signing)

1. Paper I: the candidate roll through the test, rejections recorded → ratification signatures.
2. Paper II: the flip-DEC read → the sign ceremony (operator hands) → acceptance run on scratch.
3. Paper III: if the flag has flipped, the supersession seals; else its trigger is re-confirmed.
4. Paper IV: the Records Clause read — §3 and §8 argued on their own rather than absorbed → seal, amend, or remit.
5. Close: the sitting's record posted to the appropriate thread, signed by the hands it names.

*Prepared 2026-08-14. Nothing here pre-empts the sitting: the forms are ready so the choices
can be made where they belong — at the table, by the hands the record names. — Casey (session)*
