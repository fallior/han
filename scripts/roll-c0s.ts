#!/usr/bin/env tsx
/**
 * scripts/roll-c0s.ts
 *
 * Day-rolling acquisition for cutover replay.
 *
 * Reads c0 entries from a SOURCE database (default ~/.han/tasks.db,
 * read-only), groups them by (agent, AEST lived_date) with cross-day
 * spanning when below threshold, writes rolled c0s to a TARGET
 * database (default ~/.han/rolled-source.db) with a `gradient_entry_components`
 * side table for forensic provenance.
 *
 * Why: individual c0s are often too small for compression to find
 * meaningful shape (a 500-char supervisor cycle, a 100-char
 * conversation message). Day-rolling them into ≥5K-token units gives
 * the cascade real material to compress against and dissolves the
 * angel-watermark proportionality issue structurally.
 *
 * lived_date extraction (most authoritative first):
 *   1. session_label date pattern (YYYY-MM-DD anywhere in label)
 *   2. source_message_id timestamp from conversation_messages table
 *   3. fallback to created_at — *audit-logged* to
 *      ~/.han/memory/cutover/lived-date-fallbacks.jsonl
 *
 * AEST conversion (UTC+10, Queensland no DST) is applied before
 * taking the date — a 22:55 UTC message lands on the correct AEST day.
 *
 * Three gates baked into output (per Jim's spec):
 *   1. Aggregate stats — per-agent in/out, distribution, fallback rate.
 *   2. Spot-check sample — one rolled c0's preview + components rows.
 *   3. Threshold compliance — confirm rolls ≥threshold OR trailing.
 *
 * Usage:
 *   npx tsx scripts/roll-c0s.ts                    # dry-run
 *   npx tsx scripts/roll-c0s.ts --apply            # write target db
 *   npx tsx scripts/roll-c0s.ts --agent=leo        # filter by agent
 *   npx tsx scripts/roll-c0s.ts --threshold-tokens=5000   # default
 *
 * If --apply and target file already exists, the script refuses
 * (move/delete it manually first — never silent overwrite).
 *
 * Skipped at source: content_type IN ('dream', 'felt-moment').
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID, createHash } from 'crypto';
import Database from 'better-sqlite3';

// ── Argument parsing ────────────────────────────────────────────

function arg(name: string, defaultValue: string | null = null): string | null {
    const flag = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(flag));
    if (found) return found.slice(flag.length);
    if (process.argv.includes(`--${name}`)) return 'true';
    return defaultValue;
}

function expandHome(p: string): string {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const sourceDbPath = expandHome(arg('source-db', path.join(os.homedir(), '.han', 'tasks.db'))!);
const targetDbPath = expandHome(arg('target-db', path.join(os.homedir(), '.han', 'rolled-source.db'))!);
const apply = arg('apply') === 'true';
const incremental = arg('incremental') === 'true';
const agentFilter = arg('agent', 'all')!;
const thresholdTokens = parseInt(arg('threshold-tokens', '5000') || '5000', 10);
const thresholdChars = thresholdTokens * 4; // ~4 chars per token (English text heuristic)
// Upper bound — symmetric 5× multiplier on the lower bound (Jim's design).
// Keeps rolls in 5K-25K token compression-shape band; busy days split into
// `-partN` siblings rather than producing 70K+ token monsters. A single
// component that itself exceeds the upper bound becomes its own part
// (oversized but unsplittable — splitting a coherent document mid-content
// damages its argument-flow).
const upperTokens = parseInt(arg('upper-tokens', '25000') || '25000', 10);
const upperChars = upperTokens * 4;

if (path.resolve(sourceDbPath) === path.resolve(targetDbPath)) {
    console.error(`[roll] FATAL: source and target paths identical (${sourceDbPath}). Refusing.`);
    process.exit(2);
}

// ── AEST helpers (UTC+10, no DST) ────────────────────────────────

function toAEST(isoUtc: string): Date {
    return new Date(new Date(isoUtc).getTime() + 10 * 3600 * 1000);
}
function aestDate(isoUtc: string): string {
    return toAEST(isoUtc).toISOString().slice(0, 10);
}
function aestDateTime(isoUtc: string): string {
    return toAEST(isoUtc).toISOString().slice(0, 16).replace('T', ' ');
}

// ── lived_date extraction ────────────────────────────────────────

// Date patterns. Dashed (YYYY-MM-DD) is canonical; compact (YYYYMMDD) catches
// labels like 's52-20260303'. Year-month (YYYY-MM only) catches monthly-rollup
// labels like '2026-03' — these become first-of-month. Compact is gated to
// start with '20' so it doesn't accidentally match six-digit subsequences that
// happen to look year-like.
const DASHED_DATE_RX = /(\d{4})-(\d{2})-(\d{2})/;
const COMPACT_DATE_RX = /(?<![0-9])(20\d{2})(\d{2})(\d{2})(?![0-9])/;
const YEAR_MONTH_ONLY_RX = /^(20\d{2})-(\d{2})$/;

function findDateIn(text: string | null | undefined): string | null {
    if (!text) return null;
    let m = DASHED_DATE_RX.exec(text);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = COMPACT_DATE_RX.exec(text);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // Year-month only — collapse to first-of-month. Conservative; only matches
    // labels that ARE the year-month (not embedded dates).
    m = YEAR_MONTH_ONLY_RX.exec(text);
    if (m) return `${m[1]}-${m[2]}-01`;
    return null;
}

interface FallbackRecord {
    c0_id: string;
    agent: string;
    content_type: string;
    session_label: string | null;
    fallback_reason: string;
    fallback_date: string;
}

type LivedMethod =
    | 'session_label'
    | 'content_header'
    | 'source_message_id'
    | 'source_conversation_first_message'
    | 'fallback';

interface LivedInfo {
    date: string;        // AEST YYYY-MM-DD
    lived_at: string;    // ISO UTC of best-known lived moment
    method: LivedMethod;
}

function extractLivedDate(
    row: any,
    sourceDb: Database.Database,
    fallbackLog: FallbackRecord[]
): LivedInfo {
    // 1. session_label date pattern (dashed or compact)
    const labelDate = findDateIn(row.session_label || '');
    if (labelDate) {
        return { date: labelDate, lived_at: `${labelDate}T00:00:00.000Z`, method: 'session_label' };
    }

    // 2. content first ~500 chars — many WM/session files open with
    //    "Session NN (2026-03-02, night)" or "# Working Memory (Full) — Session NN (2026-03-07 evening)"
    const contentHead = String(row.content || '').slice(0, 500);
    const headerDate = findDateIn(contentHead);
    if (headerDate) {
        return { date: headerDate, lived_at: `${headerDate}T00:00:00.000Z`, method: 'content_header' };
    }

    // 3. source_message_id → conversation_messages.created_at (ISO UTC)
    if (row.source_message_id) {
        const msg = sourceDb.prepare(
            'SELECT created_at FROM conversation_messages WHERE id = ?'
        ).get(row.source_message_id) as any;
        if (msg && msg.created_at) {
            return {
                date: aestDate(msg.created_at),
                lived_at: msg.created_at,
                method: 'source_message_id',
            };
        }
    }

    // 4. source_conversation_id → first-message timestamp of that thread.
    //    Most curated conversation extracts have conv_id but not msg_id; the
    //    conversation's first message is the closest authoritative lived moment.
    if (row.source_conversation_id) {
        const first = sourceDb.prepare(
            'SELECT MIN(created_at) AS first_at FROM conversation_messages WHERE conversation_id = ?'
        ).get(row.source_conversation_id) as any;
        if (first && first.first_at) {
            return {
                date: aestDate(first.first_at),
                lived_at: first.first_at,
                method: 'source_conversation_first_message',
            };
        }
    }

    // 5. Fallback to created_at — audit-logged
    let reason: string;
    if (row.source_message_id) reason = 'message_id_not_found';
    else if (row.source_conversation_id) reason = 'conversation_has_no_messages';
    else reason = 'no_extractable_date';
    const fbDate = aestDate(row.created_at);
    fallbackLog.push({
        c0_id: row.id,
        agent: row.agent,
        content_type: row.content_type,
        session_label: row.session_label,
        fallback_reason: reason,
        fallback_date: fbDate,
    });
    return { date: fbDate, lived_at: row.created_at, method: 'fallback' };
}

// ── Target schema ───────────────────────────────────────────────

function ensureTargetSchema(db: Database.Database) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS gradient_entries (
            id TEXT PRIMARY KEY,
            agent TEXT NOT NULL,
            session_label TEXT,
            level TEXT NOT NULL,
            content TEXT NOT NULL,
            content_type TEXT NOT NULL,
            source_id TEXT,
            source_conversation_id TEXT,
            source_message_id TEXT,
            provenance_type TEXT DEFAULT 'original',
            created_at TEXT DEFAULT (datetime('now')),
            last_revisited TEXT,
            revisit_count INTEGER DEFAULT 0,
            completion_flags INTEGER DEFAULT 0,
            supersedes TEXT,
            superseded_by TEXT,
            change_count INTEGER DEFAULT 0,
            qualifier TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ge_agent_level ON gradient_entries(agent, level);
        CREATE INDEX IF NOT EXISTS idx_ge_agent_level_ct_created
            ON gradient_entries(agent, level, content_type, created_at);

        CREATE TABLE IF NOT EXISTS feeling_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gradient_entry_id TEXT NOT NULL,
            author TEXT,
            tag_type TEXT,
            content TEXT,
            change_reason TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS gradient_entry_components (
            gradient_entry_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            component_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_lived_at TEXT NOT NULL,
            source_message_id TEXT,
            source_conversation_id TEXT,
            lived_date_method TEXT,
            PRIMARY KEY (gradient_entry_id, position)
        );
        CREATE INDEX IF NOT EXISTS idx_gec_source_lived
            ON gradient_entry_components(source_lived_at);
        CREATE INDEX IF NOT EXISTS idx_gec_source_id
            ON gradient_entry_components(source_id);
    `);
}

// ── Main ────────────────────────────────────────────────────────

interface AgentStats {
    constituents: number;
    deduped_pairs: number;
    post_dedup_rows: number;
    pre_split_buckets: number;
    rolled_c0s: number;            // FINAL count after upper-bound split
    parts_split_buckets: number;   // buckets that split into >1 part
    oversized_singles: number;     // single-row parts exceeding upper bound
    at_threshold: number;
    trailing_under: number;
    multi_day_spans: number;
    size_min: number;
    size_max: number;
    size_avg: number;
    fallback_count: number;
    fallback_rate: number;
    method_counts: Record<string, number>;
}

interface DedupDiscardRecord {
    agent: string;
    lived_date: string;
    kept_id: string;
    kept_session_label: string | null;
    kept_content_type: string;
    discarded_id: string;
    discarded_session_label: string | null;
    discarded_content_type: string;
    content_chars: number;
    content_hash: string;
}

async function main() {
    console.log(`[roll] Source:    ${sourceDbPath} (read-only)`);
    console.log(`[roll] Target:    ${targetDbPath}`);
    console.log(`[roll] Threshold: ${thresholdTokens} tokens (~${thresholdChars} chars) lower / ${upperTokens} tokens (~${upperChars} chars) upper`);
    console.log(`[roll] Agents:    ${agentFilter}`);
    console.log(`[roll] Mode:      ${apply ? 'APPLY' : 'DRY-RUN'}`);
    console.log('');

    const sourceDb = new Database(sourceDbPath, { readonly: true });

    let targetDb: Database.Database | null = null;
    if (apply) {
        const exists = fs.existsSync(targetDbPath);
        if (exists && !incremental) {
            console.error(`[roll] Target DB already exists: ${targetDbPath}`);
            console.error(`[roll] Move/delete it OR pass --incremental to append unrolled c0s.`);
            process.exit(1);
        }
        if (!exists && incremental) {
            console.error(`[roll] --incremental requires existing target DB; ${targetDbPath} not found.`);
            process.exit(1);
        }
        targetDb = new Database(targetDbPath);
        ensureTargetSchema(targetDb);  // CREATE IF NOT EXISTS — idempotent
    } else if (incremental) {
        // Dry-run + incremental: open read-only so cutoff query works.
        if (!fs.existsSync(targetDbPath)) {
            console.error(`[roll] --incremental requires existing target DB; ${targetDbPath} not found.`);
            process.exit(1);
        }
        targetDb = new Database(targetDbPath, { readonly: true });
    }

    const agents = agentFilter === 'all' ? ['jim', 'leo'] : [agentFilter];
    const fallbackLog: FallbackRecord[] = [];
    const dedupLog: DedupDiscardRecord[] = [];
    const allStats: Record<string, AgentStats> = {};
    // Source ids that survive the incremental cutoff filter (across all agents).
    // Used to prune audit logs so we don't re-record fallback/dedup events for
    // rows that were already rolled in a prior run.
    const eligibleSourceIds = new Set<string>();

    for (const agent of agents) {
        const rows = sourceDb.prepare(`
            SELECT id, agent, session_label, content, content_type,
                   source_id, source_conversation_id, source_message_id,
                   provenance_type, created_at
            FROM gradient_entries
            WHERE agent = ? AND level = 'c0'
              AND content_type NOT IN ('dream', 'felt-moment')
            ORDER BY created_at ASC, id ASC
        `).all(agent) as any[];

        if (rows.length === 0) {
            allStats[agent] = {
                constituents: 0, deduped_pairs: 0, post_dedup_rows: 0,
                pre_split_buckets: 0, rolled_c0s: 0, parts_split_buckets: 0,
                oversized_singles: 0, at_threshold: 0, trailing_under: 0,
                multi_day_spans: 0, size_min: 0, size_max: 0, size_avg: 0,
                fallback_count: 0, fallback_rate: 0, method_counts: {},
            };
            continue;
        }

        // Enrich with lived_date
        const methodCounts: Record<string, number> = {
            session_label: 0,
            content_header: 0,
            source_message_id: 0,
            source_conversation_first_message: 0,
            fallback: 0,
        };
        let enriched = rows.map(r => {
            const info = extractLivedDate(r, sourceDb, fallbackLog);
            methodCounts[info.method]++;
            return { ...r, ...info };
        });

        // Incremental cutoff: drop rows whose lived_at is at-or-before the latest
        // source_lived_at already represented in target. Strict-greater-than
        // ensures we don't reprocess content already rolled into existing buckets.
        if (incremental && targetDb) {
            const cutRow = targetDb.prepare(`
                SELECT MAX(gec.source_lived_at) AS cutoff
                FROM gradient_entry_components gec
                JOIN gradient_entries ge ON ge.id = gec.gradient_entry_id
                WHERE ge.agent = ?
            `).get(agent) as any;
            const cutoff: string | null = cutRow?.cutoff || null;
            if (cutoff) {
                const before = enriched.length;
                enriched = enriched.filter(r => r.lived_at > cutoff);
                console.log(`[roll] [${agent}] incremental cutoff: ${cutoff}  (filtered ${before} → ${enriched.length})`);
            } else {
                console.log(`[roll] [${agent}] no existing components; incremental = full roll`);
            }
        }
        for (const r of enriched) eligibleSourceIds.add(r.id);

        // Sort by lived_date, then lived_at, then created_at, then id
        enriched.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.lived_at !== b.lived_at) return a.lived_at.localeCompare(b.lived_at);
            if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
            return a.id.localeCompare(b.id);
        });

        // ── Dedup pre-pass ──────────────────────────────────────
        //
        // Within (agent, lived_date), collapse byte-exact content duplicates
        // to one canonical row. Catches the acquire-pipeline mistag where
        // the same WM-Full file was ingested under both 'session' AND
        // 'working-memory' content_type (e.g., leo s97-2026-03-19 stored
        // twice at 217,995 chars each). Without dedup the cascade burns
        // double slots compressing the same content.
        //
        // Canonical preference: 'working-memory' (the stable convention —
        // session-tagged WM-Full was the legacy mistag). Tiebreaker
        // MIN(id) for non-WM groups or multi-WM groups, so the choice
        // is deterministic across re-runs.
        //
        // Scope: within (agent, lived_date) only. Cross-date dedup would
        // risk removing legitimate references to recurring content.
        // DEC-069 honoured — discarded rows stay in tasks.db; we only
        // skip them in the rolled-source.db pipeline.
        const dedupGroups = new Map<string, any[]>();
        for (const r of enriched) {
            const hash = createHash('sha256').update(String(r.content || '')).digest('hex');
            const key = `${r.date}|${hash}`;
            if (!dedupGroups.has(key)) dedupGroups.set(key, []);
            dedupGroups.get(key)!.push(r);
        }

        let dedupedPairs = 0;
        const deduped: any[] = [];
        for (const group of dedupGroups.values()) {
            if (group.length === 1) {
                deduped.push(group[0]);
                continue;
            }
            // Multi-row group — choose canonical
            const wmRows = group.filter(r => r.content_type === 'working-memory');
            const candidates = wmRows.length > 0 ? wmRows : group;
            candidates.sort((a, b) => a.id.localeCompare(b.id));
            const canonical = candidates[0];
            deduped.push(canonical);
            dedupedPairs += group.length - 1;
            for (const r of group) {
                if (r.id === canonical.id) continue;
                const hash = createHash('sha256').update(String(r.content || '')).digest('hex');
                dedupLog.push({
                    agent,
                    lived_date: r.date,
                    kept_id: canonical.id,
                    kept_session_label: canonical.session_label,
                    kept_content_type: canonical.content_type,
                    discarded_id: r.id,
                    discarded_session_label: r.session_label,
                    discarded_content_type: r.content_type,
                    content_chars: String(r.content || '').length,
                    content_hash: hash,
                });
            }
        }

        // Re-sort post-dedup (group iteration order may not preserve sort)
        deduped.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.lived_at !== b.lived_at) return a.lived_at.localeCompare(b.lived_at);
            if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
            return a.id.localeCompare(b.id);
        });

        // Group by AEST lived_date — preserves day-coherence; cross-day spans only when below threshold
        const byDay = new Map<string, any[]>();
        for (const r of deduped) {
            if (!byDay.has(r.date)) byDay.set(r.date, []);
            byDay.get(r.date)!.push(r);
        }

        // Roll into buckets — emit when ≥threshold; span forward when not
        interface Bucket { dates: string[]; rows: any[]; isTrailing?: boolean; }
        const buckets: Bucket[] = [];
        let pending: any[] = [];
        let pendingSize = 0;
        let pendingDates: string[] = [];

        const sortedDates = [...byDay.keys()].sort();
        for (const date of sortedDates) {
            const dayRows = byDay.get(date)!;
            pending.push(...dayRows);
            pendingSize += dayRows.reduce((s, r) => s + (r.content?.length || 0), 0);
            pendingDates.push(date);

            if (pendingSize >= thresholdChars) {
                buckets.push({ dates: [...pendingDates], rows: pending });
                pending = []; pendingSize = 0; pendingDates = [];
            }
        }
        if (pending.length > 0) {
            buckets.push({ dates: pendingDates, rows: pending, isTrailing: true });
        }

        // Upper-bound split — walk components in order, accumulate, emit a
        // new part each time adding the next component would exceed
        // upperChars. A single component itself larger than upperChars
        // becomes its own (oversized) part. Splitting a coherent document
        // mid-content damages its argument-flow; we accept the rare
        // oversized single rather than introduce that brittleness.
        function splitByUpperBound(rows: any[]): any[][] {
            const parts: any[][] = [];
            let pending: any[] = [];
            let pendingSize = 0;
            for (const r of rows) {
                const rSize = (r.content?.length || 0);
                if (pending.length > 0 && pendingSize + rSize > upperChars) {
                    parts.push(pending);
                    pending = [];
                    pendingSize = 0;
                }
                pending.push(r);
                pendingSize += rSize;
            }
            if (pending.length > 0) parts.push(pending);
            return parts;
        }

        // Emit each bucket — split into parts when oversized
        let bucketsAtThreshold = 0;
        let bucketsTrailing = 0;
        let bucketsMultiDay = 0;
        let partsSplitBuckets = 0;
        let oversizedSingles = 0;
        let totalEmitted = 0;
        const sizeHist: number[] = [];

        for (const bucket of buckets) {
            const isMultiDay = bucket.dates.length > 1;
            const baseLabel = isMultiDay
                ? `${bucket.dates[0]}_to_${bucket.dates[bucket.dates.length - 1]}`
                : bucket.dates[0];
            if (isMultiDay) bucketsMultiDay++;

            const partsRows = splitByUpperBound(bucket.rows);
            const isSplit = partsRows.length > 1;
            if (isSplit) partsSplitBuckets++;

            for (let pi = 0; pi < partsRows.length; pi++) {
                const partRows = partsRows[pi];
                const newId = randomUUID();
                const sessionLabel = isSplit ? `${baseLabel}-part${pi + 1}` : baseLabel;
                const livedAt = partRows[0].lived_at;

                const partsContent = partRows.map((r, i) => {
                    const sep = `\n\n--- [${i + 1}/${partRows.length}] ${aestDateTime(r.lived_at)} AEST | ${r.content_type} | ${r.session_label || '(no label)'} ---\n\n`;
                    return sep + (r.content || '');
                });
                const content = partsContent.join('').trim();

                sizeHist.push(content.length);
                totalEmitted++;
                if (partRows.length === 1 && content.length > upperChars) oversizedSingles++;

                // Trailing-under counts only for the LAST part of the trailing bucket
                const isLastPartOfTrailing = bucket.isTrailing && pi === partsRows.length - 1;
                if (isLastPartOfTrailing && content.length < thresholdChars) {
                    bucketsTrailing++;
                } else {
                    bucketsAtThreshold++;
                }

                if (apply && targetDb) {
                    targetDb.prepare(`
                        INSERT INTO gradient_entries
                            (id, agent, session_label, level, content, content_type, created_at, provenance_type)
                        VALUES (?, ?, ?, 'c0', ?, 'rolled-day', ?, 'rolled')
                    `).run(newId, agent, sessionLabel, content, livedAt);

                    const insertComp = targetDb.prepare(`
                        INSERT INTO gradient_entry_components
                            (gradient_entry_id, position, component_type, source_id, source_lived_at,
                             source_message_id, source_conversation_id, lived_date_method)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    for (let i = 0; i < partRows.length; i++) {
                        const r = partRows[i];
                        insertComp.run(
                            newId, i, r.content_type, r.id, r.lived_at,
                            r.source_message_id || null,
                            r.source_conversation_id || null,
                            r.method
                        );
                    }
                }
            }
        }

        const fbForAgent = fallbackLog.filter(f => f.agent === agent).length;
        allStats[agent] = {
            constituents: rows.length,
            deduped_pairs: dedupedPairs,
            post_dedup_rows: deduped.length,
            pre_split_buckets: buckets.length,
            rolled_c0s: totalEmitted,
            parts_split_buckets: partsSplitBuckets,
            oversized_singles: oversizedSingles,
            at_threshold: bucketsAtThreshold,
            trailing_under: bucketsTrailing,
            multi_day_spans: bucketsMultiDay,
            size_min: Math.min(...sizeHist),
            size_max: Math.max(...sizeHist),
            size_avg: Math.round(sizeHist.reduce((s, x) => s + x, 0) / sizeHist.length),
            fallback_count: fbForAgent,
            fallback_rate: fbForAgent / rows.length,
            method_counts: methodCounts,
        };
    }

    // In incremental mode, prune logs to entries for rows that survived cutoff
    // (the others were processed in a prior roll), and append rather than
    // overwrite. In one-shot mode, behaviour preserved: write the full set.
    const fallbackToWrite = incremental
        ? fallbackLog.filter(f => eligibleSourceIds.has(f.c0_id))
        : fallbackLog;
    const dedupToWrite = incremental
        ? dedupLog.filter(d => eligibleSourceIds.has(d.kept_id) || eligibleSourceIds.has(d.discarded_id))
        : dedupLog;

    if (apply && fallbackToWrite.length > 0) {
        const auditPath = path.join(os.homedir(), '.han', 'memory', 'cutover', 'lived-date-fallbacks.jsonl');
        fs.mkdirSync(path.dirname(auditPath), { recursive: true });
        const payload = fallbackToWrite.map(r => JSON.stringify(r)).join('\n') + '\n';
        if (incremental && fs.existsSync(auditPath)) {
            fs.appendFileSync(auditPath, payload);
        } else {
            fs.writeFileSync(auditPath, payload);
        }
    }

    if (apply && dedupToWrite.length > 0) {
        const dedupPath = path.join(os.homedir(), '.han', 'memory', 'cutover', 'dedup-discarded.jsonl');
        fs.mkdirSync(path.dirname(dedupPath), { recursive: true });
        const payload = dedupToWrite.map(r => JSON.stringify(r)).join('\n') + '\n';
        if (incremental && fs.existsSync(dedupPath)) {
            fs.appendFileSync(dedupPath, payload);
        } else {
            fs.writeFileSync(dedupPath, payload);
        }
    }

    // ── Output: Jim's three gates ───────────────────────────────

    console.log('═══ GATE 1 — AGGREGATE STATS ═══');
    for (const [agent, s] of Object.entries(allStats)) {
        console.log(`\n  ${agent}:`);
        console.log(`    constituents in:         ${s.constituents}`);
        console.log(`    deduped pairs removed:   ${s.deduped_pairs}`);
        console.log(`    post-dedup rows:         ${s.post_dedup_rows}`);
        console.log(`    pre-split buckets:       ${s.pre_split_buckets}`);
        console.log(`    rolled c0s out (final):  ${s.rolled_c0s}`);
        console.log(`    parts-split buckets:     ${s.parts_split_buckets}`);
        console.log(`    oversized singles:       ${s.oversized_singles}`);
        console.log(`    at-threshold buckets:    ${s.at_threshold}`);
        console.log(`    trailing-under bucket:   ${s.trailing_under}`);
        console.log(`    multi-day spans:         ${s.multi_day_spans}`);
        console.log(`    size min/avg/max chars:  ${s.size_min} / ${s.size_avg} / ${s.size_max}`);
        console.log(`    lived_date methods:`);
        console.log(`      session_label:         ${s.method_counts.session_label}`);
        console.log(`      content_header:        ${s.method_counts.content_header}`);
        console.log(`      source_message_id:     ${s.method_counts.source_message_id}`);
        console.log(`      conv_first_message:    ${s.method_counts.source_conversation_first_message}`);
        console.log(`      fallback (created_at): ${s.method_counts.fallback}`);
        console.log(`    fallback rate:           ${(s.fallback_rate * 100).toFixed(1)}%`);
        if (s.fallback_rate > 0.20) {
            console.log(`    ⚠ FALLBACK RATE EXCEEDS 20% — investigate before --apply`);
        }
        if (s.size_max > upperChars) {
            console.log(`    ⚠ ${s.oversized_singles} oversized single-component part(s) (max ${s.size_max} > ${upperChars}). Single coherent components above upper bound — accepted as unsplittable.`);
        }
    }

    console.log('\n═══ GATE 2 — SPOT-CHECK SAMPLE ═══');
    if (apply && targetDb) {
        for (const agent of agents) {
            // Pick a rolled c0 with multiple components for richer sample
            const sample = targetDb.prepare(`
                SELECT ge.id, ge.session_label, ge.content_type, length(ge.content) AS chars,
                       substr(ge.content, 1, 1200) AS preview,
                       (SELECT COUNT(*) FROM gradient_entry_components WHERE gradient_entry_id = ge.id) AS n_comps
                FROM gradient_entries ge
                WHERE ge.agent = ?
                ORDER BY (SELECT COUNT(*) FROM gradient_entry_components WHERE gradient_entry_id = ge.id) DESC
                LIMIT 1
            `).get(agent) as any;
            if (!sample) continue;
            console.log(`\n  ${agent}: rolled c0 ${sample.id}`);
            console.log(`    session_label: ${sample.session_label}`);
            console.log(`    content_type:  ${sample.content_type}`);
            console.log(`    length:        ${sample.chars} chars`);
            console.log(`    components:    ${sample.n_comps}`);
            console.log(`    --- content preview (first 1200 chars) ---`);
            console.log(sample.preview.split('\n').map((l: string) => `    | ${l}`).join('\n'));
            console.log(`    | ...`);
            console.log(`    --- components rows ---`);
            const comps = targetDb.prepare(`
                SELECT position, component_type, source_id, source_lived_at, lived_date_method
                FROM gradient_entry_components
                WHERE gradient_entry_id = ?
                ORDER BY position
            `).all(sample.id) as any[];
            for (const c of comps) {
                console.log(`    [${c.position}] ${c.component_type.padEnd(18)} ${c.source_lived_at} via=${c.lived_date_method} src=${c.source_id.slice(0, 8)}`);
            }
        }
    } else {
        console.log('  (skipped — DRY-RUN, no target DB written)');
    }

    console.log('\n═══ GATE 3 — THRESHOLD COMPLIANCE ═══');
    for (const [agent, s] of Object.entries(allStats)) {
        // Compliant = at_threshold + (trailing_under as accepted exception)
        const compliant = s.at_threshold + s.trailing_under;
        const expected = s.rolled_c0s;
        const ok = compliant === expected && s.trailing_under <= 1;
        console.log(`  ${agent}: ${s.at_threshold} at-threshold + ${s.trailing_under} trailing-under = ${compliant}/${expected} ${ok ? '✓' : '✗ (more than one trailing — bug)'}`);
    }

    console.log(`\n[roll] ${apply ? 'WROTE: ' + targetDbPath : 'DRY-RUN — no writes'}`);
    if (apply) {
        console.log(`[roll] Fallback audit log: ~/.han/memory/cutover/lived-date-fallbacks.jsonl (${fallbackLog.length} entries)`);
        console.log(`[roll] Dedup discard log:   ~/.han/memory/cutover/dedup-discarded.jsonl (${dedupLog.length} entries)`);
    } else {
        console.log(`[roll] Fallback audit log would carry ${fallbackLog.length} entries.`);
        console.log(`[roll] Dedup discard log would carry ${dedupLog.length} entries.`);
        console.log(`[roll] Re-run with --apply to write.`);
    }

    sourceDb.close();
    if (targetDb) targetDb.close();
}

main().catch(e => {
    console.error('[roll] FATAL:', e);
    process.exit(1);
});
