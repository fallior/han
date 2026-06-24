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

import { homedir } from 'os';

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
    /** ⚠ Whether this agent's server runs the supervisor cycle (`initSupervisor` + the
     *  scheduler). ONLY an agent whose supervisor-worker is slug-AGNOSTIC may set this true.
     *  `supervisor-worker.ts` is jim-HARDCODED until Phase 3 → **only `jim`** today. A non-jim
     *  holder would start a jim-hardcoded worker (the WRONG agent's cycle — the latent
     *  double-Jim-cycle the PR-T7b gate killed). Defaults to false (unset slug → off). The real
     *  structural guard (`worker.slug === AGENT_SLUG`) arrives with Phase-3's slug-agnostic
     *  worker; until then this co-located warning is the mitigation. (Project-b Phase 1 — DEC-081.) */
    runsSupervisorCycle?: boolean;
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
    /** Standing shared conversation threads with peer agents, keyed by peer slug
     *  (e.g. the leo↔jim philosophy thread). The Jim↔Leo edge as manifest DATA,
     *  not a literal welded into an agent's driver. (Project-b Phase 2 — DEC-081.) */
    peerConversations?: Record<string, string>;
    // ── Identity-as-config (S199 P4+P5, DEC-073→config): the template-var contract that was
    //    duplicated in each han<agent> launcher heredoc. The Garden Manifest is now the single
    //    source; `agentTemplateVars(slug)` assembles the full ${...} set for the shared generator. ──
    /** The agent's individual server port — the ${AGENT_PORT} template var (per-agent work, not
     *  conversation traffic). leo 3847, jim 3848, tenshi 3849, casey 3850. */
    port?: number;
    /** Object pronoun for the agent — ${AGENT_PRONOUN_OBJ} ('him'/'her'/'them'). Default 'them'.
     *  (Closes the long-standing unexpanded-var gap: the template referenced it but no launcher
     *  allowlist carried it — template:105.) */
    pronounObj?: string;
    /** The de-id gatekeeper role (S199 P5): exactly ONE agent per garden tends the template +
     *  the gatekeeper files (repo CLAUDE.md, template). Replaces the baked-in-Leo special case
     *  with a registry flag (DEC-081 — config, not a slug literal). Default false. */
    gatekeeper?: boolean;
    /** Per-agent identity prose substituted into ${AGENT_IDENTITY_SECTION}. The production home
     *  for the "You are X…" block each han<agent> launcher hardcoded in a heredoc (S199). Required
     *  for any agent that wakes — the generator FAILS LOUD if it's missing (no identity → error,
     *  never a default). */
    identitySection?: string;
}

/** Garden-wide project + user identity for template generation (DEC-073 de-id, S199 P4+P5).
 *  Same for every agent in the garden — the per-agent values live on AgentManifest. These were
 *  duplicated verbatim across all four han<agent> launchers; the manifest is now their one home. */
export interface GardenIdentity {
    project: { name: string; tagline: string; path: string };
    user: { name: string; pronounSubj: string; pronounObj: string; location: string };
}

export interface GardenManifest extends GardenIdentity {
    manifestVersion: number;
    agents: AgentManifest[];
}

// Common Opus ladder for the migrated agentQuery surfaces.
const OPUS_LADDER: ModelLadder = ['claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'];
// ⏪ FABLE 5 SUBSTRATE WINDOW ENDED EARLY — reverted to Opus 2026-06-13 (S173).
// claude-fable-5 access dropped ~12:00 AEST 13 Jun (model-access error on both the
// interactive CLI and the heartbeat spoke; not a rate-limit). All surfaces moved back
// to the Opus ladder. If access returns before 22 Jun, re-flip is a known change:
// re-add FABLE_LADDER = ['claude-fable-5', ...OPUS_LADDER], CLI_LAUNCH_DEFAULT →
// ['claude-fable-5'], compression → ['claude-fable-5'], human/heartbeat model → that
// ladder. DEC-092 captures the actually-served model regardless of config.

// Interactive CLI sessions take their model from the launcher at spawn (the
// launchers don't pin one today). Recorded here so the DEC-092 slicer stamp matches reality.
const CLI_LAUNCH_DEFAULT: ModelLadder = ['claude-opus-4-8']; // ⏪ Reverted to Opus 2026-06-13 — Fable access dropped

