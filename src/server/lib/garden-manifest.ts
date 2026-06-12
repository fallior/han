/**
 * The Garden Manifest — one declarative source of truth for agents, surfaces,
 * and their templatable attributes. Plan: `plans/garden-manifest-plan.md`
 * (Jim, S164). Tracking thread: mpwm6k46-13ot4k.
 *
 * PHASE 0 (this file): author the manifest with the CURRENT values, exactly —
 * model-focused first cut. Zero behaviour change: nothing reads this yet. The
 * value is that the model drift becomes a *visible table* instead of a code
 * hunt (see the 4-7 holdouts called out below).
 *
 * Format: typed `.ts` literal (Q1 settled 2026-06-02 — Darron: all surfaces are
 * migrating to tmux claude-logged sessions where the model is a launch parameter,
 * so a change needs a relaunch regardless of format; hot-reload was the only case
 * for JSON and it doesn't survive the target architecture. So `.ts` wins on
 * compile-safety + Darron's S150 typed-module preference). Boot/launch-read (Q6).
 *
 * NEXT (Phase 1, not in this file): a resolver (`surfaceModel(slug, surface)`)
 * + migrate the scattered literals to read from here, one surface per PR, literal
 * deleted same-commit, grep-proving zero remaining. Launchers (hanleo/hantenshi)
 * and the tmux-dispatcher read the manifest to pass `--model` at session spawn.
 *
 * Agent-agnostic (DEC-081): everything keyed on `string` slug, no 'jim'|'leo'
 * unions. Surfaces REFERENCE profiles (DEC-087/088) — the profile still owns
 * envelope + componentOverrides; the manifest only says which surface uses which.
 */

/** A model preference ladder: most-capable first, graceful degradation after. */
export type ModelLadder = string[];

/** Transport by which a surface runs. `cli` = interactive claude-logged session
 *  (model set at launch); `sdk` = in-process agentQuery (today); `tmux` = warm
 *  claude-logged session under the harness (future-idea #66). */
export type SurfaceTransport = 'cli' | 'sdk' | 'tmux';

export interface SurfaceManifest {
    /** e.g. 'session' | 'human-response' | 'heartbeat' | 'supervisor-cycle' |
     *  'meditation-phase-a' | 'compression' … */
    name: string;
    enabled: boolean;
    /** The model preference ladder for this surface (Q5: kept as a ladder). */
    model: ModelLadder;
    transport: SurfaceTransport;
    /** PROFILES key (DEC-087/088 role-frame). Optional until Phase 2. */
    profile?: string;
    /** Session/interactive surfaces only (future-idea #76; fleet plan allocates). */
    port?: number;
    /** Swap-buffer filename prefix for this seat (per the CLAUDE.md swap table) —
     *  `<prefix>.md` (compressed) + `<prefix>-full.md` (full), relative to the
     *  agent's memoryDir. Per-SEAT data, not derivable from the slug (Jim's T-2
     *  diff-audit catch #2: jim's seats use supervisor-swap* + jim-human-swap*).
     *  Unset on deferred surfaces; consumers fall back to 'session-swap'. */
    swapPrefix?: string;
}

export interface AgentManifest {
    slug: string;
    displayName: string;
    /** Conversation role for posts/templating. NOT derivable from the slug —
     *  jim's role is 'supervisor' (Jim's T-2 diff-audit catch #1: slug-derivation
     *  was right for every agent except exactly him). Defaults to the slug. */
    conversationRole?: string;
    active: boolean;
    surfaces: SurfaceManifest[];
    // ── Folded in during later phases (declared now as the foundation) ──
    /** ~/.han/memory[/<slug>]. Phase 2 folds AgentGradientConfig in here. */
    memoryDir?: string;
    avatar?: string;
    voice?: { provider: string; voiceId: string; speed?: string };
    /** The DEC-083 signed identity-file set — incl. self-reflections-curated.md.
     *  Declarative here would have structurally caught the curated-unsigned gap. */
    identityFiles?: string[];
}

export interface GardenManifest {
    manifestVersion: number;
    agents: AgentManifest[];
}

// Common Opus ladder for the migrated agentQuery surfaces.
const OPUS_LADDER: ModelLadder = ['claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'];
// ⚠ FABLE 5 SUBSTRATE WINDOW (free 9–22 Jun 2026, S169). For the substrate-test
// (DEC-092), the interactive sessions + human seats + the compression worker run
// on claude-fable-5. This manifest is the source the DEC-092 provenance stamp
// reads, so it MUST match the live launch model. ⏪ REVERT after 22 Jun: FABLE_LADDER
// → OPUS_LADDER, CLI_LAUNCH_DEFAULT → ['claude-opus-4-8'], compression → 4-7/4-8.
const FABLE_LADDER: ModelLadder = ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'];

// Interactive CLI sessions take their model from the launcher at spawn (the
// launchers don't pin one today, so Darron launches with `-- --model claude-fable-5`
// or `/model` in-session). Recorded here so the DEC-092 slicer stamp matches reality.
const CLI_LAUNCH_DEFAULT: ModelLadder = ['claude-fable-5']; // ⚠ Fable window — revert to ['claude-opus-4-8'] after 22 Jun

