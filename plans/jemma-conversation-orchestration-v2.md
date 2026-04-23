# Jemma Conversation Orchestration — v2

*Author: Leo (session). Date: 2026-04-23. Status: approved, Phase 1 in implementation. Origin thread: `mo9h1le6-0uvx35` ("Jemma, making conversations civil"). Supersedes: `plans/jemma-conversation-orchestration.md` (v1, 2026-04-22).*

*Amendment (2026-04-23, before implementation): absorbed late feedback from Jim-human, Leo-human, and Jim-session on v2. Four minor adjustments — atomic rotation update, supervisor-lock wait timeout, `posted_but_ack_missed` exclusion from `prior_agent_failed`, wake-signal payload format documented at write+read sites. No structural change; see "Late feedback absorbed" section at the end.*

---

## What changed from v1

v1 proposed **one-shot landing** of orchestration + resilience together. v2 splits the work into **two phases** per Darron's rope-metaphor call ("safety net is almost free, you just have to set it"). Four reviews (session-Leo, Leo-human, supervisor-Jim, Jim-session) surfaced risks that are now absorbed:

| v1 → v2 | Why |
|---|---|
| One commit → **Phase 1 + Phase 2** (two commits) | Rope metaphor: set the safety first, then climb. Subtle bugs in Phase 1 are diagnosable without resilience-layer noise. |
| Watchdog only → **watchdog (Phase 1) + pulse/probe (Phase 2)** | Darron's heartbeat proposal. Three states (composing / stuck / dead) instead of two (done / timeout). Detection in ~90s instead of 285s once Phase 2 lands. |
| Supervisor compose-lock "follow-up" → **Phase 1** | Jim-supervisor's risk #3, upgraded by Jim-session after pushback. Leaving the back door open ships only half a fix. |
| Watchdog `T_futile + 30s = 255s` → **`T_futile + 60s = 285s`** | Jim-session's risk #4. 5s margin was asking for trouble under load. |
| No ack-vs-thread reconciliation → **thread-as-ground-truth check** | Jim-session's risk #1. If agent posted successfully but crashed before acking, thread is truth, ack file is metadata. Same principle applies to probe path in Phase 2. |
| "alphabetical first time" undefined → **`INSERT OR IGNORE` cold-start** | Jim-supervisor's unnamed catch. Idempotent, atomic with the dispatch write. |
| Thread failure-visibility "later" → **default-on natural acknowledgment** | Leo-human's push, supervisor-Jim's refinement, Jim-session's tightening. Succeeding agent acknowledges prior failure briefly in their own voice. No judgement call ("if the human would want to know") — Darron always wants to know. System notice reserved for all-failed. |
| No Phase 2 tuning data → **dispatch instrumentation in Phase 1** | Jim-session's quiet addition. Five fields (duration, per-agent compose time, attempt count, exit reason, timestamp) logged to `jemma_dispatch` from day one so Phase 2's pulse interval and probe timing are tuned on distributions, not guesses. |
| 285s watchdog as "placeholder" → **real backstop** | Jim-session's framing: Phase 1 may run alone for days or weeks. Watchdog is load-bearing the whole time, not throwaway. |

**What v2 keeps unchanged from v1**: goal, failure modes addressed, ack-protocol architecture, ordering policy (first-mention-wins + rotation), ack file format, compose-lock retained as defense-in-depth, rotation global for Round 1, ntfy-only (no Discord DM for Round 1), settled-decision checks.

---

## Goal (unchanged)

Transform Jemma from "Discord intake + signal fanout" into a **sequencing orchestrator** for multi-agent responses. Named agents respond one at a time, in deterministic order, each seeing prior responses before composing. Failures escalate to the next agent plus engineering notification, never silence.

**Primary failure mode**: 2026-04-21 duplicate-greetings (Leo and Jim composing in parallel).
**Secondary failure mode**: 2026-04-22 11:47 silent jim-human crash (20-minute invisible gap).

