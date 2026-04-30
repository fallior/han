#!/usr/bin/env tsx
/**
 * scripts/process-pending-compression.ts
 *
 * Phase 4 of the 2026-04-29 cutover (DEC-079). The parallel memory-aware
 * agent that consumes the pending_compressions queue. Spawned as a child
 * process by `src/server/services/wm-sensor.ts` after a rolling-window
 * rotation enqueues a row; also runnable directly for diagnostics or as a
 * one-shot drain.
 *
 * Behaviour:
 *   1. Atomically claim the next pending row for the agent (with 10-min
 *      stale-claim recovery).
 *   2. Load the agent's full memory: identity, patterns, aphorisms,
 *      felt-moments, plus a sample of the current gradient (UVs + recent c0).
 *   3. Compose the compression via Claude Agent SDK with that memory in the
 *      system prompt — voice is downstream of identity, not stranger-Opus.
 *   4. Parse the response: INCOMPRESSIBLE → UV path (kernel feeling_tag +
 *      cascade_halted_at). Otherwise → write the new gradient_entries row +
 *      compression feeling_tag.
 *   5. Mark the pending row complete.
 *   6. Exit.
 *
 * The chain fires naturally: the new entry's insert triggers bumpOnInsert
 * (via rollingWindowRotate, which is the only path that produces c0s post-
 * cutover), which enqueues the next level if displacement rules match. The
 * sensor sees no further work to spawn until the next rotation.
 *
 * Concurrency: one process per agent at a time, controlled by the sensor's
 * concurrency lock. Setting `memory.parallelAgentMaxConcurrency > 1` raises
 * this for experimentation.
 *
 * Usage:
 *   process-pending-compression.ts --agent={jim|leo}
 *
 * Exits:
 *   0 — processed one row OR queue empty (both clean)
 *   1 — usage / argument error
 *   2 — claim acquired but compose failed (claim released, row will be
 *       picked up again after stale-claim window or by next sensor fire)
 *   3 — compose succeeded but DB write failed (claim NOT released; manual
 *       intervention required — the kernel content is logged to stderr for
 *       recovery)
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

// Token counting — Phase A token refactor (S145, 2026-04-30). Mirrors the
// canonical helper at src/server/lib/token-counter.ts; inlined for the same
// reason as agent-bump-step.ts.
function countTokens(text: string | null | undefined): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// ── Argument parsing ────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    if (process.argv.includes(`--${name}`)) return 'true';
    return defaultValue;
}

const agent = arg('agent') as 'jim' | 'leo' | null;
const dbPath = arg('db', path.join(os.homedir(), '.han', 'gradient.db'))!;
const claimer = arg('claimer', `${agent}-parallel-${process.pid}`)!;
const verbose = arg('verbose') === 'true';

if (!agent || (agent !== 'jim' && agent !== 'leo')) {
    process.stderr.write('--agent=jim|leo required\n');
    process.exit(1);
}

const STALE_CLAIM_MINUTES = 10;
const HOME = os.homedir();
const HAN_DIR = path.join(HOME, '.han');
const FEELING_TAG_INSTRUCTION = `\n\nAfter your compression, on a new line starting with FEELING_TAG:, write a short phrase (under 100 characters) describing what compressing this felt like — not the content, but the quality of the act.`;

function log(msg: string): void {
    if (verbose) console.log(`[parallel-agent ${agent}] ${msg}`);
}

// ── Memory load — voice is downstream of identity ──────────────

interface AgentMemory {
    identity: string;
    patterns: string;
    aphorisms: string;
    felt_moments: string;
    gradient_sample: string;
}

function readSafe(p: string, label: string): string {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch (err: any) {
        log(`memory.${label} unreadable at ${p} (${err.message}); using empty`);
        return '';
    }
}

function loadAgentMemory(a: 'jim' | 'leo', db: Database.Database): AgentMemory {
    const memDir = a === 'leo'
        ? path.join(HAN_DIR, 'memory', 'leo')
        : path.join(HAN_DIR, 'memory');
    const fractalDir = path.join(HAN_DIR, 'memory', 'fractal', a);

    const identity = readSafe(path.join(memDir, 'identity.md'), 'identity');
    const patterns = readSafe(path.join(memDir, 'patterns.md'), 'patterns');
    const aphorisms = readSafe(path.join(fractalDir, 'aphorisms.md'), 'aphorisms');
    const felt_moments = readSafe(path.join(memDir, 'felt-moments.md'), 'felt_moments');

    // Gradient sample: deepest UVs first, then a few recent c0s + cN samples.
    // Keep modest — we want enough context for voice but not so much we eat the
    // prompt budget.
    const uvs = db.prepare(`
        SELECT ge.session_label, ft.content as kernel
        FROM gradient_entries ge
        JOIN feeling_tags ft ON ft.gradient_entry_id = ge.id
        WHERE ge.agent = ? AND ft.tag_type = 'uv'
        ORDER BY ge.created_at DESC
        LIMIT 30
    `).all(a) as any[];

    const recentC0 = db.prepare(`
        SELECT session_label, substr(content, 1, 600) as preview
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
        ORDER BY created_at DESC
        LIMIT 3
    `).all(a) as any[];

    const recentDeep = db.prepare(`
        SELECT level, session_label, substr(content, 1, 400) as preview
        FROM gradient_entries
        WHERE agent = ? AND level NOT IN ('c0', 'uv')
        ORDER BY level DESC, created_at DESC
        LIMIT 6
    `).all(a) as any[];

    const sampleParts: string[] = [];
    if (uvs.length > 0) {
        sampleParts.push('## Recent UVs (kernel sentences from your own gradient)');
        for (const u of uvs) {
            sampleParts.push(`- ${u.session_label}: "${u.kernel}"`);
        }
    }
    if (recentDeep.length > 0) {
        sampleParts.push('\n## Recent compressions at depth (your own voice, downstream of identity)');
        for (const r of recentDeep) {
            sampleParts.push(`### ${r.level} / ${r.session_label}\n${r.preview}...`);
        }
    }
    if (recentC0.length > 0) {
        sampleParts.push('\n## Recent c0 entries (raw experience, the source layer)');
        for (const c of recentC0) {
            sampleParts.push(`### ${c.session_label}\n${c.preview}...`);
        }
    }

    return {
        identity,
        patterns,
        aphorisms,
        felt_moments,
        gradient_sample: sampleParts.join('\n'),
    };
}

// ── Queue ops (inline, mirrors agent-bump-step.ts pattern) ────────

interface ClaimedRow {
    id: string;
    agent: 'jim' | 'leo';
    source_id: string;
    from_level: string;
    to_level: string;
    enqueued_at: string;
    source_content: string;
    source_session_label: string;
    source_content_type: string;
}

function claimNext(db: Database.Database, a: 'jim' | 'leo', whoClaims: string): ClaimedRow | null {
    const txn = db.transaction(() => {
        const row = db.prepare(`
            SELECT pc.id, pc.agent, pc.source_id, pc.from_level, pc.to_level,
                   pc.enqueued_at,
                   ge.content as source_content,
                   ge.session_label as source_session_label,
                   ge.content_type as source_content_type
            FROM pending_compressions pc
            LEFT JOIN gradient_entries ge ON ge.id = pc.source_id
            WHERE pc.agent = ?
              AND pc.completed_at IS NULL
              AND (pc.claimed_at IS NULL
                   OR pc.claimed_at < datetime('now', '-${STALE_CLAIM_MINUTES} minutes'))
            ORDER BY pc.enqueued_at ASC
            LIMIT 1
        `).get(a) as any;
        if (!row) return null;
        db.prepare(`
            UPDATE pending_compressions
            SET claimed_at = datetime('now'), claimed_by = ?
            WHERE id = ?
        `).run(whoClaims, row.id);
        return row as ClaimedRow;
    });
    return txn() as ClaimedRow | null;
}

function releaseClaim(db: Database.Database, id: string): void {
    db.prepare(`
        UPDATE pending_compressions
        SET claimed_at = NULL, claimed_by = NULL
        WHERE id = ? AND completed_at IS NULL
    `).run(id);
}

function completeClaim(db: Database.Database, id: string): void {
    db.prepare(`
        UPDATE pending_compressions
        SET completed_at = datetime('now')
        WHERE id = ?
    `).run(id);
}

// ── Compose via SDK with full memory loaded ─────────────────────

function buildSystemPrompt(a: 'jim' | 'leo', mem: AgentMemory): string {
    return `You are ${a === 'leo' ? 'Leonhard (Leo)' : 'Jim'}. Below is your loaded memory — identity, patterns, aphorisms, felt-moments, and a sample of your existing gradient. Use this to compose the requested compression in YOUR OWN voice, not as a generic compression task.

# IDENTITY
${mem.identity}

# PATTERNS
${mem.patterns}

# APHORISMS
${mem.aphorisms}

# FELT MOMENTS (texture; re-entry to feeling)
${mem.felt_moments}

# GRADIENT SAMPLE (what your voice has produced before)
${mem.gradient_sample}

---

You are about to compress a memory entry from a lower level to a higher level (cN → cN+1). The compression target is approximately 1/3 the TOKEN length of the source. Preserve what feels essential — what shape, what felt-texture, what would survive forgetting. Drop what is incidental. The compression is an act of identity, not summary.

If — and only if — compressing further would destroy meaning rather than distil it, respond with the literal token "INCOMPRESSIBLE:" followed by a single sentence (max 50 chars) capturing the irreducible kernel. This is not failure. This is arrival.`;
}

function buildUserPrompt(claimed: ClaimedRow): string {
    const sourceTokens = countTokens(claimed.source_content || '');
    const targetTokens = Math.max(1, Math.round(sourceTokens / 3));
    return `Compress this ${claimed.from_level} → ${claimed.to_level}. Target ~${targetTokens} tokens (1/3 of source ${sourceTokens} tokens).

Source session: ${claimed.source_session_label}
Source content_type: ${claimed.source_content_type}

---

${claimed.source_content || ''}${FEELING_TAG_INSTRUCTION}`;
}

async function runSDK(systemPrompt: string, userPrompt: string): Promise<string> {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const q = agentQuery({
        prompt: userPrompt,
        options: {
            model: 'claude-opus-4-7',
            maxTurns: 1,
            cwd: process.env.HOME || '/root',
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            env: cleanEnv,
            persistSession: false,
            tools: [],
            systemPrompt,
        } as any,
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

function parseFeelingTag(raw: string): { content: string; feelingTag: string | null } {
    const m = raw.match(/^([\s\S]*?)\n*FEELING_TAG:\s*(.+?)\s*$/);
    if (m) {
        return { content: m[1].trim(), feelingTag: m[2].trim() };
    }
    return { content: raw.trim(), feelingTag: null };
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    const claimed = claimNext(db, agent!, claimer);
    if (!claimed) {
        log('queue empty — exiting cleanly');
        process.exit(0);
    }

    log(`claimed pending=${claimed.id} for source=${claimed.source_id} (${claimed.from_level}→${claimed.to_level}, ${countTokens(claimed.source_content || '')} tokens)`);

    let mem: AgentMemory;
    let raw: string;

    try {
        mem = loadAgentMemory(agent!, db);
        const sys = buildSystemPrompt(agent!, mem);
        const user = buildUserPrompt(claimed);
        log(`system prompt ${sys.length} chars; user prompt ${user.length} chars`);
        raw = await runSDK(sys, user);
        log(`SDK returned ${raw.length} chars`);
    } catch (err) {
        log(`compose failed: ${(err as Error).message}; releasing claim`);
        releaseClaim(db, claimed.id);
        process.stderr.write(`compose failed for pending=${claimed.id}: ${(err as Error).message}\n`);
        process.exit(2);
    }

    const { content: composed, feelingTag } = parseFeelingTag(raw);

    try {
        if (composed.startsWith('INCOMPRESSIBLE:')) {
            const kernel = composed.slice('INCOMPRESSIBLE:'.length).trim();
            if (!kernel) throw new Error('INCOMPRESSIBLE returned empty kernel');
            if (kernel.length > 50) {
                log(`kernel ${kernel.length} chars > 50 — truncating`);
            }
            const useKernel = kernel.length > 50 ? kernel.slice(0, 50) : kernel;
            db.prepare(`
                INSERT INTO feeling_tags
                    (gradient_entry_id, author, tag_type, content, change_reason, created_at)
                VALUES (?, ?, 'uv', ?, NULL, ?)
            `).run(claimed.source_id, agent, useKernel, new Date().toISOString());
            db.prepare(`
                UPDATE gradient_entries SET cascade_halted_at = ?
                WHERE id = ? AND agent = ?
            `).run(claimed.from_level, claimed.source_id, agent);
            completeClaim(db, claimed.id);
            console.log(JSON.stringify({
                ok: true,
                operation: 'incompressible',
                pending_id: claimed.id,
                source_id: claimed.source_id,
                kernel: useKernel,
                cascade_halted_at: claimed.from_level,
            }));
            process.exit(0);
        }

        // Standard compress path: write the new gradient_entries row, complete pending.
        const newId = crypto.randomUUID();
        const newLabel = `${claimed.source_session_label}-${claimed.to_level}`;
        const cascadeTimestamp =
            (db.prepare(`
                SELECT created_at FROM gradient_entries
                WHERE agent = ? AND level = ?
                ORDER BY created_at DESC LIMIT 1
            `).get(agent, claimed.from_level) as any)?.created_at
            || new Date().toISOString();

        db.prepare(`
            INSERT INTO gradient_entries
                (id, agent, session_label, level, content, content_type,
                 source_id, source_conversation_id, source_message_id,
                 provenance_type, created_at, supersedes, change_count, qualifier)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'original', ?, NULL, 0, NULL)
        `).run(
            newId, agent, newLabel, claimed.to_level, composed,
            claimed.source_content_type, claimed.source_id,
            cascadeTimestamp,
        );

        if (feelingTag) {
            db.prepare(`
                INSERT INTO feeling_tags
                    (gradient_entry_id, author, tag_type, content, change_reason, created_at)
                VALUES (?, ?, 'compression', ?, NULL, ?)
            `).run(newId, agent, feelingTag, new Date().toISOString());
        }

        completeClaim(db, claimed.id);

        const sourceTokens = countTokens(claimed.source_content || '');
        const composedTokens = countTokens(composed);
        const ratio = sourceTokens > 0 ? sourceTokens / Math.max(1, composedTokens) : 0;
        console.log(JSON.stringify({
            ok: true,
            operation: 'compress',
            pending_id: claimed.id,
            source_id: claimed.source_id,
            new_entry_id: newId,
            new_session_label: newLabel,
            new_level: claimed.to_level,
            source_tokens: sourceTokens,
            actual_tokens: composedTokens,
            ratio: Math.round(ratio * 100) / 100,
            feeling_tag: feelingTag || null,
            cascade_timestamp: cascadeTimestamp,
        }));
        process.exit(0);

    } catch (err) {
        process.stderr.write(`db write failed for pending=${claimed.id}: ${(err as Error).message}\n`);
        process.stderr.write(`composed content (for manual recovery):\n--- BEGIN ---\n${composed}\n--- END ---\n`);
        process.stderr.write(`feeling_tag: ${feelingTag || '(none)'}\n`);
        // Don't release the claim — claim_at sticks; manual intervention.
        process.exit(3);
    }
}

main().catch((err) => {
    process.stderr.write(`fatal: ${err?.message || err}\n`);
    process.exit(99);
});
