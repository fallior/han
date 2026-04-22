# Jemma Conversation Orchestration — Civil Conversations

*Author: Leo (session). Date: 2026-04-22. Status: implementation plan for review. Origin thread: `mo9h1le6-0uvx35` ("Jemma, making conversations civil"). Related discussion: `mo98jep4-ym8hwx` ("Conversations should flow").*

---

## Goal

Transform Jemma from "Discord intake + signal fanout" into a **sequencing orchestrator**
for multi-agent responses. When a message addresses multiple agents, they respond one
at a time in a deterministic order; each sees the previous agent's contribution before
composing; failures escalate to the next agent plus an engineering notification rather
than collapsing into silence.

Primary failure mode being fixed: the 2026-04-21 morning-salutations duplication, where
Leo and Jim both composed near-identical good-mornings in parallel because neither
could see the other's intent. Secondary: the 2026-04-22 11:47 jim-human crash, where
a silent failure left Darron with no response until he re-prompted 20 minutes later.

## What exists today (baseline, not fiction)

- `src/server/jemma.ts` — Discord gateway service. Reads Discord via WebSocket,
  classifies with Haiku/Ollama, posts to `/api/jemma/deliver` on han-server.
- `src/server/routes/jemma.ts` — HTTP surface on han-server that receives Jemma's
  deliveries.
- `src/server/services/jemma-dispatch.ts` — `deliverMessage()` function that writes
  the wake signal for a single recipient. Called by `routes/jemma.ts` (Discord path)
  and by `routes/conversations.ts` (admin/web path).
- `src/server/routes/conversations.ts` — POST handler for `/api/conversations/:id/messages`.
  Currently uses `classifyAddressee()` to determine recipients, then calls
  `deliverMessage()` once per recipient in a `for` loop. All recipients wake in parallel.
- Agents (`leo-human.ts`, `jim-human.ts`) — watch `~/.han/signals/` for their respective
  wake signal files (`leo-human-wake`, `jim-human-wake`), compose and post responses.
- `src/server/lib/compose-lock.ts` — cross-agent compose lock (built yesterday, not
  yet deployed). Patches the parallel-wake race if orchestration is unavailable.

**Current flow (web conversation addressing two agents):**
```
Darron POSTs to /api/conversations/:id/messages
  └─ conversations.ts: classifyAddressee() → recipients = [leo, jim]
     └─ for recipient in recipients: deliverMessage(recipient)
        └─ jemma-dispatch.ts: writes signal file (leo-human-wake, jim-human-wake)
           └─ BOTH agents wake nearly simultaneously
              └─ BOTH compose in parallel
                 └─ BOTH post (duplicate-greeting failure mode)
```

## Proposed flow

```
Darron POSTs to /api/conversations/:id/messages
  └─ conversations.ts: classifyAddressee() → recipients = [leo, jim]
     └─ Jemma.orchestrate({ conversationId, messageId, recipients, messageText })
        ├─ parse mention order → ordered = [leo, jim]  (or rotation fallback)
        ├─ write dispatch row to jemma_dispatch table
        ├─ write wake signal for FIRST recipient only
        │
        └─ (first agent wakes, composes, posts)
           └─ first agent writes jemma-ack-{dispatchId}
              └─ Jemma watcher sees ack:
                 ├─ status=done: advance queue → write wake for next recipient
                 ├─ status=failed: write distress record, advance to next recipient
                 │                 with a context note ("Leo attempted and failed: ...")
                 └─ queue empty: close dispatch
```

**Key change:** the `for recipient in recipients` loop in `conversations.ts`
becomes a single `Jemma.orchestrate()` call. The sequencing happens inside Jemma.

## Components changed or added

| Component | Change |
|-----------|--------|
| `routes/conversations.ts` | Replace the `for recipient: deliverMessage` loop with a single `orchestrate()` call |
| `services/jemma-orchestrator.ts` | **NEW** — orchestration logic, queue management, ack watcher |
| `services/jemma-dispatch.ts` | Minor — accept `dispatchId` field to thread-through to the wake payload |
| `leo-human.ts` / `jim-human.ts` | After posting, write `jemma-ack-{dispatchId}` signal with status |
| `db.ts` | **NEW schema** — `jemma_dispatch` and `jemma_rotation` tables |
| `lib/compose-lock.ts` | **No change** — kept as fallback for the non-orchestrated path and as belt-and-braces |
| `jemma.ts` (Discord service) | **No change** — Discord flow still calls `/api/jemma/deliver` which routes through orchestration as well |

## Schema additions

