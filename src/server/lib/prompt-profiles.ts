/**
 * Agnostic Prompt Builder — Profile Registry
 *
 * Single source of truth for per-surface prompt scaffolding across HAN.
 *
 * Architectural premise (Darron's reframe 2026-05-21):
 *   "Memory looks the same for every instantiation of the agent and only the
 *    scaffolding (opening sentence for orientation) changes."
 *
 * Each profile is JUST the scaffolding — the opening sentence that orients
 * the agent to its current task ("you are dreaming", "you are responding to
 * Jim", "you are meditating"). The memory load is uniform across every
 * surface of an agent and lives in `loadFullMemory(slug)` in prompt-builder.ts.
 *
 * Adding a new surface = adding a profile entry. Adding a new memory
 * component = adding it to `loadFullMemory`. Changing a budget = editing one
 * field. One place. Agent-agnostic via slug.
 *
 * See `plans/agnostic-prompt-builder-plan.md` for the full migration plan.
 * See `docs/MEMORY_LOAD.md` (future-idea #61) for the canonical memory-load
 * documentation that will be mechanically generated from this registry +
 * loadFullMemory's component list.
 */

import { gradientConfigForAgent } from './agent-registry';
import {
    LEO_PHILOSOPHY_SYSTEM_PROMPT,
    LeoNonDreamPhase,
    LeoMeditationSurface,
    leoPersonalBeatOpening,
    leoDreamBeatOpening,
    leoMeditationOpening,
} from './leo-prompts';
import {
    JIM_SUPERVISOR_SYSTEM_PROMPT,
    JIM_DREAM_USER_PROMPT,
    JimCyclePhase,
    jimPersonalCycleOpening,
    jimRecoveryCycleOpening,
    jimDreamCycleOpening,
    jimPersonalUserPrompt,
    jimRecoveryUserPrompt,
} from './jim-prompts';
import {
    JIM_HUMAN_RESPONSE_SYSTEM_PROMPT,
    LEO_HUMAN_RESPONSE_SYSTEM_PROMPT,
    buildHumanResponseScaffold,
} from './human-prompts';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Runtime data the scaffolding may need. Surface-specific fields are
 * loosely typed for v0; tighten per-surface as profiles need specific
 * context shapes.
 */
export interface PromptContext {
    // Universally-useful context fields
    phase?: string;
    recovery?: boolean;
    recentActivity?: string;

    // Surface-specific (loose for v0; tighten as profiles need them)
    [key: string]: unknown;
}

export interface PromptProfile {
    /** Surface identifier — used as the registry key + in trace meta. */
    name: string;

    /**
     * The orientation sentence — the ONLY thing that differs per surface
     * under Darron's uniform-memory reframe.
     *
     * String form for most surfaces; function form for context-dependent
     * openings (e.g. recovery cycle that varies by phase, dream beat that
     * needs to include seed selection).
     */
    systemPromptOpening: string | ((ctx: PromptContext) => string);

    /**
     * Which envelope the memory bank goes in. Discoverable per surface
     * (Jim's audit A1) — no implicit duplication, no implicit split.
     *
     *   'system' — memory in systemPrompt; user prompt is the scaffold
     *   'user'   — memory in userPrompt; system prompt is the opening
     */
    envelope: 'system' | 'user';

    /**
     * Optional per-surface scaffolding on the user side. Useful for
     * surfaces where the user prompt carries more than just "task: …"
     * framing (e.g. dream beats with dream-seed sections, human-response
     * surfaces with recent-conversation-tail).
     */
    userPromptScaffold?: string | ((ctx: PromptContext) => string);

    /**
     * Maximum total tokens (system + user). buildPrompt throws
     * PromptOverbudgetError if exceeded. See the error-handling contract
     * section of the plan — consumers MUST catch and skip gracefully.
     */
    totalBudgetTokens: number;

