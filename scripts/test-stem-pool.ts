/*
 * PR-R3a.1a — stem-pool registry unit test. Pure, no DB (isolated via HAN_POOL_DIR).
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-stem-pool.ts
 *
 * Locks: checkout leases a distinct free stem (no double-lease under concurrent calls), empty-pool
 * checkout returns null (the floor trigger), return/upsert/remove/setStemCursor mutate correctly,
 * and the freshness logic (isStemStale) — including sharpening-3 (no rotation ⇒ fresh) + the D3
 * cursor>len belt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    readPool, checkoutStem, returnStem, upsertStem, removeStem, setStemCursor, poolStatus, isStemStale,
} from '../src/server/lib/stem-pool';

// poolDir() reads HAN_POOL_DIR lazily (per-call), so setting it before the first op isolates us.
process.env.HAN_POOL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-pool-'));

// PR-C2: pools are per (slug, SURFACE) — pool-<slug>-<surface>.json.
const SURFACE = 'human-response';

async function main() {
let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); }
};

const stem = (n: number, over: Partial<any> = {}) => ({
    stem_id: `session-leo-${n}`, tmux_session: `session-leo-${n}`, state: 'free' as const,
    c0: `c0-${n}`, wm_cursor: 1000, cursor_set_ts: '2026-07-01T10:00:00Z',
    model: 'claude-opus-4-8', /* observation-pin: synthetic OBSERVED fixture (DEC-104) */ warm_at: '2026-07-01T10:00:00Z', ...over,
});

const NOW = '2026-07-01T11:00:00Z';

// ── empty pool ──
check('empty pool reads as {stems:[]}', readPool('leo', SURFACE).stems.length === 0);
check('empty pool status = 0/0/0', JSON.stringify(poolStatus('leo', SURFACE)) === JSON.stringify({ free: 0, leased: 0, total: 0 }));
check('checkout on empty pool → null (floor trigger)', checkoutStem('leo', SURFACE, NOW) === null);

// ── populate N ──
const N = 3;
for (let i = 0; i < N; i++) upsertStem('leo', SURFACE, stem(i));
check(`upsert ${N} stems → ${N} free`, poolStatus('leo', SURFACE).free === N);
check('upsert is idempotent by stem_id (re-upsert stem 0)', (() => { upsertStem('leo', SURFACE, stem(0)); return poolStatus('leo', SURFACE).total === N; })());

// ── checkout N distinct, (N+1)th null ──
const leased = new Set<string>();
for (let i = 0; i < N; i++) { const s = checkoutStem('leo', SURFACE, NOW); if (s) leased.add(s.stem_id); }
check(`checkout ${N}× → ${N} DISTINCT leases (no double-lease)`, leased.size === N);
check('all leased → 0 free', poolStatus('leo', SURFACE).free === 0 && poolStatus('leo', SURFACE).leased === N);
check('checkout when none free → null', checkoutStem('leo', SURFACE, NOW) === null);
check('leased stem carries leased_at', readPool('leo', SURFACE).stems.every(s => s.state === 'leased' && !!s.leased_at));

// ── return + re-checkout ──
returnStem('leo', SURFACE, 'session-leo-1');
check('return → 1 free, leased_at cleared', poolStatus('leo', SURFACE).free === 1 && !readPool('leo', SURFACE).stems.find(s => s.stem_id === 'session-leo-1')!.leased_at);
check('re-checkout returns the freed stem', checkoutStem('leo', SURFACE, NOW)?.stem_id === 'session-leo-1');

// ── remove ──
removeStem('leo', SURFACE, 'session-leo-0');
check('remove → total N-1', poolStatus('leo', SURFACE).total === N - 1);
check('remove unknown id → no-op', (() => { removeStem('leo', SURFACE, 'nope'); return poolStatus('leo', SURFACE).total === N - 1; })());

// ── setStemCursor (freshen) ──
returnStem('leo', SURFACE, 'session-leo-2');
setStemCursor('leo', SURFACE, 'session-leo-2', 5000, '2026-07-01T12:00:00Z');
const s2 = readPool('leo', SURFACE).stems.find(s => s.stem_id === 'session-leo-2')!;
check('setStemCursor updates wm_cursor + cursor_set_ts', s2.wm_cursor === 5000 && s2.cursor_set_ts === '2026-07-01T12:00:00Z');

// ── concurrent checkout (single-process sync-atomic: no double-lease) ──
{
    process.env.HAN_POOL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-pool-conc-'));
    const M = 8;
    for (let i = 0; i < M; i++) upsertStem('leo', SURFACE, stem(i));
    const results = await Promise.all(Array.from({ length: M + 4 }, () => Promise.resolve().then(() => checkoutStem('leo', SURFACE, NOW))));
    const ok = results.filter(Boolean) as any[];
    const ids = new Set(ok.map(s => s.stem_id));
    check(`concurrent checkout: exactly ${M} leased, all distinct (no double-lease)`, ok.length === M && ids.size === M);
    check('concurrent checkout: the extra 4 got null', results.filter(r => r === null).length === 4);
}

// ── freshness logic ──
const fresh = stem(0, { wm_cursor: 1000, cursor_set_ts: '2026-07-01T10:00:00Z' });
check('isStemStale: no rotation (null) → FRESH (sharpening 3)', isStemStale(fresh, null, 2000) === false);
check('isStemStale: rotation AFTER cursor_set → stale', isStemStale(fresh, '2026-07-01T10:30:00Z', 2000) === true);
check('isStemStale: rotation BEFORE cursor_set → fresh', isStemStale(fresh, '2026-07-01T09:00:00Z', 2000) === false);
check('isStemStale: cursor > current WM len → stale (D3 belt, non-rotation truncation)', isStemStale(fresh, null, 500) === true);


// ── PR-C2: per-SURFACE isolation — pools are pool-<slug>-<surface>.json, never shared ──
upsertStem('leo', 'session', stem(91));
check('surface isolation: session stem invisible to human-response pool',
    readPool('leo', SURFACE).stems.every(x => x.stem_id !== 'session-leo-91'));
check('surface isolation: session pool has its own stem', readPool('leo', 'session').stems.some(x => x.stem_id === 'session-leo-91'));
check('surface isolation: checkout scoped to surface', (() => { const c = checkoutStem('leo', 'session', NOW); return c !== null && c.stem_id === 'session-leo-91'; })());

console.log(`\nstem-pool: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
}

main();
