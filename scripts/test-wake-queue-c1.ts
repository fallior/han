/**
 * test-wake-queue-c1.ts — PR-C1: the durable wake queue (lib/wake-queue.ts).
 *
 * Covers: enqueue→claim arrival order · claim consumes (files unlinked) · temp+rename leaves no
 * partial artefacts · malformed file dropped without wedging · missing dir ⇒ [] · pickNextEligible
 * per-conversation defer semantics (in-flight conv skipped, order preserved, no-conv always eligible).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeWakeQueueFile, claimWakeFiles, pickNextEligible, wakeQueueDir } from '../src/server/lib/wake-queue';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-queue-c1-'));
const SIG = 'leo-human-wake';

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown): void {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
}

console.log('PR-C1 wake-queue:');

// 1) Missing dir ⇒ empty claim.
check('missing dir ⇒ []', claimWakeFiles(TMP, SIG), []);

// 2) Enqueue 3 (distinct ms via explicit spacing), claim in arrival order.
writeWakeQueueFile(TMP, SIG, { dispatchId: 'a1', conversationId: 'conv-A' });
// deterministic ordering: filenames start with Date.now() — force distinct ms
const spin = Date.now(); while (Date.now() === spin) { /* spin to next ms */ }
writeWakeQueueFile(TMP, SIG, { dispatchId: 'b2', conversationId: 'conv-B' });
const spin2 = Date.now(); while (Date.now() === spin2) { /* spin */ }
writeWakeQueueFile(TMP, SIG, { dispatchId: 'c3', conversationId: 'conv-A' });
const claimed = claimWakeFiles<{ dispatchId: string }>(TMP, SIG);
check('claims 3 in arrival order', claimed.map(c => c.dispatchId), ['a1', 'b2', 'c3']);

// 3) Claim consumed the files (dir empty) + no temp artefacts left.
const leftovers = fs.readdirSync(wakeQueueDir(TMP, SIG));
check('claim consumes files (dir empty, no tmp)', leftovers, []);

// 4) Malformed file dropped, valid one still claimed.
fs.writeFileSync(path.join(wakeQueueDir(TMP, SIG), '0000000000000-bad.json'), '{ not json');
writeWakeQueueFile(TMP, SIG, { dispatchId: 'ok1' });
const claimed2 = claimWakeFiles<{ dispatchId: string }>(TMP, SIG);
check('malformed dropped, valid claimed', claimed2.map(c => c.dispatchId), ['ok1']);
check('malformed file removed (no wedge)', fs.readdirSync(wakeQueueDir(TMP, SIG)), []);

// 5) pickNextEligible — per-conversation defer.
const q = [
    { conversationId: 'A' },   // 0 — in flight → skip
    { conversationId: 'A' },   // 1 — same conv, stays behind sibling → skip
    { conversationId: 'B' },   // 2 — eligible
];
check('skips in-flight conv, picks next thread', pickNextEligible(q, new Set(['A'])), 2);
check('nothing in flight ⇒ head', pickNextEligible(q, new Set()), 0);
check('all in flight ⇒ -1', pickNextEligible(q, new Set(['A', 'B'])), -1);
check('no-conv wake always eligible', pickNextEligible([{ conversationId: 'A' }, {}], new Set(['A'])), 1);
check('empty queue ⇒ -1', pickNextEligible([], new Set()), -1);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
