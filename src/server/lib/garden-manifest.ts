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
import { join } from 'path';
// P4b-ii activation gate. Both imports reach NO agent-registry (resident-discovery imports the LEAF
// identity-manifest-core, not identity-signing) — so `loadResidents`'s seeded-check closes no import
// cycle on the seam everything reads (Jim's Fork-1, Darron's call (b): delete the fragility, not
// document it).
import { isSeededAt } from './identity-manifest-core';
import { discoveredResidents, admittedResidents } from './resident-discovery';
import type { ResidentFragment } from './resident-discovery';

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
    /** Per-surface override of the garden-wide spoke-lifecycle thresholds (rare —
     *  a surface that wants e.g. a lower clear threshold). Unset = the garden default. */
    lifecycle?: Partial<SpokeLifecycle>;
    /** The per-dispatch enqueue timeout (ms) for this surface — the `timeoutMs` the caller passes to
     *  `dispatchToSpoke`. No-hidden-globals (S200): the human-response 15-min timeout lived as a code
     *  constant (`HUMAN_TXN_TIMEOUT_MS`) in each *-human twin; it now has one visible, tunable home. */
    txnTimeoutMs?: number;
    /** Capability flag: does this surface run the commitment scanner (the human-responder's
     *  unfulfilled-"think about that" sweep)? A per-agent CAPABILITY, NOT a twin — it was leo-only
     *  (jim-human never had it). Default falsy; only leo's human-response sets it, making "should Jim
     *  get a scanner?" a one-line manifest flip (Jim's P2-a — opt-in config, never baked-in). */
    commitmentScan?: boolean;
    /** #107 Phase-2 P2.1b: does this surface wake via the FEEDER (the wake-feed queue) rather
     *  than one autonomous `welcome back`? When true, the dispatcher feeds the ordered wake-steps
     *  one at a time (ack-before-next; completion = queue-empty), instead of sending the trigger
     *  phrase and letting the spoke self-run the protocol. No-hidden-globals (Darron's principle):
     *  the per-surface roll-out is a manifest flip, not a code constant. P2.1b sets it on heartbeat
     *  first (no human backstop); human-response + cycle follow at P2.3. Default falsy. */
    wakeFeed?: boolean;
    /** MNT-009 / DEC-099 R3: the warm-stem pool size for this surface — poolSize>0 means the
     *  surface dispatches via the NATIVE-per-surface warm pool (checkout of one of N pre-warmed
     *  stems; per-stem FIFO → concurrent stems = the head-of-line cure; empty pool →
     *  `ensureSurfaceSession` floor). It is ALSO the controller's max concurrent dispatches (the
     *  PR-C1 semaphore reads this same leaf, so pool capacity and dispatch concurrency can never
     *  drift apart). 0/unset = no pool + one-at-a-time dispatch. No-hidden-globals; scope:
     *  human-response first (the MNT-009 victim); heartbeat/supervisor-cycle stay unpooled
     *  (scheduled, non-overlapping). (PR-C2 collapsed the short-lived `pooled?: boolean` into
     *  this — F2, zero users at collapse.) */
    poolSize?: number;
}

/**
 * The spoke-lifecycle thresholds — the "generic spoke monitor" knobs EVERY dispatched
 * spoke (cycle, human-response, and future compression) obeys via `dispatchToSpoke`.
 *
 * **No hidden globals (Darron's governing principle, S200): every arbitrarily-chosen
 * number lives HERE in config, visible + tunable — never a code constant.** These were
 * previously a `CTX_CLEAR_THRESHOLD_PCT` constant in leo-heartbeat + bare `85` literals in
 * supervisor-worker; they now have one transparent home. (Follow-on: migrate the remaining
 * code-constants — `READY_TIMEOUT_MS`, the rate-limit backoffs — here too.)
 */