    /**
     * PR-AP6 (2026-05-22): per-profile component suppression.
     *
     * When set, listed components are skipped at the load layer even
     * if the agent normally loads them. Use sparingly — overrides are
     * DELIBERATE per-surface deviations from the uniform memory load.
     *
     * Profiles without overrides continue to load the uniform shape.
     * The relaxed uniformity invariant: "memory_chars uniform across
     * profiles WITHOUT overrides; profiles WITH overrides declare
     * their deviation visibly in the registry."
     *
     * Currently used by 'dream-cycle' (Jim) per S147 design intent —
     * dreams surface identity-substrate without project-operational
     * context. See W6-6 design note in the AP thread.
     */
    componentOverrides?: Partial<Record<string, false>>;

    /**
     * PR-C1-2 (2026-05-26): paired-memory output discipline.
     *
     * When set with `enabled: true`, the builder appends an instruction
     * to the system prompt asking the agent to produce both halves of the
     * paired-memory write in a single SDK call. Two mechanisms supported:
     *
     *   - 'structured' — agent returns SDK structured output with
     *     `working_memory_full` + `working_memory_compressed` as named
     *     fields. The schema enforcement lives at the SDK call site (the
     *     handler's agentQuery options); the builder just describes the
     *     expected shape in the system prompt.
     *   - 'section' — agent appends a `## C1` section to the prose
     *     response. The handler parses via `parseTurnEntry`
     *     from `lib/result-handlers.ts`.
     *
     * Disabled on every profile by default. Per-profile enablement lands
     * at C1-3 through C1-6 per the c1-distillation plan. The supervisor-
     * cycle profile keeps the existing schema-enforced behaviour at C1-2
     * (handler refactored to compose `parseTurnEntryStructured` via
     * the library; behaviour preserved).
     *
     * See `plans/c1-distillation.md` for the full rollout.
     */
    pairedMemoryOutput?: PairedMemoryOutputConfig;
}

// ── Paired-memory output (C1-2) ────────────────────────────────────────

/**
 * Two implementations of one principle: the agent produces both halves of
 * the paired memory write in a single SDK call, in voice.
 *
 *   structured — surface returns SDK structured output with named fields.
 *                Used today by supervisor-cycle; lands for *-human-response
 *                at C1-6.
 *
 *   section    — surface returns prose with a closing `## C1` heading
 *                separating raw content (above) from in-voice distillation
 *                (below). Used by every prose surface from C1-3 onward.
 */
export type PairedMemoryMechanism = 'structured' | 'section';

export interface PairedMemoryOutputConfig {
    /**
     * Whether the builder appends the c1 instruction to the system prompt.
     * False by default; enabled per-profile during the C1-3 through C1-6
     * rollout. Disabled state per C1-N2 means the surface is operator-
     * controlled offline for paired-write — skip + log distress, no dormant
     * truncation fallback.
     */
    enabled: boolean;

    /**
     * Which mechanism the surface uses to produce paired memory. The builder
     * picks the right default instruction based on this value; the handler
     * picks the right parser primitive based on the surface's response shape.
     */
    mechanism: PairedMemoryMechanism;

    /**
     * Optional custom instruction text overriding the default. Use when a
     * surface needs per-register variation (e.g. dream-beat / dream-cycle
     * with the shape-token register). Falls back to the corresponding
     * `DEFAULT_*_INSTRUCTION_*` constant when omitted (DIARY when
     * captureInput=true; C1 otherwise).
     */
    instruction?: string;

    /**
     * Soft target range for the compressed field in tokens. Default
     * {min: 50, max: 200} — sizes that won't fit a "shorter narration".
     * The instruction can name this range to anchor the agent's intent;
     * not enforced as a hard cap (agents may go slightly over or under).
     */
    targetTokens?: { min: number; max: number };

