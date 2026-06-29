/**
 * #50 / MNT-012 — per-turn swap → working-memory flush (the harness-enforced endpoint of
 * DEC-085's FLUSH-FIRST). Invoked by the `wm-flush.sh` Stop hook (which has already gated on a
 * non-empty paired swap). Reads the seat's swap pair, appends the bodies to the working-memory
 * pair ATOMICALLY via appendPairedMemory (#49, both-or-neither / refuses-asymmetric), and resets
 * the swaps to header-only — so the canonical shared WM is durably current every turn.
 *
 * Usage: wm-flush.ts <slug> <fullSwapPath> <compSwapPath>
 *   (the hook passes the already-resolved swap paths, so there's no env re-resolution drift
 *    between the hook's has-body gate and this writer.)
 *
 * Fail-safe: appendPairedMemory throws on asymmetric / lock-timeout WITHOUT clearing the swap,
 * and we reset the swaps ONLY after a successful append → on any failure the swap is preserved
 * and the next Stop (or the /pfc Step-0 sweep) retries. A turn is never lost.
 */
import * as fs from 'fs';
import { appendPairedMemory } from '../src/server/lib/memory-paired-writer';

const [slug, fullSwap, compSwap] = process.argv.slice(2);
if (!slug || !fullSwap || !compSwap) {
    console.error('wm-flush: usage: wm-flush.ts <slug> <fullSwapPath> <compSwapPath>');
    process.exit(1);
}

// Split a swap file into its header (everything before the first `### ` entry marker) and the
// body (the entries). Keying on the `### ` ENTRY marker — not the `# ` header line — is robust to
// every header shape we actually write: 1-line (`# Session Swap …`), 3-line (`# …` / blank /
// `> Flushes…` blurb), or no `#` line at all. (Jim's MNT-012 diff-audit catch: keying on `# ` leaked
// a 3-line header's `>` blurb into WM, degraded the header on reset, and defeated the spoke no-op
// gate.) The reset writes the FULL captured header back, so the blurb is preserved in the swap and
// never reaches WM. No `### ` → header-only swap → nothing to flush.
function readSwap(p: string): { header: string; body: string } {
    const raw = fs.readFileSync(p, 'utf-8');
    const m = raw.match(/^### /m);
    if (!m || m.index === undefined) return { header: raw, body: '' };
    return { header: raw.slice(0, m.index), body: raw.slice(m.index) };
}

async function main(): Promise<void> {
    const full = readSwap(fullSwap);
    const comp = readSwap(compSwap);
    // Defensive (the hook already gated on non-empty): nothing to flush → no-op.
    if (!full.body.trim() && !comp.body.trim()) return;

    // The body now starts at `### ` (no leading blank — the `### `-keying dropped the separator the
    // old `# `-split happened to include). Prepend a blank line so the first flushed entry doesn't
    // jam against WM's existing tail — matches the /pfc append convention (its FULL/COMPRESSED both
    // open with `\n`). Empty side stays empty (appendPairedMemory throws on asymmetric → swap kept).
    const fullOut = full.body.trim() ? '\n' + full.body : '';
    const compOut = comp.body.trim() ? '\n' + comp.body : '';

    // Atomic paired append: full → working-memory-full.md, compressed → working-memory.md.
    // Throws on asymmetric (one side empty) WITHOUT touching the files → swap preserved for retry.
    await appendPairedMemory(slug, fullOut, compOut, { source: 'wm-flush' });

    // Success → reset BOTH swaps to their full header (the rolling reset; DEC-089 whole-both shape).
    // Collapse trailing newlines to one so the header doesn't creep a blank line per cycle (Jim's
    // MNT-012 re-audit cosmetic nit — buffer-only, never reached WM, but keeps the header stable).
    fs.writeFileSync(fullSwap, full.header.replace(/\n+$/, '\n'), 'utf-8');
    fs.writeFileSync(compSwap, comp.header.replace(/\n+$/, '\n'), 'utf-8');
}

main().catch((err) => {
    console.error('wm-flush failed (swap preserved for retry):', err);
    process.exit(1);
});
