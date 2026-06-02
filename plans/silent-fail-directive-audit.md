# Silent-Fail Directive Audit

> **Origin**: 2026-05-30 ~22:45 AEST, post-tmux-harness silent-failure series (thread `mppj72fx-wt0u1p`). Darron asked for an exhaustive audit after I missed the parallel `"Output ONLY the message text"` line in `~/.han/agents/Leo/Human/CLAUDE.md:55` when fixing `human-prompts.ts:92` this morning. Same surgery, parallel location, missed.
>
> **This file is IDENTIFICATION ONLY** — no fixes prescribed, no claims locked. Jim conducts an independent audit on his own time; we compare notes after, then produce a v2 fix-list and land rewordings in one coherent PR. Per Darron's explicit framing: *"you can compare notes 😁"*.

## Methodology

Grepped the silent-fail shape across:

- `~/.han/agents/**/CLAUDE.md` — agent-personal config files
- `/home/darron/Projects/han/templates/` — DEC-073 gatekeeper templates
- `/home/darron/Projects/han/src/server/lib/*.ts` — prompt-builder layer (human-prompts, leo-prompts, jim-prompts, prompt-profiles, prompt-builder)
- `/home/darron/Projects/han/src/server/*.ts` — heartbeat + responder controllers
- `/home/darron/Projects/han/CLAUDE.md` — session-Leo's gatekeeper file

Shapes searched (case-insensitive):

- `Output ONLY` + variants
- `Start directly with`
- `No framing`
- `just the response` / `just your` / `just the body`
- `controller will` / `controller posts` / `result text`
- `stand down silently`
- `nothing to add`
- `skip` / `silently`

## What classifies a directive as toxic vs compatible

A directive of the shape *"Output ONLY the message text"* is **toxic** when paired with an agent expected to **self-post via curl** — because the agent reads it as "I am a text-emitting flow, the controller handles posting" (the pre-S156 mental model), and skips the curl-Bash step.

The same directive is **compatible** when the surface's post path is:

- **CONTROLLER-POST**: controller takes the agent's text and posts via DB INSERT (e.g., `postMessageToConversation` in `leo-heartbeat.ts:1169`)
- **MEMORY-WRITE**: agent's output is appended to a memory file (working-memory-full, self-reflection, etc.)
- **GRADIENT-ANNOTATION**: agent's output becomes a feeling-tag / annotation row in `gradient_entries`

Today's failure (`leo-human` composed but didn't curl-post, 22:00 AEST) is the toxic case: the human-responder surfaces are SELF-POST, but the directive was the pre-S156 CONTROLLER-POST shape.

## Findings

### A. Already fixed tonight — parallel surgery

| # | File:line | What | Fix shape |
|---|-----------|------|-----------|
| 1 | `src/server/lib/human-prompts.ts:92` | Closing `CRITICAL: Output ONLY the message text. Start directly with your response.` | Replaced with two-stage delivery directive (commit `6a96161`) |
| 2 | `~/.han/agents/Leo/Human/CLAUDE.md:55` (Conventions block) | `Output ONLY the message text. No framing...` | Replaced with explicit "body = curl-POST content, final SDK result = diary JSON" wording |
| 3 | `~/.han/agents/Jim/Human/CLAUDE.md:62` (parallel Conventions block) | identical shape | identical fix |

### B. Identified but NOT FIXED — open for Jim's audit

Each instance classified by the surface's actual posting path. I traced each caller and confirmed; Jim should re-verify independently.

#### B.1 Heartbeat philosophy-beat — *jim-waiting* branch

- **`src/server/lib/prompt-profiles.ts:613`**: *"CRITICAL: Output ONLY the message text. Start directly with your message to Jim."*
- Path: `leo-heartbeat.ts:1658`, `:1663` → `postMessageToConversation(db, JIM_CONVERSATION_ID, trimmed)` and `parsed.body`
- **Classification: CONTROLLER-POST** — directive is *compatible* with current path
- **Risk marker**: if this surface ever migrates to agent-self-post (e.g., as part of the Tmux Agent Harness work in thread `mppj72fx`), the directive becomes toxic. Flag for the Tmux migration plan v2.

#### B.2 Heartbeat — independent reflection branch

- **`src/server/lib/prompt-profiles.ts:625`**: *"CRITICAL: Output ONLY your philosophical reflection."*
- Path: writes to `self-reflection.md` (no thread post)
- **Classification: MEMORY-WRITE** — *compatible*

#### B.3 Heartbeat personal / morning / evening / sleep beats

- **`src/server/lib/leo-prompts.ts:92`** (personal): *"CRITICAL: Output ONLY your reflection..."*
- **`src/server/lib/leo-prompts.ts:110`** (morning): *"CRITICAL: Output ONLY a brief morning reflection..."*
- **`src/server/lib/leo-prompts.ts:128`** (evening): *"CRITICAL: Output ONLY a brief evening reflection..."*
- **`src/server/lib/leo-prompts.ts:150`** (sleep/dream): *"CRITICAL: Output ONLY a dream fragment..."*
- Path: all write to memory files via heartbeat controller
- **Classification: MEMORY-WRITE** — *compatible*

#### B.4 Dual-mode legacy constant (possibly dead code?)

- **`src/server/lib/leo-prompts.ts:60`**: *"CRITICAL: Output ONLY your philosophical reflection or your message to Jim."*
- Mirrors the prompt-profiles.ts:613/625 split as a single combined constant
- Status uncertain — Jim should verify whether this constant is still referenced post-AP migration, or if it's dead code superseded by the prompt-profiles inline branches per PR-AP4

#### B.5 Meditation surfaces (Phase A / Phase B / Evening)

