/**
 * test-stem-freshness-reader.ts — R3a.1c: the rotation-events freshness reader.
 *
 * `latestRotationSuccessTs(slug)` reads the SHARED `~/.han/health/wm-rotation-events.jsonl`,
 * filters to `kind==='rotation-success'` for the given agent, and returns the LATEST timestamp
 * (or null when there is none). Jim's sharpening 3: an absent/empty log — or no rotation for THIS
 * agent — reads as FRESH (null), never stale, so a sparse log can't wrongly retire a warm stem.
 *
 * Points HAN_HEALTH_DIR at a temp dir BEFORE importing the dispatcher (the log path is resolved at
 * module-load), writes crafted events, and asserts the filter/latest/absent behaviour.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-freshness-'));
process.env.HAN_HEALTH_DIR = TMP; // must be set BEFORE the dispatcher module resolves the log path
const LOG = path.join(TMP, 'wm-rotation-events.jsonl');

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown): void {
    if (got === want) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
}
function writeLog(lines: object[]): void {
    fs.writeFileSync(LOG, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

async function main(): Promise<void> {
const { latestRotationSuccessTs } = await import('../src/server/lib/tmux-dispatcher.ts');

console.log('R3a.1c freshness-reader (latestRotationSuccessTs):');

// 1) Absent log ⇒ null (FRESH). (No file written yet.)
check('absent log ⇒ null (fresh)', latestRotationSuccessTs('leo'), null);

// 2) Empty log ⇒ null.
fs.writeFileSync(LOG, '');
check('empty log ⇒ null', latestRotationSuccessTs('leo'), null);

// 3) Only OTHER agents' rotations ⇒ null for this agent (agent filter).
writeLog([
    { timestamp: '2026-07-01T01:00:00.000Z', kind: 'rotation-success', agent: 'jim' },
    { timestamp: '2026-07-01T02:00:00.000Z', kind: 'rotation-success', agent: 'tenshi' },
]);
check('other agents only ⇒ null (agent filter)', latestRotationSuccessTs('leo'), null);

// 4) Picks the LATEST rotation-success for the agent (order-independent), ignoring other kinds +
//    other agents interleaved.
writeLog([
    { timestamp: '2026-07-01T03:00:00.000Z', kind: 'rotation-success', agent: 'leo', c0_id: 'a' },
    { timestamp: '2026-07-01T03:30:00.000Z', kind: 'pre-slice-drift', agent: 'leo' },      // not rotation-success
    { timestamp: '2026-07-01T05:00:00.000Z', kind: 'rotation-success', agent: 'jim' },      // other agent
    { timestamp: '2026-07-01T04:00:00.000Z', kind: 'rotation-success', agent: 'leo', c0_id: 'b' }, // LATEST leo
    { timestamp: '2026-07-01T03:45:00.000Z', kind: 'rotation-success', agent: 'leo', c0_id: 'c' },
]);
check('picks latest rotation-success for agent', latestRotationSuccessTs('leo'), '2026-07-01T04:00:00.000Z');

// 5) Malformed lines are skipped, not fatal.
fs.writeFileSync(LOG,
    'not json at all\n' +
    JSON.stringify({ timestamp: '2026-07-01T06:00:00.000Z', kind: 'rotation-success', agent: 'leo' }) + '\n' +
    '{ broken json\n');
check('malformed lines skipped', latestRotationSuccessTs('leo'), '2026-07-01T06:00:00.000Z');

// 6) A rotation-success missing a timestamp is ignored (typeof guard).
writeLog([{ kind: 'rotation-success', agent: 'leo' }]);
check('rotation-success without timestamp ⇒ null', latestRotationSuccessTs('leo'), null);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
