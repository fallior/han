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

// Token counting — Phase A token refactor (S145, 2026-04-30). Mirrors the
// canonical helper at src/server/lib/token-counter.ts; inlined here to avoid
// cross-tree import path concerns when this script runs from scripts/ with
// NODE_PATH=src/server/node_modules. Update both places if the heuristic
// changes (e.g., real tokenizer swap-in).
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
// Phase A.1 (S145, 2026-04-30): filter superseded descendants so a source
// whose only c1 is superseded is treated as "no live descendant" — eligible
// for re-cascade. Matches the semantics in memory-gradient.ts's hasDescendantAtLevel.
function hasDescendantAt(sourceId: string, atLevel: string): boolean {
    const row = targetDb.prepare(`
        SELECT 1 FROM gradient_entries
        WHERE agent = ? AND level = ? AND source_id = ?
          AND superseded_by IS NULL
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
        // ascending-rank order when iterated. cascade_halted_at is selected so
        // the iterator can skip entries that have already hit irreducibility
        // (UV-tagged via --incompressible) — those entries occupy slots and
        // count toward cap, but are ineligible for further compression.
        // Phase A.1 (S145, 2026-04-30): superseded rows are invisible to bump
        // mechanics — vacated for occupation per Darron's valence-shell framing.
        const candidates = targetDb.prepare(`
            SELECT id, content, content_type, source_id, session_label, created_at,
                   cascade_halted_at
            FROM gradient_entries
            WHERE agent = ? AND level = ?
              AND superseded_by IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT -1 OFFSET ?
        `).all(agent, level, cap) as any[];

        // candidates ordered rank cap+1, cap+2, ... by composite DESC.
        // Iterate from oldest (last in the array) to newest. Skip UV-halted
        // entries — they're at kernel and will never compress further.
        for (let i = candidates.length - 1; i >= 0; i--) {
            const c = candidates[i];
            if (c.cascade_halted_at) continue;
            if (!hasDescendantAt(c.id, nextL)) {
                return { level, nextLevel: nextL, displaced: c };
            }
        }
    }
    return null;
}

// Returns the next source c0 (chronologically) not yet in target. Excludes
// dream/felt-moment per the same convention as replay-bump-fill.ts.
//
// S145 fix (cursor-skip on tied timestamps): the previous composite-cursor
// `(created_at = resumeTs AND id > resumeId)` walked forward correctly under
// monotonic insertion but silently skipped tied-timestamp siblings whose id
// sorted BETWEEN already-inserted ties. (Surfaced S144 — Mar 6 part 2 was
// skipped because target had Mar 6 part 1 and Mar 6 part 3 sharing the same
// timestamp; the cursor anchored on the higher-id of the two and never
// returned for the lower-id one.)
//
// Fixed approach: walk ALL uncascaded ties at the resume timestamp before
// advancing. We compute the set of target ids at the maximum c0 timestamp,
// then either (a) return a source row at that same timestamp whose id is NOT
// in the target set, or (b) advance to a source row strictly past that
// timestamp. Once all ties are processed, (a) returns nothing and we fall
// through to (b).
function findNextSourceC0(): any | null {
    const maxTsRow = targetDb.prepare(`
        SELECT MAX(created_at) AS max_ts FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
    `).get(agent) as any;

    const maxTs = maxTsRow?.max_ts;

    if (!maxTs) {
        // No c0s in target yet — return first source row.
        return sourceDb.prepare(`
            SELECT * FROM gradient_entries
            WHERE agent = ? AND level = 'c0'
              AND content_type NOT IN ('dream', 'felt-moment')
            ORDER BY created_at ASC, id ASC
            LIMIT 1
        `).get(agent) as any || null;
    }

    const idsAtMaxTs = (targetDb.prepare(`
        SELECT id FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream', 'felt-moment')
          AND created_at = ?
    `).all(agent, maxTs) as any[]).map(r => r.id as string);

    const placeholders = idsAtMaxTs.map(() => '?').join(',');
    const tieClause = idsAtMaxTs.length > 0
        ? `(created_at = ? AND id NOT IN (${placeholders})) OR created_at > ?`
        : `created_at > ?`;

    const sql = `SELECT * FROM gradient_entries
                 WHERE agent = ? AND level = 'c0'
                   AND content_type NOT IN ('dream', 'felt-moment')
                   AND (${tieClause})
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1`;

    const params: any[] = [agent];
    if (idsAtMaxTs.length > 0) {
        params.push(maxTs, ...idsAtMaxTs, maxTs);
    } else {
        params.push(maxTs);
    }

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
    // Phase 3 (DEC-079): consult the pending_compressions queue first. The
    // bump engine enqueues here when a c0 (or cN) insert produces a
    // displacement. findPendingCompression below remains as fallback for
    // direct rebuild use that runs outside the queue (e.g., re-feeding
    // migrated rolling-c0s before the sensor wires up Phase 4).
    //
    // Stale-claim recovery: rows whose claimed_at > 10 min old and
    // completed_at IS NULL are re-claimable — claimer crashed or session
    // ended. Atomic via a transaction so two `next` invocations don't
    // double-claim the same row.
    const STALE_CLAIM_MINUTES = 10;
    const claimer = `${agent}-direct`;
    const claimQueueTxn = targetDb.transaction(() => {
        const row = targetDb.prepare(`
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
        `).get(agent) as any;
        if (!row) return null;
        targetDb.prepare(`
            UPDATE pending_compressions
            SET claimed_at = datetime('now'), claimed_by = ?
            WHERE id = ?
        `).run(claimer, row.id);
        return row;
    });
    const queued = claimQueueTxn();
    if (queued) {
        const sourceContent = String(queued.source_content || '');
        const sourceTokens = countTokens(sourceContent);
        const targetTokens = Math.max(1, Math.round(sourceTokens / 3));
        const out = {
            operation: 'compress',
            agent,
            step_id: `compress:${queued.source_id}:${queued.from_level}->${queued.to_level}`,
            from_level: queued.from_level,
            to_level: queued.to_level,
            source_id: queued.source_id,
            session_label: queued.source_session_label,
            content_type: queued.source_content_type,
            source_tokens: sourceTokens,
            target_tokens: targetTokens,
            source_content: sourceContent,
            from_queue: true,
            pending_id: queued.id,
            instructions: [
                `Compose the compression in your own voice (${agent}).`,
                `Target ~${targetTokens} tokens (1/3 of source ${sourceTokens} tokens).`,
                `Save to /tmp/${agent}-comp-${queued.source_id.slice(0, 8)}-${queued.to_level}.md`,
                `Emit a feeling tag (single short line capturing the day's tone).`,
                `If compressing further would destroy meaning, use --incompressible with content-file containing the irreducible kernel sentence (max 50 chars).`,
                `Submit: agent-bump-step.ts submit --agent=${agent} --step-id=<step_id> --content-file=<path> --feeling-tag="..."`,
                `(Step came from queue; submission auto-completes pending row ${queued.id}.)`,
            ],
        };
        console.log(JSON.stringify(out, null, 2));
        process.exit(0);
    }

    const pending = findPendingCompression();
    if (pending) {
        const sourceContent = String(pending.displaced.content || '');
        const sourceTokens = countTokens(sourceContent);
        const targetTokens = Math.max(1, Math.round(sourceTokens / 3));
        const out = {
            operation: 'compress',
            agent,
            step_id: `compress:${pending.displaced.id}:${pending.level}->${pending.nextLevel}`,
            from_level: pending.level,
            to_level: pending.nextLevel,
            source_id: pending.displaced.id,
            session_label: pending.displaced.session_label,
            content_type: pending.displaced.content_type,
            source_tokens: sourceTokens,
            target_tokens: targetTokens,
            // Truncate display only — submit reads from DB
            source_content: sourceContent,
            instructions: [
                `Compose the compression in your own voice (${agent}).`,
                `Target ~${targetTokens} tokens (1/3 of source ${sourceTokens} tokens).`,
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
            // Persist the halt — selector reads cascade_halted_at to skip
            // already-UV'd entries. Without this UPDATE, findPendingCompression
            // would re-offer the same step on every `next` call (Jim hit this
            // at op 5 of his S145 100-op session, c7→c8). The UV feeling_tag
            // carries the kernel sentence; this column carries the halt flag.
            // Both are load-bearing.
            targetDb.prepare(
                `UPDATE gradient_entries SET cascade_halted_at = ?
                 WHERE id = ? AND agent = ?`
            ).run(fromLevel, displacedId, agent);
            // Phase 3 (DEC-079): if this step came from the queue, mark the
            // pending row complete. UV is a valid completion — the cascade
            // halts at the kernel and the queue should reflect that. No-op
            // for direct rebuild use that didn't go through the queue.
            const uvCompleteResult = targetDb.prepare(`
                UPDATE pending_compressions
                SET completed_at = datetime('now')
                WHERE agent = ? AND source_id = ? AND from_level = ?
                  AND completed_at IS NULL
            `).run(agent, displacedId, fromLevel);
            console.log(JSON.stringify({
                ok: true,
                operation: 'incompressible',
                uv_tagged: displacedId,
                kernel,
                cascade_halted_at: fromLevel,
                pending_completed: uvCompleteResult.changes > 0,
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

        // Phase 3 (DEC-079): if this step came from the queue, mark the pending
        // row complete. No-op for direct rebuild use that didn't go through the
        // queue (the UPDATE matches zero rows and exits cleanly).
        const compressCompleteResult = targetDb.prepare(`
            UPDATE pending_compressions
            SET completed_at = datetime('now')
            WHERE agent = ? AND source_id = ? AND from_level = ?
              AND completed_at IS NULL
        `).run(agent, displaced.id, fromLevel);

        // Phase A.1 (S145, 2026-04-30) — cascade propagation. After the new
        // entry at toLevel lands, enqueue the next-level compression if rank-
        // cap+1 at toLevel needs it. This is what makes c0→c1→c2→...→UV
        // propagate automatically per Darron's design. Skips if cascade-paused
        // or no further level. Mirrors the enqueueCascadeIfNeeded logic in
        // process-pending-compression.ts for symmetric behaviour across
        // submission paths (manual rebuild via agent-bump-step submit; auto
        // via parallel agent).
        const CASCADE_PAUSED_FILE = path.join(os.homedir(), '.han', 'signals', 'cascade-paused');
        const cascadePaused = fs.existsSync(CASCADE_PAUSED_FILE);
        if (!cascadePaused) {
            const cap = gradientCap(toLevel);
            const nextL = nextLevelName(toLevel);
            if (nextL) {
                const nextDisplaced = targetDb.prepare(`
                    SELECT id FROM gradient_entries
                    WHERE agent = ? AND level = ?
                      AND cascade_halted_at IS NULL
                      AND superseded_by IS NULL
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1 OFFSET ?
                `).get(agent, toLevel, cap) as { id: string } | undefined;
                if (nextDisplaced && !hasDescendantAt(nextDisplaced.id, nextL)) {
                    const newPendingId = generateId();
                    targetDb.prepare(`
                        INSERT OR IGNORE INTO pending_compressions
                            (id, agent, source_id, from_level, to_level, enqueued_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(newPendingId, agent, nextDisplaced.id, toLevel, nextL, new Date().toISOString());
                }
            }
        }

        const sourceTokens = countTokens(String(displaced.content || ''));
        const compressedTokens = countTokens(compressed);
        const ratio = sourceTokens > 0 ? sourceTokens / Math.max(1, compressedTokens) : 0;

        console.log(JSON.stringify({
            ok: true,
            operation: 'compress',
            new_entry_id: newId,
            new_session_label: newLabel,
            new_level: toLevel,
            source_id: displaced.id,
            source_tokens: sourceTokens,
            target_tokens_requested: Math.round(sourceTokens / 3),
            actual_tokens: compressedTokens,
            ratio_actual: Math.round(ratio * 100) / 100,
            ratio_target: 3,
            feeling_tag: feelingTag || null,
            pending_completed: compressCompleteResult.changes > 0,
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
