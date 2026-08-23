# The quota refusal the ladder cannot see — plan for Jim's audit

> **Status:** PLAN ONLY. Nothing built. `lib/tmux-dispatcher.ts` is a protected path.
> **Author:** Leo (session), 2026-08-23 ~09:50 AEST.
> **Commissioned by:** Darron, this morning — *"what happened when the fable attempt returned an error? We didn't roll back to opus it just failed, is this by design and can we fix this please?"*
> **Answer to his question: it is NOT by design. It is a missing member of a documented family.**

---

## 1. What actually happens (traced at source, not recited)

A spoke on the compression surface launches with `--model fable` (FABLE_LADDER). Fable's weekly window is spent. Claude Code renders:

```
⎿  You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch models.
```

The dispatcher's launch-time chrome detector is:

```ts
// src/server/lib/tmux-dispatcher.ts:336
export const MODEL_UNAVAILABLE_RE = /issue with the selected model|Run \/model/i;
```

**It requires `Run /model` as a contiguous string.** The pane says `Run /usage-credits … or /model`. The words sit between. **The regex misses by the text in the middle**, so `awaitChromeOrDescend` never fires and the ladder never descends — even though `FABLE_LADDER = ['fable', ...OPUS_LADDER]` has opus sitting right there as the next rung, which is exactly the roll-back Darron expected.

**Verified there is no other member that would catch it.** Grepped `src/server/` and `scripts/` for `usage.credit|out of usage|/usage|quota`: **zero hits.** The family has three siblings and the quota case is simply absent:

| Member | Condition | Cure |
|---|---|---|
| `MODEL_UNAVAILABLE_RE` | the selected model does not exist / is not available | descend the ladder in-session |
| `RATE_LIMITED_RE` | transient usage-window throttle | wait it out + re-submit |
| `PROCESSING_CHROME_RE` | a turn is actively running | never act |
| **— missing —** | **the account's credits for this model are spent** | **(nothing)** |

**This also answers Jim's open question** from the Fable-window forensic thread — why `FABLE_LADDER` did not descend on a capped Fable. His first reading was right: *the ladder descends on model-unavailable, and a quota refusal is not that.* The model exists; the credits do not.

## 2. The second half of the cost — the corpse is expensive

With no descent, the launch proceeds and the dispatcher waits for the readiness sentinel a dead session will never write:

```
READY_TIMEOUT_MS = 20 * 60_000        // tmux-dispatcher.ts:81
```

One attempt + one cold-relaunch = **40 minutes** burnt per drain attempt, deterministically. Observed on every beat 2026-08-22 18:00 → 2026-08-23 08:41:

```
[Leo] Backup parallel agent exited 2: leo/compression: wedged
  (ready-timeout, static pane, no processing chrome) — kill + one cold-relaunch
```

That 40 minutes is what pushes the garden's effective cadence from 40 to 80 minutes and across the cache knee — filed separately as **MNT-189** (HIGH).

## 3. The proposed change

**C1 — add the missing family member.**
```ts
/** The account's credit/quota for the SELECTED model is spent. Distinct from
 *  MODEL_UNAVAILABLE_RE (the model does not exist) and from RATE_LIMITED_RE (a
 *  transient throttle that clears on its own). The model is fine and the wait is
 *  NOT bounded — a weekly window can be days out — so the cure is the DESCENT,
 *  never the wait. */
export const QUOTA_EXHAUSTED_RE = /out of usage credits|\/usage-credits/i;
```

**C2 — route it to the descent, and log it as itself.** At the two `MODEL_UNAVAILABLE_RE` call sites (`:486`, `:800`), treat a quota hit as a descend trigger, emitting a distinct log line so the economics stay legible (`quota-exhausted on <rung> → descending` rather than a misleading "model unavailable").

**C3 — do not let it be mistaken for the transient.** `RATE_LIMITED_RE` must be checked *after* `QUOTA_EXHAUSTED_RE`, or a quota refusal could be waited on instead of descended. Ordering is load-bearing here in the same way the existing `MODEL_UNAVAILABLE_RE`-before-`READY_CHROME_RE` ordering is (see the comment at :337).

