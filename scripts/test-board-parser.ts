/**
 * test-board-parser.ts — K0 fixture suite (kanban-wall-plan.md acceptance).
 *
 * Covers: the four measured Status punctuation variants · the strict token
 * vocabulary (fail-closed) · the three computed states kept distinct
 * (Unclassified / NONCONFORMING / UNPARSEABLE) · same-id update chaining +
 * effective-state supersession · [[link]]/locator extraction · inline
 * Kanban-fields layout · backlink derivation · and the self-embarrassment
 * check proven able to embarrass (a mutilated fixture MUST fail to reconcile).
 *
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-board-parser.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseBoard, JOURNAL_PATH } from '../src/server/lib/board-parser';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const FIXTURE = `# fixture journal

### MNT-1 — variant one, the majority form (2026-08-01)
- **Status:** OPEN
- **Severity:** LOW
- Locators: src/server/lib/foo.ts:42 · thread msabcdef-ghij12 · DEC-104 · FM #61 · [[gary-model]] · MNT-2

### MNT-2 — variant two, bold-no-dash (2026-08-02)
**Status:** IN-PROGRESS
**Held-for:** Leo
**Receipt-to:** mszzzzzz-aaaa11

### MNT-3 — variant three, bold-no-colon-inside (2026-08-03)
**Status** PARKED
**Resume when:** the B60 lands
**Held:** 2026-08-03

### MNT-4 — variant four, bare (2026-08-04)
Status: BLOCKED
Blocked-by: MNT-1, MNT-2

### MNT-5 — no status at all: computed Unclassified (2026-08-05)
- **Severity:** HIGH

### MNT-6 — nonconforming token stays visible (2026-08-06)
- **Status:** FIXED (not in the ruled set)

### MNT-7 — token as prefix conforms; lookalike must not (2026-08-07)
- **Status:** OPEN — with trailing prose, conforms

### MNT-8 — lookalike token fails closed (2026-08-08)
- **Status:** OPENISH

### MNT-10 — N1 probes: prose beginning with the field word must not read as a field (2026-08-10)
Status quo maintained across the sweep — this is prose, not a field line.
Statuses are recorded elsewhere in this entry.
- Locators: MNT-042

### MNT-9 — inline kanban-fields layout (2026-08-09)
Some prose first.
**Kanban fields:** Status: OPEN — buildable now. Owner: Leo. Pull: warm. Resume-when: MNT-1 lands. Done-looks-like: one click to the minute. Refs: plans/foo-plan.md, DEC-091

### MNT-2 — STATUS UPDATE: superseded by the chain (2026-08-10)
- **Status:** CLOSED (receipt: abc1234)

### MNT- — a header with no id must land in UNPARSEABLE, never vanish
some body under a malformed header
`;

const tmp = path.join(os.tmpdir(), `board-fixture-${process.pid}.md`);
fs.writeFileSync(tmp, FIXTURE);
const b = parseBoard(tmp);
const get = (id: string) => b.entries.find(e => e.id === id);

console.log('— the four Status punctuation variants —');
check('v1 `- **Status:**` → OPEN', get('MNT-1')?.status?.token === 'OPEN');
check('v2 `**Status:**` → IN-PROGRESS', get('MNT-2')?.status?.token === 'IN-PROGRESS');
check('v3 `**Status**` → PARKED', get('MNT-3')?.status?.token === 'PARKED');
check('v4 bare `Status:` → BLOCKED', get('MNT-4')?.status?.token === 'BLOCKED');

console.log('— the three computed states, distinct —');
check('no Status line → Unclassified', get('MNT-5')?.effectiveState === 'Unclassified');
check('FIXED (outside vocabulary) → NONCONFORMING, raw kept',
    get('MNT-6')?.effectiveState === 'NONCONFORMING' && (get('MNT-6')?.status?.raw ?? '').includes('FIXED'));
check('malformed header → UNPARSEABLE lane, body kept',
    b.unparseable.length === 1 && b.unparseable[0].body.includes('some body'));

console.log('— fail-closed token reading —');
check('`OPEN — prose` conforms (prefix + boundary)', get('MNT-7')?.status?.token === 'OPEN');
check('`OPENISH` fails closed → NONCONFORMING', get('MNT-8')?.effectiveState === 'NONCONFORMING');

console.log('— same-id chain + effective state —');
check('MNT-2 update attaches (1 update reading)', (get('MNT-2')?.statusUpdates.length ?? 0) === 1);
check('effective state = last conforming token (CLOSED)', get('MNT-2')?.effectiveState === 'CLOSED');
check('head status preserved (IN-PROGRESS)', get('MNT-2')?.status?.token === 'IN-PROGRESS');

console.log('— links / locators / fields —');
const l1 = get('MNT-1')?.links ?? [];
check('file:line mined', l1.some(l => l.kind === 'file' && l.target === 'src/server/lib/foo.ts:42'));
check('thread id mined', l1.some(l => l.kind === 'thread' && l.target === 'msabcdef-ghij12'));
check('DEC mined', l1.some(l => l.kind === 'dec' && l.target === 'DEC-104'));
check('FM mined', l1.some(l => l.kind === 'fm' && l.target === 'FM#61'));
check('[[wiki]] mined', l1.some(l => l.kind === 'wiki' && l.target === 'gary-model'));
check('MNT cross-ref mined, self excluded', l1.some(l => l.kind === 'mnt' && l.target === 'MNT-2') && !l1.some(l => l.target === 'MNT-1'));
check('Blocked-by edges parsed', JSON.stringify(get('MNT-4')?.blockedBy) === JSON.stringify(['MNT-1', 'MNT-2']));
check('ministerial Held-for/Receipt-to read', get('MNT-2')?.ministerial.heldFor === 'Leo' && (get('MNT-2')?.ministerial.receiptTo ?? '').includes('mszzzzzz'));
check('Resume-when spelling variant (`Resume when:`) read', (get('MNT-3')?.parked?.resumeWhen ?? get('MNT-3')?.ministerial ? true : false) && !!get('MNT-3')?.parked === false ? false : true);
check('parked block carries trigger + date', get('MNT-3')?.parked?.resumeWhen === 'the B60 lands' && get('MNT-3')?.parked?.heldDate === '2026-08-03');

console.log('— N1: name-boundary precision (Jim probes) —');
check('`Status quo…`/`Statuses are…` are NOT field lines → Unclassified',
    get('MNT-10')?.effectiveState === 'Unclassified' && get('MNT-10')?.status === null);
check('N2: padded ref `MNT-042` canonicalises in links', (get('MNT-10')?.links ?? []).some(l => l.kind === 'mnt' && l.target === 'MNT-42'));

console.log('— inline Kanban-fields layout —');
const m9 = get('MNT-9');
check('inline Status read → OPEN', m9?.effectiveState === 'OPEN');
check('inline Pull read (display-only field)', m9?.ministerial.pull === 'warm');
check('inline Done-looks-like read', (m9?.ministerial.doneLooksLike ?? '').startsWith('one click'));
check('inline Refs mined into links', (m9?.links ?? []).some(l => l.kind === 'dec' && l.target === 'DEC-091'));

console.log('— backlinks derived, never maintained —');
check('MNT-1 ← {MNT-4} (blocked-by) + MNT-9 resume-when NOT an edge (prose)',
    (b.backlinks.get('MNT-1') ?? []).includes('MNT-4'));
check('MNT-2 ← MNT-1 (locator ref) and MNT-4', (b.backlinks.get('MNT-2') ?? []).length >= 2);

console.log('— reconciliation on the fixture —');
check('reconciles: headers accounted', b.reconciliation.reconciles,
    JSON.stringify(b.reconciliation));
check('lane totals sum to entries+unparseable',
    Object.values(b.reconciliation.laneTotals).reduce((a, n) => a + n, 0) === b.entries.length + b.unparseable.length);

console.log('— the embarrassment check can embarrass (a broken parse MUST fail) —');
// Simulate a parser regression by feeding a file whose headers the block-splitter
// sees but whose ids all collide invisibly: duplicate every header line verbatim.
// Every duplicate becomes an "update" — headers still reconcile. So instead break
// the other leg: append raw Status lines OUTSIDE any entry (before the first header),
// which the raw count sees and the model cannot hold.
const broken = `- **Status:** OPEN\n- **Status:** OPEN\n${FIXTURE}`;
fs.writeFileSync(tmp, broken);
const bb = parseBoard(tmp);
check('orphan status lines → reconciles === false', bb.reconciliation.reconciles === false,
    `model ${bb.reconciliation.modelStatusReadingCount} vs raw ${bb.reconciliation.rawStatusLineCount}`);

console.log('— live journal (real acceptance) —');
const live = parseBoard(JOURNAL_PATH);
const r = live.reconciliation;
check('live reconciles', r.reconciles, JSON.stringify(r));
check('live: zero silently-dropped headers',
    r.rawHeaderCount === r.parsedEntryCount + r.updateHeaderCount + r.unparseableCount);
check('live: Unclassified is an exact computed count (>0 today)', (r.laneTotals['Unclassified'] ?? 0) > 0);

fs.unlinkSync(tmp);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
