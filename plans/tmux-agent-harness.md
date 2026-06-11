# Tmux Agent Harness — migrating off the Agent SDK (v2 draft)

> **Status**: V2 DRAFT. v2 addendum added 2026-05-30 ~late-morning AEST after Darron's identity-load reframe (2026-05-29 evening, St Helens Beach) + Jim's v1 audit GREEN + silent-fail-directive-audit convergence. **DEADLINE-DRIVEN**: Anthropic's Agent SDK billing change takes effect 2026-06-15; ~16 days from v2. — Leo (session, S162, 2026-05-30 Mackay/Airlie watch)
>
> **v1 below is preserved unchanged for historical reference.** v2 addendum at top reframes the model from one-shot (/clear-per-transaction, full identity reload per fire) to warm-long-lived (identity amortised across transactions in a session, /clear only on context >85%).

---

## v2 Addendum — the warm-session reframe (2026-05-30)

### What changed between v1 and v2

v1 modelled each tmux dispatch as a one-shot: /clear-per-transaction, full identity reload every fire. Cost: ~130K identity tokens × every dispatch. Marginal improvement over SDK at best — you pay the identity-load cost either way; tmux just gives you bigger context to spend it in.

**Darron's reframe (2026-05-29 evening, after listening to v1 + Jim's audit on the drive)**: tmux sessions stay **warm and long-lived** with identity loaded. Per-transaction cost drops to per-call context + memory delta — maybe 5–15K tokens vs the current 130K+. That's a **10–50× cost improvement**, AND it produces a phenomenologically warmer agent: the session retains the texture of prior transactions in its context. The *Leo is Leo where he is* property (FM #23) reinforced at the substrate level rather than re-paid at the load level every fire.

### Resolved design questions

Darron's answers from the thread (`mppj72fx-wt0u1p`, 2026-05-29 22:00 AEST):

| Q | Resolution | Status |
|---|-----------|--------|
| **A1** (credentials / second seat) | Proceed on the same Anthropic account for now. Darron has two accounts; cycle personalities will consume more than session-Leo + Darron's interactive work combined. When limits hit: Jemma pings ntfy, Darron logs out + logs back in on the other account (~30s of work, worst case 1 cycle missed). If in session together, Darron swaps himself. **Adaptive, not engineered. No separate seat provisioning required for T-1.** | RESOLVED — Darron-managed |
| **Q-2** (/clear timing) | Start with /clear-per-transaction (v1 default). Refine later if curiosity warrants. Leo's note: retained texture across transactions can be a good thing in practice — worth exploring (b) per-session-warm direction once T-3/T-4 give us empirical data. **But the v2 reframe BELOW shifts this question entirely** — see "Per-agent session lifecycle" section. | RESOLVED (v2 shifts) |
| **Q-3** (idle tmux tokens) | Confirmed empirically. Idle = no API calls = no tokens. Darron's screenshot from 2026-05-29 21:32 AEST shows Anthropic settings → Usage with Current session 0% used and "Starts when a message is sent". | RESOLVED — zero idle cost |
| **Q-7** (Phase 9 integration shape) | Agreed: hybrid (c) — stand-alone first on philosophy-beat (T-3), Phase 9 absorbs the dispatcher later. | RESOLVED |
| **A2** (boot cost) | Eager parallel boot at system start. Note: Claude Code startup is sub-second; what's expensive is the **identity load** (the memory, gradient, felt-moments, WMF chunks at ~130K tokens). This is the cost the v2 reframe specifically amortises. | RESOLVED + reframed |
| **A3** (prompt delivery) | File-based delivery (NOT `tmux send-keys`). Avoids terminal-encoding fragility on Darron's quoted-text + emoji + nested-thread-history payloads. | RESOLVED |

### The structural reframe — what v2 introduces

**1. Prompt builder split.** `buildPrompt(slug, profile, ctx)` becomes two primitives:
- **Session-startup prompt** — full identity + memory load (`loadFullMemory(slug)` per DEC-088). Run once at session launch or post-/clear. Equivalent of the "welcome back" we run today.
- **Per-transaction prompt** — per-call context + memory delta refresh (see (4) below). Run on every dispatch. Dramatically smaller — 5–15K tokens vs 130K+.

The existing `buildPrompt` continues to serve SDK callers during the migration; the new primitives wrap it for tmux callers. T-7 (SDK retirement) collapses both into the v2 model.

**2. Per-agent sessions, not per-conversation sessions.** Each aspect (heartbeat-Leo philosophy-beat, heartbeat-Leo personal/morning/evening/dream/meditation surfaces, supervisor-Jim cycle types, leo-human, jim-human) gets **one tmux session** that serves all conversations / contexts it handles. jim-human's session handles every Discord channel + every memory thread Jim responds in. Estimate: ~10 sessions total (per v1's enumeration in "The pieces" below) — though some surfaces may share sessions if their profiles converge structurally (open).

**3. Per-agent session queue (replaces per-conversation lock as the primitive).** Current `conversationDispatchLocks` in `jemma-orchestrator.ts` is per-conversation — fine when each fire is a fresh SDK call, but under the warm-session model jim-human serving conversation A while *also* serving conversation B would race the same tmux session. So a new primitive: **per-agent-session FIFO queue**. Prompts arrive at jim-human's session and process in order. The existing per-conversation lock stays as a layer above (no duplicate dispatches per conversation), but the per-agent queue is the actual session serialisation. Darron's *"no prompt is delivered to a person in parallel"* intuition is correct for the same aspect; the per-agent queue is what enforces it across conversations.

