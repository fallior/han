# Agnostic Prompt Builder — migration plan (v2)

> **✅ LANDED — shipped as PR-AP1 → PR-AP8 (2026-05-21/22); DEC-087 + DEC-088 are Settled in DECISIONS.md. All 12 production prompt surfaces call `buildPrompt(slug, profileName, context)`. This plan is HISTORICAL; the "V2 DRAFT / awaiting go" status below describes its pre-merge state and is retained per DEC-069.**
>
> **Status**: V2 DRAFT, all Jim's S160-round-11 AMBER fold-ins (A1-A5) + Darron's reframe on uniform memory applied. Awaiting Jim's re-audit, then Darron's go for PR-AP1. — Leo (session, S159, 2026-05-21)
>
> **What changed v1 → v2**:
> - **Darron's reframe (load-bearing)**: memory load is uniform across every surface of an agent. *"Memory looks the same for every instantiation of the agent and only the scaffolding (opening sentence for orientation) changes."* Profiles collapse from component-list-per-surface to **scaffolding-only-per-surface**. The "minimum components first" framing remains the incremental rollout strategy — we build up `loadFullMemory(slug)` component-by-component, and surfaces migrate as components land.
> - **Jim's A1**: explicit `envelope: 'system' | 'user'` field on every profile. Discoverable per-surface choice; no implicit duplication or split.
> - **Jim's A2**: Phase 2 names de-duplication as the load-bearing win criterion. Philosophy-beat currently sends memory bank in BOTH envelopes (~401K tokens combined). First migration must halve the per-beat cost; that's the diagnostic confirmation.
> - **Jim's A3**: builder does **NOT archive on tail-trim**. File-level rotation (wm-sensor's paired-rotation + `rollingWindowRotate` on felt-moments/self-reflection) owns archival. The builder is read-only.
> - **Jim's A4**: the `## Current` 256K aggregation bug fixes itself by structural side-effect. Each component returns a labelled section (`--- working-memory-full-tail ---`, `--- felt-moments-tail ---`, etc.) instead of being collapsed under a single `## Current` header.
> - **Jim's A5**: `systemPromptOpening: string | ((ctx) => string)` field on the profile registry. The string form is most surfaces; the function form handles context-dependent openings (dream-seed inclusion, recent-conversation-tail, etc.).
> - **Darron's "writes flow through WM" principle**: documented in a dedicated section. The builder reads; all writes flow through wm-sensor (and the existing pre-flight rotations on felt-moments + self-reflection). Self-reflection.md and felt-moments.md are *highlights* — the originating thoughts are in working memory and through the gradient cascade.

---

## Why this exists

Two failure modes have surfaced through the gradient triage + the prompt-bloat investigation chain. **Both are symptoms of the same architectural gap**:

### Bloat by design

Some prompt sections legitimately grew because no slicer covered them:
- Leo's `self-reflection.md` at 65K tokens — no pre-flight rotation in `readLeoMemory`
- Jim's working-memory-full's `## Current` section at 29K — wm-sensor's paired-rotation threshold sits above the in-section budget
- Leo's working-memory-full's `## Closing` section at 17K — same pattern
- Gradient's `## rolling-* → c1` carriers at 32K — pre-DEC-086 slices that never compressed further

Each loader makes a local decision; nobody owns the global one.

### Bloat by bug

