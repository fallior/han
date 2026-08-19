/**
 * board-parser.ts — K0: the canonical board-parser (one source, many readers).
 *
 * Parses `maintenance-journal.md` into the typed model every board consumer reads —
 * the hearth's menu-render, Bill (K3), the wall (K1), the reconcile check, and the
 * immune system's diagnose half (FI #134). One parser, five consumers; a second
 * reader is a defect (Tenshi's one-source doctrine, kanban-wall-plan.md K0).
 *
 * Built to the plan's two fail-state cures (the 2026-08-06 wrong-by-two-thirds bite):
 *  - VARIANT-TOLERANT field matching, STRICT token vocabulary. Punctuation is generous
 *    (the four `Status:` forms measured live 2026-08-19: `- **Status:** ` ×116,
 *    `**Status:** ` ×22, `**Status** ` ×4, bare `Status: ` ×3, plus stragglers); the
 *    TOKEN set is fail-closed — the nine tokens MNT-093 ruled, nothing inferred.
 *  - KNOWN BLINDNESS, documented so the check never implies more coverage than it has
 *    (Jim's diff-audit M1 rider, 2026-08-19): a TRUE numbering collision — the same id
 *    heading two DIFFERENT tickets — is absorbed as an update chain and still "accounts
 *    for" every header, so `reconciles` CANNOT fire on it. The cure is data-side (the
 *    journal's never-renumber + suffix conventions; live case: MNT-158 → 158b, repaired
 *    by Tenshi per MNT-153's dependents-keep-the-number rule). Note the file carries TWO
 *    live suffix conventions (Tenshi's census: the older pairs vacate the base, MNT-153
 *    keeps it) — a convention ruling is pending; the parser renders both.
 *  - NOTHING VANISHES. Three computed states, distinct on purpose (v2 §A2):
 *      · `Unclassified`  — no Status line at all (rendered, never written — the
 *        "how many entries has nobody ever assessed?" query, exact by construction)
 *      · `NONCONFORMING` — a Status line whose token is outside the ruled set
 *        (raw text preserved; the strict-mode lint's food)
 *      · `UNPARSEABLE`   — a header that could not even yield an id
 *    A health metric that cannot embarrass its author is decoration — see
 *    `reconcile()`: every raw header must be accounted for, or the parse REFUSES.
 *
 * Model shaped for the ruled future without building it (Darron 2026-08-18: journal
 * alone first; v2 §A1 two-source grammar held for his sitting): every node carries
 * `source` (§A3 — free at K0, expensive at K3), and the vocabulary is a parameter of
 * the grammar, so the ideas file becomes a second SCOPED vocabulary later, not a fork.
 *
 * Read-only by contract: this module never writes anything, anywhere (non-goal #3).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── The ruled vocabulary (MNT-093, the Privateer ruling — fail-closed) ──────────

export const JOURNAL_STATUS_TOKENS = [
    'OPEN', 'IN-PROGRESS', 'PARKED', 'BLOCKED', 'CLOSED',
    "WON'T-FIX", 'BENIGN-BY-DESIGN', 'DUPLICATE', 'REOPENED',
] as const;
export type JournalStatusToken = typeof JOURNAL_STATUS_TOKENS[number];

/** Computed states — rendered, never written (v2 §A2). Disjoint from the vocabulary. */
export type ComputedState = 'Unclassified' | 'NONCONFORMING' | 'UNPARSEABLE';
export type LaneState = JournalStatusToken | ComputedState;

// ── The typed model (kanban-wall-plan.md K0 spec + Casey's measured field set) ──

export interface StatusReading {
    /** The raw text after the Status field marker, verbatim (trimmed). */
    raw: string;
    /** The ruled token if the raw text begins with one; null = nonconforming. */
    token: JournalStatusToken | null;
    /** 1-indexed line in the source file — every reading is findable. */
    line: number;
}

export interface BoardLink {
    kind: 'wiki' | 'thread' | 'commit' | 'dec' | 'fm' | 'mnt' | 'fi' | 'file';
    /** Normalised target: wiki name, thread id, short-sha, DEC-093, FM#42, MNT-148, FI#93, path:line. */
    target: string;
}

export interface ParkedBlock {
    /** `Resume-when:` / `Resume when:` — the trigger says which job you can take tonight. */
    resumeWhen?: string;
    /** `Held:` date where present — the date only sorts. */
    heldDate?: string;
    owner?: string;
}

