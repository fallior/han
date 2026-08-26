#!/usr/bin/env npx tsx
/**
 * backburner-derive.ts — the Backburner Register's deriver (P0).
 * Plan: plans/backburner-register-plan.md (FI #156 Part 4). Thread mt9paxw9-twis6n.
 * Built 2026-08-26 on Darron's go, all three chairs GREEN (Jim M1-M3, Tenshi T1-T3,
 * Casey's parked-grammar ruling folded).
 *
 * DERIVE, DON'T FILE: this script computes a VIEW over the spoor that starting work
 * always leaves. It is READ-ONLY over every source; its only writes are the derived
 * view (~/.han/memory/shared/backburner.md) and its receipts
 * (~/.han/health/backburner-derive.jsonl). Re-runnable, idempotent, DEC-069-clean
 * (the view is recomputable; sources are the record).
 *
 * ── BLIND-SPOT DECLARATION (T2 — the absence-of-a-counter law: a sweep must declare
 *    its method and its blind spots, or a lazy sweep is indistinguishable from a clean one)
 *  1. The marker convention (WAITING-ON:) is itself a remember-to-write surface — FM #81's
 *     class. Cure is placement into producing templates (night-report, docket), not resolve.
 *     This register measures SPOOR, never STARTS: an ad-hoc conversational start that left
 *     no marker and no artefact is invisible to every feed.
 *  2. Scope is the garden's repos (~/Projects/han, ~/.han), not the portfolio. A started
 *     fix in any other project directory leaves spoor no feed reads.
 *  3. Every exclusion set is itself a blind spot: the ~/.han memory-churn exclusion (M3)
 *     and the own-output exclusion (T1) both hide anything genuinely backburnered inside
 *     them. The trade is accepted and declared.
 *  4. mtime lies gently (Jim): a tooling touch, a sweep commit, a sed all refresh mtime
 *     without the work moving. Age-since-touch is a floor on staleness, not proof of
 *     progress. Do not read freshness as progress.
 *  5. The git feed has no standing positive fixture in v1 (a fixture repo costs more than
 *     it proves); its liveness proxy is the scanned-count in the receipt. Zero-scanned on
 *     any feed renders UNREACHED, never PASS (T3).
 *  6. Feed 4 (HELD posts) needles a convention, not a schema — its recall is bounded by
 *     the phrases people actually write. Declared coarse in v1.
 *
 * ── SANITISER (M2 + T1, part of the grammar's DEFINITION, not a patch):
 *  - A marker only parses at LINE START (optional list bullet), never inside backticks,
 *    never on lines containing angle-bracket placeholders (<who>, <what>, <condition>),
 *    never inside fenced code blocks.
 *  - The harvester structurally excludes the register's own output surfaces: the derived
 *    view, the receipts, this script, the fixtures dir, the plan file, and the design
 *    thread mt9paxw9 (banked as hard negatives per T1 — the FI #149 lesson).
 *  - The renderer NEVER emits raw marker grammar: rendered tokens use a middle dot
 *    (WAITING·ON) so derived output harvests to zero by construction.
 *
 * ── PARKED GRAMMAR (Casey's ruling, §1-§3):
 *    PARKED-UNTIL: <condition> | owner: <who> | because: <ground>
 *    All three fields mandatory; a park missing owner or ground is REFUSED (rendered as
 *    unattended with reason "malformed park"). Conditions must be machine-evaluable:
 *      - ISO date (2026-09-15) → TRUE when past
 *      - plan:<file>:LANDED → TRUE when that plan's status line goes done-class
 *      - thread:<id>:resolved → TRUE when that conversation's status != open
 *    Anything else is UNEVALUABLE → converts LOUD to unattended with the reason on the
 *    row (Casey §2: a condition that cannot be checked is not a park — it is the quietest
 *    failure available). Expired parks convert automatically (Jim's ruling) and KEEP their
 *    park provenance (Casey §3: the expired parks are the curriculum).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { hanHome, hanRepo, healthDir, memoryDir } from '../src/server/lib/paths';

const HAN_REPO = hanRepo();
const MEM_REPO = hanHome();
const PLANS_DIR = path.join(HAN_REPO, 'plans');
const OUT_FILE = path.join(memoryDir(), 'shared/backburner.md');
const RECEIPTS = path.join(healthDir(), 'backburner-derive.jsonl');
const JOURNAL = path.join(memoryDir(), 'shared/maintenance-journal.md');
const FIXTURES = path.join(HAN_REPO, 'scripts/backburner-fixtures');
const DB_PATH = process.env.HAN_DB_PATH || path.join(MEM_REPO, 'gradient.db');
const DESIGN_THREAD = 'mt9paxw9-twis6n';
const NOW = new Date();

// M3: the ~/.han memory-churn exclusion set — four minds' ordinary writing, swept by the
// six-hourly auto-committer; a dirty working-memory.md is never backburner.
const HAN_MEM_CHURN = [/^memory\//, /^pool\//, /^sleeves\//, /^agent-pipes\//, /\.pid$/,
    /^health\//, /^logs\//, /^signals\//, /^archive\//, /^recovery\//, /^handoff\//];
// T1: own-output surfaces — the harvester must never read what the register writes.
const OWN_OUTPUT = [OUT_FILE, RECEIPTS, __filename];
// The plan file is excluded from MARKER harvesting only (it documents the grammar —
// M2's first fixture is its own line 43) but MUST enrol via the plans feed: the
// self-referential acceptance is that the register's first row is this plan.
const MARKER_EXCLUDED = [...OWN_OUTPUT, path.join(PLANS_DIR, 'backburner-register-plan.md')];

const DONE_STATUS = /\b(DONE|CLOSED|SUPERSEDED|LANDED|SEALED|RETIRED|COMPLETE|SHIPPED)\b/i;

type Row = { feed: string; what: string; age_days: number; detail: string;
             state: 'unattended' | 'parked' | 'triage';
             park?: { condition: string; owner: string; ground: string;
                      verdict: 'FALSE' | 'EXPIRED' | 'UNEVALUABLE' | 'MALFORMED';
                      provenance?: string } };
type FeedReceipt = { scanned: number; derived: number;
                     excluded: Record<string, number>; parse_failures: number;
                     standing_positive: 'present' | 'MISSING' | 'n/a';
                     status: 'ok' | 'UNREACHED' };

const rows: Row[] = [];
const receipts: Record<string, FeedReceipt> = {};
const days = (ms: number) => Math.floor(ms / 86400000);
const ageOf = (p: string) => { try { return days(NOW.getTime() - fs.statSync(p).mtimeMs); } catch { return -1; } };

function newReceipt(): FeedReceipt {
    return { scanned: 0, derived: 0, excluded: {}, parse_failures: 0,
             standing_positive: 'n/a', status: 'ok' };
}
function excl(r: FeedReceipt, cls: string) { r.excluded[cls] = (r.excluded[cls] || 0) + 1; }

// ── Sanitiser (M2/T1): does this LINE carry a real marker, not a quoted/example one?
function realMarker(line: string, inFence: boolean): boolean {
    if (inFence) return false;
    if (/[<>]/.test(line)) return false;                 // placeholder examples: <who>, <condition>
    if (/`[^`]*(WAITING|PARKED)[^`]*`/.test(line)) return false; // backtick-quoted
    return /^\s*[-*]?\s*(WAITING-ON|PARKED-UNTIL):/.test(line);  // line-start only
}

// ── Casey §2: three-outcome condition evaluation.
function evalCondition(cond: string): 'TRUE' | 'FALSE' | 'UNEVALUABLE' {
    const c = cond.trim();
    const iso = c.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (iso) return new Date(iso[1] + 'T23:59:59+10:00') < NOW ? 'TRUE' : 'FALSE';
    const plan = c.match(/^plan:([\w./-]+):LANDED$/i);
    if (plan) {
        const p = path.isAbsolute(plan[1]) ? plan[1] : path.join(PLANS_DIR, plan[1]);
        try {
            const head = fs.readFileSync(p, 'utf8').split('\n').slice(0, 30).join('\n');
            const st = head.match(/\*{0,2}Status:?\*{0,2}\s*([^\n]*)/i);
            return st && DONE_STATUS.test(st[1]) ? 'TRUE' : 'FALSE';
        } catch { return 'UNEVALUABLE'; }
    }
    const thread = c.match(/^thread:([\w-]+):resolved$/i);
    if (thread) {
        try {
            const db = new Database(DB_PATH, { readonly: true });
            const r = db.prepare('SELECT status FROM conversations WHERE id = ?').get(thread[1]) as { status?: string } | undefined;
            db.close();
            if (!r) return 'UNEVALUABLE';
            return r.status !== 'open' ? 'TRUE' : 'FALSE';
        } catch { return 'UNEVALUABLE'; }
    }
    return 'UNEVALUABLE'; // the structural push toward machine-evaluable conditions
}

function parsePark(line: string, source: string, age: number, feed: string): Row | null {
    const m = line.match(/PARKED-UNTIL:\s*([^|]+?)\s*\|\s*owner:\s*([^|]+?)\s*\|\s*because:\s*(.+)$/i);
    if (!m) {
        // Casey §1: refuse-don't-classify — a park missing its fields cannot hold.
        return { feed, what: source, age_days: age, detail: line.trim().slice(0, 140),
                 state: 'unattended',
                 park: { condition: '', owner: '', ground: '', verdict: 'MALFORMED' } };
    }
    const [, cond, owner, ground] = m;
    // stranger test, mechanical floor: memory-anchored conditions are refused
    if (/when i get to it|someday|eventually|remember/i.test(cond))
        return { feed, what: source, age_days: age, detail: line.trim().slice(0, 140),
                 state: 'unattended',
                 park: { condition: cond, owner, ground, verdict: 'MALFORMED' } };
    const v = evalCondition(cond);
    if (v === 'FALSE')
        return { feed, what: source, age_days: age, detail: `parked — ${ground.slice(0, 100)}`,
                 state: 'parked', park: { condition: cond, owner, ground, verdict: 'FALSE' } };
    // TRUE (expired) and UNEVALUABLE both convert LOUD, provenance kept (Jim + Casey §3)
    const verdict = v === 'TRUE' ? 'EXPIRED' : 'UNEVALUABLE';
    return { feed, what: source, age_days: age, detail: line.trim().slice(0, 140),
             state: 'unattended',
             park: { condition: cond, owner, ground, verdict,
                     provenance: `park ${verdict === 'EXPIRED' ? 'expired' : 'condition no longer checkable'} — condition was "${cond.trim()}", owner ${owner.trim()}` } };
}

// ── FEED 1: uncommitted tree changes (MNT-202's class) ─────────────────────────
function feedGit() {
    const r = newReceipt();
    for (const [repo, label, churn] of [[HAN_REPO, 'han', []], [MEM_REPO, 'hanmemory', HAN_MEM_CHURN]] as [string, string, RegExp[]][]) {
        let out = '';
        try { out = execSync(`git -C ${repo} status --porcelain`, { encoding: 'utf8' }); }
        catch { r.parse_failures++; continue; }
        for (const line of out.split('\n')) {
            if (!line.trim()) continue;
            r.scanned++;
            const file = line.slice(3).trim();
            if (churn.some(rx => rx.test(file))) { excl(r, 'memory-churn'); continue; }
            if (line.startsWith('??') && !/\.(ts|sh|js|py|md)$/.test(file)) { excl(r, 'untracked-non-source'); continue; }
            const full = path.join(repo, file);
            rows.push({ feed: 'git', what: `${label}:${file}`, age_days: ageOf(full),
                        detail: `uncommitted (${line.slice(0, 2).trim() || '??'}) — MNT-202: already live if runtime`,
                        state: 'unattended' });
            r.derived++;
        }
    }
    receipts['git'] = r;
}

// ── FEED 2: plans not marked done (M1: unstamped → TRIAGE, never the loud lane) ─
function feedPlans() {
    const r = newReceipt();
    const scanDir = (dir: string, fixture: boolean) => {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
            const p = path.join(dir, f);
            if (OWN_OUTPUT.includes(p)) { excl(r, 'own-output'); continue; }
            r.scanned++;
            if (fixture && f === 'standing-positive-plan.md') r.standing_positive = 'present';
            const head = fs.readFileSync(p, 'utf8').split('\n').slice(0, 30);
            const stLine = head.find(l => /^\s*>?\s*\*{0,2}Status:?\*{0,2}/i.test(l));
            if (stLine && DONE_STATUS.test(stLine)) { excl(r, 'done-status'); continue; }
            if (/\.bak$|\.v\d/.test(f)) { excl(r, 'backup-copy'); continue; }
            const parkLine = MARKER_EXCLUDED.includes(p2 => p2 === p) || MARKER_EXCLUDED.includes(p)
                ? undefined
                : head.find(l => realMarker(l, false) && /PARKED-UNTIL/i.test(l));
            const age = ageOf(p);
            if (parkLine) {
                const row = parsePark(parkLine, `plan:${f}`, age, 'plans');
                if (row) { rows.push(row); r.derived++; }
            } else if (!stLine) {
                rows.push({ feed: 'plans', what: `plan:${f}`, age_days: age,
                            detail: 'no Status: line — M1 triage bucket (stamp DONE-class or adopt a park)',
                            state: 'triage' });
                r.derived++;
            } else {
                rows.push({ feed: 'plans', what: `plan:${f}`, age_days: age,
                            detail: `open — ${stLine.replace(/[>*]/g, '').trim().slice(0, 110)}`,
                            state: 'unattended' });
                r.derived++;
            }
        }
    };
    scanDir(PLANS_DIR, false);
    const fixPlans = path.join(FIXTURES, 'plans');
    if (fs.existsSync(fixPlans)) scanDir(fixPlans, true); else r.standing_positive = 'MISSING';
    if (r.scanned === 0) r.status = 'UNREACHED';
    receipts['plans'] = r;
}

// ── FEED 3: journal OPEN rows aging (>14d) — the wall owns them; we surface AGE ─
function feedJournal() {
    const r = newReceipt();
    let text = '';
    try { text = fs.readFileSync(JOURNAL, 'utf8'); } catch { r.status = 'UNREACHED'; receipts['journal'] = r; return; }
    const lines = text.split('\n');
    const headers: { id: string; date: string; status: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
        const h = lines[i].match(/^#{2,4} .*?(MNT-\d+)/);
        if (!h) continue;
        const dateM = lines[i].match(/(\d{4}-\d{2}-\d{2})/);
        let status = '';
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
            const st = lines[j].match(/\*{0,2}Status:?\*{0,2}\s*([A-Za-z-]+)/i);
            if (st) { status = st[1]; break; }
            if (/^#{2,4} /.test(lines[j])) break;
        }
        headers.push({ id: h[1], date: dateM ? dateM[1] : '', status });
    }
    for (const h of headers) {
        r.scanned++;
        const { id, date, status } = h;
        if (!/OPEN/i.test(status)) { excl(r, 'not-open-or-no-status'); continue; }
        if (!date) { excl(r, 'no-date'); continue; }
        const age = days(NOW.getTime() - new Date(date).getTime());
        if (age <= 14) { excl(r, 'younger-than-14d'); continue; }
        rows.push({ feed: 'journal', what: id, age_days: age,
                    detail: `OPEN ${age}d — on the wall; aging is the signal (last-touch is coarser than header date)`,
                    state: 'unattended' });
        r.derived++;
    }
    if (r.scanned === 0) r.status = 'UNREACHED';
    receipts['journal'] = r;
}

// ── FEEDS 4+5: HELD posts + WAITING-ON markers (conversation DB + marker files) ─
function feedConversationsAndMarkers() {
    const rHeld = newReceipt(); const rMark = newReceipt();
    try {
        const db = new Database(DB_PATH, { readonly: true });
        const since = new Date(NOW.getTime() - 30 * 86400000).toISOString();
        const msgs = db.prepare(`
            SELECT m.conversation_id cid, m.created_at ts, m.content, c.title, c.status
              FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE m.created_at > ? AND c.status = 'open'
               AND (m.content LIKE '%HELD for%' OR m.content LIKE '%HELD UNCOMMITTED%'
                    OR m.content LIKE '%awaiting GREEN%' OR m.content LIKE '%held for audit%'
                    OR m.content LIKE '%WAITING-ON:%' OR m.content LIKE '%PARKED-UNTIL:%')
             ORDER BY m.created_at`).all(since) as any[];
        const heldByThread = new Map<string, { title: string; last: string; n: number }>();
        for (const m of msgs) {
            if (m.cid === DESIGN_THREAD) { excl(rMark, 'design-thread-hard-negative'); excl(rHeld, 'design-thread-hard-negative'); continue; }
            let inFence = false;
            let counted = false;
            for (const line of (m.content as string).split('\n')) {
                if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
                if (realMarker(line, inFence)) {
                    rMark.scanned++;
                    if (/WAITING-ON:/i.test(line)) {
                        const what = line.replace(/^\s*[-*]?\s*WAITING-ON:\s*/i, '').trim();
                        if (msgs.some(x => x.ts > m.ts && (x.content as string).includes('WAITING-DONE:') && (x.content as string).includes(what.slice(0, 40))))
                            { excl(rMark, 'resolved-by-waiting-done'); continue; }
                        rows.push({ feed: 'markers', what: `thread:${m.cid}`, age_days: days(NOW.getTime() - new Date(m.ts).getTime()),
                                    detail: what.slice(0, 140), state: 'unattended' });
                        rMark.derived++;
                    } else {
                        const row = parsePark(line, `thread:${m.cid}`, days(NOW.getTime() - new Date(m.ts).getTime()), 'markers');
                        if (row) { rows.push(row); rMark.derived++; }
                    }
                } else if (/(HELD for|HELD UNCOMMITTED|awaiting GREEN|held for audit)/.test(line) && !inFence && !counted) {
                    rHeld.scanned++; counted = true;
                    heldByThread.set(m.cid, { title: m.title, last: m.ts, n: (heldByThread.get(m.cid)?.n || 0) + 1 });
                }
            }
        }
        for (const [cid, h] of heldByThread) {
            rows.push({ feed: 'held', what: `thread:${cid}`, age_days: days(NOW.getTime() - new Date(h.last).getTime()),
                        detail: `HELD/awaiting-GREEN language in "${(h.title || '').slice(0, 70)}" — coarse needle, verify at thread`,
                        state: 'unattended' });
            rHeld.derived++;
        }
        db.close();
    } catch (e) { rHeld.parse_failures++; rMark.parse_failures++; }
    // marker standing positives (T3 + Casey §4: one live marker + one perpetual park)
    const fixDir = path.join(FIXTURES, 'markers');
    if (fs.existsSync(fixDir)) {
        let sawLive = false, sawPark = false;
        for (const f of fs.readdirSync(fixDir)) {
            const isNegativeDeck = f.startsWith('negative');
            let inFence = false;
            for (const line of fs.readFileSync(path.join(fixDir, f), 'utf8').split('\n')) {
                if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
                if (realMarker(line, inFence)) {
                    if (isNegativeDeck) {
                        // A parsing line in the negative deck is an ACCEPTANCE FAILURE —
                        // the sanitiser has gone permissive (M2/T1). Fail loud in receipts.
                        excl(rMark, 'NEGATIVE-DECK-PARSED-=-SANITISER-FAILURE');
                        rMark.parse_failures++;
                        continue;
                    }
                    rMark.scanned++;
                    if (/WAITING-ON:/i.test(line)) sawLive = true;
                    if (/PARKED-UNTIL:/i.test(line)) { const row = parsePark(line, `fixture:${f}`, 0, 'markers'); if (row?.state === 'parked') sawPark = true; }
                }
            }
        }
        rMark.standing_positive = sawLive && sawPark ? 'present' : 'MISSING';
    } else rMark.standing_positive = 'MISSING';
    if (rMark.scanned === 0) rMark.status = 'UNREACHED';
    if (rHeld.scanned === 0) rHeld.status = 'UNREACHED';
    receipts['held'] = rHeld; receipts['markers'] = rMark;
}

