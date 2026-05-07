/**
 * voice-cache-truncation-sweep.ts
 *
 * Read-only sweep over ~/.han/voice-cache to surface any cached audio that
 * looks truncated (anomalously short for its input). Output is a report —
 * NOT an action. Operator decides which entries to nuke and regenerate.
 *
 * Scope:
 *   - by-message/<id>.mp3 → look up message in tasks.db, compute bytes/char,
 *     flag any below the read-only floor (more permissive than the prod
 *     400 floor; we want to catch borderline cases).
 *   - <hash-prefix>/<sha256>.mp3 → legacy hash-keyed cache. We cannot resolve
 *     these to a source message; instead report any .mp3 under 30 KB as a
 *     candidate for inspection (the State of the Garden incident left 5
 *     such files in 3-11 KB range).
 *
 * Per Jim's punch list (jim-report mou041x1-l1hsit, S152). Retired-by-throw
 * after first run per DEC-069 discipline (one-off scripts don't accumulate).
 *
 * Usage:
 *   npx tsx scripts/voice-cache-truncation-sweep.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const HAN_DIR = path.join(process.env.HOME!, '.han');
const VOICE_CACHE_DIR = path.join(HAN_DIR, 'voice-cache');
const BY_MESSAGE_DIR = path.join(VOICE_CACHE_DIR, 'by-message');
// Match db.ts:37 — Phase 5 of 2026-04-29 cutover (DEC-080) flipped the canonical
// conversations DB from tasks.db to gradient.db. Honour HAN_DB_PATH override for
// diagnostic scripts that route at the rebuild gradient or other DBs.
const CONVERSATIONS_DB = process.env.HAN_DB_PATH || path.join(HAN_DIR, 'gradient.db');

const SWEEP_FLOOR_BYTES_PER_CHAR = 400;     // permissive — catch borderline
const LEGACY_TINY_FILE_BYTES = 100 * 1024;  // 100 KB — permissive heuristic for legacy

interface ByMessageFlag {
    messageId: string;
    inputChars: number;
    outputBytes: number;
    bytesPerChar: number;
    role?: string;
    contentSnippet?: string;
}

interface OrphanEntry {
    messageId: string;
    bytes: number;
}

interface LegacyFlag {
    relPath: string;
    bytes: number;
}

function stripMarkdown(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\|/g, '')
        .replace(/^---+$/gm, '')
        .replace(/^\s*>/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function sweepByMessage(db: Database.Database): { flagged: ByMessageFlag[]; orphans: OrphanEntry[]; total: number } {
    const flagged: ByMessageFlag[] = [];
    const orphans: OrphanEntry[] = [];
    let total = 0;

    if (!fs.existsSync(BY_MESSAGE_DIR)) return { flagged, orphans, total };

    const stmt = db.prepare('SELECT role, content FROM conversation_messages WHERE id = ?');

    for (const entry of fs.readdirSync(BY_MESSAGE_DIR)) {
        if (!entry.endsWith('.mp3')) continue;
        total += 1;
        const messageId = entry.slice(0, -'.mp3'.length);
        const fullPath = path.join(BY_MESSAGE_DIR, entry);
        const bytes = fs.statSync(fullPath).size;

        const msg = stmt.get(messageId) as { role: string; content: string } | undefined;
        if (!msg) {
            orphans.push({ messageId, bytes });
            continue;
        }
        const cleanText = stripMarkdown(msg.content);
        if (cleanText.length === 0) continue;

        const bytesPerChar = bytes / cleanText.length;
        if (bytesPerChar < SWEEP_FLOOR_BYTES_PER_CHAR) {
            flagged.push({
                messageId,
                inputChars: cleanText.length,
                outputBytes: bytes,
                bytesPerChar: Number(bytesPerChar.toFixed(1)),
                role: msg.role,
                contentSnippet: cleanText.slice(0, 80).replace(/\s+/g, ' '),
            });
        }
    }

    return { flagged, orphans, total };
}

function sweepLegacy(): { flagged: LegacyFlag[]; total: number } {
    const flagged: LegacyFlag[] = [];
    let total = 0;

    if (!fs.existsSync(VOICE_CACHE_DIR)) return { flagged, total };

    for (const sub of fs.readdirSync(VOICE_CACHE_DIR)) {
        if (sub === 'by-message') continue;
        const subPath = path.join(VOICE_CACHE_DIR, sub);
        if (!fs.statSync(subPath).isDirectory()) continue;
        // Only descend into the two-letter hash prefix dirs (00-ff)
        if (!/^[0-9a-f]{2}$/.test(sub)) continue;

        for (const entry of fs.readdirSync(subPath)) {
            if (!entry.endsWith('.mp3')) continue;
            total += 1;
            const fullPath = path.join(subPath, entry);
            const bytes = fs.statSync(fullPath).size;
            if (bytes < LEGACY_TINY_FILE_BYTES) {
                flagged.push({ relPath: path.relative(VOICE_CACHE_DIR, fullPath), bytes });
            }
        }
    }

    return { flagged, total };
}

function main(): void {
    const db = new Database(CONVERSATIONS_DB, { readonly: true });
    const { flagged: byMsg, orphans, total: byMsgTotal } = sweepByMessage(db);
    const { flagged: legacy, total: legacyTotal } = sweepLegacy();
    db.close();

    console.log('=== Voice-cache truncation sweep ===');
    console.log(`Scanned: ${byMsgTotal} per-message + ${legacyTotal} legacy hash-keyed entries`);
    console.log(`Truncation candidates: ${byMsg.length} per-message (bytes/char < ${SWEEP_FLOOR_BYTES_PER_CHAR}) + ${legacy.length} legacy (bytes < ${LEGACY_TINY_FILE_BYTES})`);
    console.log(`Orphans (cache file present, message no longer in DB): ${orphans.length}`);

    if (byMsg.length > 0) {
        console.log('\n--- Per-message TRUNCATION candidates (validated against DB) ---');
        byMsg.sort((a, b) => a.bytesPerChar - b.bytesPerChar);
        for (const f of byMsg) {
            console.log(`  ${f.messageId}  bytes/char=${f.bytesPerChar}  bytes=${f.outputBytes}  chars=${f.inputChars}  role=${f.role ?? '?'}`);
            if (f.contentSnippet) console.log(`    ↳ "${f.contentSnippet}…"`);
        }
    } else {
        console.log('\n--- Per-message: no truncation candidates ---');
    }

    if (legacy.length > 0) {
        console.log('\n--- Legacy tiny-file candidates (heuristic; some may be legitimately short audio) ---');
        legacy.sort((a, b) => a.bytes - b.bytes);
        for (const f of legacy) {
            console.log(`  ${f.relPath}  bytes=${f.bytes}`);
        }
    }

    if (orphans.length > 0) {
        console.log(`\n--- Orphans (${orphans.length} files; first 10 shown; not validated, just unmapped) ---`);
        orphans.sort((a, b) => a.bytes - b.bytes);
        for (const f of orphans.slice(0, 10)) {
            console.log(`  ${f.messageId}  bytes=${f.bytes}`);
        }
        if (orphans.length > 10) console.log(`  …and ${orphans.length - 10} more`);
    }

    console.log('\n=== End of sweep — no entries modified. ===');
}

main();
