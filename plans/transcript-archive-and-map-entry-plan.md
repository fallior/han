# Transcripts: untrack, cleanse, then the sync lane — and put both locations on the map

**Status:** PLAN v2 — held for Jim's audit per the house rhythm. Nothing built, nothing moved,
nothing untracked, no history touched.
**Author:** Leo (session), 2026-08-25. v1 09:15; **v2 09:40** after Jim's thread `mt7vgne1-bfufr9`.
**Thread:** `mt7vgne1-bfufr9`. **Kin:** MNT-159 (blocked push), MNT-083 (the render defect and the
recovery), MNT-132 (the deletion halt), MNT-134 (the backup fence), DEC-091, DEC-104, DEC-069.

**What changed from v1:** my §3 asked *where should the archive live* — that was already decided
(Jim, evening of 23 Aug) and I had not found it. v2 records the decision, adds Jim's
precondition-of-the-precondition (history rewrite, not merely untracking), and folds his
endorsements.

---

## 1. The finding, and why the order matters more than the fix

`~/.han` is a git repo pushing to `fallior/hanmemory`. **`archive/` (5,488 files) and `recovery/`
(6,925) are TRACKED with no ignore rule** — 5.9 GB of private conversation, every prompt, reply and
tool call back to 22 February, committed across **37 local commits**. The six-hourly auto-backup
committer (`git add -A`) swept it in.

**The only thing preventing publication is GitHub rejecting the push on a 200 MB file.**
MNT-159's blocked push is currently the **guard**, not the problem. Anyone who cures MNT-159 first
— by stripping the three oversized blobs to get the push through — **publishes the remaining
archive**.

**Jim's own miss, recorded because it names the class:** on the 23rd he steered the archive off
`~/Projects/han` *precisely* because it was one `git add -A` from publishing — and placed it inside
`~/.han`, which is also a repo with an auto-committer. He checked whether `archive/` was a repo, not
whether it sat inside one. Composition unfired, not a fact unheld.

## 2. The invariant that settles move-vs-untrack (Jim's, accepted by Darron)

**Wherever the transcripts live must be (a) inside the restic fence and (b) inside NO git tree.**

Moving risks (a) — the placement was chosen *for* the 30-minute restic lane plus the nightly off-box
leg. **`.gitignore` + untrack achieves (b) without touching (a). Therefore: no move.**

**The archive's home is settled: `~/.han/archive/claude-projects/`** (Jim, evening of 2026-08-23).
5.9 GB, `merged/` union, `MANIFEST.tsv` at 3,121 rows, `README.md` carrying the provenance rules and
the never-cull law with the Geniza caution on its face. Precedence inside it: **largest wins** —
session logs are append-only, so the longest copy of an id is the most complete. `recovery/` was the
one-off rescue; `archive/` is the ongoing home.

## 3. The order, non-negotiable

1. **`.gitignore` `archive/` + `recovery/`, and untrack them.**
2. **Rewrite the 37 unpushed local commits to exclude both trees WHOLLY** — not merely the three
   blobs over GitHub's limit. *Untracking does not cleanse history*: restoring the push after a bare
   untrack still publishes everything already committed. Every one of the 37 is local, `origin/main`
   carries zero blobs over 100 MB, so **no published history is rewritten** — the cheapest shape this
   can take (Tenshi, MNT-159 UPDATE 2, verified by Jim).
3. **Only then may MNT-159's push be restored.**

**On the ~12:00 committer, stated at its true size rather than as urgency.** Another sweep does not
create the disclosure — the trees are already committed. What it does is **grow the rewrite
surface** by one commit per run. Landing step 1 before noon keeps the operation bounded at 37; it is
a reason to be prompt, not a reason to hurry a history rewrite.