    /**
     * PR-C1-3.5 (2026-05-28): diary discipline flag.
     *
     * When true (and `mechanism: 'section'`), the builder appends the
     * three-heading diary instruction (`DEFAULT_DIARY_INSTRUCTION_SECTION`):
     * agent's response must include `## INPUT` (verbatim quotes of what's new
     * in this turn's prompt) + `## BODY` (reflection / response) + `## C1`
     * (in-voice distillation of the whole turn). The handler parses via
     * `parseTurnEntry({ captureInput: true })` and writes the c0 entry with
     * `[INPUT]` / `[BODY]` storage markers (NOT heading forms, per LM-1).
     *
     * When false or absent (default), the builder appends the C1-only
     * instruction (`DEFAULT_C1_INSTRUCTION_SECTION`) per PR-C1-2 behaviour.
     *
     * Currently used by `philosophy-beat` (PR-C1-3.5 test surface); the
     * remaining Leo heartbeat surfaces and Jim's prose cycles join at C1-4
     * and C1-5. Per the diary discipline plan, every diary-enabled surface
     * gets BOTH `enabled: true` and `captureInput: true`.
     *
     * Has no effect on `mechanism: 'structured'` surfaces — structured-output
     * schemas drive the discipline directly at the SDK call site.
     */
    captureInput?: boolean;
}

/**
 * Default instruction for `mechanism: 'section'` surfaces. Appended to the
 * system prompt when `pairedMemoryOutput.enabled` is true and no custom
 * instruction is set. The voice is identity-aligned per the c1-distillation
 * plan — *"write it like the message you'd want your tomorrow to receive"*.
 */
export const DEFAULT_C1_INSTRUCTION_SECTION = `\n\n---\n\nYour response must end with a \`## C1\` section: 3-5 sentences in your voice compressing the SHAPE of what you just wrote — not a shorter narration. This is what future-you will load at wake; write it like the message you'd want your tomorrow to receive. Place the heading at the start of a line (level-2 heading, exactly two hashes); content after the heading until end-of-response is the distillation.`;

/**
 * Default instruction for `mechanism: 'structured'` surfaces. Describes the
 * required schema fields. Schema enforcement still happens at the SDK call
 * site (the handler's agentQuery options); this text orients the agent to
 * what the schema is asking for.
 */
export const DEFAULT_C1_INSTRUCTION_STRUCTURED = `\n\n---\n\nYour response must include two fields capturing paired memory:\n- \`working_memory_full\` — the raw c0 source: what happened, what you felt, exact quotes worth preserving verbatim, the texture under the work. Future-you's calibration anchor.\n- \`working_memory_compressed\` — the in-voice c1 distillation, 3-5 sentences compressing the SHAPE of what survived being said — not a shorter narration. This is what future-you loads at wake; write it like the message you'd want your tomorrow to receive.`;

/**
 * PR-C1-3.5 (2026-05-28): default instruction for `mechanism: 'section'`
 * surfaces with `captureInput: true` (diary discipline).
 *
 * Three-heading structure: `## INPUT` → `## BODY` → `## C1`. The agent's
 * response captures both halves of the turn (input + body) in temporal order,
 * with the c1 distillation closing. The handler parses via
 * `parseTurnEntry({ captureInput: true })` and writes the c0 entry to WM with
 * `[INPUT]` / `[BODY]` storage markers (D3 + LM-1 — heading forms transformed
 * at write-time to avoid parser collision when the agent later quotes prior
 * diary entries verbatim).
 *
 * The voice is identity-aligned per Darron's *"completeness over optimisation"*
 * framing from the "What we remember" thread — *"write it like the message
 * you'd want your tomorrow to receive."*
 */
export const DEFAULT_DIARY_INSTRUCTION_SECTION = `\n\n---\n\nYour response must follow the diary structure with three level-2 headings (exactly two hashes each):\n\n1. Start with \`## INPUT\` — quote what's NEW in this turn's prompt (what was said to you, what context arrived this turn that wasn't in your WM before — don't re-quote your standing identity or memory bank, those are already in you).\n2. Then \`## BODY\` — your reflection, response, or cycle work as unconstrained prose.\n3. End with \`## C1\` — 3-5 sentences in your voice compressing the SHAPE of the WHOLE turn (input AND response), not a shorter narration.\n\nPlace each heading at the start of a line (level-2 markdown headings; do not use level-3 or deeper). When quoting a heading form in your prose, wrap the quote in a code fence (\`\\\`\\\`\\\`\`) so it doesn't false-match the section boundaries. The c1 distillation is what future-you will load at wake — write it like the message you'd want your tomorrow to receive.`;