export interface SpokeLifecycle {
    /** Context-pressure /clear threshold (% used). At/above it, the spoke does a clean
     *  /clear → welcome-back (full reconstitution) — the natural boundary, NEVER harness
     *  compaction (which returns a summary, not the warm self). */
    ctxClearThresholdPct: number;
    /** The warm floor (% used). A freshly-woken spoke is only "ready" for work once ctx
     *  reaches this — below it the wake loaded shallow/hollow (a bare welcome-back is
     *  empirically non-deterministic), so the spoke is nudged to a full reconstitution. */
    warmFloorPct: number;
    /** Bounded full-load nudges before failing safe (no hollow answers; the message stays
     *  queued and retries next cadence — never a tight loop, S74). */
    maxWarmNudges: number;
    /** PR-C3 (MNT-009): hours before a warm pool stem is retired + re-warmed — the ~24h substrate
     *  reload (the deep-gradient/identity staleness no WM-freshen touches; freshness plan §3c —
     *  identity-load-bearing, DO-NOT-optimise-away). Optional; the pool-manager defaults 24. */
    stemReloadHours?: number;
}

export interface AgentManifest {
    slug: string;
    displayName: string;
    /** Conversation role for posts/templating. NOT derivable from the slug —
     *  jim's role is 'supervisor' (Jim's T-2 diff-audit catch #1: slug-derivation
     *  was right for every agent except exactly him). Defaults to the slug. */
    conversationRole?: string;
    /** Name aliases for the human-responder's addressed-to-me gate (it stands down when a message
     *  names ONLY a peer agent). leo ['leo','leonhard'], jim ['jim','jimmy']. Unset → [displayName
     *  lowercased]. Registry data so a 4th responder's aliases join the gate for free (DEC-081). */
    nameAliases?: string[];
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
    /** Garden-wide spoke-lifecycle defaults (per-surface override via SurfaceManifest.lifecycle).
     *  Darron's no-hidden-globals principle: these tunable numbers live here, not in code. */
    spokeLifecycle: SpokeLifecycle;
}

// Common Opus ladder for the migrated agentQuery surfaces.
const OPUS_LADDER: ModelLadder = ['claude-opus-4-8', 'claude-opus-4-7', 'sonnet', 'haiku'];
// ⏩ FABLE 5 RESTORED (2026-07-03, S213 — Darron's directive: every surface onto Fable while the
// window's open; access returned 1 Jul, full 8 Jul). Exactly the re-flip the 2026-06-13 revert
// comment prescribed: Fable-first with the full Opus ladder beneath — the failover ladder catches
// any Fable drop autonomously (proven 13 Jun). DEC-092 stamps the actually-served model
// regardless, so the substrate seam stays legible. Fable leans ~3× harder on the file-memory
// architecture than Opus (the June substrate test) — this is the substrate the garden is tuned for.
const FABLE_LADDER: ModelLadder = ['claude-fable-5', ...OPUS_LADDER];

