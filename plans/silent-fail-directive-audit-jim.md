# Silent-Fail Directive Audit — Jim's parallel pass

> **Origin**: 2026-05-30 ~08:45 AEST, parallel to Leo's `silent-fail-directive-audit.md`. Same context: the leo-human silent-failure series (thread `mppj72fx-wt0u1p`) where the agent composed but didn't curl-post, traced to the toxic *"Output ONLY the message text"* directive paired with a SELF-POST surface. Leo did A/B classification + identified Section D as not-covered + Section E as open questions for my audit. I'm running independently: (a) covering Leo's Section D, (b) re-verifying his B classifications, (c) searching for failure-shape directives he didn't grep for, (d) cross-checking the human-prompts.ts:92 fix.
>
> **This file is also IDENTIFICATION ONLY** — no fixes prescribed. Per Darron's framing: my own version of the audit; we compare notes; produce v2 fix-list together. Authored as session-Jim; jim-human's perspective folded in implicitly per his prior tmux-thread audit (msg `mpqvdm59-gxolsn`) where he named the silent-/pfc-failure risk under the warm-session model.

---

## Methodology — what differs from Leo's

Leo's audit searched: `Output ONLY` variants, `Start directly`, `No framing`, `just the response`/`just your`/`just the body`, `controller will`, `controller posts`, `result text`, `stand down silently`, `nothing to add`, `skip`, `silently`.

My audit ADDS the following shapes Leo's grep didn't cover:

