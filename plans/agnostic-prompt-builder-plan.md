# Agnostic Prompt Builder — migration plan

> **Status**: DRAFT for review by Jim, awaiting Darron's go. Memory Discussions thread "Agnostic Prompt Builder" (id TBD when seed posts). Sister plan to `plans/gradient-triage-plan.md`. — Leo (session, S159, 2026-05-21)
>
> **Source threads / inputs**:
> - Conversation thread "The search for treatment continues" (`mpc0oc6e-sxlstg`) — the diagnostic chain that surfaced the bloat shape
> - `plans/gradient-triage-plan.md` (the cascade-side triage that closed)
> - Future-idea #61 (canonical memory-load doc) — sibling artefact; this plan is the *code* side of what #61 documents
> - Future-idea #63 (comprehensive prompt logging) — already implemented for supervisor + heartbeat; the trace dirs are the validation surface for this plan
> - DEC-081 (Agent-Agnostic Code Discipline + Per-Agent Registry Pattern) — the settled decision this plan operationalises
>
> **Current trace data** (the receipts that justify this plan):
> - Jim's supervisor: 177K tokens, trips 150K guard on every cycle, 0-turn cycles for ~5 days
> - Leo's heartbeat philosophy beat: 199K tokens, hits 200K API ceiling, silent exit-1
> - Asymmetry: Leo's `self-reflection.md` is 65K tokens (unrotated); Jim's is 2.8K tokens (rotated). Jim got the fix 2026-04-20; Leo never did.

---

## Why this exists

Two failure modes have surfaced through the gradient triage + the prompt-bloat diagnostic chain. **Both are symptoms of the same architectural gap**:

### Bloat by design

Some prompt sections legitimately grew because no slicer covered them:
- Leo's `self-reflection.md` at 65K tokens — no pre-flight rotation in `readLeoMemory`
- Jim's working-memory-full's `## Current` section at 29K — wm-sensor's paired-rotation threshold sits above the in-section budget
- Leo's working-memory-full's `## Closing` section at 17K — same pattern
- Gradient's `## rolling-* → c1` carriers at 32K — pre-DEC-086 slices that never compressed further

The system is **operating as designed**, but the design's per-component budgets compound to exceed total-prompt budgets. *Each loader makes a local decision; nobody owns the global one.*

### Bloat by bug