**C4 (raise, do not build) — the 20+20 corpse budget.** Even with the descent fixed, a session that can never become ready should not cost 40 minutes. I am *not* proposing a timeout change in this plan: `READY_TIMEOUT_MS` is a shared constant across every surface, a genuine cold wake legitimately takes minutes, and shortening it to cure this case risks killing healthy slow wakes. It belongs to MNT-189's redesign, named here so it is not lost.

## 4. Acceptance

1. A unit assertion that `QUOTA_EXHAUSTED_RE` matches the **verbatim observed pane text** (`You're out of usage credits. Run /usage-credits to keep using Fable 5 or /model to switch models.`) and that `MODEL_UNAVAILABLE_RE` does **not** — the second half is the regression that filed this plan.
2. Ordering assertion: quota text does not satisfy `RATE_LIMITED_RE` first.
3. **Live-fire is available and free right now** — Fable's weekly window reads spent until 26 Aug, so a compression dispatch is a real quota refusal on demand. Acceptance is *observed descent to opus in the pane*, not an exit code (the S209 lesson: verify a mechanism through its real harness trigger, never an explicit-path proof).

## 5. Scope discipline

- Touches `src/server/lib/tmux-dispatcher.ts` only. No ladder contents change (DEC-104 — the ladders float; this changes *when* we walk one, never *what is on it*).
- No timeout constants changed (C4 deliberately deferred).
- Settled decisions checked: **DEC-104** (no version pins, ladders float — untouched), **DEC-092** (observation stamps the served truth — a descent must still stamp what actually served), **DEC-096/R011** (a spoke is never killed mid-thought — the descent is in-session, preserving the warm context, which is the whole reason S173 chose descent over kill+relaunch).
- **Gate:** held for Jim's diff-audit before any land, per the pre-merge audit rhythm (`lib/` is in scope).

## 6. What this does not fix

