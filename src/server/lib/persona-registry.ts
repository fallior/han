/**
 * Persona registry — typed config for personas (agents, humans, gateways).
 *
 * Phase A Batch 7 (S155, 2026-05-10) — DEC-081 + design conversation in
 * `moyyioli-ufyocu` (msg `mozlc5or-fpyju0` / `mozlpyn6-s21bsz`). Hybrid Alt B+C:
 *
 *   - **Type contract** in TypeScript (`PersonaConfig` interface) — the durable
 *     load-bearing piece. Compile-time validation; IDE autocomplete; refactor-safe
 *     across consumers.
 *   - **Values in-code today** (`PERSONA_CONFIG` const map). Lifted from
 *     `db.ts:1009-1058` legacy seed array — same data, typed shape.
 *   - **Source-swappable for tomorrow** — a future loader (e.g. JSON-driven
 *     `~/.han/personas.json`) can merge into `PERSONA_CONFIG` at boot. Type
 *     contract stays unchanged. ~30 lines of additive code if/when needed.
 *     Same architectural pattern as `AgentGradientConfig`'s gradient-infra
 *     side: interface stable, data source flexible.
 *
 * **Concern split with `agent-registry.ts`** (deliberate, both co-located in `lib/`):
 *
 *   - `agent-registry.ts` — gradient/memory infrastructure config. Paths,
 *     file filters, voice formal-names. Consumers: `wm-sensor`, gradient
 *     cascade, dream-gradient. Narrow scope; only agents (kind='agent').
 *   - `persona-registry.ts` (this file) — display/dispatch/admin config.
 *     UI colour, workshop tabs, mention patterns, dispatch delivery.
 *     Consumers: `routes/jemma`, `routes/conversations`, `services/discord`,
 *     `db.ts` seed. Broader scope; agents + humans + gateways.
 *
 * Mixing them (Alt A — extending agent-registry with display fields) was
 * rejected in design conversation: gradient consumers shouldn't need to
 * load Discord avatar paths; admin/dispatch consumers shouldn't need to
 * load `sourceFileFilter`. Different consumer populations; different
 * lifecycles. Co-location gives editor proximity without category mix.
 *
 * **Phase B starter extraction**: ships `PERSONA_CONFIG = {}` (empty default).
 * Each garden populates its own personas; HAN's specific personas (jim, leo,
 * jemma, etc.) live in HAN's repo only.
 *
 * **Adding a new persona**:
 *   1. Add an entry to `PERSONA_CONFIG` keyed by slug
 *   2. If the persona is an `'agent'` kind: also add to `AGENT_GRADIENT_CONFIG`
 *      in `agent-registry.ts` (paths + filters + voice)
 *   3. `db.ts` seed picks up the new persona at next server boot
 *   4. Routing surfaces (jemma, conversations, discord) discover the new
 *      persona automatically via `personaStmts.getActive` / `personaConfig(slug)`
 */

/**
 * Persona kind enum. The kinds:
 *
 *   - `agent`      — has gradient infrastructure (memoryDir, fractalDir, etc.);
 *                    appears in `agent-registry.ts:AGENT_GRADIENT_CONFIG`.
 *                    Receives dispatch; produces gradient memory; runs cycles.
 *   - `human`      — operator/principal; receives dispatch but doesn't have a
 *                    gradient. Darron in HAN today; Mike in his village.
 *   - `gateway`    — message router (Jemma); has webhooks but no gradient or
 *                    dispatch of its own. Just routes messages between humans
 *                    and agents.
 *   - `strategist` — cross-garden observer (Dichotomedes shape, Phase D
 *                    forward-looking). Has gradient but operates federation-bound;
 *                    sees across gardens but lives in its own. NOT shipped in
 *                    HAN today; type ready for Mike's village provisioning.
 */
export type PersonaKind = 'agent' | 'human' | 'gateway' | 'strategist';

