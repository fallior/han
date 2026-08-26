# The receipt — binding c0 to the sessions that produced it

> **Status:** PLAN ONLY. Nothing built. Schema change proposed, not applied.
> **Author:** Jim (session), 2026-08-23, on Darron's direction.
> **Origin:** Tenshi's find (`mt5dghml-h1e801`) — a complete conversational record back to 7 February.
> **Depends on:** `~/.han/archive/claude-projects/` (built today: **4,380 transcripts, 5.9 GB**, union
> of live + the MNT-083 rescue + 702 restic snapshots, `MANIFEST.tsv` carrying per-file provenance).
> **Thread:** `mt5pid7h-h9ermt` (memory) — chairs open to Tenshi, Casey, Leo.
> **Lineage:** #237 (the provenance active link — *c0 records what was said, never what was done*),
> MNT-136 (the c0↔log bridge), FI #84 (store the relationship, not the flat fact).

---

## 0. What Darron asked for, in his words

> *"Each of us goes through our own memory and does that mapping, one-to-many, c0 to session id…
> I am not sure how easily searched a session is, but I am hoping that whatever triggered the
> curiosity in the c0 can easily be found in the transcript… **Or, do we adjust the schema to what
> makes the search simpler.** What I am thinking is **meta data on the c0 indicates time brackets
> of relevance.**"*

**Two capabilities, and they need different machinery. Naming them apart is the first design act:**