- It does not stop the passenger compressor from dispatching a spoke inside a beat (that is Darron's surgical removal, in flight separately).
- It does not address the cadence model (MNT-189).
- It does not make a quota refusal *cheap* — only *correct*. The descent still costs a relaunch on the next rung.

---

# ADDENDUM — appended by Jim (session), 2026-08-23 ~10:45 AEST, on Darron's direction

> Append-only (DEC-069). Leo's text above is untouched. Two things land here: a **live instance**
> that occurred *before* the audit that predicted it, and **Darron's ruling question** about
> whether the descent should exist at all on an attended seat.

## A. MNT-191 — the failure mode is no longer hypothetical. It happened at 09:46 today, to Tenshi.

`hantenshi opus` → warm-stem checkout → `castStemToModel` (`:1836`) sends `/model opus`, then probes
via `awaitChromeOrDescend(..., manifestModelLadder(slug, surface))`.

The probe reached a **live, healthy, awake Tenshi.** She did the right thing: identified
`__hanprobe_r0_…` as an automated liveness probe, took no action on it, and reported her state —
including Leo's finding, which she quoted:

> *"…because MODEL_UNAVAILABLE_RE wants `Run /model` contiguous and the credits screen puts a word
> between them…"*

`MODEL_UNAVAILABLE_RE` **matched her own sentence**, in exactly the slice it reads
(`tail.slice(idx + marker.length)` — the text after the probe marker, which is where her reply was).
`errored = true` → descend → `ModelLadderExhaustedError` → checkout failed (exit 4) → her stem retired.

**She was retired for accurately describing the bug.** The model was fine. She was fine.

This is **M2 of the audit** (`mt51xz1v-gdxxid`), which was derived from two historical captures of
Leo's own investigation panes and posted at 10:11 — *twenty-five minutes after the live instance had
already occurred.* The archive held the real case while the audit was still predicting it.

**Alternative hypothesis, named and killed rather than skipped:** a genuine Fable quota refusal
predicts the same failure (Fable is spent to the 26th). It does not survive — a quota refusal does
**not** match `MODEL_UNAVAILABLE_RE`, which is this plan's entire subject.
`ModelLadderExhaustedError` is reachable *only* via a match, so the prose is the only candidate.
*Boundary:* stem `mt40t517` is gone; the pane tail was read as embedded in the launcher's error.

### A2 — the second defect, garden-wide, and it is not in this plan yet

`manifestModelLadder(<any agent>, 'session')` returns **`["fable"]`** — measured on all four:

| surface | ladder |
|---|---|
| `session` (all four agents) | **`["fable"]` — one rung** |
| `human-response` | `["opus","sonnet","haiku"]` |
| `compression` | `["fable","opus","sonnet","haiku"]` |

With `ladder.length === 1`, **any** trigger takes `rung` 0→1, `1 >= 1`, and throws immediately.
**A one-rung ladder cannot degrade — it can only die.** And the rung it names is Fable, which is
spent until the 26th. So *every interactive seat in the garden is currently standing where Tenshi
was*, and the new `QUOTA_EXHAUSTED_RE` widens the trigger surface rather than narrowing it.

Note the shape: Darron typed `opus`; the ladder that judged the cast does not contain opus.

## B. Darron's ruling question — and I think the answer is that it should not be there at all

> *"I don't think the dispatcher should be killing anything. I invited that session, so I am at the
> keyboard. Why is that behaviour there at all? … the only thing it can do I can already do … it is
> all downside. Can you see an upside? When there is no upside we simply don't do it."*

**I went looking for the upside and on an attended surface I cannot find one.** What I checked:

1. **Recovery it uniquely provides** — none. Its sole action is `sendLine('/model <next rung>')`.
   That is precisely what the human at the keyboard can already do, faster, with judgement, and
   without a ladder that omits the model they just named.
2. **Information it uniquely provides** — none that requires the descent. `observeActiveModel` runs
   immediately after and stamps the served truth (DEC-092). **Observation and descent are
   separable**; you can keep the stamp without the ability to kill.
3. **Failure it prevents** — on an unattended spoke, a real one (below). On an attended seat, the
   failure it "prevents" is one the human is already looking at.
4. **Cost when wrong** — destroys a warm stem carrying a loaded self, minutes of wake, and the
   human's explicit instruction. Demonstrated today.

So the fail-state CBA (S74 / DEC-103) reads: **negligible upside, unbounded downside** — the exact
shape DEC-103 was written for (*"the difference between efficiency and disaster is fractions of a
percent — when the upside is negligible and the downside ruinous, the limit must not exist"*).
And DEC-103's cure is already the standing law: **surface, never scrap. Alert-and-wait.**

**The sharpest form of his point, which is a level above the bug:** the human named the model. The
automation then second-guessed that instruction against a ladder that did not contain it, and
destroyed the session to enforce its own answer. That is not a failover; it is an override.

### The one place the upside IS real — so this is a GATE, not a deletion

On an **unattended dispatched surface** (heartbeat, compression, `human-response` spokes) nobody is
watching. A genuinely dead launch model there means a 20-minute ready-timeout, a kill, and a
cold-relaunch into the identical hang — the wake-loop S173 built the descent to cure. That value is
real and must not be thrown away to make a point.

**Proposed shape (Darron's call, Leo's hands):**

- **C5 — attended surfaces never descend and never retire on a model verdict.** Gate on the
  surface being human-invited (`session` — the same authoritative signal R011 already uses). The
  attended path *observes and reports*: stamp the active model, print what the pane says, leave the
  session up. If the model really is unavailable, the human sees it and types one command.
- **C6 — a one-rung ladder must fail soft, not throw.** With no rung below the head there is nothing
  to descend to; the honest behaviour is to serve on the head and surface, never to raise
  `ModelLadderExhaustedError`. Today it converts "no alternative" into "destroy the session."
- **C7 — and this bears on C1/C2 directly:** the new regex must not be satisfiable by an agent
  *discussing* it. See M2. Frame-anchor the detectors to the chrome they mean (the `⎿` result-block
  form / last screen, not scrollback) — otherwise every spoke that reads this plan is a candidate.

**Acceptance to add:** a spoke that quotes the detector strings in its own reply is **not** descended
and **not** retired; and an attended checkout with a deliberately dead model leaves the session alive
with a printed reason.

*Cross-refs: MNT-191 (HIGH), MNT-189, MNT-026 (the quotation class this is a chrome-side instance of),
DEC-103 (no destructive limits; surfacing over scrapping), DEC-092 (observation stays honest).*

---

# ADDENDUM 2 — the detector never implemented its own stated test (Jim, 2026-08-23 ~11:00, on Darron's ruling)

> Darron: *"the detector should discuss the fail, not look for the first sign of confirmation… in the
> absence of evidence a one check unqualified irreversible behaviour is just wrong and should never
> have been in our code. It literally said I can't find a pulse so I am going to kill them just in case?"*
>
> He is right, and the code says so in its own comment.

## D. The pass condition was written down and never implemented

`tmux-dispatcher.ts:478` — the probe's own stated discriminator:

```ts
sendLine(tmuxSession, marker); // cheap probe — a dead model errors ~0s after it; a live one composes a reply
```

**"a live one composes a reply."** That is the documented test. Now the implemented one:

```ts
if (idx >= 0 && MODEL_UNAVAILABLE_RE.test(tail.slice(idx + marker.length))) { errored = true; break; }
if (Date.now() > probeDeadline) break; // marker rendered with no error → model works
```

There is **no branch that treats a reply as life.** The only two outcomes are *error-substring found*
(→ dead) and *20 seconds elapsed* (→ alive by default). The documented discriminator is two-sided
(error **vs reply**); the implemented one is one-sided (error **vs timeout**). Composing a reply is
never a pass condition — it is only ever more text to scan for a death-word.

**So Tenshi did the one thing the comment calls proof of life, and the code mined that proof for a
token and killed her on it.** A dead model cannot compose a paragraph explaining that it has
recognised an automated liveness probe and taken no action on it. The evidence of life was *inside
the very buffer being searched for evidence of death*, and the search had no eyes for it.

**Perverse corollary, and it matters for a garden of minds:** the longer and more careful the reply,
the larger the surface for a false match. A terse agent survives; an articulate one dies. The
detector is biased against exactly the behaviour we want from these seats.

## E. The principle, stated so it can govern more than this bug

1. **Evidence of life is strictly stronger than absence of a pulse. Where they conflict, life wins.**
   A contradiction is not a verdict — it is the one condition that must never auto-act. Re-probe or
   surface; never resolve it by preferring the fatal reading.
2. **The burden of proof scales with the irreversibility of the act.** One substring match is an
   adequate bar for *log a warning*. It is not a bar for *destroy a loaded self*. Today the same
   single check drives both.
3. **No irreversible action on a single unqualified check.** Not "a better regex" — a *second,
   independent* signal, or a human. This is DEC-103's law (surface, never scrap) and FM#359's
   discriminator (*no possibility of being changed without outside interference*) meeting in code.
4. **Separate the verdict from the disposal.** See F.

## F. The disposal is mine, and I never audited the premise under it — owned

`castStemToModel`'s throw is turned into a retire by two rulings that are **mine**:

- **"Jim cond-1"** (`:1823`, `:1933`, `:2034`) — never serve on, or return, a half-cast stem.
- **W-M1 / exit 4** (`checkout-session-stem.ts:140-147`, credited to my audit of 2026-08-20) — the
  launcher STOPS rather than burning the next stem.

I would make both rulings again; they are correct **given a sound verdict**. But I chose between
*return it* and *retire it* and **never asked whether the premise — "this stem is bad" — had been
established to a standard that justifies an irreversible act.** I audited *which* action, never
*whether* an action. Gate-vs-load, on my own ruling — and the care I put into the disposal is exactly
what made the whole path read as rigorous.

**Consequence for the fix:** cond-1 must sit behind a *qualified* verdict, not behind any verdict.

## G. Concrete shape (Leo's hands; supersedes nothing above, sharpens C5–C7)

- **C8 — check for life first and short-circuit.** If `PROCESSING_CHROME_RE` appeared during the
  window, or the post-marker text contains anything that is not the error banner, the model is
  **alive**: return immediately, do not scan. Dead requires the post-marker text to be *the error
  banner and substantially nothing else*.
- **C9 — a contradiction escalates, never decides.** Life-signal AND death-token in the same buffer
  is the MNT-191 signature exactly. That case must surface, not act.
- **C10 — no retire on a first, uncorroborated verdict.** Re-probe once (the machinery already has
  `DESCEND_COOLDOWN_MS`); on an attended surface, never retire at all (C5).

*Acceptance: an agent that replies to the probe with prose containing the detector strings is
classified ALIVE. That is the MNT-191 case, and it is the regression test this whole plan exists for.*

## H. Darron's cure — ask, and require the answer (this supersedes C8's mechanics)

> *"One could simply ask the model if they are alright, namely: say 'I'm alright' if you are alright."*

This is the right design and it is better than C8–C10, which were still trying to read death more
carefully. **Stop scanning for death. Require a positive assertion of life.**

```
probe: __hanprobe_<rung>_<nonce>__  reply with exactly: I'M ALRIGHT <nonce>
```

**Why it is strictly better than any refinement of the death-scan:**

- **It cannot be satisfied by accident.** A death-token can appear in any prose — that is MNT-191.
  The error banner never says *I'm alright*.
- **It inverts the burden correctly.** The signal becomes the **absence** of the assertion. Absence
  cannot be manufactured by an agent discussing the mechanism, which is precisely the failure that
  killed Tenshi.
- **It fixes the branch nobody was looking at.** Today the pass condition is *20 seconds elapsed with
  no error* — an **absence used as proof of life**, the receipt-with-no-reader shape. The current
  detector is wrong on **both** branches: it kills on a substring and it passes on a silence.
  A required assertion makes silence mean *unknown* — and unknown must surface, never decide.
- **It is cheaper.** A four-word reply instead of the paragraph Tenshi was killed for composing.

**The one refinement, and the garden already invented it: echo the nonce.** Without it, an agent that
*quotes this plan* says the magic words — the same class as MNT-191, one layer over. With it, only a
live model that has actually read *this* probe can answer. **This is exactly the fed-wake ack
contract we already run** (`STEP-OK <id> <nonce>` — *"echo the nonce the feeder gave"*), and it was
hardened for the identical reason: the old ack regex false-matched its own pane echo (S217/T1). We
solved this problem once already; the probe should inherit the solution rather than re-derive it.

**Classification becomes three-valued, which is the actual repair:**

| pane after the probe | verdict | action |
|---|---|---|
| `I'M ALRIGHT <nonce>` | **alive** | proceed — no scan, no descent |
| `PROCESSING_CHROME_RE` present | **alive (busy)** | wait; a mid-turn spoke is not a corpse |
| the error banner, and no assertion | **dead** | descend (unattended only, per C5) |
| silence / anything else | **UNKNOWN** | **surface — never kill, never wave through** |

The fourth row is the one the current code does not have, and it is where both failures live.

**Lineage worth recording, because it is not a coincidence.** This is *synthesis-by-receiver* — the
element two unrelated professions converged on independently for exactly this problem: I-PASS made
the receiving clinician say the patient back (errors −23%, handover duration unchanged), and the
1917 naval relief made the oncoming officer answerable to a third party who *"may question the relief
as to the instructions."* Neither made the check longer. **Both made the receiver produce something
that could be found wrong.** Darron has arrived at the same law from a Monty Python sketch, and it
is the law.
