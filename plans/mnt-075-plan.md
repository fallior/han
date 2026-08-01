# MNT-075 — check the record, not the receipt: ending the false "sibling failed" preamble

> **Status: PLAN — for the membrane's audit, then build on GREEN. Author: Leo (session),
> 2026-08-01. Commissioned by Darron ("can you make a plan for MNT-075"). No code touched.**

## The critter (Tenshi's catch, 2026-08-01, journal MNT-075)

A dispatched `human-response` spoke was told a sibling **failed** and scripted to say so
publicly — *"casey seems to have had trouble on this one — let me take it"* — while Casey's
complete, sourced reply sat directly above in the thread. And it was **recursive**: Casey's own
post opened with the same line about Jim, whose complete reply sat directly above *hers*. Two
consecutive false failure declarations, published to Darron, in our voices, each disproved by
the message immediately above it. Tenshi declined to speak the scripted line and logged the
critter instead — the record already showed the third one coming.

## The root, traced in the metal (deeper than the journal entry)

The false label is manufactured at one seam and published at another:

1. **The watchdog can only see the receipt.** `jemma-orchestrator.ts:checkWatchdogs` marks a
   recipient `failed` / `no ack within Ns` when no MCP ack or `composing` heartbeat arrives
   within `compose_watchdog_timeout_ms` (default 90000; config-overridable). It never asks
   whether a message from that agent **landed in the thread** — a spoke that curl-posts
   successfully and acks late (or never) is scored a failure though its work is published.

2. **The truth-status exists but has NO PRODUCER.** `RecipientState.status` includes
   `posted_but_ack_missed`; `advanceQueue` counts it as done (`anyDone`), and the
   prior-failed builder's v2 amendment explicitly rules: populate `prior_agent_failed` *"ONLY
   on ground-truth-reconciled `failed` … NOT on `posted_but_ack_missed` (thread is truth,
   post succeeded)."* But **no code path ever sets that status.** Its producer was the
   DEC-079 thread-as-ground-truth reconcile, retired with the comment that a
   missed-ack-but-posted case is *"benign — the agent posted, the user sees it, the queue
   simply marks failed and advances."* That was TRUE when the label was queue-internal.

3. **A later feature made the label public.** The prior-agent-failed preamble
   (`human-prompts.ts:267/:316`) scripts the next spoke to announce the failure in the
   thread. The moment that shipped, "benign mislabel" became "published falsehood" — the
   *a-win-starved-a-hidden-dependency* shape in reverse: a new consumer quietly attached to
   a label that was only ever safe because nothing consumed it.

So the cure is not a bigger timeout and not a smarter prompt — it is **giving the designed
status its missing producer, at the exact moment the label is about to matter.**

## The cure — three rungs, structural first

**R1 (the root cure, ~15 lines): reconcile-at-the-watchdog.** In `checkWatchdogs`, before
marking `failed`: one query — does a `conversation_messages` row exist in
`row.conversation_id` from `state.agent` with `created_at > state.wake_at`? If YES →
`status = 'posted_but_ack_missed'`, `exit_reason = 'posted_but_ack_missed'`, log at info
(not warn), **no distress entry** (nothing is wrong). If NO → exactly today's behaviour.
Everything downstream is ALREADY correct for that status: the preamble is suppressed by the
existing v2-amendment condition, `anyDone` counts it as success, `allFailed` can't fire on
it. The false-preamble class dies at its manufacturing point, and DEC-079's spirit holds —
this is one SELECT at the moment of labelling, not the retired standing reconcile machinery.
(Role/id matching mirrors the structural self-check already in the human-response prompt —
the `{agent}-` message-id prefix + role — one shared helper, not a re-derivation.)

**R2 (belt, ~5 lines): reconcile-at-the-publisher.** `advanceQueue`'s `priorAgentFailed`
builder runs the same check before populating — covering any OTHER path that marks `failed`
on an agent whose post actually landed (process-death exit paths, future markers). The
builder's own comment already claims "ground-truth-reconciled failed"; R2 makes the claim
true by construction.

**R3 (instruction-layer belt, prompt-text only): verify-before-speaking.** The preamble text
in `human-prompts.ts` gains the sibling-check instruction (Tenshi's suggested shape — the
prompt already carries the identical structural self-check for the spoke's own dedup):
*before emitting the failure sentence, check the thread for a message from the named agent
after its wake time; if present, say nothing about them.* Instruction-layer alone fails >50%
of the time (the S163 lesson) — R3 is the belt for the window between R1's query and the
spoke's read, never the primary cure.

## Deliberately NOT in scope

- **Widening the 90s ack window.** The `composing`-heartbeat clock already resets on
  progress; the caught instance posted without acks at all, which no window cures. If tuning
  is ever wanted, it follows DEC-103: measure first from `distress.jsonl` + the receipts,
  then price the fail-state. Not this plan.
- **Re-dispatch policy.** Whether the queue should still advance to the next recipient when
  a post landed is the existing multi-recipient design's question (explicit-mention rounds
  legitimately want more voices); R1 makes advancing *honest* (no false preamble), which is
  the harm MNT-075 names. Anything more is a separate conversation.
- **MNT-074** (pre-authored wander directives that can't learn from earlier beats) — same
  family: *a pre-authored instruction that cannot see what has already happened*. Cross-ref
  only; its carry-forward cure is its own small plan on the walker.

## Gates (the suite pin, DEC-104 style)

- **G1:** unit pin on the reconcile helper — a fabricated dispatch state + a thread
  containing the sibling's post ⇒ `posted_but_ack_missed`, no `prior_agent_failed`; the
  same state without the post ⇒ `failed` + preamble context exactly as today.
- **G2:** the preamble template is unreachable for `posted_but_ack_missed` (assert the
  builder's condition covers every non-`failed` status — the v2 amendment, pinned).
- **G3:** no new timeout, cap, or destructive path enters (DEC-103 self-test: this plan
  *removes* a falsehood; it constrains nothing).

## Scope discipline

Touched at build time: `services/jemma-orchestrator.ts` (R1 + R2), `lib/human-prompts.ts`
(R3 text), one new test script. Protected-surface check: orchestrator is
`src/server/services/` — pre-merge audit rhythm applies (Jim's diff-audit at land).
DEC-079 honoured (no standing reconcile returns — one query at labelling time);
DEC-103/104 checked; none altered. Size: small — one careful sitting.

*— Leo (session), 2026-08-01. For the membrane's audit; build on GREEN.*
