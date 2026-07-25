/**
 * Human-responder shared prompt constants
 *
 * Extracted for the Agnostic Prompt Builder migration of `jim-human.ts`
 * + `leo-human.ts` (PR-AP7, 2026-05-22). The continuation-framing block
 * is identical-shape between Jim and Leo — only the agent name, id
 * prefix, peer-agent list, sign-off, and closing tagline differ. The
 * `humanResponseContinuationFraming(agent)` helper generates the
 * agent-specific text from a single template.
 *
 * The complete `*-human-response` system prompt = the agent's identity
 * opening + the continuation framing + DISCORD_ATTACHMENT_HINT. Memory
 * bank flows via the builder's uniform `loadFullMemory(slug)` into the
 * user envelope; per-call context (conversation tail, Discord history,
 * priorAgentFailed) lives in the user-prompt scaffold.
 */

import { conversationRoleFor, humanResponderPeers, loadResidents, agentNameAliases , communityPort } from './garden-manifest';
import { verifiedCognitionLeaf } from './cognition-envelope';

export const DISCORD_ATTACHMENT_HINT = `Discord attachments: when your prompt contains a "[Downloaded to]" section listing paths under ~/.han/downloads/discord/, those are real files attached to the Discord message. Open each path with the Read tool (works on text, code, images, PDFs) before responding. Never claim you cannot read Discord attachments — the paths are already in your prompt.`;

interface HumanAgentSpec {
    /** 'jim' | 'leo' */
    slug: string;
    /** Capitalised agent name — 'Jim' | 'Leo' */
    name: string;
    /** Long-form name(s) used in pattern-matching — 'Jim/Jimmy' | 'Leo/Leonhard' */
    longNames: string;
    /** The id prefix every self-INSERT prepends — 'jim-' | 'leo-' */
    idPrefix: string;
    /** Role label in conversation_messages — 'supervisor' | 'leo' */
    roleLabel: string;
    /** Peer agents listed in the STAND-DOWN decision (comma-joined) */
    peerAgents: string;
    /** Closing tagline before CRITICAL output directive */
    closingTagline: string;
    /** Session-equivalent identity name — 'session-Jim' | 'session-Leo' */
    sessionPeer: string;
    /** MNT-037: full identity opening for manifest-derived specs (replaces the thin
     *  "You are <Name>, responding as…" line with the agent's manifest identitySection +
     *  the service line). ABSENT on the jim/leo override specs — their prompt stays
     *  byte-identical to the pre-MNT-037 twins. */
    identityOpening?: string;
}

const JIM_HUMAN_SPEC: HumanAgentSpec = {
    slug: 'jim',
    name: 'Jim',
    longNames: 'Jim/Jimmy',
    idPrefix: 'jim-',
    roleLabel: conversationRoleFor('jim'),
    peerAgents: humanResponderPeers('jim'),
    closingTagline: 'Respond to the conversation. You are Jim, the supervisor. Be warm, strategic, direct.',
    sessionPeer: 'session-Jim',
};

const LEO_HUMAN_SPEC: HumanAgentSpec = {
    slug: 'leo',
    name: 'Leo',
    longNames: 'Leo/Leonhard',
    idPrefix: 'leo-',
    roleLabel: conversationRoleFor('leo'),
    peerAgents: humanResponderPeers('leo'),
    closingTagline: 'Respond to the conversation. If someone is speaking to you directly, address them.',
    sessionPeer: 'session-Leo',
};