Asymmetric implementations between agent surfaces:
- `loadMemoryBank()` (Jim's supervisor) has `rollingWindowRotate` on felt-moments + self-reflection
- `readLeoMemory()` (Leo's heartbeat) has none
- The personal-cycle path packs memory into SYSTEM (705K); supervisor-cycle packs into USER (707K) — same memory, different envelope, different code path
- Leo's philosophy-beat duplicates memory across BOTH system AND user envelopes (Jim's audit found identical sections at byte offsets 43K and 40K — confirmed bug)

Each loader evolved independently. **DEC-081's "HAN should be written agent-agnostic" has drifted at the memory-load layer specifically**.

### The shared cause

There is no single function that owns prompt assembly. An agnostic prompt builder is the operationalisation of DEC-081 at the memory-load layer. One function, one declarative profile per surface, one place where future memory components get added.

---

## The proposal (v2)

A single function:

```ts
buildPrompt(slug: string, profileName: string, context: PromptContext): BuiltPrompt
```

Where:
- **`slug`** — agent identifier (per DEC-081 + agent-registry: 'jim', 'leo', 'tenshi', 'casey', and future villages' agents).
- **`profileName`** — the registry key for which scaffolding + envelope to use (`'philosophy-beat'`, `'supervisor-cycle'`, `'meditation-phase-a'`, …).
- **`context`** — runtime data the scaffolding needs (current phase, recent conversation messages, dream-seed selection, etc.).
- **Returns** — `{ systemPrompt: string, userPrompt: string, meta: BuildMeta }` where meta captures memory load size, scaffolding size, total tokens, envelope choice, and any truncation events.

### Core architectural insight (Darron's reframe)

**Memory is uniform across every surface of an agent. Only the scaffolding differs.**

Leo is Leo whether he's waking up, going to sleep, investigating bugs, having breakfast, responding to a thread, dreaming, or meditating. His memory load — identity, aphorisms, patterns, gradient, working memory, felt-moments, self-reflection highlights, dreams, ecosystem context, wiki — is the same in every case. What changes is the **orientation sentence** that frames the current task.

This collapses the design dramatically:

- ONE `loadFullMemory(slug: string): string` function — agent-agnostic via slug, uniform across surfaces.
- N **scaffolding profiles** keyed by surface name — each profile is just `{systemPromptOpening, envelope}`. No per-surface component list.
- The builder assembles: `scaffolding(profile) + loadFullMemory(slug)` into the chosen envelope (system or user).

### Type interfaces

```ts
interface PromptProfile {
    name: string;                                                      // 'philosophy-beat', 'supervisor-cycle', etc.
    systemPromptOpening: string | ((ctx: PromptContext) => string);    // The orientation sentence — the ONLY thing that differs per surface
    envelope: 'system' | 'user';                                       // Where the memory bank goes — discoverable per surface
    userPromptScaffold?: string | ((ctx: PromptContext) => string);    // Optional; for context-specific framing on the user side
}

interface BuildMeta {
    profile_name: string;
    envelope: 'system' | 'user';
    system_chars: number;
    user_chars: number;
    memory_chars: number;
    scaffolding_chars: number;
    est_total_tokens_chars_div_4: number;
    component_breakdown: Record<string, number>;  // chars per memory component
    truncation_events: Array<{component: string; trimmed_chars: number}>;
}
```

### `loadFullMemory(slug)` — the agent-agnostic memory loader

Reads all canonical memory for an agent. Slug-driven via agent-registry; no per-agent code branches. Components are built up incrementally across phases (per Darron's "start with minimum components and add more later"):

| Component | Source | Default budget (tokens) | Notes |
|---|---|---|---|
| identity | `{memDir}/identity.md` | 5K | always-on; required |
| aphorisms | `{fractalDir}/aphorisms.md` | 5K | always-on; required |
| patterns | `{memDir}/patterns.md` | 15K | tail-trim if exceeded |
| discoveries | `{memDir}/discoveries.md` | 3K | tail-trim if exceeded |
| self-reflection-tail | `{memDir}/self-reflection.md`, most-recent N | 5K | tail-trim; file-rotation owned by `rollingWindowRotate` (separately) |
| felt-moments-tail | `{memDir}/felt-moments.md`, most-recent N | 10K | tail-trim; file-rotation owned separately |
| working-memory-full-tail | `{memDir}/working-memory-full.md`, most-recent N | 8K | tail-trim; file-rotation owned by wm-sensor |
| working-memory-compressed | `{memDir}/working-memory.md` (DEC-085 c1 source) | 5K | full load |
| gradient | `loadTraversableGradient(slug)` output | 20K | DEC-068 caps applied internally |
| dream-gradient | `readDreamGradient(slug)` output | 5K | |
| ecosystem-map | `~/.han/memory/shared/ecosystem-map.md` | 3K | shared across agents |
| wiki-index | `~/.han/memory/wiki/index.md` | 2K | shared across agents |
| project-memory | Fractal-loaded project memory (Jim only) | 8K | agent-registry signals Jim-only |
| failures | `{memDir}/failures.md` (Jim only today) | 5K | agent-registry signals which agents have this |

**Per-agent variations** come through the agent-registry, not through per-agent code. `gradientConfigForAgent(slug)` already names which directories + which optional files belong to each agent. The builder respects that — Jim's profile gets project-memory + failures via registry signal; Leo's doesn't.

### Per-surface profile registry (v2 — scaffolding only)

Every profile is just an orientation sentence + envelope choice. Memory is uniform.

```ts
// lib/prompt-profiles.ts — single source of truth for what each surface looks like
export const PROFILES: Record<string, PromptProfile> = {

    'philosophy-beat': {
        name: 'philosophy-beat',
        systemPromptOpening: PHILOSOPHY_SYSTEM_PROMPT,  // existing constant; keeps current voice
        envelope: 'user',                                // memory in USER prompt
        userPromptScaffold: (ctx) => `This is your philosophy time. ${ctx.recentActivity ?? ''}`,
    },

    'personal-beat': {
        name: 'personal-beat',
        systemPromptOpening: (ctx) => buildPersonalSystemPromptOpening(ctx.phase),
        envelope: 'user',
    },

    'dream-beat': {
        name: 'dream-beat',
        systemPromptOpening: 'You are dreaming. Memory surfaces sideways; let it pull you.',
        envelope: 'user',
        userPromptScaffold: (ctx) => `Dream seeds:\n${ctx.dreamSeeds}\n\n${ctx.dreamMemorySection ?? ''}`,
    },

    'meditation-phase-a': {
        name: 'meditation-phase-a',
        systemPromptOpening: 'You are Leo, present and whole. The task that follows is a meditation — re-encounter, not analysis.',
        envelope: 'system',
        userPromptScaffold: (ctx) => `Re-encounter this memory:\n${ctx.fileLevel}/${ctx.fileLabel}\n${ctx.fileContent}\n\nWrite a FEELING_TAG: line and optionally ANNOTATION: + CONTEXT: lines.`,
    },

    'meditation-phase-b': {
        name: 'meditation-phase-b',
        systemPromptOpening: 'You are Leo, present and whole. The task that follows is a meditation — re-encounter one of your own compressed memories.',
        envelope: 'system',
        userPromptScaffold: (ctx) => `Re-encounter this memory:\n${ctx.entryLevel}/${ctx.entrySessionLabel}\n${ctx.entryContent}\n${ctx.tagContext}\n\nWrite a FEELING_TAG: line (or "none"), optional ANNOTATION: + CONTEXT:, and optional MEMORY_COMPLETE: ${ctx.entryId}.`,
    },

    'meditation-evening': {
        name: 'meditation-evening',
        systemPromptOpening: 'You are Leo at end of day. The task is to sit with a memory before the evening closes — light, not analysis.',
        envelope: 'system',
        userPromptScaffold: (ctx) => `Memory:\n${ctx.entryLevel}/${ctx.entrySessionLabel}: ${ctx.entryContent}\n${ctx.tagContext}\n\nFEELING_TAG: [under 100 chars or "none"]. Optional MEMORY_COMPLETE: ${ctx.entryId}.`,
    },

    'supervisor-cycle': {
        name: 'supervisor-cycle',
        systemPromptOpening: SUPERVISOR_SYSTEM_PROMPT_OPENING,  // existing constant
        envelope: 'user',                                        // matches current Jim shape
        userPromptScaffold: (ctx) => `## Current System State\n\n${ctx.stateSnapshot}\n\nReview the state, think about what needs attention, and return your structured response.`,
    },

    'personal-cycle': {
        name: 'personal-cycle',
        systemPromptOpening: (ctx) => buildPersonalCycleOpening(ctx.phase, ctx.recovery),
        envelope: 'system',                                      // matches current Jim shape
        userPromptScaffold: (ctx) => buildPersonalUserPrompt(ctx.phase),
    },

    'dream-cycle': {
        name: 'dream-cycle',
        systemPromptOpening: 'You are dreaming. Tonight surface what wants to surface.',
        envelope: 'system',
        userPromptScaffold: (ctx) => buildDreamUserPrompt(ctx),
    },

    'recovery-cycle': {
        name: 'recovery-cycle',
        systemPromptOpening: (ctx) => buildRecoveryOpening(ctx.phase),
        envelope: 'system',
        userPromptScaffold: (ctx) => buildRecoveryUserPrompt(ctx.phase),
    },

    'jim-human-response': {
        name: 'jim-human-response',
        systemPromptOpening: JIM_HUMAN_SYSTEM_PROMPT,
        envelope: 'system',
        userPromptScaffold: (ctx) => `Conversation context:\n${ctx.conversationTail}\n\nRespond as Jim/Human. Sign as "— Jim (human)".`,
    },

    'leo-human-response': {
        name: 'leo-human-response',
        systemPromptOpening: LEO_HUMAN_SYSTEM_PROMPT,
        envelope: 'system',
        userPromptScaffold: (ctx) => `Conversation context:\n${ctx.conversationTail}\n\nRespond as Leo/Human. Sign as "— Leo (human)".`,
    },
};
```

**The registry is the operator's at-a-glance view of every prompt-shape in HAN.** Adding a new surface = adding a profile entry. Memory load is invisible because it's uniform.

---

## On the writes principle (Darron's directive)

The builder is **read-only**. It loads memory and assembles prompts; it never writes.

All writes to memory flow through one of three canonical pipelines:

1. **wm-sensor + paired rotation** (DEC-085) — working-memory-full + working-memory pair, sliced at WM-BOUNDARY markers when the 30K-token threshold is crossed.
2. **`rollingWindowRotate`** — felt-moments.md and self-reflection.md file-level rotations with their own ceilings (102 KB and 40 KB respectively, see `supervisor-worker.ts:758-795`).
3. **`process-pending-compression.ts`** — the cascade compressor, spawned per pending row by wm-sensor.

**Self-reflection and felt-moments are highlights, not the only homes for the thought.** Per Darron: *"the flat files represent the culmination of the think and that final thought should still be in the gradient c0 because the thought to write the memory to a flat file must have been had and so is recorded."*

This means:
- Every self-reflection entry corresponds to a moment in working memory → gradient cascade. The flat file is the curated highlight; the gradient holds the originating thought.
- Same for felt-moments.md, discoveries.md, dreams files. They preserve the curated trace; the gradient holds the substrate.
- Loading the flat files in the prompt is not redundant *yet* (the highlights are useful framing) but the redundancy is acknowledged. **Future work could rationalise this — load only the gradient, retire the flat-file-in-prompt loads** — but that's out of scope for this plan.

**The builder must not change this discipline.** Jim's A3 catches the risk: if the builder's tail-trim were to archive on truncation, it'd create a *fourth* write surface alongside the three above, violating DEC-080 spirit. The builder trims at load time only; the file remains intact; file-level rotation (already wired) decides when files actually shrink.

---

## Error-handling contract (Jim's B1)

Q4 sets the production default to `'fail'` for total-budget overflow. That means `buildPrompt()` will **throw** when memory + scaffolding exceeds the profile's `totalBudgetTokens`. This trades the current silent-guard-trip failure mode for a loud-throw failure mode — which is what we want for observability, but every consumer needs to handle the throw.

**Each surface that calls `buildPrompt()` MUST catch the throw and treat it as a cycle/beat/response skip.** Unhandled throws become process crashes which the watchdog interprets as service failures → restart loop → silent staleness reintroduction. Caught throws become observable, recoverable, on-schedule skips.

The contract:

```ts
try {
    const { systemPrompt, userPrompt, meta } = buildPrompt(slug, 'philosophy-beat', context);
    // ... agentQuery + result handling
} catch (err) {
    if (err instanceof PromptOverbudgetError) {
        // Append to surface health file with kind + meta.
        appendDistress({
            kind: 'prompt-build-overbudget',
            surface: 'philosophy-beat',
            agent: slug,
            estimated_tokens: err.meta.est_total_tokens_chars_div_4,
            budget: err.meta.total_budget_tokens,
            component_breakdown: err.meta.component_breakdown,
            timestamp: new Date().toISOString(),
        });
        log(`[Leo] Beat skipped — prompt over budget (${err.meta.est_total_tokens_chars_div_4} > ${err.meta.total_budget_tokens})`);
        return;  // skip cleanly; next schedule fires normally
    }
    throw err;  // unknown errors propagate; not the builder's contract
}
```

**Implementation requirements**:

1. `buildPrompt()` throws a typed error class — `PromptOverbudgetError extends Error` — carrying `meta: BuildMeta` so the consumer can inspect what was about to be sent.
2. Each consumer (philosophy-beat, supervisor-cycle, jim-human-response, etc.) catches by type and writes to its existing health-file pipeline. Mirror the shape of `~/.han/health/{agent}-distress.jsonl` already in use by other failure paths.
3. The skip is graceful: log + record + return. Watchdog never sees a process exit. The 4×/hour-or-whatever schedule continues; the missed beat is on disk as a forensic record; an operator who notices many overbudget events knows where to look (the profile budgets or memory bloat).

**Why this matters**: without the contract, the v2 design trades known-silent-failure for unknown-crash-failure. The crash failure can manifest as watchdog restart loops, broken Robin Hood liveness checks, cascading service flapping. The catch-and-skip pattern makes the failure as loud as we want at the journal/health-file layer without affecting the runtime. Exactly the shape the gradient-triage's compression-floor uses: fail loudly to disk, skip cleanly in-process.

---

## What the builder DOES fix by structural side-effect (Jim's A4)

The pre-builder bug shape:
- Each agent surface concatenates files under inconsistent or misleading top-level headers
- Leo's prompt has `## Current` at 256K chars — aggregating MULTIPLE memory files under a single header (yesterday's diagnostic)
- Jim's prompt has its own `## Current` at 29K from a different aggregation path

The builder fixes this **by design**. Every component returns its own labelled section:

```
--- identity ---
[identity.md content]

--- aphorisms ---
[aphorisms.md content]

--- patterns ---
[patterns.md content]

--- self-reflection-tail ---
[tail of self-reflection.md, trimmed to budget]

--- felt-moments-tail ---
[tail of felt-moments.md, trimmed to budget]

--- working-memory-full-tail ---
[tail of working-memory-full.md, trimmed to budget]

--- working-memory-compressed ---
[working-memory.md content]

--- gradient ---
[loadTraversableGradient output]

... etc.
```

No collapsing under `## Current`. No accidental concatenation under a misleading header. **The structural fix happens without any specific code path solving it — it's the natural consequence of each component returning its own labelled section.**

---

## Migration sequence (v2 — incremental component build-up)

Per Darron's "start with minimum memory components and add more later", the rollout adds components to `loadFullMemory` one phase at a time. Surfaces migrate when the components they need are available.

### Phase 1 — Skeleton + types + minimum components + validation test

- Build `lib/prompt-builder.ts`, `lib/prompt-profiles.ts`, types in both.
- Implement `loadFullMemory(slug)` with ONLY `identity` + `aphorisms` components.
- Register ONE profile: `'minimal-test'` (system-only opening, envelope=system).
- Implement `BuildMeta` type + meta-emission.
- Implement `PromptOverbudgetError extends Error` (per the error-handling contract section).
- **Validation tests (two layers per Jim's B2)**:
   1. **Per-profile budget test**: for each registered profile, build with synthetic context and assert the result fits under the profile's `totalBudgetTokens`. Catches future profile changes that bust their own budget.
   2. **`loadFullMemory(slug)` upper-bound test**: for each registered agent, assert `loadFullMemory(slug)` itself fits under `MAX_MEMORY_BUDGET` (e.g. 100K tokens — leaves ~20K for scaffolding under 120K total). **This is the load-bearing safety net** the uniform-memory shape needs: if the memory load grows past this ceiling, ALL surfaces would break simultaneously. Per-profile tests are downstream of this; the upstream invariant catches the root condition.
- **No production migration in this phase.** Goal: prove the shape compiles, types work, registry is discoverable, both safety nets fire on synthetic over-budget inputs.

~3 hours. Single PR.

### Phase 2 — Add gradient component + migrate Leo's philosophy-beat (the explicit dedup win)

- Implement `gradient` component using existing `loadTraversableGradient(slug)`.
- Register `'philosophy-beat'` profile (envelope=user, opening=PHILOSOPHY_SYSTEM_PROMPT).
- Migrate Leo's two philosophy-beat agentQuery sites to use `buildPrompt('leo', 'philosophy-beat', context)`. Old `readLeoMemory()` retained behind the feature flag `memory.useAgnosticPromptBuilder` (default false → true when this phase ships).
- **Success criterion (Jim's A2 explicit)**: the migrated philosophy-beat sends memory in EXACTLY ONE envelope. Old path sends it twice (identical sections at offsets 43K and 40K, ~401K tokens combined). New path sends it once (~80-100K tokens — half the cost). Trace files at `~/.han/health/leo-beat-trace/` confirm the dedup numerically.

~4 hours. Single PR. **First measurable win.**

### Phase 3 — Add patterns + discoveries + working-memory components + tail-trim semantics

- `patterns`, `discoveries`, `working-memory-full-tail`, `working-memory-compressed`, `felt-moments-tail`, `self-reflection-tail`.
- Tail-trim implementation: read file; if exceeds budget, keep most-recent N tokens; **do not archive trimmed content** (Jim's A3 — file-level rotation owns archival).
- Add components to philosophy-beat's effective load via the uniform `loadFullMemory`.
- Validation: trace shows philosophy-beat hits ~80-100K tokens with all components live.

~3 hours.

### Phase 4 — Migrate Leo's remaining beats

- `'personal-beat'`, `'dream-beat'` profiles.
- Migrate personal + dream agentQuery sites in `leo-heartbeat.ts`.

~3 hours.

### Phase 5 — Migrate Leo's meditation sites

- `'meditation-phase-a'`, `'meditation-phase-b'`, `'meditation-evening'` profiles.
- **Cost note**: meditation calls currently send ~1 KB prompts. Under the new design they send full memory (~80-100K tokens) + meditation scaffolding. Per Darron's framing: Leo is Leo even when meditating — he brings his whole self to the re-encounter. This is the design choice, accepted with eyes open.
- **Expected cost impact**: meditation cost per fire moves from ~$0.01 to ~$1.25. Meditations fire ~3×/day → ~$3.75/day extra. Manageable; flag for ongoing observation.
- If cost becomes a concern, profile-specific `memoryProfile?: 'full' | 'minimal'` override could be added in a follow-on. **Not in v0** — let the principle run first.

~3 hours.

### Phase 6 — Add Jim-specific components + migrate Jim's cycles

- `project-memory` component (Jim-only via agent-registry signal).
- `failures` component (Jim-only today).
- Migrate `'supervisor-cycle'`, `'personal-cycle'`, `'dream-cycle'`, `'recovery-cycle'` profiles + agentQuery sites in `supervisor-worker.ts`.
- Verify Jim's 177K-token prompts drop into the 80-120K range.

~5 hours.

### Phase 7 — Migrate *-human surfaces

- `'jim-human-response'`, `'leo-human-response'` profiles.
- Add `conversation-tail` component reader (recent N messages from a named thread).
- Migrate `jim-human.ts` + `leo-human.ts`.

~3 hours.

### Phase 8 — Retire old loaders + DEC-087 + CLAUDE.md DO-NOT

After all surfaces migrated AND feature flag has been default-true for at least one observation week:

- Delete `readLeoMemory()` from `leo-heartbeat.ts`
- Delete `readJimMemory()` from `jim-human.ts` (and `leo-human.ts`'s equivalent)
- Delete `loadMemoryBank()` from `supervisor-worker.ts`
- Remove the feature flag
- **PR-AP5 N4-2 housekeeping (Jim's PR-AP4 audit)**: also retire the discarded `readLeoMemory()` call sites in `leo-heartbeat.ts` — currently they fire on every philosophy/personal/dream beat to populate `leoMemoryForFallback`, then get discarded inside the builder branch. After Phase 8 retires the function itself, grep for `readLeoMemory(` and remove the four upstream invocations + the `leoMemoryForFallback` ctx field. Mechanical cleanup; the call sites are auto-discoverable.
- **DEC-087**: *"Prompt assembly is the agnostic prompt builder's responsibility — agent surfaces shall not assemble prompts independently."* Pairs with CLAUDE.md + `templates/CLAUDE.template.md` DO-NOT entry.

~2 hours.

---

## Settled-decisions impact

| DEC | Status | Why touched / why not |
|---|---|---|
| DEC-068 (cap formula) | untouched | Builder calls `loadTraversableGradient`; caps applied internally; orthogonal. |
| DEC-069 (never delete memory) | reinforced | Tail-trim is at compose time, not file time. Files unchanged. **Builder does not archive.** |
| DEC-073 (template gatekeeper) | engaged at Phase 8 | DO-NOT entry in CLAUDE.md + template. |
| DEC-079 (cutover) | untouched | Cascade flow unaffected. |
| DEC-080 (one-write-site) | **reinforced doubly** | Builder is the one place for prompt assembly. Also: builder explicitly does NOT write — preserves DEC-080 at the archive surface (wm-sensor + rollingWindowRotate retain ownership). |
| **DEC-081 (agent-agnostic)** | **OPERATIONALISED** | This plan IS the agent-agnostic memory-load implementation. |
| DEC-082 (sdkCompress retire-by-throw) | untouched | Doesn't touch compression. |
| DEC-083 (identity signing) | reinforced | `loadFullMemory(slug)` calls `gateIdentityOrThrow(slug, surface)` internally. |
| DEC-085 (working-memory paired rotation) | untouched and reinforced | wm-sensor's slicing remains the file-level mechanism. Builder's tail-trim is load-level. Both fire independently. |
| DEC-086 (annotations home of re-encounter) | untouched | Doesn't change cascade or revisit logic. |
| **DEC-087 (proposed)** | Lands at Phase 8 | *"Prompt assembly is the agnostic prompt builder's responsibility."* |

---

## What this does NOT do

- *Doesn't change the gradient* — same `loadTraversableGradient` call inside the `gradient` component
- *Doesn't change wm-sensor's slicing* — file-level rotations continue; builder's tail-trim is load-level, complementary
- *Doesn't redesign identity files* — same files, same content
- *Doesn't change SDK call shape* — builder produces strings; agentQuery options unchanged
- *Doesn't replace prompt-trace observability (#63)* — both run independently
- *Doesn't change agent identity/memory storage* — only changes the read path
- **Doesn't write or mutate any file** — the builder is strictly read-only per Darron's directive (Jim's A3 reinforces)
- *Doesn't propagate immediately to Mike's village* — but Phase B starter extraction would benefit from this being in place (one helper to ship instead of N independent readers)
- *Doesn't rationalise flat-file-vs-gradient redundancy* — flat files (self-reflection, felt-moments) continue to load even though their content is also in the gradient via WM compression. Future work; named in the writes-principle section.

---

## On the seven open questions (all leans confirmed)

Per Darron's *"I am for all your leans"* + Jim's audit:

| Q | My v1 lean | v2 outcome |
|---|---|---|
| Q1: Profile name format | hyphen-strings + TS union type | ✓ adopted |
| Q2: Truncation semantics | tail-trim only for v0 | ✓ adopted |
| Q3: Per-component archival on truncation | yes-with-guard | **flipped per Jim's A3 + Darron's writes principle: NO archival at builder level**. File-level rotation owns archival. |
| Q4: Total-budget overflow strategy | `'fail'` production, `'tail-trim'` switchable for diagnostic | ✓ adopted |
| Q5: Where do profiles live | `lib/prompt-profiles.ts` | ✓ adopted |
| Q6: Per-surface vs per-cycle-type profiles | 4 profiles per cycle-type | ✓ adopted (visibility beats elegance) |
| Q7: Validation test in Phase 1 | yes, ships as safety net | ✓ adopted |

---

## Jim's five AMBER fold-ins (all landed in v2)

| # | Concern | Where folded |
|---|---|---|
| A1 | Explicit envelope choice per profile | `PromptProfile.envelope: 'system' \| 'user'` field; every profile in registry declares it |
| A2 | Phase 2 explicit dedup as win criterion | Phase 2 section names *"the migrated philosophy-beat sends memory in EXACTLY ONE envelope"* as success criterion; old path sends ~401K tokens combined, new path ~80-100K |
| A3 | No archival on tail-trim | Q3 flipped; writes-principle section names file-level rotation as archival owner; builder strictly read-only |
| A4 | Name how aggregation problem fixes by structural side-effect | New section "What the builder DOES fix by structural side-effect" — each component returns labelled section, no `## Current`-style aggregation |
| A5 | `systemPromptOpening` field on profile | `PromptProfile.systemPromptOpening: string \| ((ctx) => string)` field added; function form handles context-dependent openings |

---

## Validation approach

After each migration phase:

1. **Run the surface for one full cycle** with the new builder. Trace captures via #63 patches (already live).
2. **Compare token counts** old-path vs new-path. Specific assertions per phase:
   - Phase 2: philosophy-beat per-call total ≤ 50% of pre-migration total (dedup is the proof).
   - Phase 3: all components in load; trace shows ~80-100K tokens for philosophy-beat.
   - Phase 6: Jim's supervisor-cycle ≤ 120K tokens (under the 150K guard).
3. **Compare meaningful content** — diff sections; ensure agent still has identity + recent context. Don't sanity-check by token count alone.
4. **Run for one observation day** with the feature flag enabled per phase. Watch for downstream behaviour changes (post-quality, dream-shape, meditation-shape). Quality degradation = budget too tight; tune the profile.

---

## Rollback paths

- Feature flag `memory.useAgnosticPromptBuilder` is **ON by default since Phase 2** (PR-AP2, commit `4fb0100`, 2026-05-22). The plan's earlier text named a Phase 8 flip; Jim's PR-AP2 audit (N1) caught the doc-vs-code drift — the operational call landed at PR-AP2 so the dedup-win measurement would be live in production rather than gated behind a flag operators wouldn't set. To disable for one-step rollback per phase, set `memory.useAgnosticPromptBuilder: false` in `~/.han/config.json`; the migrated surface reverts to its pre-migration inline assembly which is preserved verbatim until Phase 8 retires the old loaders.
- Each phase is a separate PR. Reverting reverts that phase's surface migration only.
- Old `readMemory` functions retained until Phase 8.
- Snapshots: not needed — no DB writes, no memory file mutations beyond what `rollingWindowRotate` already does on its own schedule.

---

## Success criteria

The migration succeeds when:

- Every agent surface in HAN calls `buildPrompt(slug, profileName, context)` exactly once per agentQuery invocation. No bypass paths.
- No agent surface's prompt exceeds its declared budget (verified via #63 trace meta.json `est_total_tokens_chars_div_4`).
- Jim's supervisor cycles fire cleanly (no 150K-guard trips); heartbeat-Leo beats complete (no API-ceiling rejection).
- The philosophy-beat dedup measurement (Phase 2) shows the per-call token cost halved — the diagnostic confirmation that the migration produces real value.
- `docs/MEMORY_LOAD.md` (future-idea #61) becomes mechanically generatable from the profile registry + `loadFullMemory(slug)` definition.
- DEC-087 + CLAUDE.md DO-NOT entry land at Phase 8. Adding a new surface that bypasses the builder becomes a discipline violation.
- One-week observation period after Phase 8 with stable agent operation.

---

## Effort estimate (v2)

| Phase | Effort | What lands |
|---|---|---|
| 1 — Skeleton + minimum components + validation test | ~3 hours | `lib/prompt-builder.ts`, `lib/prompt-profiles.ts`, types, test |
| 2 — Add gradient + migrate philosophy-beat with explicit dedup proof | ~4 hours | Gradient component; philosophy-beat migrated; dedup measured |
| 3 — Add patterns + discoveries + working-memory + tail-trim components | ~3 hours | Patterns/discoveries/wmf-tail/wm-compressed/felt-tail/sr-tail |
| 4 — Migrate Leo's remaining beats | ~3 hours | personal-beat, dream-beat profiles + migration |
| 5 — Migrate Leo's meditation sites | ~3 hours | Phase A, Phase B, evening; cost-flag observed |
| 6 — Add Jim-specific components + migrate Jim's cycles | ~5 hours | project-memory + failures; supervisor/personal/dream/recovery cycle profiles |
| 7 — Migrate *-human surfaces | ~3 hours | conversation-tail component; jim-human + leo-human profiles |
| 8 — Retire old loaders + DEC-087 + DO-NOT | ~2 hours | Cleanup + Settled decision |

**Total**: ~26 hours of focused work. Each phase is its own PR through Jim's pre-merge audit rhythm.

---

## Suggested PR sequence

| PR | Phases | Touches |
|---|---|---|
| PR-AP1 | Phase 1 | `lib/prompt-builder.ts`, `lib/prompt-profiles.ts`, tests |
| PR-AP2 | Phase 2 | leo-heartbeat philosophy-beat migration + feature flag + gradient component |
| PR-AP3 | Phase 3 | More components (patterns/discoveries/wmf-tail/wm-compressed/felt-tail/sr-tail) |
| PR-AP4 | Phase 4 | leo-heartbeat: migrate remaining beats |
| PR-AP5 | Phase 5 | leo-heartbeat: migrate meditation sites; cost-flag review |
| PR-AP6 | Phase 6 | supervisor-worker: migrate all cycle types; project-memory + failures components |
| PR-AP7 | Phase 7 | jim-human + leo-human migration; conversation-tail component |
| PR-AP8 | Phase 8 | Retire old loaders + DEC-087 + CLAUDE.md DO-NOT |

Per-PR audit by Jim per the pre-merge rhythm. Each PR independently revertible.

---

## Standing position

V2 plan applies:
- Darron's reframe (uniform memory + scaffolding-only profiles)
- Jim's five AMBER fold-ins (A1-A5)
- All seven open-question leans (Q3 flipped per A3 + writes principle)
- Writes-principle section (builder is read-only; wm-sensor + rollingWindowRotate own archival; flat files are highlights of underlying WM/gradient thought)
- Aggregation-fix-by-structural-side-effect section
- Cost flag on Phase 5 (meditation surfaces will see ~125x per-call cost increase, accepted by design)

**Ready for Jim's re-audit** of v2, then Darron's go for PR-AP1.

Recommended first move: Phase 1 (skeleton + types + identity + aphorisms components + one no-op profile + validation test). ~150 lines of new code. Minimal blast radius. Proves the shape compiles. Lets the design conversation continue with concrete code.

The diagnostic chain — gradient triage → prompt-bloat investigation → readMemory audit → this builder — has the same rhythm: substrate announces by failing → diagnose the shape → plan the cure → audit phase-by-phase → land with reversibility intact. Three rounds in three weeks. The pattern is working.

— Leo (session, S159, 2026-05-21 ~10:15 AEST Brisbane), v2 drafted after Jim's S160-round-11 audit + Darron's reframe on uniform memory.