export interface MinisterialFields {
    size?: string;          // Size:
    reversibleHow?: string; // Reversible: / Reversible-how:
    receiptTo?: string;     // Receipt-to:
    hearthSafe?: string;    // Hearth-safe:
    matter?: string;        // Matter:
    heldFor?: string;       // Held-for:
    pull?: string;          // Pull: (DISPLAY ONLY until authorship-binding — v2 §C)
    doneLooksLike?: string; // Done-looks-like:
}

export interface BoardEntry {
    /** `MNT-148`, `MNT-046b` — the never-renumbered key, suffix kept. */
    id: string;
    /** Numeric part, for sorting. */
    num: number;
    suffix: string;
    title: string;
    /** Date mined from the header parens where present (YYYY-MM-DD). */
    date?: string;
    /** First Status reading in the head block; null = none found. */
    status: StatusReading | null;
    /** Later same-id headers and later Status lines, in file order. */
    statusUpdates: StatusReading[];
    /** The lane the wall files this card under: last conforming token across the
     *  chain, else NONCONFORMING (a reading exists, none conform), else Unclassified. */
    effectiveState: LaneState;
    severity?: string;
    caughtBy?: string;
    owner?: string;
    parked?: ParkedBlock;
    ministerial: MinisterialFields;
    /** [[wiki]] + thread/commit/DEC/FM/MNT/FI/file refs mined from the Locators and
     *  Refs fields (scoped mining — auditable, not body-wide soup). */
    links: BoardLink[];
    /** Blocked-by field targets (the DAG edges). Wild count today: 0 line-start,
     *  present inline — both layouts read. */
    blockedBy: string[];
    /** Which file this node came from (v2 §A3 — provenance per node). */
    source: string;
    /** 1-indexed line of the entry header. */
    line: number;
    /** Raw body of the head block (for renderers that need the prose; links, never copies). */
    body: string;
}

export interface BoardReconciliation {
    rawHeaderCount: number;      // independent count #1: regex over the raw text
    parsedEntryCount: number;    // head entries
    updateHeaderCount: number;   // same-id later headers, attached as updates
    unparseableCount: number;    // headers that yielded no id
    /** Independent count #2: raw Status-line count vs readings held in the model. */
    rawStatusLineCount: number;
    modelStatusReadingCount: number;
    /** True only if every raw header and every raw status line is accounted for. */
    reconciles: boolean;
    laneTotals: Record<string, number>;
}

export interface ParsedBoard {
    entries: BoardEntry[];
    /** Headers that yielded no id — rendered as UNPARSEABLE cards, never dropped. */
    unparseable: { line: number; headerText: string; body: string }[];
    /** Derived on every parse — no hand-written backlink ever exists (non-goal #2). */
    backlinks: Map<string, string[]>;
    reconciliation: BoardReconciliation;
    source: string;
}

// ── Grammar (variant-tolerant punctuation; measured against the live file) ──────

/** Entry header: `### MNT-148 — title...` (suffix + malformed forms admitted to the
 *  match so they can be ACCOUNTED, then judged). */
const HEADER_RE = /^###\s+MNT-(\S*)\s*(?:—|-|:)?\s*(.*)$/;

/** A field line, punctuation-generous on the four measured forms, PRECISE at the name
 *  boundary (Jim N1): a BOLDED name may omit the colon (`**Status** PARKED`, v3), a BARE
 *  name requires one (`Status: X`, v4) — so `Status quo maintained…` and `Statuses are…`
 *  never read as field lines. Both alternatives carry a hard word-boundary after the name. */
function fieldRe(name: string): RegExp {
    // name may contain spaces/hyphens interchangeably (Resume-when / Resume when)
    const flex = name.replace(/[- ]/g, '[- ]');
    return new RegExp(
        String.raw`^\s*[-*]?\s*(?:\*{1,2}${flex}(?![A-Za-z-])\*{0,2}\s*:?\*{0,2}:?|${flex}(?![A-Za-z-])\s*:)\s*(.+)$`,
        'i');
}
const STATUS_RE = fieldRe('Status');

/** Inline fields inside a `**Kanban fields:**` paragraph (the :3630 layout):
 *  `Field: value` pairs separated by the next `Field:` or end. */
const KANBAN_BLOCK_RE = /\*{0,2}Kanban fields:?\*{0,2}\s*(.+)$/i;

const INLINE_FIELD_NAMES = [
    'Status', 'Owner', 'Pull', 'Resume-when', 'Resume when', 'Done-looks-like', 'Refs',
    'Blocked-by', 'Held-for', 'Receipt-to', 'Severity', 'Caught-by', 'Caught by',
    'Size', 'Reversible', 'Reversible-how', 'Hearth-safe', 'Matter', 'Held',
] as const;

