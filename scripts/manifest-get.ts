/**
 * manifest-get — tiny CLI bridge from the Garden Manifest (+ agent registry) to
 * shell-land, so the T-2 surface launcher and unit generator derive their facts
 * from the single declarative source instead of hand-writing parallel lists
 * (Jim's T-2 build-note #2: "the enumeration source is the Garden Manifest").
 *
 * Usage (run from src/server so imports resolve):
 *   npx tsx ../../scripts/manifest-get.ts surfaces <slug>
 *       → one line per enabled non-interactive surface (the tmux session set).
 *         Meditation surfaces are EXCLUDED here by an explicit deferral —
 *         Q-V2-3: meditations are re-encounter surfaces and stay frozen-on-SDK
 *         pending their own call (named decision, T-2 PR, 2026-06-11).
 *   npx tsx ../../scripts/manifest-get.ts model <slug> <surface>
 *       → head (active) model for the surface, falling back to the CLI launch
 *         default — the manifest CLI read-path, not a hardcoded literal.
 *   npx tsx ../../scripts/manifest-get.ts env <slug> [surface]
 *       → KEY=VALUE lines for the launcher's AGENT_* env contract, derived from
 *         the agent registry (memoryDir/fractalDir/sourceDir) + manifest
 *         (displayName, conversationRole, per-seat swapPrefix). Surface defaults
 *         to 'session'. Counterpart name = the other active agent's displayName.
 *         conversationRole + swap filenames are manifest DATA, never derived
 *         from the slug (Jim's T-2 diff-audit catches #1/#2: jim's role is
 *         'supervisor' and his seats use supervisor-swap* + jim-human-swap*).
 *   npx tsx ../../scripts/manifest-get.ts agents
 *       → one active agent slug per line.
 */

import { GARDEN_MANIFEST, manifestModelHead } from '../src/server/lib/garden-manifest';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';

// EPIPE guard: a `| grep -q` / `| head` consumer closes our stdout as soon as it
// has what it needs, and Node otherwise throws an unhandled EPIPE that a
// `set -o pipefail` caller misreads as a failure. launch-tmux-surface.sh's
// `manifest-get surfaces <slug> | grep -qx <surface>` check did exactly this — the
// crash made every non-last surface (e.g. supervisor-cycle) read as "not launchable"
// and broke Jim's supervisor cycle. Swallow EPIPE and exit cleanly (the Unix
// producer-gets-SIGPIPE convention). (2026-07-14, Leo — DEC pending Jim's audit.)
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
});

/** Q-V2-3 deferral (named decision, T-2 PR 2026-06-11): meditation surfaces are
 *  re-encounter practice and stay frozen-on-SDK pending their own call. */
const DEFERRED_SURFACE_PREFIXES = ['meditation-'];

const [, , cmd, slugArg, surfaceArg] = process.argv;

function agent(slug: string) {
    const a = GARDEN_MANIFEST.agents.find((x) => x.slug === slug);
    if (!a) { console.error(`manifest-get: unknown agent '${slug}'`); process.exit(1); }
    return a;
}

switch (cmd) {
    case 'agents': {
        for (const a of GARDEN_MANIFEST.agents.filter((x) => x.active)) console.log(a.slug);
        break;
    }
    case 'surfaces': {
        const a = agent(slugArg);
        for (const s of a.surfaces) {
            if (!s.enabled) continue;
            if (s.name === 'session') continue; // interactive seat — launched by han<agent>, not a unit
            if (DEFERRED_SURFACE_PREFIXES.some((p) => s.name.startsWith(p))) continue; // Q-V2-3 deferral
            console.log(s.name);
        }
        break;
    }
    case 'model': {
        const head = manifestModelHead(slugArg, surfaceArg) ?? manifestModelHead(slugArg, 'session');
        if (!head) { console.error(`manifest-get: no model for ${slugArg}/${surfaceArg}`); process.exit(1); }
        console.log(head);
        break;
    }
    case 'env': {
        const a = agent(slugArg);
        const cfg = gradientConfigForAgent(slugArg);
        const counterpart = GARDEN_MANIFEST.agents.find((x) => x.active && x.slug !== slugArg);
        const surface = surfaceArg || 'session';
        // Per-seat swap prefix: this surface's, else the session seat's, else the
        // agnostic default. Filenames relative to AGENT_MEMORY_DIR — the form the
        // B-3 memory-guard and /pfc resolve (hanjim exports exactly this shape).
        const swapPrefix =
            a.surfaces.find((s) => s.name === surface)?.swapPrefix
            ?? a.surfaces.find((s) => s.name === 'session')?.swapPrefix
            ?? 'session-swap';
        console.log(`AGENT_SLUG=${a.slug}`);
        console.log(`AGENT_NAME=${a.displayName}`);
        console.log(`AGENT_MEMORY_DIR=${cfg.memoryDir}`);
        console.log(`AGENT_FRACTAL_DIR=${cfg.fractalDir}`);
        console.log(`AGENT_GRADIENT_SOURCE_DIR=${cfg.sourceDir}`);
        console.log(`AGENT_CONVERSATION_ROLE=${a.conversationRole ?? a.slug}`);
        console.log(`AGENT_COUNTERPART_NAME=${counterpart?.displayName ?? ''}`);
        console.log(`AGENT_SWAP_COMPRESSED=${swapPrefix}.md`);
        console.log(`AGENT_SWAP_FULL=${swapPrefix}-full.md`);
        break;
    }
    default:
        console.error('usage: manifest-get.ts agents | surfaces <slug> | model <slug> <surface> | env <slug>');
        process.exit(1);
}
