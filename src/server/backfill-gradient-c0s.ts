/**
 * Backfill gradient c0 entries for orphaned c1s.
 *
 * For each orphan c1 (session type), finds the corresponding full working memory
 * archive file, creates a c0 entry from it, and links the c1 to the new c0.
 *
 * Usage: cd src/server && npx tsx backfill-gradient-c0s.ts [--dry-run]
 */

import { gradientStmts } from './db.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

const LEO_ARCHIVES = path.join(process.env.HOME!, '.han/memory/leo/working-memories');
const DREAM_C1_DIR = path.join(process.env.HOME!, '.han/memory/fractal/leo/dreams/c1');
const DB_PATH = path.join(process.env.HOME!, '.han/tasks.db');

const dryRun = process.argv.includes('--dry-run');

// Use direct DB connection for the update statement (gradientStmts doesn't export update)
const db = new Database(DB_PATH);
const updateSourceId = db.prepare('UPDATE gradient_entries SET source_id = ? WHERE id = ?');
const insertEntry = db.prepare(`INSERT INTO gradient_entries
    (id, agent, session_label, level, content, content_type,
     source_id, source_conversation_id, source_message_id,
     provenance_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

// Get all orphan c1s for Leo
const orphanC1s = db.prepare(`
    SELECT id, session_label, content_type, created_at, substr(content, 1, 100) as preview
    FROM gradient_entries
    WHERE agent = 'leo' AND level = 'c1' AND source_id IS NULL
    ORDER BY created_at
`).all() as any[];

console.log(`Found ${orphanC1s.length} orphan c1 entries for Leo`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

// ── Session c1 → Full archive file mapping ──────────────────

// Map session_label to archive filename patterns
function findArchiveFile(sessionLabel: string): string | null {
    // Try full version first (the c0 source), then compressed
    const patterns = [
        `working-memory-full-${sessionLabel}.md`,
        `working-memory-${sessionLabel}.md`,
        // Some early sessions used different naming
        `${sessionLabel}-full.md`,
        `${sessionLabel}.md`,
    ];

    for (const pattern of patterns) {
        const filePath = path.join(LEO_ARCHIVES, pattern);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    // Try case-insensitive match
    try {
        const files = fs.readdirSync(LEO_ARCHIVES);
        const labelLower = sessionLabel.toLowerCase();
        for (const file of files) {
            if (file.toLowerCase().includes(labelLower) && file.includes('full')) {
                return path.join(LEO_ARCHIVES, file);
            }
        }
        // Without 'full' as fallback
        for (const file of files) {
            if (file.toLowerCase().includes(labelLower) && !file.includes('full')) {
                return path.join(LEO_ARCHIVES, file);
            }
        }
    } catch {}

    return null;
}

// ── Dream c1 → Raw dream file mapping ──────────────────────

function findDreamFile(sessionLabel: string): string | null {
    const filePath = path.join(DREAM_C1_DIR, `${sessionLabel}.md`);
    if (fs.existsSync(filePath)) {
        return filePath;
    }
    return null;
}

// ── Working-memory c1 → Source file mapping ─────────────────

// Working-memory c1s come in pairs (2026-03, undated) from heartbeat compression
// The source is the floating file or working memory that was compressed
function findWorkingMemorySource(sessionLabel: string): string | null {
    // These were generated from floating/living working memory files
    // The raw source may be in the archived working memory files
    const patterns = [
        `working-memory-full-${sessionLabel}.md`,
        `working-memory-${sessionLabel}.md`,
    ];

    for (const pattern of patterns) {
        const filePath = path.join(LEO_ARCHIVES, pattern);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    return null;
}

// ── Process each orphan ─────────────────────────────────────

let created = 0;
let linked = 0;
let notFound = 0;
const notFoundList: string[] = [];

const processInTransaction = db.transaction(() => {
    for (const c1 of orphanC1s) {
        const { id, session_label, content_type, created_at } = c1;
        let sourceFile: string | null = null;

        if (content_type === 'session') {
            sourceFile = findArchiveFile(session_label);
        } else if (content_type === 'dream') {
            sourceFile = findDreamFile(session_label);
        } else if (content_type === 'working-memory') {
            sourceFile = findWorkingMemorySource(session_label);
        }

        if (!sourceFile) {
            notFound++;
            notFoundList.push(`  ${content_type}/${session_label}`);
            continue;
        }

        const sourceContent = fs.readFileSync(sourceFile, 'utf-8');
        if (!sourceContent.trim()) {
            notFoundList.push(`  ${content_type}/${session_label} (empty file)`);
            notFound++;
            continue;
        }

        const c0Id = crypto.randomUUID();
        const c0CreatedAt = created_at; // Use same timestamp as c1 for chronological ordering

        if (!dryRun) {
            insertEntry.run(
                c0Id, 'leo', session_label, 'c0', sourceContent, content_type,
                null, null, null, 'backfill', c0CreatedAt
            );
            updateSourceId.run(c0Id, id);
        }

        created++;
        linked++;
        console.log(`✓ ${content_type}/${session_label}: c0 created from ${path.basename(sourceFile)} (${sourceContent.length} chars) → linked to c1 ${id.substring(0, 8)}`);
    }
});

processInTransaction();

console.log(`\n── Summary ──`);
console.log(`c0 entries created: ${created}`);
console.log(`c1 entries linked:  ${linked}`);
console.log(`Not found:          ${notFound}`);

if (notFoundList.length > 0) {
    console.log(`\nMissing source files:`);
    notFoundList.forEach(n => console.log(n));
}

// ── Verify ──────────────────────────────────────────────────

if (!dryRun) {
    const remaining = db.prepare(`
        SELECT content_type, COUNT(*) as count
        FROM gradient_entries
        WHERE agent = 'leo' AND level = 'c1' AND source_id IS NULL
        GROUP BY content_type
    `).all() as any[];

    console.log(`\nRemaining orphan c1s:`);
    for (const r of remaining) {
        console.log(`  ${r.content_type}: ${r.count}`);
    }

    const total = db.prepare(`
        SELECT level, COUNT(*) as total,
          SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) as orphaned
        FROM gradient_entries
        WHERE agent = 'leo'
        GROUP BY level
        ORDER BY level
    `).all() as any[];

    console.log(`\nLeo gradient state:`);
    for (const r of total) {
        console.log(`  ${r.level}: ${r.total} total, ${r.orphaned} orphaned`);
    }
}

db.close();