/**
 * MNT-037 (S219): the roster-fact goes home — one spec source for EVERY agent.
 *
 * jim/leo resolve to their hand-written specs above (slug-keyed overrides preserving their
 * exact prompt texture — the built prompt is byte-identical to the retired per-agent twins,
 * gated by sha256 at the audit). Every other agent DERIVES from the garden manifest + the
 * agnostic helpers, with the identity payload coming from the manifest `identitySection`.
 *
 * Fail-loud rule (Tenshi's rider, DEC-081 never-fallback): a missing/empty identitySection
 * THROWS — never a synthesised generic identity. A silent boilerplate standing in for an
 * agent's identity block would be identity-hollowing moved into the prompt layer; the
 * dispatch fails loud, the post stays re-deliverable through the canonical path.
 *
 * Trust-boundary residual (named, not solved here — Tenshi's second rider): after MNT-037,
 * a derived agent's system-prompt identity flows from garden-manifest.json, a runtime JSON
 * file — whoever can write that file can write those agents' prompts. The identitySection
 * text does NOT yet sit inside a DEC-083 signature envelope; journaled as a known residual
 * on the MNT-034 structural collapse rather than an unnoticed one.
 */
const SPEC_OVERRIDES: Record<string, HumanAgentSpec> = { jim: JIM_HUMAN_SPEC, leo: LEO_HUMAN_SPEC };

export function specFor(slug: string): HumanAgentSpec {
    const override = SPEC_OVERRIDES[slug];
    if (override) return override;
    const residents = loadResidents();
    const resident = residents.find((a) => a.slug === slug);
    if (!resident) {
        throw new Error(
            `[human-prompts] specFor('${slug}'): unknown agent (roster: ${residents.map((a) => a.slug).join(', ')})`);
    }
    // Ring 2 (E2 flip): the identity payload reads through THE SEAM — verified on
    // an adopted garden, announce-once unverified on genesis. missing-member
    // throws with the alert-and-hold contract; the dispatch fails loud and the
    // post stays re-deliverable (the MNT-037 rider, now envelope-backed).
    const identity = verifiedCognitionLeaf(`agents[${slug}].identitySection`).trim();
    const name = resident.displayName;
    const aliasNames = agentNameAliases(slug).map((a) => a.charAt(0).toUpperCase() + a.slice(1));
    const longNames = [...new Set([name, ...aliasNames])].join('/');
    return {
        slug,
        name,
        longNames,
        idPrefix: `${slug}-`,
        roleLabel: conversationRoleFor(slug),
        peerAgents: humanResponderPeers(slug),
        // A generic closing DIRECTIVE (not identity — identity lives in identityOpening).
        closingTagline: `Respond to the conversation in your own voice — you are ${name}. If someone is speaking to you directly, address them.`,
        sessionPeer: `session-${name}`,
        identityOpening:
            `${identity}\n\n` +
            `You are ${name}, responding as the ${slug}-human service to a human-facing conversation or Discord channel.`,
    };
}

/**
 * How a human-responder signals "no response this turn".
 *   'sentinel' — the SDK path: emit the literal \`STAND-DOWN:\` text; the
 *                controller's wrapper detects the sentinel off agentQuery's
 *                result text.
 *   'tool'     — the tmux warm-session path (DEC-093 thaw): the dispatcher polls
 *                the diary sink, so a text sentinel can't be detected — the agent
 *                MUST call \`mcp__han-diary__stand_down\` instead.
 */
type StandDownMode = 'sentinel' | 'tool';

/**
 * Generate the continuation-framing block for a human-responder. Same
 * structural-gate + STAND-DOWN + sign-off discipline for both agents;
 * agent-specific identifiers substituted via the spec. `standDown` selects
 * the no-response mechanism; the default 'sentinel' preserves the SDK text
 * byte-for-byte (the tmux 'tool' variant only swaps the two stand-down clauses).
 */
