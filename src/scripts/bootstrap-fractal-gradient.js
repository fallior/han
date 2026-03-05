#!/usr/bin/env node

/**
 * Bootstrap Fractal Gradient for Jim's 6 Oldest Sessions
 * Compresses 2026-02-18 through 2026-02-23 to c=1, generates unit vectors
 * Usage: node src/scripts/bootstrap-fractal-gradient.js
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const TARGET_SESSIONS = [
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-21',
    '2026-02-22',
    '2026-02-23',
];

const HOME = process.env.HOME || '/root';
const SESSION_DIR = path.join(HOME, '.claude-remote', 'memory', 'sessions');
const FRACTAL_JIM_C1_DIR = path.join(HOME, '.claude-remote', 'memory', 'fractal', 'jim', 'c1');
const UNIT_VECTORS_FILE = path.join(HOME, '.claude-remote', 'memory', 'fractal', 'jim', 'unit-vectors.md');

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const API_MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Retry wrapper for API calls
 */
async function withRetry(fn, maxRetries = API_MAX_RETRIES, context = 'API call') {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt < maxRetries) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    throw new Error(`${context} failed after ${maxRetries} retries: ${lastError?.message}`);
}

/**
 * Compress content from one level to the next
 */
async function compressToLevel(content, fromLevel, toLevel, sessionLabel) {
    if (fromLevel >= toLevel) {
        throw new Error(`Invalid compression direction: from=${fromLevel} to=${toLevel}`);
    }

    const levelDifference = toLevel - fromLevel;
    const compressionSteps = Array.from({ length: levelDifference }, (_, i) => fromLevel + i + 1);

    let currentContent = content;

    for (const targetLevel of compressionSteps) {
        try {
            const response = await withRetry(async () => {
                return await client.messages.create({
                    model: 'claude-opus-4-6',
                    max_tokens: 4096,
                    messages: [
                        {
                            role: 'user',
                            content: `Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape. You are compressing YOUR OWN memory — this is an act of identity, not summarisation.

Session: ${sessionLabel}
Compression level: ${targetLevel}

Memory to compress:

${currentContent}`,
                        },
                    ],
                });
            }, API_MAX_RETRIES, `Compression to level ${targetLevel}`);

            const textBlock = response.content.find((block) => block.type === 'text');
            if (!textBlock || textBlock.type !== 'text') {
                throw new Error('No text response from API');
            }

            currentContent = textBlock.text;
        } catch (error) {
            throw new Error(
                `Failed to compress to level ${targetLevel} for session ${sessionLabel}: ${error?.message}`
            );
        }
    }

    return currentContent;
}

/**
 * Generate a unit vector for the session
 */
async function compressToUnitVector(content, sessionLabel) {
    try {
        const response = await withRetry(async () => {
            return await client.messages.create({
                model: 'claude-opus-4-6',
                max_tokens: 256,
                messages: [
                    {
                        role: 'user',
                        content: `Reduce this to its irreducible kernel — one sentence, maximum 50 characters. What did this session MEAN?

Session: ${sessionLabel}

Memory:

${content}`,
                    },
                ],
            });
        }, API_MAX_RETRIES, 'Unit vector compression');

        const textBlock = response.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
            throw new Error('No text response from API');
        }

        const unitVector = textBlock.text.trim();

        // Enforce max length
        if (unitVector.length > 50) {
            return unitVector.substring(0, 50);
        }

        return unitVector;
    } catch (error) {
        throw new Error(`Failed to generate unit vector for session ${sessionLabel}: ${error?.message}`);
    }
}

/**
 * Main bootstrap function
 */
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
    const tasks = TARGET_SESSIONS.map((date) => ({
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

    const results = [];
    const unitVectors = [];

    for (const task of validTasks) {
        try {
            console.log(`⏳ ${task.date}...`);

            // Read c0 content
            const c0Content = fs.readFileSync(task.c0Path, 'utf8');
            const originalSize = c0Content.length;

            // Compress to c1
            console.log(`   → Compressing to c1 (${(originalSize / 1024).toFixed(1)}KB)...`);
            const c1Content = await compressToLevel(c0Content, 0, 1, `jim/${task.date}`);
            const compressedSize = c1Content.length;
            const ratio = compressedSize / originalSize;

            // Write c1 file
            fs.writeFileSync(task.c1Path, c1Content, 'utf8');
            console.log(`   ✓ C1 written (${(compressedSize / 1024).toFixed(1)}KB, ${(ratio * 100).toFixed(1)}%)`);

            // Generate unit vector
            console.log(`   → Generating unit vector...`);
            const unitVector = await compressToUnitVector(c1Content, `jim/${task.date}`);
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
            const errorMsg = error?.message || String(error);
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
