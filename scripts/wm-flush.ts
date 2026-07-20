/**
 * #50 / MNT-012 / MNT-060 — per-turn swap → working-memory flush (the harness-enforced endpoint
 * of DEC-085's FLUSH-FIRST). Invoked by the `wm-flush.sh` Stop hook (which gates on the SAME
 * entry-grammar family as this parser — Jim's fold 1 / Tenshi's finding 1: gate and parser must
 * cite one declared contract, or the gate declines bodies the parser could eat and the MNT-060
 * outage recurs inside its own fix).
 *
 * MNT-060 (2026-07-20): the original parser keyed on `### ` alone while every seat wrote `## `
 * (leo/tenshi/casey) or `**…**` (jim) — a garden-wide silent no-op; swaps grew 13 days unseen
 * while the mtime-keyed guard kept demanding writes. This build is the F1–F4 TRANSITIONAL fix:
 *   F1  entry-grammar FAMILY accept (`### ` canonical + `## ` legacy) — recovery-robust;
 *   F2  the silence-breaker: failures + no-op-with-body write ~/.han/health/wm-flush-errors.jsonl;
 *   F3  the backlog guard: body over swapFlushMaxBytes (manifest leaf, default 20K) → ALERT,
 *       never dump (DEC-103 surfacing-over-scrapping) — and fail-CLOSED on measurement failure
 *       (an unreadable swap is alert+preserve, never "treat as empty" — Tenshi's polarity);
 *   F4  the hook's `timeout 30` is sufficient BY CONSTRUCTION now: F3 caps any single flush at
 *       ~20K (a 9.5K flush measured ~2s); the fail-state is alert-and-retry, not silent-kill.
 * TRANSITIONAL, by ruling: the family regex and the `### ` convention are stopgaps. The
 * destination is the MNT-060-addendum SENTINEL FRAME (Darron, 2026-07-20 22:27): a high-entropy
 * transport-frame marker (`<!-- SWAP-ENTRY … -->` family), byte-stuffed at the chokepoint
 * (MNT-026), stripped at flush so it never enters WM or the gradient, with the B-3 guard
 * upgraded to frame-checking — one contract, both hooks, unforgeable by construction. That
 * build is a named follow-on, gated on Tenshi's two endgame tests (frame-quoting body must
 * neither split nor survive the strip; guard fail-closed on measurement).
 *
 * Usage: wm-flush.ts <slug> <fullSwapPath> <compSwapPath>
 *   (the hook passes the already-resolved swap paths, so there's no env re-resolution drift
 *    between the hook's has-body gate and this writer.)
 *
 * Fail-safe map (every branch preserves the swap; a turn is never lost):
 *   read/measure fails → alert 'measurement-failure', preserve, exit 0
 *   body over cap      → alert 'backlog-over-cap',   preserve, exit 0
 *   body empty but file large → alert 'no-entries-but-large' (grammar drift — the outage's
 *                        own shape, made loud), preserve, exit 0
 *   append throws (asymmetric / lock-timeout) → alert 'flush-failed', preserve, exit 1
 *   success → atomic paired append, THEN reset swaps to header-only.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { appendPairedMemory } from '../src/server/lib/memory-paired-writer';
import { swapFlushMaxBytesFor } from '../src/server/lib/garden-manifest';

/** F1 — the declared entry-grammar family (transitional; see header). `### ` is the canonical
 *  forward convention; `## ` is the legacy shape every 07-July-era backlog carries. The `.sh`
 *  gate's has_body() greps the IDENTICAL pattern — change one, change both (one contract). */
export const ENTRY_RE = /^(### |## )/m;

/** Header floor above which "no entries parsed" is treated as grammar drift, not emptiness. */
const NO_ENTRY_SUSPECT_BYTES = 4096;

// WM_FLUSH_ALERT_FILE override exists for the SUITE ONLY (isolate test alerts from real health
// data — caught when the first live smoke left suite lines in the production jsonl); production
// invocations never set it. Resolved per-call (not at module load) so the suite's env set wins
// over import hoisting.
function alertFile(): string {
    return process.env.WM_FLUSH_ALERT_FILE
        || path.join(os.homedir(), '.han', 'health', 'wm-flush-errors.jsonl');
}
const ALERT_ROTATE_BYTES = 1_000_000; // Tenshi 5a: the silence-breaker must not become its own
                                      // disk slow-burn — rotate at ~1MB (bounded ~2MB worst case).

/** F2 — the silence-breaker. Fields are fixed strings + byte counts ONLY — swap CONTENT is
 *  never echoed into the artefact (Tenshi 5b: a health log a future reader trusts must not be
 *  injectable by a crafted body). */
export function writeAlert(slug: string, kind: string, detail: string, fullBytes: number, compBytes: number): void {
    try {
        const file = alertFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.existsSync(file) && fs.statSync(file).size > ALERT_ROTATE_BYTES) {
                fs.renameSync(file, file + '.1'); // overwrite the previous rotation
            }
        } catch { /* rotation is best-effort; the append below still tries */ }
        const line = JSON.stringify({ ts: new Date().toISOString(), slug, kind, detail, fullBytes, compBytes });
        fs.appendFileSync(file, line + '\n', 'utf-8');
    } catch {
        // The alert writer itself must never throw a turn-end — last resort is stderr.
        console.error(`wm-flush alert (artefact write failed): ${slug} ${kind} ${detail}`);
    }
}

/** Split a swap file into header (before the first family entry marker) and body (the entries).
 *  With the family regex, a legacy `## ` backlog's first entry is matched — so the header is the
 *  true header, never the backlog (Casey's rewrite-not-append finding: the old `### `-only split
 *  classified an entire `## ` backlog as "header" and would have written it back forever). */
