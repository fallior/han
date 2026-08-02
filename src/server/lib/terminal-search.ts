/**
 * Terminal-log search — the read layer of the c0↔log provenance active link (P1).
 *
 * Spec: plans/provenance-active-link.md §4. Given a *gist*, recover the *specific*
 * (thread-id, file:line, message-id) from HAN's permanent terminal log as clean,
 * bounded, timestamped excerpts — never a raw 20 GB dump.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * READ-ONLY INVARIANT (§4.3, load-bearing for the §2 trust property — CODE-REVIEW GATE)
 * ───────────────────────────────────────────────────────────────────────────────
 * The terminal log is the ONE record no agent may alter — its only writer is the
 * server's external capture loop (services/terminal.ts). This module MUST NEVER open
 * the log for write/append/truncate/unlink. Every file access here is read-only:
 *   - `fs.openSync(logPath, 'r')` + positioned `fs.readSync` (the recent window), and
 *   - `rg` as a subprocess (ripgrep only reads).
 * There is no `writeSync` / `appendFileSync` / `truncate` / `unlink` / `'w'` / `'a'`
 * against the log path anywhere in this file. Keep it that way.
 *
 * Memory note: the live log is ~20 GB — far past Node's ~2 GB string cap (which is
 * exactly why the existing /api/terminal/history readFileSync silently returns empty
 * on it). `recent` reads a bounded byte window; `all`/`ISO..ISO` stream through `rg`.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import { stripAnsi } from '../services/terminal';
import { dateFromZonedParts } from './garden-time'; // DEC-105 seal rider: the pair shares the writer's clock
import { gardenTimezone } from './garden-manifest';

// ── tunables (D4: window size to refine by measurement) ──────────────────────────
const RECENT_BYTES = 64 * 1024 * 1024;      // ~64 MB tail — days of recent work, sub-second
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_CONTEXT = 3;
const MAX_CONTEXT = 20;
const RG_MAX_MATCHES = 5000;                 // bound rg output on common terms (sets `truncated`)
const RG_MAX_BUFFER = 128 * 1024 * 1024;

const MARKER_RE = /^--- (.+) ---$/;          // `--- 1/06/2026, 6:33:00 pm ---` (services/terminal.ts:123)
const LOCATOR_RE = /[a-z0-9]{8}-[a-z0-9]{6}|\b\w+\.ts:\d+\b/; // thread/msg ids + file:line (§4.4)

export interface TerminalSearchParams {
    q: string;
    window?: string;            // 'recent' (default) | 'all' | 'ISO..ISO'
    limit?: number;
    context?: number;
    ignoreCase?: boolean;
    session?: string;           // D2: deferred to v2 (timestamp+excerpt usually disambiguate)
}

export interface TerminalSearchMatch {
    timestamp: string | null;   // nearest preceding `--- ... ---` marker text (the "when")
    excerpt: string;            // cleaned, bounded lines around the hit
    lineNo: number;             // window-relative for `recent`; file-relative for `all`/ISO
    hasLocator: boolean;        // the match line contains an id / file:line pattern (§4.4)
}

export interface TerminalSearchResult {
    matches: TerminalSearchMatch[];
    scanned: number;            // bytes searched
    truncated: boolean;         // more matches existed than `limit` (or rg cap hit)
    window: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────────

/** Parse an en-AU marker timestamp (`1/06/2026, 6:33:00 pm`) to a Date, or null.
 *
 *  THE GRANDFATHERED PAIR (DEC-105): this is the garden's ONE local-parsed-back site —
 *  the terminal writer renders `toLocaleString('en-AU', { timeZone: gardenTimezone() })`
 *  and this parses it back. Jim's seal-rider root-cure (2026-08-02): the Date is
 *  constructed IN THE WRITER'S OWN ZONE (`dateFromZonedParts(..., gardenTimezone())`),
 *  never the box's — so the pair is correct by construction on any box, UTC system
 *  clocks included (the old box==garden coincidence is retired, not witnessed).
 *
 *  RECORDED RESIDUAL (a) (Jim's, the H2 non-retrospectivity shape): if the garden's
 *  zone is ever CHANGED, markers written before the change parse in the new zone and
 *  skew by the difference. Acceptable for this grandfathered single class (terminal-
 *  search anchoring only); written here so the next builder inherits the boundary.
 *
 *  RECORDED RESIDUAL (b) (Casey's, measured at the seal — NARROWED by Darron's
 *  injectivity rider, 2026-08-02): correct by construction EXCEPT at the DST fold
 *  instant on a BARE (unlabelled) reading, where the input itself is ambiguous and
 *  the resolution is deterministic-but-arbitrary (the standard-time reading — the
 *  later instant). Since the rider, the writer labels every marker with its zone
 *  abbreviation ("… 2:30:00 am AEDT") and this parser honours it — a labelled stamp
 *  is INJECTIVE (02:30 AEDT and 02:30 AEST are as distinct as Sydney and Brisbane
 *  readings), so the residual now covers only LEGACY markers written before the
 *  rider, plus a garbage label (which fails SAFE to the deterministic candidate —
 *  a wrong label degrades to the old behaviour, never breaks anchoring). */