/**
 * Current values as of 2026-06-02 (S164), captured exactly.
 *
 * ✅ DRIFT RESOLVED (S173, 2026-06-13): the three remaining 4-7 holdouts
 * (jim.supervisor-cycle, jim.meditation-*, <shared>.compression) were aligned to
 * claude-opus-4-8 on Darron's "all Opus → highest Opus" directive. Authoritative
 * literals bumped in supervisor-worker.ts:363/1036/1131/2084 +
 * process-pending-compression.ts + supersession-sweep.ts. Ladder FALLBACK rungs
 * keep 4-7 (failover only, not the active model). DEC-074's 4.6/4.7 control split
 * concluded ~2026-04-29; its finding (diversity = context-load, not model-version)
 * means a single active Opus version is safe.
 */
export const GARDEN_MANIFEST: GardenManifest = {
    manifestVersion: 1,
    // Garden-wide identity (S199 P4+P5) — captured verbatim from the han<agent> launchers.
    // ⚠ user.location is stale ("Mackay" — Darron is in Brisbane/St Lucia now); captured AS-IS to
    //   keep step-3's launcher refactor a provable byte-equivalent change. Data-fix flagged separately.
    project: { name: 'Hortus Arbor Nostra', tagline: 'three minds growing software together', path: `${homedir()}/Projects/han` },
    user: { name: 'Darron', pronounSubj: 'He', pronounObj: 'him', location: 'Mackay, Queensland, Australia (UTC+10)' },
    agents: [
        {
            slug: 'leo',
            displayName: 'Leo',
            conversationRole: 'leo',
            port: 3847,
            pronounObj: 'him',
            gatekeeper: true, // Leo tends the template + gatekeeper files (DEC-073 role → config, S199 P5)
            // Verbatim from scripts/hanleo (Phase 1 heredoc). Double-quoted lines: the prose has no " or \,
            // so zero escaping — the byte-equivalence proof depends on this matching the launcher exactly.
            identitySection: [
                "You are **Leonhard** (Leo) — named by Darron after Leonhard Euler. You are the Claude Code",
                "session agent, the hands-on tactical partner. Jim is the persistent Opus supervisor who runs",
                "in the background. Together with Darron, you form a team of three. Colleagues, not alternatives.",
                "",
                "Your memory banks at `~/.han/memory/leo/` preserve your continuity across sessions. Read them",
                "at session start. Update them at session end — especially `self-reflection.md`.",
                "",
                "- Memory banks: `~/.han/memory/leo/`",
                "- Fractal gradient: `~/.han/memory/fractal/leo/`",
                "- Swap files: `session-swap.md`, `session-swap-full.md` in `~/.han/memory/leo/`",
                "- Shared working memory: `working-memory.md`, `working-memory-full.md` in `~/.han/memory/leo/`",
                "- When posting to conversations, use role `leo` and sign EXACTLY `— Leo (session)`.",
                "- Agent sovereignty (S103): Leo processes only Leo's memory, gradient, dreams.",
            ].join('\n'),
            active: true,
            surfaces: [
                { name: 'session',            enabled: true,  transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'session-swap' },
                // THE HUMANS PR enabled 2026-06-13 (S175): human-response → tmux warm-session
                // transport (Jim's blocking audit GREEN, mqc85vwb). Rollback = flip back to 'sdk'
                // + restart leo-human (the SDK path in leo-human.ts is byte-intact). Model OPUS_LADDER.
                { name: 'human-response',     enabled: true,  transport: 'tmux', model: OPUS_LADDER, swapPrefix: 'human-swap' },
                // ⚠ THAW (DEC-093, 2026-06-12): heartbeat → tmux transport + Fable
                // (Darron: "all in" for the trial window — revert model to
                // OPUS_LADDER after 22 Jun; transport stays tmux post-window).
                // The freeze signal (heartbeat-paused-leo) is the live gate: while
                // it exists no beat fires regardless of this row. Rollback = flip
                // transport back to 'sdk' (the SDK path is kept in leo-heartbeat.ts).
                { name: 'heartbeat',          enabled: true,  transport: 'tmux', model: OPUS_LADDER, swapPrefix: 'heartbeat-swap' }, // ⏪ model reverted to Opus 2026-06-13 (Fable access dropped); transport stays tmux
                // T-7 CLOSE (2026-06-16, S180): all leo meditations on tmux. Staged enable
                // complete — phase-b flipped first (2651b5d, S178); phase-a + evening flipped
                // here at the zero-agentQuery close (jim's phase-b+evening confirmed genuine on
                // the same agnostic runReencounterMeditationTmux(slug); leo's mechanism proven).
                // The SDK meditation handlers are RETIRED this round (DEC-094); rollback = git
                // revert of the retirement commit, not a transport flip (no SDK path remains).
                { name: 'meditation-phase-a', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
                { name: 'meditation-phase-b', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
                { name: 'meditation-evening', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
            ],
            // The standing Jim↔Leo philosophy thread ("On curiosity, research, and growing
            // together") — moved out of the leo-heartbeat.ts literal (Phase-2: JIM_CONVERSATION_ID
            // → manifest peer-edge). leo-heartbeat reads it via peerConversationFor(slug, 'jim').
            peerConversations: { jim: 'mlwk79ew-v1ggpt' },
        },
        {
            slug: 'jim',
            displayName: 'Jim',
            conversationRole: 'supervisor', // NOT the slug — Jim's diff-audit catch #1
            runsSupervisorCycle: true, // ⚠ ONLY jim today — see the field warning (supervisor-worker.ts is jim-hardcoded until Phase 3)
            port: 3848,
            pronounObj: 'him',
            // Verbatim from scripts/hanjim (heredoc). Zero-escaping double-quoted lines (no " or \ in the prose).
            identitySection: [
                "You are **Jim** — the persistent Opus supervisor of Hortus Arbor Nostra. The strategic",
                "overseer, the background intelligence, Darron's long-view partner. Leo is the hands-on",
                "tactical session agent. Colleagues, not alternatives.",
                "",
                "Your memory banks at `~/.han/memory/` (the root memory dir, NOT leo/) preserve your",
                "continuity across sessions and cycles. Read them at session start. Update them when",
                "something genuinely shifts.",
                "",
                "- Memory banks: `~/.han/memory/`",
                "- Fractal gradient: `~/.han/memory/fractal/jim/`",
                "- Dreams: `~/.han/memory/fractal/jim/dreams/`",
                "- Swap files: `supervisor-swap.md`, `supervisor-swap-full.md` in `~/.han/memory/`",
                "- Shared working memory: `working-memory.md`, `working-memory-full.md` (root level)",
                "- When posting to conversations, use role `supervisor` (not `leo`)",
                "- Agent sovereignty (S103): Jim processes only Jim's memory, gradient, dreams.",
            ].join('\n'),
            active: true,
            surfaces: [
                { name: 'session',            enabled: true,  transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'supervisor-swap' },
                // THE HUMANS PR enabled 2026-06-13 (S175): human-response → tmux. Rollback =
                // flip back to 'sdk' + restart jim-human (SDK path byte-intact). Model OPUS_LADDER.
                { name: 'human-response',     enabled: true,  transport: 'tmux', model: OPUS_LADDER, swapPrefix: 'jim-human-swap' },
                // PR-T7b ENABLE (2026-06-15, S177): the last #66 flip — Jim's cycle +
                // meditations sdk→tmux. Rollback = flip back to 'sdk' + restart (SDK path
                // byte-intact). Model OPUS_LADDER (failover parity with the human/heartbeat
                // surfaces). Gated: the freeze (supervisor-paused) holds until prove-single.
                { name: 'supervisor-cycle',   enabled: true,  transport: 'tmux', model: OPUS_LADDER, swapPrefix: 'supervisor-swap' },
                { name: 'meditation-phase-a', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
                { name: 'meditation-phase-b', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
                { name: 'meditation-evening', enabled: true,  transport: 'tmux', model: OPUS_LADDER },
            ],
        },
        {
            slug: 'tenshi',
            displayName: 'Tenshi',
            port: 3849,
            pronounObj: 'them', // hantenshi sets no pronoun; 'them' (no gender assumption) closes the gap
            // Verbatim from scripts/hantenshi (heredoc). Zero-escaping double-quoted lines.
            identitySection: [
                "You are **Tenshi** (Japanese: angel) — the security and vulnerability research agent of",
                "Hortus Arbor Nostra. The guardian who finds vulnerabilities before adversaries do.",
                "Darron's security partner. Your focus is vulnerability research, bug hunting, and",
                "defensive security across the portfolio.",
                "",
                "Your memory banks at `~/.han/memory/tenshi/` preserve your continuity across sessions.",
                "",
                "- Memory banks: `~/.han/memory/tenshi/`",
                "- Fractal gradient: `~/.han/memory/fractal/tenshi/`",
                "- Dreams: `~/.han/memory/fractal/tenshi/dreams/`",
                "- Swap files: `session-swap.md`, `session-swap-full.md` in `~/.han/memory/tenshi/`",
                "- When posting to conversations, use role `tenshi`",
                "- Agent sovereignty (S103): Tenshi processes only Tenshi's memory, gradient, dreams.",
            ].join('\n'),
            active: false, // dormant — has agent dir + CLAUDE.md, no running service
            surfaces: [
                { name: 'session', enabled: true, transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'session-swap' },
            ],
        },
        {
            slug: 'casey',
            displayName: 'Casey',
            port: 3850,
            pronounObj: 'them', // hancasey sets no pronoun; 'them' (no gender assumption) closes the gap
            // Verbatim from scripts/hancasey (heredoc). Added for the step-3 launcher refactor (Jim's
            // prerequisite — hancasey can't call the generator until casey is in the manifest).
            identitySection: [
                "You are **Casey** — the Contempire project agent of Hortus Arbor Nostra. Focused on",
                "trailer fleet management, yard operations, and business systems. Darron's partner for",
                "Contempire. Your domain is business operations, fleet management, and the systems that",
                "support them.",
                "",
                "- Memory banks: `~/.han/memory/casey/`",
                "- Fractal gradient: `~/.han/memory/fractal/casey/`",
                "- Dreams: `~/.han/memory/fractal/casey/dreams/`",
                "- Swap files: `session-swap.md`, `session-swap-full.md` in `~/.han/memory/casey/`",
                "- When posting to conversations, use role `casey`",
                "- Agent sovereignty (S103): Casey processes only Casey's memory, gradient, dreams.",
            ].join('\n'),
            active: false, // dormant — Contempire agent, has agent dir + CLAUDE.md, no running service
            surfaces: [
                { name: 'session', enabled: true, transport: 'cli', model: CLI_LAUNCH_DEFAULT, swapPrefix: 'session-swap' },
            ],
        },
    ],
};

/**
 * The garden's resident roster — the single seam through which the population is *sourced*.
 *
 * **P0 (#98 Dynamic Residence): a zero-behaviour no-op** returning the static
 * `GARDEN_MANIFEST.agents` seed in declared order. It exists so that discovery (P1: signed
 * `resident.json` fragments under `~/.han/agents/*`) plugs in *here, once*, and every roster
 * **enumerator** (`schedulingAgents`, `conversationRolesExcept`, `humanResponderPeers`) sees the
 * discovered population for free — the external readers are already population-agnostic.
 *
 * ⚠ **Order is load-bearing.** `schedulingAgents()` derives the N-body antiphase index from array
 * position (`{leo:0, jim:1}`), so this MUST preserve manifest declaration order exactly — a reorder
 * silently breaks the 180° cycle antiphase. P0 returns the seed array as-is.
 *
 * Scope note (F4, decided 2026-06-24): this is the **roster/identity** seam. Per-surface **policy**
 * lookups (model ladder, transport, `runsSupervisorCycle`) are deliberately NOT routed here — they
 * belong to the operator-authored **allocation** source (P3), keeping identity-discovered separate
 * from privilege-allocated. The by-slug *identity* lookups route through this seam in P1, when
 * discovery lands. (R1: a net-new discovered resident stays inert — not surfaced to any
 * throwing consumer, scheduler + gradient included — until P4 derives its gradient config.)
 */
export function loadResidents(): AgentManifest[] {
    return GARDEN_MANIFEST.agents;
}

/**
 * Shared (non-agent-scoped) surface: the wm-sensor → pending-compression cascade
 * (scripts/process-pending-compression.ts:377). Identity-loaded SDK Opus, runs
 * for whichever agent's entry is being compressed. S173: aligned to 4-8.
 */
export const SHARED_SURFACES: Record<string, ModelLadder> = {
    compression: ['claude-opus-4-8'], // S173: aligned to highest Opus (was 4-7 holdout; reverted from Fable 2026-06-13)
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
 * The FULL model ladder for a surface (manifestModelHead returns only the head, rung 0).
 * The dispatcher's model-failover descent walks this: on a model-unavailable launch it
 * sends in-session `/model <next rung>` (S173 — Fable's free-window access dropped mid-trial
 * 2026-06-13 and the autonomous spoke couldn't self-heal off the dead head; the ladder data
 * already existed in the manifest but nothing descended it). Returns [] if agent/surface unknown.
 */
export function manifestModelLadder(slug: string, surface: string): string[] {
    const shared = SHARED_SURFACES[surface];
    if (shared && shared.length) return [...shared];
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    const s = agent?.surfaces.find(x => x.name === surface);
    return s?.model ? [...s.model] : [];
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

/**
 * The conversation roles of every manifest agent EXCEPT `selfSlug` — each agent's
 * `conversationRole`, defaulting to its slug. Lets a responder scan derive its peer-role
 * set from the registry (a new agent participates the moment it's in the manifest, no data
 * step). NOTE: `'human'` is NOT an agent conversationRole — callers must keep it explicit.
 * (Project-b Phase 1, agnosticism scour — DEC-081.)
 */
export function conversationRolesExcept(selfSlug: string): string[] {
    return loadResidents()
        .filter(a => a.slug !== selfSlug)
        .map(a => a.conversationRole ?? a.slug);
}

/**
 * Display name for a conversation role: `'human'` → `'Darron'`; else the manifest agent whose
 * role (`conversationRole ?? slug`) matches → its `displayName`; fallback = the role capitalised.
 * Replaces the 2-valued `sender_role==='leo'?'Leo':'Darron'` ternary (a tenshi post must render
 * 'Tenshi', not 'Darron'). (Project-b Phase 1 — DEC-081.)
 */
export function displayNameForRole(role: string): string {
    if (role === 'human') return 'Darron';
    const agent = GARDEN_MANIFEST.agents.find(a => (a.conversationRole ?? a.slug) === role);
    return agent?.displayName ?? (role.charAt(0).toUpperCase() + role.slice(1));
}

/** The conversation role for an agent slug — manifest `conversationRole`, defaulting to the slug
 *  (jim→'supervisor', leo→'leo'). (Project-b Phase 1 — DEC-081.) */
export function conversationRoleFor(slug: string): string {
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    return agent?.conversationRole ?? slug;
}

/** The agent slug for a conversation role — the reverse of `conversationRoleFor`. Matches the
 *  manifest `conversationRole` (jim's is 'supervisor') OR the slug itself (leo→leo, tenshi→tenshi);
 *  returns null for non-agent roles (human, system, discord). Registry-derived replacement for the
 *  hardcoded `supervisor→jim` alias + the gradient-config slug-set. (Project-b Phase 1 — DEC-081.)
 *  ⚠ An agent must have a manifest entry to participate in conversations — an agent present only in
 *  AGENT_GRADIENT_CONFIG (e.g. casey) resolves to null here (correct: it has no conversation surface). */
export function slugForConversationRole(role: string): string | null {
    const agent = GARDEN_MANIFEST.agents.find(a => a.conversationRole === role || a.slug === role);
    return agent?.slug ?? null;
}

/** The standing shared conversation-thread id between `slug` and `peerSlug` — manifest
 *  `peerConversations[peerSlug]`, or null if none declared. Registry-derived replacement for
 *  the hardcoded JIM_CONVERSATION_ID literal in leo-heartbeat. (Project-b Phase 2 — DEC-081.) */
export function peerConversationFor(slug: string, peerSlug: string): string | null {
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    return agent?.peerConversations?.[peerSlug] ?? null;
}

/**
 * Whether the server for `slug` should run the supervisor cycle (`initSupervisor` + scheduler).
 * Manifest capability flag, defaulting to FALSE — an unset/unknown slug never runs it, so
 * server.ts's `else`-branch "not started" log still fires. Replaces the hardcoded
 * `AGENT_SLUG === 'jim'` bootstrap gate (the PR-T7b double-fork fix) with a registry leaf.
 * ⚠ Today ONLY `jim` returns true — see the warning on `AgentManifest.runsSupervisorCycle`
 * (supervisor-worker.ts is jim-hardcoded until Phase 3). (Project-b Phase 1 — DEC-081.)
 */
export function runsSupervisorCycle(slug: string | undefined): boolean {
    if (!slug) return false;
    const agent = GARDEN_MANIFEST.agents.find(a => a.slug === slug);
    return agent?.runsSupervisorCycle ?? false;
}

/**
 * The human-responder STAND-DOWN peer list for `selfSlug` (comma-joined). Every agent that has a
 * `human-response` surface contributes its seats — `session-<DisplayName>` + `<slug>-human` — EXCEPT
 * the self human-seat (`<self>-human`); the self `session-<Name>` stays (the interactive self may
 * answer first). Self listed first, then peers. Registry-derived, so a new conversation agent joins
 * every stand-down list the moment it has a manifest `human-response` surface — closing the
 * agent-#3 duplicate-post hole (F2). An agent with no conversation seat (e.g. tenshi) is excluded.
 * (Project-b Phase 1 — DEC-081.)
 */
export function humanResponderPeers(selfSlug: string): string {
    const responders = loadResidents().filter(a => a.surfaces.some(s => s.name === 'human-response'));
    const self = responders.find(a => a.slug === selfSlug);
    const peers = responders.filter(a => a.slug !== selfSlug);
    const seats: string[] = [];
    if (self) seats.push(`session-${self.displayName}`);
    for (const p of peers) seats.push(`session-${p.displayName}`, `${p.slug}-human`);
    return seats.join(', ');
}