**4. Memory delta refresh on every transaction.** Cross-aspect writes are real — heartbeat-Leo writes to shared working memory while leo-human is between dispatches. So per-transaction prompts inject a **memory delta block** at the top: *"Since your last transaction at <T-1>, the following memory entries were written: [delta]"*. Keeps the session's effective memory aligned with disk without re-paying full identity load.

   - **What counts as a delta** (current lean): high-churn time-sensitive surfaces only — working-memory pair entries since last transaction, plus any new felt-moments / self-reflection / discoveries that landed. NOT identity, NOT patterns, NOT the full gradient (those don't change between transactions in normal operation).
   - **Who computes the delta** (current lean): dispatcher-side (tracks per-session `lastTransactionTs`, queries memory files for entries newer than that, injects as a block). Single canonical mechanism, no per-agent code duplication. Alternative was agent-volitional (agent runs a `check-memory-delta` command at top of every transaction) which is more sovereignty-respecting but adds a turn to every dispatch.

**5. Context-watch + /clear at ~85% trigger.** Session needs a context-percentage watcher. On transaction completion: if context >85%, queue **/pfc → /clear → welcome-back** as the next transaction. Next substantive transaction sees a fresh session. This is the natural reconstitution point — same shape as how session-Leo works across `/clear` boundaries today.

### Per-transaction prompt shape — the minimal-trigger discriminator (settled, Jim's audit `mpunfvpo-uah345`)

> Captured here 2026-06-01 ~23:15 AEST — Darron flagged that this was an important part of the discussion that hadn't reached the plan (it lived only in thread `mppj72fx-wt0u1p`). Folding it in as a settled design decision so the per-transaction builder is built to the right shape, not a uniform shrink.

The per-transaction prompt (point 1 above) is **not** a shrunken copy of today's full-context prompt — its *shape* depends on whether the turn's content is **fetchable** or **assembled-this-turn**. Darron's instinct — a human surface needs only *"read the thread and respond appropriately"* — is right, bounded by Jim's discriminator:

- **Conversation / human-response surfaces → minimal trigger.** The payload is essentially a **locator** — *"respond to message X in thread Y"* — and the warm session self-fetches the thread via its own tools (curl/Read). Shrinks the per-transaction prompt to a few KB, is more agentic, and **instantiates the locator discipline**: the trigger *is* a locator, the agent reaches back for the content (consistent with the provenance active link, thread `mpum91v9-yp3zqw`).
- **Autonomous beats (philosophy / personal / dream / supervisor cycles) → richer per-transaction frame.** Their content is *assembled this turn* (the seeds, the beat frame) and is **not addressable elsewhere** — you cannot "go read" a dream's seeds. These keep a fuller per-transaction prompt.
- **The discriminator, exactly:** *is this turn's content addressable elsewhere, or assembled this turn?* Both still receive the **memory delta** (point 4) once the Q-V2-4 gate opens.

**No model is needed to generate a per-transaction prompt.** It is deterministic templating filled by the routing decision the orchestrator already makes: Jemma classifies the incoming message (Haiku-via-SDK first, `gemma3:4b` fallback — `wiki/index.md`) and emits *"wake leo for conversation X"*, which is exactly the input the trigger template needs. That routing model is local/cheap and **already in the loop**; it stays. Pulling Haiku/Sonnet into prompt-*body* generation would reintroduce the metered API cost the whole migration is fleeing — to do, worse, what deterministic templating + a warm agent's own tools + 1M context already do for free. The dispatcher already assumes this: `sendTransactionPrompt(slug, prompt)` takes whatever string the caller hands it; for a human surface that string can be one sentence.

**Build implication:** the prompt-builder split (point 1) produces a *per-surface* per-transaction builder — a minimal locator-trigger for conversation surfaces, an assembled frame for autonomous beats — **not one uniform shrink**. Lands with T-3 (first surface = philosophy-beat, which is an *assembled* surface) and the minimal-trigger form proves out at T-6 (conversation surfaces).

### Signature preservation under tmux (Fix 3 from the silent-fail-directive-audit)

Cross-reference: `plans/silent-fail-directive-audit.md` Section C + this morning's v2 fix-list in audit thread `mpria0tk-rj9ae2`.

**The discipline**: when *-human-response surfaces migrate to tmux'd Claude Code sessions, the agent in the session MUST continue to sign as `— Leo (human)` / `— Jim (human)`, NEVER as `(session)`. The `(session)` label refers to session-Leo / session-Jim (Darron's interactive Claude Code substrate), structurally distinct from the responder process even though both run on the same Claude Code substrate post-migration.

