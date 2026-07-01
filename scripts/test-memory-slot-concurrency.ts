/*
 * PR-R3a.0 gate — memory-slot concurrency proof (Jim's S171 sharpened bar).
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-memory-slot-concurrency.ts
 *
 * NOT "inert today GREEN" — "forced-concurrent-writer-PROVEN GREEN". The real race is CROSS-PROCESS
 * (the acquire critical region is synchronous, so two async tasks in one process can't interleave
 * it — but two PROCESSES can). So this forks real worker processes that hammer withMemorySlot with
 * the SAME writer name (`leo-paired-write` — the exact same-agent case PR-R3a.1 introduces).
 *
 * Detector: each critical section is a READ-MODIFY-WRITE with a widened window. Under a correct
 * exclusive lock the appends serialise → all N lines present. Under a double-holder, the RMW loses
 * updates → fewer than N lines. So "exactly N unique lines" PROVES exactly-one-holder / no-double /
 * no-lost. Two cases: (1) plain concurrency; (2) a pre-seeded STALE lock forcing two concurrent
 * stealers (the subtle half Jim flagged).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { withMemorySlot } from '../src/server/lib/memory-slot';

const SELF = process.argv[1];
const DIR = process.env.SLOT_TEST_DIR;
const SHARED = process.env.SLOT_TEST_SHARED;

// ── WORKER MODE ───────────────────────────────────────────────────────────────
if (process.env.SLOT_WORKER && DIR && SHARED) {
    (async () => {
        const id = process.env.SLOT_WORKER!;
        const K = Number(process.env.SLOT_K || '10');
        for (let i = 0; i < K; i++) {
            const ok = await withMemorySlot(DIR, 'leo-paired-write', () => {
                // read-modify-write with a widened critical section (lost-update detector)
                const cur = fs.readFileSync(SHARED, 'utf-8');
                const until = Date.now() + 4; while (Date.now() < until) { /* hold the slot ~4ms */ }
                fs.writeFileSync(SHARED, cur + `${id}-${i}\n`);
                return true;
            });
            if (!ok) { console.error(`worker ${id} FAILED to acquire at ${i}`); process.exit(2); }
        }
        process.exit(0);
    })();
} else {
    // ── PARENT MODE ───────────────────────────────────────────────────────────
    let pass = 0, fail = 0;
    const check = (name: string, cond: boolean) => {
        if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); }
    };

    const runWorkers = (workers: number, K: number, seedStaleLock: boolean): Promise<{ lines: string[]; leftoverSteal: boolean; dir: string }> => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-conc-'));
        const shared = path.join(dir, 'shared.txt');
        fs.writeFileSync(shared, '');
        if (seedStaleLock) {
            // a lock 40s old (> STALE_LOCK_MS) from a "dead" holder — forces the steal path
            fs.writeFileSync(path.join(dir, 'memory-write.lock'),
                JSON.stringify({ writer: 'dead-holder', acquired: new Date(Date.now() - 40_000).toISOString(), token: 'dead' }));
        }
        const env = { ...process.env, SLOT_TEST_DIR: dir, SLOT_TEST_SHARED: shared, SLOT_K: String(K) };
        const procs = Array.from({ length: workers }, (_, w) =>
            spawn('npx', ['tsx', SELF], { env: { ...env, SLOT_WORKER: `w${w}` }, stdio: 'ignore' }));
        return new Promise(resolve => {
            let done = 0;
            procs.forEach(p => p.on('exit', () => {
                if (++done === workers) {
                    const lines = fs.readFileSync(shared, 'utf-8').split('\n').filter(Boolean);
                    const leftoverSteal = fs.existsSync(path.join(dir, 'memory-write.lock.steal'));
                    resolve({ lines, leftoverSteal, dir });
                }
            }));
        });
    };

    (async () => {
        console.log('PR-R3a.0 memory-slot concurrency proof (cross-process, same-agent writer)\n');

        // ── Case 1: forced concurrency — 6 workers × 10 RMW appends = 60 expected ──
        {
            const W = 6, K = 10;
            const { lines, leftoverSteal, dir } = await runWorkers(W, K, false);
            const uniq = new Set(lines);
            check(`Case 1: no lost/double append — exactly ${W * K} lines (got ${lines.length})`, lines.length === W * K);
            check(`Case 1: every line unique (no double-holder duplication) — ${uniq.size}/${W * K}`, uniq.size === W * K);
            const allPresent = Array.from({ length: W }, (_, w) => Array.from({ length: K }, (_, i) => `w${w}-${i}`))
                .flat().every(l => uniq.has(l));
            check('Case 1: every expected append present (no lost writes)', allPresent);
            check('Case 1: no leftover .steal lock', !leftoverSteal);
            fs.rmSync(dir, { recursive: true, force: true });
        }

        // ── Case 2: stale-lock + two concurrent stealers ──
        {
            const W = 2, K = 5;
            const { lines, leftoverSteal, dir } = await runWorkers(W, K, true);
            const uniq = new Set(lines);
            check(`Case 2 (two-stealers): both steal the stale lock + all ${W * K} appends land (got ${lines.length})`, lines.length === W * K);
            check('Case 2: every append unique (steal never produced two holders)', uniq.size === W * K);
            check('Case 2: dead-holder line never appears (stale lock never counted as a holder)', !uniq.has('dead-holder'));
            check('Case 2: no leftover .steal lock', !leftoverSteal);
            const finalLockGone = !fs.existsSync(path.join(dir, 'memory-write.lock'));
            check('Case 2: main lock released at end (no orphan)', finalLockGone);
            fs.rmSync(dir, { recursive: true, force: true });
        }

        console.log(`\nmemory-slot-concurrency: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    })();
}