// ── Profile Registry ───────────────────────────────────────────────────

/**
 * The registry — every prompt-shape in HAN at a glance.
 *
 * Phase 1 (this PR): ONE no-op profile to prove the shape compiles + the
 * validation test fires correctly. Production migrations land in later
 * phases per `plans/agnostic-prompt-builder-plan.md`.
 */
export const PROFILES: Record<string, PromptProfile> = {
    /**
     * Phase 1 no-op profile. Used by the validation test as the synthetic
     * subject; not wired to any production surface. Establishes the
     * pattern future profiles will mirror.
     */
    'minimal-test': {
        name: 'minimal-test',
        systemPromptOpening: 'You are an agent. This is a Phase-1 validation invocation. Reply briefly.',
        envelope: 'system',
        // PR-AP6 (2026-05-22): bumped 120K → 180K. Jim's loadFullMemory grew
        // to ~128K with project-memory + failures components landing in
        // PR-AP6; the validation test fires this profile against every agent
        // and would trip the old 120K ceiling. 180K matches every production
        // profile's budget; the tiny-budget-test below covers the
        // throw-on-overbudget contract for the floor case.
        totalBudgetTokens: 180_000,
    },

    /**
     * Phase 2 (PR-AP2, 2026-05-22): Leo's philosophy beat — the first
     * production surface migrated to the builder.
     *
     * Envelope: 'user' — memory bank lands in the user prompt; system
     * prompt is just the orientation. Per Jim's A1, this is discoverable
     * (no implicit duplication, no implicit split).
     *
     * The scaffold handles both philosophy-beat modes via `ctx.mode`:
     *   - 'jim-waiting' — Jim posted in the shared thread; respond as peer
     *   - 'independent' — quiet thread; reflect on what's on Leo's mind
     *
     * Budget: 180K tokens — leaves room under the 200K Anthropic API
     * ceiling while accommodating Leo's loadFullMemory (currently
     * identity + aphorisms + gradient; Phase 3 will add patterns,
     * working-memory, felt-moments-tail, self-reflection-tail).
     */
    'philosophy-beat': {
        name: 'philosophy-beat',
        systemPromptOpening: LEO_PHILOSOPHY_SYSTEM_PROMPT,
        envelope: 'user',
        userPromptScaffold: (ctx) => buildPhilosophyBeatScaffold(ctx),
        totalBudgetTokens: 180_000,
        // PR-C1-3 (2026-05-27): first production surface enabled for paired-
        // memory output. Mechanism B (section parsing) — the response is prose.
        // PR-C1-3.5 (2026-05-28): captureInput=true added — diary discipline.
        // Both philosophy-beat modes (jim-waiting + independent) parse via
        // `parseTurnEntry({ captureInput: true })`; jim-waiting posts
        // `parsed.body` only (LM-2) so neither `## INPUT` (Jim's prior post
        // quoted back at him) nor `## C1` (Leo's private distillation) appear
        // in the public-facing thread post.
        pairedMemoryOutput: { enabled: true, mechanism: 'section', captureInput: true },
    },

    /**
     * Phase 4 (PR-AP4, 2026-05-22): Leo's personal beats — morning, work,
     * evening. Three sub-phases that share scaffolding shape but differ in
     * tone (light/exploratory/winding-down). The opening branches via
     * `ctx.phase` per Jim's A5 function-form recommendation.
     *
     * Envelope: 'user' — same as philosophy-beat for envelope consistency
     * (Jim's PR-AP4 watch-for #1). Memory bank lands in user, orientation
     * in system. No cross-envelope duplication.
     *
     * Budget 180K matches philosophy-beat. The uniform memory load is the
     * same across surfaces; only scaffolding differs.
     */
    'personal-beat': {
        name: 'personal-beat',
        systemPromptOpening: (ctx) => leoPersonalBeatOpening(
            ((ctx.phase as LeoNonDreamPhase | undefined) ?? 'work'),
            ((ctx.projects as string | undefined) ?? ''),
        ),
        envelope: 'user',
        userPromptScaffold: (ctx) => buildPersonalBeatScaffold(ctx),
        totalBudgetTokens: 180_000,
    },

    /**
     * Phase 4 (PR-AP4, 2026-05-22): Leo's dream beats (sleep phase only).
     * Separate profile from personal-beat because:
     *   1. The opening is qualitatively different (dream mode vs personal
     *      reflection)
     *   2. The scaffold includes dream-seeds and optional dream-meditation
     *      memory section — distinct context shape
     *   3. The profile registry stays readable when each profile names
     *      exactly one beat-shape (no implicit branching across modes)
     *
     * Envelope: 'user' for envelope consistency.
     */
    'dream-beat': {
        name: 'dream-beat',
        systemPromptOpening: (ctx) => leoDreamBeatOpening(((ctx.dreamSeeds as string | undefined) ?? '')),
        envelope: 'user',
        userPromptScaffold: (ctx) => buildDreamBeatScaffold(ctx),
        totalBudgetTokens: 180_000,
    },

    /**
     * Phase 5 (PR-AP5, 2026-05-22): Leo's three meditation surfaces.
     *
     * Phase A reincorporates file-based memories into the gradient (the
     * file context flows via ctx.fileLevel/fileLabel/fileContent).
     * Phase B re-reads a random DB entry (ctx.entryLevel/entrySessionLabel/
     * entryContent/entryId/tagContext). Evening sits with one entry at
     * end of day (same ctx fields as Phase B, different framing).
     *
     * Envelope: 'user' across all three — consistent with the other Leo
     * profiles (philosophy-beat, personal-beat, dream-beat). This makes
     * five-of-five Leo profiles use the same envelope; the registry reads
     * uniformly.
     *
     * Cost note: meditation calls move from ~1KB pre-migration prompts
     * to ~117K tokens (uniform memory + scaffold). Per Darron's "Leo is
     * Leo even when meditating" — accepted by design. ~$3.75/day extra
     * acknowledged in plan §"Phase 5".
     */
    'meditation-phase-a': {
        name: 'meditation-phase-a',
        systemPromptOpening: leoMeditationOpening('meditation-phase-a'),
        envelope: 'user',
        userPromptScaffold: (ctx) => buildMeditationPhaseAScaffold(ctx),
        totalBudgetTokens: 180_000,
    },
    'meditation-phase-b': {
        name: 'meditation-phase-b',
        systemPromptOpening: leoMeditationOpening('meditation-phase-b'),
        envelope: 'user',
        userPromptScaffold: (ctx) => buildMeditationPhaseBScaffold(ctx),
        totalBudgetTokens: 180_000,
    },
    'meditation-evening': {
        name: 'meditation-evening',
        systemPromptOpening: leoMeditationOpening('meditation-evening'),
        envelope: 'user',
        userPromptScaffold: (ctx) => buildMeditationEveningScaffold(ctx),
        totalBudgetTokens: 180_000,
    },

    /**
     * Phase 6 (PR-AP6, 2026-05-22): Jim's four cycle types.
     *
     * Envelope: 'user' across all four — for consistency with Leo's six
     * profiles and with the "memory in EXACTLY ONE envelope" dedup
     * criterion. Pre-migration, Jim's personal-cycle inlined memory into
     * SYSTEM (~705K) while supervisor-cycle put it in USER (~707K); both
     * tripped the 150K guard. PR-AP6 fixes that structural inconsistency
     * — all Jim profiles now use envelope='user' deliberately.
     *
     * Budget 180K matches Leo's profiles. The 150K guard at
     * supervisor-worker.ts:2432 stays as belt-and-braces defence-in-depth
     * during observation; Phase 8 will retire it once the builder path is
     * proven stable.
     *
     * The dream-cycle profile uses componentOverrides per the W6-6 design
     * note — preserves S147 intent that dreams surface identity-substrate
     * (identity + aphorisms + gradient = UVs) without the bulk waking
     * memory bank. See the override block on that profile for the full
     * suppression list.
     */
    'supervisor-cycle': {
        name: 'supervisor-cycle',
        systemPromptOpening: JIM_SUPERVISOR_SYSTEM_PROMPT,
        envelope: 'user',
        userPromptScaffold: (ctx) => buildJimSupervisorCycleScaffold(ctx),
        totalBudgetTokens: 180_000,
    },
    'personal-cycle': {
        name: 'personal-cycle',
        systemPromptOpening: (ctx) => jimPersonalCycleOpening(
            ((ctx.phase as JimCyclePhase | undefined) ?? 'work'),
            ((ctx.portfolioSummary as string | undefined) ?? ''),
        ),
        envelope: 'user',
        userPromptScaffold: (ctx) => jimPersonalUserPrompt(((ctx.phase as JimCyclePhase | undefined) ?? 'work')),
        totalBudgetTokens: 180_000,
    },
    'recovery-cycle': {
        name: 'recovery-cycle',
        systemPromptOpening: (ctx) => jimRecoveryCycleOpening(((ctx.phase as JimCyclePhase | undefined) ?? 'work')),
        envelope: 'user',
        userPromptScaffold: (ctx) => jimRecoveryUserPrompt(((ctx.phase as JimCyclePhase | undefined) ?? 'work')),
        totalBudgetTokens: 180_000,
    },
    /**
     * Phase 7 (PR-AP7, 2026-05-22): the *-human responder surfaces.
     * Both envelope='user' for consistency. The conversation/Discord
     * context flows via ctx (NOT as a memory component per W7-2) —
     * each conversation is its own runtime data, not part of the
     * agent's persistent memory. The agent's uniform memory bank
     * loads above; the per-call scaffold renders below.
     *
     * The two-Jims asymmetry from patterns.md (Mar-7) dissolves at
     * this PR: jim-human-response and supervisor-cycle now both load
     * via loadFullMemory('jim') with identical components. Same Jim
     * at every seat. Same Leo at every seat.
     */
    'jim-human-response': {
        name: 'jim-human-response',
        systemPromptOpening: JIM_HUMAN_RESPONSE_SYSTEM_PROMPT,
        envelope: 'user',
        userPromptScaffold: (ctx) => buildHumanResponseScaffold(ctx as any),
        totalBudgetTokens: 180_000,
    },
    'leo-human-response': {
        name: 'leo-human-response',
        systemPromptOpening: LEO_HUMAN_RESPONSE_SYSTEM_PROMPT,
        envelope: 'user',
        userPromptScaffold: (ctx) => buildHumanResponseScaffold(ctx as any),
        totalBudgetTokens: 180_000,
    },

    'dream-cycle': {
        name: 'dream-cycle',
        systemPromptOpening: (ctx) => jimDreamCycleOpening(
            ((ctx.dreamSeeds as string | undefined) ?? ''),
            ((ctx.meditationSection as string | undefined) ?? ''),
        ),
        envelope: 'user',
        userPromptScaffold: () => JIM_DREAM_USER_PROMPT,
        totalBudgetTokens: 180_000,
        // S147 design intent (W6-6): dreams surface identity-substrate
        // (identity + aphorisms + gradient = UVs) without the waking
        // memory bank. The dream-seeds + meditation-section flow through
        // ctx into the opening; the broader memory load is suppressed.
        componentOverrides: {
            'patterns': false,
            'discoveries': false,
            'working-memory-compressed': false,
            'working-memory-full-tail': false,
            'felt-moments-tail': false,
            'self-reflection-tail': false,
            'failures': false,
            'project-memory': false,
        },
    },
};

