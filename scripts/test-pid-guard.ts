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
 *   T9 birthdate mismatch     → rejected, never obeyed, never killed (Casey's doctrine)
 *   T10 legacy bare pidfile   → attribute-only path (rolling upgrade pinned)
 *   T11 true triple           → ours with basis 'full'
 *   T11b match is NOT an acceptor (Jim M1): true birthdate + wrong token → refused
 *   T12 guard writes the triple; cleanup still removes own file (first-token compare)
 *   T13 prior-boot claim      → demoted to attribute-only ('prior-boot'), never refused
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
        fs.readFileSync(pf6, 'utf-8').trim().split(/\s+/)[0] === String(process.pid));
    guard6.cleanup();

    // T7 — end-to-end: replace() must NOT kill an innocent recycled-pid process.
    const pf7 = path.join(HEALTH, 'svc-seven.pid');
    fs.writeFileSync(pf7, String(innocent.pid));
    const guard7 = replaceExistingInstance('svc-seven', { cmdlineToken: 'human-responder.ts' }, 2000);
    await new Promise((r) => setTimeout(r, 300));
    const innocentAlive = fs.existsSync(`/proc/${innocent.pid}`);
    check('T7 replace() spares the innocent (recycled pid NOT killed) and takes the lock',
        innocentAlive && fs.readFileSync(pf7, 'utf-8').trim().split(/\s+/)[0] === String(process.pid));
    guard7.cleanup();

    // ── The starttime discriminator (plan v2) ──────────────────────────────
    const { liveStarttime } = await import('../src/server/lib/pid-guard');
    const bootid = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim();
    const subj = spawn('sleep', ['30']);
    await new Promise((r) => setTimeout(r, 200));
    const subjStart = liveStarttime(subj.pid!)!;
    check('T9 pre: live starttime readable', typeof subjStart === 'string' && /^\d+$/.test(subjStart));

    // T9 — same-boot claim with the WRONG birth tick → rejected, never obeyed/killed.
    const v9 = classifyPidClaim(subj.pid!, 'svc', { cmdlineToken: 'sleep' },
        { starttime: String(Number(subjStart) + 1), bootid });
    check('T9 birthdate mismatch → birthdate-mismatch (rejector fires before attributes)',
        v9.kind === 'birthdate-mismatch' && v9.basis === 'full', JSON.stringify(v9));
    const pf9 = path.join(HEALTH, 'svc-nine.pid');
    fs.writeFileSync(pf9, `${subj.pid} ${Number(subjStart) + 1} ${bootid}`);
    const guard9 = replaceExistingInstance('svc-nine', { cmdlineToken: 'sleep' }, 2000);
    await new Promise((r) => setTimeout(r, 200));
    check('T9b replace() on a birthdate-mismatch: innocent alive, lock taken',
        fs.existsSync(`/proc/${subj.pid}`) && fs.readFileSync(pf9, 'utf-8').trim().split(/\s+/)[0] === String(process.pid));
    guard9.cleanup();

    // T10 — legacy bare pidfile → attribute-only path (kind from attributes, basis labelled).
    const v10 = classifyPidClaim(subj.pid!, 'svc', { cmdlineToken: 'sleep' });
    check('T10 legacy bare claim → ours on attributes with basis attribute-only/legacy-format',
        v10.kind === 'ours' && v10.basis === 'attribute-only' && v10.basisReason === 'legacy-format', JSON.stringify(v10));

    // T11 — the true triple → ours with basis FULL (the happy path still closes).
    const v11 = classifyPidClaim(subj.pid!, 'svc', { cmdlineToken: 'sleep' }, { starttime: subjStart, bootid });
    check('T11 true triple → ours (basis full)', v11.kind === 'ours' && v11.basis === 'full', JSON.stringify(v11));

    // T11b — Jim's M1 pin: a MATCHING birthdate must never accept on its own.
    const v11b = classifyPidClaim(subj.pid!, 'svc', { cmdlineToken: 'human-responder.ts' }, { starttime: subjStart, bootid });
    check('T11b match is not an acceptor: true birthdate + wrong token → different-program, never ours',
        v11b.kind === 'different-program' && v11b.basis === 'full', JSON.stringify(v11b));

    // T12 — the guard's own pidfile is the triple; cleanup removes it (first-token compare).
    const guard12 = ensureSingleInstance('svc-twelve', { cmdlineToken: 'no-token' });
    const written = fs.readFileSync(path.join(HEALTH, 'svc-twelve.pid'), 'utf-8').trim().split(/\s+/);
    check('T12 guard writes the triple (pid + starttime + bootid)',
        written.length === 3 && written[0] === String(process.pid) && /^\d+$/.test(written[1]) && written[2] === bootid);
    guard12.cleanup();
    check('T12b cleanup removes own triple pidfile', !fs.existsSync(path.join(HEALTH, 'svc-twelve.pid')));

    // T13 — prior-boot claim: demoted, never refused (a finding about the instrument).
    const v13 = classifyPidClaim(subj.pid!, 'svc', { cmdlineToken: 'sleep' },
        { starttime: subjStart, bootid: 'a-foreign-boot-id' });
    check('T13 prior-boot claim → attribute path (ours, basis attribute-only/prior-boot)',
        v13.kind === 'ours' && v13.basis === 'attribute-only' && v13.basisReason === 'prior-boot', JSON.stringify(v13));
    subj.kill();

    innocent.kill(); marked.kill();
    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