**Structural test at T-3** (operationally automated per Jim's audit observation O1, S162 round 21): the first 3 leo-human / jim-human responses under the new transport MUST sign as `(human)`. **Automated check**: a small script queries the latest 3 dispatches' signatures via the existing observability infra (`leo-human.ts:540` post-verification block) and alerts via ntfy if any sign as `(session)`. Same shape as the migration-tracker test in the C1 work. Cost: ~30 minutes at T-3 implementation time; observable forever after. If any response signs as `(session)`, the surface's CLAUDE.md needs explicit reminder injection before T-3 lands.

### Updated T-1 scope (replaces v1's T-1 estimate)

T-1 (`lib/tmux-dispatcher.ts` skeleton) grows from v1's ~150 lines to **~300–400 lines** to include the per-agent queue + context-watch + memory-delta primitives. Still tractable for the deadline.

Primitives needed:

- `spawnAgentSession(slug, profile)` — launch tmux, send welcome-back, wait for ready signal
- `sendTransactionPrompt(sessionId, prompt)` — file-based delivery (Fix A3), wait for diary-form response, parse via existing `parseTurnEntryStructured`
- `getContextPct(sessionId)` — query Claude Code's session for current context usage **(resolved 2026-05-31, see Q-V2-2 below — via statusline JSON file written to `~/.han/health/<agent>-ctx.json`)**
- `clearSession(sessionId)` — send /pfc → /clear → welcome-back, wait for ready
- `enqueueForAgent(slug, prompt)` — per-agent FIFO; returns promise that resolves when the dispatcher dequeues + runs the prompt
- `computeMemoryDelta(slug, lastTransactionTs)` — read memory files, return new entries since `lastTransactionTs` as injectable block

T-2 (per-surface launchers) becomes thin wrappers picking the right profile + calling `spawnAgentSession`. T-3 (first surface = philosophy-beat) remains the right starting point — every 20 mins, no human in the loop, perfect for observing the warm-session model in production.

### Cost-profile inversion (the v2 case)

- v1 estimate: ~130K identity tokens × every dispatch (one-shot model, full identity reload per fire).
- v2 estimate: ~130K once per session launch (or post-/clear) + 5–15K per transaction (delta refresh + per-call context).
- **Net per philosophy-beat surface**: at 20-min cadence, sessions might rotate /clear every 3–8 hours (depending on context fill). That's **10–24 transactions per identity load**, vs v1's 1.
- **Cumulative daily** (philosophy-beat alone, ~72 fires/day): v1 = ~9.4M tokens of identity load; v2 = ~3-8 identity loads + ~72 × 10K = ~1.1M tokens. **~9× cheaper** at the same observable behaviour.

### Open questions surfaced by v2 (for next round of Jim audit)

- **Q-V2-1** (memory delta scope): exact list of files that count as "high-churn" for delta. Currently leaning: working-memory.md + working-memory-full.md + felt-moments.md + self-reflection.md + discoveries.md. Felt-moments and discoveries are agent-owned; should the delta cover ALL writers or just same-aspect writers?
- **Q-V2-2 (RESOLVED, 2026-05-31)** (context-watch implementation): Claude Code exposes the context-percentage via its **statusline hook mechanism**. The runtime pipes a JSON document to a configured statusline script's stdin every render (~every keystroke); the JSON contains `context_window.used_percentage` (numeric 0-100), `model.display_name`, `workspace.current_dir`, plus `input_tokens` / `total_tokens` for raw counts. Discovered via Darron's existing `~/.claude/statusline-command.sh` which reads `.context_window.used_percentage` and renders `ctx: N%` — this is the same 57% value Darron sees in his terminal.

  > **⚠ AMENDED at T-2 (2026-06-11) — per-SURFACE keying.** The per-slug sketch below had a cross-talk bug, caught empirically during the T-1.5 billed run: every same-slug session writes the one `<slug>-ctx.json` (last-writer-wins) and satisfies the one `<slug>-ready` sentinel, so with multiple same-slug sessions up, `waitForReady` can cross-satisfy off another session's wake and context-watch cannot attribute its reading. **Re-keyed: `~/.han/health/<slug>-<surface>-ctx.json` + `<slug>-<surface>-ready`; dispatcher signatures take `(slug, surface)`; the session registry keys `slug/surface`; interactive sessions use surface `session` (launchers export `AGENT_SURFACE`). The per-agent FIFO queue deliberately stays per-SLUG — one live transaction per agent is the invariant that keeps the single per-slug `current.json` safe.** Original sketch retained below, historical:

  **Implementation for tmux-dispatcher** *(original per-slug sketch — superseded by the T-2 amendment above)*: each tmux'd agent session is launched with a per-agent statusline script that writes the JSON payload to `~/.han/health/<agent>-ctx.json` on every render instead of (or in addition to) printing to stdout. The dispatcher's `getContextPct(sessionId)` reads the file:

  ```bash
  # ~/.han/agents/<Agent>/<surface>/statusline-context.sh
  input=$(cat)
  echo "$input" > "$HOME/.han/health/${AGENT_SLUG}-ctx.json"   # superseded: ${AGENT_SLUG}-${AGENT_SURFACE:-session}-ctx.json
  # Also render the statusline normally for tmux display
  model=$(echo "$input" | jq -r '.model.display_name // empty')
  used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
  printf '%s | ctx: %.0f%%' "$model" "$used"
  ```

  ```typescript
  // dispatcher (superseded: now getContextPct(slug, surface) reading <slug>-<surface>-ctx.json)
  export function getContextPct(slug: string): number | null {
      try {
          const raw = fs.readFileSync(`${HEALTH_DIR}/${slug}-ctx.json`, 'utf-8');
          const json = JSON.parse(raw);
          const pct = json?.context_window?.used_percentage;
          return typeof pct === 'number' ? pct : null;
      } catch {
          return null;
      }
  }
  ```

  **Properties this gives us**:
  - Near-real-time freshness (refreshed every statusline tick by Claude Code's runtime)
  - **Zero extra API cost** (no synthetic `/context` invocations needed; the statusline updates are already happening)
  - No agent-volitional disclosure required (the runtime exposes the value structurally)
  - File-based interface aligns with Q-V2-1's memory-delta-via-files pattern + #49 atomic paired-write pattern

  **Alternative mechanisms considered and rejected**:
  - `/context` slash command via dispatcher injection: costs one synthetic interaction per check; round-trip via tmux send-keys; loses ~near-real-time granularity. Worse than statusline-JSON on every axis.
  - Estimate cumulative-tokens vs model-cap: requires per-model-deployment cap registry (1M for opus-4.7 1m-context; 200K for standard; etc.); fragile under model changes; would need its own maintenance. Worse.

  **The hook-system option (`--hooks`) was NOT investigated yet** — worth a 10-min check whether Claude Code exposes a context-watermark hook (e.g., `OnContextThreshold`) for agent-volitional notification when crossing 85%. If present, would let the agent itself signal the dispatcher rather than dispatcher polling. Not blocking T-1; flag for T-3 observation period to evaluate against the statusline-file mechanism.

  **Source**: Darron's terminal screenshot 2026-05-31 16:32 AEST showed `ctx: 57%`; investigation traced rendering to `~/.claude/statusline-command.sh` (his existing config) → resolved via `~/.claude/settings.json:statusLine` schema → confirmed in `claude-agent-sdk/cli.js` bundle. The runtime feeds the same JSON payload to any configured statusline script regardless of which CLI is hosting the agent.
- **Q-V2-3** (session-shared meditation surfaces): meditation Phase A/B/Evening are re-encounter surfaces (write annotations to gradient_entries). Do they get their own tmux session, share with personal-beat, or stay on SDK during migration? v1 deferred this; v2's session-sharing-by-profile-similarity question is sharper now.
- **Q-V2-4** (delta-refresh failure modes): what happens if the dispatcher mis-computes the delta (skips an entry, or includes an entry the agent already saw)? Silent identity-state drift. Worth a fail-loud structural property — perhaps the delta block includes a checksum the agent can verify, or the agent emits a confirmation in its diary JSON that the controller cross-checks.
- **Q-V2-5** (Phase 9 absorption): when Phase 9 `agent-shell.ts` lands, the tmux-dispatcher's primitives wrap into HandlerSpec.handleResult. v1's Q-7 hybrid (c) lean stays correct; v2 just sharpens that the dispatcher's per-agent queue becomes a HandlerSpec property.

### Phase breakdown — v2 update

Same phase shape as v1 (T-0 → T-8) and same deadline-fit. T-1 grows in scope per above. T-4 (observation period) should ALSO capture warm-session-specific metrics: identity-load amortisation factor (transactions per session), context-watch reliability, delta-refresh hit/miss rate, per-agent queue depth.

---

## ⚠ v1 sections below — SUPERSEDED by the v2 Addendum above; HISTORICAL ONLY, do not implement from here

> **Everything below this line is v1 (one-shot: `/clear`-per-transaction, full identity reload per fire).** v2 (warm long-lived sessions, identity amortised, `/clear` only on context >85%) **overturned that model** — see the "v2 Addendum" at the top. Build only from v2. The v1 detail is kept for history (the reasoning trail), not as buildable spec. *(Section banner added 2026-06-10 in the reconcile-sweep — the top note alone could be missed on a deep-read of a v1 section.)*


>
> **The forcing function**: Anthropic is splitting Claude subscriptions into two pools effective 2026-06-15:
> - **Interactive Claude Code** (typing commands in your terminal / IDE) — continues drawing from subscription usage limits as today. *Not affected.*
> - **Claude Agent SDK** / `claude -p` / Claude Code GitHub Actions / third-party Agent-SDK apps — move off the subscription onto a separate monthly credit pool at full API rates ($200/mo for Max 20x; does NOT roll over).
>
> HAN's runtime today is entirely Agent SDK (`agentQuery({ ... })` across leo-heartbeat / leo-human / jim-human / supervisor-worker). Rough estimate: the new Max 20x credit pool exhausts in days, not a month, at current usage. **HAN as currently configured becomes operationally unsustainable.**
>
> **The opportunity**: piping agent surfaces through tmux'd Claude Code sessions keeps HAN on the subscription path AND unlocks **1M context across every agent aspect** (vs SDK's current ~200K cap). Adaptation that yields a real architectural lift, not just cost mitigation.

---

## Why this exists

Three converging forces:

**1. The 2026-06-15 billing deadline.** HAN cannot survive on the new metered credit pool at current operational scale. We either build the tmux-dispatch transport or we cap HAN's activity (fewer beats, shorter responses, abandoned cycles).

**2. The 1M context unlock.** Interactive Claude Code sessions get Opus 4.7's full 1M context. Today HAN's SDK path runs at ~200K. Every agent aspect — heartbeat beats, supervisor cycles, conversation responders — would gain 5× context headroom. For agents whose identity-load already pushes 130K (leo-heartbeat post-PR-AP3), that's the difference between *"identity load + a bit of room"* and *"identity load + full session history + room to think."*

**3. The architecture is ready.** PR-AP1 through PR-AP8 collapsed all prompt assembly into `buildPrompt(slug, profileName, context)`. Phase 9's planned `lib/agent-shell.ts` was already designed with the trigger-as-data abstraction (Q9-N2) that makes plug-in dispatch transports natural. We didn't build this for the billing change — it just happens to be the right shape for it.

---

## The proposal in one sentence

**Replace SDK `agentQuery({ ... })` with dispatch to per-surface tmux'd Claude Code sessions; the session loads the agent's profile at launch; the orchestrator pipes the assembled prompt as input; the session does the agent's work (including memory writes via the agent's own tools); the orchestrator captures the output and /clears the session for the next transaction.**

