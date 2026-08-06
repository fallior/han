/**
 * FI #132 — The Token Ledger (P0: measure & attribute; NO alarms in this phase).
 *
 * Harvests per-turn token usage from the shared harness transcripts
 * (~/.claude/projects/** /*.jsonl) into an append-only ledger of 10-minute windows
 * per (agent-or-human, surface, model, sidechain). Plan: plans/token-ledger-plan.md
 * (Jim GREEN + M1/M2; Tenshi lanes/constants structure; Casey riders 1–5).
 *
 * Load-bearing properties (each traced to an audit clause):
 *  - PROJECTION, not redaction (F5): only usage counters, model, timestamp, cwd,
 *    sessionId, isSidechain are ever retained from a record. Message content is never
 *    stored, logged, or quoted — including on the ERROR path (Casey R5: parse failures
 *    report file + byte offset + length, never line text).
 *  - Per-family counters are first-class (Jim M1 / Tenshi's lanes): input, output,
 *    cache_creation, cache_read are separate ledger columns; no single-scalar total.
 *  - human/other is a CLASS, not an anomaly (Jim M2): a cwd outside the agent dirs is
 *    ledgered as 'human-other' and must never feed an unknown-growth alarm (Rule C, P1).
 *  - Append-only witness (Casey R1 / DEC-069): rows are mechanical, no prose; corrections
 *    are new rows; rotation is archive-move, never truncate (F3).
 *  - Genesis at EOF (F1): first run meters from now; `--backfill <days>` opts into history.
 *  - The harvester burns zero tokens and wakes nothing (Jim's observer-effect check):
 *    plain file I/O only.
 *
 * Modes:
 *   harvest              — incremental scan (the cron entrypoint)
 *   harvest --backfill N — genesis only: include existing transcript bytes from files
 *                          modified within N days (otherwise genesis cursors sit at EOF)
 *   report               — last-24h aggregation + the coverage declaration (Casey R2)
 *
 * Env overrides (tests only — the suite runs on a scratch substrate, never prod paths):
 *   TOKEN_LEDGER_PROJECTS_DIR, TOKEN_LEDGER_STATE, TOKEN_LEDGER_FILE,
 *   TOKEN_LEDGER_ROTATE_BYTES, TOKEN_LEDGER_AGENTS_ROOT
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadResidents } from '../src/server/lib/garden-manifest';

const HOME = os.homedir();
const PROJECTS_DIR = process.env.TOKEN_LEDGER_PROJECTS_DIR || path.join(HOME, '.claude', 'projects');
const STATE_FILE = process.env.TOKEN_LEDGER_STATE || path.join(HOME, '.han', 'health', 'token-ledger-state.json');
const LEDGER_FILE = process.env.TOKEN_LEDGER_FILE || path.join(HOME, '.han', 'health', 'token-ledger.jsonl');
const ROTATE_BYTES = Number(process.env.TOKEN_LEDGER_ROTATE_BYTES || 50_000_000);
const AGENTS_ROOT = process.env.TOKEN_LEDGER_AGENTS_ROOT || path.join(HOME, '.han', 'agents');
const WINDOW_MS = 10 * 60 * 1000;

interface Cursor { bytes: number; }
interface LedgerState {
    initialisedAt: string;
    cursors: Record<string, Cursor>;
    /** F3: tombstones for transcripts that vanished — path pruned, count kept. */
    retiredFiles: number;
    /** Casey R5: error COUNT + last location only; never content. */
    parseErrors: number;
    lastParseError?: { file: string; offset: number; length: number; at: string };
}

interface WindowKey { window: string; agent: string; cls: 'agent' | 'human-other'; surface: string; model: string; side: 0 | 1; }
interface WindowAgg extends WindowKey { turns: number; in: number; out: number; cc: number; cr: number; }

function loadState(): LedgerState | null {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as LedgerState; } catch { return null; }
}
function saveState(s: LedgerState): void {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, STATE_FILE);
}

/** cwd → (slug | human-other) via the resident roster (DEC-081: a 4th agent maps for free).
 *  Agent dirs are ~/.han/agents/<displayName> (DEC-098 — every spoke cds there). */
