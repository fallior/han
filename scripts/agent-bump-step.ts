#!/usr/bin/env tsx
/**
 * scripts/agent-bump-step.ts
 *
 * Step-driver for agent-in-loop gradient rebuild (option-b path).
 *
 * Hands one compression step at a time to the live agent (jim or leo) running
 * in a 1M-context Claude Code session with their full memory bank loaded. The
 * agent composes the compressed content in their own voice, the script writes
 * it to gradient.db with provenance + lineage + feeling tag, then computes
 * the next pending step.
 *
 * Replaces sdkCompress's bare single-turn calls (stranger-Opus wearing the
 * agent's name) with agent-grounded composition. Voice is downstream of the
 * agent's loaded memory, not a one-turn prompt.
 *
 * Modes:
 *   next    — print JSON describing the next pending step
 *   submit  — accept the agent's compression (or insert-c0 replay) and write
 *
 * State lives entirely in gradient.db (target) + rolled-source.db (source).
 * Resumable across session clears: pick up wherever the DB state implies the
 * next step is. No external checkpoint file.
 *
 * Step priority:
 *   1. Pending compression at any existing level (cap-violation not yet
 *      cascaded). Walks c0..c10 returning the lowest-level violation first.
 *   2. Insert next source c0 (composite cursor on rolled-source.db).
 *   3. DONE.
 *
 * Usage:
 *   npx tsx scripts/agent-bump-step.ts next --agent={jim|leo}
 *   npx tsx scripts/agent-bump-step.ts submit --agent={jim|leo} --step-id=... \
 *       --content-file=/tmp/jim-comp-N.md --feeling-tag="..."
 *   npx tsx scripts/agent-bump-step.ts submit --agent={jim|leo} --step-id=... \
 *       --incompressible --content-file=/tmp/jim-uv-N.md
 *
 * Defaults:
 *   --source-db=~/.han/rolled-source.db (read-only)
 *   --target-db=~/.han/gradient.db
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

// ── Argument parsing ────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    if (process.argv.includes(`--${name}`)) return 'true';
    return defaultValue;
}

const mode = process.argv[2];
const agent = arg('agent') as 'jim' | 'leo' | null;
const sourceDbPath = arg('source-db', path.join(os.homedir(), '.han', 'rolled-source.db'))!;
const targetDbPath = arg('target-db', path.join(os.homedir(), '.han', 'gradient.db'))!;
const maxLevelArg = arg('max-level', '12');
const maxLevel = parseInt(maxLevelArg!, 10);

if (!mode || !['next', 'submit'].includes(mode)) {
    console.error('Usage: agent-bump-step.ts <next|submit> --agent={jim|leo} [options]');
    process.exit(1);
}
if (!agent || (agent !== 'jim' && agent !== 'leo')) {
    console.error('--agent= required (jim or leo)');
    process.exit(1);
}
if (path.resolve(sourceDbPath) === path.resolve(targetDbPath)) {
    console.error(`FATAL: source and target paths identical (${sourceDbPath}). Refusing to run.`);
    process.exit(2);
}

// Route src/server/db.ts to the target DB so its CREATE TABLE IF NOT EXISTS
// statements initialise the schema on a fresh target. Must be set BEFORE any
// import that loads db.ts.
process.env.HAN_DB_PATH = targetDbPath;

// ── DB connections ──────────────────────────────────────────────

const sourceDb = new Database(sourceDbPath, { readonly: true });
// Open a separate write connection. The schema-init pass is done lazily
// inside main() via dynamic import('../src/server/db') so the empty file
// gets full schema before we prepare statements.
const targetDb = new Database(targetDbPath);

// ── Helpers ─────────────────────────────────────────────────────

// Cap formula per DEC-068: c0=1, c{n>=1}=3n.
function gradientCap(level: string): number {
    const m = level.match(/^c(\d+)$/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    if (n < 1) return 1;
    return 3 * n;
}

function nextLevelName(level: string): string | null {
    const m = level.match(/^c(\d+)$/);
    if (!m) return null;
    return `c${parseInt(m[1], 10) + 1}`;
}

function generateId(): string {
    return crypto.randomUUID();
}

// "Already cascaded" check — does any entry at `atLevel` have source_id = id?
// Mirrors hasDescendantAtLevel from src/server/lib/memory-gradient.ts.
function hasDescendantAt(sourceId: string, atLevel: string): boolean {
    const row = targetDb.prepare(`
        SELECT 1 FROM gradient_entries
        WHERE agent = ? AND level = ? AND source_id = ?
        LIMIT 1
    `).get(agent, atLevel, sourceId);
    return !!row;
}

// Find the next pending compression — walk c0..maxLevel for ANY uncascaded
// entry beyond the active window (rank > cap by created_at DESC, id DESC).
// Returns the OLDEST uncascaded entry (lowest rank below the active window
// fires first — that's the FIFO order for cascade).
//
// Why "any uncascaded" rather than "rank=cap+1 only" (as bumpOnInsert does):
// bumpOnInsert is called RIGHT AFTER an insert when there's exactly one new
// displaced entry to handle. This script runs as a state machine that may
// observe partially-cascaded state from prior tied-timestamp tiebreaking
// (where SQL placed the older entry at rank 1 instead of rank 2). Walking
// all candidates beyond cap ensures no entry gets stuck.
//
// Composite ordering (created_at, id) DESC makes rank deterministic across
// queries — same fix as the replay-bump-fill.ts cursor.
function findPendingCompression(): {
    level: string;
    nextLevel: string;
    displaced: any;
} | null {
    for (let n = 0; n <= maxLevel; n++) {
        const level = `c${n}`;
        const cap = gradientCap(level);
        const nextL = nextLevelName(level);
        if (!nextL) continue;

        // All entries at this level beyond the active-window cap, oldest first
        // (so cascade goes FIFO). Composite (created_at, id) DESC for active
        // window means OFFSET cap returns entries from rank cap+1 onward in
        // ascending-rank order when iterated.
        const candidates = targetDb.prepare(`
            SELECT id, content, content_type, source_id, session_label, created_at
            FROM gradient_entries
            WHERE agent = ? AND level = ?
            ORDER BY created_at DESC, id DESC
            LIMIT -1 OFFSET ?
        `).all(agent, level, cap) as any[];

        // candidates ordered rank cap+1, cap+2, ... by composite DESC.
        // Iterate from oldest (last in the array) to newest.
        for (let i = candidates.length - 1; i >= 0; i--) {
            const c = candidates[i];
            if (!hasDescendantAt(c.id, nextL)) {
                return { level, nextLevel: nextL, displaced: c };
            }
        }
    }
    return null;
}

// Composite-cursor on (created_at, id) DESC against target's c0 high-water,
// returns the next source c0 (chronologically) not yet in target. Excludes
// dream/felt-moment per the same convention as replay-bump-fill.ts.
function findNextSourceC0(): any | null {
    const resumeRow = targetDb.prepare(`
        SELECT created_at, id FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(agent) as any;

    const resumeTs = resumeRow?.created_at;
    const resumeId = resumeRow?.id;

    const sql = resumeTs
        ? `SELECT * FROM gradient_entries
           WHERE agent = ? AND level = 'c0'
             AND content_type NOT IN ('dream', 'felt-moment')
             AND (created_at > ? OR (created_at = ? AND id > ?))
           ORDER BY created_at ASC, id ASC
           LIMIT 1`
        : `SELECT * FROM gradient_entries
           WHERE agent = ? AND level = 'c0'
             AND content_type NOT IN ('dream', 'felt-moment')
           ORDER BY created_at ASC, id ASC
           LIMIT 1`;

    const params: any[] = [agent];
    if (resumeTs) params.push(resumeTs, resumeTs, resumeId);

    return sourceDb.prepare(sql).get(...params) as any || null;
}

// Statements prepared lazily inside main() so the schema-init pass via
// dynamic import('../src/server/db') has run before we try to prepare
// against a fresh (empty) target file.
let insertEntryStmt: any;
let insertFeelingTagStmt: any;

async function main() {
    // Trigger schema initialisation in target.db. db.ts has CREATE TABLE
    // IF NOT EXISTS at module load time and respects HAN_DB_PATH.
    await import('../src/server/db');

    insertEntryStmt = targetDb.prepare(`
        INSERT INTO gradient_entries
        (id, agent, session_label, level, content, content_type,
         source_id, source_conversation_id, source_message_id,
         provenance_type, created_at, supersedes, change_count, qualifier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertFeelingTagStmt = targetDb.prepare(`
        INSERT INTO feeling_tags (gradient_entry_id, author, tag_type, content, change_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

// ── Mode: next ──────────────────────────────────────────────────

if (mode === 'next') {
    const pending = findPendingCompression();
    if (pending) {
        const sourceContent = String(pending.displaced.content || '');
        const targetChars = Math.max(1, Math.round(sourceContent.length / 3));
        const out = {
            operation: 'compress',
            agent,
            step_id: `compress:${pending.displaced.id}:${pending.level}->${pending.nextLevel}`,
            from_level: pending.level,
            to_level: pending.nextLevel,
            source_id: pending.displaced.id,
            session_label: pending.displaced.session_label,
            content_type: pending.displaced.content_type,
            source_chars: sourceContent.length,
            target_chars: targetChars,
            // Truncate display only — submit reads from DB
            source_content: sourceContent,
            instructions: [
                `Compose the compression in your own voice (${agent}).`,
                `Target ~${targetChars} chars (1/3 of source ${sourceContent.length}).`,
                `Save to /tmp/${agent}-comp-${pending.displaced.id.slice(0, 8)}-${pending.nextLevel}.md`,
                `Emit a feeling tag (single short line capturing the day's tone).`,
                `If compressing further would destroy meaning, use --incompressible with content-file containing the irreducible kernel sentence (max 50 chars).`,
                `Submit: agent-bump-step.ts submit --agent=${agent} --step-id=<step_id> --content-file=<path> --feeling-tag="..."`,
            ],
        };
        console.log(JSON.stringify(out, null, 2));
        process.exit(0);
    }

    const nextSource = findNextSourceC0();
    if (nextSource) {
        const out = {
            operation: 'insert-c0',
            agent,
            step_id: `insert-c0:${nextSource.id}`,
            session_label: nextSource.session_label,
            content_type: nextSource.content_type,
            source_chars: String(nextSource.content || '').length,
            created_at: nextSource.created_at,
            instructions: [
                `Pure replay — no compression needed.`,
                `Submit: agent-bump-step.ts submit --agent=${agent} --step-id=<step_id>`,
            ],
        };
        console.log(JSON.stringify(out, null, 2));
        process.exit(0);
    }

    console.log(JSON.stringify({ operation: 'done', agent }, null, 2));
    process.exit(0);
}

// ── Mode: submit ────────────────────────────────────────────────

if (mode === 'submit') {
    const stepId = arg('step-id');
    const contentFile = arg('content-file');
    const feelingTag = arg('feeling-tag');
    const incompressible = arg('incompressible') === 'true';

    if (!stepId) {
        console.error('--step-id required');
        process.exit(1);
    }

    // ── Insert-c0 (replay source row into target, no compression) ───
    if (stepId.startsWith('insert-c0:')) {
        const sourceId = stepId.slice('insert-c0:'.length);
        const row = sourceDb.prepare(`
            SELECT id, agent, session_label, level, content, content_type,
                   source_id, source_conversation_id, source_message_id,
                   provenance_type, created_at, supersedes, change_count, qualifier
            FROM gradient_entries
            WHERE id = ?
        `).get(sourceId) as any;
        if (!row) {
            console.error(`source row ${sourceId} not found in source-db`);
            process.exit(1);
        }
        if (row.agent !== agent) {
            console.error(`agent mismatch: source row is ${row.agent}, --agent=${agent}`);
            process.exit(1);
        }

        try {
            insertEntryStmt.run(
                row.id, row.agent, row.session_label, 'c0', String(row.content || ''),
                row.content_type, row.source_id, row.source_conversation_id, row.source_message_id,
                row.provenance_type || 'original', row.created_at,
                row.supersedes, row.change_count || 0, row.qualifier
            );
        } catch (e: any) {
            if (String(e?.message || '').includes('UNIQUE constraint')) {
                console.log(JSON.stringify({ ok: true, skipped: 'already_in_target', id: row.id }, null, 2));
                process.exit(0);
            }
            throw e;
        }

        // Copy feeling_tags
        const tags = sourceDb.prepare(`
            SELECT gradient_entry_id, author, tag_type, content, change_reason, created_at
            FROM feeling_tags WHERE gradient_entry_id = ?
        `).all(row.id) as any[];
        for (const t of tags) {
            insertFeelingTagStmt.run(
                t.gradient_entry_id, t.author, t.tag_type, t.content, t.change_reason, t.created_at
            );
        }

        console.log(JSON.stringify({
            ok: true,
            inserted_c0: row.id,
            session_label: row.session_label,
            content_type: row.content_type,
            chars: String(row.content || '').length,
            feeling_tags_copied: tags.length,
        }, null, 2));
        process.exit(0);
    }

    // ── Compress (agent-composed compression) ──────────────────────
    if (stepId.startsWith('compress:')) {
        const m = stepId.match(/^compress:([^:]+):([^-]+)->(.+)$/);
        if (!m) {
            console.error(`malformed step-id: ${stepId} (expected compress:<id>:<from>-><to>)`);
            process.exit(1);
        }
        const displacedId = m[1];
        const fromLevel = m[2];
        const toLevel = m[3];

        const displaced = targetDb.prepare(`
            SELECT id, content, content_type, source_id, session_label, created_at
            FROM gradient_entries
            WHERE id = ? AND agent = ?
        `).get(displacedId, agent) as any;
        if (!displaced) {
            console.error(`displaced entry ${displacedId} not found for agent=${agent}`);
            process.exit(1);
        }

        // Idempotency: if this displaced entry already has a descendant at to_level, refuse.
        if (hasDescendantAt(displacedId, toLevel)) {
            console.error(`already cascaded — ${displacedId} has descendant at ${toLevel}`);
            process.exit(1);
        }

        if (incompressible) {
            // UV path — tag displaced as 'uv' with kernel sentence; no new entry inserted.
            if (!contentFile) {
                console.error('--incompressible requires --content-file containing the kernel sentence');
                process.exit(1);
            }
            const raw = fs.readFileSync(contentFile, 'utf8').trim();
            const kernel = raw.startsWith('INCOMPRESSIBLE:') ? raw.slice('INCOMPRESSIBLE:'.length).trim() : raw;
            if (!kernel) {
                console.error('kernel sentence is empty');
                process.exit(1);
            }
            if (kernel.length > 50) {
                console.error(`kernel sentence too long (${kernel.length} chars, max 50)`);
                process.exit(1);
            }
            insertFeelingTagStmt.run(
                displacedId, agent, 'uv', kernel, null, new Date().toISOString()
            );
            console.log(JSON.stringify({
                ok: true,
                operation: 'incompressible',
                uv_tagged: displacedId,
                kernel,
                cascade_halted_at: fromLevel,
            }, null, 2));
            process.exit(0);
        }

        if (!contentFile) {
            console.error('--content-file required for compress submit (or use --incompressible)');
            process.exit(1);
        }
        const compressed = fs.readFileSync(contentFile, 'utf8');
        if (!compressed.trim()) {
            console.error(`content-file ${contentFile} is empty`);
            process.exit(1);
        }

        const newId = generateId();
        const newLabel = `${displaced.session_label}-${toLevel}`;

        // Cascade timestamp: the displacing entry's created_at (rank=1 at fromLevel) —
        // per Darron's canonical FIFO design, rank reflects when an entry entered the
        // level, not when its content was first born.
        const displacing = targetDb.prepare(`
            SELECT created_at FROM gradient_entries
            WHERE agent = ? AND level = ?
            ORDER BY created_at DESC LIMIT 1
        `).get(agent, fromLevel) as any;
        const cascadeTimestamp = displacing?.created_at || new Date().toISOString();

        insertEntryStmt.run(
            newId, agent, newLabel, toLevel, compressed,
            displaced.content_type,           // content_type lineage carries up
            displaced.id,                     // source_id = the entry being compressed
            null, null,                       // source_conversation_id, source_message_id
            'original',                       // provenance_type
            cascadeTimestamp,
            null, 0, null                     // supersedes, change_count, qualifier
        );

        if (feelingTag) {
            insertFeelingTagStmt.run(
                newId, agent, 'compression', feelingTag, null, new Date().toISOString()
            );
        }

        const sourceChars = String(displaced.content || '').length;
        const ratio = sourceChars > 0 ? sourceChars / Math.max(1, compressed.length) : 0;

        console.log(JSON.stringify({
            ok: true,
            operation: 'compress',
            new_entry_id: newId,
            new_session_label: newLabel,
            new_level: toLevel,
            source_id: displaced.id,
            source_chars: sourceChars,
            target_chars_requested: Math.round(sourceChars / 3),
            actual_chars: compressed.length,
            ratio_actual: Math.round(ratio * 100) / 100,
            ratio_target: 3,
            feeling_tag: feelingTag || null,
            cascade_timestamp: cascadeTimestamp,
        }, null, 2));
        process.exit(0);
    }

    console.error(`unknown step-id format: ${stepId}`);
    process.exit(1);
}

}  // end main()

main().catch((err) => {
    console.error(`[agent-bump-step] fatal: ${err?.message || err}`);
    process.exit(99);
});
