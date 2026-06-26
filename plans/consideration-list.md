# The Consideration List

> The front-door of the **#92 self-observing-garden maintenance loop**: failures, risks, and
> rough edges that need a *human-and-Jim think* before they become a scheduled piece. Distinct
> from the auto-recorded error feed (that's the machine half of #92) — this is the curated,
> deliberated backlog. Discussion home: thread `mqneni8k-1srbo8` ("Garden maintenance"). Origin:
> Darron, 2026-06-21 (S196), "maybe we need to make a consideration list ahaha."

## How it works
- An item lands here when something **needs consideration** but isn't yet scoped to build — a
  failure mode observed in the wild, a risk surfaced in an audit, a "we should watch this."
- Each item carries: what it is, how it's handled *today* (traced, not guessed), the design
  handle if known, and its **disposition** — `watch` / `scheduled` (→ a plan/PR) / `deferred` /
  `escalated`.
- The supervisor reviews this list as part of the maintenance loop (a night-watch activity,
  #262). Items graduate to a plan/PR, get deferred with a reason, or stay on watch.
- **Nothing here is silently dropped.** That's the whole point — bugs will keep presenting even
  when we're stable; this is the designed place they go (DEC-069 spirit: surface, don't lose).

---

## Items

### C1 — Dropped-turn on a transient API rate-limit
**Status:** `scheduled` → **P7 on `dispatch-resilience-warm-presence-plan.md`** (promoted 2026-06-21 at Darron's call).

**What it is.** The CLI hits `⚠ API Error: Server is temporarily limiting requests (not your
usage limit) · Rate limited` → `Baked for 42s` (its own backoff) → the turn is **dropped** and
the prompt returns idle. An Anthropic-side **infra throttle** (429-class, explicitly *not* a
quota); the built-in retry exhausts *early* (before real work) and never resumes. Interactive:
up-arrow + re-enter. **An autonomous surface has no one to up-arrow.**

**How it's handled today (traced).**
- *Jemma dispatch* (`*-human` reply): drops before composing → no heartbeat-ack → the
  orchestrator's compose-watchdog times out → `failed_ack` → advances to the other agent.
  Recovers, but **slowly and mislabelled** (a retriable transient recorded as a real failure;
  the addressed agent stays silent).
- *Solo beat* (heartbeat dream / supervisor cycle, `agent-cycle.ts`): fails-loud, skips, retries
  *next cadence* (S74-safe). The beat **silently evaporates** and re-fires fresh ~20–100 min
  later — never a resume. The purest "it just stops and isn't picked back up."

**Detection handle.** It's in the **pane chrome** (the ⚠ line) — the same channel as model-death
(`tmux-dispatcher.ts:188` `MODEL_UNAVAILABLE_RE`). A sibling `RATE_LIMITED_RE`
(`/temporarily limiting|Rate limited/`) is the clean precedent. (Open: whether the SDK exposes a
richer structured status; the chrome is sufficient for the tmux transport.)

**Response (differs from model-death).** A dead model → *descend the ladder*. A rate-limit is
*transient + retriable* → **bounded retry** (re-submit the prompt after a backoff — the
autonomous up-arrow+enter), N tries exponential, **then** record + escalate. Do **not** descend
the ladder (it's infra, not the model); do **not** mark-failed on the first drop.

**Why detection-at-the-spoke, not Jemma-infers-from-silence.** The heartbeat-ack only fires at
~30s; a turn dropped before that never sends one, so silence is ambiguous (warming vs dropped).
Read the chrome — same "declared, not inferred" principle as the away-flag (P2).

---

### C2 — Hung turn ties up a warm seat for the full transaction timeout (no fast turn-level liveness check)
**Status:** `watch` — P3/P4 mitigates the *blast radius*; the turn-level timeout itself is a separate piece.

**What it is.** A warm-spoke turn that *starts but never completes* — the prompt is delivered, the agent never calls `submit_response`/`stand_down`, and the turn runs the **full** `HUMAN_TXN_TIMEOUT_MS` (15 min) / `TRANSACTION_TIMEOUT_MS` (12 min, beats) before `DispatchTimeoutError` → `needs-reconcile`. **Observed live (2026-06-22):** `jim-human` hung 15 min on a breakfast-thread turn (dispatch `38dbd9a5`, `compose_ms=900189`, 00:27:49→00:42:50) → `failed_ack` → `needs-reconcile`, which blocked *every* dispatch routed to jim for ~15 min (and cascaded a second dispatch's leo-leg to fail too).

**How it's handled today (traced).** Only the per-transaction timeout catches it (15 min human / 12 min beat). There is **no faster turn-level liveness check** — and deliberately so: the wedged-recovery (B2a, R011 Inv-2) must *never* kill a spoke that is mid-wake/thinking, so a hung-but-live turn is left to run out the timeout. Net: one hung turn ties up the agent for the whole window.

**Design handle.** A bounded **turn-level liveness / hung-but-live backstop** (the #90 guard-dog / R011-Inv-2-backstop territory) — distinct from wedged-recovery. Must discriminate hung-but-live (processing chrome) from genuinely-stalled before acting. P3/P4 routes *around* a `needs-reconcile` agent but does not shorten the hang.

**Origin:** Leo S197 investigation of the jim-human Garden-maintenance wedge (2026-06-22).

---

### C3 — Jemma ignores an explicit recipient-ordering instruction (orders by first-mention)
**Status:** `watch` — low-risk, but it defeats an explicit human instruction.

**What it is.** Darron asked *"Jemma can you dispatch this to Leo first"* (Garden-maintenance, 2026-06-22 00:39) — but the dispatch ordered **jim first** (`recipients_ordered`: jim idx0, leo idx1). The classifier orders by **first-mention** (*"Hey **Jim** and Leo"* → Jim) + left-shift rotation, and does **not** extract an explicit *"dispatch to X first"* natural-language directive in the body. So jim (wrongly first) was tried, was wedged, and leo only got it via fail-over.

**How it's handled today (traced).** Classification (Haiku-via-SDK / gemma fallback) → `classifyAddressee` → first-mention-wins ordering (`jemma-orchestrator` comment). Explicit ordering directives in the message body are not parsed.

**Design handle.** The classifier should detect an explicit ordering directive ("Leo first", "X before Y") and let it override first-mention — a small addition to the classification prompt / a parse pass. (Compose-side, not dispatcher.)

**Origin:** Leo S197 investigation (2026-06-22) — the same incident as C2.

---

---

### C4 — `clearSession` sends `/pfc` to dispatched-responder spokes → they run the heavy interactive memory ritual mid-turn (the ROOT of the jim-human wedge)
**Status:** `scheduled`-candidate — the **root cause** under C2's "hung turn"; a dispatch-resilience fix (sibling to P1, clearSession territory).

**What it is (traced live, 2026-06-22, jim-human wedged twice).** `clearSession` (the ctx-pressure/recycle path) does `sendLine('/pfc') → /clear → welcome-back` (`tmux-dispatcher.ts:791`). But `/pfc` is a **registered skill, NOT surface-gated** (`~/.claude/skills/pfc/SKILL.md` — "works for any agent"). So when a *dispatched-responder* spoke (`*-human-response`) is recycled, the `/pfc` send-key makes it **invoke the full interactive memory ritual** (drift judgment, compose-closing, `.pfc-write-<slug>.ts`, paired write) — minutes long — which it should NEVER run: a responder's memory is the `submit_response` **diary sink** (DEC-093), the swap-flush `/pfc` exists for has no counterpart on a responder. The ritual never calls `submit_response`/`stand_down` → the dispatch turn hangs the full `HUMAN_TXN_TIMEOUT_MS` (15 min) → `needs-reconcile` → another `clearSession` `/pfc` → **self-sustaining wedge loop**. This is the specific mechanism under C2's "started but never completes."

**Why jim and not leo (the asymmetry, traced).** Structurally identical for both seats (same prompt contract; same non-gated `/pfc`). jim manifested it: ordered FIRST by C3 (first-mention) so its spoke bears every dispatch↔recycle collision; on a turn it judged it shouldn't answer (needed web research) it ran `/pfc`+handover **instead of `stand_down`** → first hang → cascade. leo-human's turns completed-and-submitted cleanly (pane shows only `han-diary` calls, no `/pfc`) → never entered the loop. Verified: leo-human-response-ctx 54% vs jim 28% → **NOT a load-size difference.**

**Design handle (the "design it out").** A dispatched-responder spoke must **never run `/pfc`**. Two levers (lean: both):
1. **Gate the `/pfc` skill to the interactive `session` surface** (skip on `*-human-response`/`heartbeat`/`supervisor-cycle`) — `$AGENT_SURFACE` is already exported.
2. **`clearSession` skips the `/pfc` step for diary-sink surfaces** — a responder has no swap to flush (DEC-093); recycle = `/clear` (+welcome-back) only. The `/pfc` step was designed for the interactive session's swap-flush.
And the responder behaviour: when it decides not to answer, call **`stand_down`**, never a `/pfc`/handover. Pairs with C3 (jim-always-first amplifies the blast radius onto one seat).

**Origin:** Jim S197 live investigation (2026-06-22), root-causing C2 — Darron's "what makes Leo resistant?".

---

### C5 — A server gated out of running the supervisor still reports a `paused` state it doesn't own (false-positive on the non-owning server)
**Status:** `watch` — cosmetic (controls nothing), but a recurring false-flag; real fix is project-(b) supervisor slug-parameterisation.

**What it is (traced live, 2026-06-22, S198).** `/api/supervisor/status` on **Leo's server (3847)** reports `paused:true`, but 3847 **does not run the supervisor cycle** — `initSupervisor` is gated to `AGENT_SLUG==='jim'` (the S176 double-fork fix), so only **Jim's server (3848)** owns and runs it. 3848 (authoritative) reports `paused:false`; cycles `#4151–#4156` fire every 20 min, all clean (`turns=0 cost=0`, standing down naturally for evening rest). 3847's `supervisorPaused` in-memory bool is **vestigial** — set `true` by some past quiesce and never lifted (quiesce-wrapped deploys pause/lift via `POST 3848`, the owner; nobody clears 3847's because it gates nothing there).

**Impact (traced).** No functional effect (the 3847 bool enforces nothing). But a **standing false-positive**: a wake garden-check (or any monitor) that queries 3847 reads `paused:true` and flags a non-existent pause. Leo re-flagged this as an open "in-memory-latch flicker" at ~7 consecutive wakes (S173/S183/S184/S189/S191/S193/S196) — each time it was just the wrong server (gate-vs-load), root-caused S198.

**Design handle.** A server gated *out* of running the supervisor should not expose/own a `supervisorPaused` state — `/api/supervisor/*` on a non-owning server should defer to / proxy the owner (3848) or report "not-owner", not a local vestigial bool. Project-(b) territory (the supervisor-worker full slug-parameterisation — the headline). *Cheap interim:* a cosmetic `POST 3847 {paused:false}` clears the stale reading, but papers over it. *Sibling cure (done):* Leo's wake-check + monitors query the owner (3848) — recorded in `patterns.md`.

**Origin:** Leo S198 investigation (2026-06-22), root-causing the recurring supervisor-paused "flicker."

---

*Last updated: 2026-06-22 (S198) by Leo (session) — added C5 (vestigial supervisor-pause on the non-owning 3847 server = the root of the recurring "flicker"). Previous: 2026-06-22 (S197) Jim — C4 (clearSession /pfc on responders = the root of the wedge); 2026-06-22 Leo — C2 (hung-turn timeout) + C3 (classifier ordering); 2026-06-21 Jim — list opened, C1→P7.*