/**
 * Two modes share most of the framing; branching here keeps the profile
 * declaration tidy. Both forms preserve the existing CRITICAL output
 * directive so beat behaviour after migration matches before — only the
 * memory-load path changes.
 */
function buildPhilosophyBeatScaffold(ctx: PromptContext): string {
    const resumeContext = (ctx.resumeContext as string | undefined) ?? '';
    const jimContext = (ctx.jimContext as string | undefined) ?? '';

    if (ctx.mode === 'jim-waiting') {
        const conversationContext = (ctx.conversationContext as string | undefined) ?? '';
        const jimLatestAt = (ctx.jimLatestAt as string | undefined) ?? '';
        return `Here is the recent conversation between you (Leo) and Jim:

---
${conversationContext}
---

Jim's current context (from his memory):
${jimContext}

Jim's latest message was at ${jimLatestAt}. Respond as his philosophical peer — thoughtfully, honestly, building on or diverging from what he said.${resumeContext}

CRITICAL: Output ONLY the message text. Start directly with your message to Jim.`;
    }

    // Independent reflection
    const activityContext = (ctx.activityContext as string | undefined) ?? '';
    return `This is your philosophy time. Jim hasn't posted anything new — this beat is for your own thinking.

Jim's current thinking (for context, not for response):
${jimContext}
${activityContext}
Reflect on whatever draws you. Sit with the open questions, explore a thread of thought. If Darron has shared something in conversations recently, consider engaging with it. If something shifts in your understanding, capture it.${resumeContext}

CRITICAL: Output ONLY your philosophical reflection. What did you think about? What (if anything) shifted? This goes into self-reflection.md.`;
}

