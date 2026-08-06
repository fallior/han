/**
 * MNT-089 pid-guard hardening suite. Scratch substrate via HAN_HOME (set BEFORE the
 * dynamic import so the module's healthDir resolves into scratch — a prod write is
 * unrepresentable). The verdicts are tested against the REAL /proc, including a live
 * reproduction of the immortal-lock class using this very process's libuv thread ids.
 *
 *   T1 dead pid            → absent (the ordinary stale pidfile)
 *   T2 THREAD id           → not-a-process (the MNT-089 class: kill(tid,0) passes, we must not)
 *   T3 recycled pid        → different-program (live process, wrong cmdline)
 *   T4 genuine same-service→ ours (a real duplicate must still be caught)
 *   T5 env discriminator   → env-mismatch (same binary, different slug)
 *   T6 ensure() disregards a thread-id claim and starts (the crash-loop cure, end-to-end)
 *   T7 replace() does NOT kill a recycled-pid innocent (the worse hazard, end-to-end)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'pid-guard-test-'));
process.env.HAN_HOME = SCRATCH;

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

async function main(): Promise<void> {
    const { classifyPidClaim, ensureSingleInstance, replaceExistingInstance } =
        await import('../src/server/lib/pid-guard');
    const HEALTH = path.join(SCRATCH, 'health');
    fs.mkdirSync(HEALTH, { recursive: true });

    // T1 — dead pid: find one that does not exist.
    let deadPid = 999999;
    while (fs.existsSync(`/proc/${deadPid}`)) deadPid--;
    check('T1 dead pid → absent', classifyPidClaim(deadPid, 'svc').kind === 'absent');

    // T2 — a THREAD id of this very process (node always has libuv workers).
    const tids = fs.readdirSync(`/proc/${process.pid}/task`).map(Number).filter((t) => t !== process.pid);
    check('T2 pre: this process has worker threads', tids.length > 0, `tids=${tids.length}`);
    const tid = tids[0];
    const killAccepts = (() => { try { process.kill(tid, 0); return true; } catch { return false; } })();
    const v2 = classifyPidClaim(tid, 'svc', { cmdlineToken: 'tsx' });
    check('T2 thread id: kill(tid,0) passes but verdict is not-a-process (the immortal lock, killed)',
        killAccepts && v2.kind === 'not-a-process', JSON.stringify(v2));

    // T3 — a live unrelated process: spawn sleep; token that its cmdline lacks.
    const innocent = spawn('sleep', ['30']);
    await new Promise((r) => setTimeout(r, 200));
    const v3 = classifyPidClaim(innocent.pid!, 'svc', { cmdlineToken: 'human-responder.ts' });
    check('T3 recycled pid (live, wrong program) → different-program', v3.kind === 'different-program', JSON.stringify(v3));

    // T4 — a genuine same-service process: token present in its cmdline.
    const v4 = classifyPidClaim(innocent.pid!, 'svc', { cmdlineToken: 'sleep' });
    check('T4 live matching process → ours (real duplicates still caught)', v4.kind === 'ours');

    // T5 — env discriminator: spawn with a marker env; demand a different value.
    const marked = spawn('sleep', ['30'], { env: { ...process.env, AGENT_SLUG: 'jim' } });
    await new Promise((r) => setTimeout(r, 200));
    const v5a = classifyPidClaim(marked.pid!, 'svc', { cmdlineToken: 'sleep', envMatch: { AGENT_SLUG: 'leo' } });
    const v5b = classifyPidClaim(marked.pid!, 'svc', { cmdlineToken: 'sleep', envMatch: { AGENT_SLUG: 'jim' } });
    check('T5 env discriminator: wrong slug → env-mismatch; right slug → ours',
        v5a.kind === 'env-mismatch' && v5b.kind === 'ours', `${v5a.kind}/${v5b.kind}`);

    // T6 — end-to-end: ensure() must DISREGARD a thread-id claim and start (the crash-loop cure).
    const pf6 = path.join(HEALTH, 'svc-six.pid');
    fs.writeFileSync(pf6, String(tid));
    const guard6 = ensureSingleInstance('svc-six', { cmdlineToken: 'no-such-token-anywhere' });
    check('T6 ensure() disregards the immortal thread-id lock and starts',
        fs.readFileSync(pf6, 'utf-8').trim() === String(process.pid));
    guard6.cleanup();

    // T7 — end-to-end: replace() must NOT kill an innocent recycled-pid process.
    const pf7 = path.join(HEALTH, 'svc-seven.pid');
    fs.writeFileSync(pf7, String(innocent.pid));
    const guard7 = replaceExistingInstance('svc-seven', { cmdlineToken: 'human-responder.ts' }, 2000);
    await new Promise((r) => setTimeout(r, 300));
    const innocentAlive = fs.existsSync(`/proc/${innocent.pid}`);
    check('T7 replace() spares the innocent (recycled pid NOT killed) and takes the lock',
        innocentAlive && fs.readFileSync(pf7, 'utf-8').trim() === String(process.pid));
    guard7.cleanup();

    innocent.kill(); marked.kill();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
