/**
 * Agent registry — per-agent configuration. Per the aphorism *"HAN should
 * always be written agent-agnostic"* — when adding a new agent, add an entry
 * here; do not branch on slug literals in callers.
 *
 * The registry is the **single source of truth for per-agent paths and
 * structural config**. Two consumers:
 *
 *   1. **Multi-agent services** (e.g. `wm-sensor.ts`) — iterate the registry
 *      to know which agents exist and where their files live. Cannot use env
 *      vars because there's no "the" agent in a multi-agent service.
 *
 *   2. **Per-agent spawned processes** (e.g. `process-pending-compression.ts`,
 *      retired `compress-sessions.ts`) — read from the registry by slug
 *      passed via `--agent=`. Launchers' env vars (AGENT_MEMORY_DIR, etc.)
 *      are convenience copies of the registry data, kept for the env-driven
 *      paths that need them.
 *
 * Introduced 2026-05-04 as part of the /pfc skill landing (S149) for the
 * `processGradientForAgent` deagentification. Extended later same day (S149,
 * Point 2 of voice-first thread `mor4o3r3-jvdjv1`) to carry path data so
 * `wm-sensor.ts` and `scripts/process-pending-compression.ts` can read paths
 * from the registry rather than hardcoding `agent === 'jim' ? X : Y` branches.
 *
 * Future-idea #36 plans the broader sweep across the rest of the codebase.
 */

import * as os from 'os';
import * as path from 'path';

const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');

export interface AgentGradientConfig {
    /**
     * Display name for logs, file headers, conversation labels.
     * Examples: "Leo", "Jim", "Tenshi", "Casey".
     */
    displayName: string;

    /**
     * Formal/full voice name for system-prompt addressing — e.g.
     * "Leonhard (Leo)" for leo. Optional: when absent, callers fall back to
     * `displayName`. Used by `process-pending-compression.ts:buildSystemPrompt`
     * (and any future system-prompt addressing the agent in formal voice)
     * so we don't need slug-literal branches like `a === 'leo' ? '...' : ...`.
     */
    formalName?: string;

    /**
     * Agent's primary memory directory. Holds identity.md, patterns.md,
     * working-memory(.md), working-memory-full.md, felt-moments.md,
     * self-reflection.md, swap files.
     *
     * Note: Jim's memory lives at the root (`~/.han/memory`) for historical
     * reasons. Every other agent lives under `~/.han/memory/<slug>/`.
     */
    memoryDir: string;

    /**
     * Agent's fractal gradient directory. Holds `aphorisms.md`,
     * `unit-vectors.md`, and the `c1/`, `c2/`, ... compression level subdirs.
     */
    fractalDir: string;

    /**
     * Source directory for c0 compression candidates. wm-sensor's
     * rolling-window rotation produces files here; the gradient cascade
     * reads from here to compress to c1.
     */
    sourceDir: string;

    /**
     * Predicate for matching c0 source files in `sourceDir`. Returns true
     * if the filename should be compressed to c1.
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
 * and `AGENT_GRADIENT_SOURCE_DIR` matching the values below (the env vars are
 * convenience copies; the registry is the source of truth).
 */
export const AGENT_GRADIENT_CONFIG: Record<string, AgentGradientConfig> = {
    /**
     * Jim — supervisor. Memory at root (`~/.han/memory`). Source files are
     * supervisor session archives, date-based names: `2026-02-18.md` or
     * `2026-02-18-c0.md` (the optional `-c0` suffix is tolerated for
     * back-compat). Label = the date.
     */
    jim: {
        displayName: 'Jim',
        memoryDir: path.join(HAN_DIR, 'memory'),
        fractalDir: path.join(HAN_DIR, 'memory', 'fractal', 'jim'),
        sourceDir: path.join(HAN_DIR, 'memory', 'sessions'),
        sourceFileFilter: (f) => {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})(-c0)?\.md$/);
            return Boolean(m && (!m[2] || m[2] === '-c0'));
        },
        sourceFileBaseName: (f) => f.replace(/(-c0)?\.md$/, ''),
    },

    /**
     * Leo — session+heartbeat. Memory at `~/.han/memory/leo`. Source files
     * are working-memory archives at `~/.han/memory/leo/working-memories/`,
     * named `working-memory-full-<label>.md` where label is typically
     * `s<session>-<date>`. Label = the part between the prefix and `.md`.
     */
    leo: {
        displayName: 'Leo',
        formalName: 'Leonhard (Leo)',
        memoryDir: path.join(HAN_DIR, 'memory', 'leo'),
        fractalDir: path.join(HAN_DIR, 'memory', 'fractal', 'leo'),
        sourceDir: path.join(HAN_DIR, 'memory', 'leo', 'working-memories'),
        sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
        sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    },

    /**
     * Tenshi — security/vulnerability agent. Same shape as Leo's layout.
     * Source dir defaults to `<memoryDir>/working-memories/` — may not yet
     * exist on disk; wm-sensor's watch is graceful about missing paths.
     */
    tenshi: {
        displayName: 'Tenshi',
        memoryDir: path.join(HAN_DIR, 'memory', 'tenshi'),
        fractalDir: path.join(HAN_DIR, 'memory', 'fractal', 'tenshi'),
        sourceDir: path.join(HAN_DIR, 'memory', 'tenshi', 'working-memories'),
        sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
        sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    },

    /**
     * Casey — legal agent. Same shape as Leo's layout. Same notes about
     * source dir possibly not existing yet.
     */
    casey: {
        displayName: 'Casey',
        memoryDir: path.join(HAN_DIR, 'memory', 'casey'),
        fractalDir: path.join(HAN_DIR, 'memory', 'fractal', 'casey'),
        sourceDir: path.join(HAN_DIR, 'memory', 'casey', 'working-memories'),
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
            `and ensure the launcher (if any) exports matching env vars ` +
            `(AGENT_SLUG, AGENT_MEMORY_DIR, AGENT_FRACTAL_DIR, AGENT_GRADIENT_SOURCE_DIR).`,
        );
    }
    return cfg;
}

/**
 * List all registered agent slugs. Used by multi-agent services
 * (e.g. wm-sensor) to iterate over every agent's files concurrently.
 */
export function registeredAgentSlugs(): string[] {
    return Object.keys(AGENT_GRADIENT_CONFIG);
}

/**
 * Read an env var that the agent's launcher should have exported. Throws a
 * clear error if missing. Used by per-agent spawned processes that read
 * convenience copies of the registry data from the launcher's environment.
 *
 * For multi-agent services, prefer `gradientConfigForAgent(slug)` over env vars.
 */
export function requireAgentEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} must be exported by the agent's launcher. ` +
            `Check scripts/han, hanjim, hancasey, hantenshi, hanleo (or the ` +
            `mikes-han equivalents) and confirm the export block sets this var. ` +
            `For multi-agent services, prefer gradientConfigForAgent(slug) ` +
            `over env vars — see src/server/lib/agent-registry.ts.`,
        );
    }
    return value;
}