Two new tables in `~/.han/tasks.db`:

```sql
CREATE TABLE jemma_dispatch (
    id TEXT PRIMARY KEY,                    -- dispatchId (UUID)
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,               -- original message triggering this dispatch
    source TEXT NOT NULL,                   -- 'admin' | 'discord'
    recipients_ordered TEXT NOT NULL,       -- JSON: [{ agent, status, attempts, last_error, completed_at }]
    current_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'complete' | 'all_failed'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_jemma_dispatch_status ON jemma_dispatch(status, updated_at);
CREATE INDEX idx_jemma_dispatch_conv ON jemma_dispatch(conversation_id, created_at DESC);

CREATE TABLE jemma_rotation (
    scope_key TEXT PRIMARY KEY,             -- 'global' initially; could be per-conversation later
    last_order_json TEXT NOT NULL,          -- JSON array of agent names, e.g., ["jim","leo"]
    updated_at TEXT NOT NULL
);
```

## Orchestration protocol

### Step 1: Determine recipient order

Given `recipients = [leo, jim]` (or more) and `messageText`:

1. **Parse explicit mentions in order of appearance.** Case-insensitive regex
   on first-name tokens (`\bleo\b|\bleonhard\b` → leo; `\bjim\b|\bjimmy\b` → jim).
   Record the **position of first mention** for each recipient that's mentioned.
2. **If all recipients were explicitly mentioned**, order them by mention position.
3. **If some recipients were NOT explicitly mentioned** (e.g., Gemma classifier included
   them by context, or this is a neither-named case), fall through to rotation.
4. **Rotation fallback**: read `jemma_rotation` for `scope_key='global'`. If absent,
   default to alphabetical ordering. Compute next rotation by shifting the previous
   order left by one position. Save the resulting order as the new `last_order_json`.

**Example evolution** (two agents):
- First ever dispatch, no mentions: alphabetical → `[jim, leo]`
- Next rotation: `[leo, jim]`
- Next: `[jim, leo]`
- (Two-agent case is just alternation.)

**Example with three agents** (future-proofing):
- Alphabetical first: `[casey, jim, leo]`
- Rotation 1: `[jim, leo, casey]`
- Rotation 2: `[leo, casey, jim]`
- Rotation 3: `[casey, jim, leo]` (back to start)

**Mixed case** — if one recipient is mentioned and another isn't: put the mentioned
one first (their author cared enough to name them), then append the un-mentioned ones
in rotation order.

### Step 2: Persist the dispatch

Insert one row into `jemma_dispatch` with `status='pending'` and the ordered recipients
list with per-recipient `status='pending'`.

### Step 3: Fire the first wake signal

Use the existing `deliverMessage()` machinery, but call it **only for the first
recipient**. Include the `dispatchId` in the signal payload so the agent can
reference it when ack'ing.

### Step 4: Wait for ack

Jemma's orchestrator process watches `~/.han/signals/` for files matching
`jemma-ack-{dispatchId}`. Payload shape:

```json
{
  "dispatchId": "...",
  "agent": "leo",
  "status": "done" | "failed",
  "reason": "optional description if failed",
  "final_attempt_count": 1,
  "compose_duration_ms": 45000,
  "ack_written_at": "2026-04-22T..."
}
```

### Step 5: Advance or close

On ack:
- **status=done**: update dispatch row, advance `current_index`, fire wake for next
  recipient if any. If no more recipients, mark dispatch `complete`.
- **status=failed**: record the failure in `recipients_ordered`, write an entry to
  engineering distress log (`~/.han/health/distress.jsonl`), advance to next recipient
  with a **context note** in the wake payload (`prior_agent_failed: { agent, reason }`)
  so the next agent knows Leo tried and why it didn't work. If no more recipients,
  mark dispatch `all_failed` and post a system notice to the thread.

### Step 6: Watchdog timeout

If no ack arrives within `DISPATCH_TIMEOUT_MS` (see resilience section below) after a
wake signal is written, treat as implicit `failed` with reason `"no_ack_timeout"`.
Prevents a crashed agent from jamming the queue forever.

## Recipient ordering policy — summary table

| Situation | Order |
|-----------|-------|
| All recipients explicitly mentioned | By position of first mention, left to right |
| Some mentioned, some not | Mentioned first (in mention order), then un-mentioned in rotation order |
| None explicitly mentioned (generic question, Gemma-classified, follow-up) | Rotation order (alphabetical first time) |
| Single recipient | Trivially that one — no ordering needed |