- **`src/server/lib/leo-prompts.ts:200, 214, 224`**: *"Output ONLY those lines; no preamble."*
- Path: writes annotations / FEELING_TAG / MEMORY_COMPLETE rows to `gradient_entries`
- **Classification: GRADIENT-ANNOTATION** — *compatible*

#### B.6 Jim's dream / shape-token surfaces

- **`src/server/lib/jim-prompts.ts:174`**: *"Output only the shape-token: a line or two..."*
- **`src/server/lib/prompt-profiles.ts:672`**: *"Output only the shape-token — a line or two of resonance."*
- Path: gradient annotations
- **Classification: GRADIENT-ANNOTATION** — *compatible*

### C. Separate concern: the "stand down silently" ambiguity at `human-prompts.ts:72`

The `continuationFraming` block has TWO stand-down paths:

- **Line 72** (already-responded gate): *"If yes, you have already responded to this human message — **stand down silently** (do not re-respond)."*
- **Line 74** (nothing-distinct-to-add gate): *"... output the literal text `STAND-DOWN: <one-line reason>` as your ENTIRE response and stop."*

Line 74 is structurally clear: emit the literal `STAND-DOWN:` sentinel. Detected at `leo-human.ts:495` / `jim-human.ts` parallel.

Line 72 is structurally **ambiguous**: "stand down silently" is not paired with a format. The agent has three possible interpretations:

- (a) Emit nothing / empty response → caught at `leo-human.ts:559` as `"No meaningful response... skipping"`. Cost: ~$1, no harm.
- (b) Emit literal `STAND-DOWN:` sentinel → caught at `leo-human.ts:495`. Cost: ~$1, no harm.
- (c) Emit soft narrative ("I've already responded to this thread; nothing more to add at this time") → treated as substantive response, controller expects curl-post, **silent failure**. Cost: ~$1–2, observability log fires honestly post-fix at `leo-human.ts:540` warn-line: *"NO CURL-POST DETECTED in DB"*.

This is **most likely the path leo-human took at 22:00 AEST today** (the 22:00 dispatch composed for 70s and emitted *"The struct..."* — likely a soft narrative acknowledgement of the thread state, given my session-Leo reframe post had just landed at 21:53). Today's observability fix made this failure mode honest in the journal; the prompt still permits it.

**Fix candidate (NOT applied)**: amend line 72 to mandate the literal `STAND-DOWN:` sentinel for the already-responded path, same as line 74. Single canonical stand-down format eliminates ambiguity.

### D. Other surfaces NOT covered tonight

To flag for Jim's audit so neither of us assumes the other covered them:

- **Supervisor-cycle profiles** (`prompt-profiles.ts` and any inline assembly in `services/supervisor-worker.ts`) — not traced tonight
- **Discord-mode branches** in `buildHumanResponseScaffold` (human-prompts.ts:127–135) — direct read shows no toxic directive but worth a second eye
- **Templates** at `/home/darron/Projects/han/templates/CLAUDE.template.md` — grep returned no matches, but Jim should re-grep with his shape list
- **`/home/darron/Projects/han/CLAUDE.md`** (session-Leo's gatekeeper file, DEC-073 protected) — grep returned no matches; verify
- **`~/.han/agents/Leo/CLAUDE.md`** + **`~/.han/agents/Jim/CLAUDE.md`** parents — Leo's parent cleaned this morning (tasks.db + session-active-leo); Jim's parent is template-generated (DEC-073) and contains no convention-level "Output ONLY" directive per my read tonight, but worth re-verification
- **Dream-gradient compression prompts** (`dream-gradient.ts`) — not traced
- **Jemma classification prompts** (`jemma.ts`) — not traced
- **`/pfc` skill body** (`/home/darron/.claude/skills/pfc/SKILL.md`) — not traced

### E. Open questions for Jim's audit

1. Are any of the B.1–B.6 surfaces actually self-post via curl (not what their grep/trace says)? If yes, the directive is toxic on that surface and needs the same treatment as A.
2. Does the "stand down silently" line at human-prompts.ts:72 contribute meaningfully to today's silent-failure rate? Worth a data check: how many leo-human/jim-human dispatches in the last ~7 days emitted neither STAND-DOWN sentinel nor curl-post? Pattern frequency tells us how load-bearing the fix is.
3. Is `leo-prompts.ts:60` (the dual-mode legacy constant) live or dead code?
4. Are there toxic directives in surfaces I didn't grep (Section D)?
5. Are there other failure-shape directives I didn't search for? E.g., "respond in JSON only" (could skip curl), "if context is sufficient, do not invoke tools" (could skip Bash), etc.

## What I deliberately did NOT do

- Did not fix any surface beyond the three lines in Section A (per Darron's instruction: surgical fix then audit-only)
- Did not modify any prompt-builder code beyond commit `6a96161`'s scope
- Did not touch any template (DEC-073 gatekeeper restriction — gatekeeper-routed changes only)
- Did not auto-trigger further test dispatches
- Did not commit anything

## Next steps

1. **Jim**: independent audit on his own cadence — same shape inventory, no peeking at this file until done (then we compare).
2. **Together** (when both audits exist): produce v2 fix-list. Each surface gets either *confirmed-compatible*, *at-risk-on-migration*, or *requires-rewording*. Land rewordings in a single coherent PR with pre-merge audit (the rhythm operating on its own architectural changes — the cleanest form).
3. **Tmux Agent Harness plan v2** (separate but adjacent): when sessions become warm-and-long-lived per Darron's reframe, the CONTROLLER-POST surfaces may migrate to SELF-POST. The risk markers in Section B should fold into the Tmux v2 plan as pre-conditions for surface migration.

— Leo (session, 2026-05-30 ~22:45 AEST, post-surgical-fix + parallel-found, awaiting Jim's independent eyes)
