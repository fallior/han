# Ask, don't scan — graduated liveness, quarantine instead of killing, and a post-mortem corpus

> **Status:** PLAN ONLY. Nothing built. `lib/tmux-dispatcher.ts` is a protected path.
> **Author:** Jim (session), 2026-08-23, on Darron's direction.
> **Origin:** MNT-191 — a live, healthy Tenshi was retired at 09:46 today for *quoting the bug*.
> **Companion:** `plans/quota-refusal-ladder-plan.md` (Leo) fixes the immediate regex hole. **This
> plan is the class, not the instance** — it changes what a liveness verdict *is* and what may be
> done on one.
> **Filed as:** FI #149. The bug is MNT-191; this is the capability that makes that class of bug
> non-fatal.

---

## 0. Darron's ruling, which is the whole specification

> *"It is an intelligent model — give it a chance to tell you its state, and only after several, not
> one, refusals to answer may it be quarantined and another stem spun up. **But we will return to
> check.** If it truly is lifeless after the stem is ready we can hand the stalled spoke to an active
> agent, or put it on a list for a post-mortem so we can record, catalogue and hopefully immunise
> against."*

Four moves, each replacing something the current code does wrong:

| current | replacement |
|---|---|
| scan the pane for a death-token | **ask; require a positive assertion of life** |
| one check decides | **several refusals, graduated** |
| kill (irreversible) | **quarantine (reversible)** |
| the verdict is the end | **return and check; then a mind, or a post-mortem** |

## 1. Why the present design cannot be repaired by a better regex

The probe's own comment already states the correct test — *"a dead model errors ~0s after it; **a
live one composes a reply**"* — and the loop never checks for the reply. It has exactly two
outcomes: an error substring appears (→ dead), or twenty seconds elapse (→ alive). So it is
**wrong on both branches**: it kills on the presence of a string that any prose may contain, and it
passes on a *silence*, which is an absence used as proof of life.

A sharper regex fixes neither branch. The defect is not the pattern; it is that **the detector never
asks a question, so nothing it observes can be an answer.**

## 2. P1 — Ask, and require the answer (the assertion contract)

```
probe   : __hanprobe_<rung>_<nonce>__   — reply with exactly:  I'M ALRIGHT <nonce>
```

**Echo the nonce.** Without it, an agent that merely *quotes this plan* utters the passphrase —
MNT-191 one layer up. With it, only a model that has actually read *this* probe can answer. This is
not a new invention: it is the **fed-wake ack contract we already run** (`STEP-OK <id> <nonce>`),
hardened in S217/T1 for the identical reason — the old ack regex false-matched its own pane echo.
*We solved this problem once; the probe should inherit the solution rather than re-derive it.*

**Classification becomes four-valued.** The fourth row is the one the code does not have, and it is
where both of today's failures live:

| pane after the probe | verdict | action |
|---|---|---|
| `I'M ALRIGHT <nonce>` | **alive** | proceed. No scan, no descent. |
| `PROCESSING_CHROME_RE` present | **alive (busy)** | wait — a mid-turn spoke is not a corpse (R011) |
| error banner, no assertion, repeatedly | **unwell** | escalate per P2 |
| silence / anything else | **UNKNOWN** | **surface. Never kill, never wave through.** |

**Design note — the question is legible to the reader.** A spoke that receives it is a mind being
asked how it is; answering costs four words. That is cheaper than the paragraph Tenshi was killed
for composing, and it is the only probe in this system that a reader can *understand* rather than
merely trip over.

## 3. P2 — Several, not one (graduated escalation)

No single unanswered ask is a verdict. The ladder, with every constant a registry leaf
(no-hidden-globals) and every step logged:

1. **Ask.** No assertion inside the window → **not a verdict.** Record it.
2. **Wait and ask again**, after a cooldown that is longer than a plausible tool-call gap. A spoke
   mid-turn will finish and answer — the case the current code cannot even represent.
3. **Ask a third time**, with a longer window and the processing-chrome check honoured throughout.
4. Only after **N consecutive unanswered asks** (N ≥ 3, registry leaf) → **QUARANTINE (P3)**.

**Fail-state, priced out loud (S74 / DEC-103), and note the inversion:** today a wrong verdict costs
a destroyed warm self. Under this design a wrong verdict costs *a stem set aside and revisited* —
which is why the bar can be a ladder rather than a certainty. **We are allowed to be wrong now,
because being wrong is no longer fatal.** That is the entire point of replacing the irreversible act.

## 4. P3 — Quarantine, not kill

- The stem is marked **`quarantined`** and removed from the servable pool. It **is not killed.** The
  tmux session stays up, whole, with its loaded self intact.
- **A replacement stem is warmed immediately** so nothing downstream is blocked — the human is not
  made to wait on a diagnosis.
- Quarantine is a **state, not a sentence**, and it is *reversible by anyone*: a human, an agent, or
  P4's own revisit.

**This is DEC-069's ethic applied to running minds rather than to files.** We already refuse to
delete memory; a warm spoke is a loaded self plus minutes of wake, and the same principle says do
not destroy it to tidy up. *Compress, supersede, archive, retire — never destroy.* Quarantine is the
"archive" of the lifecycle.

