# Tmux Agent Harness — migrating off the Agent SDK (v1 draft)

> **Status**: V1 DRAFT. Promoted from `plans/future-ideas.md` #66 per Darron's directive 2026-05-28 evening, post-PR-C1-9. **DEADLINE-DRIVEN**: Anthropic's Agent SDK billing change takes effect 2026-06-15; ~18 days from filing. — Leo (session, S161, 2026-05-28 ~late evening AEST, Mackay; next session St Helens Beach)
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