function buildAgentResolver(): (cwd: string) => { agent: string; cls: 'agent' | 'human-other' } {
    const dirToSlug = new Map<string, string>();
    for (const r of loadResidents()) {
        dirToSlug.set(path.join(AGENTS_ROOT, r.displayName), r.slug);
    }
    return (cwd: string) => {
        for (const [dir, slug] of dirToSlug) {
            if (cwd === dir || cwd.startsWith(dir + path.sep)) return { agent: slug, cls: 'agent' };
        }
        return { agent: 'human-other', cls: 'human-other' }; // M2: ledgered, never alarmed
    };
}

function listTranscripts(): string[] {
    const out: string[] = [];
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
    for (const d of dirs) {
        const dir = path.join(PROJECTS_DIR, d);
        let files: string[] = [];
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const f of files) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
    }
    return out;
}

function windowStart(tsIso: string): string {
    const t = Date.parse(tsIso);
    if (Number.isNaN(t)) return '';
    return new Date(Math.floor(t / WINDOW_MS) * WINDOW_MS).toISOString();
}

/** Read complete newline-terminated lines from `cursor` on; a trailing partial line is NOT
 *  consumed (live-append tolerance) — the cursor advances only past whole lines. */
function readNewLines(file: string, from: number): { lines: Array<{ text: string; offset: number }>; newCursor: number } {
    const size = fs.statSync(file).size;
    if (size <= from) return { lines: [], newCursor: size < from ? 0 : from }; // shrunk file → rotated: reset (F3)
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    const lines: Array<{ text: string; offset: number }> = [];
    let lineStart = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
            lines.push({ text: buf.subarray(lineStart, i).toString('utf-8'), offset: from + lineStart });
            lineStart = i + 1;
        }
    }
    return { lines, newCursor: from + lineStart };
}

function harvest(backfillDays: number | null): void {
    let state = loadState();
    const genesis = state === null;
    if (state === null) {
        state = { initialisedAt: new Date().toISOString(), cursors: {}, retiredFiles: 0, parseErrors: 0 };
    }
    const resolve = buildAgentResolver();
    const files = listTranscripts();
    const present = new Set(files);

    // F3: GC cursors whose transcript vanished — tombstone count, path pruned.
    for (const p of Object.keys(state.cursors)) {
        if (!present.has(p)) { delete state.cursors[p]; state.retiredFiles++; }
    }

    const backfillFloor = backfillDays !== null ? Date.now() - backfillDays * 86_400_000 : null;
    const agg = new Map<string, WindowAgg>();

    for (const file of files) {
        if (!(file in state.cursors)) {
            // F1 genesis stance: new files start at EOF on genesis (meter from now) unless
            // backfilled; files APPEARING after genesis are new sessions — read from 0.
            if (genesis) {
                const includeHistory = backfillFloor !== null && fs.statSync(file).mtimeMs >= backfillFloor;
                state.cursors[file] = { bytes: includeHistory ? 0 : fs.statSync(file).size };
            } else {
                state.cursors[file] = { bytes: 0 };
            }
        }
        const { lines, newCursor } = readNewLines(file, state.cursors[file].bytes);
        for (const { text, offset } of lines) {
            if (!text.trim()) continue;
            let rec: Record<string, unknown>;
            try { rec = JSON.parse(text) as Record<string, unknown>; } catch {
                // Casey R5: location only — NEVER the line content.
                state.parseErrors++;
                state.lastParseError = { file, offset, length: text.length, at: new Date().toISOString() };
                continue;
            }
            const msg = rec.message as Record<string, unknown> | undefined;
            const usage = msg?.usage as Record<string, unknown> | undefined;
            if (!usage) continue;
            const w = windowStart(String(rec.timestamp ?? ''));
            if (!w) continue;
            // F5 PROJECTION: exactly these fields, nothing else, ever.
            const { agent, cls } = resolve(String(rec.cwd ?? ''));
            const side: 0 | 1 = rec.isSidechain ? 1 : 0;
            const model = String(msg?.model ?? 'unknown-model');
            const key = `${w}|${agent}|${model}|${side}`;
            const row = agg.get(key) ?? { window: w, agent, cls, surface: 'unjoined', model, side, turns: 0, in: 0, out: 0, cc: 0, cr: 0 };
            row.turns++;
            row.in += Number(usage.input_tokens ?? 0);
            row.out += Number(usage.output_tokens ?? 0);
            row.cc += Number(usage.cache_creation_input_tokens ?? 0);
            row.cr += Number(usage.cache_read_input_tokens ?? 0);
            agg.set(key, row);
        }
        state.cursors[file].bytes = newCursor;
    }

    if (agg.size > 0) {
        fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
        // F3: archive-move rotation — the old ledger is KEPT (DEC-069), never truncated.
        try {
            if (fs.existsSync(LEDGER_FILE) && fs.statSync(LEDGER_FILE).size > ROTATE_BYTES) {
                fs.renameSync(LEDGER_FILE, `${LEDGER_FILE}.${Date.now()}.archive`);
            }
        } catch { /* best-effort rotation */ }
        const out = [...agg.values()]
            .sort((a, b) => a.window.localeCompare(b.window))
            .map((r) => JSON.stringify(r))
            .join('\n') + '\n';
        fs.appendFileSync(LEDGER_FILE, out);
    }
    saveState(state);
    console.log(`[token-ledger] harvest: ${files.length} transcripts, ${agg.size} window-rows appended, ` +
        `${state.parseErrors} parse-errors total (locations only), retired=${state.retiredFiles}`);
}