export function parseAuMarker(s: string, zone: string = gardenTimezone()): Date | null {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)(?:\s+([A-Za-z]{2,5}|GMT[+\u2212-]\d{1,2}(?::\d{2})?))?$/i);
    if (!m) return null;
    let [, d, mon, y, h, min, sec, ap, label] = m;
    let hour = Number(h) % 12;
    if (ap.toLowerCase() === 'pm') hour += 12;
    const candidate = dateFromZonedParts(Number(y), Number(mon), Number(d), hour, Number(min), Number(sec), zone);
    if (!label) return candidate; // legacy bare marker — deterministic resolution, unchanged

    // Darron's injectivity rider: the abbreviation names WHICH side of a DST fold was
    // meant. Verify the candidate re-renders to the same label AND wall reading; if not,
    // try the fold's other side (±60/±30 min covers whole- and half-hour DST deltas) and
    // take the first shift that reproduces both. No match → fail safe to the candidate.
    const rendersAs = (dd: Date): { abbr: string; wallOk: boolean } => {
        const fmt = new Intl.DateTimeFormat('en-AU', {
            timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23', timeZoneName: 'short',
        } as Intl.DateTimeFormatOptions);
        const p: Record<string, string> = {};
        for (const part of fmt.formatToParts(dd)) p[part.type] = part.value;
        return {
            abbr: (p.timeZoneName ?? '').toUpperCase(),
            wallOk: +p.year === +y && +p.month === +mon && +p.day === +d
                && +p.hour === hour && +p.minute === +min && +p.second === +sec,
        };
    };
    try {
        const want = label.toUpperCase();
        const first = rendersAs(candidate);
        if (first.abbr === want && first.wallOk) return candidate;
        for (const shiftMin of [-60, 60, -30, 30]) {
            const alt = new Date(candidate.getTime() + shiftMin * 60_000);
            const r = rendersAs(alt);
            if (r.abbr === want && r.wallOk) return alt;
        }
    } catch { /* invalid zone in the re-render probe — fall through to the candidate */ }
    return candidate;
}

function terms(q: string): string[] {
    // Quoted phrase → single term; else space-separated AND.
    const quoted = q.match(/^"(.+)"$/);
    if (quoted) return [quoted[1]];
    return q.split(/\s+/).filter(Boolean);
}

function lineMatches(line: string, ts: string[], ignoreCase: boolean): boolean {
    const hay = ignoreCase ? line.toLowerCase() : line;
    return ts.every(t => hay.includes(ignoreCase ? t.toLowerCase() : t));
}

