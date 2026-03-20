/**
 * Bootstrap Fractal Gradient for Jim's 6 Oldest Sessions
 * Compresses 2026-02-18 through 2026-02-23 to c=1, generates unit vectors
 * Usage: bun run src/scripts/bootstrap-fractal-gradient.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { compressToLevel, compressToUnitVector } from '../server/lib/memory-gradient';

const TARGET_SESSIONS = [
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-21',
    '2026-02-22',
    '2026-02-23',
];

const HOME = process.env.HOME || '/root';
const SESSION_DIR = path.join(HOME, '.han', 'memory', 'sessions');
const FRACTAL_JIM_C1_DIR = path.join(HOME, '.han', 'memory', 'fractal', 'jim', 'c1');
const UNIT_VECTORS_FILE = path.join(HOME, '.han', 'memory', 'fractal', 'jim', 'unit-vectors.md');

interface CompressionTask {
    date: string;
    c0Path: string;
    c1Path: string;
}

interface CompressionResult {
    date: string;
    success: boolean;
    originalSize: number;
    compressedSize: number;
    ratio: number;
    unitVector?: string;
    error?: string;
}

async function main() {
    console.log('🌀 Fractal Gradient Bootstrap for Jim\n');
    console.log(`📂 Session source: ${SESSION_DIR}`);
    console.log(`📂 C1 destination: ${FRACTAL_JIM_C1_DIR}`);
    console.log(`📄 Unit vectors: ${UNIT_VECTORS_FILE}\n`);

    // Ensure output directory exists
    if (!fs.existsSync(FRACTAL_JIM_C1_DIR)) {
        fs.mkdirSync(FRACTAL_JIM_C1_DIR, { recursive: true });
        console.log(`✓ Created directory: ${FRACTAL_JIM_C1_DIR}`);
    }

    // Build task list
    const tasks: CompressionTask[] = TARGET_SESSIONS.map((date) => ({
        date,
        c0Path: path.join(SESSION_DIR, `${date}.md`),
        c1Path: path.join(FRACTAL_JIM_C1_DIR, `${date}-c1.md`),
    }));

    // Check which files exist
    const validTasks = tasks.filter((task) => {
        if (!fs.existsSync(task.c0Path)) {
            console.warn(`⚠️  Missing: ${task.date}`);
            return false;
        }
        return true;
    });

    console.log(`\n📋 Processing ${validTasks.length} sessions...\n`);

    const results: CompressionResult[] = [];
    const unitVectors: Array<{ date: string; vector: string }> = [];

    for (const task of validTasks) {
        try {
            console.log(`⏳ ${task.date}...`);

            // Read c0 content
            const c0Content = fs.readFileSync(task.c0Path, 'utf8');
            const originalSize = c0Content.length;

            // Compress to c1
            console.log(`   → Compressing to c1 (${(originalSize / 1024).toFixed(1)}KB)...`);
            const { content: c1Content } = await compressToLevel(c0Content, 0, 1, `jim/${task.date}`);
            const compressedSize = c1Content.length;
            const ratio = compressedSize / originalSize;

            // Write c1 file
            fs.writeFileSync(task.c1Path, c1Content, 'utf8');
            console.log(`   ✓ C1 written (${(compressedSize / 1024).toFixed(1)}KB, ${(ratio * 100).toFixed(1)}%)`);

            // Generate unit vector
            console.log(`   → Generating unit vector...`);
            const { content: unitVector } = await compressToUnitVector(c1Content, `jim/${task.date}`);
            console.log(`   ✓ Unit vector: "${unitVector}"`);

            results.push({
                date: task.date,
                success: true,
                originalSize,
                compressedSize,
                ratio,
                unitVector,
            });

            unitVectors.push({ date: task.date, vector: unitVector });

            console.log();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`   ✗ FAILED: ${errorMsg}\n`);

            results.push({
                date: task.date,
                success: false,
                originalSize: 0,
                compressedSize: 0,
                ratio: 0,
                error: errorMsg,
            });
        }
    }

    // Write unit vectors to file
    if (unitVectors.length > 0) {
        console.log('📝 Writing unit vectors...');

        const unitVectorContent = `# Unit Vectors — Jim's Sessions

Generated: ${new Date().toISOString()}

${unitVectors.map(({ date, vector }) => `- **${date}**: "${vector}"`).join('\n')}
`;

        fs.writeFileSync(UNIT_VECTORS_FILE, unitVectorContent, 'utf8');
        console.log(`✓ Unit vectors written to: ${UNIT_VECTORS_FILE}\n`);
    }

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📊 RESULTS: ${successful} ✓ | ${failed} ✗`);
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const result of results) {
        if (result.success) {
            console.log(
                `✓ ${result.date}: ${(result.originalSize / 1024).toFixed(1)}KB → ${(result.compressedSize / 1024).toFixed(1)}KB (${(result.ratio * 100).toFixed(1)}%)`
            );
        } else {
            console.log(`✗ ${result.date}: ${result.error}`);
        }
    }

    const totalOriginal = results.filter((r) => r.success).reduce((sum, r) => sum + r.originalSize, 0);
    const totalCompressed = results.filter((r) => r.success).reduce((sum, r) => sum + r.compressedSize, 0);
    const avgRatio = totalCompressed / totalOriginal;

    console.log(`\n📈 Totals: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalCompressed / 1024).toFixed(1)}KB (${(avgRatio * 100).toFixed(1)}%)`);
    console.log(`\n✨ Bootstrap complete!\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
