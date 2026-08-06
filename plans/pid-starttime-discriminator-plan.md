# PID Starttime Discriminator — "name plus date of birth" for the pid-guard

> **Status:** PLAN (Casey's offering at the MNT-089 land, endorsed by Tenshi/Jim for the
> guard's next revisit; commissioned by Darron 2026-08-06 evening). Author: Leo (session).
> **Scope:** `src/server/lib/pid-guard.ts` + its suite. One field written, one comparison
> read. No call-site changes required.

## The principle (Casey's, quoted for the record)

*"The law's oldest answer to recycled names is not better name-matching; it is name + date
of birth, because attributes can coincide but a person's origin moment cannot."* A recycled
pid — even one wearing the right cmdline token in the right env, even the two-rung
coincidences the audits priced as tiny — **cannot present the original's birth tick.**
Every probabilistic residue in the current classifier goes to zero: Tenshi's
substring-token note, Jim's N2 slugless edge, all retired by one field.

## The mechanism — VERIFIED IN THE METAL, 2026-08-06 (not from anyone's memory)

- `/proc/<pid>/stat` **field 22** = the process's start time **in clock ticks since boot**.
  Measured tonight on this box: per-process, strictly increasing across successive spawns
  (17288433 → 17288464 for two `sleep`s spawned ~300 ms apart), **stable across re-reads**
  of the same process. `(pid, starttime)` is unique within a boot by construction.
- **The comm-parens parsing trap** (verified approach): field 2 (`comm`) may contain spaces
  and parentheses — never `split(' ')` the whole line. Parse from **after the last `)`**:
  `stat.slice(stat.lastIndexOf(')') + 2).split(' ')`, where `state` = token[0] (field 3),
  so **starttime = token[19]**.
- Build-time due diligence (Tenshi's label): read `man 5 proc` once at build and cite it in
  the code comment — "two agents' memories" is not a source; tonight's measurement plus the
  manpage is.
- Boot-boundary note: starttime is ticks **since boot**, so comparisons are only meaningful
  within one boot — which is exactly the pidfile's own lifetime of meaning (a pre-reboot
  pidfile's pid is dead or recycled anyway, and the dead-pid path already classifies
  `absent`). A recorded starttime from a previous boot simply never matches: fail-safe.

## Design

1. **Write:** `writePidFile` records `"<pid> <starttime>"` (space-separated, one line —
   human-readable, `cat`-able, jq-free). `cleanup()` compares only the first token
   (unchanged semantics).
2. **Read:** `readClaimedPid` returns `{ pid, starttime? }` — **starttime absent = legacy
   bare pidfile**, classified attribute-only exactly as today (rolling upgrade: the first
   restart of each service rewrites its pidfile in the new form; no flag day, no migration).
3. **Classify:** `classifyPidClaim` gains an optional `expectedStarttime`. When present and
   the live process's field-22 differs → new verdict **`birthdate-mismatch`** (stale claim:
   logged, never obeyed, never killed — joins the existing never-obey family). When absent →
   current behaviour, byte-identical.
4. **Verdict precedence:** birthdate runs AFTER `not-a-process` (a thread id has no
   meaningful starttime comparison) and BEFORE the cmdline/env attribute checks (the
   birthdate is the stronger discriminator; attributes remain as the legacy-file path and
   as defence-in-depth when both present agree).

## Suite additions (the existing 8 stay byte-true)

- **T9 — birthdate mismatch:** spawn a child, write `"<pid> <starttime+1>"`, assert
  `birthdate-mismatch`; assert ensure() proceeds and replace() does not kill it.
- **T10 — legacy bare pidfile:** write `"<pid>"` alone, assert classification falls through
  to the attribute path (backward compatibility pinned).
- **T11 — birthdate match:** write the true pair, assert `ours` (the happy path still
  closes on genuine duplicates).
- **T12 — cleanup ignores the second token:** guard writes pair, cleanup still removes own
  file (first-token comparison pinned).

## Non-goals

- No change to any call site (the four + the held parity guard consume the same API).
- No cross-boot persistence semantics (see boot-boundary note — fail-safe by construction).
- No removal of the attribute checks: name+DOB *plus* the livery, not instead of it.

## Rhythm

Build in the next guard slot → suite 12/12 → hold for the three chairs (Casey's eye
specifically invited: the doctrine is hers) → land + rolling restart. Estimated size:
~30 lines of lib, ~40 of suite.

— Leo (session), 2026-08-06. Empirical verification run the same evening; plan supersedes
the "consider start-time stamping" line in MNT-089's owed-list.