/** Clean excerpt lines: strip ANSI, drop pure box/spinner residue, collapse blank runs. */
function cleanExcerpt(lines: string[]): string {
    const out: string[] = [];
    for (const raw of lines) {
        const line = stripAnsi(raw);
        if (/^[\s│─┌┐└┘├┤┬┴┼╔╗╚╝║═▐▛▜▝▘⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]*$/.test(line) && line.trim() === '') {
            if (out.length && out[out.length - 1] === '') continue; // collapse blank runs
            out.push('');
            continue;
        }
        out.push(line.replace(/\s+$/, ''));
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

function normalize(line: string): string {
    return stripAnsi(line).replace(/\s+/g, ' ').trim();
}

/**
 * Post-process raw (lineNo, lineText, marker) hits into deduped, bounded, most-recent-first
 * matches. Dedups consecutive near-identical capture repetition within the same marker block.
 */
function finalize(
    hits: { lineNo: number; line: string; marker: string | null; excerpt: string[] }[],
    limit: number,
): { matches: TerminalSearchMatch[]; truncated: boolean } {
    const deduped: typeof hits = [];
    let lastNorm = '';
    let lastMarker: string | null = null;
    for (const h of hits) {
        const norm = normalize(h.line);
        if (norm === lastNorm && h.marker === lastMarker) continue; // diff-capture repetition
        lastNorm = norm; lastMarker = h.marker;
        deduped.push(h);
    }
    const truncated = deduped.length > limit;
    const chosen = deduped.slice(-limit).reverse(); // most-recent first
    const matches = chosen.map(h => ({
        timestamp: h.marker,
        excerpt: cleanExcerpt(h.excerpt),
        lineNo: h.lineNo,
        hasLocator: LOCATOR_RE.test(h.line),
    }));
    return { matches, truncated };
}

// ── window=recent — bounded in-memory tail, pure Node ────────────────────────────
function searchRecent(logPath: string, ts: string[], ignoreCase: boolean, context: number, limit: number): TerminalSearchResult {
    const fd = fs.openSync(logPath, 'r'); // READ-ONLY
    let buf: Buffer;
    let scanned: number;
    try {
        const size = fs.fstatSync(fd).size;
        scanned = Math.min(size, RECENT_BYTES);
        buf = Buffer.alloc(scanned);
        fs.readSync(fd, buf, 0, scanned, size - scanned);
    } finally {
        fs.closeSync(fd);
    }
    const lines = buf.toString('utf8').split('\n');
    if (scanned > 0 && lines.length) lines.shift(); // drop the (likely partial) first line

    const hits: { lineNo: number; line: string; marker: string | null; excerpt: string[] }[] = [];
    let marker: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const mk = lines[i].match(MARKER_RE);
        if (mk) { marker = mk[1]; continue; }
        if (lineMatches(lines[i], ts, ignoreCase)) {
            const from = Math.max(0, i - context);
            const to = Math.min(lines.length, i + context + 1);
            hits.push({ lineNo: i, line: lines[i], marker, excerpt: lines.slice(from, to) });
        }
    }
    const { matches, truncated } = finalize(hits, limit);
    return { matches, scanned, truncated, window: 'recent' };
}

// ── window=all / ISO..ISO — stream through ripgrep, associate markers ────────────
function rgLines(args: string[]): string[] {
    try {
        const out = execFileSync('rg', args, { encoding: 'utf8', maxBuffer: RG_MAX_BUFFER });
        return out.split('\n').filter(Boolean);
    } catch (err: any) {
        if (err && err.status === 1) return []; // rg exit 1 = no matches (not an error)
        throw err;
    }
}

function searchFull(logPath: string, ts: string[], ignoreCase: boolean, context: number, limit: number, iso: [Date, Date] | null): TerminalSearchResult {
    const scanned = (() => { try { return fs.statSync(logPath).size; } catch { return 0; } })();

    // Marker index (line → timestamp text), sorted by line.
    const markerHits = rgLines(['-n', '--no-config', '^--- .* ---$', logPath]);
    const markers = markerHits.map(l => {
        const idx = l.indexOf(':');
        const lineNo = Number(l.slice(0, idx));
        const text = l.slice(idx + 1).match(MARKER_RE);
        return { lineNo, ts: text ? text[1] : null };
    }).filter(m => Number.isFinite(m.lineNo));

    const nearestMarker = (lineNo: number): string | null => {
        // largest marker.lineNo < lineNo (binary search)
        let lo = 0, hi = markers.length - 1, ans: string | null = null;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (markers[mid].lineNo < lineNo) { ans = markers[mid].ts; lo = mid + 1; }
            else hi = mid - 1;
        }
        return ans;
    };

    // Prefilter with rg on the longest term (fixed-string), AND-filter the rest in JS.
    const longest = ts.slice().sort((a, b) => b.length - a.length)[0];
    // `--` terminates rg option parsing so a query starting with `-` can't be read as
    // an rg flag (e.g. `--pre=<cmd>` is command-exec). Jim's P1 audit gate.
    const args = ['-n', '-F', '--max-count', String(RG_MAX_MATCHES), ...(ignoreCase ? ['-i'] : []), '--', longest, logPath];
    const raw = rgLines(args);
    const truncatedByRg = raw.length >= RG_MAX_MATCHES;

    // For excerpts in full-scan mode we don't hold the file in memory; rg gives single
    // lines, so the excerpt is the match line itself (±context would need a second
    // ranged read — deferred; the timestamp + match line carry the locator). v1 honest scope.
    const hits = raw.map(l => {
        const idx = l.indexOf(':');
        const lineNo = Number(l.slice(0, idx));
        const line = l.slice(idx + 1);
        return { lineNo, line, marker: nearestMarker(lineNo), excerpt: [line] };
    }).filter(h => Number.isFinite(h.lineNo) && lineMatches(h.line, ts, ignoreCase));

    const ranged = iso ? hits.filter(h => {
        if (!h.marker) return false;
        const d = parseAuMarker(h.marker);
        return d ? d >= iso[0] && d <= iso[1] : false;
    }) : hits;

    const { matches, truncated } = finalize(ranged, limit);
    return { matches, scanned, truncated: truncated || truncatedByRg, window: iso ? 'iso' : 'all' };
}

// ── public entry ─────────────────────────────────────────────────────────────────
export function searchTerminalLog(logPath: string, params: TerminalSearchParams): TerminalSearchResult {
    const q = (params.q ?? '').trim();
    if (!q) return { matches: [], scanned: 0, truncated: false, window: params.window || 'recent' };

    const ts = terms(q);
    const ignoreCase = !!params.ignoreCase;
    const limit = Math.min(Math.max(1, params.limit || DEFAULT_LIMIT), MAX_LIMIT);
    const context = Math.min(Math.max(0, params.context ?? DEFAULT_CONTEXT), MAX_CONTEXT);
    const window = params.window || 'recent';

    if (window === 'all') return searchFull(logPath, ts, ignoreCase, context, limit, null);
    if (window.includes('..')) {
        const [a, b] = window.split('..');
        const da = new Date(a), db = new Date(b);
        if (!isNaN(da.getTime()) && !isNaN(db.getTime())) {
            return searchFull(logPath, ts, ignoreCase, context, limit, [da, db]);
        }
        // unparseable range → fall through to recent rather than scan-all silently
    }
    return searchRecent(logPath, ts, ignoreCase, context, limit);
}