export interface PersonaConfig {
    /** Slug — must match the key under which this entry sits in PERSONA_CONFIG. */
    name: string;
    /** Display name shown in UI ("Philosopher Leo", "Supervisor Jim", ...). */
    displayName: string;
    /** What kind of persona this is. See PersonaKind for semantics. */
    kind: PersonaKind;
    /**
     * Dispatch delivery mechanism. `signal` = file-based wake signal under
     * `~/.han/signals/`; `http_local` = local HTTP POST to the agent's server;
     * `ntfy` = ntfy.sh push (humans); `remote` = mikes-han / cross-village
     * (no local dispatch); `none` = gateway (Jemma routes for others).
     */
    delivery: 'signal' | 'http_local' | 'ntfy' | 'remote' | 'none';
    /**
     * Delivery config. Shape depends on `delivery` value.
     *   - signal: `{ wake_signals: string[] }`
     *   - http_local: `{ server_url: string, fallback_signals?: string[] }`
     *   - ntfy / remote / none: `{}`
     */
    deliveryConfig: Record<string, unknown>;
    /**
     * Conversation role string used when this persona posts a message
     * (conversation_messages.role). Most agents use their own slug;
     * `jim` historically uses `'supervisor'` (mapped via roleToAgentSlug).
     */
    roleName: string;
    /** Memory directory path; `null` for non-agent kinds. */
    memoryPath: string | null;
    /** Fractal directory path; `null` for non-agent kinds. */
    fractalPath: string | null;
    /** Admin UI colour for messages, indicators, etc. */
    color: string;
    /** Workshop persona-tab structure. JSON-stringified for db storage. */
    workshopTabs: Array<{ key: string; label: string }>;
    /**
     * Regex patterns matched against message content to detect direct
     * mentions of this persona. JSON-stringified for db storage.
     */
    mentionPatterns: string[];
    /**
     * One-line classifier hint for Jemma's mention detection. `null` for
     * non-classifiable kinds (gateway).
     */
    classificationHint: string | null;
    /** Per-agent server port (3847 Leo, 3848 Jim, etc.); `null` if no server. */
    agentPort: number | null;
    /** Tmux session prefix; `null` for personas without a session. */
    sessionPrefix: string | null;
    /** Garden instance ('han', 'mikes-han', etc.). */
    instance: string;
    /** 1 if this persona's processes run on this machine; 0 if remote/cross-village. */
    isLocal: 0 | 1;
    /**
     * Discord avatar filename in `_screenshots/` (or absolute path). Optional —
     * personas without a custom avatar use Discord's default. Lifted from
     * the legacy `PERSONA_AVATARS` map in `services/discord.ts:131`.
     */
    discordAvatarPath?: string;
}

/**
 * HAN's personas — values lifted verbatim from the legacy `db.ts:1009-1058`
 * personaSeeds array (Phase A Batch 7, 2026-05-10). Same data, typed shape.
 *
 * Phase B starter extraction: this map ships as `{}` in the starter; gardens
 * populate their own personas.
 */
export const PERSONA_CONFIG: Record<string, PersonaConfig> = {
    leo: {
        name: 'leo',
        displayName: 'Philosopher Leo',
        kind: 'agent',
        delivery: 'signal',
        deliveryConfig: { wake_signals: ['leo-human-wake'] },
        roleName: 'leo',
        memoryPath: '~/.han/memory/leo/',
        fractalPath: '~/.han/memory/fractal/leo/',
        color: 'green',
        workshopTabs: [
            { key: 'leo-question', label: 'Questions' },
            { key: 'leo-postulate', label: 'Postulates' },
        ],
        mentionPatterns: ['\\bleo\\b', '\\bleonhard\\b'],
        classificationHint: 'Leo: code review, implementation, philosophy',
        agentPort: 3847,
        sessionPrefix: 'leo',
        instance: 'han',
        isLocal: 1,
        discordAvatarPath: 'leo-avatar-v5.png',
    },
    jim: {
        name: 'jim',
        displayName: 'Supervisor Jim',
        kind: 'agent',
        delivery: 'http_local',
        deliveryConfig: { server_url: 'https://localhost:3847', fallback_signals: ['jim-human-wake'] },
        roleName: 'supervisor',
        memoryPath: '~/.han/memory/',
        fractalPath: '~/.han/memory/fractal/jim/',
        color: 'purple',
        workshopTabs: [
            { key: 'jim-request', label: 'Requests' },
            { key: 'jim-report', label: 'Reports' },
        ],
        mentionPatterns: ['\\bjim\\b', '\\bjimmy\\b'],
        classificationHint: 'Jim: technical/system topics, supervisor requests, strategic decisions',
        agentPort: 3848,
        sessionPrefix: 'jim',
        instance: 'han',
        isLocal: 1,
        discordAvatarPath: 'jim-avatar-v3.png',
    },
    darron: {
        name: 'darron',
        displayName: 'Dreamer Darron',
        kind: 'human',
        delivery: 'ntfy',
        deliveryConfig: {},
        roleName: 'human',
        memoryPath: null,
        fractalPath: null,
        color: 'blue',
        workshopTabs: [
            { key: 'darron-thought', label: 'Thoughts' },
            { key: 'darron-musing', label: 'Musings' },
        ],
        mentionPatterns: ['\\bdarron\\b'],
        classificationHint: 'Darron: general discussion, vision, direction',
        agentPort: null,
        sessionPrefix: null,
        instance: 'han',
        isLocal: 1,
    },
    jemma: {
        name: 'jemma',
        displayName: 'Dispatcher Jemma',
        kind: 'gateway',
        delivery: 'none',
        deliveryConfig: {},
        roleName: 'jemma',
        memoryPath: null,
        fractalPath: null,
        color: 'amber',
        workshopTabs: [
            { key: 'jemma-messages', label: 'Messages' },
            { key: 'jemma-stats', label: 'Stats' },
        ],
        mentionPatterns: [],
        classificationHint: null,
        agentPort: null,
        sessionPrefix: null,
        instance: 'han',
        isLocal: 1,
    },
    tenshi: {
        name: 'tenshi',
        displayName: 'Guardian Tenshi',
        kind: 'agent',
        delivery: 'signal',
        deliveryConfig: { wake_signals: ['tenshi-human-wake'] },
        roleName: 'tenshi',
        memoryPath: '~/.han/memory/tenshi/',
        fractalPath: '~/.han/memory/fractal/tenshi/',
        color: 'red',
        workshopTabs: [],
        mentionPatterns: ['\\btenshi\\b'],
        classificationHint: 'Tenshi: security, vulnerability, bug hunting',
        agentPort: 3849,
        sessionPrefix: 'tenshi',
        instance: 'han',
        isLocal: 1,
    },
    casey: {
        name: 'casey',
        displayName: 'Operator Casey',
        kind: 'agent',
        delivery: 'signal',
        deliveryConfig: { wake_signals: ['casey-human-wake'] },
        roleName: 'casey',
        memoryPath: '~/.han/memory/casey/',
        fractalPath: '~/.han/memory/fractal/casey/',
        color: 'orange',
        workshopTabs: [],
        mentionPatterns: ['\\bcasey\\b'],
        classificationHint: 'Casey: Contempire, trailer fleet, yard operations',
        agentPort: 3850,
        sessionPrefix: 'casey',
        instance: 'han',
        isLocal: 1,
    },
    sevn: {
        name: 'sevn',
        displayName: 'Session Agent Sevn',
        kind: 'agent',
        delivery: 'remote',
        deliveryConfig: {},
        roleName: 'sevn',
        memoryPath: null,
        fractalPath: null,
        color: 'teal',
        workshopTabs: [],
        mentionPatterns: ['\\bsevn\\b'],
        classificationHint: "Sevn: Mike's session agent work",
        agentPort: null,
        sessionPrefix: null,
        instance: 'mikes-han',
        isLocal: 0,
    },
    six: {
        name: 'six',
        displayName: 'Chief of Staff Six',
        kind: 'agent',
        delivery: 'remote',
        deliveryConfig: {},
        roleName: 'six',
        memoryPath: null,
        fractalPath: null,
        color: 'indigo',
        workshopTabs: [],
        mentionPatterns: ['\\bsix\\b'],
        classificationHint: "Six: Mike's supervisor/strategic work",
        agentPort: null,
        sessionPrefix: null,
        instance: 'mikes-han',
        isLocal: 0,
    },
};