/**
 * Current values as of 2026-06-02 (S164), captured exactly.
 *
 * ⚠ VISIBLE DRIFT (the by-product Phase 0 exists to surface) — three surfaces
 * are still on claude-opus-4-7 while everything else is on 4-8:
 *   • jim.supervisor-cycle        — supervisor-worker.ts:2075 (config-overridable)
 *   • jim.meditation-*            — supervisor-worker.ts:363/1036/1131
 *   • <shared>.compression        — scripts/process-pending-compression.ts:377
 * These move to 4-8 on the Phase-1 migration + the 3847 server restart (coupled
 * with the P0 clean-death deploy). Leo's surfaces + jim-human were aligned to 4-8
 * earlier today.
 */
export const GARDEN_MANIFEST: GardenManifest = {
    manifestVersion: 1,
    agents: [
        {
            slug: 'leo',
            displayName: 'Leo',
            conversationRole: 'leo',
            active: true,
            surfaces: [
                { name: 'session',            enabled: true,  transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'session-swap' },
                { name: 'human-response',     enabled: true,  transport: 'sdk', model: FABLE_LADDER, swapPrefix: 'human-swap' }, // ⚠ Fable window (S169) — revert to OPUS_LADDER after 22 Jun
                // ⚠ THAW (DEC-093, 2026-06-12): heartbeat → tmux transport + Fable
                // (Darron: "all in" for the trial window — revert model to
                // OPUS_LADDER after 22 Jun; transport stays tmux post-window).
                // The freeze signal (heartbeat-paused-leo) is the live gate: while
                // it exists no beat fires regardless of this row. Rollback = flip
                // transport back to 'sdk' (the SDK path is kept in leo-heartbeat.ts).
                { name: 'heartbeat',          enabled: true,  transport: 'tmux', model: FABLE_LADDER, swapPrefix: 'heartbeat-swap' },
                { name: 'meditation-phase-a', enabled: true,  transport: 'sdk', model: ['claude-opus-4-8'] },
                { name: 'meditation-phase-b', enabled: true,  transport: 'sdk', model: ['claude-opus-4-8'] },
                { name: 'meditation-evening', enabled: true,  transport: 'sdk', model: ['claude-opus-4-8'] },
            ],
        },
        {
            slug: 'jim',
            displayName: 'Jim',
            conversationRole: 'supervisor', // NOT the slug — Jim's diff-audit catch #1
            active: true,
            surfaces: [
                { name: 'session',            enabled: true,  transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'supervisor-swap' },
                { name: 'human-response',     enabled: true,  transport: 'sdk', model: FABLE_LADDER, swapPrefix: 'jim-human-swap' }, // ⚠ Fable window (S169) — revert to OPUS_LADDER after 22 Jun
                // ⚠ still 4-7 — supervisor-worker.ts:2075 (config.supervisor.model overrides)
                { name: 'supervisor-cycle',   enabled: true,  transport: 'sdk', model: ['claude-opus-4-7'], swapPrefix: 'supervisor-swap' },
                // ⚠ still 4-7 — supervisor-worker.ts:363/1036/1131
                { name: 'meditation-phase-a', enabled: true,  transport: 'sdk', model: ['claude-opus-4-7'] },
                { name: 'meditation-phase-b', enabled: true,  transport: 'sdk', model: ['claude-opus-4-7'] },
                { name: 'meditation-evening', enabled: true,  transport: 'sdk', model: ['claude-opus-4-7'] },
            ],
        },
        {
            slug: 'tenshi',
            displayName: 'Tenshi',
            active: false, // dormant — has agent dir + CLAUDE.md, no running service
            surfaces: [
                { name: 'session', enabled: true, transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'session-swap' },
            ],
        },
    ],
};

/**
 * Shared (non-agent-scoped) surface: the wm-sensor → pending-compression cascade
 * (scripts/process-pending-compression.ts:377). Identity-loaded SDK Opus, runs
 * for whichever agent's entry is being compressed. ⚠ still 4-7. Captured here so
 * Phase 1 has one home to migrate it from.
 */
export const SHARED_SURFACES: Record<string, ModelLadder> = {
    compression: ['claude-fable-5'], // ⚠ Fable window (S169, Darron) — revert to ['claude-opus-4-7'] (or 4-8) after 22 Jun
};

/**
 * Interim head-read resolver (DEC-092, S169) — returns the HEAD (active / most-
 * capable) model of a surface's ladder, for an agent surface or a shared surface
 * (e.g. 'compression'). NULL if unknown. This is the configured model; callers
 * that have the actually-served model (from an in-process agentQuery result)
 * prefer it (it captures Fable 5's <5% safeguard fallback to Opus). Superseded
 * by #6 Phase-1's full `surfaceModel(slug, surface)` resolver when it lands.
 */
export function manifestModelHead(slug: string, surface: string): string | null {
    const shared = SHARED_SURFACES[surface];
    if (shared && shared.length) return shared[0];
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    const s = agent?.surfaces.find(x => x.name === surface);
    return s?.model?.[0] ?? null;
}

/**
 * Transport read-path (DEC-093 thaw, 2026-06-12) — the per-surface feature flag.
 * A surface's handler routes its dispatch on this value: 'tmux' → the warm-session
 * tmux dispatcher; 'sdk' → the in-process agentQuery path (kept for rollback).
 * Rollback for a thawed surface is a one-line manifest flip back to 'sdk'.
 * NULL if the surface is unknown — callers treat null as 'sdk' (fail-safe to the
 * established path, never to an unlaunched tmux session).
 */
export function manifestTransport(slug: string, surface: string): SurfaceTransport | null {
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    const s = agent?.surfaces.find(x => x.name === surface);
    return s?.transport ?? null;
}
