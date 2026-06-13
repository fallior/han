#!/usr/bin/env npx tsx
/**
 * check-human-signatures.ts — DEC-093 humans-PR thaw verification (Jim's audit point iii).
 *
 * After flipping human-response → tmux, the warm spoke loads the FULL session identity at
 * its welcome-back wake — and that identity carries the `(session)` signature convention
 * (CLAUDE.md: session-Leo signs "— Leo (session)"). The txn prompt's continuation framing
 * OVERRIDES it to `(human)` and forbids `(session)`. This script verifies the override held
 * at runtime: a `(session)` signature on a human-seat post would false-match leo-human's own
 * self-recognition scan ("I already said that") and is the structural bug the (human) vs
 * (session) split exists to prevent.
 *
 * It scans the latest N human-seat posts per agent (the id-prefix is the deterministic
 * self-marker — every *-human INSERT prepends it) and flags any that:
 *   • sign `(session)`  (wrong seat label), OR
 *   • omit `(human)`    (bare `— Leo` / `— Jim`, the S151 jim-human false-match bug).
 *
 * Output: human-readable report to stdout. On ANY violation → loud stderr + ntfy (topic from
 * ~/.han/config.json:ntfy_topic, if set) + exit 2 (the exit code is the machine signal a
 * cron/obs wrapper keys off; ntfy is best-effort). Clean → exit 0.
 *
 * Usage:  npx tsx scripts/check-human-signatures.ts [N=3] [--since=ISO]
 *   N        latest posts per seat to scan (default 3)
 *   --since  only consider posts at/after this ISO timestamp (e.g. the flip time)
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const HOME = process.env.HOME || '/home/darron';
const DB_PATH = process.env.HAN_DB_PATH || path.join(HOME, '.han', 'gradient.db');

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a))) || 3;
const sinceArg = args.find((a) => a.startsWith('--since='))?.slice('--since='.length);

interface Seat { agent: string; role: string; idPrefix: string; name: string; }
const SEATS: Seat[] = [
    { agent: 'leo', role: 'leo', idPrefix: 'leo-', name: 'Leo' },
    { agent: 'jim', role: 'supervisor', idPrefix: 'jim-', name: 'Jim' },
];

function ntfy(msg: string): void {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.han', 'config.json'), 'utf-8'));
        const topic = cfg?.ntfy_topic;
        if (!topic) return;
        execFileSync('curl', ['-sS', '-m', '8', '-H', 'Title: HAN human-signature check', '-d', msg, `https://ntfy.sh/${topic}`], { stdio: 'ignore' });
    } catch { /* best effort — exit code is the primary signal */ }
}

function main(): void {
    const db = new Database(DB_PATH, { readonly: true });
    const violations: string[] = [];
    let scanned = 0;

    for (const seat of SEATS) {
        const rows = db.prepare(`
            SELECT id, content, created_at FROM conversation_messages
            WHERE role = ? AND id LIKE ? ${sinceArg ? 'AND created_at >= ?' : ''}
            ORDER BY created_at DESC LIMIT ?
        `).all(...(sinceArg ? [seat.role, `${seat.idPrefix}%`, sinceArg, N] : [seat.role, `${seat.idPrefix}%`, N])) as Array<{ id: string; content: string; created_at: string }>;

        for (const r of rows) {
            scanned++;
            const signsSession = r.content.includes(`(session)`);
            const signsHuman = r.content.includes(`(human)`);
            if (signsSession) {
                violations.push(`${seat.name} post ${r.id} (${r.created_at}) signs (session) — WRONG SEAT (would false-match self-recognition)`);
            } else if (!signsHuman) {
                violations.push(`${seat.name} post ${r.id} (${r.created_at}) omits (human) — bare signature (S151 false-match risk)`);
            }
        }
        console.log(`[check-human-signatures] ${seat.name}: scanned ${rows.length} latest ${seat.role}/${seat.idPrefix}* posts${sinceArg ? ` since ${sinceArg}` : ''}`);
    }
    db.close();

    if (violations.length) {
        const msg = `HAN human-signature check FAILED (${violations.length} of ${scanned} scanned):\n` + violations.map((v) => `  ✗ ${v}`).join('\n');
        console.error(`\n${msg}`);
        ntfy(msg);
        process.exit(2);
    }
    console.log(`[check-human-signatures] ✓ all ${scanned} human-seat posts sign (human), none sign (session).`);
    process.exit(0);
}

main();
