/**
 * test-pool-manager-c3.ts — PR-C3: the pool-manager's pure logic.
 * Covers stemNeedsReload (the 24h substrate-reload age check) — the tmux/kill/replenish halves are
 * process+pane-bound; their acceptance is the live-prove + Jim's by-hand checks.
 */
import { stemNeedsReload } from '../src/server/lib/tmux-dispatcher';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
const stem = (warmAt: string) => ({ stem_id: 's', tmux_session: 's', state: 'free' as const, c0: 'c', wm_cursor: 0, cursor_set_ts: warmAt, model: null as unknown as string, warm_at: warmAt });
const H24 = 24 * 3600_000;
const NOW = Date.parse('2026-07-03T12:00:00Z');

console.log('PR-C3 pool-manager (pure):');
check('fresh stem (1h old) → no reload', !stemNeedsReload(stem('2026-07-03T11:00:00Z'), H24, NOW));
check('25h-old stem → reload', stemNeedsReload(stem('2026-07-02T11:00:00Z'), H24, NOW));
check('exactly 24h → reload (>=)', stemNeedsReload(stem('2026-07-02T12:00:00Z'), H24, NOW));
check('malformed warm_at → never reload (fail-safe)', !stemNeedsReload(stem('not-a-date'), H24, NOW));

console.log(`\npool-manager: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
