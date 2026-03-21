/**
 * Compress Leo's Session Archives
 * Runs the full gradient pipeline: c0→c1→c2→c3→c5→UV
 *
 * Usage: npx tsx src/scripts/compress-leo-sessions.ts
 *
 * Called at session end (prepare-for-clear) and daily by the heartbeat.
 * Compresses any working-memory archives that don't yet have c1 files,
 * then cascades overflow through the fractal gradient.
 */

import { processGradientForAgent } from '../server/lib/memory-gradient';

async function main() {
    console.log('Leo Session Gradient — compressing archived sessions\n');

    const result = await processGradientForAgent('leo');

    const newC1s = result.completions.filter(c => c.toLevel === 1);
    const cascades = result.completions.filter(c => c.toLevel > 1);

    if (newC1s.length > 0) {
        console.log(`\nNew c1 compressions (${newC1s.length}):`);
        for (const c of newC1s) {
            console.log(`  ${c.session}: ${(c.ratio * 100).toFixed(0)}% ratio`);
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