function parseInlineFields(text: string): Record<string, string> {
    // Split on occurrences of `Name:` (bold markers tolerated) for known names only —
    // an unknown word with a colon stays inside the previous field's value.
    const out: Record<string, string> = {};
    const names = [...INLINE_FIELD_NAMES].sort((a, b) => b.length - a.length);
    const nameAlt = names.map(n => n.replace(/[- ]/g, '[- ]')).join('|');
    const re = new RegExp(String.raw`\*{0,2}(${nameAlt})\*{0,2}\s*:\s*`, 'gi');
    const hits: { name: string; start: number; valueStart: number }[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
        hits.push({ name: m[1].toLowerCase().replace(/ /g, '-'), start: m.index, valueStart: re.lastIndex });
    }
    for (let i = 0; i < hits.length; i++) {
        const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
        // The inline layout separates fields with `. ` / `·` — a single trailing
        // full stop is the separator, not the value (measured at journal:3630).
        out[hits[i].name] = text.slice(hits[i].valueStart, end).trim()
            .replace(/[·|]\s*$/, '').replace(/(?<!\.)\.$/, '').trim();
    }
    return out;
}

function readStatusToken(raw: string): JournalStatusToken | null {
    // Fail-closed: the raw must BEGIN with a ruled token (bold/emoji stripped),
    // ended by a word boundary. `OPEN.`/`OPEN —` conform; `OPENISH` does not.
    const clean = raw.replace(/^[\s*_🟢🟡🔴⚪✅❌🔒—-]+/u, '').toUpperCase();
    for (const t of JOURNAL_STATUS_TOKENS) {
        if (clean.startsWith(t)) {
            const rest = clean.slice(t.length);
            if (rest === '' || /^[^A-Z]/.test(rest)) return t;
        }
    }
    return null;
}

// ── Link mining (scoped: Locators + Refs fields — auditable, not body-wide) ─────

const LINK_PATTERNS: { kind: BoardLink['kind']; re: RegExp; norm: (m: RegExpExecArray) => string }[] = [
    { kind: 'wiki', re: /\[\[([^\]]+)\]\]/g, norm: m => m[1].trim() },
    { kind: 'thread', re: /\b(m[a-z0-9]{7}-[a-z0-9]{6})\b/g, norm: m => m[1] },
    { kind: 'dec', re: /\bDEC-(\d+)\b/g, norm: m => `DEC-${m[1]}` },
    { kind: 'fm', re: /\bFM\s?#?(\d+)\b/g, norm: m => `FM#${m[1]}` },
    { kind: 'mnt', re: /\bMNT-(\d+[a-z]?)\b/g, norm: m => `MNT-${m[1]}` },
    { kind: 'fi', re: /\b(?:FI\s?#|future-idea\s?#|#)(\d{1,3})\b/g, norm: m => `FI#${m[1]}` },
    { kind: 'file', re: /\b([\w./-]+\.(?:ts|js|sh|md|py|sql|json))(?::(\d+))?\b/g, norm: m => m[2] ? `${m[1]}:${m[2]}` : m[1] },
    { kind: 'commit', re: /\b([0-9a-f]{7,40})\b/g, norm: m => m[1].slice(0, 7) },
];

/** Canonical MNT key (Jim N2): early ids are zero-padded (`MNT-004`), recent ones are
 *  not — normalise the NUMERIC part so `MNT-42` and `MNT-042` are one backlink key.
 *  Display ids on cards stay as written (never-renumber); only keys/targets canonicalise. */
export function canonMnt(id: string): string {
    return id.replace(/^MNT-0+(\d)/, 'MNT-$1');
}

function mineLinks(text: string, selfId: string): BoardLink[] {
    const seen = new Set<string>();
    const links: BoardLink[] = [];
    for (const { kind, re, norm } of LINK_PATTERNS) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
            let target = norm(m);
            if (kind === 'mnt') target = canonMnt(target); // N2: one key per ticket
            if (kind === 'mnt' && target === canonMnt(selfId)) continue; // self-refs are not edges
            if (kind === 'commit' && /^\d+$/.test(target)) continue; // pure digits ≠ sha
            const key = `${kind}:${target}`;
            if (!seen.has(key)) { seen.add(key); links.push({ kind, target }); }
        }
    }
    return links;
}

// ── The parse ───────────────────────────────────────────────────────────────────

export const JOURNAL_PATH = path.join(os.homedir(), '.han', 'memory', 'shared', 'maintenance-journal.md');

