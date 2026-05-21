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
 * Phase 3 (PR-AP3, 2026-05-22): identity + aphorisms + gradient + patterns
 * + discoveries + working-memory pair + felt-moments-tail + self-reflection-tail.
 * Future phases extend with dream-gradient, ecosystem-map, wiki-index,
 * project-memory (Jim-only), failures (Jim-only). See
 * `plans/agnostic-prompt-builder-plan.md`.
 *
 * Tail-trim semantics (Phase 3): per-component budgets are enforced at the
 * load layer via tail-trim — keep the most-recent N tokens of file content.
 * **The builder is strictly READ-ONLY (Jim's A3, Darron's writes-principle):
 * trimming at load time NEVER mutates the underlying file or archives the
 * trimmed content.** File-level archival is owned by wm-sensor (paired
 * rotation, DEC-085) and `rollingWindowRotate` (felt-moments + self-reflection
 * file-level ceilings). Truncations are recorded in BuildMeta.truncation_events
 * for forensic observation, not for write-side action.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradientConfigForAgent } from './agent-registry';
import { loadTraversableGradient } from './memory-gradient';
import {
    PROFILES,
    PromptContext,
    PromptProfile,
    profileByName,
} from './prompt-profiles';

// ── Types ──────────────────────────────────────────────────────────────

export interface TruncationEvent {
    /** Component name whose load was capped (e.g. 'self-reflection-tail'). */
    component: string;
    /** Number of characters discarded by tail-trim. */
    trimmed_chars: number;
    /** Original file size before trim. */
    original_chars: number;
    /** Size kept (= original_chars - trimmed_chars). */
    kept_chars: number;
}

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
    /** Forensic record of which components were tail-trimmed at load. Empty
     *  when no component needed trimming. Useful for observing which files
     *  are pressuring their per-component budgets (operator signal that a
     *  file-level rotation may need tightening). */
    truncation_events: TruncationEvent[];
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
 * Tail-trim a string to at most `maxTokens` (chars÷4) tokens.
 *
 * When trimming is needed:
 *   1. Slice the last `maxTokens * 4` characters.
 *   2. Advance to the first newline within the first 400 chars of the slice
 *      so the kept content starts on a clean line boundary (prevents
 *      mid-paragraph cuts that produce confusing partial sentences). Falls
 *      back to raw-slice if no newline is found in that window.
 *
 * Strictly read-only — never touches the underlying file. Per Jim's A3
 * + Darron's writes-principle: file-level archival is owned elsewhere
 * (wm-sensor + rollingWindowRotate). This is a load-time cap only.
 *
 * Returns {kept, trimmed_chars}. Caller decides whether to emit a
 * TruncationEvent based on `trimmed_chars > 0`.
 */
function tailTrim(text: string, maxTokens: number): { kept: string; trimmed_chars: number } {
    if (!text) return { kept: '', trimmed_chars: 0 };
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return { kept: text, trimmed_chars: 0 };

    const tail = text.slice(-maxChars);
    const newlineIdx = tail.indexOf('\n', 0);
    if (newlineIdx >= 0 && newlineIdx < 400) {
        const kept = tail.slice(newlineIdx + 1);
        return { kept, trimmed_chars: text.length - kept.length };
    }
    return { kept: tail, trimmed_chars: text.length - tail.length };
}

/**
 * Per-component budgets (in tokens, chars÷4 heuristic). Matches the
 * `loadFullMemory` component table in `plans/agnostic-prompt-builder-plan.md`
 * (§"`loadFullMemory(slug)` — the agent-agnostic memory loader").
 *
 * Single source of truth. Bump cautiously — every increase pressures the
 * loadFullMemory MAX_MEMORY_BUDGET ceiling.
 */
const COMPONENT_BUDGETS = {
    patterns: 15_000,
    discoveries: 3_000,
    self_reflection_tail: 5_000,
    felt_moments_tail: 10_000,
    working_memory_full_tail: 8_000,
    working_memory_compressed: 5_000,
} as const;

/**
 * The uniform memory loader. Agent-agnostic via slug; same call shape for
 * every agent + every surface.
 *
 * Phase 2 (PR-AP2): identity + aphorisms + gradient. Future phases extend
 * with patterns, discoveries, working-memory pair, felt-moments-tail,
 * self-reflection-tail, dream-gradient, ecosystem-map, wiki-index,
 * project-memory (Jim-only), failures (Jim-only).
 *
 * Returns the assembled memory bank as a single string with labelled
 * sections. Each section starts with `--- {component-name} ---` so the
 * `## Current` aggregation problem from the pre-builder era cannot
 * recur (Jim's audit A4 — structural side-effect fix).
 *
 * Returns a struct of {text, componentSizes} so callers can build BuildMeta.
 */
