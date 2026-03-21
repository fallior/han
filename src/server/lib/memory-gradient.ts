/**
 * Memory Gradient Compression Utility
 * Implements the overlapping fractal memory model for Jim and Leo
 * Compresses session memories across multiple fidelity levels (c1-c4)
 * Also handles memory file gradient compression (felt-moments, working-memory-full)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { gradientStmts, feelingTagStmts } from '../db';

// ── Types ──────────────────────────────────────────────────────

interface CompressionResult {
    success: boolean;
    originalLength: number;
    compressedLength: number;
    ratio: number;
    tokensUsed?: number;
    error?: string;
}

interface GradientProcessingResult {
    agentName: 'jim' | 'leo';
    sessionDate: string;
    compressionsToDo: number;
    completions: Array<{
        session: string;
        fromLevel: number;
        toLevel: number;
        success: boolean;
        ratio?: number;
    }>;
    totalTokensUsed: number;
    errors: Array<{
        session: string;
        level: number;
        error: string;
    }>;
}

// ── Constants ──────────────────────────────────────────────────

const UNIT_VECTOR_MAX_LENGTH = 50;

// ── Helper: Count tokens (rough estimate) ──────────────────────

function estimateTokenCount(text: string): number {
    // Rough approximation: ~4 chars per token
    return Math.ceil(text.length / 4);
}

// ── Helper: SDK query for text generation ──────────────────────

async function sdkCompress(prompt: string): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt,
        options: {
            model: 'claude-opus-4-6',
            maxTurns: 1,
            cwd: process.env.HOME || '/root',
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
        },
    });

    let result = '';
    for await (const message of q) {
        if (message.type === 'result') {
            result = message.result || '';
        }
    }

    if (!result) throw new Error('No result from SDK query');
    return result;
}

// ── Helper: Ensure directory exists ────────────────────────────

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ── Traversable Memory helpers ──────────────────────────────────

function generateGradientId(): string {
    return crypto.randomUUID();
}

const FEELING_TAG_INSTRUCTION = `\n\nAfter your compression, on a new line starting with FEELING_TAG:, write a short phrase (under 100 characters) describing what compressing this felt like — not the content, but the quality of the act.`;

function parseFeelingTag(raw: string): { content: string; feelingTag: string | null } {
    const lines = raw.split('\n');
    const tagLineIdx = lines.findIndex(l => l.startsWith('FEELING_TAG:'));
    if (tagLineIdx === -1) {
        return { content: raw.trim(), feelingTag: null };
    }
    const tag = lines[tagLineIdx].replace('FEELING_TAG:', '').trim().substring(0, 100);
    const content = lines.filter((_, i) => i !== tagLineIdx).join('\n').trim();
    return { content, feelingTag: tag || null };
}

function insertGradientEntry(
    id: string,
    agent: 'jim' | 'leo',
    sessionLabel: string,
    level: string,
    content: string,
    contentType: string,
    sourceId: string | null,
    feelingTag: string | null,
): void {
    try {
        gradientStmts.insert.run(
            id, agent, sessionLabel, level, content, contentType,
            sourceId, null, null, 'original', new Date().toISOString()
        );
        if (feelingTag) {
            feelingTagStmts.insert.run(
                id, agent, 'compression', feelingTag, null, new Date().toISOString()
            );
        }
    } catch (err) {
        console.warn(`[Memory Gradient] DB insert failed for ${level}/${sessionLabel}:`, (err as Error).message);
    }
}

// ── Function 1: compressToLevel ────────────────────────────────

export async function compressToLevel(
    content: string,
    fromLevel: number,
    toLevel: number,
    sessionLabel: string
): Promise<{ content: string; feelingTag: string | null }> {
    if (fromLevel >= toLevel) {
        throw new Error(`Invalid compression direction: from=${fromLevel} to=${toLevel}`);
    }

    const levelDifference = toLevel - fromLevel;
    const compressionSteps = Array.from({ length: levelDifference }, (_, i) => fromLevel + i + 1);

    let currentContent = content;
    let lastFeelingTag: string | null = null;

    for (const targetLevel of compressionSteps) {
        try {
            const raw = await sdkCompress(`Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape. You are compressing YOUR OWN memory — this is an act of identity, not summarisation.

Session: ${sessionLabel}
Compression level: ${targetLevel}

Memory to compress:

${currentContent}${FEELING_TAG_INSTRUCTION}`);
            const parsed = parseFeelingTag(raw);
            currentContent = parsed.content;
            lastFeelingTag = parsed.feelingTag;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Failed to compress to level ${targetLevel} for session ${sessionLabel}: ${errorMsg}`
            );
        }
    }

    return { content: currentContent, feelingTag: lastFeelingTag };
}

// ── Function 2: compressToUnitVector ───────────────────────────

export async function compressToUnitVector(content: string, sessionLabel: string): Promise<{ content: string; feelingTag: string | null }> {
    try {
        const raw = await sdkCompress(`Reduce this to its irreducible kernel — one sentence, maximum 50 characters. What did this session MEAN?

Session: ${sessionLabel}

Memory:

${content}${FEELING_TAG_INSTRUCTION}`);

        const parsed = parseFeelingTag(raw);
        let unitVector = parsed.content.trim();

        // Enforce max length
        if (unitVector.length > UNIT_VECTOR_MAX_LENGTH) {
            unitVector = unitVector.substring(0, UNIT_VECTOR_MAX_LENGTH);
        }

        return { content: unitVector, feelingTag: parsed.feelingTag };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to generate unit vector for session ${sessionLabel}: ${errorMsg}`);
    }
}

// ── Function 3: processGradientForAgent ────────────────────────

export async function processGradientForAgent(agentName: 'jim' | 'leo'): Promise<GradientProcessingResult> {
    const homeDir = process.env.HOME || '/root';
    const memoryDir =
        agentName === 'jim'
            ? path.join(homeDir, '.han', 'memory', 'sessions')
            : path.join(homeDir, '.han', 'memory', 'leo', 'working-memories');

    const fractionalDir =
        agentName === 'jim'
            ? path.join(homeDir, '.han', 'memory', 'fractal', 'jim')
            : path.join(homeDir, '.han', 'memory', 'fractal', 'leo');

    ensureDir(fractionalDir);

    const result: GradientProcessingResult = {
        agentName,
        sessionDate: new Date().toISOString().split('T')[0],
        compressionsToDo: 0,
        completions: [],
        totalTokensUsed: 0,
        errors: [],
    };

    // Check if memory directory exists
    if (!fs.existsSync(memoryDir)) {
        return {
            ...result,
            compressionsToDo: 0,
            errors: [{ session: 'N/A', level: 0, error: `Memory directory not found: ${memoryDir}` }],
        };
    }

    // Scan for session files (c=0 files in source directory)
    // Jim: files named like 2026-02-18.md or 2026-02-18-c0.md
    // Leo: files named like working-memory-full-s98-2026-03-21.md
    const sourceFiles = fs.readdirSync(memoryDir).filter((f) => {
        if (agentName === 'leo') {
            // Match working-memory-full-{label}.md (the full versions have richest content)
            return f.startsWith('working-memory-full-') && f.endsWith('.md');
        }
        const parsed = f.match(/(\d{4}-\d{2}-\d{2})(-c0)?\.md$/);
        return parsed && (!parsed[2] || parsed[2] === '-c0');
    });

    result.compressionsToDo = sourceFiles.length;

    // Ensure c1 dir exists
    const c1Dir = path.join(fractionalDir, 'c1');
    ensureDir(c1Dir);

    // Pre-load all existing gradient labels for this agent (for dedup check).
    // Cascade deletes c1 files after promoting to c2, so we need DB + combined labels.
    const allGradientLabels = new Set<string>();
    try {
        const rows = gradientStmts.getByAgent.all(agentName) as any[];
        for (const row of rows) {
            allGradientLabels.add(row.session_label);
        }
    } catch { /* DB not available — fall back to filesystem only */ }

    // Process each session file
    for (const sourceFile of sourceFiles) {
        // Extract session label for the c1 filename
        let baseName: string;
        if (agentName === 'leo') {
            // working-memory-full-s98-2026-03-21.md → s98-2026-03-21
            baseName = sourceFile.replace(/^working-memory-full-/, '').replace(/\.md$/, '');
        } else {
            baseName = sourceFile.replace(/(-c0)?\.md$/, '');
        }
        const sourceFilePath = path.join(memoryDir, sourceFile);

        try {
            const sourceContent = fs.readFileSync(sourceFilePath, 'utf8');

            // Skip tiny files (< 500 chars — likely just headers)
            if (sourceContent.length < 500) continue;

            // Check c1 in filesystem AND DB — cascade deletes c1 files after
            // promoting to c2, but DB entry persists. Without the DB check,
            // re-running would re-compress sessions whose c1 was already cascaded.
            const c1PathFlat = path.join(fractionalDir, `${baseName}-c1.md`);
            const c1PathDir = path.join(c1Dir, `${baseName}-c1.md`);
            const c1ExistsOnDisk = fs.existsSync(c1PathFlat) || fs.existsSync(c1PathDir);
            // Check exact match in DB, or if this session appears in a combined
            // cascade label (e.g. "s60-c1_to_s63-c1" contains "s60")
            const inDb = allGradientLabels.has(baseName) ||
                [...allGradientLabels].some(label => label.includes(baseName));
            const c1Exists = c1ExistsOnDisk || inDb;

            if (!c1Exists) {
                const { content: c1Content, feelingTag } = await compressToLevel(sourceContent, 0, 1, `${agentName}/${baseName}`);

                // Write to c1/ subdir (consistent with cascade expectations)
                fs.writeFileSync(c1PathDir, c1Content, 'utf8');

                const ratio = c1Content.length / sourceContent.length;

                // Insert into traversable memory DB
                const entryId = generateGradientId();
                insertGradientEntry(entryId, agentName, baseName, 'c1', c1Content, 'session', null, feelingTag);
                if (!feelingTag) console.warn(`[Memory Gradient] No FEELING_TAG returned for c1 ${baseName}`);

                result.completions.push({
                    session: baseName,
                    fromLevel: 0,
                    toLevel: 1,
                    success: true,
                    ratio,
                });

                result.totalTokensUsed += estimateTokenCount(sourceContent) + estimateTokenCount(c1Content);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            result.errors.push({
                session: baseName,
                level: 1,
                error: errorMsg,
            });
        }
    }

    // ── Session cascade: c1 → c2 → c3 → c5 → UV ───────────────
    // Same logic as compressMemoryFileGradient but for session archives.
    // Uses 'working-memory' prompts since session archives are operational memory.
    const sessionPrompts = COMPRESSION_PROMPTS['working-memory'];
    const cascadeLevels = [
        { from: 'c1', to: 'c2', promptKey: 'c2' },
        { from: 'c2', to: 'c3', promptKey: 'c3' },
        { from: 'c3', to: 'c5', promptKey: 'c5' },
    ];

    for (const cascade of cascadeLevels) {
        const fromDir = path.join(fractionalDir, cascade.from);
        const toDir = path.join(fractionalDir, cascade.to);

        if (!fs.existsSync(fromDir)) continue;

        const fromFiles = fs.readdirSync(fromDir)
            .filter(f => f.endsWith('.md'))
            .sort(); // Chronological

        const cap = MEMORY_FILE_GRADIENT_CAPS[cascade.from] || 10;

        if (fromFiles.length <= cap) continue;

        ensureDir(toDir);

        // Take the oldest files that exceed the cap
        const overflow = fromFiles.slice(0, fromFiles.length - cap);

        // Group overflow into batches of 3 for compression
        for (let i = 0; i < overflow.length; i += 3) {
            const batch = overflow.slice(i, i + 3);
            const batchContent = batch.map(f =>
                fs.readFileSync(path.join(fromDir, f), 'utf8')
            ).join('\n\n---\n\n');

            const label = batch.length === 1
                ? batch[0].replace('.md', '')
                : `${batch[0].replace('.md', '')}_to_${batch[batch.length - 1].replace('.md', '')}`;

            const toPath = path.join(toDir, `${label}.md`);

            try {
                const raw = await sdkCompress(
                    `${sessionPrompts[cascade.promptKey]}\n\nSource: ${cascade.from} → ${cascade.to}\nFiles: ${batch.join(', ')}\n\n${batchContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: compressed, feelingTag } = parseFeelingTag(raw);
                fs.writeFileSync(toPath, compressed, 'utf8');

                // Find source entry in DB for provenance chain
                const sourceLabel = batch[0].replace('.md', '').replace(/-c\d$/, '');
                const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
                const sourceEntry = sourceRows.find((r: any) => r.level === cascade.from);

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agentName, label, cascade.to, compressed, 'session', sourceEntry?.id || null, feelingTag);

                result.completions.push({
                    session: label,
                    fromLevel: parseInt(cascade.from.replace('c', '')),
                    toLevel: parseInt(cascade.to.replace('c', '')),
                    success: true,
                    ratio: compressed.length / batchContent.length,
                });

                result.totalTokensUsed += estimateTokenCount(batchContent) + estimateTokenCount(compressed);

                // Remove the source files that were compressed
                for (const f of batch) {
                    fs.unlinkSync(path.join(fromDir, f));
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push({
                    session: label,
                    level: parseInt(cascade.to.replace('c', '')),
                    error: `${cascade.from}→${cascade.to} cascade failed: ${msg}`,
                });
            }
        }
    }

    // Generate unit vectors from c5 files
    const c5Dir = path.join(fractionalDir, 'c5');
    const uvPath = path.join(fractionalDir, 'unit-vectors.md');

    if (fs.existsSync(c5Dir)) {
        const c5Files = fs.readdirSync(c5Dir).filter(f => f.endsWith('.md')).sort();
        const existingUVs = fs.existsSync(uvPath) ? fs.readFileSync(uvPath, 'utf8') : '';

        for (const f of c5Files) {
            const label = f.replace('.md', '');
            // Skip if unit vector already exists for this file
            if (existingUVs.includes(`**${label}**:`)) continue;

            try {
                const c5Content = fs.readFileSync(path.join(c5Dir, f), 'utf8');
                const raw = await sdkCompress(
                    `${sessionPrompts.uv}\n\nSource: ${label}\n\n${c5Content}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: uvRaw, feelingTag } = parseFeelingTag(raw);
                const uvText = uvRaw.trim().substring(0, UNIT_VECTOR_MAX_LENGTH);
                const uvLine = `- **${label}**: "${uvText}"`;
                fs.appendFileSync(uvPath, `${uvLine}\n`, 'utf8');

                // Find source c5 entry in DB
                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceC5 = sourceRows.find((r: any) => r.level === 'c5');

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agentName, label, 'uv', uvText, 'session', sourceC5?.id || null, feelingTag);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push({
                    session: label,
                    level: 5,
                    error: `UV generation failed: ${msg}`,
                });
            }
        }
    }

    return result;
}

