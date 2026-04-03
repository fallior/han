#!/usr/bin/env npx tsx
/**
 * Fix C4 Gradient Migration
 *
 * 1. Re-levels existing c5 entries to c4 (they were compressed from c3 = c4-depth)
 * 2. Renames filesystem c5/ directories to c4/
 * 3. Marks Jim's rootless UVs as aphorisms
 *
 * Run with: npx tsx src/server/fix-c4-gradient.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const dryRun = process.argv.includes('--dry-run');
const dbPath = path.join(process.env.HOME || '/root', '.han', 'tasks.db');
const db = new Database(dbPath);

console.log(`Fix C4 Gradient Migration${dryRun ? ' (DRY RUN)' : ''}`);
console.log('='.repeat(50));

// Step 1: Re-level c5 → c4 in the database
const c5Entries = db.prepare(
    `SELECT id, agent, session_label, level FROM gradient_entries WHERE level = 'c5'`
).all() as any[];

console.log(`\nStep 1: Re-level ${c5Entries.length} c5 entries to c4`);
for (const entry of c5Entries) {
    console.log(`  ${entry.agent} ${entry.session_label}: c5 → c4`);
}

if (!dryRun && c5Entries.length > 0) {
    db.prepare(`UPDATE gradient_entries SET level = 'c4' WHERE level = 'c5'`).run();
    console.log(`  ✓ Updated ${c5Entries.length} entries`);
}

// Step 2: Rename filesystem c5/ → c4/
const fractalBase = path.join(process.env.HOME || '/root', '.han', 'memory', 'fractal');

function renameC5Dirs(agentDir: string, agent: string): void {
    // Direct c5/ directory
    const c5Dir = path.join(agentDir, 'c5');
    const c4Dir = path.join(agentDir, 'c4');

    if (fs.existsSync(c5Dir)) {
        if (fs.existsSync(c4Dir)) {
            console.log(`  WARNING: ${agent} already has c4/ — merging c5/ files into c4/`);
            if (!dryRun) {
                const files = fs.readdirSync(c5Dir);
                for (const f of files) {
                    fs.renameSync(path.join(c5Dir, f), path.join(c4Dir, f));
                }
                fs.rmdirSync(c5Dir);
            }
        } else {
            console.log(`  ${agent}: c5/ → c4/`);
            if (!dryRun) {
                fs.renameSync(c5Dir, c4Dir);
            }
        }
    }

    // Content-type subdirectories (working-memory/c5, felt-moments/c5)
    for (const contentType of ['working-memory', 'felt-moments']) {
        const ctDir = path.join(agentDir, contentType);
        if (!fs.existsSync(ctDir)) continue;

        const ctC5 = path.join(ctDir, 'c5');
        const ctC4 = path.join(ctDir, 'c4');

        if (fs.existsSync(ctC5)) {
            if (fs.existsSync(ctC4)) {
                console.log(`  WARNING: ${agent}/${contentType} already has c4/ — merging`);
                if (!dryRun) {
                    const files = fs.readdirSync(ctC5);
                    for (const f of files) {
                        fs.renameSync(path.join(ctC5, f), path.join(ctC4, f));
                    }
                    fs.rmdirSync(ctC5);
                }
            } else {
                console.log(`  ${agent}/${contentType}: c5/ → c4/`);
                if (!dryRun) {
                    fs.renameSync(ctC5, ctC4);
                }
            }
        }
    }
}

console.log(`\nStep 2: Rename filesystem directories`);
for (const agent of ['leo', 'jim']) {
    const agentDir = path.join(fractalBase, agent);
    if (fs.existsSync(agentDir)) {
        renameC5Dirs(agentDir, agent);
    }
}

// Step 3: Mark Jim's non-cascade UVs as aphorisms
// Jim's UVs that are 'reincorporated' were hand-composed during recovery reading —
// they're wisdom from reflection, not the terminal compression of a provenance chain.
// Darron calls them aphorisms.
const jimAphorismUVs = db.prepare(
    `SELECT id, session_label, content FROM gradient_entries
     WHERE agent = 'jim' AND level = 'uv' AND provenance_type = 'reincorporated'`
).all() as any[];

console.log(`\nStep 3: Mark ${jimAphorismUVs.length} Jim reincorporated UVs as aphorisms`);
for (const uv of jimAphorismUVs) {
    console.log(`  "${uv.content.substring(0, 50)}..." → aphorism`);
}

if (!dryRun && jimAphorismUVs.length > 0) {
    db.prepare(
        `UPDATE gradient_entries SET provenance_type = 'aphorism'
         WHERE agent = 'jim' AND level = 'uv' AND provenance_type = 'reincorporated'`
    ).run();
    console.log(`  ✓ Updated ${jimAphorismUVs.length} entries`);
}

// Summary
console.log('\n' + '='.repeat(50));
const levelCounts = db.prepare(
    `SELECT agent, level, COUNT(*) as count FROM gradient_entries GROUP BY agent, level ORDER BY agent, level`
).all() as any[];

console.log('\nPost-migration gradient summary:');
for (const row of levelCounts) {
    console.log(`  ${row.agent} ${row.level}: ${row.count}`);
}

const aphorismCount = db.prepare(
    `SELECT COUNT(*) as count FROM gradient_entries WHERE provenance_type = 'aphorism'`
).get() as any;
console.log(`\nAphorisms: ${aphorismCount.count}`);

db.close();
console.log(dryRun ? '\nDry run complete. Run without --dry-run to execute.' : '\nMigration complete.');