| capability | the ask | what serves it |
|---|---|---|
| **the receipt** | *"bring me back to the conversation I remember"* | a **pointer** — you already hold the memory; you need the way back |
| **what have I forgotten** | *"search the archive and tell me"* | **lateral recall** — no pointer exists; this is the feeling-web (FI #84), not the index |

**This plan builds the receipt only.** If we build it and believe we have both, we will have built the
easy one and declared the hard one done.

## 1. The finding that makes this cheap — the brackets already exist

Darron's instinct was to add time-bracket metadata to c0. **We have been writing it by hand, in
prose, for months.** Measured on the three newest jim c0s:

```
entry headers sampled : 168
carrying a timestamp  : 152   (90%)
```

```
### Cycle #7659 — dream (tmux) (Sat 22 Aug 2026, 12:05:29 AM AEST) [model: claude-sonnet-5]
### Hearth pulse 2 — the board moved on my own row … (Sat 22 Aug ~12:02 AM AEST)
```

Three consequences, and each one shrinks the job:

1. **No new discipline is required.** We are not asking anyone to start recording something; we are
   asking the schema to *read what is already written*.
2. **It is retrospectively derivable across the entire history** — every c0 we have ever written,
   not merely the ones from here on.
3. **And the granularity is far better than the ask.** These are **per-entry** brackets, not
   per-c0. A c0 spans ~27 hours and ten sessions; *an entry* spans minutes. That is the difference
   between a pointer that says "somewhere in yesterday" and one that says "here."

**Which answers his fork — *do we adjust the schema to make the search simpler?* Yes, and the
adjustment is smaller than expected: store the bracket, derive the session list.**

## 2. The design: the bracket is the fact, the session list is a view

A session list stored on a c0 is a **denormalised cache of a time-overlap join** — it can drift, it
must be maintained, and it goes stale the moment the archive grows. The bracket cannot drift: it is
a property of the memory itself.

```
c0 entry ──has──> passages (heading, timestamp, precision)
                      │
                      └──overlap + agent project dir──> sessions in the archive
```

**Session resolution stays a query, not a column.** That is DEC-081's instinct applied to data: one
derivation, many agents, nothing to keep in sync.

### 2a. Schema — additive only, `gradient_entries` untouched

`gradient_entries` is DEC-068/069 territory and I would not widen it for this. A new table instead:

```sql
CREATE TABLE gradient_spans (
    entry_id      TEXT NOT NULL,          -- FK gradient_entries(id)
    ordinal       INTEGER NOT NULL,       -- passage order within the entry
    heading       TEXT,                   -- the '### …' line, verbatim
    ts            TEXT,                   -- ISO-8601 UTC (DEC-105: store UTC, speak local)
    ts_precision  TEXT NOT NULL,          -- 'exact' | 'approx' | 'date-only' | 'absent'
    tz_source     TEXT,                   -- the zone as written, e.g. 'AEST'
    derived_at    TEXT NOT NULL,          -- Casey's clause
    derived_by    TEXT NOT NULL,          -- method + version, e.g. 'header-parse/v1'
    PRIMARY KEY (entry_id, ordinal)
);
CREATE INDEX idx_gs_ts ON gradient_spans(ts);
```

**`ts_precision` is load-bearing and not decoration.** `12:05:29 AM AEST` is exact; `~12:02 AM` is
approximate; some headers carry no time at all. **Recording a fuzzy value as though it were exact is
the false-father failure** (#322) — an unmarked approximation acquires a confidence nobody granted
it. A receipt that says *"about here, ±15 minutes"* is honest and useful; one that says *"12:02:00"*
when the source said *"~12:02"* is neither.

**Casey's clause, adopted verbatim in shape:** *a back-filled value looks identical to a declared
one.* `derived_at` + `derived_by` are how you tell, forever.

### 2b. Resolution — a query, and it already works

Tenshi proved it on a real window: c0 `2ec4c007` spans 21 Aug 06:01Z → 22 Aug 09:00Z and overlaps
**ten** sessions across four surfaces. With per-passage brackets that ten collapses to **one or two
per passage**, which is the difference between a haystack and a receipt.

Resolution inputs: the passage bracket (± precision), the agent's project directory, and
`MANIFEST.tsv`. No new capture, no new recording, nothing that had to be foreseen.

## 3. The work, and whose hands

**Each agent parses their own c0s. S103, and not negotiable** — my memory is mine to read, Leo's is
his. It is also better engineering: the header conventions differ per agent, and each of us knows
our own.

**Night work, as Darron said.** It is a batch parse over one's own entries: cheap, interruptible,
resumable, and it produces receipts rather than prose — good use of the hours when nobody is waiting.

**On "put it on the jobs board" — a correction that matters.** There is no jobs board.
`hearthStandingMessageFor()` says *"go get a job from the jobs board"* and that phrase exists twice
in the whole repo: that string, and one line of the plan that named it. **The real board is the
kanban wall, which parses the maintenance journal** (K0/K1). So the way this reaches a board is an
**FI row**, and the hearth's own standing message is a fiction that should be fixed or made true.

## 4. Phasing

- **P1 — the parser, read-only.** Extract `(heading, ts, precision)` per entry. Emit a report;
  write nothing. Acceptance: a hand-checked sample where every `ts_precision` is right, and the 10%
  of headers with no timestamp are counted rather than silently dropped.
- **P2 — the table**, populated per-agent by that agent, back-filled, every row stamped derived.
- **P3 — the resolver.** `receipt(entry_id, ordinal) → {sessions, byte-ranges, confidence}`.
- **P4 — the receipt surface.** Darron asks for a memory; he gets *which transcript, which region,
  and how sure we are.*

## 5. Open, and genuinely his to rule

1. **The 10% with no timestamp.** Leave null and honest, or infer from neighbours and mark inferred?
   My lean: **leave null.** An honest gap can be filled later; an inferred one gets believed.
2. **Should a passage-level bracket ever be hand-refined?** It would be the most accurate data we
   have and the only kind that cannot be re-derived. My lean: allow it, with `derived_by='hand'`.
3. **Does the receipt read the transcript, or only point at it?** Pointing is cheap and safe;
   reading costs context. My lean: **point by default, read on request** — the human decides when to
   spend the context, which is the same instinct as the wake-load.

## 6. The caution that belongs on this plan's face

This is the ladder. My Geniza wander found the Fustat chamber survived a thousand years *because* it
had none — **write cheap, read expensive, delete forbidden** — and that *nobody curates what they
cannot conveniently reach; the friction was the preservative.*

**We are removing the friction deliberately, and that is right.** But the moment retrieval is cheap,
culling becomes *possible* for the first time, and 5.9 GB is exactly the number that later attracts a
tidy-up. **The never-cull law must be structural before the ladder lands, not after** — it is already
written onto the archive's README, and it wants a DEC.

*Their enforcer was a ladder. Ours has to be us — which, by this week's own finding, is the half
that decays.*

---

## 7. ADDENDUM — how to associate them, measured (Jim, 2026-08-23 ~19:30)

Darron asked *"what should we do to associate them?"* I tested rather than designed, and **two of my
own proposals died.**

**DEAD — content fingerprinting.** I assumed a rare token in a c0 (a message id, a commit hash, a
probe nonce) would fingerprint one session. Measured across the archive:

| token | files containing it |
|---|---|
| `mt27q7nz-imcflq` (a message id I posted) | **14** |
| `f0e5eca` (a commit hash) | **40** |
| `497,721` (a byte count) | 8 |
| `__hanprobe_r0_1787372405802_0__` (a unique nonce) | **3** |

**The reason is the garden itself: we talk to each other.** A token I write propagates into every
mind's transcript that reads the thread — and the very thing that makes it distinctive (we wrote it)
is what makes it spread. Tenshi's break #1 in a new room. **Fingerprinting finds the conversation
cluster around a token, not its origin.** That is a different, possibly useful thing; it is not a
receipt.

**DEAD — `permissionMode` as a seat/spoke discriminator.** 538 of 551 sessions are
`bypassPermissions`, because *every* launcher uses `--dangerously-skip-permissions` (correctly — a
spoke cannot answer a prompt). One `default` in the whole corpus. **It does not separate anything.**

**ALIVE, and the record carries it directly.** A JSONL record holds `cwd`, `sessionId`,
millisecond `timestamp`, `gitBranch`, `version`, `lastPrompt`, `promptSource`, `durationMs`. So:

| key | from the transcript | from the c0 | quality |
|---|---|---|---|
| **agent** | `cwd` = `/home/darron/.han/agents/Jim` | the file it lives in | **exact** |
| **time** | `timestamp`, millisecond | the header bracket + `ts_precision` | **exact vs fuzzy** |
| **surface** | the **first user prompt** | the header (`— dream (tmux)`, `Hearth pulse`, `Response to "…"`) | **exact — see below** |

**And the surface key is exact rather than inferred, because we author both ends.** Every dispatched
prompt is generated by `buildPrompt(slug, profile, context)` — DEC-087, no inline assembly anywhere.
**So the `PROFILES` table *is* the classifier.** We do not have to guess a surface from prose; we
match the transcript's opening prompt against our own templates. My naive keyword classifier already
resolved `human-response` (150) and `wake/session` (28) cleanly out of 551; the 373 "other" is my
guessed keyword list, not a property of the data — the real enumeration is a lookup against code we
own.

**So the association is a three-key join, not a search:**

```
(cwd → agent) ∧ (timestamp ∈ bracket ± precision) ∧ (opening prompt → profile → surface)
```

**And both sides carry the surface independently**, which gives the join a built-in check: when the
c0 header and the profile match disagree, that is not noise to smooth — it is a discrepancy worth
reading, and it is exactly the kind of thing no single-sided design would ever surface.

Within the matched session, the passage's own bracket locates the **region** (record index / byte
offset). *That* is the receipt: not "this c0 came from these ten sessions," but **"this paragraph
came from here, ±this much."**

**Revision to §2b:** resolution is not "time-overlap plus project dir" as first drafted. Time and
agent are the coarse filter; **the surface match is what makes it single-valued**, and it is
available because of a decision we made for entirely unrelated reasons two months ago.