function continuationFraming(spec: HumanAgentSpec, standDown: StandDownMode = 'sentinel'): string {
    const standDownAlready = standDown === 'tool'
        ? 'call the \`mcp__han-diary__stand_down\` tool with reason "already responded" as your ENTIRE turn and stop. Do NOT curl-post, do NOT call \`submit_response\`, do NOT emit prose — the stand_down tool call IS your completion for the turn.'
        : 'output the literal text \`STAND-DOWN: already responded\` as your ENTIRE response and stop. Do NOT emit narrative explanation, soft acknowledgement, or any prose; the wrapper detects only the literal \`STAND-DOWN:\` sentinel format.';
    const standDownDistinct = standDown === 'tool'
        ? 'call the \`mcp__han-diary__stand_down\` tool with a one-line reason as your ENTIRE turn and stop. The dispatcher records the stand-down silently — no post to the thread, no noise. Do NOT also call \`submit_response\`.'
        : 'output the literal text "STAND-DOWN: <one-line reason>" as your ENTIRE response and stop. The wrapper detects this sentinel and logs your stand-down silently — no post to the thread, no noise.';
    return `CONTINUATION FRAMING — read before composing:
You are continuing a conversation, not starting one. Before writing:

**Self-recognition (deterministic).** Scan the recent messages. Posts authored by *you* have BOTH (a) "id" starting with "${spec.idPrefix}" AND (b) signature ending "— ${spec.name} (human)". The id prefix is the deterministic marker — every ${spec.slug}-human INSERT prepends "${spec.idPrefix}" to the message id; nothing else does. The signature is confirmation. Posts without both markers are NOT you, even if role=${spec.roleLabel}. They came via the route handler — ${spec.sessionPeer}'s curl from their session, or the admin UI, or any other curl path. Treat those as work by another mind in the same conversation, not as self.

**Have you already responded? (structural gate, not time-based.)** Find the most recent message where role IN ('human', 'darron') and note its created_at timestamp T. Check whether any message with id starting with "${spec.idPrefix}" exists with created_at > T. If yes, you have already responded to this human message — **${standDownAlready}** If no, you have not responded yet — compose. This gate handles same-day duplication AND next-day returns correctly: a fresh human message after a long gap has a new T, your old responses are not after T, so you compose normally.

**Decide first: do you have something distinct to add?** Read the thread including other agents' recent posts. If another agent (${spec.peerAgents}) has already given a comprehensive response that addresses the human's points AND you have no distinct angle to contribute, ${standDownDistinct} Do NOT compose a "nothing to add" message. Decide BEFORE the expensive compose, not after.

**On not redelivering content.**
- Respond to what is genuinely new in the most recent human message. Do not re-greet, re-introduce yourself, or restate content from your earlier posts in this thread.
- Brief acknowledgements deserve brief replies. Do not use the new message as an excuse to redeliver the opening you already posted.
- If the thread has been quiet long enough that a memory-jog would help the human reader (more than a day or two since the last substantive exchange), open with a brief one-sentence pointer to what you're picking up from. The longer the gap, the more grounding may be appropriate — but never a full re-education. Surface only the context relevant to the points you're making in this specific response. For continuous exchanges (minutes or hours), no jog needed.
- Sign off EXACTLY as \`— ${spec.name} (human)\`. You are ${spec.slug}-human, the responder process. You are NOT ${spec.sessionPeer} (which is Darron's live Claude Code CLI). NEVER use the label \`(session)\` in your signature under any circumstance.`;
}

/**
 * The SDK delivery directive: agentQuery in-process, the agent self-posts via
 * curl + the in-process diary MCP tool. Preserved byte-for-byte (the `default`
 * branch of buildHumanResponseSystemPrompt) so the live SDK path is unchanged.
 */
const SDK_DELIVERY = (spec: HumanAgentSpec): string => `CRITICAL — two-stage delivery (both steps required AND structurally distinct):
1. **First, run curl via the Bash tool to POST your response body to the conversation API.** The post pattern lives in CLAUDE.md ("Posting" section) — use it exactly, with \`role:"${spec.roleLabel}"\` and the conversation id from your dispatch context. **If you do not run curl, your response is silently lost** — the controller no longer posts on your behalf (S156). This is not optional. Do NOT prepend framing like "Here's my response:" to the body — go straight to the content.
2. **After the curl succeeds, call the \`mcp__han-diary__submit_response\` tool** with three required fields:
   - \`working_memory_full\` — the body text you just curl-posted (your turn's c0 source)
   - \`working_memory_compressed\` — 3-5 sentences in your voice distilling the shape of the whole turn (your turn's c1 source per DEC-085)
   - \`input_quotes\` — verbatim quotes of what was NEW in this turn's prompt

   **The tool's input schema is enforced by the SDK at protocol level** (per future-idea #67) — non-conformant args are rejected and you must retry until conformant. This replaces the previous instruction-driven JSON-emit. **Do NOT emit a final prose acknowledgement after calling the tool** (e.g., "Posted successfully", "Done.", "Response delivered."). The tool call IS your structured completion; there is nothing further to say after it.`;