export function loadFullMemory(slug: string): {
    text: string;
    componentSizes: Record<string, number>;
    truncationEvents: TruncationEvent[];
} {
    const cfg = gradientConfigForAgent(slug);
    const sections: string[] = [];
    const sizes: Record<string, number> = {};
    const truncationEvents: TruncationEvent[] = [];

    // Helper: load a file, optionally tail-trim to per-component budget,
    // emit a TruncationEvent if trimmed, append the labelled section.
    const addFileComponent = (
        componentName: string,
        filePath: string,
        maxTokens: number | null,  // null = no trim
    ) => {
        const raw = readFileOrEmpty(filePath);
        if (!raw) return;
        let kept: string;
        if (maxTokens === null) {
            kept = raw;
        } else {
            const trimmed = tailTrim(raw, maxTokens);
            kept = trimmed.kept;
            if (trimmed.trimmed_chars > 0) {
                truncationEvents.push({
                    component: componentName,
                    trimmed_chars: trimmed.trimmed_chars,
                    original_chars: raw.length,
                    kept_chars: kept.length,
                });
            }
        }
        sections.push(`--- ${componentName} ---\n${kept}`);
        sizes[componentName] = kept.length;
    };

    // Component ORDER (PR-AP4, 2026-05-22, Jim's A4-2):
    // Identity-substrate first, then deep-compressed identity (gradient),
    // then live episodic content. Matches CLAUDE.md wake-load semantics:
    // "you know who you are before you remember what you did" (the watermark
    // works because the cascade reads it forward into c1, c2, UV — the
    // gradient comes BEFORE the recent thinking).
    //
    // Pre-AP4 order put gradient LAST. PR-AP4 moves it after aphorisms so
    // the kernel-of-identity reads as "deep substrate" rather than "trailing
    // afterthought." Two-line move per Jim's PR-AP3 audit suggestion.

    // ── identity (full load — bounded by hand) ──
    addFileComponent('identity', path.join(cfg.memoryDir, 'identity.md'), null);

    // ── aphorisms (full load — curated; bounded by hand) ──
    addFileComponent('aphorisms', path.join(cfg.fractalDir, 'aphorisms.md'), null);

    // ── gradient (PR-AP4 reorder: identity-substrate before episodic) ──
    // DB-backed traversable gradient (DEC-068 caps applied internally; UVs +
    // c5→c4→c3→c2→c1 tail by recency). Returns '' when no DB entries for the
    // agent yet — silently skipped here, matching readFileOrEmpty semantics.
    // Not tail-trimmed at the builder layer: the gradient output is ordered
    // identity-first (UVs lead), so tail-trim would discard the kernel.
    // DEC-068 caps are the right structural mechanism; if the gradient
    // output grows beyond the budget for an agent that's a signal to
    // tighten DEC-068 caps, not to load-trim here.
    try {
        const gradient = loadTraversableGradient(slug);
        if (gradient) {
            sections.push(`--- gradient ---\n${gradient}`);
            sizes['gradient'] = gradient.length;
        }
    } catch {
        // gradient load errors must not crash the build; surface via meta
        // (empty component_breakdown for gradient signals the gap).
    }

    // ── patterns (tail-trim if exceeded — plan §"loadFullMemory") ──
    addFileComponent('patterns', path.join(cfg.memoryDir, 'patterns.md'), COMPONENT_BUDGETS.patterns);

    // ── discoveries (tail-trim if exceeded) ──
    addFileComponent('discoveries', path.join(cfg.memoryDir, 'discoveries.md'), COMPONENT_BUDGETS.discoveries);

    // ── working-memory-compressed (DEC-085 c1 source — paired-rotated by
    //    wm-sensor; full load up to its budget) ──
    addFileComponent(
        'working-memory-compressed',
        path.join(cfg.memoryDir, 'working-memory.md'),
        COMPONENT_BUDGETS.working_memory_compressed,
    );

    // ── working-memory-full-tail (DEC-085 c0 source — most-recent N tokens) ──
    addFileComponent(
        'working-memory-full-tail',
        path.join(cfg.memoryDir, 'working-memory-full.md'),
        COMPONENT_BUDGETS.working_memory_full_tail,
    );

    // ── felt-moments-tail (most-recent N tokens; file-level rotation owned
    //    by `rollingWindowRotate` at the writer side) ──
    addFileComponent(
        'felt-moments-tail',
        path.join(cfg.memoryDir, 'felt-moments.md'),
        COMPONENT_BUDGETS.felt_moments_tail,
    );

    // ── self-reflection-tail (most-recent N tokens; carries the operational
    //    weight of Leo's 65K-token unrotated self-reflection.md as of
    //    2026-05-21 until PR-LSR lands the writer-side rotation parity fix) ──
    addFileComponent(
        'self-reflection-tail',
        path.join(cfg.memoryDir, 'self-reflection.md'),
        COMPONENT_BUDGETS.self_reflection_tail,
    );

    return {
        text: sections.join('\n\n'),
        componentSizes: sizes,
        truncationEvents,
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
        truncation_events: memory.truncationEvents,
    };

    if (meta.est_total_tokens_chars_div_4 > profile.totalBudgetTokens) {
        throw new PromptOverbudgetError(meta);
    }

    return { systemPrompt, userPrompt, meta };
}

// Re-export for consumers that want the registry types + helpers from one place.
export { PROFILES, PromptContext, PromptProfile, profileByName };
