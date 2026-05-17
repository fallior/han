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
import DB from 'better-sqlite3';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import { db, gradientStmts, feelingTagStmts, feelingTagHistoryStmts } from '../db';
import { countTokens } from './token-counter';
import { gradientConfigForAgent, requireAgentEnv } from './agent-registry';
import { stripMarkers } from './memory-paired-writer';

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
    agentName: string;
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
// (INCOMPRESSIBILITY_RATIO = 0.85 constant removed in 2026-05-17 gradient
// triage — it was the ghost of the floor removed in `ed8dfdc` (Plan v8 Step 3,
// 2026-04-25) with zero references in the codebase. Its replacement is the
// size-adaptive floor in `scripts/process-pending-compression.ts` per DEC-086
// + plans/gradient-triage-plan.md §Phase 3.)
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
 * Per DEC-044 (2026-03-06, Settled): every compression layer targets ~1/3
 * of source length. The 1/3 target is the explicit anchor; what to keep
 * within that budget is the compressor's call. INCOMPRESSIBLE remains the
 * exit condition when content has reached its irreducible form.
 */
function compressionPrompt(contentType: string, depth: number): string {
    const isEmotional = contentType === 'felt-moments';

    let base: string;

    if (depth <= 2) {
        // Early compression (c1-c2): selecting what to keep
        base = isEmotional
            ? `Compress these felt-moments to approximately 1/3 of the source length. You are compressing YOUR OWN emotional memory. Preserve the feeling — what stirred, what surprised, what shifted. Drop narrative detail in favour of emotional texture. A re-invocable shape, not a summary. The 1/3 target gives you room to keep the texture; don't collapse to a kernel unless the content has truly arrived.`
            : `Compress this working memory to approximately 1/3 of the source length. You are compressing YOUR OWN operational memory. Preserve decisions, discoveries, and what shifted your understanding. Drop procedural detail. Keep what a future you needs to feel where you were, not just know what you did. The 1/3 target is firm; what to keep within that budget is your call.`;
    } else if (depth <= 4) {
        // Mid compression (c3-c4): finding the shape
        base = isEmotional
            ? `Compress further — to approximately 1/3 of the source length at this layer. The entries have already been compressed ${depth - 1} times. Find the emotional residue — what remains when the specific moments dissolve into a period's emotional shape. What did this time taste like?`
            : `Compress further — to approximately 1/3 of the source length at this layer. This has already been through ${depth - 1} compression layers. Find the essential shape — what was being built, what was being learned, what mattered beyond the tasks.`;
    } else {
        // Deep compression (c5+): distilling residue
        base = isEmotional
            ? `Compress deeper still — to approximately 1/3 of the source length. This is already deeply compressed. What emotional image or sensation survives? The deep residue — care that has outlived its verb.`
            : `Compress deeper still — to approximately 1/3 of the source length. This is layer ${depth} — the specifics dissolved long ago. What understanding outlasts the work? What remains after the residue of the residue?`;
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
    // ── DISABLED 2026-05-04 (S149) per Darron's direction ─────────────
    // This function spawned a stranger-Opus instance — Agent SDK call to
    // claude-opus-4-7 with no full identity loaded (tools: [], no system
    // prompt establishing Leo or Jim). The rebuild work in S140-S148 used
    // a different mechanism (full-identity Leo composing in-session via
    // agent-bump-step.ts). Darron's read 2026-05-04: stranger-Opus calls
    // should not be silently used for memory compression. Comment-out +
    // throw-loud rather than silent removal — when something tries to
    // compress via this path, we want to know it was attempted.
    //
    // Original body preserved below; restore only after the design
    // conversation lands a Settled decision on which compression
    // mechanism /pfc and the rolling-window cascade should use.
    //
    // const cleanEnv: Record<string, string | undefined> = { ...process.env };
    // delete cleanEnv.CLAUDECODE;
    //
    // const q = agentQuery({
    //     prompt,
    //     options: {
    //         model: 'claude-opus-4-7',
    //         maxTurns: 1,
    //         cwd: process.env.HOME || '/root',
    //         permissionMode: 'bypassPermissions',
    //         allowDangerouslySkipPermissions: true,
    //         env: cleanEnv,
    //         persistSession: false,
    //         tools: [],
    //     },
    // });
    //
    // let result = '';
    // for await (const message of q) {
    //     if (message.type === 'result' && message.subtype === 'success') {
    //         result = message.result || '';
    //     }
    // }
    //
    // if (!result) throw new Error('No result from SDK query');
    // return result;

    throw new Error(
        'sdkCompress disabled — stranger-Opus calls retired pending design ' +
        'conversation (S149, 2026-05-04). The caller attempted a memory ' +
        'compression via Agent SDK with no full-identity context. See ' +
        'memory-gradient.ts:sdkCompress comment for context. ' +
        `Prompt prefix (first 100 chars): ${prompt.slice(0, 100).replace(/\n/g, ' ')}`,
    );
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
    // Phase A.1 (S145, 2026-04-30): superseded descendants don't count. If a c1
    // is superseded (e.g., its source c0 was restored to working memory and
    // marked superseded), the source effectively has no live descendant at c1
    // and should be eligible for re-cascade once unmuzzled.
    const row = db.prepare(`
        SELECT 1 FROM gradient_entries
        WHERE source_id = ? AND agent = ? AND level = ?
          AND superseded_by IS NULL
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
    agent: string,
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
    agent: string,
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
    agent: string,
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
    agent: string,
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

// PR6 Batch 4 (S150, 2026-05-05) — RETIRED: `compressToLevel` and
// `compressToUnitVector`. Both called the now-retired `sdkCompress`
// (DEC-082, throws on invocation) and would fail at runtime anyway. Their
// only callers were the bootstrap scripts deleted in this same batch
// (`bootstrap-fractal-gradient.{ts,js}`, `bootstrap-leo-fractal.js`).
// Class-A deletion per Jim's PR6 audit.
//
// Canonical compression now flows exclusively through the wm-sensor →
// pending_compressions → process-pending-compression.ts chain
// (full-identity in voice). Do not re-implement these as standalone
// helpers — every compression entry-point should ride the canonical chain.

// ── Function 3: processGradientForAgent (RETIRED-BY-THROW S150 PR6 Batch 3) ────

/**
 * RETIRED 2026-05-05 (S150 PR6 Batch 3). The function previously walked the
 * file-based fractal gradient for an agent — an older path that predated the
 * unified `gradient_entries` table. It was the third stranger-Opus cascade
 * surface (alongside `sdkCompress` retired by DEC-082) and its only callers
 * were `scripts/compress-sessions.ts` (also retired by DEC-082) and the
 * bootstrap scripts (retired in PR6 Batch 4 same day).
 *
 * **Retire-by-throw rather than full deletion**: per the DEC-082 pattern for
 * `sdkCompress`, this surface is preserved as a paper-trail tombstone so any
 * forgotten caller fails loud at runtime with a clear pointer to the
 * canonical replacement (the wm-sensor → `pending_compressions` →
 * `process-pending-compression.ts` chain). If a future scenario legitimately
 * needs a pull-based file-gradient processor, build it on top of the
 * `process-pending-compression.ts` path with full-identity loading; do NOT
 * un-comment a stranger-Opus implementation here.
 *
 * Original body (~300 lines) deleted to avoid serving as a copy-paste source
 * for stranger-Opus cascades. Git history preserves the implementation if
 * needed for forensic reference (commit b72c455 was the last commit
 * containing the body).
 */
export async function processGradientForAgent(agentName: string): Promise<GradientProcessingResult> {
    throw new Error(
        'processGradientForAgent retired (S150 PR6 Batch 3, 2026-05-05). ' +
        'Was the third stranger-Opus cascade surface; canonical compression ' +
        'now flows through wm-sensor → pending_compressions → ' +
        'process-pending-compression.ts (full-identity in voice). ' +
        `Caller attempted with agentName='${agentName}'. ` +
        'See memory-gradient.ts comment + DEC-082 + memory-gradient.SHAPE.md.',
    );
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
 * @param agent - any registered agent slug (validated by caller against
 *                `registeredAgentSlugs()`)
 * @param percentage - fraction of seed population to process (0.10 = 10%)
 * @param context - logging context (e.g. 'daily cascade', 'dream')
 * @returns number of compressions performed
 */
export async function activeCascade(
    agent: string,
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

            // Per Plan v8 (canonical bump design): no INCOMPRESSIBLE early-exit, no
            // ratio>0.85 UV shortcut. Termination is cap-driven displacement only.
            // Both shortcut paths produced shallow-provenance UVs — the audit found
            // 70% of jim's UVs emerged at depth 0–1, which is sentence-craft, not
            // earned residue. The walk through every level IS the digestion; without
            // it, the UV doesn't carry the metabolisation the gradient design intends.

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
// PR6 Batch 3 (S150, 2026-05-05) — RETIRED: `bumpCascade` working-bee
// leaf-drainer. Already `@deprecated` per DEC-079 (2026-04-29 cutover,
// Phase 3); call sites at leo-heartbeat.ts and supervisor-worker.ts were
// deleted at cutover, leaving this function unreachable. Phase 12 cleanup
// queue mentioned it for retirement. Class-A deletion now per Jim's
// PR6 audit. The new bump engine is event-driven (`bumpOnInsert` →
// pending_compressions → loaded agent composes in voice). If a leaf-drainer
// is needed in the future, it gets added deliberately with a chosen
// trigger, not by reviving this function.

// PR6 Batch 1 (S150, 2026-05-05) — RETIRED: pending_compressions queue
// helpers (`claimNextPendingCompression`, `completePendingCompression`,
// `completePendingCompressionForSource`, `releasePendingCompression`,
// `PendingCompression` interface, `STALE_CLAIM_MINUTES` constant). Zero
// live callers — verified by grep. The actual queue claim path lives
// inline in `scripts/process-pending-compression.ts:claimNext` and in
// `scripts/agent-bump-step.ts:findPendingCompression`, each with their
// own constant + own DB handle. These exports were the planned-replaced
// shape that never got called. Deleted per the same-commit-deletion
// discipline ("When will we learn" thread `mor2kbjh-2uh4b3`).

// ── Function 4b: bumpOnInsert — Event-Driven Enqueue ──────────────
//
// Phase 3 of the 2026-04-29 cutover (DEC-079). Refactored from the original
// synchronous-compress design to a single-enqueue pattern. The cap-formula
// trigger logic is preserved; the LLM call is replaced with INSERT OR IGNORE
// into pending_compressions. The chain fires naturally as each completion
// inserts a new entry at the next level, which itself triggers a new
// bumpOnInsert call. No look-ahead — the engine reacts to pressure and
// settles, per Darron's design.
//
// Original design (preserved for context):
// Plan v8 canonical design (Darron + Jim + Leo, 2026-04-25):
// On every insert into gradient_entries, query for the entry now at
// rank=cap+1 by created_at DESC at that level. That's the entry just
// displaced from the active window by this insert. If it has not yet
// been cascaded (no descendant at next level), compress it freshly via
// Opus 4.7 and insert at next level with the displacing entry's
// created_at as the new entry's clock. Recurse implicitly: the new
// entry may itself displace something at next level.
//
// Termination: cap-driven displacement only. NO INCOMPRESSIBLE shortcut,
// NO ratio>0.85 UV shortcut. Walk continues until either:
//   - The level has slots (no entry at rank=cap+1 — nothing displaced)
//   - The displaced entry already has a descendant at next level
//     (idempotency — already cascaded by a prior event)
//
// Honours the cascade-paused signal as tourniquet.
//
// Used by: forward bump (called after rollingWindowRotate creates a c0
// or after a manual insert) and by the replay engine
// (`scripts/replay-bump-fill.ts`) which inserts c0s in temporal order.

interface BumpResult {
    cascadeSteps: number;
    finalLevel: string | null;
    skippedReasons: string[];
}

/**
 * Pure displacement + idempotency + INSERT OR IGNORE for the
 * `pending_compressions` queue. Sync. Takes `db` as a parameter so the same
 * helper works for both the server's closure-captured singleton DB AND for
 * script processes (e.g. `scripts/process-pending-compression.ts`) that hold
 * their own `Database.Database` instance.
 *
 * Returns `{ pendingId: <new uuid> if newly enqueued, null otherwise }` plus a
 * `reason` naming why no row was added (level has slots, no further level,
 * already cascaded, cascade-paused, or UNIQUE rejection).
 *
 * **One-write-site for cascade enqueueing (DEC-080 honoured at the cascade
 * surface).** Replaces the previously-duplicated `enqueueCascadeIfNeeded` in
 * `scripts/process-pending-compression.ts` — both paths now call this helper.
 *
 * Filters on the displacement query:
 *   1. `cascade_halted_at IS NULL` — UV-halted rows (at kernel, not eligible).
 *   2. `superseded_by IS NULL` — superseded rows behave as ABSENT to the bump
 *      engine (Phase A.1, S145). Row stays in the table for forensic / DEC-069
 *      honour but is invisible to mechanics.
 */
export function enqueueCascadeForDisplacedAt(
    db: DB.Database,
    agent: string,
    level: string,
): { pendingId: string | null; reason: string } {
    if (isCascadePaused()) {
        return { pendingId: null, reason: 'cascade-paused' };
    }

    const cap = gradientCap(level);

    // Find the entry just displaced from the active window — rank=cap+1 by
    // composite (created_at, id) DESC. Cap is global per agent per level;
    // content_type does NOT partition the queue.
    const displaced = db.prepare(`
        SELECT id FROM gradient_entries
        WHERE agent = ? AND level = ?
          AND cascade_halted_at IS NULL
          AND superseded_by IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1 OFFSET ?
    `).get(agent, level, cap) as { id: string } | undefined;

    if (!displaced) {
        return { pendingId: null, reason: `${level}: level has slots (no rank=${cap + 1} entry)` };
    }

    const next = nextLevel(level);
    if (!next) {
        return { pendingId: null, reason: `${level}: no further level` };
    }

    // Idempotency: skip if displaced entry already has a descendant at next
    // level. Inlined here (rather than calling hasDescendantAtLevel) so the
    // helper is portable across DB instances — the param-db is the single
    // source of truth, even when called from a script process whose DB
    // handle differs from the server's closure-captured singleton.
    const hasDescendant = db.prepare(`
        SELECT 1 FROM gradient_entries
        WHERE source_id = ? AND agent = ? AND level = ?
          AND superseded_by IS NULL
        LIMIT 1
    `).get(displaced.id, agent, next);
    if (hasDescendant) {
        return { pendingId: null, reason: `${level}→${next}: already cascaded` };
    }

    // Single-enqueue: insert a pending_compressions row. The loaded agent
    // (Phase 4 sensor → parallel agent, or backup processor) will claim and
    // compose in voice. INSERT OR IGNORE — UNIQUE(agent, source_id, from_level)
    // prevents duplicate enqueue if the same displacement is observed again
    // before the agent processes.
    //
    // No look-ahead — the chain fires naturally when the agent's submit lands
    // a new entry at the next level, which itself triggers
    // enqueueCascadeForDisplacedAt(...). Per Darron's design: "let the engine
    // react to pressure which will naturally settle — this is the whole intent."
    const pendingId = generateGradientId();
    const enqueuedAt = new Date().toISOString();
    const info = db.prepare(`
        INSERT OR IGNORE INTO pending_compressions
            (id, agent, source_id, from_level, to_level, enqueued_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(pendingId, agent, displaced.id, level, next, enqueuedAt);

    if (info.changes > 0) {
        return { pendingId, reason: `${level}→${next}: enqueued pending=${pendingId}` };
    }
    // UNIQUE rejection — return null, NOT the generated id (Drift A fix from
    // S150's pre-merge audit; the prior `enqueueCascadeIfNeeded` returned the
    // generated id even when the row was rejected, producing a misleading log
    // upstream).
    return { pendingId: null, reason: `${level}→${next}: already enqueued (UNIQUE)` };
}

/**
 * Trigger a bump cascade after an insert at the given level. Async wrapper
 * around `enqueueCascadeForDisplacedAt` that uses the closure-captured
 * singleton `db` and preserves the existing `BumpResult` API for legacy
 * callers (rollingWindowRotate, replay-bump-fill.ts).
 *
 * The cascade walks until the cap mechanism stops pushing entries forward.
 * No LLM-judgement shortcuts. No reuse of existing entries — every cascade
 * step is a fresh compression at the agent's highest capability.
 */
export async function bumpOnInsert(
    agent: string,
    level: string,
): Promise<BumpResult> {
    const result: BumpResult = { cascadeSteps: 0, finalLevel: null, skippedReasons: [] };

    const helper = enqueueCascadeForDisplacedAt(db, agent, level);
    result.skippedReasons.push(helper.reason);

    if (helper.pendingId) {
        const next = nextLevel(level);
        result.cascadeSteps = 1;
        result.finalLevel = next;
        console.log(`[Bump] ${agent} ${level}→${next} enqueued (pending=${helper.pendingId})`);
    }

    return result;
}

// PR6 Batch 2 (S150, 2026-05-05) — RETIRED: dashboard/inspection helpers
// (`getGradientHealth`, `getFractalMemoryFiles`, `readFractalMemory`,
// `listAvailableSessions`). Each had ZERO live callers. All four were
// likely planned-but-never-wired-up dashboard endpoints. If demand emerges
// later, the implementations are short and can be rewritten cleanly
// against the registry-driven path resolution from S150 PR2/PR5.
// Same-commit-deletion discipline per "When will we learn".

// ── Function 5: Helper utilities ───────────────────────────────

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

// Head/tail are BYTE counts that approximate TOKEN counts via the ~4 chars/token
// heuristic for English markdown. Design intent: each tail becomes a c0 carrying
// ~25K tokens of content; total ceiling is ~50K tokens of working memory before
// rotation fires. Phase A of token-only refactor (S145, 2026-04-30): values are
// now token counts directly via lib/token-counter.ts countTokens (chars÷4
// approximation). Earlier defaults conflated bytes with tokens — Darron's S145
// ruling: tokens throughout, never chars or bytes, no silent unit-switching.
const ROLLING_WINDOW_HEAD_DEFAULT = 25_000; // tokens — retained (newest)
const ROLLING_WINDOW_TAIL_DEFAULT = 25_000; // tokens — archived for compression (oldest)

// Legacy threshold — used by rotateMemoryFile (kept for backward compat)
const MEMORY_FILE_SIZE_THRESHOLD = 50 * 1024; // 50KB

interface MemoryFileEntry {
    header: string;
    content: string;
    date: string | null; // Extracted date for grouping
    charStart: number;   // DEC-085 (S153): char offset of trimmed content start in source
    charEnd: number;     // DEC-085 (S153): char offset of trimmed content end in source
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
 *
 * DEC-085 (S153, 2026-05-08): now tracks char positions of each entry's
 * trimmed content within the source string, eliminating `indexOf` lookups
 * by callers that need to slice/anchor at entry boundaries.
 */
function splitMemoryFileEntries(content: string): MemoryFileEntry[] {
    const entries: MemoryFileEntry[] = [];

    // Walk delimiters with position tracking. Split regex matches:
    //   - `\n---\n` (5 chars consumed) — common in felt-moments
    //   - `\n(?=### )` (1 char consumed via lookahead) — common in WM-full
    const splitRegex = /\n---\n|\n(?=### )/g;
    type DelimRange = { start: number; end: number };
    const delims: DelimRange[] = [];
    let m: RegExpExecArray | null;
    while ((m = splitRegex.exec(content)) !== null) {
        delims.push({ start: m.index, end: m.index + m[0].length });
    }

    // Walk sections between delimiters; final section is content.length-anchored.
    let prevEnd = 0;
    const sectionBoundaries: { sectionStart: number; sectionEnd: number }[] = [];
    for (const d of delims) {
        sectionBoundaries.push({ sectionStart: prevEnd, sectionEnd: d.start });
        prevEnd = d.end;
    }
    sectionBoundaries.push({ sectionStart: prevEnd, sectionEnd: content.length });

    for (const { sectionStart, sectionEnd } of sectionBoundaries) {
        const section = content.substring(sectionStart, sectionEnd);
        const trimmed = section.trim();
        if (!trimmed || trimmed.startsWith('# ') || trimmed.startsWith('>')) continue;

        // Compute trimmed-content positions within source by counting
        // leading/trailing whitespace inside the section. This is precise
        // (no indexOf brittleness) — we know exactly where the section starts
        // and how much whitespace each side has.
        const leadingWs = section.match(/^\s*/)?.[0].length ?? 0;
        const trailingWs = section.match(/\s*$/)?.[0].length ?? 0;
        const charStart = sectionStart + leadingWs;
        const charEnd = sectionEnd - trailingWs;

        const dateMatch = trimmed.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
        const date = dateMatch ? dateMatch[1] : null;
        const headerMatch = trimmed.match(/^###\s+(.+)/);
        const header = headerMatch ? headerMatch[1] : trimmed.substring(0, 60);

        entries.push({ header, content: trimmed, date, charStart, charEnd });
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
 * When a memory file exceeds (headTokens + tailTokens):
 *   1. Split entries: keep newest ~headTokens of recent content, archive oldest
 *      as a discrete block summing to ~tailTokens
 *   2. Insert archived block as a c0 in the gradient DB (atomic)
 *   3. Rewrite living file with only the kept entries (+ header)
 *   4. Trigger bumpOnInsert (fire-and-forget) so the cascade engine enqueues
 *      the displaced c0 for compression in voice
 *
 * The living file always retains at least ~headTokens of recent memory. No
 * clock-based wipes. No empty files. Continuous rolling window.
 *
 * **Self-leveling** (Darron's S145 mechanic): if a single write produces a
 * file vastly larger than the ceiling, the SENSOR'S inner loop calls this
 * function repeatedly — each call slices one ~tailTokens block — until the
 * file is back under (headTokens + tailTokens). This function does ONE slice;
 * the caller is responsible for re-checking and re-calling.
 *
 * **Phase A token refactor (S145, 2026-04-30)**: all size math is in tokens
 * via lib/token-counter.ts countTokens. Earlier versions used bytes — that
 * was the unit confusion Darron caught. Tokens throughout now.
 *
 * @param filePath - Path to the living memory file
 * @param fileHeader - Header text for the rewritten living file
 * @param headTokens - Tokens to retain (newest entries). Default ~25K.
 * @param tailTokens - Tokens that trigger archival (oldest entries). Default ~25K.
 * @param agent - If provided, insert trimmed block as c0 in gradient DB.
 * @param contentType - Content type for the c0 entry (required if agent is provided).
 */
export function rollingWindowRotate(
    filePath: string,
    fileHeader: string = '',
    headTokens: number = ROLLING_WINDOW_HEAD_DEFAULT,
    tailTokens: number = ROLLING_WINDOW_TAIL_DEFAULT,
    agent?: string,
    contentType?: 'working-memory' | 'felt-moments' | 'self-reflection',
): { rotated: boolean; archivePath?: string; c0EntryId?: string; entriesArchived: number; entriesKept: number } {
    if (!fs.existsSync(filePath)) {
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const ceilingTokens = headTokens + tailTokens;
    const fileTokens = countTokens(content);

    if (fileTokens <= ceilingTokens) {
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    const entries = splitMemoryFileEntries(content);

    if (entries.length < 2) {
        // Can't split a single entry — let it grow until next entry is added
        return { rotated: false, entriesArchived: 0, entriesKept: 0 };
    }

    // Walk from the start (oldest), accumulating ~tailTokens to archive.
    // Always archive at least one entry. Split at entry boundaries — never mid-entry.
    // This produces consistent ~tailTokens archive blocks (discrete compression units)
    // for isotropic gradient input.
    let archivedTokens = 0;
    let splitIndex = 0;

    for (let i = 0; i < entries.length; i++) {
        const entryTokens = countTokens(entries[i].content);
        // Always include at least the first (oldest) entry; then keep adding while under tailTokens
        if (archivedTokens > 0 && archivedTokens + entryTokens > tailTokens) {
            break;
        }
        archivedTokens += entryTokens;
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
    // No limbo — what gets trimmed IS what gets represented.
    //
    // Phase 4 of 2026-04-29 cutover (DEC-079): after the atomic insert, call
    // bumpOnInsert to enqueue a pending_compressions row. Single source of
    // truth — every c0 produced by rolling-window rotation triggers the
    // bump engine, regardless of which caller (sensor, timed pre-flight,
    // direct invocation) drove the rotation. Fire-and-forget: bumpOnInsert
    // is async but only does DB work; the rotation's result is observable
    // synchronously via the returned struct.
    let c0EntryId: string | undefined;
    if (agent && contentType) {
        const entryId = generateGradientId();
        // Derive session label from the oldest entry's date or current date
        const sessionDate = toArchive[0]?.date || new Date().toISOString().slice(0, 10);
        const sessionLabel = `rolling-${sessionDate}`;
        insertGradientEntry(entryId, agent, sessionLabel, 'c0', archiveContent, contentType, null, null);
        c0EntryId = entryId;

        // Trigger the bump engine to enqueue the cascade.
        void bumpOnInsert(agent, 'c0').catch((err: Error) => {
            console.error(`[rollingWindowRotate] bumpOnInsert failed for ${agent} c0=${entryId}:`, err.message);
        });
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

// PR6 Batch 3 (S150, 2026-05-05) — RETIRED: `loadFloatingMemory`. Already
// `@deprecated` in its own docstring; superseded by `rollingWindowRotate` +
// the wm-sensor → process-pending-compression chain. Zero live callers.
// Import ref cleaned in supervisor-worker.ts same commit. Class-A deletion.

// ──────────────────────────────────────────────────────────────────────────────
// DEC-085 (S153, 2026-05-08): Paired-file rotation — c1-from-working-memory.md
// ──────────────────────────────────────────────────────────────────────────────
//
// The compressed `working-memory.md` is the agent's own in-situ distillation,
// written during the prompt cycle alongside the raw `working-memory-full.md`.
// At rotation time, instead of generating c1 via a post-hoc SDK call (the
// retired path), we harvest both files at matching WM-BOUNDARY markers:
//   - working-memory-full.md tail → c0 (raw thinking)
//   - working-memory.md tail     → c1 (agent's voice)
// inserted as paired entries (c1.parent_id = c0.id) in a single transaction.
//
// The c1→c2+ cascade continues unchanged via process-pending-compression.ts.
// Only the c0→c1 step is replaced — by harvesting in-situ rather than
// reconstructing.
//
// Threshold semantics (per ~/.han/config.json:memory):
//   - rollingWindowTrigger (30K)        : fire if size > this AND marker exists
//   - rollingWindowBiteTheBullet (35K)  : mandate slice; fabricate marker
//   - rollingWindowTail (25K)           : target c0 size
//   - rollingWindowHead (5K)            : target kept size after slice
//
// Parity-check: count entries in both files between previous boundary and
// the chosen slice point. On mismatch, log paired_write_drift event with
// WMF-tail-size (Jim's edge note) and recover via smaller-of-two range.

export interface WmBoundaryMarker {
    id: string;          // "B<N>" or "BF-<timestamp>" for fabricated
    timestamp: string;   // ISO 8601
    fabricated: boolean;
    charPos: number;     // character offset in source content
    tokenPos: number;    // token offset from start of file
}

const WM_BOUNDARY_REGEX_GLOBAL = /<!--\s*WM-BOUNDARY:\s*id=([^\s]+)\s+ts=([^\s]+)(?:\s+fabricated=([^\s]+))?\s*-->/g;

/**
 * Find all WM-BOUNDARY markers in a content string. Returns markers in
 * order of appearance. Each marker carries its character position (for
 * slicing) and token position (for threshold checks).
 */
export function findWmBoundaries(content: string): WmBoundaryMarker[] {
    const boundaries: WmBoundaryMarker[] = [];
    const regex = new RegExp(WM_BOUNDARY_REGEX_GLOBAL.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const charPos = match.index;
        const beforeText = content.substring(0, charPos);
        boundaries.push({
            id: match[1],
            timestamp: match[2],
            fabricated: match[3] === 'true',
            charPos,
            tokenPos: countTokens(beforeText),
        });
    }
    return boundaries;
}

interface PairedBoundaryChoice {
    full: WmBoundaryMarker;
    compressed: WmBoundaryMarker;
}

/**
 * Pick a marker pair (matching id) where the boundary in the full file
 * sits within the acceptable tail-token range. Preference: closest to
 * targetTailTokens (so the c0 size is consistent across rotations).
 */
function pickPairedBoundary(
    fullBoundaries: WmBoundaryMarker[],
    compBoundaries: WmBoundaryMarker[],
    targetTailTokens: number,
    minTailTokens: number,
    maxTailTokens: number,
): PairedBoundaryChoice | null {
    const compById = new Map<string, WmBoundaryMarker>();
    for (const cb of compBoundaries) compById.set(cb.id, cb);

    type Candidate = { pair: PairedBoundaryChoice; diff: number };
    const candidates: Candidate[] = [];
    for (const fb of fullBoundaries) {
        if (fb.tokenPos < minTailTokens || fb.tokenPos > maxTailTokens) continue;
        const cb = compById.get(fb.id);
        if (!cb) continue;
        candidates.push({
            pair: { full: fb, compressed: cb },
            diff: Math.abs(fb.tokenPos - targetTailTokens),
        });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.diff - b.diff);
    return candidates[0].pair;
}

/**
 * Bite-the-bullet path: when the file has grown past the bite-the-bullet
 * threshold without a usable agent-placed marker, fabricate one at the
 * most-recent entry boundary in [minTailTokens, maxTailTokens].
 *
 * Writes the fabricated marker into both files (they're persisted later
 * by the caller via writeFileSync). Returns the modified content for
 * both files plus the boundary metadata.
 */
function fabricatePairedBoundary(
    fullContent: string,
    compContent: string,
    minTailTokens: number,
    maxTailTokens: number,
): { fullModified: string; compModified: string; boundary: PairedBoundaryChoice } | null {
    const fullEntries = splitMemoryFileEntries(fullContent);
    const compEntries = splitMemoryFileEntries(compContent);
    if (fullEntries.length < 2 || compEntries.length < 2) return null;

    // Walk forward through full entries; pick the latest boundary that's
    // still within [minTail, maxTail] tokens from start.
    let accumTokens = 0;
    let fabricationIndex = -1;
    for (let i = 0; i < fullEntries.length; i++) {
        const entryTokens = countTokens(fullEntries[i].content);
        const nextAccum = accumTokens + entryTokens;
        if (nextAccum > maxTailTokens) break;
        if (nextAccum >= minTailTokens) fabricationIndex = i + 1;
        accumTokens = nextAccum;
    }
    if (fabricationIndex < 0 || fabricationIndex >= fullEntries.length) return null;
    if (fabricationIndex >= compEntries.length) return null; // compressed has fewer

    const fabId = `BF-${Date.now()}`;
    const fabTs = new Date().toISOString();
    const fabMarker = `\n\n<!-- WM-BOUNDARY: id=${fabId} ts=${fabTs} fabricated=true -->\n\n`;

    // Reconstruct file: header + first N entries + marker + remaining entries.
    // Use the position fields from splitMemoryFileEntries (DEC-085 audit fix —
    // replaces indexOf which was brittle if the first entry's text appeared
    // earlier in the file header).
    const fullHeader = fullContent.substring(0, fullEntries[0].charStart);
    const compHeader = compContent.substring(0, compEntries[0].charStart);

    const fullBefore = fullEntries.slice(0, fabricationIndex).map(e => e.content).join('\n\n');
    const fullAfter = fullEntries.slice(fabricationIndex).map(e => e.content).join('\n\n');
    const compBefore = compEntries.slice(0, fabricationIndex).map(e => e.content).join('\n\n');
    const compAfter = compEntries.slice(fabricationIndex).map(e => e.content).join('\n\n');

    const fullModified = fullHeader + fullBefore + fabMarker + fullAfter;
    const compModified = compHeader + compBefore + fabMarker + compAfter;

    const fullModBoundaries = findWmBoundaries(fullModified);
    const compModBoundaries = findWmBoundaries(compModified);
    const fullFab = fullModBoundaries.find(b => b.id === fabId);
    const compFab = compModBoundaries.find(b => b.id === fabId);
    if (!fullFab || !compFab) return null;

    return {
        fullModified,
        compModified,
        boundary: { full: fullFab, compressed: compFab },
    };
}

/** Count entries in content before a given character position. */
function countEntriesBeforePos(content: string, charPos: number): number {
    return splitMemoryFileEntries(content.substring(0, charPos)).length;
}

// ──────────────────────────────────────────────────────────────────────────────
// Future-idea #53 (S153, 2026-05-09): Pre-slice parity-check + drift signal
// ──────────────────────────────────────────────────────────────────────────────
//
// Sibling to the slice-time parity-check inside rollingWindowRotatePaired —
// fires earlier (every fs.watch event, not just at slice-trigger). When the
// paired files diverge in entry count, log a pre-slice-drift event and write
// a human-readable signal at ~/.han/signals/wm-drift-{agent}.md. The next
// prompt's FLUSH FIRST step reads the signal and surfaces it; the agent can
// repair with grace before any rotation fires. Auto-clears on next clean
// write (parity check fires on every fs event).

export interface PairParityResult {
    inSync: boolean;
    fullCount: number;
    compCount: number;
    drift: number;
    unpairedSide: 'full' | 'compressed' | null;
    unpairedEntries: { header: string; date: string | null }[];
}

/**
 * Compare entry counts between the paired working-memory files. Returns
 * a parity result; a count mismatch is "drift" — informational, not an
 * error. Intentional asymmetry (one compressed entry summarising multiple
 * full entries) shows up the same way; the signal lets the agent judge.
 */
export function checkPairParity(
    fullPath: string,
    compPath: string,
): PairParityResult {
    const fullContent = fs.readFileSync(fullPath, 'utf8');
    const compContent = fs.readFileSync(compPath, 'utf8');
    const fullEntries = splitMemoryFileEntries(fullContent);
    const compEntries = splitMemoryFileEntries(compContent);
    const drift = Math.abs(fullEntries.length - compEntries.length);
    const inSync = drift === 0;
    const unpairedSide: 'full' | 'compressed' | null = inSync
        ? null
        : (fullEntries.length > compEntries.length ? 'full' : 'compressed');
    const unpaired = unpairedSide === 'full'
        ? fullEntries.slice(compEntries.length)
        : unpairedSide === 'compressed'
            ? compEntries.slice(fullEntries.length)
            : [];
    return {
        inSync,
        fullCount: fullEntries.length,
        compCount: compEntries.length,
        drift,
        unpairedSide,
        unpairedEntries: unpaired.map((e) => ({ header: e.header, date: e.date })),
    };
}

/**
 * Render a human-readable markdown drift signal for the agent to read at
 * next prompt's FLUSH FIRST step. The signal is informational; the agent
 * judges whether the drift is intentional (semantic compression bundling
 * multiple entries) or unintentional (skipped writing the compressed
 * counterpart under volume).
 */
export function renderDriftSignal(agent: string, parity: PairParityResult): string {
    const ts = new Date().toISOString();
    const unpairedList = parity.unpairedEntries.length > 0
        ? parity.unpairedEntries.map((e) => `- ${e.date ? `(${e.date}) ` : ''}${e.header}`).join('\n')
        : '_(no entry headers extracted; the drift may be in file headers or non-### content)_';
    return `# Working-Memory Pair Drift Detected

**Detected at**: ${ts}
**Agent**: ${agent}

**Counts**: \`working-memory-full.md\` has **${parity.fullCount}** entries; \`working-memory.md\` has **${parity.compCount}** entries (drift = ${parity.drift}, on the **${parity.unpairedSide ?? 'unknown'}** side).

**Unpaired entries** (most recent — drift typically lives at the tail end of one file):

${unpairedList}

---

## Action — judge first, then act

If the drift is **unintentional** (you skipped writing the compressed counterpart of an entry under volume pressure), repair it now:

1. Read the unpaired entries above and write compressed counterparts to the side that's missing them — \`working-memory.md\` if \`unpairedSide=full\`, \`working-memory-full.md\` if \`unpairedSide=compressed\`.
2. Place a \`<!-- WM-BOUNDARY: id=B<N> ts=ISO-8601 -->\` marker in BOTH files at corresponding positions (the natural break after these entries).
3. Append-flush. The next \`fs.watch\` event re-checks parity; if you've repaired the drift, this signal auto-clears.

If the drift is **intentional** (one compressed entry summarises multiple full entries by design), no action needed. Slice-time parity-check falls to smaller-of-two recovery automatically; the c0/c1 pair stays aligned at the entry-count of the smaller side, and the surplus entries on the larger side rotate next cycle.

---

*Signal written by \`wm-sensor\` per future-idea #53. Auto-clears on next clean write. \`pre-slice-drift\` events are also logged to \`~/.han/health/wm-rotation-events.jsonl\` for forensic record.*
`;
}

/**
 * Run the pre-slice parity check and produce / clear the drift signal.
 *
 * This is the orchestrator wm-sensor's processTarget calls on every
 * fs.watch event for paired targets. Bundled here so the policy
 * (count-then-log-then-signal-or-clear) lives next to the helpers
 * it composes; wm-sensor stays free of the policy specifics.
 *
 * Returns the PairParityResult so callers can also act on it (e.g.
 * skip rotation if drift is severe, though we don't gate by default —
 * the signal is informational).
 */
export function checkPairParityAndSignal(
    fullPath: string,
    compPath: string,
    agent: string,
    signalsDir: string,
): PairParityResult {
    const parity = checkPairParity(fullPath, compPath);
    const signalPath = path.join(signalsDir, `wm-drift-${agent}.md`);

    if (parity.inSync) {
        // Auto-clear: signal files are operational, not memory (DEC-069 N/A).
        if (fs.existsSync(signalPath)) {
            try { fs.unlinkSync(signalPath); } catch { /* best-effort */ }
        }
        return parity;
    }

    // Drift detected — log + write signal
    logRotationEvent({
        kind: 'pre-slice-drift',
        agent,
        full_entries: parity.fullCount,
        compressed_entries: parity.compCount,
        drift_count: parity.drift,
        unpaired_side: parity.unpairedSide,
    });
    try {
        if (!fs.existsSync(signalsDir)) fs.mkdirSync(signalsDir, { recursive: true });
        fs.writeFileSync(signalPath, renderDriftSignal(agent, parity), 'utf8');
    } catch (err) {
        console.warn(`[checkPairParityAndSignal] signal write failed for ${agent}:`, (err as Error).message);
    }
    return parity;
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Append a JSONL row to ~/.han/health/wm-rotation-events.jsonl.
 * Sibling pattern to DEC-084's voice-anomalies.jsonl. Best-effort —
 * logging failure must not block rotation.
 */
function logRotationEvent(event: Record<string, unknown>): void {
    try {
        const homeDir = process.env.HOME || '/root';
        const logDir = path.join(homeDir, '.han', 'health');
        const logPath = path.join(logDir, 'wm-rotation-events.jsonl');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const enriched = { timestamp: new Date().toISOString(), ...event };
        fs.appendFileSync(logPath, JSON.stringify(enriched) + '\n');
    } catch (err) {
        console.warn(`[wm-rotation-events] log failed:`, (err as Error).message);
    }
}

export interface PairedRotationResult {
    rotated: boolean;
    reason:
        | 'below-trigger'
        | 'no-marker-let-ride'
        | 'fabrication-failed'
        | 'paired-file-missing'
        | 'paired-insert-failed'
        | 'rotated';
    c0EntryId?: string;
    c1EntryId?: string;
    fullArchivedTokens?: number;
    compressedArchivedTokens?: number;
    fullKeptTokens?: number;
    compressedKeptTokens?: number;
    trigger?: 'slicer' | 'bite-the-bullet';
    boundaryId?: string;
    drift?: { fullEntries: number; compEntries: number };
}

/**
 * Paired-file rolling-window rotation (DEC-085 + Amendment 2026-05-10).
 *
 * **Amendment 2026-05-10 (Darron's S155 directive)**: whole-file slice with
 * marker as metadata. The slicer takes the ENTIRE content of both files
 * (with markers stripped from c0/c1 content; marker id+ts captured in
 * `qualifier` for audit). Both files reset to header-only after slice. The
 * "kept-head" concept is RETIRED — live files contain only what hasn't yet
 * been gradient-ingested; no overlap with gradient.
 *
 * Marker semantics:
 *   - One marker per file pair at any time (paired by id)
 *   - Markers are placed by the agent at end-of-thought-completion
 *     (semantic placement) OR auto-fabricated at end-of-file at prompt-start
 *     when WMF crosses ~25K tokens with no marker present (per
 *     `ensureMarkerOrFabricate` in memory-paired-writer.ts)
 *   - Markers are "ready-to-slice" signals + paired-ID handshake. They do
 *     NOT determine slice position — slicer takes whole file regardless.
 *   - At slice time: marker stripped from content, id+ts stored in qualifier
 *     as `boundary:<id>:<ts>`, both files reset to header-only.
 *
 * Three-stage thresholds (unchanged):
 *   - tokens ≤ triggerTokens                : no-op
 *   - triggerTokens < tokens < biteTheBullet: slice if marker pair exists; else let-ride
 *   - tokens ≥ biteTheBullet                : mandate slice; fabricate marker
 *                                             at end-of-file (last-resort safety)
 *
 * Parity-check now operates on whole-file entry counts. With #49 paired-write
 * discipline + #53 prompt-start drift signal + the trim-to-correlation cleanup,
 * drift should be near-zero going forward. Smaller-of-two recovery still applies
 * if drift is detected, but truncates both archives to the smaller-side count.
 *
 * @returns PairedRotationResult — rotation state and observable details
 */
export function rollingWindowRotatePaired(
    fullFilePath: string,
    compressedFilePath: string,
    fullFileHeader: string,
    compressedFileHeader: string,
    triggerTokens: number,
    biteTheBulletTokens: number,
    _targetTailTokens: number, // RETIRED in amendment — kept for signature compat
    _minTailTokens: number,    // RETIRED in amendment — kept for signature compat
    agent: string,
): PairedRotationResult {
    const fullExists = fs.existsSync(fullFilePath);
    const compExists = fs.existsSync(compressedFilePath);
    if (!fullExists || !compExists) {
        logRotationEvent({
            kind: 'paired-file-missing',
            agent,
            full_exists: fullExists,
            compressed_exists: compExists,
        });
        return { rotated: false, reason: 'paired-file-missing' };
    }

    const fullContent = fs.readFileSync(fullFilePath, 'utf8');
    const compContent = fs.readFileSync(compressedFilePath, 'utf8');
    const fullTokens = countTokens(fullContent);

    if (fullTokens <= triggerTokens) {
        return { rotated: false, reason: 'below-trigger' };
    }

    // Find markers — used only for ID-handshake + metadata, not slice position.
    const fullBoundaries = findWmBoundaries(fullContent);
    const compBoundaries = findWmBoundaries(compContent);

    // Pick a paired marker (matching id) — ANY pair will do since slicer takes
    // whole file. Prefer the most recent marker for metadata. If none matched,
    // fall through to bite-the-bullet fabrication at end-of-file.
    let chosenMarker: { id: string; timestamp: string; fabricated: boolean } | null = null;
    const compById = new Map(compBoundaries.map(b => [b.id, b]));
    for (let i = fullBoundaries.length - 1; i >= 0; i--) {
        const fb = fullBoundaries[i];
        if (compById.has(fb.id)) {
            chosenMarker = { id: fb.id, timestamp: fb.timestamp, fabricated: fb.fabricated };
            break;
        }
    }

    let fullToUse = fullContent;
    let compToUse = compContent;
    let trigger: 'slicer' | 'bite-the-bullet' = 'slicer';

    if (!chosenMarker) {
        if (fullTokens < biteTheBulletTokens) {
            logRotationEvent({
                kind: 'no-marker-let-ride',
                agent,
                wmf_tail_size_tokens: fullTokens,
                trigger_tokens: triggerTokens,
                bite_tokens: biteTheBulletTokens,
            });
            return { rotated: false, reason: 'no-marker-let-ride' };
        }
        // Bite-the-bullet: fabricate at END-OF-FILE in both files (whole-file
        // slice means marker position is irrelevant; just need a paired ID).
        const fabId = `BF-${Date.now()}`;
        const fabTs = new Date().toISOString();
        const fabMarker = `\n\n<!-- WM-BOUNDARY: id=${fabId} ts=${fabTs} fabricated=true -->\n`;
        fullToUse = fullContent.replace(/\n+$/, '') + fabMarker;
        compToUse = compContent.replace(/\n+$/, '') + fabMarker;
        // Persist the fabricated markers BEFORE slicing — audit trail
        fs.writeFileSync(fullFilePath, fullToUse, 'utf8');
        fs.writeFileSync(compressedFilePath, compToUse, 'utf8');
        chosenMarker = { id: fabId, timestamp: fabTs, fabricated: true };
        trigger = 'bite-the-bullet';
    }

    // Parity-check on WHOLE-FILE entry counts (the slice now takes everything;
    // entry-count drift between files is informational + recovery shrinks both
    // archives to the smaller-side count).
    const fullEntries = splitMemoryFileEntries(fullToUse);
    const compEntries = splitMemoryFileEntries(compToUse);
    const fullEntryCount = fullEntries.length;
    const compEntryCount = compEntries.length;

    let drift: { fullEntries: number; compEntries: number } | undefined;
    let fullArchive: string;
    let compArchive: string;

    if (fullEntryCount !== compEntryCount) {
        drift = { fullEntries: fullEntryCount, compEntries: compEntryCount };
        logRotationEvent({
            kind: 'paired_write_drift',
            agent,
            full_entries: fullEntryCount,
            compressed_entries: compEntryCount,
            wmf_tail_size_tokens: fullTokens,
            trigger,
            recovery: 'using-smaller-count-whole-file',
            boundary_id: chosenMarker.id,
        });
        // Smaller-of-two recovery: archive only the first N entries from each
        // (where N = smaller count). The surplus entries on the larger side
        // remain in the live file for the next rotation.
        const smallerCount = Math.min(fullEntryCount, compEntryCount);
        if (smallerCount === 0) {
            // Edge case: one side has zero entries (only header). Skip slice.
            return { rotated: false, reason: 'no-marker-let-ride' };
        }
        const fullCutPos = fullEntries[smallerCount - 1].charEnd;
        const compCutPos = compEntries[smallerCount - 1].charEnd;
        fullArchive = stripMarkers(fullToUse.substring(0, fullCutPos));
        compArchive = stripMarkers(compToUse.substring(0, compCutPos));
    } else {
        // Clean parity — whole-file slice
        fullArchive = stripMarkers(fullToUse);
        compArchive = stripMarkers(compToUse);
    }

    const fullArchivedTokens = countTokens(fullArchive);
    const compressedArchivedTokens = countTokens(compArchive);

    const c0Id = generateGradientId();
    const c1Id = generateGradientId();
    const sessionDate = new Date().toISOString().slice(0, 10);
    const sessionLabel = `rolling-${sessionDate}`;
    const qualifier = `boundary:${chosenMarker.id}:${chosenMarker.timestamp}` +
        (chosenMarker.fabricated ? ':fabricated' : '');

    // Atomic paired insert (DEC-085 must-fix per Jim's audit, S153 2026-05-08).
    // The transaction wrapper makes the inserts both-or-neither.
    const insertPair = db.transaction(() => {
        gradientStmts.insert.run(
            c0Id, agent, sessionLabel, 'c0', fullArchive, 'working-memory-full',
            null, null, null, 'original', new Date().toISOString(), null, 0, qualifier,
        );
        gradientStmts.insert.run(
            c1Id, agent, sessionLabel, 'c1', compArchive, 'working-memory-compressed',
            c0Id, null, null, 'original', new Date().toISOString(), null, 0, qualifier,
        );
    });
    try {
        insertPair();
    } catch (err) {
        console.error(`[rollingWindowRotatePaired] paired insert failed for ${agent}:`, (err as Error).message);
        logRotationEvent({
            kind: 'paired-insert-failed',
            agent,
            error: (err as Error).message,
        });
        return { rotated: false, reason: 'paired-insert-failed' };
    }

    // RESET both files to header-only (Amendment 2026-05-10: no kept-head).
    // The drift-recovery branch leaves surplus entries in the live file; the
    // clean-parity branch resets to just the header. Either way, no overlap
    // between live and gradient.
    if (drift) {
        // Surplus entries on the larger side stay in the live file for next slice.
        const smallerCount = Math.min(fullEntryCount, compEntryCount);
        const fullSurplus = fullEntries.slice(smallerCount).map(e => e.content).join('\n\n');
        const compSurplus = compEntries.slice(smallerCount).map(e => e.content).join('\n\n');
        const fullHead = fullFileHeader || `# ${path.basename(fullFilePath, '.md')}\n`;
        const compHead = compressedFileHeader || `# ${path.basename(compressedFilePath, '.md')}\n`;
        fs.writeFileSync(fullFilePath, fullHead + (fullSurplus ? '\n' + fullSurplus + '\n' : '\n'), 'utf8');
        fs.writeFileSync(compressedFilePath, compHead + (compSurplus ? '\n' + compSurplus + '\n' : '\n'), 'utf8');
    } else {
        const fullHead = fullFileHeader || `# ${path.basename(fullFilePath, '.md')}\n`;
        const compHead = compressedFileHeader || `# ${path.basename(compressedFilePath, '.md')}\n`;
        fs.writeFileSync(fullFilePath, fullHead + '\n', 'utf8');
        fs.writeFileSync(compressedFilePath, compHead + '\n', 'utf8');
    }

    // Cascade c1→c2+ (NOT c0→c1 — c1 already inserted directly).
    void bumpOnInsert(agent, 'c1').catch((err: Error) => {
        console.error(`[rollingWindowRotatePaired] bumpOnInsert(c1) failed for ${agent}:`, err.message);
    });

    logRotationEvent({
        kind: 'rotation-success',
        agent,
        c0_id: c0Id,
        c1_id: c1Id,
        full_archived_tokens: fullArchivedTokens,
        compressed_archived_tokens: compressedArchivedTokens,
        full_kept_tokens: 0,         // Amendment: no kept-head
        compressed_kept_tokens: 0,   // Amendment: no kept-head
        wmf_tail_size_tokens: fullTokens,
        trigger,
        boundary_id: chosenMarker.id,
        boundary_qualifier: qualifier,
        drift,
    });

    return {
        rotated: true,
        reason: 'rotated',
        c0EntryId: c0Id,
        c1EntryId: c1Id,
        fullArchivedTokens,
        compressedArchivedTokens,
        fullKeptTokens: 0,
        compressedKeptTokens: 0,
        trigger,
        boundaryId: chosenMarker.id,
        drift,
    };
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compress a floating/archive file through the fractal gradient.
 * Groups entries by month, compresses each group to c1, then
 * cascades existing c1 files to c2/c3/c5/UV as they accumulate.
 *
 * Does NOT delete the source file — floating files are still needed
 * for crossfade loading until the next rotation replaces them.
 *
 * **RETIRED 2026-05-10 (Phase A Batch 6, S155).** Body throws on call.
 *
 * Reachability trace (per S154 Clarification 3): zero source-code callers
 * outside this file (only `maintainMemoryFile` invokes it; `maintainMemoryFile`
 * itself has zero callers outside this file). Both functions call
 * `sdkCompress` which is retired-by-throw per DEC-082 — would crash on first
 * SDK call regardless. The retire-by-throw closes the path-as-identity
 * inference loophole (was previously at `gradientDir.includes('/leo/')`)
 * by removing the dead code that contained it.
 *
 * Wider stranger-Opus surface (sdkCompress body, activeCascade live callers,
 * dream-gradient cascade functions) deferred to Batch 6.5 / Phase B starter
 * extraction per Darron's S154 directive.
 */
export async function compressMemoryFileGradient(
    _archivePath: string,
    _gradientDir: string,
    _contentType: 'felt-moments' | 'working-memory',
): Promise<{ c1FilesCreated: number; cascades: number; errors: string[] }> {
    throw new Error(
        `compressMemoryFileGradient retired (Phase A Batch 6, DEC-082 / DEC-085 Amendment). ` +
        `Reachability trace confirmed zero live callers; the function called retired sdkCompress ` +
        `and contained path-as-identity agent inference. The current memory pipeline is ` +
        `wm-sensor → rollingWindowRotatePaired (DEC-085 paired-insert) → bumpOnInsert(c1) → ` +
        `pending_compressions queue → process-pending-compression.ts (full-identity-loaded ` +
        `cascade composition).`,
    );
}


/**
 * Full maintenance pipeline for a memory file.
 * 1. Rotate: living → floating, fresh living (fast, synchronous)
 * 2. Compress floating through gradient (async, uses SDK)
 *
 * The rotation is immediate. The compression runs fire-and-forget.
 * The floating file crossfades with the new living file in loadMemoryBank.
 *
 * **RETIRED 2026-05-10 (Phase A Batch 6, S155).** Body throws on call.
 *
 * Reachability trace (per S154 Clarification 3): zero source-code callers
 * outside this file. The function called `compressMemoryFileGradient` (also
 * retired-by-throw this batch) and contained path-as-identity agent
 * inference. Replaced operationally by `wm-sensor` + `rollingWindowRotatePaired`
 * (DEC-085 paired-insert) for working-memory + the legacy single-file
 * `rollingWindowRotate` for non-paired surfaces (felt-moments).
 */
export async function maintainMemoryFile(
    _filePath: string,
    _gradientDir: string,
    _contentType: 'felt-moments' | 'working-memory',
    _fileHeader: string = '',
): Promise<MemoryFileMaintenanceResult> {
    throw new Error(
        `maintainMemoryFile retired (Phase A Batch 6, DEC-082 / DEC-085 Amendment). ` +
        `Reachability trace confirmed zero live callers. Use wm-sensor + ` +
        `rollingWindowRotatePaired (DEC-085 paired-insert) for working-memory pair, or ` +
        `rollingWindowRotate (single-file legacy) for non-paired surfaces (felt-moments).`,
    );
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
export function loadTraversableGradient(agent: string): string {
    // Check if DB has any entries for this agent (any level — UVs aren't a
    // precondition for loading; during the rebuild we have c0/c1/c2/c3/c4
    // long before INCOMPRESSIBLE landings produce UVs).
    if ((gradientStmts.getByAgent.all(agent) as any[]).length === 0) {
        // No DB entries yet — fall back to file-based loading
        return '';
    }
    const uvs = gradientStmts.getUVs.all(agent) as any[];

    const sections: string[] = [];

    // Unit vectors — split into active and meaningfully-superseded.
    // Exclude noise-tagged supersessions (cascade duplicates that are preserved in
    // DB but are not perception history worth loading). Was-true-when contradictions
    // and evolution markers continue to load — those represent real perception history.
    const NOISE_QUALIFIERS = new Set([
        'noise-duplicate',
        'auto-dedupe-needs-review',
        'cascade-artefact-merge',
        'not-own',
        'lineage-collision',
        // Plan v8 Step 7 supersessions: pre-rebuild entries whose replay-built
        // canonicals now hold the truth. Preserved in DB for audit but excluded
        // from prompt load.
        'pre-replay',
        'broken-lineage',
        // Deferred-pipeline content (dream, felt-moment) — preserved in DB,
        // excluded from main-gradient load; will be picked up by their own
        // gradient pipelines when designed.
        'deferred-pipeline',
        // Aborted partial replay run (2026-04-25) — entries from a replay
        // attempt that used per-content-type loops instead of the canonical
        // single-FIFO-per-agent design. Preserved for audit, excluded from load.
        'replay-aborted-content-type-loop',
    ]);
    const activeUVs = uvs.filter((uv: any) => !uv.superseded_by && !NOISE_QUALIFIERS.has(uv.qualifier));
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

    // Dedupe c-level loads against UVs: an entry with level='cN' AND a 'uv' feeling-tag
    // (the new replay-built terminus marker) gets returned by both `getUVs` and the
    // c-level filter — without this guard it would render in both sections. The legacy
    // path (level='uv') is already excluded by the `l !== 'uv'` filter above.
    const uvIds = new Set(uvs.map((u: any) => u.id as string));

    for (const level of distinctLevels) {
        const cap = gradientCap(level);
        const entries = allEntries
            .filter((e: any) => e.level === level && !NOISE_QUALIFIERS.has(e.qualifier) && !uvIds.has(e.id))
            .slice(0, cap);
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