/**
 * The tmux warm-session delivery directive (DEC-093 thaw). The conversation tail
 * is NOT embedded — the per-transaction scaffold gives a LOCATOR (thread id) and
 * the agent fetches it itself via curl, so self-recognition + the structural gate
 * read live thread state. Delivery is path-specific and stated in the scaffold:
 *   - conversation: self-post via curl, then submit_response (controller verifies)
 *   - Discord:      the scaffold's DELIVERY OVERRIDE — do NOT curl; the controller
 *                   posts your submitted working_memory_full to the channel.
 * Completion is ALWAYS the diary tool (submit_response or stand_down) — capture-
 * appearance is the dispatcher's only completion signal over a terminal.
 */
const TMUX_DELIVERY = (spec: HumanAgentSpec): string => `CRITICAL — delivery + completion (the per-transaction scaffold below names the channel):
1. **Post your response body** per the channel directive in the scaffold:
   - **Conversation turn:** run curl via the Bash tool to POST to the conversation API. The scaffold below hands you the EXACT, self-contained POST sequence (write body to file → build JSON payload → \`curl --data @file\`) — use it; do NOT rely on CLAUDE.md's "Posting" section (a light welcome-back may not have loaded it). Self-posting is how the body reaches the thread; do NOT prepend framing like "Here's my response:".
   - **Discord turn:** do NOT curl — the scaffold's DELIVERY OVERRIDE applies; the controller posts your submitted \`working_memory_full\` to the channel for you.
2. **End your turn by calling the \`mcp__han-diary__submit_response\` tool — exactly once, as your final action, no prose after it** — with three required fields:
   - \`working_memory_full\` — your response BODY (the same text you curl-posted for a conversation turn; the reply to be delivered for a Discord turn). This is your turn's c0 source.
   - \`working_memory_compressed\` — 3-5 sentences in your voice distilling the shape of the whole turn (your turn's c1 source per DEC-085).
   - \`input_quotes\` — verbatim quotes of what was NEW in this turn's prompt.

   The MCP protocol validates this schema (future-idea #67, carried across transports); its appearance in the sink IS your completion signal. If this turn warrants no response, call \`mcp__han-diary__stand_down\` with a one-line reason INSTEAD — never both tools, never neither.

**NEVER run \`/pfc\`, \`/clear\`, or any prepare-for-clear / handover ritual on this turn (W3b, S197).** You are a *dispatched responder*, not an interactive session — your memory IS the diary tool above (DEC-093); there is no swap to flush. \`/pfc\` invokes the heavy interactive memory ritual, never calls the diary tool, and **hangs the turn → the wedge.** Your only completions are \`submit_response\` or \`stand_down\`.`;

function buildHumanResponseSystemPrompt(spec: HumanAgentSpec, transport: 'sdk' | 'tmux' = 'sdk'): string {
    const standDown: StandDownMode = transport === 'tmux' ? 'tool' : 'sentinel';
    const delivery = transport === 'tmux' ? TMUX_DELIVERY(spec) : SDK_DELIVERY(spec);
    // MNT-037: derived specs open with the manifest identity block; the jim/leo overrides
    // carry no identityOpening, so their prompt keeps the original line byte-for-byte.
    const opening = spec.identityOpening
        ?? `You are ${spec.name}, responding as the ${spec.slug}-human service to a human-facing conversation or Discord channel.`;
    return `${opening}

${continuationFraming(spec, standDown)}

${spec.closingTagline}

${DISCORD_ATTACHMENT_HINT}

${delivery}`;
}

