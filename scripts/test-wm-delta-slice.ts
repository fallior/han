/**
 * test-wm-delta-slice.ts — the #91 attach-flush slice logic (wmDeltaCandidate), R1.
 *
 * This is the slice logic's FIRST live exercise (computeMemoryDelta shipped gated off,
 * DELTA_REFRESH_ENABLED=false). Jim's F2a: explicitly test the rotation case + the unit (chars),
 * since deltaSinceCursor now runs it live for every re-sleeve attach. Pure helper, no fs/tmux.
 */
import { wmDeltaCandidate } from '../src/server/lib/tmux-dispatcher';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

const H1 = '# Working Memory — Leo\n\n';
const e1 = '## S1 — first\nbody one\n\n';
const e2 = '## S2 — second\nbody two\n\n';
const e3 = '### Heartbeat #9 — beat\nbody three\n\n'; // an h3 entry (heartbeat) — also a valid boundary

console.log('[1] no change — cursor == curLen → empty, not desync');
{
    const content = H1 + e1;
    const r = wmDeltaCandidate(content, content.length);
    check('curLen === cursor → empty candidate', r.candidate === '' && !r.desync && r.curLen === content.length);
}

console.log('[2] clean append (h2) — cursor at an entry boundary → the new entries');
{
    const before = H1 + e1;
    const content = before + e2;
    const r = wmDeltaCandidate(content, before.length);
    check('candidate is exactly the appended entry', r.candidate === e2, `got: ${JSON.stringify(r.candidate)}`);
    check('not desync', !r.desync);
}

console.log('[3] clean append (h3 heartbeat boundary) — h3 is a valid entry start');
{
    const before = H1 + e1;
    const content = before + e3;
    const r = wmDeltaCandidate(content, before.length);
    check('h3 append accepted (not desync)', !r.desync && r.candidate === e3);
}

console.log('[4] DESYNC — cursor lands mid-entry (a moved WM-BOUNDARY / non-tail edit)');
{
    const content = H1 + e1 + e2;
    // cursor inside e2 (not at a heading) → the slice would start mid-line → desync
    const midCursor = (H1 + e1 + '## S2 — sec').length;
    const r = wmDeltaCandidate(content, midCursor);
    check('mid-entry cursor → desync, empty candidate', r.desync && r.candidate === '', `desync=${r.desync}`);
}

console.log('[5] ROTATION / shrink — the wm-sensor sliced the file (curLen < cursor) → catch-up from first heading');
{
    // pre-warm saw a big file; then a rotation reset it to header + fresh entries
    const preWarmLen = (H1 + e1 + e2 + e2 + e2).length; // a larger past size
    const rotated = H1 + e3; // file is now just header + one fresh entry (much shorter)
    const r = wmDeltaCandidate(rotated, preWarmLen);
    check('shrink detected, not desync', !r.desync);
    check('catch-up = post-header entries (from the first heading)', r.candidate === e3, `got: ${JSON.stringify(r.candidate)}`);
    check('curLen reflects the rotated (smaller) length', r.curLen === rotated.length);
}

console.log('[6] cursor 0 (an OLD registry with no wm_len) — grow-branch slice starts at the h1 header → desync → empty (fail-soft)');
{
    // wm_len is ~never 0 in practice (working-memory.md always has its h1 header + blockquote), so
    // cursor 0 only arises from a pre-this-build registry. The grow-branch slice from 0 starts at
    // the h1 ('# ', not an h2-6 entry) → desync → empty → the greeting composes off the pre-warm
    // self (correct fail-soft; the catch-up-from-first-heading is the SHRINK branch, see [5]).
    const content = H1 + e1 + e2;
    const r = wmDeltaCandidate(content, 0);
    check('cursor 0 on a grown file → desync, empty (fail-soft, not a mid-file inject)', r.desync && r.candidate === '');
}

console.log('[7] CHAR unit (F2b) — multibyte glyphs: char-length cursor slices correctly where bytes would not');
{
    const eU = '## S2 — café → résumé …\nunicode body\n\n'; // em-dash, arrow, accents, ellipsis
    const before = H1 + e1;
    const content = before + eU;
    // cursor as CHARS (content.length semantics) must slice exactly the appended entry
    const r = wmDeltaCandidate(content, before.length);
    check('char-cursor slices the multibyte entry cleanly', r.candidate === eU, `got: ${JSON.stringify(r.candidate)}`);
    // and a BYTE length (Buffer.byteLength) would be LARGER than the char length → proves they differ
    check('byte length != char length for this content (why the cursor must be chars)',
        Buffer.byteLength(content, 'utf8') !== content.length);
}

console.log(`\n${fail === 0 ? 'ALL PASS ✓' : `FAIL — ${fail} failed, ${pass} passed`}`);
process.exit(fail === 0 ? 0 : 1);