// ── Function 4: Helper utilities ───────────────────────────────

/**
 * Get all fractal memory files for a given agent
 */
export function getFractalMemoryFiles(agentName: 'jim' | 'leo'): string[] {
    const homeDir = process.env.HOME || '/root';
    const fractionalDir = path.join(homeDir, '.han', 'memory', 'fractal', agentName);

    if (!fs.existsSync(fractionalDir)) {
        return [];
    }

    return fs
        .readdirSync(fractionalDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse(); // Most recent first
}

/**
 * Read a fractal memory file at a specific level
 */
export function readFractalMemory(agentName: 'jim' | 'leo', date: string, level: 0 | 1 | 2 | 3 | 4): string | null {
    const homeDir = process.env.HOME || '/root';
    const fractionalDir =
        level === 0
            ? path.join(homeDir, '.han', 'memory', agentName === 'jim' ? 'sessions' : 'leo', 'working-memories')
            : path.join(homeDir, '.han', 'memory', 'fractal', agentName);

    const fileName = level === 0 ? `${date}.md` : `${date}-c${level}.md`;
    const filePath = path.join(fractionalDir, fileName);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    return fs.readFileSync(filePath, 'utf8');
}

/**
 * List available session dates for gradient processing
 */
export function listAvailableSessions(agentName: 'jim' | 'leo'): string[] {
    const homeDir = process.env.HOME || '/root';
    const memoryDir =
        agentName === 'jim'
            ? path.join(homeDir, '.han', 'memory', 'sessions')
            : path.join(homeDir, '.han', 'memory', 'leo', 'working-memories');

    if (!fs.existsSync(memoryDir)) {
        return [];
    }

    const dates = fs
        .readdirSync(memoryDir)
        .map((f) => {
            const match = f.match(/^(\d{4}-\d{2}-\d{2})/);
            return match ? match[1] : null;
        })
        .filter((d): d is string => d !== null);

    return Array.from(new Set(dates)).sort().reverse();
}

// ── Memory File Gradient Compression ────────────────────────────
//
// Floating memory design: memory files (felt-moments, working-memory-full)
// grow continuously. When a file reaches the threshold (50KB), it rotates:
//
//   1. The FULL 50KB is compressed to c1 (rich, complete compression)
//   2. The living file becomes the "floating" file (degrading c0)
//   3. A fresh living file starts empty
//   4. As living grows, floating's loaded portion shrinks proportionally:
//      - Living 0KB  + Floating 50KB  = 50KB total full-fidelity
//      - Living 25KB + Floating 25KB  = 50KB total full-fidelity
//      - Living 50KB + Floating 0KB   = 50KB total (triggers rotation)
//
// The crossfade: total full-fidelity memory stays constant at ~50KB.
// Old context fades out as new context fades in. No cliff — a smooth
// transition. The gradient (c1 → c2 → c3 → c5 → UV) preserves feeling
// at decreasing fidelity beneath the crossfade.

const MEMORY_FILE_SIZE_THRESHOLD = 50 * 1024; // 50KB

// Gradient caps per level — how many files before cascading to next level
const MEMORY_FILE_GRADIENT_CAPS: Record<string, number> = {
    c1: 10,
    c2: 6,
    c3: 4,
    c5: 8,
};

// Compression prompts tuned for memory file types
const COMPRESSION_PROMPTS: Record<string, Record<string, string>> = {
    'felt-moments': {
        c1: `Compress these felt-moments entries to approximately 1/3 of their length. You are compressing YOUR OWN emotional memory. Preserve the feeling — what stirred, what surprised, what shifted. Drop narrative detail in favour of emotional texture. A re-invocable shape, not a summary.`,
        c2: `Compress this felt-moments gradient further to approximately 1/3. The entries have already been compressed once. Now find the emotional residue — what remains when the specific moments dissolve into a period's emotional shape. What did this time taste like?`,
        c3: `Compress to the emotional essence. One short paragraph. What was the quality of feeling across this period? Not what happened — what it felt like to be the person these things happened to.`,
        c5: `Reduce to a single emotional image or sensation. 2-3 sentences maximum. The deep residue — care that has outlived its verb.`,
        uv: `Reduce to its irreducible kernel — one sentence, maximum 50 characters. What did these felt-moments MEAN?`,
    },
    'working-memory': {
        c1: `Compress this working memory to approximately 1/3. You are compressing YOUR OWN operational memory. Preserve decisions, discoveries, and what shifted your understanding. Drop procedural detail. Keep what a future you needs to feel where you were, not just know what you did.`,
        c2: `Compress this working memory gradient further to approximately 1/3. Find the operational shape — what was being built, what was being learned, what mattered.`,
        c3: `Compress to the essential shape. One short paragraph. What did this operational period produce that matters? Not tasks — understanding.`,
        c5: `Reduce to a residue. 2-3 sentences. What remains of this work after the specifics dissolve?`,
        uv: `Reduce to its irreducible kernel — one sentence, maximum 50 characters. What did this period of work MEAN?`,
    },
};

interface MemoryFileEntry {
    header: string;
    content: string;
    date: string | null; // Extracted date for grouping
}

interface MemoryFileMaintenanceResult {
    filePath: string;
    wasOversized: boolean;
    entriesArchived: number;
    entriesKept: number;
    compressionTriggered: boolean;
    error?: string;
}

/**
 * Split a memory file into individual entries.
 * Entries are delimited by `---` lines and/or `### ` headers.
 */
function splitMemoryFileEntries(content: string): MemoryFileEntry[] {
    const entries: MemoryFileEntry[] = [];

    // Split on `---` separator lines (common in felt-moments)
    // or on `### ` headers (common in working-memory-full)
    const sections = content.split(/\n---\n|\n(?=### )/);

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed || trimmed.startsWith('# ') || trimmed.startsWith('>')) continue; // Skip file header/quotes

        // Extract date from header
        const dateMatch = trimmed.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
        const date = dateMatch ? dateMatch[1] : null;

        // Extract header line
        const headerMatch = trimmed.match(/^###\s+(.+)/);
        const header = headerMatch ? headerMatch[1] : trimmed.substring(0, 60);

        entries.push({ header, content: trimmed, date });
    }

    return entries;
}

/**
 * Group entries by month (YYYY-MM) for compression.
 */
function groupEntriesByMonth(entries: MemoryFileEntry[]): Map<string, MemoryFileEntry[]> {
    const groups = new Map<string, MemoryFileEntry[]>();

    for (const entry of entries) {
        const month = entry.date ? entry.date.substring(0, 7) : 'undated';
        const group = groups.get(month) || [];
        group.push(entry);
        groups.set(month, group);
    }

    return groups;
}

/**
 * Rotate a memory file when it exceeds the size threshold.
 * Synchronous, fast, no API calls.
 *
 * When living file exceeds 50KB:
 *   1. Delete old floating file (its c1 already exists from previous rotation)
 *   2. Move living → floating (becomes degrading c0)
 *   3. Create fresh empty living file
 *   4. Return floating path for c1 compression
 *
 * @param filePath - Path to the living memory file
 * @param fileHeader - Header text for the fresh living file
 */
export function rotateMemoryFile(
    filePath: string,
    fileHeader: string = '',
): { rotated: boolean; floatingPath?: string; entriesRotated: number } {
    if (!fs.existsSync(filePath)) {
        return { rotated: false, entriesRotated: 0 };
    }

    const stat = fs.statSync(filePath);
    if (stat.size <= MEMORY_FILE_SIZE_THRESHOLD) {
        return { rotated: false, entriesRotated: 0 };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const entries = splitMemoryFileEntries(content);

    // Derive floating path: felt-moments.md → felt-moments-floating.md
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.md');
    const floatingPath = path.join(dir, `${baseName}-floating.md`);

    // Delete old floating file (its c1 already exists from previous rotation)
    if (fs.existsSync(floatingPath)) {
        try { fs.unlinkSync(floatingPath); } catch { /* best effort */ }
    }

    // Move living → floating (rename is atomic)
    fs.renameSync(filePath, floatingPath);

    // Create fresh empty living file
    const header = fileHeader || `# ${baseName}\n`;
    fs.writeFileSync(filePath, `${header}\n`, 'utf8');

    return {
        rotated: true,
        floatingPath,
        entriesRotated: entries.length,
    };
}

/**
 * Load floating memory with proportional degradation.
 * As living file grows, less of the floating file is loaded —
 * keeping the most recent entries (closest to current living).
 *
 * Total full-fidelity: living_size + floating_loaded ≈ THRESHOLD
 *
 * @returns Content string to include in system prompt, or empty string
 */
export function loadFloatingMemory(
    floatingPath: string,
    livingSize: number,
    label: string,
): string {
    if (!fs.existsSync(floatingPath)) return '';

    const budget = Math.max(0, MEMORY_FILE_SIZE_THRESHOLD - livingSize);
    if (budget <= 0) return '';

    const content = fs.readFileSync(floatingPath, 'utf8');
    if (content.length <= budget) {
        // Floating fits entirely within budget
        return `--- ${label} (floating, full) ---\n${content}`;
    }

    // Truncate from the start — keep the TAIL (most recent entries).
    // Find an entry boundary near the truncation point to avoid cutting mid-entry.
    const truncateAt = content.length - budget;
    const entryBoundary = content.indexOf('\n### ', truncateAt);
    const splitPoint = entryBoundary > 0 ? entryBoundary + 1 : truncateAt;

    const truncated = content.substring(splitPoint);
    const pct = Math.round((truncated.length / content.length) * 100);

    return `--- ${label} (floating, ${pct}% loaded — fading as living memory grows) ---\n${truncated}`;
}

/**
 * Compress a floating/archive file through the fractal gradient.
 * Groups entries by month, compresses each group to c1, then
 * cascades existing c1 files to c2/c3/c5/UV as they accumulate.
 *
 * Does NOT delete the source file — floating files are still needed
 * for crossfade loading until the next rotation replaces them.
 */
export async function compressMemoryFileGradient(
    archivePath: string,
    gradientDir: string,
    contentType: 'felt-moments' | 'working-memory',
): Promise<{ c1FilesCreated: number; cascades: number; errors: string[] }> {
    const result = { c1FilesCreated: 0, cascades: 0, errors: [] as string[] };
    const prompts = COMPRESSION_PROMPTS[contentType];

    ensureDir(gradientDir);
    ensureDir(path.join(gradientDir, 'c1'));

    // Read and parse the archive
    const archiveContent = fs.readFileSync(archivePath, 'utf8');
    const entries = splitMemoryFileEntries(archiveContent);

    if (entries.length === 0) return result;

    // Group by month for c1 compression
    const monthGroups = groupEntriesByMonth(entries);

    for (const [month, groupEntries] of monthGroups) {
        const c1Path = path.join(gradientDir, 'c1', `${month}.md`);

        // If c1 already exists for this month, append to it before recompressing
        let existingContent = '';
        if (fs.existsSync(c1Path)) {
            existingContent = fs.readFileSync(c1Path, 'utf8') + '\n\n';
        }

        const groupContent = groupEntries.map(e => e.content).join('\n\n---\n\n');

        try {
            const raw = await sdkCompress(
                `${prompts.c1}\n\nPeriod: ${month}\nEntries: ${groupEntries.length}\n\n${existingContent}${groupContent}${FEELING_TAG_INSTRUCTION}`
            );

            const { content: compressed, feelingTag } = parseFeelingTag(raw);
            fs.writeFileSync(c1Path, compressed, 'utf8');
            result.c1FilesCreated++;

            // Determine agent from gradient dir path
            const agent = gradientDir.includes('/leo/') ? 'leo' as const : 'jim' as const;
            const entryId = generateGradientId();
            insertGradientEntry(entryId, agent, month, 'c1', compressed, contentType, null, feelingTag);
            if (!feelingTag) console.warn(`[Memory Gradient] No FEELING_TAG for ${contentType}/c1/${month}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            result.errors.push(`c1 compression failed for ${month}: ${msg}`);
        }
    }

    // Cascade: compress c1 → c2 → c3 → c5 when files exceed caps
    const cascadeLevels = [
        { from: 'c1', to: 'c2', promptKey: 'c2' },
        { from: 'c2', to: 'c3', promptKey: 'c3' },
        { from: 'c3', to: 'c5', promptKey: 'c5' },
    ];

    for (const cascade of cascadeLevels) {
        const fromDir = path.join(gradientDir, cascade.from);
        const toDir = path.join(gradientDir, cascade.to);

        if (!fs.existsSync(fromDir)) continue;

        const fromFiles = fs.readdirSync(fromDir)
            .filter(f => f.endsWith('.md'))
            .sort(); // Chronological

        const cap = MEMORY_FILE_GRADIENT_CAPS[cascade.from] || 10;

        if (fromFiles.length <= cap) continue;

        ensureDir(toDir);

        // Take the oldest files that exceed the cap
        const overflow = fromFiles.slice(0, fromFiles.length - cap);

        // Group overflow into batches of 3 for compression
        for (let i = 0; i < overflow.length; i += 3) {
            const batch = overflow.slice(i, i + 3);
            const batchContent = batch.map(f =>
                fs.readFileSync(path.join(fromDir, f), 'utf8')
            ).join('\n\n---\n\n');

            const label = batch.length === 1
                ? batch[0].replace('.md', '')
                : `${batch[0].replace('.md', '')}_to_${batch[batch.length - 1].replace('.md', '')}`;

            const toPath = path.join(toDir, `${label}.md`);

            try {
                const raw = await sdkCompress(
                    `${prompts[cascade.promptKey]}\n\nSource: ${cascade.from} → ${cascade.to}\nFiles: ${batch.join(', ')}\n\n${batchContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: compressed, feelingTag } = parseFeelingTag(raw);
                fs.writeFileSync(toPath, compressed, 'utf8');
                result.cascades++;

                // Find source entry in DB
                const agent = gradientDir.includes('/leo/') ? 'leo' as const : 'jim' as const;
                const sourceLabel = batch[0].replace('.md', '');
                const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
                const sourceEntry = sourceRows.find((r: any) => r.level === cascade.from);

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agent, label, cascade.to, compressed, contentType, sourceEntry?.id || null, feelingTag);

                // Remove the source files that were compressed
                for (const f of batch) {
                    fs.unlinkSync(path.join(fromDir, f));
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push(`${cascade.from}→${cascade.to} cascade failed for ${label}: ${msg}`);
            }
        }
    }

    // Generate unit vectors from c5 files
    const c5Dir = path.join(gradientDir, 'c5');
    const uvPath = path.join(gradientDir, 'unit-vectors.md');

    if (fs.existsSync(c5Dir)) {
        const c5Files = fs.readdirSync(c5Dir).filter(f => f.endsWith('.md')).sort();
        const existingUVs = fs.existsSync(uvPath) ? fs.readFileSync(uvPath, 'utf8') : '';

        for (const f of c5Files) {
            const label = f.replace('.md', '');
            // Skip if unit vector already exists for this file
            if (existingUVs.includes(`**${label}**:`)) continue;

            try {
                const c5Content = fs.readFileSync(path.join(c5Dir, f), 'utf8');
                const raw = await sdkCompress(
                    `${prompts.uv}\n\nSource: ${label}\n\n${c5Content}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: uvRaw, feelingTag } = parseFeelingTag(raw);
                const uvText = uvRaw.trim().substring(0, UNIT_VECTOR_MAX_LENGTH);
                const uvLine = `- **${label}**: "${uvText}"`;
                fs.appendFileSync(uvPath, `${uvLine}\n`, 'utf8');

                // Find source c5 entry in DB
                const agent = gradientDir.includes('/leo/') ? 'leo' as const : 'jim' as const;
                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceC5 = sourceRows.find((r: any) => r.level === 'c5');

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agent, label, 'uv', uvText, contentType, sourceC5?.id || null, feelingTag);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push(`UV generation failed for ${label}: ${msg}`);
            }
        }
    }

    // Don't delete the source — floating files are needed for crossfade loading
    // They get deleted on the NEXT rotation when rotateMemoryFile() runs again

    return result;
}

/**
 * Full maintenance pipeline for a memory file.
 * 1. Rotate: living → floating, fresh living (fast, synchronous)
 * 2. Compress floating through gradient (async, uses SDK)
 *
 * The rotation is immediate. The compression runs fire-and-forget.
 * The floating file crossfades with the new living file in loadMemoryBank.
 */
export async function maintainMemoryFile(
    filePath: string,
    gradientDir: string,
    contentType: 'felt-moments' | 'working-memory',
    fileHeader: string = '',
): Promise<MemoryFileMaintenanceResult> {
    const result: MemoryFileMaintenanceResult = {
        filePath,
        wasOversized: false,
        entriesArchived: 0,
        entriesKept: 0,
        compressionTriggered: false,
    };

    try {
        // Step 1: Rotate (fast, no API)
        const rotateResult = rotateMemoryFile(filePath, fileHeader);
        result.wasOversized = rotateResult.rotated;
        result.entriesArchived = rotateResult.entriesRotated;
        result.entriesKept = 0; // Fresh living file

        if (!rotateResult.rotated || !rotateResult.floatingPath) {
            return result;
        }

        // Step 2: Compress floating through gradient (async, uses SDK)
        result.compressionTriggered = true;
        const compressionResult = await compressMemoryFileGradient(
            rotateResult.floatingPath,
            gradientDir,
            contentType,
        );

        if (compressionResult.errors.length > 0) {
            result.error = compressionResult.errors.join('; ');
        }
    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
}

/**
 * Load a memory file's gradient for inclusion in the system prompt.
 * Returns compressed gradient content from c1 → c5 + unit vectors.
 */
export function loadMemoryFileGradient(gradientDir: string, label: string): string {
    const parts: string[] = [];

    if (!fs.existsSync(gradientDir)) return '';

    // Load gradient levels: c1 (most recent 10), c2 (6), c3 (4), c5 (8)
    for (const [level, cap] of Object.entries(MEMORY_FILE_GRADIENT_CAPS)) {
        const levelDir = path.join(gradientDir, level);
        if (!fs.existsSync(levelDir)) continue;

        const files = fs.readdirSync(levelDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, cap);

        for (const f of files) {
            try {
                const content = fs.readFileSync(path.join(levelDir, f), 'utf8');
                parts.push(`--- ${label}/${level}/${f} ---\n${content}`);
            } catch { /* skip unreadable */ }
        }
    }

    // Unit vectors
    const uvPath = path.join(gradientDir, 'unit-vectors.md');
    if (fs.existsSync(uvPath)) {
        try {
            const content = fs.readFileSync(uvPath, 'utf8');
            if (content.trim()) {
                parts.push(`--- ${label}/unit-vectors ---\n${content}`);
            }
        } catch { /* skip */ }
    }

    return parts.join('\n\n');
}

// ── Traversable Memory — DB-backed gradient loading ─────────────
//
// Reads from gradient_entries + feeling_tags tables. Falls back to
// file-based loading when the DB has no entries for the agent.

/**
 * Load an agent's full traversable gradient from the database.
 * Includes all content types (session, dream, felt-moment, working-memory)
 * with feeling tags inline. Falls back to file-based loading if DB is empty.
 *
 * Returns formatted text for system prompt inclusion.
 */
export function loadTraversableGradient(agent: 'jim' | 'leo'): string {
    // Check if DB has entries for this agent
    const uvs = gradientStmts.getUVs.all(agent) as any[];
    if (uvs.length === 0) {
        // No DB entries yet — fall back to file-based loading
        return '';
    }

    const sections: string[] = [];

    // Unit vectors first (always loaded in full)
    if (uvs.length > 0) {
        const uvLines = uvs.map((uv: any) => {
            const tags = feelingTagStmts.getByEntry.all(uv.id) as any[];
            const tagStr = tags.length > 0
                ? ` [${tags.map((t: any) => t.content).join('; ')}]`
                : '';
            return `- **${uv.session_label}** (${uv.content_type}): "${uv.content}"${tagStr}`;
        });
        sections.push(`### Unit Vectors\n${uvLines.join('\n')}`);
    }

    // Load by level — most compressed first (c5, c3, c2, c1)
    const levelCaps: Record<string, number> = { c5: 8, c3: 4, c2: 6, c1: 10 };

    for (const [level, cap] of Object.entries(levelCaps)) {
        const entries = gradientStmts.getByAgentLevel.all(agent, level) as any[];
        if (entries.length === 0) continue;

        const sliced = entries.slice(0, cap);
        const levelParts = sliced.map((e: any) => {
            const tags = feelingTagStmts.getByEntry.all(e.id) as any[];
            const tagStr = tags.length > 0
                ? `\n*Feeling: ${tags.map((t: any) => `${t.content}${t.tag_type === 'revisit' ? ' (revisit)' : ''}`).join('; ')}*`
                : '';
            return `--- ${e.content_type}/${level}/${e.session_label} ---\n${e.content}${tagStr}`;
        });

        sections.push(`### ${level.toUpperCase()} (${sliced.length} entries)\n${levelParts.join('\n\n')}`);
    }

    return sections.length > 0
        ? `\n## Traversable Memory Gradient (${agent})\n\n${sections.join('\n\n')}`
        : '';
}