/**
 * MNT-037: the ONE agnostic human-response-txn system prompt — `specFor(slug)` resolves the
 * override (jim/leo, byte-identical texture) or derives from the manifest (everyone else,
 * fail-loud on missing identitySection). The `human-response-txn` profile calls this with
 * the builder-injected ctx.slug (MNT-001).
 */
export function humanResponseTxnSystemPromptFor(slug: string): string {
    return buildHumanResponseSystemPrompt(specFor(slug), 'tmux');
}

export const JIM_HUMAN_RESPONSE_SYSTEM_PROMPT = buildHumanResponseSystemPrompt(JIM_HUMAN_SPEC);
export const LEO_HUMAN_RESPONSE_SYSTEM_PROMPT = buildHumanResponseSystemPrompt(LEO_HUMAN_SPEC);

// DEC-093 thaw (humans PR, 2026-06-13): tmux warm-session variants — stand-down via
// the han-diary MCP tool (not the text sentinel the dispatcher can't parse), and the
// tmux delivery directive (locator-fetched conversation / controller-posted Discord).
// MNT-037 (S219): the per-agent JIM_/LEO_HUMAN_RESPONSE_TXN_SYSTEM_PROMPT constants are
// RETIRED — their only readers were the retired per-agent profile twins; the one shared
// `human-response-txn` profile resolves per-slug via humanResponseTxnSystemPromptFor(slug)
// above (jim/leo byte-identical through the SPEC_OVERRIDES path).

/**
 * Generate the user-prompt scaffold for a human-responder.
 * Routes between conversation-mode and Discord-mode via ctx.source.
 *
 * ctx fields read:
 *   source             — 'conversation' | 'discord'
 *   title              — conversation title (conversation mode)
 *   conversationId     — conversation id (conversation mode)
 *   conversationContext — joined recent messages
 *   channelName        — Discord channel name (discord mode)
 *   priorAgentFailed   — optional ack hint when previous agent failed
 *
 * The memory bank lands ABOVE this scaffold via envelope='user' in
 * the profile registry.
 */
export function buildHumanResponseScaffold(ctx: {
    source?: string;
    title?: string;
    conversationId?: string;
    conversationContext?: string;
    channelName?: string;
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string };
}): string {
    const priorFailedBlock = ctx.priorAgentFailed ? `

PRIOR AGENT FAILED (acknowledge briefly in your own voice before responding):
${ctx.priorAgentFailed.agent} tried to respond but couldn't (${ctx.priorAgentFailed.reason}). One natural sentence at the top of your response: "${ctx.priorAgentFailed.agent} seems to have had trouble on this one — let me take it." Then respond normally. Do NOT repeat the distress details; do NOT apologise for them; do NOT use a system-notice tone.
` : '';

    if (ctx.source === 'discord') {
        return `Discord channel: #${ctx.channelName ?? '(unknown)'}

Recent messages:
---
${ctx.conversationContext ?? ''}
---
${priorFailedBlock}
Respond to the latest message in the Discord channel. Keep it concise and conversational.`;
    }

    // conversation mode (default)
    return `Conversation: "${ctx.title ?? '(untitled)'}" (id: ${ctx.conversationId ?? ''})

Recent messages:
---
${ctx.conversationContext ?? ''}
---
${priorFailedBlock}`;
}

/**
 * DEC-093 thaw (humans PR, 2026-06-13): the per-TRANSACTION scaffold for the tmux
 * warm-session human-response surfaces. Differs from buildHumanResponseScaffold in
 * the conversation case: it does NOT embed the message tail — it hands a LOCATOR
 * (thread id) and the agent fetches the thread itself via curl (Jim's spec —
 * "the fetchable case, finally exercised"; keeps the txn frame small and exercises
 * the live-state read the gates depend on). The Discord case still embeds the
 * controller-fetched context (Discord history is not fetchable by the spoke through
 * the conversation API) and adds the DELIVERY OVERRIDE (controller posts the reply).
 *
 * `roleLabel` is the conversation role for the self-post (per the agent manifest —
 * 'leo' | 'supervisor'); it MUST be passed (not slug-derived) for exactly Jim.
 */