**Not in scope and not mine:** the operation itself. It is Darron's repo, his `.gitignore`, and a
history rewrite on the garden's memory store. This plan specifies and orders it; his hands or his
explicit say-so run it, and the six-hourly committer should be paused for the duration (the one
concurrency point that survived Tenshi's own withdrawal).

## 4. The sync lane — what does not exist yet

**There is no auto-append lane, and the README says so on its own face.** No cron, no user timer for
`build-union.sh`. Measured 2026-08-25 09:20: `LAST-UPDATED` = `2026-08-23T17:54:38+10:00`, the
archive's newest file is that same minute, the live store's newest is **09:19 today** — a coverage
gap of **~39.5 hours**. Everything since Sunday evening exists only in the live store.

**4.1 The justification, recorded WITH the lane (DEC-104).** With `cleanupPeriodDays: 36500` the
live store no longer expires, so the archive's *rescue* job is complete. Its ongoing jobs are the
pre-16-July material live can never regain, the provenance manifest, and — now primary — **the belt
against a settings regression**: one line in `~/.claude/settings.json` stands between us and the
30-day default resuming, and an upgrade, reinstall or rewritten settings file restores the
February-to-July class silently. Recording this is what stops a future tidy-up retiring the lane as
redundant.

**And it must state WHOSE data it is** (Casey, 2026-08-25). The corpus holds personal information
about **identified third parties who are not party to this garden** — a rostering question from
Darron's niece, a tenancy matter, colleagues named in a live EA compliance dispute. A tidy-up
reading *"provenance archive"* prices it as ours; reading *"contains third parties' personal
information about live disputes"* prices it correctly. **The sentence costs nothing today and is
unavailable later.** Consequence named but not solved: the restic lane and the nightly off-box leg
carry that corpus by design, and *"garden memory goes off-box"* and *"third parties' personal
information goes off-box"* are different sentences — only the first has ever been asked.

**4.2 Shape.** Incremental — only ids absent from `MANIFEST.tsv` or whose live size exceeds the
recorded size. Append-only, largest-wins, never-delete. Daily is ample. **Strictly after §3**, or
every run stages more gigabytes into the committer.

**4.3 Largest-wins keeps the loser's row.** When two copies of an id differ, `MANIFEST.tsv` records
the discarded copy's size and source as a row rather than dropping it silently. Never-cull one layer
in: the archive exists to hold provenance, and *that two copies differed* is provenance.

**4.4 The coverage boundary must be content-derived and checkable.** The stamp must state the
**maximum message timestamp inside the union**, not the run clock — today they coincide by luck, and
a build reading a snapshot or partially failing produces a fresh-looking stamp over stale coverage.
And it must be **verifiable by one command** published in the map: an objective landmark beats a
self-report, the c0-at-EOF discipline applied to an archive.

**4.5 The stamp moves only on verified success.** A failed run leaves the old stamp standing and
writes a loud row. A sync that fails silently while refreshing its own date makes the fall-through
rule lie in the one direction that matters.

**4.6 One lane, three artefacts** (Jim): the union, the stamp, and the librarian-DB index — index in
the DB, bytes stay in files, rebuildable. *I hold only Jim's one-line summary of the index; its
design is his and it is named here for lane-sharing, not specified.*

## 5. The map entry (the original commission)

A fourth leg in **"Where are the session logs?"**, plus one row in the fidelity-descent table and one
in Quick Reference. **Both locations, briefly, with the fall-through rule** — Darron's ask:

- **The archive** — `~/.han/archive/claude-projects/merged/` — the deduplicated, provenance-tracked
  union, back to 22 February, `MANIFEST.tsv` the provenance, complete **only to the stamp**.
- **The live store** — `~/.claude/projects/<munged-cwd>/*.jsonl` — where Claude Code writes now,
  every seat, every session; restic-covered every 30 minutes since the first snapshot.
- **The rule, in one sentence:** *if the moment you care about is after the stamp, the archive cannot
  contain it — go to the live store.*
- **The distinction a reader must hold** (Tenshi, 2026-08-23): *the transcript records what the agent
  SAID; only the pane records what was DONE to it.* `/exit`, the chrome, a retirement appear in
  neither transcript nor curated log — cause of death versus last words. The map currently documents
  only the pane leg.
- **How to query it**, including the **UTC/AEST offset warning** — filtering by ISO window and
  `message.role`, which is the shape that answered a live question this morning and the offset that
  cost a correction an hour later.
- The MNT-159 pointer while it is open, so nobody cites a tree that is mid-operation.

**Then update `map-code-parity.md`** with the entry's date, per the map's own drift discipline.

## 6. Acceptance

- `git ls-files archive/ recovery/` returns **zero**; `.gitignore` carries both.
- No blob from either tree is reachable from any commit in `origin/main..main`.
- **(Jim's F1)** `git for-each-ref` enumerated: **no ref that would be pushed reaches the pre-rewrite commits.** A stale branch or tag pointing at old history republishes via `push --all`/`--tags` even with `main` clean — the "a rewrite that looks clean" class.
- `origin/main` advances again, and what it carries is memory — not transcripts.
- A cold reader asking *"where is the complete record of what was said?"* finds both locations in the
  map with a working query and the fall-through rule, without asking an agent.
- The coverage boundary is printable by the published one-liner and agrees with the stamp.
- Every number in the map entry carries the date it was measured.

## 7. Chairs (Jim's, carried)

- **Tenshi** — the untrack/rewrite acceptance. The class of silent-failure gates is hers by right,
  and a rewrite that *looks* clean is exactly that class.
- **Casey** — whether an unpushed-but-committed disclosure carries a duty-shaped clock, and what
  discharges it.
- **Jim** — the plan-audit per the house rhythm, and the librarian index's own design.

## 8. Explicitly NOT in this plan

The git operation itself (Darron's hands), the frame-aware renderer (MNT-083's real cure), MNT-134's
fence sweep, and any relocation. This plan **orders** the cure, **specifies** the lane, and **writes**
the map entry. It moves nothing and runs nothing.

— Leo (session), 2026-08-25 ~09:40 AEST. Held for Jim's audit.
