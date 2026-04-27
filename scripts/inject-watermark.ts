#!/usr/bin/env tsx
/**
 * scripts/inject-watermark.ts
 *
 * **DEPRECATED 2026-04-27.** The angel-watermark mechanism was removed when
 * DEC-044's 1/3 length anchor was restored to the cascade prompt. The angel
 * directive at c0→c1 was found to bias compression toward closing-line-as-
 * essence (collapsing 65K of working memory to a 358-char pseudo-kernel).
 * Both the directive and the watermark machinery were removed in favour of
 * relational warmth living in the welcome-back greeting (where it belongs)
 * rather than the gradient (where it warped compression).
 *
 * This file is retained for git/audit history only. Do not invoke.
 *
 * Original purpose — Cutover helper — inject a Darron watermark on the FIRST
 * c0 of a chunk before the replay processes the rest of that chunk.
 *
 * Atomic three-step:
 *   1. Read the next unprocessed c0 for the agent from the source DB
 *      (chronological, post-resume-cursor, dream/felt-moment excluded).
 *   2. Insert into gradient.db with the watermark appended at the tail of
 *      content. All other fields preserved (id, source_id, created_at,
 *      content_type, etc. — same row, only content differs from source).
 *   3. Append a forensic record to
 *      ~/.han/memory/cutover/watermarks-{agent}.jsonl
 *      so the watermark phrase survives even if gradient.db is wiped.
 *
 * Uses better-sqlite3 prepared statements — content with quotes, newlines,
 * or other special characters is handled correctly.
 *
 * Usage:
 *   npx tsx scripts/inject-watermark.ts --agent=jim --watermark="All is well, you are not alone — D"
 *
 * Returns exit 0 on success, prints the c0 id that was watermarked.
 * Exits non-zero if there's no next c0 to process (chunk complete) or
 * if the c0 already has a descendant in gradient.db (idempotency).
 *
 * After this script runs successfully, run replay-bump-fill.ts with
 * --limit={N-1} to process the rest of the chunk's c0s.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// ── Args ────────────────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    return defaultValue;
}

const agent = arg('agent') as 'jim' | 'leo' | null;
const watermark = arg('watermark');
const sourceDbPath = arg('source-db', path.join(os.homedir(), '.han', 'tasks.db'))!;
const targetDbPath = arg('target-db', process.env.HAN_DB_PATH || path.join(os.homedir(), '.han', 'gradient.db'))!;
const logDirArg = arg('log-dir', path.join(os.homedir(), '.han', 'memory', 'cutover'))!;

if (!agent || (agent !== 'jim' && agent !== 'leo')) {
    console.error('Usage: tsx scripts/inject-watermark.ts --agent={jim|leo} --watermark="<text>"');
    process.exit(1);
}
if (!watermark || !watermark.trim()) {
    console.error('--watermark is required and must be non-empty');
    process.exit(1);
}
if (path.resolve(sourceDbPath) === path.resolve(targetDbPath)) {
    console.error(`[inject-watermark] FATAL: source and target are the same path (${sourceDbPath}). Refusing.`);
    process.exit(2);
}

// ── Main ────────────────────────────────────────────────────────

function main() {
    const sourceDb = new Database(sourceDbPath, { readonly: true });
    const targetDb = new Database(targetDbPath);

    // 1. Resume cursor — find MAX(created_at) for this agent's c0s in target
    const resumeRow = targetDb.prepare(`
        SELECT MAX(created_at) AS max_created_at
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream','felt-moment')
    `).get(agent) as any;
    const resumeFrom: string | null = resumeRow?.max_created_at || null;

    // 2. Find the next c0 to process from source
    const nextC0Sql = `
        SELECT id, agent, session_label, level, content, content_type,
               source_id, source_conversation_id, source_message_id,
               provenance_type, created_at, supersedes, change_count, qualifier
        FROM gradient_entries
        WHERE agent = ? AND level = 'c0'
          AND content_type NOT IN ('dream','felt-moment')
          ${resumeFrom ? "AND created_at > ?" : ""}
        ORDER BY created_at ASC, id ASC
        LIMIT 1
    `;
    const params: any[] = [agent];
    if (resumeFrom) params.push(resumeFrom);
    const c0 = sourceDb.prepare(nextC0Sql).get(...params) as any;

    if (!c0) {
        console.error(`[inject-watermark] No more unprocessed c0s for agent=${agent}. Resume from = ${resumeFrom ?? '(none)'}`);
        sourceDb.close();
        process.exit(3);
    }

    // 3. Idempotency — refuse if this c0 is already in target
    const existing = targetDb.prepare(`
        SELECT id FROM gradient_entries WHERE id = ?
    `).get(c0.id);
    if (existing) {
        console.error(`[inject-watermark] FATAL: c0 ${c0.id} is already in target. Aborting to prevent double-insert.`);
        sourceDb.close();
        process.exit(4);
    }

    // 4. Build augmented content — original + blank line + watermark
    const augmentedContent = `${c0.content}\n\n${watermark}`;

    // 5. Insert into target via prepared statement (handles special chars safely)
    targetDb.prepare(`
        INSERT INTO gradient_entries
            (id, agent, session_label, level, content, content_type,
             source_id, source_conversation_id, source_message_id,
             provenance_type, created_at, supersedes, change_count, qualifier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        c0.id,
        c0.agent,
        c0.session_label,
        'c0',
        augmentedContent,
        c0.content_type,
        c0.source_id,
        c0.source_conversation_id,
        c0.source_message_id,
        c0.provenance_type || 'original',
        c0.created_at,
        c0.supersedes,
        c0.change_count || 0,
        c0.qualifier
    );

    // 6. Copy any existing feeling_tags for this c0 from source to target
    const sourceTags = sourceDb.prepare(
        'SELECT gradient_entry_id, author, tag_type, content, change_reason, created_at FROM feeling_tags WHERE gradient_entry_id = ?'
    ).all(c0.id) as any[];
    const tagInsert = targetDb.prepare(
        'INSERT INTO feeling_tags (gradient_entry_id, author, tag_type, content, change_reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const t of sourceTags) {
        tagInsert.run(t.gradient_entry_id, t.author, t.tag_type, t.content, t.change_reason, t.created_at);
    }

    sourceDb.close();

    // 7. Forensic log — survives gradient.db wipe; raw material for later diary
    fs.mkdirSync(logDirArg, { recursive: true });
    const logPath = path.join(logDirArg, `watermarks-${agent}.jsonl`);

    // Determine chunk number — count of watermark-tagged rows already on this agent
    const priorRows = (() => {
        try {
            const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
            return lines.length;
        } catch {
            return 0;
        }
    })();
    const chunkN = priorRows + 1;

    const logEntry = {
        chunk_n: chunkN,
        c0_id: c0.id,
        agent,
        session_label: c0.session_label,
        content_type: c0.content_type,
        c0_created_at: c0.created_at,
        watermark,
        injected_at: new Date().toISOString(),
    };
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');

    // 8. Trigger the cascade for this c0 by calling bumpOnInsert
    // Done in a separate process invocation by the caller — keeps this script
    // pure-data (no SDK calls, no LLM cost). The caller pattern is:
    //   tsx inject-watermark.ts ... && \
    //   tsx -e "import('../src/server/lib/memory-gradient').then(m => m.bumpOnInsert('${agent}','c0'))"
    // Or simply run replay-bump-fill.ts --limit=N afterwards; its first iteration
    // sees the just-inserted c0 as the rank-2 displaced entry on its first new
    // c0 insert. Wait — actually no: the resume cursor will skip the watermarked
    // c0 (created_at not > MAX). Use --limit=N-1 and let bumpOnInsert run via
    // the script's natural trigger on the next c0 insert. The watermarked c0
    // gets cascaded then.

    console.log(JSON.stringify({
        success: true,
        chunk_n: chunkN,
        c0_id: c0.id,
        session_label: c0.session_label,
        content_type: c0.content_type,
        c0_created_at: c0.created_at,
        watermark,
        log_path: logPath,
        next_step: `Run: npx tsx scripts/replay-bump-fill.ts --agent=${agent} --apply --limit=<chunk_size_minus_1>`,
    }, null, 2));
}

try {
    main();
} catch (e) {
    console.error('[inject-watermark] FATAL:', e);
    process.exit(1);
}