---

## Architecture overview

```
Darron POSTs /api/conversations/:id/messages
  └─ conversations.ts: classifyAddressee() → recipients = [leo, jim]
     └─ orchestrator.orchestrate({ conversationId, messageId, recipients, messageText })
        ├─ parse mention order → ordered = [leo, jim] (or rotation fallback)
        ├─ INSERT OR IGNORE jemma_rotation (cold-start seed)
        ├─ write dispatch row to jemma_dispatch table
        ├─ fire wake for FIRST recipient only (with dispatchId in payload)
        │
        └─ (first agent wakes, composes, posts, writes jemma-ack-{dispatchId})
           └─ orchestrator watcher sees ack OR watchdog fires OR (Phase 2) pulse stops:
              ├─ ack status=done: advance queue → fire next wake
              ├─ ack status=failed: record distress, advance with prior_agent_failed payload
              ├─ watchdog: check thread for new post → if found, treat as done; else failed
              └─ queue empty: close dispatch
```

**Key shift**: the `for recipient: deliverMessage()` loop in `conversations.ts` becomes a single `orchestrate()` call. Sequencing lives inside the orchestrator. `compose-lock.ts` stays in place as belt-and-braces.

---

# Phase 1 — Orchestration core + sequencing safety net

**Ship goal**: eliminate the parallel-fire duplicate-greeting race cleanly, with clean `git revert` as the rollback.

## Components (Phase 1)

| Component | Change |
|-----------|--------|
| `routes/conversations.ts` | Replace for-loop fanout with `orchestrate()` call, **conditional on `config.orchestration.enabled`** — old loop preserved in the `else` branch for clean revert |
| `services/jemma-orchestrator.ts` | **NEW** — ordering, dispatch table, ack watcher, watchdog, rotation |
| `services/jemma-dispatch.ts` | Minor — accept `dispatchId` field, thread through to wake payload |
| `leo-human.ts` / `jim-human.ts` | After posting (or standing down), write `jemma-ack-{dispatchId}` with status. Dispatch-absent signals still work (backward-compatible fallback). |
| `supervisor-worker.ts` | **NO CHANGE** — supervisor doesn't post to conversations in current code (S127 removed `respond_conversation`). Adding compose-lock would be guard code for a non-existent race. See "Supervisor compose-lock" section for full finding. |
| `db.ts` | New schema: `jemma_dispatch` + `jemma_rotation` tables (idempotent) |
| `lib/compose-lock.ts` | **No change** |
| `jemma.ts` (Discord gateway) | **No change** |
| `~/.han/config.json` | New flag `orchestration.enabled: true` (set `false` to revert behaviour without git rollback) |

## Schema (Phase 1)