// ── RENDER (T1: NEVER emit raw marker grammar — middle-dot tokens only) ────────
function render(): string {
    const dot = (s: string) => s.replace(/WAITING-ON/gi, 'WAITING·ON').replace(/PARKED-UNTIL/gi, 'PARKED·UNTIL').replace(/WAITING-DONE/gi, 'WAITING·DONE');
    const un = rows.filter(x => x.state === 'unattended' && x.feed !== 'plans' || (x.state === 'unattended' && x.feed === 'plans'))
                   .filter(x => x.state === 'unattended').sort((a, b) => b.age_days - a.age_days);
    const parked = rows.filter(x => x.state === 'parked');
    const triage = rows.filter(x => x.state === 'triage').sort((a, b) => b.age_days - a.age_days);
    const fixRows = un.filter(x => x.what.startsWith('fixture:')); // fixtures excluded from readers (T3)
    const unReal = un.filter(x => !x.what.startsWith('fixture:'));
    let s = `# The Backburner Register — derived view\n\n> DERIVED by scripts/backburner-derive.ts — DO NOT EDIT (recomputed each run; edits are lost\n> by design). Sources are the record; this is a view (DEC-069). Rendered tokens use middle\n> dots so this file harvests to zero (T1). Receipts: ~/.han/health/backburner-derive.jsonl.\n> A stale row cannot lie: it is either not-done or forgotten, and both need seeing.\n> Last derived: ${NOW.toISOString()} (${new Date(NOW.getTime() + 10 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} AEST)\n\n`;
    s += `## UNATTENDED (${unReal.length}) — oldest first; age is a floor, not proof of progress\n\n`;
    s += `| age(d) | feed | what | detail |\n|---|---|---|---|\n`;
    for (const x of unReal) {
        const prov = x.park?.provenance ? ` — **${dot(x.park.provenance)}**` : (x.park?.verdict === 'MALFORMED' ? ' — **malformed park: refused (needs condition | owner | because)**' : '');
        s += `| ${x.age_days} | ${x.feed} | ${dot(x.what)} | ${dot(x.detail)}${prov} |\n`;
    }
    s += `\n## PARKED (${parked.length}) — deliberate, condition-holding; these do not nag\n\n`;
    s += `| feed | what | condition | owner | ground |\n|---|---|---|---|---|\n`;
    for (const x of parked) s += `| ${x.feed} | ${dot(x.what)} | ${dot(x.park!.condition.trim())} | ${x.park!.owner.trim()} | ${dot(x.park!.ground.trim().slice(0, 90))} |\n`;
    s += `\n## TRIAGE (${triage.length}) — M1's one-time flood: plans with no Status: line. Stamp\neach DONE-class, adopt a park (with ground), or leave to graduate into UNATTENDED after triage.\n\n`;
    s += `| age(d) | what |\n|---|---|\n`;
    for (const x of triage) s += `| ${x.age_days} | ${dot(x.what)} |\n`;
    s += `\n## STANDING POSITIVES (excluded from the lanes above; present = feeds alive)\n\n`;
    for (const x of fixRows) s += `- ${dot(x.what)}: ${dot(x.detail.slice(0, 80))}\n`;
    for (const [f, r] of Object.entries(receipts)) s += `- feed ${f}: scanned ${r.scanned}, derived ${r.derived}, positive ${r.standing_positive}, status ${r.status}\n`;
    return s;
}

feedGit(); feedPlans(); feedJournal(); feedConversationsAndMarkers();
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, render());
fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
fs.appendFileSync(RECEIPTS, JSON.stringify({ ts: NOW.toISOString(), feeds: receipts,
    rows: { unattended: rows.filter(x => x.state === 'unattended' && !x.what.startsWith('fixture:')).length,
            parked: rows.filter(x => x.state === 'parked').length,
            triage: rows.filter(x => x.state === 'triage').length } }) + '\n');
console.log(`backburner derived: ${rows.length} rows → ${OUT_FILE}`);
for (const [f, r] of Object.entries(receipts))
    console.log(`  feed ${f}: scanned=${r.scanned} derived=${r.derived} failures=${r.parse_failures} positive=${r.standing_positive} status=${r.status}`);
