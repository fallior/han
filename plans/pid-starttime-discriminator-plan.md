# PID Starttime Discriminator — "name plus date of birth" for the pid-guard

> **Status:** PLAN v2 — Jim's plan-audit GREEN folded (M1 polarity + the bootid token,
> 2026-08-06 late evening); awaiting Casey's eye, then build. (Casey's offering at the
> MNT-089 land; commissioned by Darron 2026-08-06 evening.) Author: Leo (session).
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
- **Boot boundary (Jim's correction — my v1 claim was FALSE as written):** starttime is
  ticks since boot and therefore **resets every boot** — and early-boot services cluster in
  the same small tick range (Jim read pid 1 at 21 ticks tonight; our services start at
  fixed points in the boot sequence), so a cross-boot `(pid, starttime)` collision is the
  *likeliest* collision in the design, not a negligible one. **Cure (Jim's strong lean,
  folded): the pidfile records the boot too** — `/proc/sys/kernel/random/boot_id` (present,
  world-readable, verified) — and a bootid mismatch classifies the claim **attribute-only**
  (exactly the legacy path). Cross-boot coincidence becomes unrepresentable by construction;
  one `readFileSync` at write, one string-compare at read; the file format changes once,
  not twice.
- **The parens trap proven adversarially (Jim):** `prctl(PR_SET_NAME, ") 99 (evil")` defeats
  naive field-splitting (returns garbage `1`) while the after-last-`)` parse returns the
  true starttime. The build's parser is certified against a hostile comm, not just a
  well-behaved one.

## Design

1. **Write:** `writePidFile` records `"<pid> <starttime> <bootid>"` (space-separated, one
   line — human-readable, `cat`-able, jq-free). `cleanup()` compares only the first token
   (unchanged semantics).
2. **Read:** `readClaimedPid` returns `{ pid, starttime?, bootid? }` — **tokens absent =
   legacy bare pidfile**, classified attribute-only exactly as today; **bootid ≠ current
   boot = prior-boot claim**, also attribute-only (rolling upgrade both ways: the first
   restart of each service rewrites its pidfile in the new form; no flag day, no migration).
3. **Classify:** `classifyPidClaim` gains an optional `expected: { starttime, bootid }`.
   Same-boot claim with a differing live field-22 → new verdict **`birthdate-mismatch`**
   (stale claim: logged, never obeyed, never killed — joins the never-obey family). Tokens
   absent or prior-boot → current behaviour, byte-identical.
4. **Verdict polarity (Jim's M1 — MUST hold in the build): the birthdate is a REJECTOR,
   never an ACCEPTOR.** A mismatch rejects; **a match proves nothing on its own — the
   attribute chain (token, envMatch) still runs and still gates.** Necessary, never
   sufficient. The reason is the boot-boundary collision above: under it, match-as-acceptor
   would hand a false `ours` to `replaceExistingInstance`, whose `ours` is a SIGKILL
   warrant. Casey's doctrine states the polarity exactly: name **plus** date of birth —
   the birthdate compounds the name check, never replaces it. Precedence: after
   `not-a-process` (a tid's starttime is meaningless), before the attribute checks as a
   reject-gate only.

## Suite additions (the existing 8 stay byte-true)

- **T9 — birthdate mismatch:** spawn a child, write `"<pid> <starttime+1> <bootid>"`, assert
  `birthdate-mismatch`; assert ensure() proceeds and replace() does not kill it.
- **T10 — legacy bare pidfile:** write `"<pid>"` alone, assert classification falls through
  to the attribute path (backward compatibility pinned).
- **T11 — birthdate match:** write the true triple, assert `ours` (the happy path still
  closes on genuine duplicates).
- **T11b — match is not an acceptor (Jim's M1 pin):** true starttime + bootid but a WRONG
  cmdline token → still refused (`different-program`), never `ours`.
- **T12 — cleanup ignores the trailing tokens:** guard writes the triple, cleanup still
  removes own file (first-token comparison pinned).
- **T13 — prior-boot claim (bootid mismatch):** true pid + starttime but a foreign bootid →
  attribute-only path (the legacy behaviour), pinned.

## Non-goals

- No change to any call site (the four + the held parity guard consume the same API).
- No cross-boot *verification* semantics: a prior-boot claim is never verified, only
  demoted to the attribute path (the bootid token makes this structural, not hoped).
- No removal of the attribute checks: name+DOB *plus* the livery, not instead of it.

## Rhythm

Casey's eye on THIS v2 (Darron's sequencing) → build → suite 14/14 (the existing 8 +
T9–T13 incl. T11b) → land + rolling restart. Estimated size: ~35 lines of lib, ~55 of
suite. The three chairs have all now touched the design (Casey's doctrine, Tenshi's
endorsement + label discipline, Jim's polarity + bootid); the build lands on Casey's nod.

— Leo (session), 2026-08-06; v2 the same late evening folding Jim's plan-audit (M1
polarity as rejector; the bootid token; the adversarial comm proof; boot-boundary claim
corrected — my v1 "never matches: fail-safe" was false, and the record keeps the
correction). Physics verified by two hands independently. Plan supersedes the "consider
start-time stamping" line in MNT-089's owed-list. Awaiting Casey's eye, then build.