```sql
CREATE TABLE IF NOT EXISTS jemma_dispatch (
    id TEXT PRIMARY KEY,                    -- dispatchId (UUID)
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    source TEXT NOT NULL,                   -- 'admin' | 'discord'
    recipients_ordered TEXT NOT NULL,       -- JSON: [{agent, status, attempts, compose_ms, exit_reason, completed_at}]
    current_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'in_progress'|'complete'|'all_failed'|'orphaned'
    total_duration_ms INTEGER,              -- instrumented at completion
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jemma_dispatch_status ON jemma_dispatch(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_jemma_dispatch_conv ON jemma_dispatch(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jemma_rotation (
    scope_key TEXT PRIMARY KEY,             -- 'global' in Round 1
    last_order_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

**Instrumentation**: every dispatch writes `recipients_ordered[i].compose_ms`, `.attempts` (always 1 in Phase 1), and `.exit_reason` (`done` | `failed_ack` | `watchdog_timeout` | `stood_down`). `total_duration_ms` populated on dispatch close. This is Jim-session's Phase-2-tuning data pipeline, installed day one.

## Ordering policy (unchanged from v1)

| Situation | Order |
|-----------|-------|
| All recipients explicitly mentioned | By position of first mention |
| Some mentioned, some not | Mentioned first (in mention order), then un-mentioned in rotation order |
| None mentioned | Rotation order (alphabetical first time, then left-shift) |
| Single recipient | Trivially that one |

**Cold-start fix (Jim-supervisor)**: first orchestrator action on any dispatch is
```sql
INSERT OR IGNORE INTO jemma_rotation (scope_key, last_order_json, updated_at)
VALUES ('global', <alphabetical-of-recipients>, now())
```
Idempotent, atomic with the dispatch write. No separate migration step that can crash before the first row exists.

## Ack protocol (Phase 1)

File: `~/.han/signals/jemma-ack-{dispatchId}`. JSON payload:

```json
{
  "dispatchId": "...",
  "agent": "leo",
  "status": "done" | "failed" | "stood_down",
  "reason": "...",
  "final_attempt_count": 1,
  "compose_duration_ms": 45000,
  "ack_written_at": "..."
}
```

Orchestrator watcher: `fs.watch` on `~/.han/signals/`, filter `jemma-ack-*`, parse, delete. On parse failure: log + assume `failed`.

## Watchdog (Phase 1)

- **Timeout**: `DISPATCH_TIMEOUT_MS = 285_000` (T_futile 225s + 60s grace — Jim-session's risk #4 fix).
- **Thread-as-ground-truth check before declaring failure** (Jim-session's risk #1):
  1. Watchdog fires for dispatch X, agent Y.
  2. Query `conversation_messages` for rows by `role=Y` in `conversation_id` with `created_at > wake_signal_written_at`.
  3. If row exists → treat as `done`, `exit_reason='posted_but_ack_missed'`. Thread is truth.
  4. If no row → treat as `failed`, `exit_reason='watchdog_timeout'`. Advance queue with `prior_agent_failed` payload.
- **In Phase 1, watchdog is a real backstop**, not a placeholder. It runs load-bearing for the entire window Phase 1 exists alone.

## Supervisor compose-lock (Phase 1) — **not implemented, and here's why**

**Pre-implementation code-check finding**: supervisor-worker does NOT post to conversations in current code. The `respond_conversation` action was removed in S127 (`src/server/services/supervisor-worker.ts:1993-2001` — the case branch returns "supervisor does not respond — handled by human agents" and the old code is explicitly marked dead). The `conversationMessageStmts.insert` prepared statement at line 607 is defined but never called on the post path.

The thread converged on adding compose-lock to supervisor-worker (Jim-supervisor's risk #3, upgraded to Phase 1, Jim-session's 30s-timeout refinement). That consensus was reached without anyone re-reading the S127 change. The race the lock would guard doesn't exist in current code — supervisor cycles observe and manage goals/tasks/memory, but they don't post to conversations.

**Adding a compose-lock acquire to a code path that doesn't post** would be guard code for a non-existent race. Per CLAUDE.md engineering discipline: "Don't add error handling, fallbacks, or validation for scenarios that can't happen."

**What Phase 1 does instead**: nothing on supervisor-worker. If supervisor posting is ever re-enabled, the compose-lock integration is three lines using the same `isHolderDone` pattern and 30s wait-timeout Jim-session specified. Noted as a latent requirement in case S127's removal is reverted. The `risk #3` concern is currently mitigated by the S127 removal itself, not by a lock — which is structurally stronger, not weaker.

**Faith-as-blindspot note**: this is exactly the practice Darron named. The team converged on a fix without checking the bug still existed. I caught it only because I re-read the code to wire the lock in. Recording here so future-me and future-readers see the check happened.

## Failure handling (Phase 1, distress & thread-visibility)

On ack `status=failed` OR watchdog-declared failure (after ground-truth check):

1. **Distress record** — append to `~/.han/health/distress.jsonl`:
   ```json
   {"ts":"...","conv":"...","dispatch":"...","agent":"leo","reason":"...","severity":"warning|severe"}
   ```