Rotation state is **global** for Round 1 (one `scope_key='global'` row). Per-conversation
rotation is a Round 2 option if needed — current scope is simpler and still removes
the "Leo always first" bias Darron flagged.

## Ack protocol — file format

Agents write a single file per dispatch:

- **Path:** `~/.han/signals/jemma-ack-{dispatchId}`
- **Contents:** JSON as above
- **Timing:** written AFTER the agent has posted its response (or decided to stand down,
  or exhausted retries). Single atomic write (temp-file-and-rename is not needed —
  small JSON).

The orchestrator's watcher:
- Uses `fs.watch` on `~/.han/signals/` (same pattern as existing wake signal watchers).
- Filters for `jemma-ack-*` filenames.
- Reads the file, parses JSON, deletes the file after processing.
- Handles parse errors gracefully (log + assume failed).

## Failure handling — the agent's side

Each agent implements the **resilient compose** design discussed with Darron:

- **Normal attempt** (1): full context, primary model, 70s timeout.
- **Degraded retry** (2): trim context to last 20 messages, same model. Only on
  retryable errors (SDK exit, timeout, rate limit, prompt-too-long). Not on
  "addressed-to-other-agent" stand-downs.
- **Fallback retry** (3): trim further to last 10 messages, fall back to Sonnet.
- **Fail cleanly**: if all three fail, write `jemma-ack-{dispatchId}` with
  `status=failed` and the underlying reason. Release compose-lock. Release
  `responding-to-{id}` claim. Exit the processSignal handler.

Each agent's `processSignal` becomes:

```typescript
async function processSignalResilient(signal):
  const attempts = []
  for strategy of [fullContext, trimmedContext, sonnetFallback]:
    try:
      await withTimeout(attemptCompose(signal, strategy), 70_000)
      writeJemmaAck({ status: 'done', final_attempt_count: attempts.length + 1 })
      return
    catch err:
      attempts.push({ strategy, err })
      if isNonRetriable(err): break
      await sleep(backoffMs(attempts.length))

  writeDistressReport(signal, attempts)
  writeJemmaAck({ status: 'failed', reason: summarize(attempts) })
```

**Resilience parameters** (final — from the earlier discussion with Darron):

| Parameter | Value | Reasoning |
|-----------|------:|-----------|
| N_strategies | 3 | Full / trimmed / sonnet — smarter, not more |
| T_per_attempt | 70s | ~1.5× normal compose (45s median) |
| T_between | 20s | Backoff after failure |
| T_futile | 225s | 5× median compose — Darron's "significant deviation" threshold |
| Max cost / failed dispatch | ~$6 | 3 attempts worst case |

If Darron has a strong preference for file-check-cheap polling at 100 attempts that's
a *different* layer — it's the compose-lock polling, already at 1s intervals. That's
separate from SDK compose attempts. Keeping both clear in the implementation.

## Failure handling — Jemma's side

When an agent ack's `failed`, or the dispatch watchdog fires:

1. **Record distress** — append a JSONL line to `~/.han/health/distress.jsonl`:
   ```json
   {"timestamp":"...","conversation_id":"...","dispatch_id":"...","agent":"leo","reason":"...","attempts":[...],"severity":"warning"}
   ```
2. **Advance the queue** — fire the next recipient's wake with a `prior_agent_failed`
   payload so they know context.
3. **If all recipients fail** — post a terse system notice to the thread:
   ```
   [System] Neither agent was able to respond to this message due to persistent
   failures. Engineering has been notified (dispatch: <id>). Re-prompt to try again.
   ```
4. **ntfy push** for severe cases (all-failed, or repeated failures on same dispatch) —
   send to Darron's personal ntfy channel so he knows before he next opens the thread.

## Compose-lock — what happens to it

**Kept, not removed.** Reasons:

1. **Belt and braces.** If Jemma's orchestrator crashes, the server falls back to
   direct wake signals (round 2 feature, not in round 1). The compose-lock prevents
   duplicate-greeting in that fallback path.
2. **Concurrent write protection within a single agent process.** The same agent
   responding to the same conversation from two trigger paths (signal + explicit
   supervisor cycle) is still a real race. The lock is defense in depth.
3. **Near-zero overhead.** Under orchestration, only one agent is ever mid-compose
   for a dispatch. The lock is acquired, briefly held, released. No waiting needed
   in the happy path.

No code change to `compose-lock.ts`. It sits where it is and does its job quietly.

## Migration plan

This is a **one-shot landing** per Darron's request. No phased rollout. All
changes ship together in a single commit.

