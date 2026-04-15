/**
 * Backfill gradient chains — link orphan entries to their parents.
 *
 * Supports both Leo and Jim agents. Also creates missing c1 entries
 * for pre-DB sessions (36-48) from archive files (Leo only).
 *
 * Usage: cd src/server && npx tsx backfill-gradient-chains.ts [--dry-run] [--agent=jim|leo|both]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

const LEO_ARCHIVES = path.join(process.env.HOME!, '.han/memory/leo/working-memories');
const DB_PATH = path.join(process.env.HOME!, '.han/tasks.db');

const dryRun = process.argv.includes('--dry-run');
const agentArg = process.argv.find(a => a.startsWith('--agent='))?.split('=')[1] || 'both';
const agents: string[] = agentArg === 'both' ? ['leo', 'jim'] : [agentArg];
const db = new Database(DB_PATH);

const insertEntry = db.prepare(`INSERT INTO gradient_entries
    (id, agent, session_label, level, content, content_type,
     source_id, source_conversation_id, source_message_id,
     provenance_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const updateSourceId = db.prepare('UPDATE gradient_entries SET source_id = ? WHERE id = ?');

// ── Helper: find c1 or c0 by session label patterns ────────

function findEntryByLabelPattern(agent: string, level: string, patterns: string[]): any | null {
    for (const pattern of patterns) {
        const exact = db.prepare(
            'SELECT * FROM gradient_entries WHERE agent = ? AND level = ? AND session_label = ?'
        ).get(agent, level, pattern);
        if (exact) return exact;
    }
    // Try LIKE match
    for (const pattern of patterns) {
        const like = db.prepare(
            'SELECT * FROM gradient_entries WHERE agent = ? AND level = ? AND session_label LIKE ?'
        ).get(agent, level, `%${pattern}%`);
        if (like) return like;
    }
    return null;
}

// ── Parse c2/c3/c5 labels to extract source session references ──

function parseSourceLabels(label: string): string[] {
    // Labels like: s36-c1_to_s45-c1, s49-c1_to_s56-c1_to_s58-59-2026-03-04-c1
    // Split on _to_ and extract the session part (before -c1, -c2, -c3, -c5)
    const parts = label.split('_to_');
    return parts.map(p => p.replace(/-c[0-5]$/, '').replace(/-c1$/, ''));
}

// ── Map abbreviated labels to DB labels ────────────────────

function sessionLabelVariants(abbrev: string): string[] {
    // Generate possible DB labels from abbreviated form
    const variants = [abbrev];

    // s36 → session-36, session36
    if (/^s(\d+)$/.test(abbrev)) {
        const num = abbrev.slice(1);
        variants.push(`session-${num}`, `session${num}`);
        // Also try with date suffix
        variants.push(`session-${num}-`, `session${num}-`);
    }
    // session-50 → s50, session50
    if (/^session-(\d+)$/.test(abbrev)) {
        const num = abbrev.replace('session-', '');
        variants.push(`s${num}`, `session${num}`);
    }
    // session49-2026-03-02 → s49, session-49
    if (/^session(\d+)/.test(abbrev)) {
        const match = abbrev.match(/^session(\d+)/);
        if (match) {
            variants.push(`s${match[1]}`, `session-${match[1]}`);
        }
    }

    return variants;
}

// ── Pre-DB session archives (sessions without c1 entries) ──

interface ArchiveMapping {
    c0File: string | null;
    c1File: string | null;
}

function findArchiveForSession(sessionNum: string): ArchiveMapping {
    const files = fs.readdirSync(LEO_ARCHIVES);
    let c0File: string | null = null;
    let c1File: string | null = null;

    for (const file of files) {
        const lower = file.toLowerCase();
        const sessionPatterns = [
            `session-${sessionNum}`,
            `session${sessionNum}`,
            `s${sessionNum}`,
        ];

        for (const pat of sessionPatterns) {
            if (lower.includes(pat.toLowerCase())) {
                const fullPath = path.join(LEO_ARCHIVES, file);
                if (file.includes('full')) {
                    c0File = fullPath;
                } else if (!file.includes('self-reflection')) {
                    c1File = fullPath;
                }
            }
        }
    }

    return { c0File, c1File };
}

// ── Create missing c1 (and c0) for a pre-DB session ────────

function ensureC1Exists(sessionLabel: string): string | null {
    // Check if c1 already exists
    const variants = sessionLabelVariants(sessionLabel);
    const existing = findEntryByLabelPattern('leo', 'c1', variants);
    if (existing) return existing.id;

    // Extract session number
    const numMatch = sessionLabel.match(/(\d+)/);
    if (!numMatch) return null;
    const sessionNum = numMatch[1];

    const archive = findArchiveForSession(sessionNum);
    if (!archive.c0File && !archive.c1File) {
        return null;
    }

    // Create c0 from full archive if we have it
    let c0Id: string | null = null;
    const existingC0 = findEntryByLabelPattern('leo', 'c0', variants);
    if (existingC0) {
        c0Id = existingC0.id;
    } else if (archive.c0File) {
        const content = fs.readFileSync(archive.c0File, 'utf-8');
        if (content.trim()) {
            c0Id = crypto.randomUUID();
            if (!dryRun) {
                insertEntry.run(c0Id, 'leo', sessionLabel, 'c0', content, 'session',
                    null, null, null, 'backfill', new Date().toISOString());
            }
            console.log(`  + c0 created for ${sessionLabel} from ${path.basename(archive.c0File)}`);
        }
    }

    // Create c1 from compressed archive
    const c1Source = archive.c1File || archive.c0File; // Fall back to full if no compressed
    if (!c1Source) return null;

    const c1Content = fs.readFileSync(c1Source, 'utf-8');
    if (!c1Content.trim()) return null;

    const c1Id = crypto.randomUUID();
    if (!dryRun) {
        insertEntry.run(c1Id, 'leo', sessionLabel, 'c1', c1Content, 'session',
            c0Id, null, null, 'backfill', new Date().toISOString());
    }
    console.log(`  + c1 created for ${sessionLabel} from ${path.basename(c1Source)}`);
    return c1Id;
}

// ── Find parent for an orphan entry ────────────────────────

function findParent(entry: any, agent: string): string | null {
    const label = entry.session_label;
    const level = entry.level;

    // Determine parent level
    const n = level.match(/^c(\d+)$/);
    const parentLevel = n ? (parseInt(n[1]) > 1 ? `c${parseInt(n[1]) - 1}` : 'c0') : null;
    if (!parentLevel) return null;

    // Parse source labels from the entry label
    const sourceLabels = parseSourceLabels(label);

    // Try to find a parent entry
    for (const srcLabel of sourceLabels) {
        const variants = sessionLabelVariants(srcLabel);
        const parent = findEntryByLabelPattern(agent, parentLevel, variants);
        if (parent) return parent.id;
    }

    // For Leo c2s: try creating missing c1s from archives
    if (agent === 'leo' && level === 'c2') {
        for (const srcLabel of sourceLabels) {
            const c1Id = ensureC1Exists(srcLabel);
            if (c1Id) return c1Id;
        }
    }

    // For entries above c1: try finding parent by session overlap (LIKE search)
    const levelNum = parseInt(n![1]);
    if (levelNum >= 2) {
        for (const srcLabel of sourceLabels) {
            const variants = sessionLabelVariants(srcLabel);
            for (const v of variants) {
                const parent = db.prepare(
                    "SELECT * FROM gradient_entries WHERE agent = ? AND level = ? AND session_label LIKE ?"
                ).get(agent, parentLevel, `%${v}%`) as any;
                if (parent) return parent.id;
            }
        }
    }

    return null;
}

// ── Main ────────────────────────────────────────────────────

console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Agents: ${agents.join(', ')}\n`);

let totalLinked = 0;
let totalCreated = 0;
let totalNotFound = 0;

const processAll = db.transaction(() => {
    for (const agent of agents) {
        console.log(`\n════ ${agent.toUpperCase()} ════`);

        // Discover all levels that exist above c1 for this agent
        const allLevels = [...new Set(
            (db.prepare('SELECT DISTINCT level FROM gradient_entries WHERE agent = ?').all(agent) as any[])
                .map((e: any) => e.level as string)
        )]
            .filter(l => /^c\d+$/.test(l) && parseInt(l.replace('c','')) > 1)
            .sort((a, b) => parseInt(a.replace('c','')) - parseInt(b.replace('c','')));

        // Also include c1 orphans (entries that should link to c0)
        const levels = ['c1', ...allLevels];

        for (const level of levels) {
            const orphans = db.prepare(`
                SELECT * FROM gradient_entries
                WHERE agent = ? AND level = ? AND source_id IS NULL
                ORDER BY created_at
            `).all(agent, level) as any[];

            if (orphans.length === 0) continue;
            console.log(`\n── ${level.toUpperCase()} orphans: ${orphans.length} ──`);

            for (const entry of orphans) {
                const parentId = findParent(entry, agent);
                if (parentId) {
                    if (!dryRun) {
                        updateSourceId.run(parentId, entry.id);
                    }
                    totalLinked++;
                    console.log(`  ✓ ${level}/${entry.session_label} → linked to ${parentId.substring(0, 8)}`);
                } else {
                    totalNotFound++;
                    console.log(`  ✗ ${level}/${entry.session_label} — no parent found`);
                }
            }
        }
    }
});

processAll();

// ── Summary ─────────────────────────────────────────────────

console.log(`\n── Summary ──`);
console.log(`Entries linked:   ${totalLinked}`);
console.log(`Entries created:  ${totalCreated}`);
console.log(`Not found:        ${totalNotFound}`);

if (!dryRun) {
    for (const agent of agents) {
        const state = db.prepare(`
            SELECT level, COUNT(*) as total,
              SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) as orphaned
            FROM gradient_entries WHERE agent = ?
            GROUP BY level ORDER BY level
        `).all(agent) as any[];

        console.log(`\n${agent} gradient state:`);
        for (const r of state) {
            console.log(`  ${r.level}: ${r.total} total, ${r.orphaned} orphaned`);
        }
    }
}

db.close();
