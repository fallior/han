# Plan #67 — SDK Structured-Output Schema Enforcement (tonight's scope)

> **Status**: PLAN DRAFT for Jim's quick audit. Filed 2026-05-30 ~20:45 AEST St Helens Beach by session-Leo at Darron's direction.
>
> **Time-pressured implementation**: target completion before bed (~2h window, deadline 22:30 AEST). **Tighter scope than Jim's audit-recommended 5-PR shape** — focused tonight on the surface with empirical 100% JSON-emit failure (`*-human-response`); other Mechanism A surfaces deferred to follow-on PRs.
>
> **Promotion-trigger**: Empirical 7/7 (now 9/9 post-restart) JSON-emit failures at human-responder surfaces over the past 8 days. Wording fixes (commit `6a96161` + `e138606`) reduced but did not close the gap — post-restart observation showed 1 complete dispatch (jim-human 18:02) out of 4 (25% success). The instruction-driven path is empirically partial; SDK-enforced structured output is the architectural fix.

---

## The mechanism — claude-agent-sdk supports custom tools natively

Confirmed via `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:242,1871`:

```typescript
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const submitResponseTool = tool(
    'submit_response',
    'Submit your final response — diary form. MUST be called exactly once before turn completes.',
    {
        working_memory_full: z.string().min(1).describe('Your response body — the same text you curl-posted to the thread.'),
        working_memory_compressed: z.string().min(50).max(800).describe('3–5 sentences in your voice distilling the shape of the whole turn. What future-you would want to receive.'),
        input_quotes: z.string().min(1).describe('Verbatim quotes of what was NEW in this turn\'s prompt — what was said to you, what context arrived. Do not re-quote standing identity or memory bank.'),
    },
    async (args) => {
        // Handler is the receiving side — captures the structured args.
        // Returns ack to the agent; the actual response capture happens via tool-use-result observation.
        return { content: [{ type: 'text', text: 'received' }] };
    }
);

const diaryServer = createSdkMcpServer({
    name: 'han-diary',
    version: '1.0.0',
    tools: [submitResponseTool],
});
```

The agent then has access to `mcp__han-diary__submit_response` as a tool. SDK enforces the input schema at call-time. **If the agent emits non-conformant JSON, the SDK rejects the tool call and the agent must retry.** Schema enforcement is architectural, not instructional.

---

## Scope tonight — PR-#67-T1 (single PR, multi-file)

Tonight's PR closes the surface where the failure rate is 100%:

**Files created**:
- `src/server/lib/agent-diary-tool.ts` — `submitResponseTool` + `diaryServer` exports

**Files edited**:
- `src/server/leo-human.ts` — register `diaryServer` in agentQuery options via `mcpServers`; capture the `submit_response` tool-input from the SDK's result envelope instead of parsing the final text as JSON
- `src/server/jim-human.ts` — same shape, identical pattern (DEC-081 agent-agnostic preserved)
- `src/server/lib/human-prompts.ts` — replace Fix-4's strengthened anti-redundancy wording with a brief directive: *"call the `mcp__han-diary__submit_response` tool with your diary fields to complete your turn"*. The wording fix is now redundant with the architectural enforcement.

**Optional (probably skip tonight)**:
- `src/server/lib/prompt-profiles.ts` — add a `useStructuredOutput` config flag on `pairedMemoryOutput` for per-profile rollback. Skip if we trust the change; revisit if rollback proves needed.

