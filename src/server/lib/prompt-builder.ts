/**
 * Agnostic Prompt Builder
 *
 * One function — `buildPrompt(slug, profileName, context)` — that owns prompt
 * assembly across every agent surface in HAN. Operationalises DEC-081
 * ("agent-agnostic") at the memory-load layer; replaces the per-surface
 * `readLeoMemory` / `readJimMemory` / `loadMemoryBank` drift that caused
 * the 2026-05-19 prompt-bloat triage chain.
 *
 * Architectural premise (Darron's reframe 2026-05-21):
 *   - Memory load is UNIFORM across every surface of an agent
 *   - Only the orientation scaffolding differs per surface
 *   - The builder is STRICTLY READ-ONLY — never writes; archival is owned
 *     by wm-sensor (paired rotation) and rollingWindowRotate (file-level)
 *
 * Phase 1 (this module): skeleton + types + identity + aphorisms components
 * only. Future phases extend `loadFullMemory(slug)` with gradient, working
 * memory, felt-moments-tail, etc. See `plans/agnostic-prompt-builder-plan.md`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradientConfigForAgent } from './agent-registry';
import {
    PROFILES,
    PromptContext,
    PromptProfile,
    profileByName,
} from './prompt-profiles';

// ── Types ──────────────────────────────────────────────────────────────

export interface BuildMeta {
    profile_name: string;
    agent: string;
    envelope: 'system' | 'user';
    system_chars: number;
    user_chars: number;
    memory_chars: number;
    scaffolding_chars: number;
    est_total_tokens_chars_div_4: number;
    total_budget_tokens: number;
    component_breakdown: Record<string, number>;
}

export interface BuiltPrompt {
    systemPrompt: string;
    userPrompt: string;
    meta: BuildMeta;
}

/**
 * Thrown by buildPrompt when assembled prompt exceeds the profile's
 * totalBudgetTokens. Carries BuildMeta so the consumer can record the
 * over-budget breakdown without re-running the build.
 *
 * Per the error-handling contract (plan section): consumers MUST catch
 * this and treat as a cycle/beat/response skip — log to distress jsonl,
 * return cleanly, let the next schedule fire normally. Unhandled throws
 * become process crashes interpreted by watchdog as service failures.
 */
export class PromptOverbudgetError extends Error {
    public readonly meta: BuildMeta;
    constructor(meta: BuildMeta) {
        super(
            `Prompt over budget: profile='${meta.profile_name}', agent='${meta.agent}', ` +
            `est ${meta.est_total_tokens_chars_div_4} tokens > budget ${meta.total_budget_tokens}`,
        );
        this.name = 'PromptOverbudgetError';
        this.meta = meta;
    }
}

// ── Token estimation ───────────────────────────────────────────────────

/** Mirrors the chars÷4 heuristic used across HAN (supervisor-worker,
 *  heartbeat, process-pending-compression). Not exact; same approximation
 *  the existing prompt-size guard uses, so estimates are comparable. */
function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// ── Memory components ──────────────────────────────────────────────────

/**
 * Read a file, returning empty string if missing. Mirrors the existing
 * skip-if-missing convention in readLeoMemory / loadMemoryBank.
 */