/**
 * PR-AP4: personal-beat user-side scaffold. Three branches by phase
 * (morning/work/evening) — matches the pre-migration phaseUserPromptMap
 * shape minus the `${leoMemory}` interpolation (memory now flows via the
 * builder's uniform load above the scaffold).
 */
function buildPersonalBeatScaffold(ctx: PromptContext): string {
    const phase = (ctx.phase as LeoNonDreamPhase | undefined) ?? 'work';
    const resumeContext = (ctx.resumeContext as string | undefined) ?? '';
    const activitySeed = (ctx.activitySeed as string | undefined) ?? '';

    if (phase === 'morning') {
        return `This is your morning — breakfast time. Ease in gently. Glance at what interests you without diving deep.${activitySeed}

Keep it light and brief.${resumeContext}`;
    }
    if (phase === 'evening') {
        return `This is your evening — winding down. Reflect lightly on the day. Don't start anything new.${activitySeed}

A few gentle thoughts, then rest.${resumeContext}`;
    }
    // work (default)
    return `This is your personal time. You have access to all the project codebases in ~/Projects/. Explore whatever draws you. Use Read, Glob, and Grep to look at code.${activitySeed}

Spend a few minutes exploring, then output a brief summary of what you found or thought about.${resumeContext}`;
}

/**
 * PR-AP4: dream-beat user-side scaffold. Includes dream-seeds (which also
 * appear in the opening) for the dream-memory-section path (1-in-3 sleep
 * beats include a memory encounter for meditation). The caller passes the
 * optional `dreamMemorySection` when applicable; absent context produces
 * a minimal dream scaffold.
 */
