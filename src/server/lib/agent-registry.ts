/**
 * Agent registry — per-agent configuration that varies between agents in ways
 * that aren't naturally expressible in env vars (regex/predicate logic for source
 * file naming, etc.). Per the aphorism *"HAN should always be written
 * agent-agnostic"* — when adding a new agent, add an entry here; do not branch
 * on slug literals in callers.
 *
 * Path-based config (memory dirs, fractal dirs, source dirs) lives in env vars
 * exported by each launcher (AGENT_MEMORY_DIR, AGENT_FRACTAL_DIR,
 * AGENT_GRADIENT_SOURCE_DIR). This file holds only the structural-difference
 * config that doesn't fit cleanly in env vars.
 *
 * Introduced 2026-05-04 as part of the /pfc skill landing (S149) to deagentify
 * `processGradientForAgent`'s call path. Future-idea #36 plans the broader
 * sweep across the rest of the codebase.
 */

export interface AgentGradientConfig {
    /**
     * Predicate for matching c0 source files in the agent's
     * `AGENT_GRADIENT_SOURCE_DIR`. Returns true if the filename should be
     * compressed to c1 by `processGradientForAgent`.
     */
    sourceFileFilter: (filename: string) => boolean;

    /**
     * Extract the session label (baseName) from a source filename. The label
     * becomes part of the c1 filename and the gradient_entries.session_label
     * column. Should be deterministic and reversible-enough that re-runs are
     * idempotent.
     */
    sourceFileBaseName: (filename: string) => string;
}

/**
 * Per-agent gradient config. To add a new agent: add an entry here AND ensure
 * the launcher exports `AGENT_SLUG`, `AGENT_MEMORY_DIR`, `AGENT_FRACTAL_DIR`,
 * and `AGENT_GRADIENT_SOURCE_DIR`.
 */
export const AGENT_GRADIENT_CONFIG: Record<string, AgentGradientConfig> = {
    /**
     * Jim's source files: supervisor session archives at
     * `~/.han/memory/sessions/`. Filenames are date-based:
     * `2026-02-18.md` or `2026-02-18-c0.md` (the optional `-c0` suffix is
     * tolerated for back-compat). Label = the date.
     */
    jim: {
        sourceFileFilter: (f) => {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})(-c0)?\.md$/);
            return Boolean(m && (!m[2] || m[2] === '-c0'));
        },
        sourceFileBaseName: (f) => f.replace(/(-c0)?\.md$/, ''),
    },

    /**
     * Leo's source files: working-memory archives at
     * `~/.han/memory/leo/working-memories/`. Filenames are
     * `working-memory-full-<label>.md` where label is typically
     * `s<session>-<date>` (the full versions have the richest content).
     * Label = the part between the prefix and `.md`.
     */
    leo: {
        sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
        sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    },
};

/**
 * Look up the gradient config for an agent, throwing a clear error if the slug
 * is not registered. Callers should let the error propagate — silently
 * defaulting would hide misconfiguration of new agents.
 */
export function gradientConfigForAgent(slug: string): AgentGradientConfig {
    const cfg = AGENT_GRADIENT_CONFIG[slug];
    if (!cfg) {
        throw new Error(
            `No gradient config registered for agent '${slug}'. ` +
            `Add an entry to AGENT_GRADIENT_CONFIG in src/server/lib/agent-registry.ts ` +
            `and ensure the launcher exports AGENT_SLUG, AGENT_MEMORY_DIR, ` +
            `AGENT_FRACTAL_DIR, and AGENT_GRADIENT_SOURCE_DIR.`,
        );
    }
    return cfg;
}

/**
 * Read an env var that the agent's launcher should have exported. Throws a
 * clear error if missing. Used by the gradient code to resolve per-agent paths
 * without hardcoding.
 */
export function requireAgentEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} must be exported by the agent's launcher. ` +
            `Check scripts/han, hanjim, hancasey, hantenshi, hanleo (or the ` +
            `mikes-han equivalents) and confirm the export block sets this var.`,
        );
    }
    return value;
}
