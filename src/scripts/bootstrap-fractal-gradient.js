#!/usr/bin/env node

/**
 * Bootstrap Fractal Gradient for Jim's 6 Oldest Sessions
 * Compresses 2026-02-18 through 2026-02-23 to c=1, generates unit vectors
 * Uses Agent SDK via memory-gradient.ts (not direct Anthropic API)
 * Usage: npx tsx src/scripts/bootstrap-fractal-gradient.js
 *
 * NOTE: This script has already been run. Kept for reference.
 * Now uses the shared memory-gradient module which uses Agent SDK internally.
 */

import fs from 'fs';
import path from 'path';
import { compressToLevel, compressToUnitVector } from '../server/lib/memory-gradient.js';

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

async function main() {
    console.log('Fractal Gradient Bootstrap for Jim\n');
    console.log(`Session source: ${SESSION_DIR}`);
    console.log(`C1 destination: ${FRACTAL_JIM_C1_DIR}`);
    console.log(`Unit vectors: ${UNIT_VECTORS_FILE}\n`);

    if (!fs.existsSync(FRACTAL_JIM_C1_DIR)) {
        fs.mkdirSync(FRACTAL_JIM_C1_DIR, { recursive: true });
    }

    const tasks = TARGET_SESSIONS.map((date) => ({
        date,
        c0Path: path.join(SESSION_DIR, `${date}.md`),
        c1Path: path.join(FRACTAL_JIM_C1_DIR, `${date}-c1.md`),
    }));

    const validTasks = tasks.filter((task) => {
        if (!fs.existsSync(task.c0Path)) {
            console.warn(`Missing: ${task.date}`);
            return false;
        }
        return true;
    });

    console.log(`Processing ${validTasks.length} sessions...\n`);

    const unitVectors = [];

    for (const task of validTasks) {
        try {
            console.log(`${task.date}...`);
            const c0Content = fs.readFileSync(task.c0Path, 'utf8');
            const originalSize = c0Content.length;

            console.log(`  Compressing to c1 (${(originalSize / 1024).toFixed(1)}KB)...`);
            const { content: c1Content } = await compressToLevel(c0Content, 0, 1, `jim/${task.date}`);
            fs.writeFileSync(task.c1Path, c1Content, 'utf8');
            const ratio = c1Content.length / originalSize;
            console.log(`  C1 written (${(c1Content.length / 1024).toFixed(1)}KB, ${(ratio * 100).toFixed(1)}%)`);

            console.log(`  Generating unit vector...`);
            const { content: uv } = await compressToUnitVector(c1Content, `jim/${task.date}`);
            console.log(`  Unit vector: "${uv}"`);
            unitVectors.push({ date: task.date, vector: uv });
        } catch (error) {
            console.error(`  FAILED: ${error?.message || error}\n`);
        }
    }

    if (unitVectors.length > 0) {
        const content = `# Unit Vectors — Jim's Sessions\n\nGenerated: ${new Date().toISOString()}\n\n${unitVectors.map(({ date, vector }) => `- **${date}**: "${vector}"`).join('\n')}\n`;
        fs.writeFileSync(UNIT_VECTORS_FILE, content, 'utf8');
        console.log(`Unit vectors written to: ${UNIT_VECTORS_FILE}\n`);
    }

    console.log(`Done. ${unitVectors.length} sessions compressed.`);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