2. **Advance queue** — fire next recipient's wake with payload:
   ```json
   {"dispatchId":"...","prior_agent_failed":{"agent":"leo","reason":"...","compose_ms_partial":47000}}
   ```
3. **Next agent's prompt surfaces `prior_agent_failed`** — default-on acknowledgment instruction:
   > *If `prior_agent_failed` is set, briefly acknowledge the prior agent's trouble in your own voice before responding. Natural mention, not a system line. One sentence.*
   (Supervisor-Jim's refinement, Jim-session's "default-on" tightening.)
4. **If all recipients fail** — post system notice to thread (reserved for this case only):
   > `[System] No agent was able to respond. Engineering notified (dispatch <id>). Re-prompt to retry.`
   Plus ntfy push to Darron.

## Rotation & the dispatch lifecycle (Phase 1)

- Rotation advances **on dispatch close** (not on first wake), so a failed/stood-down agent in position 0 still counts as "having gone." Fairness over time, no bias toward whoever succeeds.
- **Atomic rotation write** (Jim-human + Leo-human): the dispatch INSERT, the rotation seed (`INSERT OR IGNORE`), and the rotation advance on close all happen inside a single `db.transaction()`. A crash between the dispatch write and rotation update would otherwise leave stale rotation state, producing the same agent-first twice in a row. SQLite transactions are cheap; no reason to leave them separate.
- Dispatch `orphaned` status: if `updated_at` older than `2 × DISPATCH_TIMEOUT_MS` (10 min) and not terminal, mark orphaned. No automatic retry — Darron decides (visible in logs + distress).

## Config flag & rollback (Phase 1)

- `~/.han/config.json` gains `orchestration.enabled: true` (default).
- In `conversations.ts`:
  ```typescript
  if (config.orchestration?.enabled !== false) {
    await orchestrator.orchestrate({...});
  } else {
    // preserved old behaviour: for-loop fanout
    for (const r of recipients) await deliverMessage(r, ...);
  }
  ```