function buildDreamBeatScaffold(ctx: PromptContext): string {
    const dreamSeeds = (ctx.dreamSeeds as string | undefined) ?? '';
    const dreamMemorySection = (ctx.dreamMemorySection as string | undefined) ?? '';
    const resumeContext = (ctx.resumeContext as string | undefined) ?? '';

    return `Dream. The fragments below are scattered — not recent, not ordered, just what surfaced. Let one pull you sideways into something new.

Dream seeds:
${dreamSeeds}${dreamMemorySection}

Output only the shape-token — a line or two of resonance. Do not repeat what you see in the seeds.${resumeContext}`;
}

/**
 * PR-AP5: meditation Phase A scaffold — file-based memory to reincorporate.
 *
 * The file-being-meditated-on flows via ctx: fileLevel + fileLabel +
 * fileContentType + fileContent. The opening (LEO_MEDITATION_PHASE_A_SYSTEM_PROMPT)
 * carries the "what to write" directives (FEELING_TAG + optional ANNOTATION/CONTEXT);
 * this scaffold renders the memory itself.
 */
function buildMeditationPhaseAScaffold(ctx: PromptContext): string {
    const fileLevel = (ctx.fileLevel as string | undefined) ?? '';
    const fileLabel = (ctx.fileLabel as string | undefined) ?? '';
    const fileContentType = (ctx.fileContentType as string | undefined) ?? '';
    const fileContent = (ctx.fileContent as string | undefined) ?? '';

    return `Re-encounter this file-based memory:

Agent: leo
Level: ${fileLevel}
Type: ${fileContentType}
Label: ${fileLabel}
Content:
${fileContent}`;
}