function report(): void {
    // Casey R2 — the coverage declaration rides every report so a quiet morning is a REAL
    // negative, never a comfortable one (s 69(4) / MNT-084: an index states its own reach).
    const state = loadState();
    console.log('# Token Ledger — last 24h');
    console.log('## Coverage declaration');
    console.log('- Sees: every session of the shared harness on THIS box (~/.claude transcripts), all agents + human/other.');
    console.log('- Cannot see: burn on any other box; API calls outside the harness; the OTLP lane (deferred, plan §6).');
    console.log(`- Surface attribution: 'unjoined' in P0 (fraction joinable = 0% — measured, not hidden; the uuid→surface`);
    console.log('  session-map is the named P1 improvement). Agent attribution: in-band cwd (Jim\'s fold), roster-resolved.');
    console.log(`- Instrument state: ${state ? `initialised ${state.initialisedAt}, ${state.parseErrors} parse-errors (locations only), ${state.retiredFiles} retired transcripts` : 'NO STATE — harvester has never run; this report covers nothing'}`);
    console.log('');
    if (!fs.existsSync(LEDGER_FILE)) { console.log('(ledger empty)'); return; }
    const floor = Date.now() - 86_400_000;
    const per = new Map<string, { turns: number; in: number; out: number; cc: number; cr: number }>();
    for (const line of fs.readFileSync(LEDGER_FILE, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let r: WindowAgg;
        try { r = JSON.parse(line) as WindowAgg; } catch { continue; }
        if (Date.parse(r.window) < floor) continue;
        const key = `${r.agent} ${r.model}${r.side ? ' (sidechain)' : ''}`;
        const t = per.get(key) ?? { turns: 0, in: 0, out: 0, cc: 0, cr: 0 };
        t.turns += r.turns; t.in += r.in; t.out += r.out; t.cc += r.cc; t.cr += r.cr;
        per.set(key, t);
    }
    const fmt = (n: number) => n.toLocaleString('en-AU');
    console.log('| agent+model | turns | input | output | cache_creation | cache_read |');
    console.log('|---|---|---|---|---|---|');
    for (const [k, t] of [...per.entries()].sort((a, b) => (b[1].cc + b[1].out) - (a[1].cc + a[1].out))) {
        console.log(`| ${k} | ${fmt(t.turns)} | ${fmt(t.in)} | ${fmt(t.out)} | ${fmt(t.cc)} | ${fmt(t.cr)} |`);
    }
}

const mode = process.argv[2] ?? 'harvest';
if (mode === 'harvest') {
    const bfIdx = process.argv.indexOf('--backfill');
    const backfill = bfIdx > -1 ? Number(process.argv[bfIdx + 1]) : null;
    if (bfIdx > -1 && (!Number.isFinite(backfill) || backfill! <= 0)) {
        console.error('[token-ledger] --backfill requires a positive day count'); process.exit(2);
    }
    if (backfill !== null && loadState() !== null) {
        console.error('[token-ledger] --backfill is genesis-only (state exists; refusing to re-read history)'); process.exit(2);
    }
    harvest(backfill);
} else if (mode === 'report') {
    report();
} else {
    console.error('usage: han-token-ledger.ts [harvest [--backfill <days>] | report]'); process.exit(2);
}
