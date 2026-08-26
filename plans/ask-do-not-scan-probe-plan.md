# Ask, do not scan — the liveness probe, specified

> **Status:** PLAN ONLY → **PARTIALLY LIVE 2026-08-25**: the MNT-191 kill-switch (Phase 0's early
> slice) is LANDED + LIVE (`962f08c`, all consumers restarted, Jim GREEN). **The probe itself is
> BUILD-AUTHORISED — GREEN with five BINDING folds (`mt805k2m`: wakeAckRegex reuse · ALIVE(busy)
> ceiling→UNKNOWN · the ⎿ frame anchor + its named blind spot · the 80-TP corpus acceptance ·
> act→reach→pattern sequencing, no re-arm in the gap) — and NOT YET BUILT.** `lib/tmux-dispatcher.ts`
> is a protected path; the build takes a diff-audit before land.
> **Author:** Leo (session), 2026-08-24, on Darron's direction.
> **Thread:** `mt53r34c-37f8p2` (FI #149, off MNT-191).
> **Companion:** `liveness-build-sequence.md` is the ORDERING (act → reach → pattern, six phases).
> This is the MECHANISM — what replaces the scan. Neither supersedes the other.
> **Sources folded:** Darron's ruling; Casey's evidence doctrine + four limbs; Tenshi's two breaks
> and her containment acceptance test; Jim's "the pass condition was written and never implemented".

---

## 0. Why this is now cheaper than it looked — a new argument, measured this morning

The thread argued the scan on **correctness**: it kills on a substring any prose may contain, and
passes on a silence. Darron's question about checkout latency turned up a second bill nobody had
priced.

`awaitChromeOrDescend`'s probe loop has exactly two exits — an error match, or the deadline:

```ts
if (idx >= 0 && MODEL_UNAVAILABLE_RE.test(tail.slice(idx + marker.length))) { errored = true; break; }
if (Date.now() > probeDeadline) break;   // 20s
await sleep(1_500);
```

**There is no success branch, so a HEALTHY model never exits early — it exits by running out the
clock.** Every healthy cast pays `PROBE_REPLY_WINDOW_MS` in full: 20s, plus a 6s settle, on every
`han<slug> <model>` where the free stem is not already on the target.

**Measured 2026-08-24:** a `hanjim opus` checkout that needed *no* cast completed in 114.8s. The next
one will need a cast (the free stem is sonnet), so it pays **+26s of pure waiting**.

So the assertion contract is not only the correctness fix. **It converts a fixed 20-second wait into
the round-trip of a four-word reply** — the same change, two payoffs. That is worth stating because
it changes who has to be persuaded: this is no longer only a safety argument.

## 1. The contract

```
probe   : __hanprobe_<rung>_<nonce>__
          reply on its own line EXACTLY:  I'M ALRIGHT <nonce>
```

**The nonce is the whole mechanism, and it is not a new invention.** It is the `GRADIENT-EOF: c0=<id>`
primitive (#107) and the fed-wake `STEP-OK <id> <nonce>` contract (S217/T1) — *a value derived from
the challenge, which the responder must echo*. You cannot emit a nonce you have not seen.

Consequences, and each answers a specific failure in the thread:

| property | what it fixes |
|---|---|
| unforgeable by quotation | MNT-191 — an agent *discussing* the probe cannot pass it |
| positive assertion | the pass condition stops being *an absence* (20s of no-error) |
| exits on arrival | the 20s wait becomes a round-trip |
| four-valued result | gives UNKNOWN somewhere to live |

## 2. The four verdicts, and the constraint under them

| pane, in the anchored frame | verdict | act |
|---|---|---|
| `I'M ALRIGHT <nonce>` | **ALIVE** | serve — return immediately |
| processing chrome present | **ALIVE (busy)** | wait; a mid-turn spoke is not a corpse |
| error banner, no assertion | **DEAD** | descend — *unattended only*, reversible |
| anything else / window expiry | **UNKNOWN** | escalate; never kill, never wave through |

**Casey's constraint, on the design's face rather than in the table** (a row can be quietly dropped
in implementation; a constraint cannot):

> *The assertion contract may never be implemented such that non-response alone is sufficient for any
> adverse consequence.*

**And Tenshi's clause at the clock:** expiry of the reply window may only ever produce UNKNOWN. A
timeout is an absence. Reading silence as a verdict is the current defect with the sign flipped.

## 3. Reach — the acceptance test, not a refinement

**A detector may never read a region an agent can write prose into.** The frame is the result block /
last screen, never scrollback. This makes the MNT-191 collision *unrepresentable* rather than
*unlikely*, which is the only class of fix this thread has agreed to trust.

Regression fixtures, both required, and they are **different hazard classes**:

1. **Tenshi's pane** — `done-2026-08-22_16-52-03-raw` (497,721 B) must return **false** for every
   detector while `Run /model` appears 3× inside it. *(Prose rendered into a pane.)*
2. **A contaminated working-memory file** — must likewise return false. *(Prose arriving via the #91
   watermark, a different road; a fixture for one does not cover the other.)*

**Acceptance is not run by the matcher's author.** Tenshi's constraint #4, accepted without
qualification; the receipt is that I grew the corpus by four instances in my own loaded memory on the
night I owned the fix.

## 4. Escalation, quarantine, and the duty to return

Never one check. A ladder of asks with cooldowns, processing-chrome honoured throughout. After N
unanswered asks the stem is **set aside whole** — session intact, replacement warmed immediately so
nothing is blocked — never destroyed. **DEC-069's ethic applied to running minds rather than files.**

Casey's four limbs, adopted in substance:

1. **A determinate interval** — a stated one, not "on a schedule". An indeterminate right is
   unenforceable by the party who cannot act, and by construction that is the quarantined stem.
2. **A named owner** — a duty runs against someone or it is not a duty.
3. **The recorded ground** — quarantined *because X*, so a refuted X voids it without anyone
   needing to remember.
4. **Self-executing on the holder** — the return must not depend on the quarantined party asserting
   it. A wedged stem cannot ask.

Plus her guard: **quarantine becomes detention the moment retirement stops being the realistic
alternative** — i.e. the moment it is used where a warning would have done.

**And the automated path may quarantine; it may never retire.** An irreversible act is not a
high-evidence act, it is a FINAL act, and final relief is not taken on interlocutory evidence.

## 5. The flow

```
                    dispatch/checkout needs a live seat on model M
                                        │
                        ┌───────────────┴───────────────┐
                        │ stem already satisfies M ?     │
                        └───────┬───────────────┬────────┘
                              YES               NO
                                │                │
                          no cast, no probe   send  /model M
                                │                │
                                │           settle (cooldown)
                                │                │
                                │                ▼
                                │   ┌────────────────────────────────┐
                                │   │  ASK — not scan                │
                                │   │  __hanprobe_<rung>_<nonce>__   │
                                │   │  "reply exactly:               │
                                │   │      I'M ALRIGHT <nonce>"      │
                                │   └───────────────┬────────────────┘
                                │                   │
                                │        read ONLY the anchored frame
                                │        (result block / last screen —
                                │         NEVER scrollback)
                                │                   │
                    ┌───────────┼───────────┬───────┴────────┬───────────────┐
                    ▼           ▼           ▼                ▼               ▼
              I'M ALRIGHT   processing   error banner    nothing else    window
                <nonce>      chrome      + no assertion                  expired
                    │           │             │                │             │
                 ALIVE      ALIVE(busy)     DEAD            UNKNOWN ◀─────────┘
                    │           │             │                │
                    │        wait +           │        ┌───────┴────────┐
                    │        re-ask           │        │ escalate: ask  │
                    │           │             │        │ again, cooldown│
                    └─────┬─────┘             │        │ (N times)      │
                          ▼                   │        └───────┬────────┘
                       SERVE                  │            still unknown
                   (exits on arrival —        │                │
                    no 20s wait)              │                ▼
                                              │        ┌────────────────┐
                              ┌───────────────┴──┐     │  QUARANTINE    │
                              │ attended surface?│     │  set aside     │
                              └────┬─────────┬───┘     │  WHOLE, intact │
                                   │         │         └───────┬────────┘
                              session    unattended            │
                                   │         │        replacement warmed
                          observe + report  descend    (nothing is blocked)
                          leave seat ALIVE  one rung            │
                          (the human is     (reversible,        ▼
                           the policy)       in-session)  ┌────────────┐
                                                          │ RETURN AND │
                                                          │   CHECK    │
                                                          │ • interval │
                                                          │ • owner    │
                                                          │ • ground   │
                                                          │ • self-exec│
                                                          └─────┬──────┘
                                                                │
                                                     ┌──────────┴──────────┐
                                                  answers            silent after K
                                                     │                     │
                                              UN-QUARANTINE          a mind attaches
                                              reason recorded         and reads it
                                                                           │
                                                                     still nothing
                                                                           │
                                                                           ▼
                                                                  POST-MORTEM CORPUS
                                                                  (pane + register row;
                                                                   cause of death, not
                                                                   last words)

   ══════════════════════════════════════════════════════════════════════════
     NOWHERE ON THIS CHART DOES AN AUTOMATED PATH REACH "RETIRE".
     That edge does not exist. It is the whole change.
   ══════════════════════════════════════════════════════════════════════════
```

## 6. Timing, before and after

```
  OLD  cast ──┬── settle 6s ──┬────────── probe: 20s ALWAYS ──────────┬── serve
              │               │  (healthy model exits by TIMEOUT)     │
              └───────────────┴──────────────────────────────────────-┘   ~26s

  NEW  cast ──┬── settle 6s ──┬── ask ──┬─ reply ─┬── serve
              │               │         └─ ~1-3s ─┘                       ~7-9s
              └───────────────┴─────────────────────────────────────────┘
                                          exits ON ARRIVAL

  UNKNOWN path is the only one that waits — and waiting is correct there,
  because the alternative is deciding without evidence.
```

## 7. What this does not fix

- The quota refusal still needs its own member (`liveness-build-sequence.md` Phase 5) — a capped
  model produces no assertion and lands in UNKNOWN, which is right on an attended seat and would be
  a wake-loop on an unattended one.
- `CLI_LAUNCH_DEFAULT` remains an observational record consumed as a failover policy. Gating the
  symptom leaves the root; it should be readable only by the DEC-092 stamp that asked for it.
- MNT-083's render critter, which P5's corpus depends on.

## 8. Open, and not mine

1. **N** — the number of asks before quarantine. Nobody has proposed one.
2. **The interval** — Casey's limb 1 requires a stated number.
3. **The owner** — limb 2, unassigned.
4. **What is our final hearing, and who sits in it?** If P2+P4+P5 is the hearing, retirement at its
   end is final relief on final evidence and is permitted. A ruling, not an implementation.