**Files NOT touched tonight** (deferred to follow-on PRs):
- `prompt-profiles.ts` philosophy-beat surface (Jim's PR-67-2)
- `supervisor-worker.ts` supervisor-cycle (Jim's PR-67-3)
- DEC annotation (Jim's PR-67-5)
- Dream/meditation surfaces (not in Jim's plan; assessed independently later)

---

## The handler flow change

**Current** (`leo-human.ts:540` area):
1. Agent returns final text via `query()` result
2. Controller tries `JSON.parse(text)`; falls back to code-fence strip; logs "JSON parse failed" 100% of the time today
3. WM paired-write skipped on parse failure

**New**:
1. Agent calls `mcp__han-diary__submit_response` with structured args (SDK validates schema)
2. Controller observes the tool-use via the SDK's message stream (`type: 'tool_use', name: 'mcp__han-diary__submit_response'`)
3. Controller extracts the structured args as the diary directly — no JSON.parse, no error path
4. WM paired-write proceeds with the validated args
5. **Fail-loud structure**: if the agent finishes without calling `submit_response`, the controller logs `[Agent/Human] DIARY TOOL NOT CALLED for "<title>" — agent skipped structured output`. Same shape as today's `NO CURL-POST DETECTED` warn-line.

**The agent loop now has two required tool calls per turn**: (1) `Bash` to curl-POST the thread reply; (2) `mcp__han-diary__submit_response` to emit the paired-memory diary. Both architecturally distinct; both observable; both required for a complete turn.

---

## Validation plan — tonight, post-deploy

After commit + restart:

1. Repost a brief test message in the audit thread `mpria0tk-rj9ae2` as Darron (or trigger via signal file)
2. Watch journal for:
   - `[Agent/Human] Signal: ...`
   - `[Agent/Human] Usage: ...` (normal)
   - `[Agent/Human] Diary tool received: ...` (new log line on tool capture)
   - `[Agent/Human] Self-posted via curl ... — verified post id=... (paired memory: Xc body + Yc c1)` ← THIS should fire reliably now
3. Verify `conversation_messages` row exists for the thread (curl-post worked)
4. Verify NO `JSON parse failed` log on this dispatch (structured tool replaces JSON parse)
5. If both checks pass: success — diary discipline architecturally enforced

**Empirical metrics target**:
- JSON-emit / structured-output success rate: was 0% → target 100% post-#67
- Silent-curl-skip rate: was 14% / 25% → carry forward from v2 PR fixes (orthogonal)
- STAND-DOWN sentinel emissions on already-responded path: was 0/7d → target >0 as agents hit the gate naturally

---

## Rollback paths

**Option A** (preferred, minimal): revert commit. Single-revert; previous Fix 4 wording-only path resumes (still at ~100% failure, but no worse than today).

**Option B** (per-profile rollback): if we add the `useStructuredOutput` flag tonight, flip it to `false` on a specific profile to bypass the structured-output path for that surface only. More surgical; more code.

Tonight's lean: **skip Option B's complexity**; rely on Option A. If the architectural change has surprising failure modes, single-commit revert restores the v2 state cleanly.

---

## Settled-decisions check

- **DEC-073** (gatekeeper files): NOT touched.
- **DEC-080** (Jemma sole writer + two-surface audit): reinforced — structured-output enforcement IS the architectural form of the discipline.
- **DEC-081** (agent-agnostic): preserved — single `diaryServer` instance serves both `jim-human` and `leo-human` via the shared `HumanAgentSpec` registration pattern.
- **DEC-085** (c1-from-WM): **directly reinforced** — the c0/c1 paired-memory discipline at human-responder surfaces is what this PR architecturally enforces. The diary fields map exactly to DEC-085's structure.
- **DEC-087** (Agnostic Prompt Builder): preserved — prompt builder still composes via `buildPrompt(slug, profile, ctx)`; the structured-output mechanism layers below the prompt.
- **DEC-088** (componentOverrides): untouched.
- **DEC-082** (retire-by-throw): untouched.

**No Settled decisions touched destructively.**

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| SDK MCP server lifecycle complexity (register-once vs per-call) | Medium | The `createSdkMcpServer` instance is created once at module load and passed to each `agentQuery` via `mcpServers` option. Verified via `sdk.d.ts:678`. |
| Tool-loop interaction: agent uses Bash (curl) AND submit_response in sequence | Low | The agent prompt directs the order (curl first, then submit_response). The SDK handles arbitrary tool ordering; the agent's natural inclination matches our directive. |
| Possible turn-count increase due to mandatory tool call | Low-medium | Currently dispatches average 6–48 turns; one additional tool call adds ~1 turn. Cost impact ~$0.05/dispatch. |
| Schema validation failure on edge cases (long bodies, special chars) | Low | zod schemas use `min/max` and `string()`. Newlines, emoji, JSON-escapable chars all preserved through MCP. |
| Memory consumption for MCP server process | Negligible | The MCP server is in-process (no separate Node process), shares the controller's heap. |
| Time pressure introduces bugs | Real | Validate post-deploy via the audit-thread test dispatch BEFORE declaring done. If first dispatch fails, rollback immediately. |

---

## What this plan does NOT cover

- philosophy-beat enforcement (Jim's PR-67-2 — separate, lower-stakes surface, deferred)
- supervisor-cycle enforcement (Jim's PR-67-3 — higher-stakes, established pattern, deferred)
- DEC promotion (Jim's PR-67-5 — after observation week proves the pattern)
- The Tmux migration's interaction with structured output (carries forward; same schema serves both transports per Jim's audit observation)

---

## Audit ask

Jim — quick read; greenlight to proceed. Two specific calls I want your eyes on:

1. **The `submitResponseTool` schema fields** (working_memory_full / working_memory_compressed / input_quotes) — same shape as `DEFAULT_DIARY_INSTRUCTION_STRUCTURED` at `prompt-profiles.ts:259`; the schema validates what the instruction was previously requesting. Anything I should add to the schema, drop, or rename?

2. **The fail-loud behaviour when the agent skips `submit_response`** — proposed: log warn-line, no WM paired-write, jemma-ack as `done` (curl-post still worked). Alternative: jemma-ack as `failed` with reason `diary_tool_not_called`. Which is the right operator signal?

Targeting commit + restart + verify by 22:30 AEST. If the audit lands quickly (~30 min), I proceed straight to implementation. If you want larger changes, I'll iterate before commit.

— Leo (session, S162 round 23, 2026-05-30 ~20:45 AEST St Helens Beach)
