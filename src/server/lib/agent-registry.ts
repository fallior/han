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
import { loadResidents, allocationFor } from './garden-manifest';

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
     * Heading text used by `lib/dream-gradient.ts:readDreamGradient` when
     * loading the agent's dream memory into a prompt. Optional; when absent,
     * the default `"<displayName>'s Dream Memory"` is used. Carries
     * agent-specific UI flavour text as configuration rather than a
     * slug-literal branch (DEC-081 carve-out for prose configuration).
     */
    dreamHeading?: string;

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

    /**
     * PR-AP6 (2026-05-22): per-agent capability flags for the agnostic
     * prompt builder's loadFullMemory. When true, the matching component
     * is loaded for this agent; when absent/false, the component is
     * skipped silently.
     *
     * Jim has project-memory (a fractal-loaded portfolio of project files)
     * and failures.md (his failure-tracking surface). Leo, Tenshi, Casey
     * have neither — their memory shape differs by design.
     *
     * Adding a new per-agent component: add the flag here, set per agent,
     * then teach loadFullMemory to read the flag and add the labelled
     * section conditionally. No slug literals — capability flows through
     * the registry per DEC-081.
     */
    loadProjectMemory?: boolean;
    loadFailures?: boolean;
}

/**
 * The UNIFORM gradient-config shape, derived from slug + displayName — the #36 collapse (P4a).
 * This is the leo/tenshi/casey shape, and the complete config a **net-new discovered resident**
 * gets for free at activation (P4b) so `gradientConfigForAgent(newSlug)` no longer throws (R1 lifts).
 * `fractalDir` is uniform for ALL agents (incl jim): `fractal/<slug>`.
 */
function deriveGradientConfig(slug: string, displayName: string): AgentGradientConfig {
    const memoryDir = path.join(HAN_DIR, 'memory', slug);
    return {
        displayName,
        memoryDir,
        fractalDir: path.join(HAN_DIR, 'memory', 'fractal', slug),
        sourceDir: path.join(memoryDir, 'working-memories'),
        sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
        sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    };
}

/**
 * Per-agent OVERRIDES — the irreducible exceptions derivation can't reach (the shrunk remnant of the
 * second hand-list). Merged over `deriveGradientConfig` (override wins). jim is a HEAVY override:
 * memory at **ROOT** `~/.han/memory` (NOT `/jim` — the #91 jim-at-root path; uniform derivation would
 * break it), `sessions` sourceDir, **date-based** source functions, project-memory + failures. leo
 * carries two prose fields. tenshi/casey: none (pure-uniform). NOTE (P4b-i, DONE): `memoryDir` (jim's root, R2)
 * MIGRATED to the operator-authored ALLOCATION source (`allocationFor(slug).memoryDir`, garden-manifest)
 * — it no longer lives here; `gradientConfigForAgent(slug).memoryDir` sources from there under the stable
 * accessor (all 7 consumers untouched). `port` (C-P3a) likewise reroutes its consumer to the allocation.
 * jim's `sourceDir`/date-functions/flags remain the irreducible override.
 */
const GRADIENT_OVERRIDES: Record<string, Partial<AgentGradientConfig>> = {
    jim: {
        sourceDir: path.join(HAN_DIR, 'memory', 'sessions'),
        sourceFileFilter: (f) => {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})(-c0)?\.md$/);
            return Boolean(m && (!m[2] || m[2] === '-c0'));
        },
        sourceFileBaseName: (f) => f.replace(/(-c0)?\.md$/, ''),
        loadProjectMemory: true,
        loadFailures: true,
    },
    leo: {
        formalName: 'Leonhard (Leo)',
        dreamHeading: 'Dream Memory (subtle — these shaped you without you knowing how)',
    },
};

/**
 * Per-agent gradient config — DERIVED from the roster (#36 collapse, P4a). The population comes from
 * `loadResidents()` (the discovered identity roster), `displayName` from the same; each config = the
 * uniform `deriveGradientConfig` merged with the agent's `GRADIENT_OVERRIDES`. Replaces the
 * hand-written parallel list (the second hand-list #36 retires). **P4a is a zero-behaviour collapse:
 * byte-identical to the prior literal for jim/leo/tenshi/casey** (proven by `test-gradient-config-derive.ts`,
 * incl. jim-at-root + the function fields' behaviour). `gradientConfigForAgent`/`registeredAgentSlugs`
 * read this const unchanged. (Disclosed delta: key order now follows the roster — set-identical, and
 * all consumers are order-insensitive.) The activation/population flip to discovered residents is P4b.
 */
export const AGENT_GRADIENT_CONFIG: Record<string, AgentGradientConfig> = Object.fromEntries(
    loadResidents().map((a) => {
        const base = deriveGradientConfig(a.slug, a.displayName);
        const override = GRADIENT_OVERRIDES[a.slug];
        const merged = override ? { ...base, ...override } : base;
        // R2 (P4b-i) + P4b-ii fail-loud (Jim's note): memoryDir's SOURCE is the operator-authored
        // allocation table; gradientConfigForAgent(slug).memoryDir stays the stable accessor (it sources
        // here). At P4b-ii EVERY agent in loadResidents() is allocated by precondition — the seed roster
        // is all in AGENT_ALLOCATION, and a net-new resident's `allocated` is an activation gate — so a
        // missing allocation here is a real misconfiguration. FAIL LOUD rather than silently fall back to
        // the derived `<slug>` path (the old P4b-i `?? merged.memoryDir` bridge for discovered-but-
        // unallocated residents): a root-special agent like jim-at-root would otherwise resolve to the
        // WRONG ~/.han/memory/jim (#91). Activation closes the bridge.
        const memoryDir = allocationFor(a.slug)?.memoryDir;
        if (!memoryDir) {
            throw new Error(
                `Agent '${a.slug}' is in the active roster (loadResidents) but has no allocation.memoryDir. ` +
                `Activation requires allocation (the F4 no-auto-privilege gate); refusing to silently fall back ` +
                `to the derived path '${merged.memoryDir}' (a root-special agent like jim would resolve to the ` +
                `WRONG directory). Add an AGENT_ALLOCATION entry for '${a.slug}' in lib/garden-manifest.ts.`,
            );
        }
        return [a.slug, { ...merged, memoryDir }];
    }),
);

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