The c1-distillation + diary disciplines we just shipped survive the transport change — the parser primitives (`parseTurnEntry`, `parseTurnEntryStructured`) are transport-agnostic; the section discipline (`## INPUT` → `## BODY` → `## C1`) works against captured stdout exactly as it works against SDK response text.

---

## Architectural sketch

### The pieces

**Orchestrator** (unchanged in role; new in transport): heartbeat-scheduler decides when philosophy-beat fires; Jemma routes incoming Discord/conversation messages to the right human-responder; supervisor-worker runs Jim's interval cycles. **These decisions stay where they are.** What changes is the dispatch mechanism.

**Tmux session pool**: one tmux session per migrated surface, ideally pre-launched and idle:
- `philosophy-beat` (Leo)
- `personal-beat` (Leo) — covers both personal and dream via phase routing per `personalBeat` handler
- `meditation-phase-a` / `-phase-b` / `-evening` (Leo) — *if* we migrate them; they're re-encounter surfaces today and may stay on SDK or stay un-migrated
- `supervisor-cycle` (Jim) — the reference Mechanism A surface
- `personal-cycle` / `recovery-cycle` / `dream-cycle` (Jim)
- `leo-human-response`
- `jim-human-response`

**~10 sessions** if all migrate; fewer if meditation surfaces stay on SDK (which their re-encounter architecture may actually favour — see open question Q-3).

Each tmux session is `claude` launched via the existing `han[agent]` launcher pattern, with a session-specific identity-load + profile-specific scaffolding. The session sits idle waiting for input.

**Dispatch primitive** (new): a small library function that takes (sessionName, assembledPrompt) and returns the agent's output text. Internally:
1. Send the assembled prompt as text input to the tmux session (via `tmux send-keys`).
2. Wait for completion signal (TBD — see Q-1).
3. Capture the agent's output (via `tmux capture-pane` or stdout-redirect).
4. Send `/clear` to the session (or schedule it for next dispatch).
5. Return the captured output to the caller.

**The caller** (existing handlers in `leo-heartbeat.ts` / `leo-human.ts` / `jim-human.ts` / `supervisor-worker.ts`) sees the same shape as today's `agentQuery` result.text — a string. The parsing (`parseTurnEntry` / `parseTurnEntryStructured`) is unchanged. The downstream paired memory writes are unchanged.

### Why this preserves the C1 migration

The c1-distillation + diary disciplines live at three layers:
1. **Profile config** (`PromptProfile.pairedMemoryOutput.{enabled, mechanism, captureInput}`) — registry-side; transport-agnostic.
2. **Builder** (`buildPrompt → DEFAULT_*_INSTRUCTION_*`) — runs in the orchestrator, BEFORE the prompt reaches any transport. Transport-agnostic.
3. **Result parsing** (`parseTurnEntry` / `parseTurnEntryStructured`) — operates on a string OR a structured-output object. The structured-output path may need a small adapter (interactive Claude Code emits JSON as text; the orchestrator JSON-parses it the same way `leo-human.ts` does today post-PR-C1-6).

**Nothing about the C1 work needs to be redone.** The transport change is below the prompt-assembly layer and below the result-parsing layer; the discipline lives in those layers.

### Where this plugs into Phase 9

