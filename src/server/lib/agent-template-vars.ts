/**
 * agent-template-vars — the ONE place that assembles the full template-var contract
 * for rendering an agent's CLAUDE.md from `templates/CLAUDE.template.md` (S199 P4+P5,
 * DEC-073→config). Replaces the per-launcher duplication: every `han<agent>` launcher
 * used to hardcode this same ${...} map (identity heredoc + project/user block +
 * TEMPLATE_VARS allowlist). Now they — and the serverless spoke launcher — all read it
 * from the Garden Manifest via this function. DEC-081: keyed on `string` slug, no literals.
 *
 * Consumed by `scripts/generate-agent-claude-md.ts` (the shared render path). The contract
 * is exactly the 19 ${VARS} the template references (grep-verified 2026-06-23).
 *
 * FAIL-LOUD: throws on an unknown slug or a missing identitySection — no slug → no
 * identity → error, never a silent default (the de-id principle, Darron 2026-06-22).
 */

import { homedir } from 'os';
import { GARDEN_MANIFEST, allocationFor } from './garden-manifest';
import { gradientConfigForAgent } from './agent-registry';

/** The full template-var map for one agent surface — every ${VAR} the template needs. */
export function agentTemplateVars(slug: string, surface = 'session'): Record<string, string> {
    const a = GARDEN_MANIFEST.agents.find((x) => x.slug === slug);
    if (!a) {
        throw new Error(
            `agent-template-vars: unknown agent '${slug}'. Add it to GARDEN_MANIFEST in ` +
            `src/server/lib/garden-manifest.ts (no slug → no identity → fail loud, S199).`,
        );
    }
    if (!a.identitySection) {
        throw new Error(
            `agent-template-vars: agent '${slug}' has no identitySection. Identity is required — ` +
            `the generator must never produce an identity-less CLAUDE.md (S199 fail-loud).`,
        );
    }

    const cfg = gradientConfigForAgent(slug);
    const allocated = allocationFor(slug); // C-P3a (P4b-i): port is allocation-sourced, not roster-sourced
    const { project, user } = GARDEN_MANIFEST;

    // Per-seat swap prefix: this surface's, else the session seat's, else the agnostic
    // default (mirrors manifest-get.ts `env`). Filenames relative to AGENT_MEMORY_DIR.
    const swapPrefix =
        a.surfaces.find((s) => s.name === surface)?.swapPrefix
        ?? a.surfaces.find((s) => s.name === 'session')?.swapPrefix
        ?? 'session-swap';

    // Counterpart = the other active agent's display name (mirrors manifest-get.ts).
    const counterpart = GARDEN_MANIFEST.agents.find((x) => x.active && x.slug !== slug);

    // The agent working dir is uniform across the garden — ~/.han/agents/<DisplayName> —
    // for EVERY agent including jim (verified: hanjim:25 is ~/.han/agents/Jim, not root, unlike
    // his root-special memoryDir). So derivation is safe here (cf. the S195 jim-at-root caveat:
    // that applies to memoryDir, which we correctly take from the registry, not derive).
    const workingDir = `${homedir()}/.han/agents/${a.displayName}`;

    return {
        AGENT_NAME: a.displayName,
        AGENT_SLUG: a.slug,
        AGENT_PORT: allocated?.port != null ? String(allocated.port) : '',
        AGENT_WORKING_DIR: workingDir,
        AGENT_MEMORY_DIR: cfg.memoryDir,
        AGENT_FRACTAL_DIR: cfg.fractalDir,
        AGENT_SWAP_COMPRESSED: `${swapPrefix}.md`,
        AGENT_SWAP_FULL: `${swapPrefix}-full.md`,
        AGENT_CONVERSATION_ROLE: a.conversationRole ?? a.slug,
        AGENT_COUNTERPART_NAME: counterpart?.displayName ?? '',
        AGENT_IDENTITY_SECTION: a.identitySection,
        AGENT_PRONOUN_OBJ: a.pronounObj ?? 'them',
        PROJECT_NAME: project.name,
        PROJECT_TAGLINE: project.tagline,
        PROJECT_PATH: project.path,
        USER_NAME: user.name,
        USER_PRONOUN_SUBJ: user.pronounSubj,
        USER_PRONOUN_OBJ: user.pronounObj,
        USER_LOCATION: user.location,
    };
}