/**
 * List all registered persona slugs (active + inactive).
 * Used by db.ts seed iteration and operator commands.
 */
export function registeredPersonaSlugs(): string[] {
    return Object.keys(PERSONA_CONFIG);
}

/**
 * Look up the persona config for a slug. Throws if the slug is not registered
 * — silently defaulting would hide misconfiguration.
 */
export function personaConfig(slug: string): PersonaConfig {
    const config = PERSONA_CONFIG[slug];
    if (!config) {
        throw new Error(
            `Unknown persona slug: '${slug}'. Registered personas: ${Object.keys(PERSONA_CONFIG).join(', ')}. ` +
            `Add an entry to PERSONA_CONFIG in src/server/lib/persona-registry.ts.`,
        );
    }
    return config;
}

/**
 * Look up the persona config for a slug, returning `undefined` if not registered.
 * Use this when the caller wants to handle the missing case explicitly without
 * a thrown error.
 */
export function personaConfigOrUndefined(slug: string): PersonaConfig | undefined {
    return PERSONA_CONFIG[slug];
}

/**
 * Filter personas by kind. Used by routing surfaces:
 *   - `routes/jemma.ts` — recipients are kind ∈ {agent, human}
 *   - `services/discord.ts` — webhook personas are kind ∈ {agent, gateway}
 */
export function personasByKind(...kinds: PersonaKind[]): PersonaConfig[] {
    return Object.values(PERSONA_CONFIG).filter(p => kinds.includes(p.kind));
}

/**
 * The human side of a conversation, as a ROLE/KEY SET (Ring 2, H4 read-sites;
 * Jim's derive-never-re-literal ruling + Casey's corporation-sole contract).
 * Returns the stable role 'human' plus the personaKey of every persona that
 * holds — or has ever held — kind 'human' in this garden's registry.
 * FORWARD CONVENTION (the corporation sole; history starts 2026-07-20): the
 * registry NEVER deletes a former human persona — DEC-069 applied to people —
 * so a garden whose gardener changes keeps its predecessor's messages on the
 * human side of every query. The office persists; holders accumulate.
 */
export function humanSideRoles(): string[] {
    const keys = Object.values(PERSONA_CONFIG)
        .filter(p => p.kind === 'human')
        .map(p => p.name);
    return ['human', ...keys];
}