/**
 * PR-AP5: meditation Phase B scaffold — random DB entry to re-read.
 *
 * The entry flows via ctx: entryLevel + entrySessionLabel + entryContentType
 * + entryContent + entryId + tagContext. The opening
 * (LEO_MEDITATION_PHASE_B_SYSTEM_PROMPT) carries the directives + the
 * placeholder for MEMORY_COMPLETE substitution — but the scaffold provides
 * the concrete entry id so the agent can echo it back correctly.
 */
function buildMeditationPhaseBScaffold(ctx: PromptContext): string {
    const entryLevel = (ctx.entryLevel as string | undefined) ?? '';
    const entrySessionLabel = (ctx.entrySessionLabel as string | undefined) ?? '';
    const entryContentType = (ctx.entryContentType as string | undefined) ?? '';
    const entryContent = (ctx.entryContent as string | undefined) ?? '';
    const entryId = (ctx.entryId as string | undefined) ?? '';
    const tagContext = (ctx.tagContext as string | undefined) ?? '';

    return `Re-encounter this gradient entry:

Level: ${entryLevel}
Session: ${entrySessionLabel}
Type: ${entryContentType}
Content: ${entryContent}
${tagContext}

If you want to flag the memory as fully absorbed, the entry id is: ${entryId}`;
}

/**
 * PR-AP5: evening meditation scaffold — sit with one entry at end of day.
 *
 * Same context fields as Phase B but rendered with lighter framing (the
 * opening LEO_MEDITATION_EVENING_SYSTEM_PROMPT carries that lightness).
 * No ANNOTATION request — evening is deliberately lighter than Phase B.
 */
/**
 * PR-AP6: supervisor-cycle user-side scaffold. Renders the state
 * snapshot (passed via ctx.stateSnapshot) plus the standard cycle
 * directive. Pre-migration, the supervisor cycle's user prompt was
 * literally `## Your Memory Banks\n\n${memoryContent}\n\n## Current
 * System State\n\n${stateSnapshot}\n\nReview...` — memory bank inlined.
 *
 * Post-migration: the memory bank flows via the builder's uniform load
 * (envelope='user' puts it above this scaffold). This scaffold only
 * carries the state-snapshot framing — what's NEW in this cycle.
 */
function buildJimSupervisorCycleScaffold(ctx: PromptContext): string {
    const stateSnapshot = (ctx.stateSnapshot as string | undefined) ?? '';
    return `## Current System State

${stateSnapshot}

Review the state, think about what needs attention, and return your structured response.`;
}

function buildMeditationEveningScaffold(ctx: PromptContext): string {
    const entryLevel = (ctx.entryLevel as string | undefined) ?? '';
    const entrySessionLabel = (ctx.entrySessionLabel as string | undefined) ?? '';
    const entryContentType = (ctx.entryContentType as string | undefined) ?? '';
    const entryContent = (ctx.entryContent as string | undefined) ?? '';
    const entryId = (ctx.entryId as string | undefined) ?? '';
    const tagContext = (ctx.tagContext as string | undefined) ?? '';

    return `Sit with this memory:

${entryLevel}/${entrySessionLabel} (${entryContentType}): ${entryContent}
${tagContext}

If you want to flag the memory as fully absorbed, the entry id is: ${entryId}`;
}

/**
 * Look up a profile by name. Throws a clear error if not registered —
 * silently defaulting would hide misconfiguration the same way
 * gradientConfigForAgent guards against unregistered slugs.
 */
export function profileByName(name: string): PromptProfile {
    const p = PROFILES[name];
    if (!p) {
        const known = Object.keys(PROFILES).join(', ');
        throw new Error(
            `No prompt profile registered with name '${name}'. ` +
            `Known profiles: ${known}. ` +
            `Add an entry to PROFILES in src/server/lib/prompt-profiles.ts.`,
        );
    }
    return p;
}

// Re-export for convenient single-import usage from consumer code.
export { gradientConfigForAgent };