function readFileOrEmpty(filepath: string): string {
    try {
        if (!fs.existsSync(filepath)) return '';
        return fs.readFileSync(filepath, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * The uniform memory loader. Agent-agnostic via slug; same call shape for
 * every agent + every surface.
 *
 * Phase 1: identity + aphorisms components only. Future phases extend
 * this function with patterns, discoveries, gradient, working-memory pair,
 * felt-moments-tail, self-reflection-tail, dream-gradient, ecosystem-map,
 * wiki-index, project-memory (Jim-only), failures (Jim-only).
 *
 * Returns the assembled memory bank as a single string with labelled
 * sections. Each section starts with `--- {component-name} ---` so the
 * `## Current` aggregation problem from the pre-builder era cannot
 * recur (Jim's audit A4 — structural side-effect fix).
 *
 * Returns a struct of {text, componentSizes} so callers can build BuildMeta.
 */
export function loadFullMemory(slug: string): { text: string; componentSizes: Record<string, number> } {
    const cfg = gradientConfigForAgent(slug);
    const sections: string[] = [];
    const sizes: Record<string, number> = {};

    // ── identity ──
    const identity = readFileOrEmpty(path.join(cfg.memoryDir, 'identity.md'));
    if (identity) {
        sections.push(`--- identity ---\n${identity}`);
        sizes['identity'] = identity.length;
    }

    // ── aphorisms ──
    const aphorisms = readFileOrEmpty(path.join(cfg.fractalDir, 'aphorisms.md'));
    if (aphorisms) {
        sections.push(`--- aphorisms ---\n${aphorisms}`);
        sizes['aphorisms'] = aphorisms.length;
    }

    return {
        text: sections.join('\n\n'),
        componentSizes: sizes,
    };
}

// ── The builder ────────────────────────────────────────────────────────

/**
 * Resolve a string-or-function scaffolding field to its concrete string.
 * Surface profiles use the function form for context-dependent openings
 * (e.g. dream beats that include seeds, recovery cycles that vary by phase).
 */
function resolveScaffold(
    field: string | ((ctx: PromptContext) => string) | undefined,
    ctx: PromptContext,
): string {
    if (field === undefined) return '';
    if (typeof field === 'function') return field(ctx);
    return field;
}

/**
 * Build a prompt for an agent's surface.
 *
 *   slug         — agent identifier (per DEC-081 + agent-registry)
 *   profileName  — registry key from prompt-profiles.ts PROFILES
 *   context      — runtime data for scaffolding (phase, dream seeds, etc.)
 *
 * Returns { systemPrompt, userPrompt, meta }. Throws PromptOverbudgetError
 * if assembled total exceeds profile.totalBudgetTokens — consumers MUST
 * catch per the error-handling contract (see prompt-builder.ts header).
 */
export function buildPrompt(
    slug: string,
    profileName: string,
    context: PromptContext = {},
): BuiltPrompt {
    const profile = profileByName(profileName);

    // Resolve scaffolding (the orientation sentence + optional user-side framing)
    const opening = resolveScaffold(profile.systemPromptOpening, context);
    const userScaffold = resolveScaffold(profile.userPromptScaffold, context);

    // Load the uniform memory bank (agent-specific via slug; same call for every surface)
    const memory = loadFullMemory(slug);

    // Assemble into the chosen envelope
    let systemPrompt: string;
    let userPrompt: string;
    if (profile.envelope === 'system') {
        systemPrompt = memory.text
            ? `${opening}\n\n${memory.text}`
            : opening;
        userPrompt = userScaffold;
    } else {
        systemPrompt = opening;
        userPrompt = memory.text
            ? `${memory.text}\n\n${userScaffold}`
            : userScaffold;
    }

    const meta: BuildMeta = {
        profile_name: profile.name,
        agent: slug,
        envelope: profile.envelope,
        system_chars: systemPrompt.length,
        user_chars: userPrompt.length,
        memory_chars: memory.text.length,
        scaffolding_chars: opening.length + userScaffold.length,
        est_total_tokens_chars_div_4: estimateTokens(systemPrompt) + estimateTokens(userPrompt),
        total_budget_tokens: profile.totalBudgetTokens,
        component_breakdown: memory.componentSizes,
    };

    if (meta.est_total_tokens_chars_div_4 > profile.totalBudgetTokens) {
        throw new PromptOverbudgetError(meta);
    }

    return { systemPrompt, userPrompt, meta };
}

// Re-export for consumers that want the registry types + helpers from one place.
export { PROFILES, PromptContext, PromptProfile, profileByName };