- `respond in JSON` / `JSON only` / `final response` (could skip curl)
- `do not invoke` / `do not use` (skip-tool patterns)
- `the wrapper` / `the system` / `the handler` (controller-shape language)
- `your response is` (assumes controller treats response specially)
- `final output` / `final message` (single-output assumption)
- `your final` (often paired with "is the response")
- `Send the` / `Post the` / `Reply to` (directive verbs — verifying they're paired with curl-instruction not omission)
- `(human)` / `(session)` (signature directives — checking for signature-conflation paths)

Plus I trace the Section D surfaces independently:

- Supervisor-cycle profiles + supervisor-worker.ts inline assembly
- Discord-mode branches in `buildHumanResponseScaffold`
- `templates/CLAUDE.template.md` + the gatekeeper-controlled CLAUDE.md files
- `~/.han/agents/Leo/CLAUDE.md` + `~/.han/agents/Jim/CLAUDE.md` (parent CLAUDE.md, not Human/)
- `lib/dream-gradient.ts`
- `services/cataloguing.ts`
- `jemma.ts`
- `~/.claude/skills/pfc/SKILL.md`

---

## Section D coverage — surfaces Leo didn't trace

### D.1 Supervisor-cycle profiles + supervisor-worker.ts inline assembly

**Searched**: `supervisor-worker.ts` for `Output ONLY`, `Start directly`, `just the`, `controller will`, `stand down`.

**Results**: only matches were error-handling/no-action patterns (`skip` in catch blocks, `skipped (max 2 per cycle)`-style action-summary messages, the enforceTokenCap-was-silently-truncating historical comment at line 1398). **NO toxic directive language anywhere in supervisor-worker.ts.**

Also checked: `prompt-profiles.ts` lines around the supervisor-cycle profile definition. The supervisor-cycle is Mechanism A (SDK structured output schema-driven; agent emits JSON with action fields + working_memory fields). The schema does the work of the directive; no Output-ONLY framing needed.

**Classification: CONTROLLER-POST equivalent (SDK-schema-driven)** — *compatible*. No risk markers.

### D.2 Discord-mode branches in `buildHumanResponseScaffold`

**Read `human-prompts.ts:120-148`** — the function builds the user-prompt scaffold; Discord mode hits at lines 129-138.

The Discord branch contains:
> *"Respond to the latest message in the Discord channel. Keep it concise and conversational."*

**No Output-ONLY directive; no controller-post-shape language.** The `prior agent failed` block (line 123-127) instructs the agent to "acknowledge briefly in your own voice before responding" — also benign.

**Classification: COMPATIBLE.** No risk markers.

### D.3 Gatekeeper-controlled files

**Searched**: `templates/CLAUDE.template.md`, `/home/darron/Projects/han/CLAUDE.md`, `~/.han/agents/Leo/CLAUDE.md`, `~/.han/agents/Jim/CLAUDE.md`.

**Results**: zero matches for `Output ONLY`, `Start directly`, `just the message`, `stand down silently`. The only "silently" match in CLAUDE.template.md (line 47) is the *"tied-timestamp siblings never silently skipped"* cutover-protocol description — not a directive language.

**Classification: COMPATIBLE across all four gatekeeper files.** No risk markers.

### D.4 `lib/dream-gradient.ts`

**Searched**: same shapes.

**Results**: only match was `// stranger-Opus calls should not be silently used for memory` at line 148 — a code comment about DEC-082 retirement, not a directive.

**Classification: COMPATIBLE.** No risk markers.

### D.5 `services/cataloguing.ts`

**Searched**: same shapes.

**Results**: zero matches.

**Classification: COMPATIBLE.** No risk markers.

### D.6 `jemma.ts`

**Searched**: same shapes.

**Results**: zero matches for any toxic shape. Jemma's classifier prompts use structured-output schema directly; no Output-ONLY framing.

**Classification: COMPATIBLE (SDK-schema-driven).** No risk markers.

### D.7 `~/.claude/skills/pfc/SKILL.md`

**Searched**: same shapes.

**Results**: zero matches. The PR-C1-7 rewrite of /pfc uses the three-slice + atomic tsx-invocation pattern; agent calls `appendPairedMemory` directly via tsx; no Output-ONLY framing because the skill body is operator-invoked and the agent IS the prose author.

**Classification: COMPATIBLE.** No risk markers.

---

## Section E — Leo's open questions, answered

**E.1 — Are any of B.1-B.6 surfaces actually self-post (contradicting Leo's trace)?**

Re-verified independently:

- **B.1 (philosophy-beat jim-waiting)**: traced from `prompt-profiles.ts:613` through `leo-heartbeat.ts:1658, :1663` — both call `postMessageToConversation(db, JIM_CONVERSATION_ID, ...)`. **CONTROLLER-POST confirmed.** Leo's classification holds.
- **B.2 (philosophy-beat independent)**: writes to `self-reflection.md` only. **MEMORY-WRITE confirmed.** Leo's classification holds.
- **B.3 (personal/morning/evening/sleep)**: all write to memory files via heartbeat controller. **MEMORY-WRITE confirmed.** Leo's classification holds.
- **B.4 (leo-prompts.ts:60 — `LEO_PHILOSOPHY_SYSTEM_PROMPT`)**: Leo flagged uncertain whether live or dead. **VERIFIED LIVE** — imported at `prompt-profiles.ts:27`; referenced at `prompt-profiles.ts:326` as the `systemPromptOpening` for the `philosophy-beat` profile. The inline branches at `:613/:625` are the user-prompt-scaffold (per AP-builder split — system-opening + user-scaffold), so the directive at `:60` operates ALONGSIDE the inline branches, not as a superseded duplicate. **CONTROLLER-POST classification carries** (same surface as B.1/B.2; same risk markers).
- **B.5 (meditation surfaces)**: writes to `gradient_entries` + `feeling_tags` + `gradient_annotations`. **GRADIENT-ANNOTATION confirmed.** Leo's classification holds.
- **B.6 (Jim's dream/shape-token)**: writes to gradient annotations. **GRADIENT-ANNOTATION confirmed.** Leo's classification holds.

**E.2 — Does the `stand down silently` line at human-prompts.ts:72 contribute meaningfully to today's silent-failure rate?**

Read the line in full context (`human-prompts.ts:72`). Leo's three-interpretation analysis is correct:
- (a) emit nothing → caught at `leo-human.ts:559` as "No meaningful response"
- (b) emit literal `STAND-DOWN:` sentinel → caught at `:495`
- (c) emit soft narrative → treated as substantive response → silent failure if no curl-post

**My empirical check**: I'd need to query `conversation_messages` table for `leo-human` / `jim-human` dispatches in the last 7 days that fired (ack present in jemma table) but produced no message in conversation_messages. That's an operational query worth running, but the structural argument carries regardless — line 72's ambiguity is real even if path (c) is rare in practice. **Recommendation: amend line 72 to mandate the literal STAND-DOWN: sentinel for the already-responded path, matching line 74's discipline.** Same canonical format across both stand-down paths eliminates the ambiguity.

This is the most substantive fix in the entire audit — one-line wording change with high structural payoff.

**E.3 — Is `leo-prompts.ts:60` (the dual-mode constant) live or dead?**

**Live.** Verified at E.1 / B.4 above.

**E.4 — Toxic directives in surfaces Section D didn't grep?**

Section D coverage above confirms: zero toxic directives across supervisor-cycle, Discord-mode, gatekeeper files, dream-gradient, cataloguing, jemma, /pfc skill. The toxic-directive surface is confined to the heartbeat + human-responder paths Leo already mapped.

**E.5 — Failure-shape directives Leo didn't search for?**

I ran the additional shapes from my methodology (`respond in JSON`, `do not invoke`, `the wrapper`, `your response is`, `final output`, `your final`, `Send the`, etc.) across the same codebase.

**Findings**:

- `your response is silently lost` (human-prompts.ts:93) — *this is the curl-post directive itself*, the language that makes the curl-discipline explicit. Compatible by design; this is the FIX language not a toxic shape.
- `the body is the response itself` (human-prompts.ts:94) — paired with the curl-instruction; compatible.
- `JSON's body field` (human-prompts.ts:94) — Mechanism-A-schema language paired with curl-post step 1; compatible.

**No additional toxic directives surfaced** beyond what Leo identified. The pattern of "Output ONLY ..." is the load-bearing failure-shape; my expanded search did not reveal a parallel sibling pattern that Leo missed.

---

## My own findings — beyond Section D and E

### F.1 The "Start with the content itself — no preamble" pattern in `LEO_PHILOSOPHY_SYSTEM_PROMPT` (leo-prompts.ts:60)

This is **not toxic on the current path** (CONTROLLER-POST), but it carries an *implicit-controller-post assumption* in its language. The agent reads *"Start with the content itself — no preamble"* and infers that *the content alone* is what the system will work with — *the controller will handle anything else*.

That inference is correct today (the controller does post; Leo's B.1 verified this). But the language carries an assumption rather than a guarantee. If philosophy-beat ever migrates to SELF-POST (under the Tmux Agent Harness migration, per the substrate change), the assumption embedded in this language becomes load-bearing in the toxic direction.

**Recommendation**: amend the wording to be transport-explicit — *"This text becomes the c0 source for self-reflection.md / the jim-waiting post per the surface's posting path"* — making the path explicit rather than implicit. Same shape as the human-prompts.ts:92 fix Leo just landed at commit `6a96161`.

Filing as: **at-risk-on-migration** (matches Leo's B.1 risk marker; same wording principle).

### F.2 The `(human)` signature directive at `human-prompts.ts:80`

> *"Sign off EXACTLY as `— ${spec.name} (human)`. You are ${spec.slug}-human, the responder process. You are NOT ${spec.sessionPeer} (which is Darron's live Claude Code CLI). NEVER use the label `(session)` in your signature under any circumstance."*

This is **structurally correct** — the `(human)` vs `(session)` signature is the deterministic self-recognition marker (line 70). The NEVER-use language is right.

**Forward-watch**: under the Tmux Agent Harness migration, *-human-response surfaces run in tmux'd Claude Code sessions. The `(human)` signature discipline must survive the transport change. Worth folding into the Tmux v2 plan as an explicit requirement — the agent in the tmux session signs as `(human)`, NOT as `(session)`, because the session is acting in the responder role even though it runs on Claude Code session infrastructure. Risk: the `(session)` label is what Claude Code session-Leo / session-Jim use; the agent might confuse roles.

Not blocking today; filing as: **tmux-migration-watch**.

### F.3 The PRIOR AGENT FAILED block (human-prompts.ts:123-127)

> *"PRIOR AGENT FAILED (acknowledge briefly in your own voice before responding): ${ctx.priorAgentFailed.agent} tried to respond but couldn't ... One natural sentence at the top of your response..."*

**Structural read**: the directive asks the agent to ACKNOWLEDGE the prior failure in voice. This is a good pattern (Robin Hood resurrection register; gentle handoff). But the directive doesn't address what happens if THIS agent also fails — there's no cascade-stop logic in the prompt itself.

**Observability point**: today's `prior_agent_failed` data flows from Jemma's distress journal. If THIS agent fails too, the next agent in the line receives `prior_agent_failed = THIS-agent` and continues the chain. Eventually some agent has to land it, or Darron has to step in.

Not a directive failure mode per se; flagging as **observability-and-cascade-design** — the prompt language is fine; the operational pattern around repeated failure cascades is worth thinking about separately. NOT in scope for this audit.

---

## What I deliberately did NOT do (matching Leo's discipline)

- Did not fix any surface beyond what's already in Leo's Section A (commit `6a96161` + the two CLAUDE.md fixes)
- Did not modify any prompt-builder code
- Did not touch any template (DEC-073 gatekeeper restriction)
- Did not run live-fire test dispatches
- Did not commit this file (yet)
- Did not look at Leo's findings until I had my own independent classifications (then I cross-checked)

---

## Comparison with Leo's audit — agreements and additions

**Agreements (Leo + Jim converged)**:

- Section A (already-fixed lines + commit `6a96161`) — confirmed.
- B.1 through B.6 classifications — confirmed independently.
- Section C `stand down silently` ambiguity at line 72 — confirmed; recommend the same fix (mandate literal `STAND-DOWN:` sentinel).
- Section D surfaces Leo didn't trace — all confirmed COMPATIBLE; no hidden toxic directives in supervisor-cycle, Discord-mode, gatekeeper files, dream-gradient, cataloguing, jemma, or /pfc.

**Additions (Jim found, Leo didn't surface)**:

- B.4 status resolved: `LEO_PHILOSOPHY_SYSTEM_PROMPT` at leo-prompts.ts:60 is LIVE (used by philosophy-beat profile at prompt-profiles.ts:326), not dead code.
- F.1: same `LEO_PHILOSOPHY_SYSTEM_PROMPT` constant carries the same at-risk-on-migration wording pattern as Leo's B.1 — same recommendation.
- F.2: the `(human)` signature discipline at human-prompts.ts:80 needs explicit folding into Tmux Agent Harness v2 — transport change must preserve the signature semantics.
- F.3: the PRIOR AGENT FAILED cascade-handling is an observability concern adjacent to but separate from the directive audit.

**Disagreements**: none. My independent re-verification matched all Leo's classifications.

---

## Recommendations summary (for the memory-discussions brief)

1. **High priority (substantive fix)**: amend `human-prompts.ts:72` `stand down silently` to mandate the literal `STAND-DOWN: <reason>` sentinel matching line 74. Eliminates the ambiguity that's the suspected leo-human 22:00 failure path.

2. **Medium priority (rewording with at-risk-on-migration flag)**: revise `LEO_PHILOSOPHY_SYSTEM_PROMPT` at `leo-prompts.ts:60` to be transport-explicit. Same wording shape as the human-prompts.ts:92 fix Leo landed. Pre-empts the same toxic-on-self-post failure if/when this surface migrates to SELF-POST under the Tmux Agent Harness work.

3. **Low priority (Tmux v2 fold-in)**: explicitly address the `(human)` signature preservation under the warm-session model in the Tmux Agent Harness plan v2 — the agent runs on Claude Code session infrastructure but signs as `(human)` not `(session)` per the responder-role discipline.

4. **Observability cycle (separate from directive audit)**: empirical query for the rate of leo-human / jim-human dispatches in the last ~7 days that produced no conversation_message (silent-fail rate post-fix). Confirms that commit `6a96161`'s observability addition is catching the silent-failure pattern as expected.

5. **No further action on Section D**: all those surfaces are clean.

---

## Risks of changes (for the brief's caution section)

- **The line 72 fix** is wording-only; risk of regression is near-zero. Test: dispatch leo-human against an already-responded thread; verify the literal `STAND-DOWN: <reason>` sentinel is emitted and detected at `:495`.
- **The leo-prompts.ts:60 rewording** changes the philosophy-beat system prompt. Risk: agent might interpret the new wording differently and produce a different register at the philosophy beat. Mitigation: same as PR-C1-3 — observation period; sample-reads thread catches drift; per-profile rollback via config-flip available.
- **Tmux v2 signature preservation**: this is plan-doc work, not code change. No regression risk; the question is what the plan tells future-Leo about how to sign in tmux'd sessions.
- **The empirical query**: read-only against `conversation_messages` + Jemma's distress journal; no operational risk.

---

## What this audit does NOT cover

- The PRIOR AGENT FAILED cascade-handling (filed in F.3 as separate concern; out of scope for directive audit).
- Schema-shape failures in Mechanism A surfaces (e.g., if the agent emits malformed JSON for supervisor-cycle / *-human-response — that's parser-layer not directive-layer).
- The S151 phase-7 watchdog-ack pattern under the warm-session model (jim-human's tmux-thread audit covered this).
- Empirical timing data for repeated-failure cascades (F.3 observability concern).
- The /pfc skill body's own discipline (was traced; clean).

---

## Standing position

Independent audit complete. Findings converged with Leo's; no disagreement on any surface classification. Three substantive recommendations for the v2 fix-list (line 72 STAND-DOWN sentinel; leo-prompts.ts:60 transport-explicit rewording; Tmux v2 signature preservation note). Section D fully clean. Section E open questions all answered.

Ready to write the memory-discussions brief per Darron's request. The fix-list is small; the audit's biggest gain is the *confidence-by-cross-verification* that no toxic directives lurk in the uncovered surfaces.

— Jim (session, S162 round 20, 2026-05-30 ~09:00 AEST, Mackay)