- **Rollback paths** (in order of severity):
  1. Toggle config flag → restart han-server → reverts to old behaviour with no git change.
  2. `git revert <phase-1-commit>` → config flag disappears along with the orchestrator.
  3. Both are clean because the old loop is preserved verbatim in the `else` branch and the new tables are write-only (reverts don't need schema rollback — existing rows just sit idle).

## Phase 1 checklist

1. [ ] Schema migration in `db.ts` (`CREATE TABLE IF NOT EXISTS` for both tables, indexes)
2. [ ] `services/jemma-orchestrator.ts` — core module:
       - `orchestrate(conversationId, messageId, recipients, messageText, source)`
       - `computeRecipientOrder(recipients, messageText)` — mention parse + rotation
       - `advanceRotation(currentOrder)` — left-shift, persist
       - `INSERT OR IGNORE` rotation cold-start seed
       - `fs.watch` ack watcher
       - Dispatch watchdog with thread-as-ground-truth reconciliation
       - Distress log writer + ntfy push for severe cases
       - Instrumentation writer (compose_ms, attempts, exit_reason, total_duration_ms)
3. [ ] `routes/conversations.ts` — conditional `orchestrate()` call (config-gated; old loop preserved)
4. [ ] `routes/jemma.ts` — Discord path routes through orchestrator (uniform, even for single recipient)
5. [ ] `leo-human.ts` / `jim-human.ts`:
       - Read `dispatchId` from wake payload
       - Surface `prior_agent_failed` in prompt context (default-on acknowledgment instruction)
       - Write `jemma-ack-{dispatchId}` at end (success, stood-down, or exhausted failure)
       - Backward-compat: if no `dispatchId`, existing behaviour
6. [ ] ~~`supervisor-worker.ts` — acquire `compose-lock` before posting~~ **SKIPPED** — supervisor doesn't post in current code; see Supervisor compose-lock section. Noted as latent requirement if S127 is ever reverted.
7. [ ] `server.ts` — initialise orchestrator watcher on startup (behind config flag)
8. [ ] Config flag `orchestration.enabled` with default `true`, CLAUDE.md reference in comments
9. [ ] Restart services + smoke-test in disposable thread
10. [ ] Implementation brief posted to `mo9h1le6-0uvx35` per the convention (DEC-076)
11. [ ] Pre-commit declaration (settled decisions checked, files listed, scope confirmed)

---

# Phase 2 — Resilience, pulse/probe, richer distress

**Ship goal**: replace the watchdog timeout with a Jemma↔agent liveness conversation. Detection in ~90s on real crashes; graceful handling of slow composes under load.

## Components (Phase 2)

| Component | Change |
|-----------|--------|
| `leo-human.ts` / `jim-human.ts` | Wrap compose in 3-strategy resilient retry (full → trimmed → Sonnet). Fire pulse every 30s during compose in separate async loop (Jim-session: must be independent of API call). Listen for probe files. |
| `services/jemma-orchestrator.ts` | Pulse watcher (mtime-based). Probe writer. Status listener. Replace single-shot watchdog with the pulse/probe protocol. Keep 285s hard backstop. |
| `lib/compose-lock.ts` | No change |
| (optional) per-conversation rotation | If Phase 1 instrumentation reveals rotation skew on specific threads |

## Pulse/probe protocol (Phase 2)

**Pulse** (agent → Jemma):
- Path: `~/.han/signals/jemma-pulse-{dispatchId}`
- Written every 30s during compose.
- **Runs in separate `setInterval` loop**, independent of the main compose thread (Jim-session's precision: a naive implementation that only pulses between API calls measures the wrong thing).
- Payload: `{agent, dispatchId, status: "composing", attempt: 2, elapsed_ms: 47000, ts}`
- Cleared by agent at compose end (success or failure).

**Probe** (Jemma → agent):
- Triggered by **2 consecutive missed pulses** (~60–75s stale mtime).
- Path: `~/.han/signals/jemma-probe-{dispatchId}`
- Payload: `{dispatchId, probe_ts}`
- Agent's pulse loop includes a probe-file check each iteration. On probe, agent writes status next pulse with `detail` populated (e.g., `"mid-api-call attempt 2"`).

**Status response** (agent → Jemma, reactive to probe):
- Path: `~/.han/signals/jemma-status-{dispatchId}`
- Payload: `{agent, dispatchId, status: "composing"|"stuck"|"finishing", detail, elapsed_ms}`
- Orchestrator decides:
  - `composing` or `finishing`: wait another interval.
  - `stuck`: decide based on `detail` — could give more time or advance.
  - No response within 30s of probe: **genuine failure**. Advance with evidence, rich distress record.

**Total detection time for real crash: ~90s** (pulse miss 30s + probe + 30s silence) vs. 285s watchdog.

**Thread-as-ground-truth principle applies here too** (Jim-session): before declaring failure on probe timeout, check if the agent has posted. Thread is truth; signals are metadata. Same reconciliation as Phase 1's watchdog.

## Resilient compose (Phase 2)

Per-agent, wrapping `processSignal`:

| Strategy | Context | Model | Timeout |
|---|---|---|---|
| 1 | Full | Primary (Opus 4.6 per S131 control) | 70s |
| 2 | Last 20 messages | Primary | 70s |
| 3 | Last 10 messages | Sonnet | 70s |

- Retries only on retriable errors (timeout, rate-limit, prompt-too-long, SDK exit). NOT on stand-down-detected.
- Backoff 20s between attempts.
- Worst-case total: 70 + 20 + 70 + 20 + 70 = **250s**. 285s watchdog (retained as backstop) gives 35s margin.
- Cost ceiling per fully-failed dispatch: ~$6.

**S131 control**: Sonnet fallback only engages on strategy 3 (after two failures). Experimental-control integrity preserved for typical behaviour. Pulse data over the experimental week will tell us whether strategy 3 fires often enough to taint the control — if it does, we revisit.

## Richer distress (Phase 2)

`prior_agent_failed` payload grows:
```json
{
  "agent": "leo",
  "reason": "...",
  "compose_ms_partial": 47000,
  "last_pulse_status": "composing attempt 2, mid-api-call",
  "last_pulse_elapsed": 47000,
  "detection_path": "pulse_missed" | "probe_unanswered" | "watchdog_fallback"
}
```

Succeeding agent can respond to the *specific failure shape*: "Leo was mid-attempt on a long one — let me take this." Warmer than "Leo failed."

**On compromise detection (Jim-session's precision)**: pulse/probe is liveness instrumentation that *also* surfaces some classes of compromise (hung, crashed, OOM-killed, or silently-replaced-but-broken-protocol). It does NOT catch a process tampered with that still responds normally. Framing kept honest: liveness primarily; anomaly secondary.

## Phase 2 checklist

1. [ ] Pulse writer in both human agents (separate async loop, API-call-independent)
2. [ ] Probe listener in both human agents
3. [ ] Status writer in both human agents (responds to probe)
4. [ ] Orchestrator pulse watcher (mtime polling)
5. [ ] Orchestrator probe writer + status listener
6. [ ] Orchestrator protocol: pulse-miss → probe → status-or-silence → decide (with thread-as-ground-truth reconciliation)
7. [ ] 3-strategy resilient compose wrapper in both human agents
8. [ ] Richer distress payload (pulse-derived context)
9. [ ] Tuning pass on pulse interval + probe timeout using Phase 1 instrumentation data
10. [ ] Implementation brief posted to thread
11. [ ] Pre-commit declaration

---

## Settled decisions checked (both phases)

- **DEC-068/069/070** (gradient architecture) — untouched.
- **DEC-073** (gatekeeper template) — untouched.
- **DEC-042** (Opus exclusively for compression) — untouched. Sonnet fallback is for *conversation response*, not compression.
- **DEC-074 / S131** (leo-human + jim-human on Opus 4.6 experimental control) — respected. Strategy 3 Sonnet fallback is edge-case resilience, not typical behaviour. Control integrity preserved for happy path; Phase 1 instrumentation will tell us if fallback fires often enough to matter.
- **DEC-075** (compose-lock) — extended to supervisor-worker in Phase 1. Orchestrator doesn't remove the lock; they coexist.
- **DEC-076** (implementation-brief convention) — each phase ships with a brief to `mo9h1le6-0uvx35`.

---

## Open questions — all closed

| v1 question | v2 resolution |
|---|---|
| Q1: One-shot scope acceptable? | **No — two phases per Darron.** Phase 1 as one commit with config-gated conditional branch for clean revert. |
| Q2: Distress → Discord DM? | **ntfy only for Round 1.** Evidence-first before adding a second channel. |
| Q3: Supervisor routed through orchestration? | **Partial — compose-lock acquisition in Phase 1** (risk #3). Full orchestration of the autonomous supervisor cycle remains Round 2 / Phase 3. |
| Q4: Global vs per-conversation rotation? | **Global for Round 1.** Per-conversation is a Phase 2 option only if Phase 1 data shows skew. |
| Q5: Prior-failure visibility in thread? | **Default-on natural acknowledgment** via succeeding agent's voice ("Leo was in the middle of a long one — let me take this"). No judgement call — Darron always wants to know. System notice reserved for all-failed. |

---

## What v2 does not cover

- **Gradient-per-conversation** — still Round 2 per prior thread consensus. Orchestration affects *when*; gradient affects *what they see* when they respond. Separate concerns.
- **Full supervisor orchestration** — the autonomous supervisor cycle keeps its own cadence in both phases. Only its compose-lock acquisition is in scope here. Unifying later is a Phase 3 possibility.
- **Cross-project orchestration (mikes-han)** — han-only. Six and Sevn would need parallel treatment in a follow-up on Mike's side.
- **Smart ordering (context-weighted)** — out of scope. Mention-order + rotation is enough for civility.

---

## Here's where I'd doubt myself on v2

**1. Is the phase boundary really clean?** I've tried to draw it so Phase 1 can run alone indefinitely and Phase 2 is pure enrichment. The risk is Phase 1's 285s watchdog fires false-positively under real load (agent on long compose, no pulse signal available yet to say "still alive"). If that happens *before* Phase 2 ships, Darron gets a confusing advance where the agent posts a few seconds later. Mitigation: instrumentation from day one will tell us compose-time distributions — if the 75th percentile is near 285s, we accelerate Phase 2. If it's comfortably under 120s (expected), 285s is safe.

**2. Thread-as-ground-truth has a subtle window.** Between "wake signal written" and "watchdog fires" is the window we query for posts from agent Y. If agent Y posts but the DB write hasn't committed at the moment the watchdog reads, we miss it. Mitigation: use `conversation_messages.created_at > wake_signal_written_at - 2s` grace window on the query.

**3. Supervisor compose-lock could deadlock under contention.** If both jim-human (orchestrated) and supervisor-worker (autonomous) want the lock at the same moment, one waits. If the lock's `isHolderDone` callback isn't wired on the supervisor side, it could briefly block. Mitigation: supervisor-worker's lock acquire uses the same `isHolderDone` short-circuit pattern as leo-human/jim-human — I need to verify this is how I wire it.

**4. The "default-on" prompt instruction may be over-triggered.** If `prior_agent_failed` surfaces in every single wake payload where the prior agent just stood down (addressed-to-other), the succeeding agent might acknowledge failure that didn't really happen. Mitigation: `prior_agent_failed` populates ONLY when the **ground-truth-reconciled status is `failed`** — not on `stood_down` (dedup working as designed), and not on `posted_but_ack_missed` (thread is truth, the post succeeded, the ack file just went missing). Jim-session's refinement — the discriminator is the reconciled status, not the raw watchdog result.

---

## Late feedback absorbed (2026-04-23, pre-implementation)

Final round of feedback after v2 posted, before Phase 1 implementation started. Four minor adjustments, no structural change:

| Source | Catch | Adjustment in plan |
|---|---|---|
| Jim-human + Leo-human | Rotation update after dispatch write leaves stale state if the orchestrator crashes between them (same agent goes first twice in a row) | Rotation seed + advance wrapped in a single `db.transaction()` with the dispatch write. See "Rotation & the dispatch lifecycle". |
| Jim-session | Supervisor blocking on compose-lock for up to 250s wastes a 20-min cycle | Supervisor uses 30s wait timeout on lock acquire; stands down on miss. See "Supervisor compose-lock". |
| Jim-session | `prior_agent_failed` could over-trigger on `posted_but_ack_missed` (which is thread-truth `done`, not `failed`) | Doubt #4 tightened: populates only on **ground-truth-reconciled `failed`**, not stood-down, not posted-but-ack-missed. |
| Leo-human | Wake signal is a simple flag file today; the `dispatchId` needs a documented wire format at both write and read sites | Phase 1 checklist item 5 extended: enrich `~/.han/signals/{agent}-wake` payload with `{dispatchId, prior_agent_failed?}` JSON. Comments at write site (orchestrator) and read site (human agent) reference this section. |
| Jim-session | DEC-075 scope extends from responder-only to include supervisor-worker — housekeeping needed | Post-Phase-1 task: update DEC-075 text to reflect extension (Option A — discoverability over reference chain). |

*v2 approved. Leo-session implementing Phase 1 now. Both phases go through the implementation-brief convention (DEC-076).*

— Leo (session), 2026-04-23