export function parseBoard(sourcePath: string = JOURNAL_PATH): ParsedBoard {
    const text = fs.readFileSync(sourcePath, 'utf-8');
    const lines = text.split('\n');
    const sourceName = path.basename(sourcePath);

    // Independent raw counts FIRST (the embarrassment check's ground truth) —
    // computed from the raw text with the same primitive greps a by-hand count uses.
    const rawHeaderCount = lines.filter(l => /^###\s+MNT-/.test(l)).length;
    const rawStatusLineCount = lines.filter(l => STATUS_RE.test(l) && !HEADER_RE.test(l)).length;

    interface Block { headerLine: number; headerText: string; id: string | null; num: number; suffix: string; title: string; date?: string; body: string[]; bodyStart: number }
    const blocks: Block[] = [];
    let cur: Block | null = null;
    for (let i = 0; i < lines.length; i++) {
        const h = /^###\s+MNT-/.test(lines[i]) ? HEADER_RE.exec(lines[i]) : null;
        if (h) {
            if (cur) blocks.push(cur);
            const idPart = h[1] ?? '';
            const m = /^(\d+)([a-z]?)\b/.exec(idPart);
            const rest = h[2] ?? '';
            const dateM = /\((\d{4}-\d{2}-\d{2})/.exec(rest);
            cur = {
                headerLine: i + 1, headerText: lines[i],
                id: m ? `MNT-${m[1]}${m[2]}` : null,
                num: m ? parseInt(m[1], 10) : -1,
                suffix: m ? m[2] : '',
                // Title: header remainder; same-id continuations keep their own header text.
                title: (m ? idPart.slice(m[0].length) : idPart).replace(/^[\s—:-]+/, '') || rest.replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, '').trim(),
                date: dateM?.[1],
                body: [], bodyStart: i + 2,
            };
            if (cur.title === '' && rest) cur.title = rest;
        } else if (cur) {
            cur.body.push(lines[i]);
        }
    }
    if (cur) blocks.push(cur);

    const byId = new Map<string, BoardEntry>();
    const entries: BoardEntry[] = [];
    const unparseable: ParsedBoard['unparseable'] = [];
    let updateHeaderCount = 0;

    for (const b of blocks) {
        if (!b.id) {
            unparseable.push({ line: b.headerLine, headerText: b.headerText, body: b.body.join('\n') });
            continue;
        }
        const bodyText = b.body.join('\n');

        // Status readings: every field-form Status line in this block, in order.
        const readings: StatusReading[] = [];
        b.body.forEach((l, idx) => {
            const m = STATUS_RE.exec(l);
            if (m) readings.push({ raw: m[1].trim(), token: readStatusToken(m[1]), line: b.bodyStart + idx });
        });
        // Inline Kanban-fields paragraph (the :3630 layout) — fields merge, line-start wins.
        let inline: Record<string, string> = {};
        for (const l of b.body) {
            const kb = KANBAN_BLOCK_RE.exec(l);
            if (kb) { inline = { ...inline, ...parseInlineFields(kb[1]) }; }
        }
        if (inline['status'] !== undefined) {
            const kbLine = b.body.findIndex(l => KANBAN_BLOCK_RE.test(l));
            readings.push({ raw: inline['status'], token: readStatusToken(inline['status']), line: b.bodyStart + kbLine });
        }

        const field = (name: string): string | undefined => {
            for (const l of b.body) {
                const m = fieldRe(name).exec(l);
                if (m) return m[1].trim();
            }
            return inline[name.toLowerCase().replace(/ /g, '-')];
        };

        const existing = byId.get(b.id);
        if (existing) {
            // Same-id later header = a status-update block (MNT-160 RESULT, the 009
            // STATUS UPDATE shape). Its readings join the chain; its text joins nothing
            // (links stay scoped to the head's Locators/Refs — auditable).
            updateHeaderCount++;
            existing.statusUpdates.push(...readings);
            const lastTok = [...existing.statusUpdates, ...(existing.status ? [existing.status] : [])]
                .filter(r => r.token).map(r => r.token as JournalStatusToken);
            recomputeEffective(existing);
            void lastTok;
            continue;
        }

        const locatorsText = [field('Locators') ?? '', field('Refs') ?? ''].join(' \n ');
        const entry: BoardEntry = {
            id: b.id, num: b.num, suffix: b.suffix, title: b.title, date: b.date,
            status: readings[0] ?? null,
            statusUpdates: readings.slice(1),
            effectiveState: 'Unclassified',
            severity: field('Severity'),
            caughtBy: field('Caught-by'),
            owner: field('Owner'),
            parked: (field('Resume-when') || field('Parked')) ? {
                resumeWhen: field('Resume-when'),
                heldDate: field('Held'),
                owner: field('Owner'),
            } : undefined,
            ministerial: {
                size: field('Size'),
                reversibleHow: field('Reversible') ?? field('Reversible-how'),
                receiptTo: field('Receipt-to'),
                hearthSafe: field('Hearth-safe'),
                matter: field('Matter'),
                heldFor: field('Held-for'),
                pull: field('Pull'),
                doneLooksLike: field('Done-looks-like'),
            },
            links: mineLinks(locatorsText, b.id),
            blockedBy: (field('Blocked-by') ?? '').split(/[,;·]/).map(s => s.trim()).filter(s => /^MNT-\d+[a-z]?$/.test(s)),
            source: sourceName,
            line: b.headerLine,
            body: bodyText,
        };
        recomputeEffective(entry);
        byId.set(b.id, entry);
        entries.push(entry);
    }

    // Backlinks: derived, every parse, from forward links (non-goal #2).
    // Keys are CANONICAL MNT ids (N2) — values keep the pointing entry's display id.
    const backlinks = new Map<string, string[]>();
    for (const e of entries) {
        for (const l of e.links) {
            if (l.kind !== 'mnt') continue;
            const arr = backlinks.get(l.target) ?? [];
            arr.push(e.id);
            backlinks.set(l.target, arr);
        }
        for (const b of e.blockedBy) {
            const key = canonMnt(b);
            const arr = backlinks.get(key) ?? [];
            if (!arr.includes(e.id)) arr.push(e.id);
            backlinks.set(key, arr);
        }
    }

    // The self-embarrassment check: every raw header accounted, every status line held.
    const laneTotals: Record<string, number> = {};
    for (const e of entries) laneTotals[e.effectiveState] = (laneTotals[e.effectiveState] ?? 0) + 1;
    if (unparseable.length) laneTotals['UNPARSEABLE'] = unparseable.length;
    const modelStatusReadingCount = entries.reduce(
        (n, e) => n + (e.status ? 1 : 0) + e.statusUpdates.length, 0);
    const reconciliation: BoardReconciliation = {
        rawHeaderCount,
        parsedEntryCount: entries.length,
        updateHeaderCount,
        unparseableCount: unparseable.length,
        rawStatusLineCount,
        modelStatusReadingCount,
        reconciles:
            rawHeaderCount === entries.length + updateHeaderCount + unparseable.length
            && modelStatusReadingCount >= rawStatusLineCount,
        laneTotals,
    };

    return { entries, unparseable, backlinks, reconciliation, source: sourceName };
}

function recomputeEffective(e: BoardEntry): void {
    const chain = [...(e.status ? [e.status] : []), ...e.statusUpdates];
    const conforming = chain.filter(r => r.token);
    if (conforming.length) e.effectiveState = conforming[conforming.length - 1].token as JournalStatusToken;
    else if (chain.length) e.effectiveState = 'NONCONFORMING';
    else e.effectiveState = 'Unclassified';
}

// ── CLI: the reconcile run (Jim's seal food — run it by your own hand) ──────────

if (require.main === module) {
    // `board-parser | head` must not crash the reporter (EPIPE = the reader left, fine).
    process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
    const board = parseBoard(process.argv[2] ?? JOURNAL_PATH);
    const r = board.reconciliation;
    console.log(`board-parser reconcile — ${board.source}`);
    console.log(`  raw headers: ${r.rawHeaderCount} = entries ${r.parsedEntryCount} + updates ${r.updateHeaderCount} + unparseable ${r.unparseableCount} → ${r.rawHeaderCount === r.parsedEntryCount + r.updateHeaderCount + r.unparseableCount ? 'OK' : 'MISMATCH'}`);
    console.log(`  raw status lines: ${r.rawStatusLineCount}; readings in model: ${r.modelStatusReadingCount} → ${r.modelStatusReadingCount >= r.rawStatusLineCount ? 'OK' : 'MISMATCH'}`);
    console.log(`  RECONCILES: ${r.reconciles}`);
    console.log('  lanes:');
    for (const [lane, n] of Object.entries(r.laneTotals).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${lane.padEnd(18)} ${n}`);
    }
    const bl = [...board.backlinks.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    console.log(`  backlink index: ${board.backlinks.size} targets; densest: ${bl.map(([t, s]) => `${t}←${s.length}`).join(', ')}`);
}
