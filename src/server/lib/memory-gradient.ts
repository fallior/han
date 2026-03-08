/**
 * Memory Gradient Compression Utility
 * Implements the overlapping fractal memory model for Jim and Leo
 * Compresses session memories across multiple fidelity levels (c1-c4)
 */

import * as fs from 'fs';
import * as path from 'path';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

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

// ── Function 1: compressToLevel ────────────────────────────────

export async function compressToLevel(
    content: string,
    fromLevel: number,
    toLevel: number,
    sessionLabel: string
): Promise<string> {
    if (fromLevel >= toLevel) {
        throw new Error(`Invalid compression direction: from=${fromLevel} to=${toLevel}`);
    }

    const levelDifference = toLevel - fromLevel;
    const compressionSteps = Array.from({ length: levelDifference }, (_, i) => fromLevel + i + 1);

    let currentContent = content;

    for (const targetLevel of compressionSteps) {
        try {
            currentContent = await sdkCompress(`Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape. You are compressing YOUR OWN memory — this is an act of identity, not summarisation.

Session: ${sessionLabel}
Compression level: ${targetLevel}

Memory to compress:

${currentContent}`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Failed to compress to level ${targetLevel} for session ${sessionLabel}: ${errorMsg}`
            );
        }
    }

    return currentContent;
}

// ── Function 2: compressToUnitVector ───────────────────────────

export async function compressToUnitVector(content: string, sessionLabel: string): Promise<string> {
    try {
        const result = await sdkCompress(`Reduce this to its irreducible kernel — one sentence, maximum 50 characters. What did this session MEAN?

Session: ${sessionLabel}

Memory:

${content}`);

        const unitVector = result.trim();

        // Enforce max length
        if (unitVector.length > UNIT_VECTOR_MAX_LENGTH) {
            return unitVector.substring(0, UNIT_VECTOR_MAX_LENGTH);
        }

        return unitVector;
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
    const sourceFiles = fs.readdirSync(memoryDir).filter((f) => {
        const parsed = f.match(/(\d{4}-\d{2}-\d{2})(-c0)?\.md$/);
        return parsed && (!parsed[2] || parsed[2] === '-c0');
    });

    result.compressionsToDo = sourceFiles.length;

    // Process each session file
    for (const sourceFile of sourceFiles) {
        const baseName = sourceFile.replace(/(-c0)?\.md$/, '');
        const sourceFilePath = path.join(memoryDir, sourceFile);

        try {
            const sourceContent = fs.readFileSync(sourceFilePath, 'utf8');

            // Determine which levels need to be compressed
            // For simplicity: always compress c0 → c1 if c1 doesn't exist
            const c1Path = path.join(fractionalDir, `${baseName}-c1.md`);
            const c1Exists = fs.existsSync(c1Path);

            if (!c1Exists) {
                const c1Content = await compressToLevel(sourceContent, 0, 1, `${agentName}/${baseName}`);

                fs.writeFileSync(c1Path, c1Content, 'utf8');

                const ratio = c1Content.length / sourceContent.length;

                result.completions.push({
                    session: baseName,
                    fromLevel: 0,
                    toLevel: 1,
                    success: true,
                    ratio,
                });

                result.totalTokensUsed += estimateTokenCount(sourceContent) + estimateTokenCount(c1Content);
            }

            // Optionally cascade to c2, c3, c4 if enabled and older sessions
            // For now, just handle c0 → c1
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            result.errors.push({
                session: baseName,
                level: 1,
                error: errorMsg,
            });
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