export function readSwap(p: string): { header: string; body: string; raw: string } {
    const raw = fs.readFileSync(p, 'utf-8');
    const m = raw.match(ENTRY_RE);
    if (!m || m.index === undefined) return { header: raw, body: '', raw };
    return { header: raw.slice(0, m.index), body: raw.slice(m.index), raw };
}

export interface FlushResult { outcome: 'flushed' | 'noop' | 'alerted' | 'failed'; kind?: string }

/** The whole flush decision + action, dependency-injectable for the suite. */
export async function flushSwaps(
    slug: string,
    fullSwap: string,
    compSwap: string,
    appendFn: typeof appendPairedMemory = appendPairedMemory,
): Promise<FlushResult> {
    // F3 fail-closed polarity: any failure to READ or MEASURE is alert+preserve — never
    // fall through to "unreadable → empty → reset" (that would be the outage in a new coat).
    let full: { header: string; body: string; raw: string };
    let comp: { header: string; body: string; raw: string };
    try {
        full = readSwap(fullSwap);
        comp = readSwap(compSwap);
    } catch (err) {
        writeAlert(slug, 'measurement-failure', String((err as Error)?.message ?? err), -1, -1);
        return { outcome: 'alerted', kind: 'measurement-failure' };
    }

    const fullBytes = Buffer.byteLength(full.body, 'utf-8');
    const compBytes = Buffer.byteLength(comp.body, 'utf-8');

    // Truly nothing to flush — but if the FILE is large while no entry parsed, that is grammar
    // drift (a seat writing a shape the family can't eat) — the MNT-060 outage made LOUD.
    if (!full.body.trim() && !comp.body.trim()) {
        const rawMax = Math.max(Buffer.byteLength(full.raw, 'utf-8'), Buffer.byteLength(comp.raw, 'utf-8'));
        if (rawMax > NO_ENTRY_SUSPECT_BYTES) {
            writeAlert(slug, 'no-entries-but-large', `no family entry parsed but a swap file is ${rawMax}B — grammar drift; drain/convert by hand`, fullBytes, compBytes);
            return { outcome: 'alerted', kind: 'no-entries-but-large' };
        }
        return { outcome: 'noop' };
    }

    // F3 — the backlog guard. ALERT, never dump. NB a seat sitting over the cap alarms EVERY
    // turn until hand-drained — that repetition is DELIBERATE (the alarm IS the surfacing,
    // DEC-103); do not "fix" it into silence. Ceiling = swapFlushMaxBytes manifest leaf
    // (stated-guess ~20K ≈ several turns; raise if legitimate long turns trip it, lower if
    // dumps sneak through).
    let maxBytes: number;
    try {
        maxBytes = swapFlushMaxBytesFor(slug);
    } catch (err) {
        writeAlert(slug, 'measurement-failure', `manifest leaf read failed: ${String((err as Error)?.message ?? err)}`, fullBytes, compBytes);
        return { outcome: 'alerted', kind: 'measurement-failure' };
    }
    if (fullBytes > maxBytes || compBytes > maxBytes) {
        writeAlert(slug, 'backlog-over-cap', `swap body over swapFlushMaxBytes=${maxBytes} — surgical drain required (see MNT-060 §3 template); this alert repeats each turn BY DESIGN until drained`, fullBytes, compBytes);
        return { outcome: 'alerted', kind: 'backlog-over-cap' };
    }

    // The body starts at the entry marker. Prepend a blank line so the first flushed entry
    // doesn't jam against WM's existing tail (matches the paired-append convention). An empty
    // side stays empty — appendPairedMemory throws on asymmetric → swap preserved.
    const fullOut = full.body.trim() ? '\n' + full.body : '';
    const compOut = comp.body.trim() ? '\n' + comp.body : '';

    try {
        await appendFn(slug, fullOut, compOut, { source: 'wm-flush' });
    } catch (err) {
        writeAlert(slug, 'flush-failed', String((err as Error)?.message ?? err), fullBytes, compBytes);
        return { outcome: 'failed', kind: 'flush-failed' };
    }

    // Success → reset BOTH swaps to their full header (collapse trailing newlines to one so the
    // header doesn't creep a blank line per cycle).
    fs.writeFileSync(fullSwap, full.header.replace(/\n+$/, '\n'), 'utf-8');
    fs.writeFileSync(compSwap, comp.header.replace(/\n+$/, '\n'), 'utf-8');
    return { outcome: 'flushed' };
}

// Invocation shell (the hook's entry point). Guarded so the suite can import the functions —
// exact basename (a suffix regex would match test-wm-flush.ts too; caught by the suite's own
// first run).
if (process.argv[1] && path.basename(process.argv[1]) === 'wm-flush.ts') {
    const [slug, fullSwap, compSwap] = process.argv.slice(2);
    if (!slug || !fullSwap || !compSwap) {
        console.error('wm-flush: usage: wm-flush.ts <slug> <fullSwapPath> <compSwapPath>');
        process.exit(1);
    }
    flushSwaps(slug, fullSwap, compSwap)
        .then((r) => process.exit(r.outcome === 'failed' ? 1 : 0))
        .catch((err) => {
            // Belt: flushSwaps handles its own branches; anything reaching here is unexpected.
            writeAlert(slug, 'flush-failed', `unexpected: ${String((err as Error)?.message ?? err)}`, -1, -1);
            console.error('wm-flush failed (swap preserved for retry):', err);
            process.exit(1);
        });
}