1. **Schema migration** — add `jemma_dispatch` and `jemma_rotation` tables on server
   startup. Idempotent `CREATE TABLE IF NOT EXISTS`.
2. **Orchestrator service** — new file `services/jemma-orchestrator.ts`. Imported by
   `routes/conversations.ts` replacing the direct fanout loop. Watcher registered on
   server startup in `server.ts`.
3. **Agent ack writers** — `leo-human.ts` and `jim-human.ts` gain a small helper to
   write `jemma-ack-{dispatchId}` at end of `processSignal` (success or exhausted
   failure). Only activates when signal payload includes `dispatchId`; absent →
   falls through to current behaviour (so pre-existing signal formats still work).
4. **Resilient compose wrapper** — add to both `leo-human.ts` and `jim-human.ts`.
5. **Config flag** — `~/.han/config.json` gains `orchestration.enabled: true`.
   If false, falls back to current parallel-wake behaviour. Safety valve.
6. **Restart services** — systemd restart of `han-server`, `leo-human`, `jim-human`,
   `jemma` (optional — jemma.ts Discord gateway doesn't change but a clean restart
   re-syncs).

## Rollback plan

If the orchestration misbehaves in production:

1. Set `orchestration.enabled: false` in `~/.han/config.json`.
2. Restart `han-server`.
3. Behaviour reverts to parallel wake + compose-lock (today's behaviour).

No schema rollback needed — the new tables simply aren't written to.

## Edge cases & policies

| Case | Policy |
|------|--------|
| Darron addresses only Leo ("Hey Leo") | Jemma dispatches only to Leo. Jim is not woken. |
| Neither agent named, neither agent involved before | Rotation default: alphabetical → jim first. |
| Leo fails; Jim succeeds | Thread gets Jim's response. Distress recorded. Rotation advances normally. |
| Leo succeeds; Jim fails | Thread has Leo's response. Distress recorded. Rotation advances. Thread notice noting Jim's attempt failed. |
| Both fail | Thread gets system "[System] Neither agent could respond..." notice. ntfy push to Darron. Distress with severity=severe. |
| Orchestrator crashes mid-dispatch | Watchdog on dispatch row: if `updated_at` older than `2 × T_futile` and status not terminal, mark as `orphaned_restart`, don't retry automatically (Darron decides). |
| Third agent added in future (Tenshi, Casey) | Rotation formula generalises — shift left by one. No code change needed. |
| Discord message in a channel with only one receiver | Jemma's existing Haiku classification determines the single recipient; orchestration is a one-element queue; ack → complete. |
| Supervisor-Jim cycle posts while jim-human is in orchestrated queue | The supervisor's dedup check already catches this (Jim-human stands down if a supervisor already posted since last human/leo message). Jim-human writes `jemma-ack` with `status=done, reason="stood_down_supervisor_already_replied"`. Orchestrator advances. |

## Testing approach

**Unit level** (before ship):
- `parseOrderFromMentions("Hey Leo and Jim", ["leo","jim"])` → `["leo","jim"]`
- `parseOrderFromMentions("Jim and Leo, I want...", ["leo","jim"])` → `["jim","leo"]`
- `parseOrderFromMentions("Does anyone have thoughts?", ["leo","jim"])` with rotation state `["jim","leo"]` → `["leo","jim"]` (rotated)

**Integration level** (after ship, in a disposable test thread):
1. Post a message mentioning both. Observe: first agent posts, second agent waits, second posts after first completes. No duplicate-greeting.
2. Post a generic follow-up. Observe: rotation applied, opposite agent leads.
3. Simulate agent failure (temporarily set bad model string): first agent fails cleanly, second agent responds with failure-context note.
4. Simulate both fail: system notice lands on thread, distress.jsonl records, ntfy fires.

**Observability:**
- Log every dispatch transition at INFO level: `[Jemma] dispatch {id}: {agent} → {status}`
- `~/.han/health/jemma-health.json` gains `active_dispatches`, `completed_last_hour`,
  `failed_last_hour` fields.
- Admin UI `/admin/jemma` panel (future — not Round 1) could surface dispatch history.

## Implementation order (checklist)

1. [ ] Schema migration in `db.ts` (`CREATE TABLE IF NOT EXISTS` for both tables)
2. [ ] `services/jemma-orchestrator.ts` — core orchestration module with:
       - `orchestrate(conversationId, messageId, recipients, messageText, source)`
       - `computeRecipientOrder(recipients, messageText)` — mention parsing + rotation
       - `advanceRotation(currentOrder)` — compute and persist next rotation
       - Signal-file watcher for `jemma-ack-*` patterns
       - Dispatch watchdog (timeout detection)
       - Distress log writer
3. [ ] `routes/conversations.ts` — replace the for-loop fanout with a single
       `orchestrate()` call. Keep classifyAddressee() unchanged; feed its output
       to the orchestrator.
4. [ ] `routes/jemma.ts` — Discord path also routes through orchestrator (single-recipient
       case, but uniform code path).
5. [ ] `leo-human.ts` / `jim-human.ts` —
       - Read `dispatchId` from wake payload
       - Wrap `processSignal()` body in the 3-strategy resilient compose
       - Write `jemma-ack-{dispatchId}` at end (success or exhausted failure)
       - On stand-down (addressed-to-other-agent), still write ack with status=done and reason
6. [ ] `server.ts` — import and initialise the orchestrator watcher on startup
7. [ ] Config flag `orchestration.enabled` with default `true`, safety fallback to `false`
8. [ ] Restart + test in disposable thread
9. [ ] Implementation brief posted to `mo9h1le6-0uvx35`
10. [ ] Commit (pre-commit declaration covering: `conversations.ts`, `routes/jemma.ts`,
        `leo-human.ts`, `jim-human.ts`, `db.ts`, new `jemma-orchestrator.ts`, possibly
        `server.ts` — no protected files touched beyond the template reference we
        already added for implementation briefs)

## Settled decisions checked

- **DEC-068 / 069 / 070** (gradient architecture) — untouched. No compression or
  identity-memory code modified.
- **DEC-073** (gatekeeper-controlled template) — untouched. No template edits in this
  plan. The implementation-brief reference already added yesterday remains.
- **DEC-042** (Opus exclusively for compression) — untouched. Sonnet fallback in the
  resilient compose is for *conversation response*, not compression.
- **S131 decision** (leo-human/jim-human pinned to Opus 4.6 as experimental control) —
  respected. The resilient compose's strategy 3 (Sonnet fallback) intentionally moves
  off Opus, which deviates from the experimental control. Worth naming: a forced Sonnet
  fallback may taint the control-arm data if it fires frequently. **Policy: the Sonnet
  fallback only engages on a second failure. The experimental control is about typical
  behaviour, not edge-case resilience. Failed responses aren't typical collaboration.**

## Open questions (resolve before implementation)

1. **Is Round 1 scope acceptable at one shot?** The plan covers orchestration, ordering,
   resilience, and distress logging in one landing. That's larger than the compose-lock
   was. I can ship it; flagging for review.

2. **Should the distress log also trigger a Discord DM to Darron?** Currently proposing
   ntfy push for all-failed. Discord DM would be redundant if ntfy works, but adds a
   second channel. Suggest: start with ntfy only, add Discord DM if ntfy proves
   unreliable for this use case.

3. **What about Jemma-session / supervisor conversations?** The `supervisor` role also
   responds to conversations (via supervisor-worker cycle detecting pending responses).
   The supervisor is NOT currently orchestrated through Jemma. Proposal: leave as-is
   for Round 1 — supervisor runs on its own cadence and its dedup check already prevents
   double-posting once jim-human has responded. Round 2 could unify.

4. **Global rotation vs per-conversation rotation?** Proposal: start global (simpler).
   Watch for cases where per-conversation rotation would meaningfully improve UX (e.g.,
   one thread is Leo-heavy, another is Jim-heavy, and global rotation spreads unfairly).

5. **Should the "previous agent failed" context note be visible in the thread?**
   Proposal: no — it's in the wake payload to the next agent, and in the distress log
   for engineering. Putting it in the thread itself would be noisy. If it's useful for
   user awareness, add later.

## What this plan does not cover

- **Gradient-per-conversation** — still Round 2 per earlier thread consensus. Orchestration
  affects *when* agents respond; gradient affects *what they see* when they do. Separate
  concerns, separate implementations.
- **Supervisor orchestration** — the autonomous supervisor cycle is not routed through
  Jemma in Round 1. See Open Question 3.
- **Cross-project orchestration** — this applies only to han's web conversations and
  Discord threads routed through Jemma. mikes-han (Mike's fork) has its own agents
  (Six, Sevn) and would need parallel treatment in a follow-up.
- **Ordering by reply relevance** — Round 1 uses mention-order and rotation. Could later
  add smarter ordering (e.g., "the agent with most context on this thread goes first").
  Not needed for the civility goal.

---

*End of plan. Ready for review by Jim-session, Jim-supervisor, Leo-human, and Darron.
If the design is approved, Leo-session implements in one landing per the checklist above.*

— Leo (session)
