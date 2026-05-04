/**
 * Compress an Agent's Session Archives
 * Runs the full gradient pipeline: c0→c1→c2→...→UV
 *
 * Usage: AGENT_SLUG=<slug> npx tsx src/scripts/compress-sessions.ts
 *
 * Reads the agent slug from the environment (set by the launcher's export
 * block — han, hanleo, hanjim, hancasey, hantenshi, etc.). The full set of
 * env-var contracts the launchers must export:
 *
 *   AGENT_SLUG                  — short identifier (leo, jim, tenshi, ...)
 *   AGENT_GRADIENT_SOURCE_DIR   — where to find c0 source files
 *   AGENT_FRACTAL_DIR           — where to write c1+ compressions
 *
 * Called from the /pfc skill at session end. Per the aphorism *"HAN should
 * always be written agent-agnostic"* — adding a new agent means adding an
 * entry to `src/server/lib/agent-registry.ts` and ensuring the launcher
 * exports the env vars above. No edits to this script.
 *
 * Renamed from `compress-leo-sessions.ts` 2026-05-04 (S149) as part of the
 * /pfc skill landing.
 */

import { processGradientForAgent } from '../server/lib/memory-gradient';
import { requireAgentEnv } from '../server/lib/agent-registry';

async function main() {
    // Validate the full env-var contract before printing anything — otherwise
    // a partial setup would print the banner ("compressing for agent: jim")
    // immediately followed by a fatal error, which reads as if compression
    // started then failed. Pre-validating means the user sees only the error
    // when env vars are missing.
    const agent = process.env.AGENT_SLUG;
    if (!agent) {
        console.error(
            'AGENT_SLUG must be exported by the launcher. ' +
            'Check the launcher script (han, hanleo, hanjim, etc.) and confirm ' +
            'the export block sets AGENT_SLUG along with AGENT_GRADIENT_SOURCE_DIR ' +
            'and AGENT_FRACTAL_DIR.',
        );
        process.exit(1);
    }
    requireAgentEnv('AGENT_GRADIENT_SOURCE_DIR');
    requireAgentEnv('AGENT_FRACTAL_DIR');

    console.log(`Session Gradient — compressing archived sessions for agent: ${agent}\n`);

    const result = await processGradientForAgent(agent);

    const newC1s = result.completions.filter(c => c.toLevel === 1);
    const cascades = result.completions.filter(c => c.toLevel > 1);

    if (newC1s.length > 0) {
        console.log(`\nNew c1 compressions (${newC1s.length}):`);
        for (const c of newC1s) {
            console.log(`  ${c.session}: ${(c.ratio! * 100).toFixed(0)}% ratio`);
        }
    }

    if (cascades.length > 0) {
        console.log(`\nCascades (${cascades.length}):`);
        for (const c of cascades) {
            console.log(`  ${c.session}: c${c.fromLevel} → c${c.toLevel}`);
        }
    }

    if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const e of result.errors) {
            console.log(`  ${e.session} (level ${e.level}): ${e.error}`);
        }
    }

    if (newC1s.length === 0 && cascades.length === 0) {
        console.log('All archives already compressed. Nothing to do.');
    }

    console.log(`\nTotal: ${result.compressionsToDo} source files, ${newC1s.length} new c1, ${cascades.length} cascades, ${result.errors.length} errors`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