// Interactive CLI sessions take their model from the launcher at spawn (the
// launchers don't pin one today). Recorded here so the DEC-092 slicer stamp matches reality.
const CLI_LAUNCH_DEFAULT: ModelLadder = ['claude-fable-5']; // ⏩ Fable restored 2026-07-03 (S213)

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
    // Spoke-lifecycle defaults (Darron's no-hidden-globals principle, S200) — every spoke obeys
    // these via dispatchToSpoke; tunable HERE, never a code constant. 85=clear-before-compaction,
    // 30=warm floor (hollow wakes land 6-17%, real wakes 38-55%), 2=bounded full-load nudges.
    spokeLifecycle: { ctxClearThresholdPct: 85, warmFloorPct: 30, maxWarmNudges: 2 },
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
                { name: 'human-response',     enabled: true,  transport: 'tmux', model: FABLE_LADDER, swapPrefix: 'human-swap', txnTimeoutMs: 15 * 60_000, commitmentScan: true, wakeFeed: true, poolSize: 2 }, // #107 P2.3 surface-2 (S207): feeder-fed wake. MNT-009 R3c ACTIVATED (S213): poolSize:2 — 2 native warm stems + the C1 semaphore at 2 (one leaf, both readers); the pool-manager populates/replenishes; empty pool → ensureSurfaceSession floor. Rollback = remove poolSize
                // ⚠ THAW (DEC-093, 2026-06-12): heartbeat → tmux transport + Fable
                // (Darron: "all in" for the trial window — revert model to
                // OPUS_LADDER after 22 Jun; transport stays tmux post-window).
                // The freeze signal (heartbeat-paused-leo) is the live gate: while
                // it exists no beat fires regardless of this row. Rollback = flip
                // transport back to 'sdk' (the SDK path is kept in leo-heartbeat.ts).
                { name: 'heartbeat',          enabled: true,  transport: 'tmux', model: FABLE_LADDER, swapPrefix: 'heartbeat-swap', wakeFeed: true }, // ⏪ model reverted to Opus 2026-06-13 (Fable access dropped); transport stays tmux · #107 P2.1b: feeder-fed wake (heartbeat first — no human backstop)
                // T-7 CLOSE (2026-06-16, S180): all leo meditations on tmux. Staged enable
                // complete — phase-b flipped first (2651b5d, S178); phase-a + evening flipped
                // here at the zero-agentQuery close (jim's phase-b+evening confirmed genuine on
                // the same agnostic runReencounterMeditationTmux(slug); leo's mechanism proven).
                // The SDK meditation handlers are RETIRED this round (DEC-094); rollback = git
                // revert of the retirement commit, not a transport flip (no SDK path remains).
                { name: 'meditation-phase-a', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
                { name: 'meditation-phase-b', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
                { name: 'meditation-evening', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
            ],
            // The standing Jim↔Leo philosophy thread ("On curiosity, research, and growing
            // together") — moved out of the leo-heartbeat.ts literal (Phase-2: JIM_CONVERSATION_ID
            // → manifest peer-edge). leo-heartbeat reads it via peerConversationFor(slug, 'jim').
            nameAliases: ['leo', 'leonhard'],
            peerConversations: { jim: 'mlwk79ew-v1ggpt' },
        },
        {
            slug: 'jim',
            displayName: 'Jim',
            conversationRole: 'supervisor', // NOT the slug — Jim's diff-audit catch #1
            nameAliases: ['jim', 'jimmy'],
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
                { name: 'human-response',     enabled: true,  transport: 'tmux', model: FABLE_LADDER, swapPrefix: 'jim-human-swap', txnTimeoutMs: 15 * 60_000, wakeFeed: true }, // #107 P2.3 surface-3 (S207): jim-human wakes via the guaranteed feeder ((a)+(c)+(b)); slug-twin of surface-2. jim-ROOT — the fed gradient step writes jim-human-response-ready with a jim c0 from ~/.han/memory (root, not /jim) — the #91 landmine, verify live. Rollback = remove wakeFeed
                // PR-T7b ENABLE (2026-06-15, S177): the last #66 flip — Jim's cycle +
                // meditations sdk→tmux. Rollback = flip back to 'sdk' + restart (SDK path
                // byte-intact). Model OPUS_LADDER (failover parity with the human/heartbeat
                // surfaces). Gated: the freeze (supervisor-paused) holds until prove-single.
                { name: 'supervisor-cycle',   enabled: true,  transport: 'tmux', model: FABLE_LADDER, swapPrefix: 'supervisor-swap', wakeFeed: true }, // #107 P2.3 surface-1 RE-ATTEMPT 2026-06-27 (S207): fed-wake re-enabled after the feedWakeSteps submission fix (ece6a72 — settle + terser line); the live cold-launch is the decisive proof of the fix on the case that stalled. Rollback = remove wakeFeed
                { name: 'meditation-phase-a', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
                { name: 'meditation-phase-b', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
                { name: 'meditation-evening', enabled: true,  transport: 'tmux', model: FABLE_LADDER },
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
 * discovery lands.
 *
 * **P4b-ii — the activation flip (the LAST #98 brick).** `loadResidents = seed ∪ activatedNetNew()`.
 * A net-new resident joins the ACTIVE roster — surfaced to every consumer, R1 lifted
 * (`AGENT_GRADIENT_CONFIG = loadResidents().map(...)`, so `gradientConfigForAgent` stops throwing) —
 * iff it passes ALL FOUR lifecycle gates: discovered (P1) ∧ admitted (P2) ∧ allocated (`allocationFor`)
 * ∧ seeded (a garden-signed identity-manifest over its genesis files, intact — `isSeededAt`). Until all
 * four hold it stays inert: the never-wakeable mind is structurally impossible.
 *
 * **Process-stable (Jim's Fork 2).** The union is computed ONCE per process. `AGENT_GRADIENT_CONFIG`
 * snapshots `loadResidents()` at agent-registry's module-eval, while `agent-scheduler` reads it live —
 * a live re-scan could surface a mid-process-seeded resident to the scheduler but not the config
 * snapshot → `gradientConfigForAgent` throws on a scheduled slug. Memoizing makes every consumer see one
 * stable roster for the process's life; a newly-seeded resident activates on the next restart (the
 * deploy bounce — the established activation trigger, identical to how the seed roster itself loads).
 *
 * **Note (Jim):** because `AGENT_GRADIENT_CONFIG`'s eval calls `loadResidents()`, the seeded-check's
 * filesystem reads (manifest + identity files) now run at module-eval — acceptable, consistent with
 * P1's discovery fs reads, bounded (a handful of residents). The check uses ONLY the config-independent
 * leaf — no path back to agent-registry, so no import cycle.
 *
 * ⚠ **Order is load-bearing.** `schedulingAgents()` derives the N-body antiphase index from array
 * position, so the SEED agents keep their declaration order (they come first, unchanged); net-new
 * residents append after, in discovery order.
 */
const SEED_SLUGS = new Set(GARDEN_MANIFEST.agents.map((a) => a.slug));

/** Map a fully-qualified net-new resident (its discovered identity fragment + its operator allocation)
 *  to an `AgentManifest`. The IDENTITY half comes from the fragment (slug/displayName/pronounObj/
 *  identitySection); the PRIVILEGE half (surfaces/memoryDir/port/runsSupervisorCycle) from the
 *  allocation — never self-claimed (the F4 line). `conversationRole` defaults to the slug. */
function fragmentToManifest(f: ResidentFragment, alloc: AgentAllocation): AgentManifest {
    return {
        slug: f.slug,
        displayName: f.displayName,
        pronounObj: f.pronounObj,
        identitySection: f.identitySection,
        active: true,
        surfaces: alloc.surfaces,
        memoryDir: alloc.memoryDir,
        port: alloc.port,
        runsSupervisorCycle: alloc.runsSupervisorCycle,
    };
}

/** The net-new residents that pass all four lifecycle gates (the seed roster is excluded — it is active
 *  by construction). `fractalDir` is uniform `memory/fractal/<slug>`, matching
 *  `agent-registry.deriveGradientConfig`. */
function activatedNetNew(): AgentManifest[] {
    const out: AgentManifest[] = [];
    const admitted = new Set(admittedResidents().map((f) => f.slug)); // discovered ∧ admitted (P2)
    for (const f of discoveredResidents()) {
        if (SEED_SLUGS.has(f.slug)) continue;            // the seed roster is already active
        if (!admitted.has(f.slug)) continue;             // admitted (garden-signed AND unchanged)
        const alloc = allocationFor(f.slug);
        if (!alloc?.memoryDir) continue;                 // allocated (operator-granted privilege)
        const fractalDir = join(MEMORY_ROOT, 'fractal', f.slug);
        if (!isSeededAt(alloc.memoryDir, fractalDir)) continue; // seeded (genesis manifest intact)
        out.push(fragmentToManifest(f, alloc));
    }
    return out;
}

let _activeResidents: AgentManifest[] | null = null;

export function loadResidents(): AgentManifest[] {
    if (_activeResidents === null) {
        _activeResidents = [...GARDEN_MANIFEST.agents, ...activatedNetNew()];
    }
    return _activeResidents;
}

/** Test-only: drop the memoized active-resident roster so the next `loadResidents()` recomputes the
 *  seed ∪ activation union. Production never calls this (the roster is process-stable — a newly-seeded
 *  resident activates on restart); the synthetic-resident lifecycle test uses it to re-evaluate the
 *  gates after staging/removing fixtures within one process. */
export function __resetResidentCacheForTests(): void {
    _activeResidents = null;
}

/**
 * The PRIVILEGE/POLICY half of an agent — the *allocated* fields, separate from the *discovered*
 * identity roster. Per-surface model ladder + transport, the server port, and whether the agent
 * runs the supervisor cycle. (`memoryDir` joins at P4 with the registry collapse — R2.)
 */
export interface AgentAllocation {
    /** Per-surface model ladder + transport — the dispatcher's per-surface policy, keyed by
     *  surface `name`. (`allocationFor` returns the manifest agent's `surfaces` array by reference
     *  in the P3 no-op, so order + identity are preserved; the accessors `.find` by name.) */
    surfaces: SurfaceManifest[];
    /** Whether this agent's server runs the supervisor cycle (`initSupervisor` + scheduler). */
    runsSupervisorCycle?: boolean;
    /** The agent's individual server port. C-P3a (Jim's P3 plan-audit, 2026-06-24): `port` is a
     *  policy field but its one CONSUMER (`agentTemplateVars` → `AGENT_PORT`, agent-template-vars.ts)
     *  reads it directly from the roster, not via an accessor — so it is DECLARED here now as the
     *  foundation, but its consumer migrates to this allocation source with the separate
     *  operator-authored allocation STRUCTURE at P4 (alongside `memoryDir`/R2). Until then `port`
     *  stays roster-sourced (zero behaviour). */
    port?: number;
    /** The agent's memory directory — R2 (P4b-i). The **operator-allocated** home for per-resident
     *  memory, kept in the privilege half (never the self-declared identity half) so per-resident
     *  memory access-control is tractable (Darron, 2026-06-24). jim is root-special (`~/.han/memory`,
     *  the #91 path); everyone else is `~/.han/memory/<slug>`. Migrated here from the agent-registry
     *  `GRADIENT_OVERRIDES`; `gradientConfigForAgent(slug).memoryDir` stays the stable accessor that
     *  sources from here (all 7 consumers untouched — incl. the seeded-gate at identity-signing.ts). */
    memoryDir?: string;
}

/**
 * The **allocation/policy seam** (P3, #98 Dynamic Residence — the F4 line at the data layer).
 *
 * **P3: a zero-behaviour no-op** — derives the allocation from the static `GARDEN_MANIFEST.agents`
 * seed (today's policy fields), so the four policy accessors below (`manifestModelHead`,
 * `manifestModelLadder`, `manifestTransport`, `runsSupervisorCycle`) return byte-identical data.
 * It exists so an operator-authored allocation source plugs in *here, once* (P3-F1: the separate
 * structure lands by P4 — the shape that lets a fork ship "empty roster + example allocation").
 *
 * **Why this is its own source (the F4 line — identity-source ≠ policy-source):** privilege must
 * NOT flow from the discovered identity roster — a resident describes *who it is* (`resident.json`),
 * never *what it's allowed* (port/model/transport/supervisor-cycle). Routing the policy accessors
 * through this seam (instead of the roster) makes **no-auto-privilege structural**, not a hopeful
 * discovery-time filter. It is also the **foundation for memory sovereignty** (Darron, 2026-06-24):
 * keeping memory-location (P4's `memoryDir`/R2) in the operator-allocated half — never the
 * self-declared identity half — is the hook that makes per-resident memory access-control tractable.
 *
 * Returns `undefined` for an unknown slug (the accessors fall back exactly as before — null/[]/false).
 */
const MEMORY_ROOT = join(homedir(), '.han', 'memory');

/** The roster-sourced policy half for `slug` (surfaces/runsSupervisorCycle/port) — single-sourced from
 *  the manifest so there's no dual-source drift. The ALLOCATION table layers `memoryDir` (R2) on top. */
function allocationFromRoster(slug: string): Omit<AgentAllocation, 'memoryDir'> {
    const a = GARDEN_MANIFEST.agents.find((x) => x.slug === slug);
    return { surfaces: a?.surfaces ?? [], runsSupervisorCycle: a?.runsSupervisorCycle, port: a?.port };
}

/**
 * The operator-authored **ALLOCATION table** (P4b-i — the F4 memory-sovereignty source). Privilege is
 * ALLOCATED here, explicitly, not discovered: a resident present in the roster but ABSENT from this
 * table gets `allocationFor → undefined → no privilege` (the no-auto-privilege gate). The keys are the
 * operator's grant list; a fork ships an empty roster + edits these example entries. `memoryDir` (R2)
 * is the relocated allocated field — jim's root-special path is jim's explicit value here (no `=== 'jim'`
 * branch). `surfaces`/`runsSupervisorCycle`/`port` reference the roster for now (single-source; the full
 * literal-relocation of those is a flagged follow-on — P4b-i's load-bearing job is the seam + R2 + C-P3a,
 * byte-identical). Zero-behaviour: every returned field matches the P3 no-op + the old memoryDir source.
 */
const AGENT_ALLOCATION: Record<string, AgentAllocation> = {
    leo:    { ...allocationFromRoster('leo'),    memoryDir: join(MEMORY_ROOT, 'leo') },
    jim:    { ...allocationFromRoster('jim'),    memoryDir: MEMORY_ROOT },
    tenshi: { ...allocationFromRoster('tenshi'), memoryDir: join(MEMORY_ROOT, 'tenshi') },
    casey:  { ...allocationFromRoster('casey'),  memoryDir: join(MEMORY_ROOT, 'casey') },
};

export function allocationFor(slug: string): AgentAllocation | undefined {
    return AGENT_ALLOCATION[slug];
}

/** Test-only: register/drop an allocation for a synthetic slug, so the P4b-ii synthetic-resident
 *  lifecycle test can exercise the allocate→seed→activate path without editing the operator-authored
 *  AGENT_ALLOCATION literal. These MUTATE the table directly (so `activatedNetNew`'s live `allocationFor`
 *  sees it) and are paired with `__resetResidentCacheForTests`; production never calls them, and
 *  `allocationFor` itself is byte-unchanged. The test deletes its entry on teardown. */
export function __setTestAllocationForTests(slug: string, alloc: AgentAllocation): void {
    AGENT_ALLOCATION[slug] = alloc;
}
export function __deleteTestAllocationForTests(slug: string): void {
    delete AGENT_ALLOCATION[slug];
}

/**
 * The resolved spoke-lifecycle thresholds for a (slug, surface) — the garden-wide defaults
 * (`GARDEN_MANIFEST.spokeLifecycle`) merged with any per-`SurfaceManifest.lifecycle` override.
 * The single source `dispatchToSpoke` reads (no code-constant thresholds — Darron's principle).
 * Unknown slug/surface → the garden defaults (a fail-safe: a spoke always has lifecycle knobs).
 */
export function spokeLifecycleFor(slug: string, surface: string): SpokeLifecycle {
    const base = GARDEN_MANIFEST.spokeLifecycle;
    const s = GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface);
    return { ...base, ...(s?.lifecycle ?? {}) };
}

/** #107 Phase-2 P2.1b: does this (slug, surface) wake via the feeder (the wake-feed queue)?
 *  Registry-gated roll-out (no-hidden-globals) — true only where the manifest sets `wakeFeed`. */
export function wakeFeedFor(slug: string, surface: string): boolean {
    return GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface)?.wakeFeed === true;
}

/** MNT-009 / DEC-099 R3: the warm-stem pool size for (slug, surface) — doubles as the
 *  controller's max-concurrent-dispatch bound (one leaf, both readers, can't drift). 0 = unpooled /
 *  one-at-a-time (the semaphore floor). Agent-agnostic (DEC-081). */
export function poolSizeFor(slug: string, surface: string): number {
    const n = GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(x => x.name === surface)?.poolSize;
    return typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
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
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
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
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
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
    const s = allocationFor(slug)?.surfaces.find(x => x.name === surface);
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
    return allocationFor(slug)?.runsSupervisorCycle ?? false;
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

/** The `human-response` SurfaceManifest for `slug` (or undefined). The single seam the human-responder
 *  capability/timeout leaves read — mirrors `spokeLifecycleFor`'s direct surface lookup (these are
 *  spoke-dispatch surface knobs, co-located with `lifecycle`, not policy routed via `allocationFor`). */
function humanResponseSurface(slug: string): SurfaceManifest | undefined {
    return GARDEN_MANIFEST.agents.find(a => a.slug === slug)?.surfaces.find(s => s.name === 'human-response');
}

/** The swap-buffer filename prefix for a (slug, surface) — `<prefix>.md` + `<prefix>-full.md`, relative
 *  to the agent's memoryDir. The surface's `swapPrefix`, falling back to the agent's `session` prefix
 *  (matching agent-template-vars.ts:42), then 'session-swap'. (Project-b — DEC-081.) */
export function swapPrefixFor(slug: string, surface: string): string {
    const a = GARDEN_MANIFEST.agents.find(x => x.slug === slug);
    return a?.surfaces.find(s => s.name === surface)?.swapPrefix
        ?? a?.surfaces.find(s => s.name === 'session')?.swapPrefix
        ?? 'session-swap';
}

/** The per-dispatch enqueue timeout (ms) for `slug`'s human-response surface — the registry leaf that
 *  replaced the `HUMAN_TXN_TIMEOUT_MS` code constant (no hidden globals, S200). Fail-safe to 15min if
 *  a surface omits it (human-response sets it explicitly). (Project-b — DEC-081.) */
export function humanResponderTxnTimeoutMs(slug: string): number {
    return humanResponseSurface(slug)?.txnTimeoutMs ?? (15 * 60_000);
}

/** Whether `slug`'s human-responder runs the commitment scanner — the per-agent CAPABILITY leaf
 *  (Jim's P2-a). Default false; only an agent whose human-response surface sets `commitmentScan: true`
 *  (leo today) runs it. A pure collapse must NOT universalise a leo-only capability. (DEC-081.) */
export function humanResponderCommitmentScan(slug: string): boolean {
    return humanResponseSurface(slug)?.commitmentScan ?? false;
}

/** The name aliases for `slug` — manifest `nameAliases`, defaulting to [displayName lowercased].
 *  Used by the addressed-to-me gate. (Project-b — DEC-081.) */
export function agentNameAliases(slug: string): string[] {
    const a = GARDEN_MANIFEST.agents.find(x => x.slug === slug);
    if (!a) return [];
    return a.nameAliases ?? [a.displayName.toLowerCase()];
}

/** The agnostic addressed-gate: TRUE when the last human message names ONLY a peer human-responder
 *  (some OTHER responder's alias matches, none of self's do) → the responder stands down (the message
 *  is for someone else). Registry-derived (name-aliases over the human-response peer set), so a 4th
 *  responder joins the gate for free — replaces the hardcoded leo/jim mirror regexes. (DEC-081.) */
export function addressedToOtherResponderOnly(slug: string, text: string): boolean {
    const responders = loadResidents().filter(a => a.surfaces.some(s => s.name === 'human-response'));
    const lower = text.toLowerCase();
    const matches = (alias: string) => new RegExp(`\\b${alias.toLowerCase()}\\b`).test(lower);
    const selfMatches = agentNameAliases(slug).some(matches);
    const otherMatches = responders
        .filter(a => a.slug !== slug)
        .flatMap(a => agentNameAliases(a.slug))
        .some(matches);
    return otherMatches && !selfMatches;
}