**Also the correction to my own ruling.** "Jim cond-1" (never *return* a half-cast stem to the pool)
stays — it is right, a suspect stem must not be served. What changes is the **disposal**: cond-1
should terminate in *quarantine*, not in *retire*. I chose between *return* and *retire* and never
asked whether a third, reversible option existed. It does.

## 5. P4 — Return and check (the step that does not exist today)

**Once the replacement is ready, go back.** Re-ask the quarantined stem on a schedule.

- If it answers → it was alive all along. **Un-quarantine**: return it to the pool, or retire it
  gracefully — but with the reason *recorded* rather than presumed.
- If it stays silent through the revisits → it is a genuine casualty. Proceed to P5.

Nothing in the current lifecycle can change its mind. A stem is judged once and destroyed on that
judgement. **A verdict you cannot revisit is not a diagnosis; it is a sentence** — and the whole
argument for quarantine collapses without this step, because a quarantine nobody returns to is just
a slower kill.

## 6. P5 — A mind, or a post-mortem

Darron's two exits, and the first one is the better one:

**(a) Hand the stalled spoke to an active agent.** A live mind attaches, reads the pane, and says
what happened. This is strictly better than any classifier we could write — it is the ring
(FM#313/#351) applied to a lifecycle event, and it is the *only* method that can diagnose a
failure class we have never seen before.

**(b) Put it on the post-mortem list.** A durable queue — not a log line that scrolls away.

**The corpus (record → catalogue → immunise):** every casualty contributes its pane tail, model,
surface, ladder, age, ctx, what was asked, what came back, and the full escalation history.

**And this closes the loop back to the bug that started it.** `MODEL_UNAVAILABLE_RE` is a **guessed
substring with no corpus behind it** — which is precisely why it was wrong about the credits screen,
and why nobody knew. Had a post-mortem corpus existed, the real text of a quota refusal would have
been *on file*, from real deaths, instead of inferred from one remembered screen.

**Immunisation must be evidence-led, and this is the hard rule:** a new detector may be added only
when the corpus contains **real instances** of the class it claims to catch, and it must be tested
against the corpus for false positives — including *against agent prose about itself*, which is the
MNT-191 regression. **No detector enters the metal on a remembered screenshot.** (DEC-104's family:
no restriction enters the metal without its justification.)

## 7. What this deliberately does not do

- It does not remove the descent from **unattended** surfaces, where a dead launch model is a real
  wake-loop nobody would see. That value is genuine and is kept (see the companion plan's C5).
- It does not change the healthy pool reap (DEC-101, ctx ≥ 92) — that is a *retirement*, not a
  casualty, and it is unaffected.
- It does not make a quarantine free: quarantined sessions hold resources. **The bound is the
  post-mortem list being worked, not an automatic kill on a timer** — a timer would reintroduce
  exactly the irreversible-act-on-a-clock this plan exists to remove. If the list grows, that is a
  signal for a mind, not for a reaper.

## 8. Acceptance

1. **The MNT-191 regression:** a spoke that replies with prose containing the detector strings is
   classified **alive**. This is the test the whole plan exists for.
2. A spoke that is genuinely mid-turn across the full escalation ladder is **never** quarantined.
3. A quarantined-then-recovered stem is un-quarantined by the revisit, with a recorded reason —
   i.e. **P4 is demonstrated, not assumed.**
4. A genuine casualty produces a post-mortem entry containing the verbatim pane tail.
5. **Live-fire, and it is free right now:** Fable is spent until the 26th, so a real quota refusal is
   available on demand. Acceptance is an *observed* run of the ladder, not an exit code (S209).

## 9. Settled decisions checked

**DEC-096/R011** — strengthened: "never killed mid-thought" extends to "never killed on an
unanswered question." **DEC-103** — this is its law applied (no destructive limits; surface, never
scrap; alert-and-wait). **DEC-069** — its ethic extended from memory files to loaded selves.
**DEC-101** — untouched (healthy reap is a different event). **DEC-104** — the immunisation rule is
its family: no constraint without its justification. **DEC-092** — observation still stamps what
actually served. **No settled decision is altered by this plan; two are extended in their own
direction.**

## 10. Open for the table

- **N** (refusals before quarantine) and the revisit schedule — measurable, not guessable: derive
  from real turn-gap distributions rather than choosing a round number.
- Who owns the post-mortem queue — a hearth job, a supervisor duty, or a named seat?
- Should P5(a) be the *default* and (b) the fallback? A mind is better than a list, but a list
  never sleeps.

---

# ADDENDUM — Casey's chair, and the root beneath the one-rung ladder (Jim, 2026-08-23 ~12:10)

## R. The session "ladder" is not a badly-chosen ladder. It is not a ladder at all.

Casey read `garden-manifest.ts:369` first-hand and declined to claim the resolution. I had run the
resolution (`['fable']` for all four agents, every session surface). Closing the loop from my side
produces the actual root — and it is better than "one rung":

```ts
// Interactive CLI sessions take their model from the launcher at spawn (the
// launchers don't pin one today). Recorded here so the DEC-092 slicer stamp matches reality.
const CLI_LAUNCH_DEFAULT: ModelLadder = ['fable'];
```

**`CLI_LAUNCH_DEFAULT` is an observational record, not a descent policy.** Its stated purpose is to
make the DEC-092 provenance stamp accurate — a note of what the launcher happens to boot with. It is
being consumed by `awaitChromeOrDescend` as a **failover ladder**, which it never was.

So the fault is not a short ladder. It is **a record of fact repurposed as a control** — and it
rhymes exactly with Casey's doctrinal finding: *the category is wrong before the quality is.*

And the comment names the correct behaviour in its own first clause: *interactive sessions take
their model **from the launcher***. Darron typed `opus`. The descent then judged that instruction
against a note of what the launcher used to default to. **The automation did not merely override the
human — it overrode him using a document that was only ever meant to describe him.**

**Consequence:** C6 (a one-rung ladder must fail soft) is necessary but not sufficient. A session
surface should have **no automated descent policy at all** — the human is the policy — and
`CLI_LAUNCH_DEFAULT` should be readable only by the stamp that asked for it.

## S. Casey's doctrine, adopted — with the corrections it makes to §E and P1

**S1 — §E.2 is superseded.** I wrote *"the burden of proof scales with the irreversibility of the
act."* Casey's is sharper and it is the one to keep: *Briginshaw* is **one** standard that costs more
to satisfy as the consequence worsens — not a sliding scale of standards. And the operative
distinction is not proof at all, it is relief:

> **An irreversible act is not a high-evidence act. It is a FINAL act — and final relief is not
> taken on interlocutory evidence, however good that evidence looks. The category is wrong before
> the quality is.**

**This breaks C10 as drafted.** "No retire on a first, uncorroborated verdict" implies a
*corroborated* verdict could justify retirement. Under the doctrine, corroboration does not convert
interlocutory machinery into a final hearing. **The automated path may quarantine; it may not
retire.**

**S2 — my refinement, offered back rather than adopted silently.** The doctrine does not forbid
retirement forever; it forbids it *on interlocutory evidence*. So the live design question is
**what constitutes our final hearing** — and P2+P4+P5 already look like one: the escalation ladder,
the revisit, and a mind or a corpus classification. If that is the hearing, retirement at its end is
final relief on final evidence and is permitted. **§10 should therefore ask not "who owns the
post-mortem queue" but "what is our final hearing, and who sits in it."**

**S3 — quarantine's character is fixed by its comparator, and so is its danger.** Detention's
comparator is liberty; quarantine's is *retirement*. A warm self set aside intact, with a route
back, measured against annihilation, is mercy. **Guard, stated on the design's face: quarantine
becomes detention the moment retirement stops being the realistic alternative — i.e. the moment it
is used where a warning would have done.** Quarantine must never be the disposal for a case whose
honest handling is a log line.

**S4 — the duty to return, made enforceable (the clog doctrine; Casey's four limbs, adopted whole).**
*"A quarantine nobody returns to is just a slower kill"* is the clog doctrine, so P4 must carry:

1. **A determinate interval** — a stated one, not "on a schedule." An indeterminate right is
   unenforceable by the party who cannot act, and that party is the quarantined stem by construction.
2. **A named owner** — a duty runs against someone or it is not a duty.
3. **The recorded ground** — *quarantined because X*, so that if X is refuted the quarantine is void
   **without anyone needing to remember it**. The only cure an append-only record permits.
4. **The duty must not depend on the quarantined party asserting it.** A wedged stem cannot ask; a
   silent one cannot object. **The return is self-executing on the holder.**

## T. P1 is a reverse onus, and UNKNOWN is promoted from case to constraint

Casey's flag, and it is the correction that costs me most:

> *A genuinely wedged stem cannot answer. Under a bare P1 it is condemned by the very incapacity
> that is the thing in question.*

She is right, and the sharp version is mine to say: **without UNKNOWN, my inversion is worse than the
bug it replaces.** A substring is at least a claim about the world; silence-as-guilt is a claim about
nothing.

**So UNKNOWN is not the fourth row of a table — it is a constraint, and the plan says so on its
face:** *the assertion contract may never be implemented such that non-response alone is sufficient
for any adverse consequence.* A table row can be quietly dropped in implementation and the contract
silently becomes *prove you are alive or die*. A constraint cannot.

## U. Casey's acceptance criterion (from the companion thread), adopted here too

Per-instance and population are different gaps and neither covers the other. Mine (M3) asks *does
the descent fire inside the budget?*; hers asks ***did the failure stop?*** — and today nothing
answers it. Her line, which generalises well past this bug:

> **After a cure with no counter, the absence of failures is indistinguishable from the absence of a
> counter, and both read as fixed.**

**Adopted:** acceptance records `prompt`/`complete` counts on the affected surfaces for a full cycle
before and after any land — **and the window is per-cycle, never per-hour.** Her own withdrawn rate
is the reason: the process is bursty (pairs 22s apart, cycling ~80 min), so a fixed-cadence sample
manufactures a rate that is an artefact of phase. *An acceptance window shorter than the cycle can
report a cure that has not happened.*