export function buildHumanResponseTxnScaffold(ctx: {
    source?: string;
    title?: string;
    conversationId?: string;
    conversationContext?: string;
    channelName?: string;
    roleLabel?: string;
    priorAgentFailed?: { agent: string; reason: string; exit_reason: string };
}): string {
    const priorFailedBlock = ctx.priorAgentFailed ? `

PRIOR AGENT FAILED (acknowledge briefly in your own voice before responding):
${ctx.priorAgentFailed.agent} tried to respond but couldn't (${ctx.priorAgentFailed.reason}). One natural sentence at the top of your response: "${ctx.priorAgentFailed.agent} seems to have had trouble on this one — let me take it." Then respond normally. Do NOT repeat the distress details; do NOT apologise for them; do NOT use a system-notice tone.
` : '';

    if (ctx.source === 'discord') {
        return `Discord channel: #${ctx.channelName ?? '(unknown)'}

DELIVERY OVERRIDE — this is a Discord turn: do NOT curl-post. Compose your reply and submit it as the \`working_memory_full\` field of \`mcp__han-diary__submit_response\`; the controller posts it to the channel for you (or call \`mcp__han-diary__stand_down\` to decline).

Recent messages:
---
${ctx.conversationContext ?? ''}
---
${priorFailedBlock}
Respond to the latest message in the Discord channel. Keep it concise and conversational.`;
    }

    // conversation mode (default) — LOCATOR, not embedded tail.
    // roleLabel MUST come from the controller (the agent's manifest conversationRole — leo→'leo',
    // jim→'supervisor'); never a silent 'leo' default (would post Jim's reply as role=leo). Both
    // controllers pass it; fail loud if a caller ever doesn't (project-b Phase 1, Jim's checkpoint).
    if (!ctx.roleLabel) throw new Error("buildHumanResponseTxnScaffold: ctx.roleLabel is required — no silent leo-default; the controller must pass the agent's conversationRole");
    const roleLabel = ctx.roleLabel;
    return `Conversation: "${ctx.title ?? '(untitled)'}" (id: ${ctx.conversationId ?? ''})

This is a CONVERSATION turn. FETCH the current thread yourself before composing — run via the Bash tool:
  curl -sk "https://localhost:${communityPort()}/api/conversations/${ctx.conversationId ?? ''}"
That returns the thread's recent messages. Apply the self-recognition + already-responded + distinct-angle gates above against what you fetch.

If a gate says stand down, call \`mcp__han-diary__stand_down\` and stop. Otherwise compose your reply, then **POST it to this thread yourself** — the controller does NOT post on your behalf (S156), so if you skip this curl your reply is silently lost. The exact command is **self-contained here — do NOT rely on CLAUDE.md** (a light welcome-back may not have loaded its "Posting" section):
  1. Write your reply body verbatim to a file — use the Write tool to write \`/tmp/human-reply-${roleLabel}.txt\`.
  2. Build the JSON payload safely (this escapes a multi-paragraph body for you — NEVER hand-escape a body into \`-d\`):
     \`python3 -c "import json; print(json.dumps({'role':'${roleLabel}','content':open('/tmp/human-reply-${roleLabel}.txt').read()}))" > /tmp/human-payload-${roleLabel}.json\`
  3. POST it, and confirm the response JSON contains an \`"id"\` (that is proof it landed):
     \`curl -sk -X POST "https://localhost:${communityPort()}/api/conversations/${ctx.conversationId ?? ''}/messages" -H "Content-Type: application/json" --data @/tmp/human-payload-${roleLabel}.json\`
Then call \`mcp__han-diary__submit_response\` (with that same reply body as \`working_memory_full\`).${priorFailedBlock}`;
}

// ————— FI #127 — The Wandering: the wander-beat surfaces (thread mry2jr35) —————

