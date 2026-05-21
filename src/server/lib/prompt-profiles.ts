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
}

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
        totalBudgetTokens: 120_000,
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
