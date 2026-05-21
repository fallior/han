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
};

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