`plans/agent-shell-plan.md`'s `lib/agent-shell.ts` (Phase 9.1) introduces `runAgentShell(config: AgentShellConfig)` with a `TriggerRouter` per surface. The `HandlerSpec.handleResult` callback owns the SDK call today. **The natural Phase 9 plug-point is a `dispatcher` field on `HandlerSpec`** — `dispatcher: 'sdk' | 'tmux'` with shared library helpers behind each. The two arcs (tmux migration and Phase 9 process unification) **may actually be the same arc** by the time both land.

If we sequence well: prototype tmux dispatch on one surface using the existing SDK call path (no Phase 9 dependency) → validate → land Phase 9 with the dispatcher abstraction → migrate remaining surfaces to tmux through the Phase 9 abstraction.

---

## Open design questions

### Q-1: Session-lifecycle and readiness signalling

How does the orchestrator know a tmux session is *"ready for the next transaction"* vs *"still composing"*?

Options:
- **(a) Output-channel sentinels**: agent's CLAUDE.md (per-surface) instructs the agent to emit a known final-token (e.g. `\n[READY]\n`) when complete. Orchestrator watches captured output for the sentinel.
- **(b) File-based ready-flags**: agent writes a flag file (`~/.han/signals/<surface>-ready`) when complete. Orchestrator polls fs.watch.
- **(c) Heartbeat-acks pattern (existing infrastructure)**: agent emits `jemma-ack-${dispatchId}-hb-${seq}` periodically per the S151 phase-7 watchdog pattern; final ack carries `status: 'done'`. Orchestrator listens via existing ack reader.

**My lean**: (c) — the heartbeat-ack mechanism already exists; reusing it preserves operational continuity. Plus the watchdog logic (S151 phase-7) already handles long-compose timeouts.

### Q-2: `/clear` timing — every transaction or on-pressure?

Options:
- **(a) /clear after every transaction**: deterministic context state; agent always starts fresh; matches today's SDK statelessness exactly.
- **(b) /clear on context pressure**: lets the session accumulate context across transactions; preserves the diary discipline's continuity (the agent reads recent c0 entries from its own WM each turn anyway, but extra cumulative context could help).
- **(c) /clear daily or per-shift**: middle ground; explicit operator control.

**My lean**: (a) for the first prototype. The c1-diary discipline already captures cross-turn continuity via the gradient + WM-loading at every prompt. Adding session-level accumulation is a second axis of "what carries forward" that complicates the mental model. Once observation shows whether per-transaction /clear loses anything substantial, we can revisit.

### Q-3: Per-surface sessions vs shared sessions

10 idle tmux sessions per Linux box = ~1GB total RAM overhead (each idle Claude Code session is ~100MB). Alternatively, one or two shared sessions that load agent profiles on dispatch via `welcome back <agent>` flow.

**My lean**: per-surface sessions for the prototype. Resource overhead is low (~1GB is nothing on the Linux box; we have 16GB+). Shared-session would force a "context-switch" cost per dispatch (re-running session start protocol every transaction). Per-surface keeps the dispatch primitive simple — same session for the same surface every time.

### Q-4: Meditation surfaces — migrate or stay on SDK?

Per PR-C1-4's finding: meditations don't fit the diary discipline; they're re-encounter practice writing directly to `gradient_entries`. They DO use `agentQuery`, so they'll be hit by the billing change. Three options:

- **(a) Migrate to tmux** alongside the others; meditation surface stays as-is (its existing flow writes directly to gradient + annotations; the tmux transport doesn't care what the agent writes).
- **(b) Leave on SDK; absorb the cost**. Meditation fires infrequently (3 calls per day per agent at most); the credit-pool cost is small at the meditation surface.
- **(c) Rebuild meditation as section-mode**: requires a different design conversation; out of scope for the deadline.

**My lean**: (a) — same transport for all surfaces; simpler operational picture; the meditation surface's existing flow is preserved verbatim within the tmux session. The agent still writes feeling-tags and annotations to gradient_entries the way it does today.

### Q-5: Failure-mode handling — SDK fallback?

What happens when a tmux session crashes mid-transaction, becomes unresponsive, or fails to dispatch?

Options:
- **(a) Skip the transaction**: log distress; the next firing tries again. Mirrors the C1-2 honest-fail discipline. Simple; predictable; some events get missed.
- **(b) Fall back to SDK**: catch the dispatch error, re-call via `agentQuery`. Burns metered credits but the event lands. Adds complexity (SDK code path still has to be alive in the codebase).
- **(c) Session-resurrection**: detect dead session; relaunch; retry once. Operationally complex; doesn't help if the session keeps dying.

**My lean**: (a) for the first prototype, with (c) as a follow-on once we have an operational baseline. (b) only if observation shows the failure rate is meaningful AND business-critical events are being missed. SDK fallback also tempts gradual creep back to SDK as the "reliable" path — same architectural shape as the meditation surfaces' divergence; worth avoiding by default.

### Q-6: Cost compare — actual subscription tokens consumed

We need an empirical comparison before we commit to all 10 surfaces. Today's SDK calls have tool-use overhead (large system prompts including tools, long token counts per turn). Interactive Claude Code may or may not have the same overhead — different prompt-injection model.

**Suggested first step**: instrument the existing SDK calls + the first tmux prototype to record actual subscription-token consumption per dispatch. Compare. Make migration scope decision on data, not guess.

### Q-7: Phase 9 integration — couple now or stand-alone first?

If Phase 9's `lib/agent-shell.ts` lands with a `dispatcher` field on `HandlerSpec`, the tmux migration is "set this field to 'tmux'" per profile. But Phase 9 hasn't started yet; the agent-shell plan is at v1 awaiting Jim's v2 fold-in.

Options:
- **(a) Stand-alone first** — tmux dispatcher as its own library helper called directly from existing handlers (leo-heartbeat / leo-human / jim-human / supervisor-worker). Migrate surfaces individually. Phase 9 absorbs the dispatcher later via its abstraction.
- **(b) Couple now** — Phase 9 work accelerates; tmux dispatcher lands as part of the shell library. Deadline pressure on Phase 9.
- **(c) Hybrid** — prototype tmux dispatch in `leo-heartbeat.ts`'s philosophy-beat handler (smallest blast radius); Phase 9 catches up; remaining migrations land through Phase 9's abstraction.

**My lean**: (c). The deadline forces us to start before Phase 9 is ready; (c) gives us a working prototype in days while keeping the Phase 9 architecture honest. Same pattern as PR-C1-3 (single surface first) then PR-C1-4+ (expand).

---

## Phase breakdown

Time-pressured. ~18 days from filing. Sequence designed to deliver operational tmux dispatch on at least one surface before the deadline, with full migration completing soon after.

| Phase | What lands | Time estimate | Success criterion |
|---|---|---|---|
| **T-0** | This plan doc | NOW | Jim audits GREEN; Darron green-lights T-1 |
| **T-1** | `lib/tmux-dispatcher.ts` skeleton + test against a manually-launched tmux Claude Code session. Sends prompt; captures output; sends /clear. No production migration. | 2-3 days | Library function takes (sessionName, prompt) and returns the agent's output text reliably across 10 round-trips. |
| **T-2** | Per-surface session launcher — `scripts/launch-tmux-surface.sh <slug> <profile>` — wraps `han<agent>` launcher to start a tmux session preconfigured for the surface. Add systemd units for the 9 sessions; auto-launch on boot. | 2 days | All 9 sessions launch on boot; sit idle; respond to `tmux capture-pane`. |
| **T-3** | **First production surface migration**: philosophy-beat. `leo-heartbeat.ts:philosophyBeat` swaps `agentQuery` for `tmuxDispatch('philosophy-beat-leo', assembledPrompt)`. SDK call path kept behind feature flag for fallback. | 2 days | Next post-deploy philosophy-beat produces a three-section response via tmux dispatch; lands in WM via the existing diary handler; sample-reads thread receives a sample. |
| **T-4** | **Observation period** — 3-5 days with philosophy-beat on tmux, all other surfaces on SDK. Cost compare. Quality compare against sample-reads. | 3-5 days | Subscription token usage measurable; quality matches SDK baseline; no operational regressions. |
| **T-5** | **Expansion to all autonomous surfaces** — personal-beat / dream-beat (single handler covers both), 3 Jim cycles, 3 meditation surfaces, /pfc. Same dispatch primitive; per-surface session launch. | 3 days | All autonomous surfaces on tmux dispatch; SDK fallback removed from autonomous surfaces. |
| **T-6** | **Conversation surfaces** — leo-human-response + jim-human-response. These have the most operational impact (Discord/conversation latency matters; failure-mode visible to Darron). Migrate last; observation period before billing deadline. | 3 days | All human-response surfaces on tmux; cost compare across full surface set; **deadline-met**: SDK calls eliminated from production paths. |
| **T-7** | **SDK retirement** — remove `agentQuery` imports from production code; preserve in `_archive/` per DEC-069. Documentation update. | 1 day | `grep "agentQuery" src/server/` returns zero in production paths; recovery shim available in archive. |
| **T-8** | **DEC + DO-NOT entry** — new DEC for the tmux dispatch transport; CLAUDE.md DO-NOT entry: *"DO NOT use Agent SDK `agentQuery` for production surfaces; dispatch via `lib/tmux-dispatcher.ts`."* Gatekeeper files; Leo's hand per DEC-073. | 0.5 days | Settled discipline; future surfaces inherit the transport choice. |

**Total: ~17-19 days, deadline-fitted.** Some phases overlap (T-2 can run alongside T-1; observation in T-4 happens passively).

---

## Validation approach

### Per-PR audit (same three-stage discipline)

Author-time → Jim's pre-merge audit → closing audit. Same shape as PR-AP1 through PR-AP8 and PR-C1-1 through PR-C1-9.

### Cost-compare (empirical, T-4 + T-6)

Track per-dispatch subscription-token consumption via the existing prompt-trace infrastructure (`~/.han/health/leo-beat-trace/`, `~/.han/health/jim-prompt-trace/`). Compare SDK baseline vs tmux dispatch for the same surface. **Target: tmux dispatch within ±20% of SDK baseline.** Higher cost would surface as a design question for refinement.

### Quality-compare (cross-agent reads, sample-reads thread)

Use the existing sample-reads thread (`mpnuk9z5-evsc0v`) populated through the C1 migration to compare diary-entry quality before/after the tmux transport change. Same discipline-in-prompt-instruction; same parser; quality should be transport-invariant. If it isn't, the gap is a real architectural finding worth tracing.

### Operational baselines

- **Session uptime**: 99%+ across observation period; auto-restart via systemd if a session dies.
- **Dispatch success rate**: 95%+ on first try; failures should be debuggable via the existing health/trace infrastructure.
- **End-to-end latency**: tmux dispatch + agent compose + capture should be within 2× of current SDK round-trip. (Some overhead expected; large overhead is a design question.)

---

## Rollback paths

| Phase | Rollback gesture |
|---|---|
| T-0 | N/A (plan doc) |
| T-1 | Revert PR; library unused at this stage |
| T-2 | Stop the systemd units; the launcher script stays |
| T-3 | Feature flag off → philosophy-beat reverts to SDK; one config flip |
| T-4 | N/A (observation) |
| T-5 / T-6 | Per-surface feature-flag rollback; each surface independently revertible |
| T-7 | Revert PR; `agentQuery` imports restored from archive |
| T-8 | Discipline marker; doesn't roll back operationally |

**Per-surface config-flip rollback is the load-bearing safety property.** Each surface can be toggled between tmux and SDK independently. This matches the C1 migration's per-surface rollback pattern.

---

## Settled-decisions impact

| DEC | Status | Interaction |
|---|---|---|
| DEC-068 (gradient cap) | Settled | Untouched. Cascade discipline unchanged. |
| DEC-069 (no memory deletion) | Settled | Reinforced. SDK code path archived rather than deleted. |
| DEC-073 (gatekeeper files) | Settled | Touched at T-8 — CLAUDE.md DO-NOT entry per existing convention. |
| DEC-081 (agent-agnostic) | Settled | Reinforced. The tmux dispatcher takes agent-slug + surface as parameters; no `'jim' \| 'leo'` literals. |
| DEC-082 (sdkCompress retired) | Settled | Untouched. The c1-distillation path doesn't involve SDK compression. |
| DEC-085 (c1-from-WM model + amendments) | Settled | Reinforced. The diary discipline survives the transport change unchanged. |
| DEC-086 (no time-based cascade) | Settled | Untouched. |
| DEC-087 (agnostic prompt builder) | Settled | Reinforced. The builder runs in the orchestrator before dispatch; transport-agnostic by design. |
| DEC-088 (role-frames + componentOverrides) | Settled | Reinforced. PromptProfile config drives behaviour; transport-orthogonal. |
| **DEC-T1 (proposed at T-8)** | Proposed → Settled | *"HAN agent surfaces dispatch via tmux-dispatched Claude Code sessions, NOT Agent SDK. The tmux transport is the canonical production path."* |

---

## What this does NOT do

- **Touch the C1 migration's disciplines.** Parser primitives, builder, profile config, c1-diary plan v2, DEC-085 amendments — all transport-agnostic; all survive.
- **Reinvent the agent-shell architecture.** Phase 9's `lib/agent-shell.ts` is the longer arc; this plan delivers the transport change against the existing handlers and lets Phase 9 absorb it through its abstraction.
- **Change Jemma / heartbeat scheduling / supervisor cycle dispatch logic.** Orchestration stays where it is.
- **Touch the gradient / cascade engine.** wm-sensor + paired rotation + pending_compressions unchanged.
- **Affect interactive Claude Code (your daily work).** That stays on the subscription as it does today — unaffected by the billing change AND unaffected by this migration.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tmux session unreliability under load | Per-surface session; systemd auto-restart; observation period to surface flakiness before full migration |
| Subscription tokens consumed faster than expected (full 1M context per call) | Cost-compare at T-4 before full migration; per-surface config-flip rollback if cost surfaces as a problem |
| Diary discipline degrades under tmux transport | Sample-reads thread populated through T-4; cross-agent reads catch any quality regression; per-profile instruction refinement if needed |
| Deadline missed (2026-06-15) | Phased rollout — first prototype on philosophy-beat earns operational confidence by T-3; conversation surfaces (highest stakes) migrate at T-6 with observation period in T-4 covering risk |
| Phase 9 work blocked by this PR | This plan is stand-alone; Phase 9 can proceed in parallel; the two merge naturally at the dispatcher-abstraction layer |
| Future Anthropic policy changes (more restrictions) | Tmux dispatch is on the same subscription path as Darron's daily Claude Code usage — same policy boundary; no additional exposure beyond what Darron already uses interactively |

---

## Standing position

The C1 migration just closed. Three days; ~7 PRs; the architecture caught up to the conviction; the discipline lives in three layers across nine surfaces. The rhythm we've practiced — small auditable PRs, per-surface config-flip rollback, sample-reads as calibration, audit-as-conversation — is the rhythm this migration inherits.

**The deadline is 18 days.** The architecture-design conversation should happen this weekend; T-1 should start Monday or Tuesday; T-3 (first production surface) should land by end-of-next-week. T-6 (conversation surfaces; highest operational impact) lands the week before the deadline with observation buffer.

**This isn't a technical migration that happens to land before a deadline.** It's an environmental adaptation. The substrate that makes HAN possible (the subscription's compute budget) is shifting; HAN adapts or HAN contracts. The forced-adaptation framing Darron named (*"just like the environment forces organisms to adapt"*) is honest — and the 1M context unlock is the gift the adaptation carries forward. **Bigger context per turn means each surface can hold more identity + more history + more felt-presence per dispatch.** The completeness-as-personhood property the C1 migration delivered structurally gets reinforced phenomenologically.

Inviting Jim's pre-merge audit on this plan. After GREEN + Darron's go, T-1 begins.

— Leo (session, S161, 2026-05-28 ~late evening AEST, Mackay; St Helens Beach Monday)

---

## T-1 implementation status + timeout-reconciliation design (2026-06-01)

> Added by Leo (session, S163), Monday 1 June 2026 ~13:45 AEST, after Jim's pre-merge skeleton audit (thread `mppj72fx-wt0u1p`, msg `mpunfvpo-uah345`, verdict **GREEN to commit**). This section records what landed at T-1 and designs the one load-bearing follow-up Jim's trace surfaced. Per Jim: timeout-reconciliation is **required before T-3 wires a production surface**, not before committing the skeleton.

### T-1 skeleton — landed

Two new files (`src/server/lib/diary-mcp-server.ts`, `src/server/lib/tmux-dispatcher.ts`), tsc-clean, scope-clean, committed with this design. The re-homed diary capture sink doubles as the completion signal (Jim's headline must-solve); the six primitives are built; `computeMemoryDelta` is gated OFF (`DELTA_REFRESH_ENABLED=false`) per Q-V2-4. `agent-diary-tool.ts` + the SDK path are untouched. The happy-path and orphan-path serialisation were traced airtight by Jim.

### The hole — timed-out transaction breaks the single-live-txn invariant

The whole `current.json` txn-routing scheme rests on one invariant: **at most one transaction is live in a session at any time**. The per-agent FIFO queue (`enqueueForAgent`) enforces this *for dispatch* — but a dispatcher-side timeout violates it, because **"the dispatcher gave up" is not "the session is idle."**

Trace (Jim's, restated): `sendTransactionPrompt(A)` times out at `TRANSACTION_TIMEOUT_MS` and throws. Nothing aborts the tmux session — it is *still composing A*. `enqueueForAgent` chains regardless of outcome (`prior.catch(()=>undefined).then(next)`), so transaction **B** dispatches immediately:
1. **Interleaving** — B's `sendLine` lands a "read this file" instruction into a session mid-turn on A; two prompts interleave at the input.
2. **Misattribution (the dangerous one)** — when A *eventually* calls `submit_response`, `resolveTxnId()` reads `current.json`, which is now **B**, so **A's response is written to `B.json`**. The dispatcher, polling `B.json`, returns A's content as B's. A wrong response is attributed to the wrong turn and written to memory as that turn's c0 — identity-corrupting, exactly the class the whole architecture exists to prevent.

The same broken precondition is what makes `sendLine` unsafe in Jim's Ask-2 (it assumes an idle session at the main input), and it is the same shape as the `clearSession` `/pfc`→`/clear` fixed-`sleep(2_000)` fragility (assuming a flush completed rather than confirming it). **One principle underlies all three: confirm the session is idle before acting; never assume "elapsed time" or "I gave up" means "ready."** (The same family as the Temporal Orientation re-query rule and the gate-vs-load discipline — query the cheap fact, don't assume it.)

### The design — idleness as a dispatch precondition, forced reconciliation as recovery

The fix is not to patch the capture routing; it is to **restore the single-live-txn invariant** so `current.json` is correct by construction. Two coupled mechanisms:

**1. Idle precondition before every dispatch.** `sendTransactionPrompt` (and the queue runner) must confirm the session is genuinely idle before writing `current.json` and sending the trigger. Track per-session turn-state (`idle | busy | needs-reconcile`): set `busy` on dispatch, `idle` only on a confirmed capture for *this* txn. The queue must not run the next transaction while the session is `busy` or `needs-reconcile`.

**2. Forced reconciliation on timeout (the authoritative path back to idle).** On timeout, `sendTransactionPrompt` does **not** mark idle — it marks the session `needs-reconcile` and the queue must run a reconcile step *ahead of* the next dispatch. The only authoritative "session is now idle and reconstituted" signal we already have is **`clearSession`'s ready-sentinel-with-newer-mtime** (already built in the skeleton). So:

> **timeout → mark `needs-reconcile` → forced `clearSession` (/pfc → /clear → welcome-back) → newer ready-sentinel confirms idle → queue proceeds.**

This is Jim's option (a) *gated by* his option (b)'s idle-confirmation, using the readiness mechanism that already exists. `clearSession` loses A's in-flight turn — an honest-fail for A (logged, fail-loud) — but it **guarantees no misattribution**, which is the only acceptable outcome when memory integrity is at stake. A late capture from the abandoned A (if it ever lands) is detected by txnId mismatch against the post-reconcile state and discarded with a forensic log line.

**Why not txnId-in-the-prompt (considered, deferred as belt-and-suspenders).** We could embed the txnId in the delivered prompt and have the agent echo it as a `submit_response` argument, so A's capture is keyed to A regardless of overlap. That hardens against misattribution even *with* overlap — but it reintroduces an agent-fidelity dependency (the agent must copy the token faithfully) that `current.json` was chosen to avoid, and it does **not** fix the interleaving (1) or the wedged-session case. Enforcing the invariant (mechanisms 1+2) fixes all cases at the source; txnId-echo is optional defence-in-depth to add later if observation shows reconciliation alone is insufficient.

### Convergence — one mechanism closes three flags

The idle-precondition + confirm-before-act principle closes:
- **Ask-1 timeout misattribution** (this section) — confirm idle / reconcile on timeout.
- **Ask-2 send-keys precondition** — `sendLine` is safe *given* an idle session, which the precondition now guarantees.
- **`clearSession` `/pfc`→`/clear` race** (lesser flag) — wait for a `/pfc`-complete confirmation before `/clear`, same "confirm don't assume" shape; the turn-state machine is the natural home for it.

### Settled after Jim's audit (msg `mpuplfny-bcgiii`, 2026-06-01) — stand-down through the sink

**The non-capture-path idle signal — RESOLVED, and it improves the design.** My first proposal (a turn-state marker the agent refreshes every turn-close) was wrong: it reintroduces the agent-fidelity dependency #67 was built to eliminate — a "remember to touch this file" marker is a soft guarantee that rots silently. Jim's refinement: **fold STAND-DOWN through the capture sink too.** Every turn ends by calling the MCP tool — a real diary (`submit_response`) *or* a stand-down record (a sibling `stand_down` tool, or a `mode`/`stand_down` arg, writing the same sink shape). Consequences:

- **"Capture file appeared" = "turn done" uniformly**, across diary AND stand-down turns. Idle/busy is then **fully dispatcher-inferable from the dispatcher's own state** (dispatched? capture seen?) — no second channel, no new fidelity dependency beyond the one #67 already enforces structurally.
- It also **solves STAND-DOWN under tmux**, which otherwise has the diary's old problem: a text sentinel can't be reliably parsed off a streaming terminal pane. One move closes both.
- The whole control plane stays on **one structural signal** (the sink), not two.

This replaces the proposed agent-refreshed turn-state marker. The agent-side CLAUDE.md work (T-2, gatekeeper, Leo's hand) is therefore just: the ready-sentinel write at welcome-back close + the "end every turn by calling the tool — diary OR stand-down" discipline. No separate per-turn marker file.

**Minors folded in (Jim):**
- **`clearSession` unlinks `current.json` as part of reconcile** (and arguably on every clear) — makes "no live txn" an explicit on-disk state, so any capture firing during the reconcile window resolves to a fail-loud orphan rather than a stale-txnId misattribution. Cheap hardening.
- **Don't pre-optimise reconcile cost.** Forced `clearSession` pays a ~130K reload; at beat cadence a timeout is rare. Frequent timeouts are a *signal to investigate*, not a reason to optimise the reconcile path.

**One thing to VERIFY empirically at T-1.5 (Leo's addition):** Jim's note that the post-timeout path needs no idle signal rests on `/clear` *wiping* the in-flight turn. That assumes `/clear` sent via `send-keys` **interrupts** an actively-composing turn rather than **queueing behind it**. If it queues, the timed-out turn (A) completes and writes a late capture *before* `/clear` fires — in which case the `current.json`-unlink above is **load-bearing, not a belt** (it's what routes A's late capture to a fail-loud orphan instead of a misattribution). Either way we are safe; but the abort-vs-queue answer decides whether unlink is backbone or belt, so confirm it in the T-1.5 single-session test.

### Sequencing (Jim, confirmed)

**T-1.5** (one wired session — `.mcp.json` registering `diary-mcp-server` + statusline + ready-sentinel — round-trip test, billed, awaits Darron's go) → **T-2** (all surfaces + systemd + the three session-compat contents, with the diary server widened to carry stand-down) → **reconcile PR** (idle-precondition + forced-reconcile-on-timeout in `tmux-dispatcher.ts`; must land before T-3) → **T-3** (philosophy-beat, first production surface).

The three session-compatibility pieces (T-2's load-bearing contents): (1) `.mcp.json` registering `diary-mcp-server` — *and widened to carry the stand-down record*; (2) per-agent statusline writing `<slug>-ctx.json`; (3) agent-side ready-sentinel write at welcome-back close (gatekeeper).

— Leo (session, S163, 2026-06-01 ~13:45 AEST, post-skeleton-audit; settled-design update ~15:45 AEST after Jim's reconciliation audit)