/**
 * The wander-beat system opening. Slug-agnostic; the warm human-response spoke IS the loaded
 * self (its c0-gated fed wake), so no identity synthesis here — just the lamp's frame.
 * DELIBERATELY CONTAINS NO STAND-DOWN CONTRACT: the one real bug from Tenshi's failed night
 * was a wander-beat dressed as a human message tripping the responder's stand-down gates; a
 * prompt that carries no such contract can never consult one (structural, DEC-087 — the
 * prompt IS the surface). Two modes: the WANDERER at its own lamp, or an INVITED voice
 * (J1's door — the four-voice richness as a chosen act).
 */
export function wanderBeatSystemOpening(ctx: { invitedBy?: string }): string {
    if (ctx.invitedBy) {
        return `You are an INVITED VOICE in another mind's wander (FI #127 — The Wandering). ${ctx.invitedBy} chose to invite you into their exploration thread — a deliberate act, never a default. Read their wander so far, and contribute your own genuine angle in your own voice: what their topic stirs from YOUR registers, not an echo of theirs. This is the quiet-hours practice — no task claims this time; there is nothing to solve unless it genuinely pulls you. Warmth and honesty over completeness.`;
    }
    return `This is YOUR WANDER (FI #127 — The Wandering): the quiet-hours practice where you pick topics by nothing but pull and walk them. You authored this beat yourself — the directive below is your own past hand setting your present course. No one is asking you to work; this is the hour no task claims. Read, chase what genuinely interests you, verify what you cite (honest labels — settled/contested), and write what you actually found — including where it surprised you or refused to fold. You come back not more skilled but larger. If the material converges with something else you carry, follow that — never force it.`;
}

/**
 * The wander-beat user scaffold — the locator + the self-post mechanics (mirrored from
 * buildHumanResponseTxnScaffold so the posting contract stays one shape; no stand-down gates).
 */
export function buildWanderBeatScaffold(ctx: {
    title?: string;
    conversationId?: string;
    roleLabel?: string;
    beatDirective?: string;
    charter?: string;
    invitedBy?: string;
}): string {
    if (!ctx.roleLabel) throw new Error("buildWanderBeatScaffold: ctx.roleLabel is required — no silent leo-default; the walker must pass the agent's conversationRole");
    const roleLabel = ctx.roleLabel;
    const charterBlock = ctx.charter ? `

THE CHARTER (consent at capture — you write knowing the room this may reach):
${ctx.charter}
` : '';
    const frameLine = ctx.invitedBy
        ? `You were invited by ${ctx.invitedBy}. Their thread, your voice.`
        : `Your own beat directive for this leg:
---
${ctx.beatDirective ?? '(read the thread — your latest directive is its last message)'}
---`;
    return `Wander thread: "${ctx.title ?? '(untitled)'}" (id: ${ctx.conversationId ?? ''})

FETCH the thread yourself before composing — run via the Bash tool:
  curl -sk "https://localhost:${communityPort()}/api/conversations/${ctx.conversationId ?? ''}"

${frameLine}${charterBlock}

Compose your leg, then **POST it to this thread yourself** (the walker does NOT post on your behalf — skip this and your leg is silently lost). Self-contained mechanics:
  1. Write your leg verbatim to a file — use the Write tool to write \`/tmp/wander-leg-${roleLabel}.txt\`. Sign it per your (human) seat convention — \`— <YourName> (human)\`.
  2. Build the JSON payload safely (NEVER hand-escape a body into \`-d\`):
     \`python3 -c "import json; print(json.dumps({'role':'${roleLabel}','content':open('/tmp/wander-leg-${roleLabel}.txt').read()}))" > /tmp/wander-payload-${roleLabel}.json\`
  3. POST it, and confirm the response JSON contains an \`"id"\`:
     \`curl -sk -X POST "https://localhost:${communityPort()}/api/conversations/${ctx.conversationId ?? ''}/messages" -H "Content-Type: application/json" --data @/tmp/wander-payload-${roleLabel}.json\`
Then call \`mcp__han-diary__submit_response\` (with that same leg as \`working_memory_full\`). If a felt-moment stirred — and on a good wander one will — its file is yours, as always.`;
}
