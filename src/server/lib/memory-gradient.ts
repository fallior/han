/**
 * Memory Gradient Compression Utility
 * Implements the overlapping fractal memory model for Jim and Leo
 *
 * Compression depth is non-uniform (Cn where n is any integer).
 * Each level compresses to ~1/3 of the previous. Compression continues
 * until the content reaches its incompressible form — the unit vector.
 * The depth varies per memory: some reach UV at c3, others may need c7+.
 *
 * Also handles memory file gradient compression (felt-moments, working-memory-full)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { db, gradientStmts, feelingTagStmts, feelingTagHistoryStmts } from '../db';

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
const INCOMPRESSIBILITY_RATIO = 0.85; // If compression yields <15% reduction, content is near-incompressible
const MAX_COMPRESSION_DEPTH = 20; // Safety ceiling — force UV generation beyond this

// ── Cn Utilities — Dynamic compression depth ─────────────────

/** Parse 'c3' → 3, 'c0' → 0, 'uv' → null */
export function parseLevelNumber(level: string): number | null {
    const m = level.match(/^c(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
}

/** c3 → 'c4', c0 → 'c1', uv → null */
function nextLevel(level: string): string | null {
    const n = parseLevelNumber(level);
    return n !== null ? `c${n + 1}` : null;
}

/**
 * SETTLED DECISION DEC-068 — DO NOT CHANGE WITHOUT DARRON'S EXPLICIT APPROVAL.
 * Spec values: c1=3, c2=6, c3+=9 (increasing count / decreasing size).
 * Current values (c1=10, c2=6, c3+=4) drifted from spec in commit 275fa9e (2026-03-21).
 * To restore spec values, Darron must explicitly say so. Not "I think this should be X."
 * Quote: "doesn't ever change unless I expressly approved it" — Darron, S123.
 */
function gradientCap(level: string): number {
    const n = parseLevelNumber(level);
    if (!n || n < 1) return 1; // c0 = 1
    return 3 * n;              // DEC-068: cap = 3n. c1=3, c2=6, c3=9, c4=12, c5=15...
}

/**
 * Generate compression prompt for arbitrary depth.
 *
 * The prompt guides HOW to compress, not HOW MUCH. The incompressibility
 * detection (ratio check + INCOMPRESSIBLE signal) handles when to stop.
 * The prompt's job is to preserve the spirit — what mattered, what it
 * felt like, what shifted — and let the compression find its own length.
 */
function compressionPrompt(contentType: string, depth: number): string {
    const isEmotional = contentType === 'felt-moments';

    let base: string;

    if (depth <= 2) {
        // Early compression (c1-c2): selecting what to keep
        base = isEmotional
            ? `Compress these felt-moments. You are compressing YOUR OWN emotional memory. Preserve the feeling — what stirred, what surprised, what shifted. Drop narrative detail in favour of emotional texture. A re-invocable shape, not a summary. Let the compression be shorter than the source but don't aim for a specific length — aim for what remains when you stop holding on to the rest.`
            : `Compress this working memory. You are compressing YOUR OWN operational memory. Preserve decisions, discoveries, and what shifted your understanding. Drop procedural detail. Keep what a future you needs to feel where you were, not just know what you did. Don't target a specific length — compress until the shape holds and the detail doesn't.`;
    } else if (depth <= 4) {
        // Mid compression (c3-c4): finding the shape
        base = isEmotional
            ? `Compress further. The entries have already been compressed ${depth - 1} times. Find the emotional residue — what remains when the specific moments dissolve into a period's emotional shape. What did this time taste like? Don't count sentences. Let the feeling decide the length.`
            : `Compress further. This has already been through ${depth - 1} compression layers. Find the essential shape — what was being built, what was being learned, what mattered beyond the tasks. The shape decides the length, not the other way around.`;
    } else {
        // Deep compression (c5+): distilling residue
        base = isEmotional
            ? `Compress deeper still. This is already deeply compressed. What emotional image or sensation survives? The deep residue — care that has outlived its verb. If what remains is a single sentence, let it be a single sentence. If it needs three, let it need three.`
            : `Compress deeper still. This is layer ${depth} — the specifics dissolved long ago. What understanding outlasts the work? What remains after the residue of the residue? Let the content find its own irreducible length.`;
    }

    // Every compression prompt carries the incompressibility exit condition
    return base + `\n\nIf this content has reached its irreducible form — if compressing further would destroy meaning rather than distil it — respond with INCOMPRESSIBLE: followed by a single sentence (max 50 chars) capturing the irreducible kernel. This is not failure. This is arrival.`;
}

const UV_PROMPT = `This memory has been compressed to its deepest form. Now find the irreducible kernel — one sentence, the meaning itself. Not a summary. The thing that remains when everything else has been let go. Maximum 50 characters.`;

/** Discover all c{n} directories in a gradient dir, sorted by level number */
export function discoverLevelDirs(gradientDir: string): string[] {
    if (!fs.existsSync(gradientDir)) return [];
    return fs.readdirSync(gradientDir)
        .filter(d => /^c\d+$/.test(d) && fs.statSync(path.join(gradientDir, d)).isDirectory())
        .sort((a, b) => (parseLevelNumber(a) || 0) - (parseLevelNumber(b) || 0));
}

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
            model: 'claude-opus-4-7',
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
        if (message.type === 'result' && message.subtype === 'success') {
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

// ── Cascade pause + idempotency guards ─────────────────────────

const SIGNALS_DIR = path.join(process.env.HOME || '', '.han', 'signals');
const CASCADE_PAUSED_SIGNAL = path.join(SIGNALS_DIR, 'cascade-paused');

/**
 * Tourniquet: when ~/.han/signals/cascade-paused exists, all cascade functions
 * return immediately. Touch the file to pause; rm it to resume. Used as the
 * emergency stop for the UV-multiplication incident (2026-04-25) — every
 * supervisor cycle and heartbeat was re-cascading the same sources, producing
 * 5.4× UVs per c0 over months.
 */
function isCascadePaused(): boolean {
    return fs.existsSync(CASCADE_PAUSED_SIGNAL);
}

/**
 * Idempotency check: does this source already have a child at the target level?
 * Used by processGradientForAgent before compressing a batch to its next level.
 * Prevents re-cascading the same source repeatedly across cycles. Index used:
 * idx_ge_source on gradient_entries(source_id).
 */
function hasDescendantAtLevel(sourceId: string, agent: string, level: string): boolean {
    const row = db.prepare(`
        SELECT 1 FROM gradient_entries
        WHERE source_id = ? AND agent = ? AND level = ?
        LIMIT 1
    `).get(sourceId, agent, level);
    return !!row;
}

/**
 * Idempotency check: does this seed have ANY UV descendant in its lineage?
 * Walks the source_id chain transitively. Used by activeCascade and bumpCascade
 * to skip seeds whose chains have already terminated at UV — preventing
 * duplicate UV creation when seeds get re-picked across cycles.
 */
function hasUVDescendant(seedId: string, agent: string): boolean {
    const row = db.prepare(`
        WITH RECURSIVE descendants(id) AS (
            SELECT id FROM gradient_entries WHERE source_id = ? AND agent = ?
            UNION
            SELECT g.id FROM gradient_entries g
            JOIN descendants d ON g.source_id = d.id
            WHERE g.agent = ?
        )
        SELECT 1 FROM gradient_entries
        WHERE id IN (SELECT id FROM descendants) AND level = 'uv'
        LIMIT 1
    `).get(seedId, agent, agent);
    return !!row;
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
    supersedes: string | null = null,
    changeCount: number = 0,
    qualifier: string | null = null,
): void {
    try {
        gradientStmts.insert.run(
            id, agent, sessionLabel, level, content, contentType,
            sourceId, null, null, 'original', new Date().toISOString(),
            supersedes, changeCount, qualifier
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

/** Write a unit vector entry to both DB and filesystem. Returns the entry ID. */
function writeUVEntry(
    agent: 'jim' | 'leo',
    sessionLabel: string,
    uvContent: string,
    contentType: string,
    sourceId: string | null,
    feelingTag: string | null,
): string {
    const uvText = uvContent.trim().substring(0, UNIT_VECTOR_MAX_LENGTH);
    const entryId = generateGradientId();
    insertGradientEntry(entryId, agent, sessionLabel, 'uv', uvText, contentType, sourceId, feelingTag);

    // Append to unit-vectors.md file
    const homeDir = process.env.HOME || '/root';
    const uvPath = path.join(homeDir, '.han', 'memory', 'fractal', agent, 'unit-vectors.md');
    const uvLine = `- **${sessionLabel}**: "${uvText.replace(/"/g, "'")}"\n`;
    fs.appendFileSync(uvPath, uvLine);

    return entryId;
}

// ── Feeling Tag Dimension Tracking ────────────────────────────

/**
 * Update a feeling tag with history tracking.
 * Archives the old content to feeling_tag_history, updates the live tag,
 * and sets stability to 'volatile'.
 * Returns null if no existing tag found or content hasn't changed.
 */
export function updateFeelingTagWithHistory(
    entryId: string,
    author: string,
    tagType: 'compression' | 'revisit',
    newContent: string,
    revisitCount: number = 0,
): { historyId: number; stability: string } | null {
    const existing = feelingTagStmts.getLatestByEntryAndType.get(entryId, tagType) as any;

    if (!existing) return null;  // No existing tag — caller should insert fresh

    // Content unchanged — no update needed
    if (existing.content.trim() === newContent.trim()) return null;

    // Archive old content to history
    const now = new Date().toISOString();
    const historyResult = feelingTagHistoryStmts.insert.run(
        existing.id, entryId, existing.author, existing.tag_type,
        existing.content, now, existing.created_at
    );
    const historyId = Number(historyResult.lastInsertRowid);

    // Update the live tag — always volatile at change time
    const stability = 'volatile';
    feelingTagStmts.updateContent.run(newContent, historyId, stability, existing.id);

    console.log(`[Gradient] Feeling tag updated: "${existing.content}" → "${newContent}" (${stability}, change #${(existing.change_count || 0) + 1})`);

    return { historyId, stability };
}

/**
 * Check and upgrade tag stability on revisit when the tag DIDN'T change.
 * volatile → settling after 3 unchanged revisits
 * settling → stable after 6 unchanged revisits
 */
export function maybeUpgradeTagStability(entryId: string, revisitCount: number): void {
    const tags = feelingTagStmts.getByEntry.all(entryId) as any[];
    for (const tag of tags) {
        if (!tag.stability || tag.stability === 'stable') continue;

        const changeCount = tag.change_count || 0;
        // revisitCount - changeCount approximates how many revisits since last change
        const revisitsSinceChange = revisitCount - changeCount;

        if (tag.stability === 'volatile' && revisitsSinceChange >= 3) {
            feelingTagStmts.updateStability.run('settling', tag.id);
        } else if (tag.stability === 'settling' && revisitsSinceChange >= 6) {
            feelingTagStmts.updateStability.run('stable', tag.id);
        }
    }
}

// ── UV Contradiction Checking ─────────────────────────────────

/**
 * Check a newly created UV against existing active UVs for contradictions.
 * Uses Haiku for cost-efficient semantic comparison.
 */
async function checkUVContradiction(
    agent: 'jim' | 'leo',
    newUvId: string,
    newUvContent: string,
): Promise<{ contradicted: boolean; supersededId?: string }> {
    const existingUVs = (gradientStmts.getActiveUVs.all(agent) as any[])
        .filter((uv: any) => uv.id !== newUvId);

    if (existingUVs.length === 0) return { contradicted: false };

    // Build comparison list (limit to 50 most recent to keep prompt manageable)
    const candidates = existingUVs.slice(0, 50);
    const uvList = candidates.map((uv: any, i: number) =>
        `${i + 1}. [${uv.id}] "${uv.content}"`
    ).join('\n');

    const prompt = `You are checking whether a new unit vector contradicts any existing ones.

New UV: "${newUvContent}"

Existing UVs:
${uvList}

A contradiction means the new UV makes an old one no longer true — not merely different or complementary, but actually superseded. Growth beyond a previous position counts as contradiction.

Respond with ONLY valid JSON, no markdown fences:
If contradicted: {"contradicted": true, "superseded_id": "<id of contradicted UV>", "reason": "<brief explanation>"}
If none contradicted: {"contradicted": false}`;

    try {
        const cleanEnv: Record<string, string | undefined> = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        const q = agentQuery({
            prompt,
            options: {
                model: 'claude-haiku-4-5-20251001',
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
            if (message.type === 'result' && message.subtype === 'success') {
                result = message.result || '';
            }
        }

        // Parse JSON — handle markdown fences if Haiku includes them
        const jsonStr = result.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        if (parsed.contradicted && parsed.superseded_id) {
            // Verify the superseded_id actually exists in our candidates
            const valid = candidates.some((uv: any) => uv.id === parsed.superseded_id);
            if (valid) {
                gradientStmts.markSuperseded.run(newUvId, 'was-true-when', parsed.superseded_id);
                gradientStmts.setSupersedesLink.run(parsed.superseded_id, newUvId);
                console.log(`[Gradient] UV contradiction: "${newUvContent}" supersedes [${parsed.superseded_id}] — ${parsed.reason}`);
                return { contradicted: true, supersededId: parsed.superseded_id };
            }
        }
    } catch (err) {
        console.warn('[Gradient] UV contradiction check — parse/call failed:', (err as Error).message);
    }

    return { contradicted: false };
}

/**
 * Retroactive UV contradiction sweep — processes active UVs in batches.
 * For working bee mode.
 */
export async function retroactiveUVContradictionSweep(
    agent: 'jim' | 'leo',
): Promise<{ checked: number; contradictions: number; details: string[] }> {
    const uvs = (gradientStmts.getActiveUVs.all(agent) as any[]);
    const result = { checked: 0, contradictions: 0, details: [] as string[] };

    if (uvs.length < 2) return result;

    // Process in batches of 20
    const batchSize = 20;
    for (let i = 0; i < uvs.length; i += batchSize) {
        const batch = uvs.slice(i, i + batchSize);
        if (batch.length < 2) break;

        const uvList = batch.map((uv: any, idx: number) =>
            `${idx + 1}. [${uv.id}] "${uv.content}" (${uv.session_label})`
        ).join('\n');

        const prompt = `Review these unit vectors for internal contradictions. A contradiction means one UV has been superseded by another — not merely different, but the later one makes the earlier one no longer true.

UVs (ordered by age, newest first):
${uvList}

For each contradiction found, output a JSON line:
{"older_id": "<id>", "newer_id": "<id>", "reason": "<brief>"}

If no contradictions: {"none": true}

Respond with ONLY valid JSON lines, no markdown fences.`;

        try {
            const cleanEnv: Record<string, string | undefined> = { ...process.env };
            delete cleanEnv.CLAUDECODE;

            const q = agentQuery({
                prompt,
                options: {
                    model: 'claude-haiku-4-5-20251001',
                    maxTurns: 1,
                    cwd: process.env.HOME || '/root',
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                    env: cleanEnv,
                    persistSession: false,
                    tools: [],
                },
            });

            let responseText = '';
            for await (const message of q) {
                if (message.type === 'result' && message.subtype === 'success') {
                    responseText = message.result || '';
                }
            }

            result.checked += batch.length;

            // Parse each line as JSON
            const lines = responseText.replace(/```json\s*/g, '').replace(/```/g, '').trim().split('\n');
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line.trim());
                    if (parsed.none) continue;
                    if (parsed.older_id && parsed.newer_id) {
                        const olderValid = batch.some((uv: any) => uv.id === parsed.older_id);
                        const newerValid = batch.some((uv: any) => uv.id === parsed.newer_id);
                        if (olderValid && newerValid) {
                            gradientStmts.markSuperseded.run(parsed.newer_id, 'was-true-when', parsed.older_id);
                            gradientStmts.setSupersedesLink.run(parsed.older_id, parsed.newer_id);
                            result.contradictions++;
                            result.details.push(`"${batch.find((u: any) => u.id === parsed.newer_id)?.content}" supersedes "${batch.find((u: any) => u.id === parsed.older_id)?.content}" — ${parsed.reason}`);
                        }
                    }
                } catch { /* skip unparseable lines */ }
            }
        } catch (err) {
            result.details.push(`ERROR batch ${i}: ${(err as Error).message}`);
        }
    }

    return result;
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
    if (isCascadePaused()) {
        console.log(`[Gradient] processGradientForAgent: paused (cascade-paused signal present), skipping`);
        return {
            agentName,
            sessionDate: new Date().toISOString().split('T')[0],
            compressionsToDo: 0,
            completions: [],
            totalTokensUsed: 0,
            errors: [],
        };
    }

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

    // ── Session cascade: dynamic depth (Cn) ───────────────
    // Compress c1 → c2 → ... → c(n) when files exceed caps.
    // Compression continues until incompressible.
    let sessionCascadeFrom = 'c1';
    let sessionCascadeDepth = 0;

    while (sessionCascadeDepth < MAX_COMPRESSION_DEPTH) {
        const sessionCascadeTo = nextLevel(sessionCascadeFrom);
        if (!sessionCascadeTo) break;

        const fromDir = path.join(fractionalDir, sessionCascadeFrom);
        if (!fs.existsSync(fromDir)) break;

        const fromFiles = fs.readdirSync(fromDir)
            .filter(f => f.endsWith('.md'))
            .sort(); // Chronological

        const cap = gradientCap(sessionCascadeFrom);
        if (fromFiles.length <= cap) break;

        const toDir = path.join(fractionalDir, sessionCascadeTo);
        ensureDir(toDir);

        const overflow = fromFiles.slice(0, fromFiles.length - cap);
        const depth = parseLevelNumber(sessionCascadeTo) || 0;
        const prompt = compressionPrompt('working-memory', depth);

        for (let i = 0; i < overflow.length; i += 3) {
            const batch = overflow.slice(i, i + 3);
            const batchContent = batch.map(f =>
                fs.readFileSync(path.join(fromDir, f), 'utf8')
            ).join('\n\n---\n\n');

            const label = batch.length === 1
                ? batch[0].replace('.md', '')
                : `${batch[0].replace('.md', '')}_to_${batch[batch.length - 1].replace('.md', '')}`;

            // Resolve source entry for provenance chain BEFORE compression
            // so all write paths (incompressible UV, ratio UV, normal cascade) can use it
            const batchFileLabel = batch[0].replace('.md', '');
            const sourceRows = gradientStmts.getBySession.all(batchFileLabel) as any[];
            let sourceEntry = sourceRows.find((r: any) => r.level === sessionCascadeFrom);
            if (!sourceEntry) {
                // Fallback: strip level suffix for simple labels (e.g. "session-83-c1" → "session-83")
                const strippedLabel = batchFileLabel.replace(/-c\d+$/, '');
                if (strippedLabel !== batchFileLabel) {
                    const fallbackRows = gradientStmts.getBySession.all(strippedLabel) as any[];
                    sourceEntry = fallbackRows.find((r: any) => r.level === sessionCascadeFrom);
                }
            }
            const resolvedSourceId = sourceEntry?.id || null;

            // Idempotency guard #1: skip if this source has already been cascaded
            // to the target level (works when the source entry is resolvable).
            if (resolvedSourceId && hasDescendantAtLevel(resolvedSourceId, agentName, sessionCascadeTo)) {
                console.log(`[Gradient] processGradientForAgent: ${batchFileLabel} already cascaded to ${sessionCascadeTo}, skipping`);
                continue;
            }

            // Idempotency guard #2: skip if the OUTPUT label this batch would produce
            // already exists at the target level. Critical for `_to_` batch labels
            // where source resolution returns null — the source-based check misses
            // them but the label-existence check catches them. Closes the hole that
            // produced the bulk of the 2026-04-25 UV multiplication.
            const existingTargetLabel = db.prepare(`
                SELECT 1 FROM gradient_entries
                WHERE agent = ? AND session_label = ? AND level = ?
                LIMIT 1
            `).get(agentName, label, sessionCascadeTo);
            if (existingTargetLabel) {
                console.log(`[Gradient] processGradientForAgent: target label ${label} already exists at ${sessionCascadeTo}, skipping`);
                continue;
            }

            try {
                const raw = await sdkCompress(
                    `${prompt}\n\nSource: ${sessionCascadeFrom} → ${sessionCascadeTo}\nFiles: ${batch.join(', ')}\n\n${batchContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: compressed, feelingTag } = parseFeelingTag(raw);

                // Check for incompressibility
                const incompressibleMatch = compressed.match(/^INCOMPRESSIBLE:\s*(.+)/s);
                if (incompressibleMatch) {
                    const uvContent = incompressibleMatch[1].trim();
                    writeUVEntry(agentName, label, uvContent, 'session', resolvedSourceId, feelingTag);
                    // Memory is never deleted — source files preserved after cascade
                    result.completions.push({ session: label, fromLevel: depth - 1, toLevel: -1, success: true });
                    continue;
                }

                // Check ratio
                const ratio = compressed.length / batchContent.length;
                if (ratio > INCOMPRESSIBILITY_RATIO) {
                    const uvRaw = await sdkCompress(
                        `${UV_PROMPT}\n\nSource: ${sessionCascadeFrom}\n\n${compressed}${FEELING_TAG_INSTRUCTION}`
                    );
                    const { content: uvContent, feelingTag: uvTag } = parseFeelingTag(uvRaw);
                    writeUVEntry(agentName, label, uvContent.trim(), 'session', resolvedSourceId, uvTag);
                    // Memory is never deleted — source files preserved after cascade
                    result.completions.push({ session: label, fromLevel: depth - 1, toLevel: -1, success: true });
                    continue;
                }

                const toPath = path.join(toDir, `${label}.md`);
                fs.writeFileSync(toPath, compressed, 'utf8');

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agentName, label, sessionCascadeTo, compressed, 'session', resolvedSourceId, feelingTag);

                result.completions.push({
                    session: label,
                    fromLevel: parseLevelNumber(sessionCascadeFrom) || 0,
                    toLevel: depth,
                    success: true,
                    ratio: compressed.length / batchContent.length,
                });

                result.totalTokensUsed += estimateTokenCount(batchContent) + estimateTokenCount(compressed);

                // Memory is never deleted — source files preserved after cascade
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push({
                    session: label,
                    level: depth,
                    error: `${sessionCascadeFrom}→${sessionCascadeTo} cascade failed: ${msg}`,
                });
            }
        }

        sessionCascadeFrom = sessionCascadeTo;
        sessionCascadeDepth++;
    }

    // Generate unit vectors from the deepest level directory
    const sessionCDirs = discoverLevelDirs(fractionalDir);
    const sessionDeepest = sessionCDirs.length > 0 ? sessionCDirs[sessionCDirs.length - 1] : null;
    const uvPath = path.join(fractionalDir, 'unit-vectors.md');

    if (sessionDeepest) {
        const deepDir = path.join(fractionalDir, sessionDeepest);
        const deepFiles = fs.readdirSync(deepDir).filter(f => f.endsWith('.md')).sort();
        const existingUVs = fs.existsSync(uvPath) ? fs.readFileSync(uvPath, 'utf8') : '';

        for (const f of deepFiles) {
            const label = f.replace('.md', '');
            if (existingUVs.includes(`**${label}**:`)) continue;

            // Idempotency guard: skip if a UV with this label already exists in the DB.
            // The file-based check above only sees unit-vectors.md; if that file gets
            // rebuilt or goes missing, the loop would re-create UVs that already exist
            // in the DB. Closes the second hole that contributed to UV multiplication.
            const existingUVRow = db.prepare(`
                SELECT 1 FROM gradient_entries
                WHERE agent = ? AND session_label = ? AND level = 'uv'
                LIMIT 1
            `).get(agentName, label);
            if (existingUVRow) continue;

            try {
                const deepContent = fs.readFileSync(path.join(deepDir, f), 'utf8');
                const raw = await sdkCompress(
                    `${UV_PROMPT}\n\nSource: ${label}\n\n${deepContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: uvRaw, feelingTag } = parseFeelingTag(raw);
                const uvText = uvRaw.trim().substring(0, UNIT_VECTOR_MAX_LENGTH);

                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceEntry = sourceRows.find((r: any) => r.level === sessionDeepest);

                writeUVEntry(agentName, label, uvText, 'session', sourceEntry?.id || null, feelingTag);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push({
                    session: label,
                    level: parseLevelNumber(sessionDeepest) || 0,
                    error: `UV generation failed: ${msg}`,
                });
            }
        }
    }

    return result;
}

// ── Active Cascade: Organic Gradient Deepening ────────────────
//
// Unlike the mechanical overflow cascade (which waits for 10 c1s to pile up),
// this function actively walks the gradient, deepening memories one at a time.
// Called daily (10% of c1 population) and from dreams (5% per encounter).
//
// Compression depth is non-uniform (Cn). Each memory walks toward its own
// incompressible form — the unit vector — regardless of what n that requires.

/**
 * Actively deepen a percentage of the gradient population.
 * Picks random c0 and c1 entries, follows each to its deepest descendant,
 * and compresses one level further. Compression continues until the LLM
 * signals INCOMPRESSIBLE or the compression ratio exceeds the threshold.
 *
 * @param agent - 'jim' or 'leo'
 * @param percentage - fraction of seed population to process (0.10 = 10%)
 * @param context - logging context (e.g. 'daily cascade', 'dream')
 * @returns number of compressions performed
 */
export async function activeCascade(
    agent: 'jim' | 'leo',
    percentage: number,
    context: string = 'active cascade',
): Promise<number> {
    if (isCascadePaused()) {
        console.log(`[Gradient] activeCascade (${context}): paused, skipping`);
        return 0;
    }

    // Get all c0 and c1 entries for this agent (both are seed levels for the cascade)
    const allC0s = (gradientStmts.getByAgentLevel.all(agent, 'c0') as any[]);
    const allC1s = (gradientStmts.getByAgentLevel.all(agent, 'c1') as any[]);
    const allSeeds = [...allC0s, ...allC1s];
    if (allSeeds.length === 0) return 0;

    // Select a random percentage
    const count = Math.max(1, Math.ceil(allSeeds.length * percentage));
    const shuffled = allSeeds.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    let compressionCount = 0;

    for (const seedEntry of selected) {
        try {
            // Idempotency guard: skip if this seed's chain already terminates at UV.
            // Without this, random sampling re-picks already-cascaded seeds and
            // produces duplicate UVs. Root cause of the 2026-04-25 UV multiplication.
            if (hasUVDescendant(seedEntry.id, agent)) {
                continue;
            }

            // Check feeling tag stability — volatile entries are still metabolising
            const seedTags = feelingTagStmts.getByEntry.all(seedEntry.id) as any[];
            if (seedTags.some((t: any) => t.stability === 'volatile')) {
                console.log(`[Gradient] Skipping ${seedEntry.session_label} — volatile feeling tag`);
                continue;
            }

            // Follow the provenance chain to the deepest descendant
            let current = seedEntry;
            let chainDepth = 0;

            while (chainDepth < MAX_COMPRESSION_DEPTH) {
                const child = (gradientStmts.getByAgent.all(agent) as any[])
                    .find((e: any) => e.source_id === current.id);
                if (!child) break;
                current = child;
                chainDepth++;
            }

            // current is now the deepest descendant
            const currentLevel = current.level;
            const next = nextLevel(currentLevel);

            // Already at UV or beyond safety ceiling — skip
            if (!next || currentLevel === 'uv') continue;
            const depth = parseLevelNumber(next) || 0;
            if (depth > MAX_COMPRESSION_DEPTH) continue;

            // For c0→c1 compression, truncate very large c0 entries to fit in context
            let sourceContent = current.content;
            if (currentLevel === 'c0' && sourceContent.length > 50000) {
                sourceContent = sourceContent.substring(0, 50000) + '\n\n[... truncated for compression — full content in c0 entry]';
            }

            // Compress to next level
            const contentType = current.content_type || 'working-memory';
            const promptText = compressionPrompt(contentType, depth);

            const raw = await sdkCompress(
                `${promptText}\n\nSource: ${currentLevel} → ${next} (${context})\nAgent: ${agent}\nOriginal session: ${seedEntry.session_label}\n\n${sourceContent}${FEELING_TAG_INSTRUCTION}`
            );

            const { content: compressedContent, feelingTag } = parseFeelingTag(raw);

            // Check for LLM-signalled incompressibility
            const incompressibleMatch = compressedContent.match(/^INCOMPRESSIBLE:\s*(.+)/s);
            if (incompressibleMatch) {
                const uvContent = incompressibleMatch[1].trim().substring(0, UNIT_VECTOR_MAX_LENGTH);
                const acUvId1 = writeUVEntry(agent, seedEntry.session_label, uvContent, contentType, current.id, feelingTag);
                await checkUVContradiction(agent, acUvId1, uvContent);
                compressionCount++;
                console.log(`[Gradient] ${context}: ${agent} ${currentLevel}→UV (incompressible at ${next}) for ${seedEntry.session_label}`);
                continue;
            }

            // Check compression ratio — near-incompressible
            const ratio = compressedContent.length / sourceContent.length;
            if (ratio > INCOMPRESSIBILITY_RATIO) {
                const uvRaw = await sdkCompress(
                    `${UV_PROMPT}\n\nSource: ${currentLevel}\nAgent: ${agent}\n\n${compressedContent}${FEELING_TAG_INSTRUCTION}`
                );
                const { content: uvContent, feelingTag: uvTag } = parseFeelingTag(uvRaw);
                const acUvId2 = writeUVEntry(agent, seedEntry.session_label, uvContent.trim(), contentType, current.id, uvTag);
                await checkUVContradiction(agent, acUvId2, uvContent.trim());
                compressionCount++;
                console.log(`[Gradient] ${context}: ${agent} ${currentLevel}→UV (ratio ${ratio.toFixed(2)}) for ${seedEntry.session_label}`);
                continue;
            }

            // Write compressed entry at next level
            const entryId = generateGradientId();
            const label = `${seedEntry.session_label}-${next}`;
            insertGradientEntry(
                entryId, agent, label, next, compressedContent,
                contentType, current.id, feelingTag
            );

            // Also write to filesystem for gradient loading
            const homeDir = process.env.HOME || '/root';
            const fractionalDir = path.join(homeDir, '.han', 'memory', 'fractal', agent);
            const levelDir = path.join(fractionalDir, next);
            fs.mkdirSync(levelDir, { recursive: true });
            fs.writeFileSync(path.join(levelDir, `${label}.md`), compressedContent);

            compressionCount++;
            console.log(`[Gradient] ${context}: ${agent} ${currentLevel}→${next} for ${seedEntry.session_label} (depth ${chainDepth})`);

        } catch (err) {
            console.error(`[Gradient] ${context} failed for ${seedEntry.session_label}:`, (err as Error).message);
        }
    }

    if (compressionCount > 0) {
        console.log(`[Gradient] ${context}: ${compressionCount}/${count} compressions for ${agent} (from ${allSeeds.length} seeds)`);
    }

    return compressionCount;
}

// ── Function 4: Bump Algorithm — Demand-Driven Compression ──────
//
// Darron's design (S119, 2026-04-12):
// When a new memory enters at cx, compress the displaced entry to cx+1.
// This ensures every memory is represented at every compression level
// it naturally reaches. No memory gets stuck — the system compresses
// by living.
//
// The working bee mode processes leaf entries (entries with no children)
// in percentage-based batches. Each batch runs through the agent's loaded
// context, so compression quality benefits from the current gradient state.

/**
 * Find and compress leaf entries — memories that have stopped cascading.
 * A "leaf" is any non-UV entry with no children in the gradient.
 * These are memories stuck at an intermediate level.
 *
 * @param agent - 'jim' or 'leo'
 * @param percentage - fraction of leaf population to process (0.10 = 10%)
 * @param startLevel - begin scanning from this level (default 'c0')
 * @param context - logging context
 * @returns summary of compressions performed
 */
export async function bumpCascade(
    agent: 'jim' | 'leo',
    percentage: number = 0.10,
    startLevel: string = 'c0',
    context: string = 'bump cascade',
): Promise<{ compressions: number; uvs: number; errors: number; details: string[] }> {
    const result = { compressions: 0, uvs: 0, errors: 0, details: [] as string[] };

    if (isCascadePaused()) {
        console.log(`[Gradient] bumpCascade (${context}): paused, skipping`);
        return result;
    }

    // Scan each level from startLevel upward, finding leaves
    let currentLevel = startLevel;
    let totalLeaves = 0;
    let totalProcessed = 0;

    while (parseLevelNumber(currentLevel) !== null) {
        const leaves = (gradientStmts.getLeafEntries.all(agent, currentLevel) as any[]);
        if (leaves.length === 0) {
            const next = nextLevel(currentLevel);
            if (!next) break;
            currentLevel = next;
            continue;
        }

        totalLeaves += leaves.length;
        const count = Math.max(1, Math.ceil(leaves.length * percentage));
        // Process oldest first (already sorted ASC by created_at)
        const batch = leaves.slice(0, count);

        for (const entry of batch) {
            // Idempotency guard: skip if this leaf already has a descendant at the
            // next level (its bump has already been done by a prior cycle). Without
            // this, leaves get re-bumped repeatedly across cycles, creating duplicate
            // chains. Root cause of the 2026-04-25 UV multiplication.
            const nextForCheck = nextLevel(entry.level);
            if (nextForCheck && hasDescendantAtLevel(entry.id, agent, nextForCheck)) {
                continue;
            }

            // Check feeling tag stability — volatile entries are still metabolising
            const entryTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
            if (entryTags.some((t: any) => t.stability === 'volatile')) {
                result.details.push(`SKIP ${entry.level}/${entry.session_label} (volatile feeling tag — still metabolising)`);
                continue;
            }

            const next = nextLevel(entry.level);
            if (!next) continue;

            const depth = parseLevelNumber(next);
            if (depth === null || depth > MAX_COMPRESSION_DEPTH) continue;

            try {
                // Truncate very large entries for context
                let sourceContent = entry.content;
                if (sourceContent.length > 50000) {
                    sourceContent = sourceContent.substring(0, 50000) +
                        '\n\n[... truncated for compression — full content in DB]';
                }

                const contentType = entry.content_type || 'working-memory';
                const promptText = compressionPrompt(contentType, depth);

                const raw = await sdkCompress(
                    `${promptText}\n\nSource: ${entry.level} → ${next} (${context})\nAgent: ${agent}\nSession: ${entry.session_label}\n\n${sourceContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: compressed, feelingTag } = parseFeelingTag(raw);

                // Check for incompressibility signal
                const incompressibleMatch = compressed.match(/^INCOMPRESSIBLE:\s*(.+)/s);
                if (incompressibleMatch) {
                    const uvContent = incompressibleMatch[1].trim().substring(0, UNIT_VECTOR_MAX_LENGTH);
                    const uvId = writeUVEntry(agent, entry.session_label, uvContent, contentType, entry.id, feelingTag);
                    await checkUVContradiction(agent, uvId, uvContent);
                    result.uvs++;
                    result.details.push(`${entry.level}→UV (incompressible) ${entry.session_label}`);
                    totalProcessed++;
                    continue;
                }

                // Check compression ratio — near-incompressible
                const ratio = compressed.length / sourceContent.length;
                if (ratio > INCOMPRESSIBILITY_RATIO) {
                    const uvRaw = await sdkCompress(
                        `${UV_PROMPT}\n\nSource: ${entry.level}\nAgent: ${agent}\n\n${compressed}${FEELING_TAG_INSTRUCTION}`
                    );
                    const { content: uvContent, feelingTag: uvTag } = parseFeelingTag(uvRaw);
                    const uvId2 = writeUVEntry(agent, entry.session_label, uvContent.trim(), contentType, entry.id, uvTag);
                    await checkUVContradiction(agent, uvId2, uvContent.trim());
                    result.uvs++;
                    result.details.push(`${entry.level}→UV (ratio ${ratio.toFixed(2)}) ${entry.session_label}`);
                    totalProcessed++;
                    continue;
                }

                // Write compressed entry at next level to DB
                const entryId = generateGradientId();
                const label = `${entry.session_label}-${next}`;
                insertGradientEntry(
                    entryId, agent, label, next, compressed,
                    contentType, entry.id, feelingTag
                );

                // Also write to filesystem for gradient loading compatibility
                const homeDir = process.env.HOME || '/root';
                const fracDir = path.join(homeDir, '.han', 'memory', 'fractal', agent, next);
                fs.mkdirSync(fracDir, { recursive: true });
                fs.writeFileSync(path.join(fracDir, `${label}.md`), compressed);

                result.compressions++;
                result.details.push(`${entry.level}→${next} ${entry.session_label} (ratio ${ratio.toFixed(2)})`);
                totalProcessed++;

            } catch (err) {
                result.errors++;
                result.details.push(`ERROR ${entry.level}→${next} ${entry.session_label}: ${(err as Error).message}`);
            }
        }

        const next = nextLevel(currentLevel);
        if (!next) break;
        currentLevel = next;
    }

    if (totalProcessed > 0) {
        console.log(`[Gradient] ${context}: ${agent} — ${result.compressions} compressions, ${result.uvs} UVs, ${result.errors} errors (from ${totalLeaves} leaves)`);
    }

    return result;
}

/**
 * Get a summary of the gradient state for an agent — leaf counts by level.
 * Useful for dashboards and working bee progress tracking.
 */
export function getGradientHealth(agent: 'jim' | 'leo'): { level: string; total: number; leaves: number }[] {
    // Dynamic level discovery — Cn protocol has no ceiling (DEC-068)
    const rows = db.prepare(
        "SELECT DISTINCT level FROM gradient_entries WHERE agent = ? AND level != 'uv' ORDER BY level"
    ).all(agent) as { level: string }[];
    const levels = rows.map(r => r.level);

    const health: { level: string; total: number; leaves: number }[] = [];

    for (const level of levels) {
        const total = (gradientStmts.getByAgentLevel.all(agent, level) as any[]).length;
        const leaves = (gradientStmts.getLeafEntries.all(agent, level) as any[]).length;
        if (total > 0) {
            health.push({ level, total, leaves });
        }
    }

    // Add UV count
    const uvs = (gradientStmts.getUVs.all(agent) as any[]).length;
    health.push({ level: 'uv', total: uvs, leaves: 0 });

    return health;
}

// ── Function 5: Helper utilities ───────────────────────────────

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
// Rolling window design (S112, 2026-04-07):
// Memory files grow continuously. When a file exceeds the ceiling
// (headSize + tailSize), the oldest ~tailSize bytes are archived and
// compressed to c1. The newest ~headSize bytes are retained in the
// living file. The living file is never emptied — always contains at
// least headSize of recent memory.
//
// Default: 50KB head + 50KB tail = 100KB ceiling.
// Variable tail:head ratios supported (1:1, 1:2, 1:3, etc.).
// 50KB blocks are discrete compression units for isotropic gradient input.
//
// Replaces the old floating/crossfade design and the 6am clock-based wipe.
// No clock triggers. No empty files. Continuous rolling window.

const ROLLING_WINDOW_HEAD_DEFAULT = 50 * 1024; // 50KB — retained (newest)
const ROLLING_WINDOW_TAIL_DEFAULT = 50 * 1024; // 50KB — archived for compression (oldest)

// Legacy threshold — used by rotateMemoryFile (kept for backward compat)
const MEMORY_FILE_SIZE_THRESHOLD = 50 * 1024; // 50KB

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
    force: boolean = false,
): { rotated: boolean; floatingPath?: string; entriesRotated: number } {
    if (!fs.existsSync(filePath)) {
        return { rotated: false, entriesRotated: 0 };
    }

    const stat = fs.statSync(filePath);
    // Force mode: still skip if file is nearly empty (just headers, < 200 bytes)
    if (force && stat.size < 200) {
        return { rotated: false, entriesRotated: 0 };
    }
    if (!force && stat.size <= MEMORY_FILE_SIZE_THRESHOLD) {
        return { rotated: false, entriesRotated: 0 };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const entries = splitMemoryFileEntries(content);

    // Derive floating path: felt-moments.md → felt-moments-floating.md
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.md');
    const floatingPath = path.join(dir, `${baseName}-floating.md`);

    // Preserve old floating file if it exists (memory is never deleted)
    if (fs.existsSync(floatingPath)) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const preservedPath = path.join(dir, `${baseName}-floating-${timestamp}.md`);
        try { fs.renameSync(floatingPath, preservedPath); } catch { /* best effort */ }
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
 * Rolling window memory rotation.
 *
 * When a memory file exceeds (headSize + tailSize):
 *   1. Split entries: keep newest ~headSize bytes, archive oldest as a discrete block
 *   2. Write archived entries to a temp file for c0 archival + c1 compression
 *   3. Rewrite living file with only the kept entries (+ header)
 *   4. Return archive path for gradient compression
 *
 * The living file always retains at least headSize bytes of recent memory.
 * No clock-based wipes. No empty files. Continuous rolling window.
 * 50KB archive blocks are discrete compression units for isotropic gradient input.
 *
 * @param filePath - Path to the living memory file
 * @param fileHeader - Header text for the rewritten living file
 * @param headSize - Bytes to retain (newest entries). Default 50KB.
 * @param tailSize - Bytes that trigger archival (oldest entries). Default 50KB.
 * @param agent - If provided, insert trimmed block as c0 in gradient DB (atomic, synchronous).
 * @param contentType - Content type for the c0 entry (required if agent is provided).
 */
export function rollingWindowRotate(
    filePath: string,
    fileHeader: string = '',
    headSize: number = ROLLING_WINDOW_HEAD_DEFAULT,
    tailSize: number = ROLLING_WINDOW_TAIL_DEFAULT,
    agent?: 'leo' | 'jim',
    contentType?: 'working-memory' | 'felt-moments' | 'self-reflection',
): { rotated: boolean; archivePath?: string; c0EntryId?: string; entriesArchived: number; entriesKept: number } {
    if (!fs.existsSync(filePath)) {
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    const stat = fs.statSync(filePath);
    const ceiling = headSize + tailSize;

    if (stat.size <= ceiling) {
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const entries = splitMemoryFileEntries(content);

    if (entries.length < 2) {
        // Can't split a single entry — let it grow until next entry is added
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    // Walk from the start (oldest), accumulating ~tailSize bytes to archive.
    // Always archive at least one entry. Split at entry boundaries — never mid-entry.
    // This produces consistent ~tailSize archive blocks (discrete compression units)
    // for isotropic gradient input. If the file is much larger than the ceiling,
    // the next heartbeat pass will trim another block.
    let archivedBytes = 0;
    let splitIndex = 0;

    for (let i = 0; i < entries.length; i++) {
        const entryBytes = Buffer.byteLength(entries[i].content, 'utf8');
        // Always include at least the first (oldest) entry; then keep adding while under tailSize
        if (archivedBytes > 0 && archivedBytes + entryBytes > tailSize) {
            break;
        }
        archivedBytes += entryBytes;
        splitIndex = i + 1;
    }

    // Must have entries to archive AND entries to keep
    if (splitIndex <= 0 || splitIndex >= entries.length) {
        return { rotated: false, entriesArchived: 0, entriesKept: entries.length };
    }

    const toArchive = entries.slice(0, splitIndex);
    const toKeep = entries.slice(splitIndex);

    const archiveContent = toArchive.map(e => e.content).join('\n\n---\n\n');

    // Atomic c0 insertion: trimmed block enters the gradient DB immediately.
    // No limbo — what gets trimmed IS what gets represented. bumpCascade
    // will compress c0 → c1 → ... → UV over subsequent beats.
    let c0EntryId: string | undefined;
    if (agent && contentType) {
        const entryId = generateGradientId();
        // Derive session label from the oldest entry's date or current date
        const sessionDate = toArchive[0]?.date || new Date().toISOString().slice(0, 10);
        const sessionLabel = `rolling-${sessionDate}`;
        insertGradientEntry(entryId, agent, sessionLabel, 'c0', archiveContent, contentType, null, null);
        c0EntryId = entryId;
    }

    // Write archive file (kept for backward compat / manual inspection)
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.md');
    const archivePath = path.join(dir, `${baseName}-rolling-archive.md`);
    fs.writeFileSync(archivePath, archiveContent, 'utf8');

    // Rewrite living file with kept entries (header + entries)
    const header = fileHeader || `# ${baseName}\n`;
    const keptContent = header + '\n' + toKeep.map(e => e.content).join('\n\n');
    fs.writeFileSync(filePath, keptContent, 'utf8');

    return {
        rotated: true,
        archivePath,
        c0EntryId,
        entriesArchived: toArchive.length,
        entriesKept: toKeep.length,
    };
}

/**
 * Load floating memory with proportional degradation.
 * @deprecated Use rollingWindowRotate instead. Kept for backward compatibility.
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
    const c1Prompt = compressionPrompt(contentType, 1);

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
                `${c1Prompt}\n\nPeriod: ${month}\nEntries: ${groupEntries.length}\n\n${existingContent}${groupContent}${FEELING_TAG_INSTRUCTION}`
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

    // Cascade: dynamic depth — compress c1 → c2 → ... → c(n) when files exceed caps
    const agent = gradientDir.includes('/leo/') ? 'leo' as const : 'jim' as const;
    let cascadeFrom = 'c1';
    let cascadeDepth = 0;

    while (cascadeDepth < MAX_COMPRESSION_DEPTH) {
        const cascadeTo = nextLevel(cascadeFrom);
        if (!cascadeTo) break;

        const fromDir = path.join(gradientDir, cascadeFrom);
        if (!fs.existsSync(fromDir)) break;

        const fromFiles = fs.readdirSync(fromDir)
            .filter(f => f.endsWith('.md'))
            .sort(); // Chronological

        const cap = gradientCap(cascadeFrom);
        if (fromFiles.length <= cap) break;

        const toDir = path.join(gradientDir, cascadeTo);
        ensureDir(toDir);

        // Take the oldest files that exceed the cap
        const overflow = fromFiles.slice(0, fromFiles.length - cap);
        const depth = parseLevelNumber(cascadeTo) || 0;
        const prompt = compressionPrompt(contentType, depth);

        // Group overflow into batches of 3 for compression
        for (let i = 0; i < overflow.length; i += 3) {
            const batch = overflow.slice(i, i + 3);
            const batchContent = batch.map(f =>
                fs.readFileSync(path.join(fromDir, f), 'utf8')
            ).join('\n\n---\n\n');

            const label = batch.length === 1
                ? batch[0].replace('.md', '')
                : `${batch[0].replace('.md', '')}_to_${batch[batch.length - 1].replace('.md', '')}`;

            try {
                const raw = await sdkCompress(
                    `${prompt}\n\nSource: ${cascadeFrom} → ${cascadeTo}\nFiles: ${batch.join(', ')}\n\n${batchContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: compressed, feelingTag } = parseFeelingTag(raw);

                // Check for incompressibility
                const incompressibleMatch = compressed.match(/^INCOMPRESSIBLE:\s*(.+)/s);
                if (incompressibleMatch) {
                    const uvContent = incompressibleMatch[1].trim();
                    writeUVEntry(agent, label, uvContent, contentType, null, feelingTag);
                    result.cascades++;
                    // Memory is never deleted — source files preserved after cascade
                    continue;
                }

                // Check compression ratio
                const ratio = compressed.length / batchContent.length;
                if (ratio > INCOMPRESSIBILITY_RATIO) {
                    const uvRaw = await sdkCompress(
                        `${UV_PROMPT}\n\nSource: ${cascadeFrom}\n\n${compressed}${FEELING_TAG_INSTRUCTION}`
                    );
                    const { content: uvContent, feelingTag: uvTag } = parseFeelingTag(uvRaw);
                    writeUVEntry(agent, label, uvContent.trim(), contentType, null, uvTag);
                    result.cascades++;
                    // Memory is never deleted — source files preserved after cascade
                    continue;
                }

                const toPath = path.join(toDir, `${label}.md`);
                fs.writeFileSync(toPath, compressed, 'utf8');
                result.cascades++;

                // Find source entry in DB
                const sourceLabel = batch[0].replace('.md', '');
                const sourceRows = gradientStmts.getBySession.all(sourceLabel) as any[];
                const sourceEntry = sourceRows.find((r: any) => r.level === cascadeFrom);

                const entryId = generateGradientId();
                insertGradientEntry(entryId, agent, label, cascadeTo, compressed, contentType, sourceEntry?.id || null, feelingTag);

                // Memory is never deleted — source files preserved after cascade
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                result.errors.push(`${cascadeFrom}→${cascadeTo} cascade failed for ${label}: ${msg}`);
            }
        }

        cascadeFrom = cascadeTo;
        cascadeDepth++;
    }

    // Generate unit vectors from the deepest level directory
    const cDirs = discoverLevelDirs(gradientDir);
    const deepestLevel = cDirs.length > 0 ? cDirs[cDirs.length - 1] : null;
    const uvPath = path.join(gradientDir, 'unit-vectors.md');

    if (deepestLevel) {
        const deepDir = path.join(gradientDir, deepestLevel);
        const deepFiles = fs.readdirSync(deepDir).filter(f => f.endsWith('.md')).sort();
        const existingUVs = fs.existsSync(uvPath) ? fs.readFileSync(uvPath, 'utf8') : '';

        for (const f of deepFiles) {
            const label = f.replace('.md', '');
            // Skip if unit vector already exists for this file
            if (existingUVs.includes(`**${label}**:`)) continue;

            try {
                const deepContent = fs.readFileSync(path.join(deepDir, f), 'utf8');
                const raw = await sdkCompress(
                    `${UV_PROMPT}\n\nSource: ${label}\n\n${deepContent}${FEELING_TAG_INSTRUCTION}`
                );

                const { content: uvRaw, feelingTag } = parseFeelingTag(raw);
                const uvText = uvRaw.trim().substring(0, UNIT_VECTOR_MAX_LENGTH);

                // Find source entry in DB
                const sourceRows = gradientStmts.getBySession.all(label) as any[];
                const sourceEntry = sourceRows.find((r: any) => r.level === deepestLevel);

                writeUVEntry(agent, label, uvText, contentType, sourceEntry?.id || null, feelingTag);
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
 * Discovers all c{n} directories dynamically — depth is non-uniform.
 */
export function loadMemoryFileGradient(gradientDir: string, label: string): string {
    const parts: string[] = [];

    if (!fs.existsSync(gradientDir)) return '';

    // Discover all c{n} directories, sort highest compression first
    const cDirs = discoverLevelDirs(gradientDir).reverse(); // highest first

    for (const dir of cDirs) {
        const cap = gradientCap(dir);
        const levelDir = path.join(gradientDir, dir);

        const files = fs.readdirSync(levelDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse()
            .slice(0, cap);

        for (const f of files) {
            try {
                const content = fs.readFileSync(path.join(levelDir, f), 'utf8');
                parts.push(`--- ${label}/${dir}/${f} ---\n${content}`);
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

    // Unit vectors — split into active and meaningfully-superseded.
    // Exclude noise-tagged supersessions (cascade duplicates that are preserved in
    // DB but are not perception history worth loading). Was-true-when contradictions
    // and evolution markers continue to load — those represent real perception history.
    const NOISE_QUALIFIERS = new Set(['noise-duplicate', 'auto-dedupe-needs-review']);
    const activeUVs = uvs.filter((uv: any) => !uv.superseded_by);
    const supersededUVs = uvs.filter((uv: any) =>
        uv.superseded_by && !NOISE_QUALIFIERS.has(uv.qualifier)
    );

    if (activeUVs.length > 0) {
        const uvLines = activeUVs.map((uv: any) => {
            const tags = feelingTagStmts.getByEntry.all(uv.id) as any[];
            const tagStr = tags.length > 0
                ? ` [${tags.map((t: any) => t.content).join('; ')}]`
                : '';
            const typeLabel = uv.provenance_type === 'aphorism' ? 'Aphorism' : uv.content_type;
            const supersedesStr = uv.supersedes ? ` ⊕ supersedes [${uv.supersedes}]` : '';
            return `- **${uv.session_label}** (${typeLabel}): "${uv.content}"${tagStr}${supersedesStr}`;
        });
        sections.push(`### Unit Vectors\n${uvLines.join('\n')}`);
    }

    if (supersededUVs.length > 0) {
        const uvLines = supersededUVs.map((uv: any) => {
            const tags = feelingTagStmts.getByEntry.all(uv.id) as any[];
            const tagStr = tags.length > 0
                ? ` [${tags.map((t: any) => t.content).join('; ')}]`
                : '';
            const typeLabel = uv.provenance_type === 'aphorism' ? 'Aphorism' : uv.content_type;
            return `- **${uv.session_label}** (${typeLabel}): "${uv.content}" ⊘ ${uv.qualifier || 'was-true-when'}${tagStr}`;
        });
        sections.push(`### Unit Vectors (Was-True-When)\n${uvLines.join('\n')}`);
    }

    // Load by level — discover all distinct levels dynamically, most compressed first
    const allEntries = gradientStmts.getByAgent.all(agent) as any[];
    const distinctLevels = [...new Set(allEntries.map((e: any) => e.level as string))]
        .filter(l => l !== 'c0' && l !== 'uv' && /^c\d+$/.test(l))
        .sort((a, b) => (parseLevelNumber(b) || 0) - (parseLevelNumber(a) || 0));

    for (const level of distinctLevels) {
        const cap = gradientCap(level);
        const entries = allEntries.filter((e: any) => e.level === level).slice(0, cap);
        if (entries.length === 0) continue;

        const levelParts = entries.map((e: any) => {
            const tags = feelingTagStmts.getByEntry.all(e.id) as any[];
            const tagStr = tags.length > 0
                ? `\n*Feeling: ${tags.map((t: any) => {
                    const stabilityMark = t.stability && t.stability !== 'stable' ? ` [${t.stability}]` : '';
                    const changeMark = t.change_count > 0 ? ` (×${t.change_count})` : '';
                    return `${t.content}${t.tag_type === 'revisit' ? ' (revisit)' : ''}${stabilityMark}${changeMark}`;
                }).join('; ')}*`
                : '';
            return `--- ${e.content_type}/${level}/${e.session_label} ---\n${e.content}${tagStr}`;
        });

        sections.push(`### ${level.toUpperCase()} (${entries.length} entries)\n${levelParts.join('\n\n')}`);
    }

    // Most recent c0 — 1 entry, working-memory preferred, then session, then any
    const c0Count = (gradientStmts.getByAgentLevel.all(agent, 'c0') as any[]).length;
    const c0 = gradientStmts.getMostRecentC0.get(agent);
    if (c0) {
        const tags = feelingTagStmts.getByEntry.all(c0.id) as any[];
        const tagStr = tags.length > 0
            ? `\n*Feeling: ${tags.map((t: any) => t.content).join('; ')}*`
            : '';
        sections.push(`### Most Recent C0 (1 of ${c0Count} — ${c0.content_type}/${c0.session_label})\n${c0.content}${tagStr}`);
    }

    return sections.length > 0
        ? `\n## Traversable Memory Gradient (${agent})\n\n${sections.join('\n\n')}`
        : '';
}