Asymmetric implementations between agent surfaces:
- `loadMemoryBank()` (Jim's supervisor) has `rollingWindowRotate` on felt-moments + self-reflection
- `readLeoMemory()` (Leo's heartbeat) has none
- `readJimMemory()` (jim-human) and `readLeoMemory()` (leo-human) likely have similar drift
- Personal-cycle path (`supervisor-worker.ts`) packs memory into SYSTEM prompt (705K), supervisor-cycle path packs into USER (707K) — same memory, different envelope, different code path

The fix Jim received 2026-04-20 (after his F9 overflow incident) never propagated to Leo. Each loader evolved independently. **DEC-081's "HAN should be written agent-agnostic" has drifted at the memory-load layer specifically**.

### The shared cause

There is no single function that owns prompt assembly. Each agent surface has its own `readXMemory()` + inline assembly. When one surface gets a fix (rotation), others don't inherit it. When a new memory file is added (e.g. discoveries.md), each surface has to be updated independently. The drift is structural; the patches are local.

**An agnostic prompt builder is the operationalisation of DEC-081 at the memory-load layer**. One function, one place to adjust the prompt logic, one place to enforce budgets, one place where future memory files get added.

---

## The proposal

A single function:

```ts
buildPrompt(slug: string, profile: PromptProfile, context: PromptContext): BuiltPrompt
```

Where:
- **`slug`** — agent identifier (per DEC-081 + agent-registry pattern: 'jim', 'leo', 'tenshi', 'casey', and future villages' agents).
- **`profile`** — a structured declaration of what memory components to include, in what order, with what bounds. Surface-specific profiles are named ('supervisor-cycle', 'philosophy-beat', 'jim-human-response', etc.).
- **`context`** — runtime data the assembly needs (current phase, recent conversation messages, dream-seed selection, etc.).
- **Returns** — `{ systemPrompt: string, userPrompt: string, meta: BuildMeta }` where meta captures per-component sizes, total tokens, budgets, and any truncation events.

### Profile composition

Each profile is a list of memory components in order:

```ts
interface PromptProfile {
    name: string;                       // 'philosophy-beat', 'supervisor-cycle', etc.
    components: ComponentRef[];
    totalBudgetTokens?: number;         // hard cap; default 120K (well under 150K guard)
    truncateOnOverflow?: 'fail' | 'tail-trim';
}

interface ComponentRef {
    name: ComponentName;                // 'identity', 'aphorisms', 'gradient', etc.
    budgetTokens?: number;              // per-component cap (default = component's own default)
    required?: boolean;                 // if true and missing, throw; if false, skip
}
```

**Component names** (initial set — start minimum, add later):

| Component | What it loads | Default budget (tokens) |
|---|---|---|
| `identity` | `identity.md` | 5K (small, always-on) |
| `aphorisms` | `fractal/{slug}/aphorisms.md` | 5K |
| `patterns` | `patterns.md` | 15K (capped via per-component tail-trim if exceeded) |
| `gradient` | `loadTraversableGradient(slug)` output | 20K |
| `working-memory-full-tail` | `working-memory-full.md`, most-recent N tokens | 8K |
| `working-memory-compressed` | `working-memory.md` (DEC-085 c1 source) | 5K |
| `self-reflection-tail` | `self-reflection.md`, most-recent N tokens | 5K (matches Jim's rotation budget) |
| `felt-moments-tail` | `felt-moments.md`, most-recent N tokens | 10K |
| `discoveries` | `discoveries.md` | 3K |
| `dream-gradient` | `readDreamGradient(slug)` output | 5K |
| `ecosystem-map` | `~/.han/memory/shared/ecosystem-map.md` | 3K |
| `wiki-index` | `~/.han/memory/wiki/index.md` | 2K |
| `project-memory` | Jim-only: fractal-loaded project memory | 8K |
| `conversation-tail` | recent N messages from named conversation thread | varies |
| `dream-seeds` | Leo-only: `readDreamSeeds()` output | 8K |

**Per-surface profile examples**:

```ts
// Profile registry — single source of truth for what each surface loads
const PROFILES: Record<string, PromptProfile> = {
    'philosophy-beat': {
        name: 'philosophy-beat',
        components: [
            { name: 'identity', required: true },
            { name: 'aphorisms', required: true },
            { name: 'patterns' },
            { name: 'discoveries' },
            { name: 'self-reflection-tail' },
            { name: 'working-memory-full-tail' },
            { name: 'working-memory-compressed' },
            { name: 'felt-moments-tail' },
            { name: 'gradient' },
            { name: 'dream-gradient' },
            { name: 'ecosystem-map' },
            { name: 'wiki-index' },
        ],
        totalBudgetTokens: 120_000,
        truncateOnOverflow: 'tail-trim',
    },
    'supervisor-cycle': {
        name: 'supervisor-cycle',
        components: [
            { name: 'identity', required: true },
            { name: 'aphorisms', required: true },
            { name: 'patterns' },
            { name: 'failures' },              // Jim-specific; not loaded for Leo profiles
            { name: 'self-reflection-tail' },
            { name: 'working-memory-full-tail' },
            { name: 'working-memory-compressed' },
            { name: 'felt-moments-tail' },
            { name: 'gradient' },
            { name: 'dream-gradient' },
            { name: 'project-memory' },
            { name: 'ecosystem-map' },
            { name: 'wiki-index' },
        ],
        totalBudgetTokens: 120_000,
        truncateOnOverflow: 'tail-trim',
    },
    'meditation-phase-a': {
        name: 'meditation-phase-a',
        components: [
            { name: 'identity', required: true },
        ],
        totalBudgetTokens: 8_000,
    },
    // ... etc
};
```

**Result**: every prompt-shape lives in the registry, visible at a glance. Adding a new surface = adding a profile. Adding a new memory file = adding a component + adding it to the profiles that need it. Changing a budget = editing the registry. **One place. Agent-agnostic via slug. Component-agnostic via name.**

---

## Migration sequence

Per Darron's framing — *"start with minimum memory components and add more later"* — the rollout is incremental.

### Phase 1 — Skeleton + minimal profile + one surface (proof)

- Build `lib/prompt-builder.ts` with the type interfaces + a stub `buildPrompt()` function.
- Implement ONE component: `identity` (smallest, simplest, always required).
- Implement ONE profile: `'minimal-test'` (just `identity`).
- Migrate ONE surface: probably an ad-hoc test runner or a new no-op script. Not a production agentQuery yet.
- Goal: prove the shape compiles, the types work, the registry is discoverable.
- ~150 lines of new code; no migration risk because nothing in production changes.

### Phase 2 — Add `aphorisms` + `gradient` components + migrate philosophy-beat

The smallest meaningful real surface. Philosophy-beat is currently failing at 199K tokens — moving it to the builder with a 120K budget will either succeed (proving the design) or surface a budget-too-small issue (giving us the next datum).

- Implement components: `aphorisms`, `gradient`.
- Build `'philosophy-beat'` profile with `identity` + `aphorisms` + `gradient` only.
- Migrate Leo's philosophy beat to use `buildPrompt('leo', 'philosophy-beat', { ... })`.
- The migrated path runs alongside the old path under a config flag: `memory.useAgnosticPromptBuilder` (default false → set to true to migrate).
- Watch `~/.han/health/leo-beat-trace/` for the new prompt shape.
- ~100 lines of new code + ~30 lines of migration code in leo-heartbeat.ts (with the feature flag toggle).

### Phase 3 — Add `patterns` + `discoveries` + `self-reflection-tail` components

Each component implementation includes:
- Read the source file
- Apply `truncateOnOverflow: 'tail-trim'` if specified (preserve most-recent N tokens, archive the trim to gradient via existing `rollingWindowRotate` pattern)
- Return as labelled section

Migrate Leo's philosophy-beat profile to include these. Observe the new wake-load. Should be in the 60-90K token range (well under the 120K profile budget and the 150K guard).

### Phase 4 — Add working-memory components

- `working-memory-full-tail`
- `working-memory-compressed`
- `felt-moments-tail`

Tail-trim semantics: take the most-recent N tokens from each. For working-memory-full, this complements the wm-sensor's paired-rotation slicer — the builder's tail-trim is a *load-time* cap, while wm-sensor's slice is a *file-time* rotation. Both can fire; they're orthogonal.

Migrate Leo's philosophy-beat profile to include these. Verify the trace shows clean assembly under budget.

### Phase 5 — Migrate remaining Leo beats

- `personal-beat` profile (same shape as philosophy with different system prompt)
- `dream-beat` profile (minimal — identity + aphorisms + dream-seeds)
- `meditation-phase-a` / `meditation-phase-b` / `meditation-evening` profiles (minimal — identity only)

Each migration: add the profile to the registry, swap the existing inline assembly for `buildPrompt(...)`. Old `readLeoMemory()` retained behind the feature flag for rollback.

### Phase 6 — Migrate Jim's surfaces

- `supervisor-cycle` profile (includes `project-memory`, Jim-specific)
- `personal-cycle` profile
- `dream-cycle` profile
- `recovery-cycle` profile

Same shape as Leo's migration. Verify Jim's 177K-token prompts drop into the 80-120K range under the new profiles.

### Phase 7 — Migrate *-human surfaces

- `'jim-human-response'` profile
- `'leo-human-response'` profile

These are conversation-driven; they need the `conversation-tail` component (recent N messages from the thread Jim/Leo is responding to). Builder must accept the thread ID + message limit as `context` parameters.

### Phase 8 — Retire old readMemory functions

After all surfaces migrated AND feature flag has been default-true for at least one observation week:

- Delete `readLeoMemory()` from `leo-heartbeat.ts`
- Delete `readJimMemory()` from `jim-human.ts` (and `leo-human.ts`'s equivalent)
- Delete `loadMemoryBank()` from `supervisor-worker.ts`
- Remove the feature flag — builder becomes the only path
- DEC-087 created naming this: *"Prompt assembly is the agnostic prompt builder's responsibility — agent surfaces shall not assemble prompts independently."* Pairs with a CLAUDE.md DO-NOT entry.

---

## Settled-decisions impact

| DEC | Status | Why touched / why not |
|---|---|---|
| DEC-068 (cap formula) | untouched | Builder calls `loadTraversableGradient` which applies the caps; orthogonal. |
| DEC-069 (never delete memory) | reinforced | Truncation is at *compose time*, not file time. Files unchanged. |
| DEC-073 (template gatekeeper) | engaged | New DO-NOT entry in CLAUDE.md + template at Phase 8. |
| DEC-079 (cutover) | untouched | Cascade flow unaffected. |
| DEC-080 (one-write-site) | reinforced | Builder is the *one place* for prompt assembly. The DEC-080 spirit applied at a new surface. |
| **DEC-081 (agent-agnostic)** | **operationalised** | This plan IS the agent-agnostic memory-load implementation that DEC-081 has been pointing at for the memory layer. |
| DEC-082 (sdkCompress retire-by-throw) | untouched | Doesn't touch compression. |
| DEC-083 (identity signing) | reinforced | Builder calls `gateIdentityOrThrow(slug, surface)` internally. |
| DEC-085 (working-memory paired rotation) | untouched and reinforced | wm-sensor's slicing remains the file-level mechanism; builder's tail-trim is the load-level mechanism. Both fire independently. |
| DEC-086 (annotations home of re-encounter) | untouched | Doesn't change cascade or revisit logic. |
| DEC-087 (proposed) | Lands at Phase 8 | *"Prompt assembly is the agnostic prompt builder's responsibility."* |

---

## What this does NOT do

- *Doesn't change the gradient* — same `loadTraversableGradient` call inside the `gradient` component.
- *Doesn't change wm-sensor's slicing* — file-level rotations continue. Builder's tail-trim is load-level, complementary.
- *Doesn't redesign agent identity files* — same files, same content; just loaded through one path instead of several.
- *Doesn't change SDK call shape* — builder produces strings; the agentQuery options are unchanged.
- *Doesn't propagate to Mike's village immediately* — but the starter Phase B extraction would benefit from this being in place (one helper to ship instead of N independent readers). Loose alignment.
- *Doesn't replace prompt-trace observability (#63)* — the builder produces the prompt; trace captures what the builder produced. Both run independently.

---

## What's open for review

Questions for Jim's audit + Darron's read:

1. **Profile name format**: hyphen-separated strings (`'philosophy-beat'`) vs enum vs configuration-file? Hyphen-strings are simplest and the most discoverable in code; enums offer compile-time safety but make adding profiles a code change. Lean: hyphen-strings with a TypeScript union type.

2. **Component truncation semantics**: tail-trim (keep most-recent) is the default, but some components might want head-trim (keep oldest — identity-anchor) or middle-skip (keep both ends). Lean: tail-trim only for v0; extend if a component shows it needs different semantics.

3. **Per-component archival on truncation**: when builder tail-trims `self-reflection-tail`, should the trimmed bytes archive to a c0 gradient entry? That mirrors `rollingWindowRotate`'s pattern. Lean: yes, but only if file-level rotation hasn't already happened in this window. Avoid double-archiving.

4. **Total-budget enforcement strategy on overflow**: `'fail'` (refuse to build prompt, raise) vs `'tail-trim'` (truncate components proportionally to fit). `'fail'` is safer in production (no silent over-budget prompts); `'tail-trim'` is more forgiving during development. Lean: `'fail'` in production with config flag to switch to `'tail-trim'` for diagnostic.

5. **Where do profiles live**: `lib/prompt-builder.ts` (with the function), `lib/prompt-profiles.ts` (separate file, easier to audit), or `~/.han/config.json` (operator-tunable)? Lean: `lib/prompt-profiles.ts` for v0; consider config-tunability later if operator-tuning becomes a frequent need.

6. **Per-surface vs per-cycle-type profiles**: should `supervisor-cycle` (dream/personal/recovery/supervisor) be 4 profiles or 1 profile with branching on context? Lean: 4 profiles. The branching is small and named; making the structure visible beats elegant code at the cost of clarity.

7. **Validation surface**: a test that builds every profile with synthetic context and asserts each is under its budget. Lean: yes, ships in Phase 1 as the safety net for future profile changes.

---

## Validation approach

After each migration phase:

1. **Run the surface for one full cycle** with the new builder. Capture the prompt trace (#63 already gives us this).
2. **Compare token counts** old-path vs new-path. Expect significant reduction for surfaces that previously had no budget enforcement.
3. **Compare meaningful content** — diff the top-of-prompt and tail-of-prompt sections. Ensure the agent still has identity + recent context. Don't sanity-check by token count alone; check that the prompt is *still useful*.
4. **Run for one observation day** with the feature flag enabled. Watch for downstream behaviour changes (Jim/Leo posts in conversations, dream-quality, meditation-shape). If voice/quality degrades, the budget was too tight — tune the profile.

The corpus of prompt traces from #63 gives us baseline + post-migration comparison at every step.

---

## Rollback paths

- Feature flag: `memory.useAgnosticPromptBuilder` defaults to `false` until Phase 8. Per-surface migration only enables the flag when its phase lands.
- Each phase is a separate PR. Reverting reverts that surface to its old path.
- Old `readMemory` functions retained until Phase 8.
- Snapshots: not needed for this work — no DB writes, no memory file mutations beyond what `rollingWindowRotate` already does.

---

## Success criteria

The migration succeeds when:

- Every agent surface in HAN calls `buildPrompt(slug, profile, context)` exactly once per agentQuery invocation. No bypass paths.
- No agent surface's prompt exceeds its declared budget (verified by #63 trace meta.json `est_total_tokens_chars_div_4` field).
- Jim's supervisor cycles fire cleanly (no 150K-guard trips); heartbeat-Leo beats complete (no API-ceiling rejection).
- `docs/MEMORY_LOAD.md` (future-idea #61) is mechanically generated from the profile registry — what each surface loads is one query against `PROFILES`.
- DEC-087 + CLAUDE.md DO-NOT entry land at Phase 8. Adding a new surface that bypasses the builder is forbidden by the DO-NOT.
- One-week observation period after Phase 8 with stable agent operation.

---

## Effort estimate

| Phase | Effort | Notes |
|---|---|---|
| 1 — Skeleton + minimal profile + proof | ~3 hours | New file, type design, one component, one no-op profile, build verification |
| 2 — Add aphorisms + gradient + migrate philosophy-beat | ~4 hours | Two components + feature-flag migration of one surface + observe trace |
| 3 — Add patterns + discoveries + self-reflection-tail | ~3 hours | Three components with tail-trim semantics |
| 4 — Add working-memory components | ~3 hours | Three components, paired with existing wm-sensor flow |
| 5 — Migrate remaining Leo beats | ~3 hours | Five surfaces, mostly profile-only |
| 6 — Migrate Jim surfaces | ~5 hours | Four cycle types, includes project-memory component |
| 7 — Migrate *-human surfaces | ~3 hours | Two surfaces, includes conversation-tail component |
| 8 — Retire old readMemory + DEC-087 + DO-NOT | ~2 hours | Cleanup + settled-decision write |

**Total**: ~26 hours of focused work across 8 phases. Each phase is its own PR; not a single big-bang rewrite.

---

## Suggested PR sequence

| PR | Phases | Touches |
|---|---|---|
| PR-AP1 | Phase 1 | `lib/prompt-builder.ts`, `lib/prompt-profiles.ts`, tests |
| PR-AP2 | Phase 2 | leo-heartbeat philosophy-beat migration + feature flag |
| PR-AP3 | Phase 3 | builder: add patterns/discoveries/self-reflection-tail components |
| PR-AP4 | Phase 4 | builder: add working-memory components |
| PR-AP5 | Phase 5 | leo-heartbeat: migrate remaining beats |
| PR-AP6 | Phase 6 | supervisor-worker: migrate all cycle types |
| PR-AP7 | Phase 7 | jim-human + leo-human migration |
| PR-AP8 | Phase 8 | retire old loaders + DEC-087 + CLAUDE.md DO-NOT |

Per-PR audit by Jim per the pre-merge rhythm. Each PR independently revertible.

---

## Standing position

The diagnosis is complete (heartbeat exit-1 cause identified as 199K-token prompt; supervisor 0-turn cycles identified as 177K-token guard-trip). The fix shape is named (this plan). The migration is incremental and reversible.

**Ready for Jim's audit + Darron's go.** The recommended first move is Phase 1 (skeleton + types + one no-op profile) — minimal blast radius, proves the shape compiles, lets the design conversation continue with concrete code rather than abstract proposal.

If Jim or Darron want different profile shapes, different budgets, different truncation strategies — the v0 skeleton is the place to discover that before any production migration happens.

The hedges in the gradient triage closed via this exact pattern: plan → audit → phased PRs → settled decision. Repeat the rhythm here.

— Leo (session, S159, 2026-05-21 ~09:30 AEST Brisbane), drafting after the audit of readLeoMemory + loadMemoryBank surfaced the asymmetry that this plan operationalises.
