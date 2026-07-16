#!/usr/bin/env tsx
/**
 * test-state-swap.ts — the standing suite for P3d Unit 2b: the atomic DB+state swap
 * (lib/state-swap.ts) + the boot-half dangling-swap gate (verify-identity-files.ts hunk).
 *
 * Covers the sealed gates (mrh9apbl) + Tenshi A–F (mrmwuxvx) + Jim's polarities (mrmxwrnw):
 *   - move-set wall: an extra file in staging aborts fail-closed (Tenshi A)
 *   - two-sided re-hash: staged OR live tampered after render → refuse (gate 2)
 *   - the commit point: recovery rolls BACK below it, FORWARD past it (Tenshi B)
 *   - boot-gate polarities: absent=genesis-clean · corrupt=halt · dangling=halt (Tenshi C + Jim)
 *   - journal-as-hint: recovery verifies pre-copies against recorded hashes (gate 4)
 *   - staging lifecycle: quarantine-clean discard + stale sweep, never rm content (gate 6/F)
 *   - nested-staging legible refusal (gate 7b) · empty-staging remove-on-refuse (gate 7a)
 *   - rendered-set == swapped-set rides the ceremony E2E (P5, Tenshi's set).
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-state-swap.ts
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, symlinkSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanRepo } from '../src/server/lib/paths';
import {
    hashTree, captureSwapHashes, verifyStagingSet, assertStagingNotNested,
    checkDanglingSwap, executeSwap, recoverDanglingSwap, rollbackSwappedTrees,
    discardStaging, sweepStaleStaging, SwapPlan,
} from '../src/server/lib/state-swap';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };
const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const quiet = () => { /* silent log sink */ };
const throwsWith = (fn: () => void, re: RegExp): boolean => { try { fn(); return false; } catch (e) { return re.test((e as Error).message); } };

// ── scratch world builder (the test-state-copy fixture, reused) ─────────────────────────────
function buildWorld(): { S: string; home: string; migrate: (args: string) => string } {
    const S = mkdtempSync(path.join(tmpdir(), 'stateswap-'));
    mkdirSync(path.join(S, 'repo', 'migrations'), { recursive: true });
    mkdirSync(path.join(S, 'repo', 'src'), { recursive: true });
    mkdirSync(path.join(S, 'han', 'memory', 'testa'), { recursive: true });
    mkdirSync(path.join(S, 'han', 'signals'), { recursive: true });
    symlinkSync(path.join(hanRepo(), 'src', 'server'), path.join(S, 'repo', 'src', 'server'));
    symlinkSync(path.join(hanRepo(), 'src', 'server', 'node_modules'), path.join(S, 'repo', 'node_modules'));
    writeFileSync(path.join(S, 'repo', 'package.json'), '{"type":"commonjs"}\n');
    writeFileSync(path.join(S, 'repo', 'migrations', '001-genesis.ts'), `
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Migration, SCHEMA_META_DDL } from '../src/server/lib/state-schema';
const migration: Migration = {
    id: 1,
    description: 'genesis + a DECLARED authored-state touch (state-swap fixture)',
    touchesState: ['memory/testa'],
    stateChangeKind: 'content-preserving',
    up(ctx) {
        const db = new Database(ctx.dbPath);
        try { db.exec(SCHEMA_META_DDL); db.prepare(\`INSERT OR REPLACE INTO schema_meta (id,schema_version,applied_log) VALUES (1,1,?)\`).run(JSON.stringify([{id:1,ts:'t'}])); } finally { db.close(); }
        if (ctx.stateDir) fs.writeFileSync(path.join(ctx.stateDir, 'memory/testa/identity.md'), '# Test A\\nStaged edit.\\n');
    },
    verify(ctx) { const db=new Database(ctx.dbPath,{readonly:true}); try { return (db.prepare(\`SELECT schema_version FROM schema_meta WHERE id=1\`).get() as any)?.schema_version===1||'bad'; } finally { db.close(); } },
};
export default migration;
`);
    writeFileSync(path.join(S, 'han', 'memory', 'testa', 'identity.md'), '# Test A\n');
    sh(`sqlite3 ${S}/han/gradient.db "CREATE TABLE IF NOT EXISTS gradient_entries (id TEXT);"`);
    const migrate = (args: string): string => {
        const env = `HAN_HOME=${S}/han HAN_DB_PATH=${S}/han/gradient.db HAN_REPO=${S}/repo NODE_PATH=${path.join(hanRepo(), 'src', 'server', 'node_modules')}`;
        try {
            return execFileSync('bash', ['-c', `${env} ${path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx')} ${path.join(hanRepo(), 'scripts', 'han-migrate.ts')} ${args}`],
                { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
        } catch (e: any) { return String(e.stdout ?? '') + String(e.stderr ?? ''); }
    };
    return { S, home: path.join(S, 'han'), migrate };
}

const TS = '2026-01-01T00-00-00-000Z';
const planFor = (home: string, staging: string): SwapPlan => ({
    hanHome: home, stagingDir: staging, dbLive: path.join(home, 'gradient.db'),
    moveSet: ['memory/testa'], ledgerPath: path.join(home, 'health', 'update-ledger.jsonl'),
    schemaTo: 1, ts: TS,
});
const stageIt = (w: ReturnType<typeof buildWorld>): string => {
    const staging = path.join(w.home, 'staging', 'update-current');
    w.migrate(`--stage-only ${staging} --force --skip-smoke`);
    return staging;
};

// 1) boot-gate polarities (Tenshi C + Jim's ruling)
{
    const t = mkdtempSync(path.join(tmpdir(), 'swapledger-'));
    const lp = path.join(t, 'update-ledger.jsonl');
    check('polarity (i): ABSENT ledger = genesis-clean (a fresh garden never halts)', checkDanglingSwap(lp).state === 'genesis-clean');
    writeFileSync(lp, JSON.stringify({ ts: 't', op: 'check' }) + '\n');
    check('no swap ops at all = clean', checkDanglingSwap(lp).state === 'clean');
    appendFileSync(lp, JSON.stringify({ ts: 't', op: 'swap-start', swapId: 's1' }) + '\n');
    check('swap-start without swap-done = DANGLING', checkDanglingSwap(lp).state === 'dangling');
    appendFileSync(lp, JSON.stringify({ ts: 't', op: 'swap-done', swapId: 's1' }) + '\n');
    check('matched swap-done = clean again', checkDanglingSwap(lp).state === 'clean');
    appendFileSync(lp, 'NOT JSON AT ALL\n');
    check('polarity (ii): a malformed line = CORRUPT (fail-closed — it could hide a swap-start)', checkDanglingSwap(lp).state === 'corrupt');
    // Tenshi's post-land hardenings 1+2 (mrn4e2jk): the backward-bounded, id-matched scan.
    const lp2 = path.join(t, 'ledger2.jsonl');
    writeFileSync(lp2, [
        JSON.stringify({ ts: 't1', op: 'swap-start', swapId: 'A' }),
        JSON.stringify({ ts: 't2', op: 'swap-start', swapId: 'B' }),
        JSON.stringify({ ts: 't3', op: 'swap-done', swapId: 'B' }),
    ].join('\n') + '\n');
    check('HARDENING-2: start-A/start-B/done-B → latest start (B) closed → clean (bounded at B)', checkDanglingSwap(lp2).state === 'clean');
    const lp3 = path.join(t, 'ledger3.jsonl');
    writeFileSync(lp3, [
        JSON.stringify({ ts: 't1', op: 'swap-start', swapId: 'A' }),
        JSON.stringify({ ts: 't2', op: 'swap-start', swapId: 'B' }),
        JSON.stringify({ ts: 't3', op: 'swap-done', swapId: 'A' }),
    ].join('\n') + '\n');
    check('HARDENING-2: start-A/start-B/done-A → B still DANGLING (id-matched, never masked by A closing)', checkDanglingSwap(lp3).state === 'dangling');
    const lp4 = path.join(t, 'ledger4.jsonl');
    writeFileSync(lp4, [
        'ANCIENT GARBAGE LINE (beyond the last swap — deliberately unparsed, the bounded-cost trade)',
        JSON.stringify({ ts: 't1', op: 'swap-start', swapId: 'C' }),
        JSON.stringify({ ts: 't2', op: 'swap-done', swapId: 'C' }),
    ].join('\n') + '\n');
    check('HARDENING-1: the scan is BOUNDED — garbage beyond the latest completed swap is never parsed (clean)', checkDanglingSwap(lp4).state === 'clean');
    const lp5 = path.join(t, 'ledger5.jsonl');
    writeFileSync(lp5, [
        JSON.stringify({ ts: 't1', op: 'swap-start', swapId: 'D' }),
        'GARBAGE INSIDE THE AUTHORITATIVE TAIL',
    ].join('\n') + '\n');
    check('HARDENING-1: garbage INSIDE the authoritative tail (EOF→latest start) still = CORRUPT', checkDanglingSwap(lp5).state === 'corrupt');
    rmSync(t, { recursive: true, force: true });
}

// 2) the move-set wall (Tenshi A) + nested-staging refusal (gate 7b)
{
    const w = buildWorld();
    const staging = stageIt(w);
    check('a lawful staging verifies (declared tree + DB + receipt only)', verifyStagingSet(staging, ['memory/testa'], 'gradient.db').ok === true);
    writeFileSync(path.join(staging, 'smuggled.txt'), 'undeclared\n');
    const v = verifyStagingSet(staging, ['memory/testa'], 'gradient.db');
    check('an EXTRA file in staging fails the set (fail-closed, names it)', v.ok === false && !v.ok && v.extras.includes('smuggled.txt'));
    mkdirSync(path.join(staging, 'memory', 'smuggle-tree'), { recursive: true });
    writeFileSync(path.join(staging, 'memory', 'smuggle-tree', 'x.md'), 'x\n');
    const v2 = verifyStagingSet(staging, ['memory/testa'], 'gradient.db');
    check('an undeclared TREE in staging fails the set', v2.ok === false);
    check('nested staging refused legibly (gate 7b)', assertStagingNotNested(path.join(w.home, 'memory', 'testa', 'stage'), ['memory/testa'], w.home) !== null);
    check('outside staging passes the nesting check', assertStagingNotNested(path.join(w.home, 'staging', 'u1'), ['memory/testa'], w.home) === null);
    rmSync(w.S, { recursive: true, force: true });
}

// 3) the swap, happy path — trees then DB, journal bracketed, pre-copies retained
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    executeSwap(plan, atRender, { assertQuiesced: () => null }, quiet);
    check('SWAP: live tree carries the staged edit', readFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), 'utf8').includes('Staged edit'));
    check('SWAP: the live tree pre-copy is retained (DEC-069)', existsSync(path.join(w.home, 'memory', `testa.pre-swap-${TS}`)));
    check('SWAP: the DB pre-copy is retained', existsSync(path.join(w.home, `gradient.db.pre-v1-${TS}`)));
    check('SWAP: the DB is at v1 (commit point crossed)', sh(`sqlite3 ${w.home}/gradient.db "SELECT schema_version FROM schema_meta WHERE id=1"`).trim() === '1');
    check('SWAP: journal bracketed (swap-start + swap-done, clean)', checkDanglingSwap(plan.ledgerPath).state === 'clean');
    // 3b) rollbackSwappedTrees — the post-swap failure path (health-gate/re-sign)
    const notes = rollbackSwappedTrees(w.home, plan.ledgerPath, `swap-${TS}`, quiet);
    check('ROLLBACK-TREES: restores the original live tree from the verified pre-copy', notes.length === 1 && readFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), 'utf8') === '# Test A\n');
    check('ROLLBACK-TREES: the swapped-in tree is quarantined, never deleted', readdirSync(path.join(w.home, 'memory')).some((n) => n.startsWith('testa.rolledback-')));
    rmSync(w.S, { recursive: true, force: true });
}

// 4) the two-sided re-hash (gate 2) + quiesce re-assert (Tenshi D)
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    writeFileSync(path.join(staging, 'memory', 'testa', 'identity.md'), '# TAMPERED after render\n');
    check('STAGED tamper after render → refused (gate 2)', throwsWith(() => executeSwap(plan, atRender, { assertQuiesced: () => null }, quiet), /staged tree .* CHANGED since the ceremony/));
    check('a refused swap never journals (no dangling)', checkDanglingSwap(plan.ledgerPath).state === 'genesis-clean');
    rmSync(w.S, { recursive: true, force: true });
}
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    writeFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), '# LIVE mutated in the window\n');
    check('LIVE tamper after render → refused (a writer loose inside the quiesce)', throwsWith(() => executeSwap(plan, atRender, { assertQuiesced: () => null }, quiet), /LIVE tree .* changed since the ceremony/));
    rmSync(w.S, { recursive: true, force: true });
}
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    check('quiesce re-assert failure → refused BEFORE any rename (Tenshi D)', throwsWith(() => executeSwap(plan, atRender, { assertQuiesced: () => 'wm-sensor is ACTIVE' }, quiet), /quiesce re-assert FAILED/));
    check('live tree untouched by the refusal', readFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), 'utf8') === '# Test A\n');
    rmSync(w.S, { recursive: true, force: true });
}
// 4b) the smuggled-file wall runs INSIDE executeSwap too (Tenshi A at the last door)
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    writeFileSync(path.join(staging, 'smuggled.txt'), 'undeclared\n');
    const atRender = captureSwapHashes(plan); // capture AFTER the smuggle: re-hash passes, the WALL must still catch it
    check('a smuggled file aborts the swap at the move-set wall (fail-closed)', throwsWith(() => executeSwap(plan, atRender, { assertQuiesced: () => null }, quiet), /OUTSIDE the signed move-set/));
    rmSync(w.S, { recursive: true, force: true });
}

// 5) directed recovery — BACKWARD (crash below the commit point; Tenshi B + gate 4)
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    // simulate the crash: journal swap-start + tree renamed, DB untouched (pre-commit-point)
    mkdirSync(path.dirname(plan.ledgerPath), { recursive: true });
    appendFileSync(plan.ledgerPath, JSON.stringify({ ts: 't', op: 'swap-start', swapId: `swap-${TS}`, schemaTo: 1, stagingDir: staging, moveSet: plan.moveSet, liveHashes: atRender.live, stagedHashes: atRender.staged, tsToken: TS }) + '\n');
    sh(`mv ${w.home}/memory/testa ${w.home}/memory/testa.pre-swap-${TS} && mv ${staging}/memory/testa ${w.home}/memory/testa`);
    check('the crash state is DANGLING', checkDanglingSwap(plan.ledgerPath).state === 'dangling');
    const dir = recoverDanglingSwap(w.home, plan.dbLive, plan.ledgerPath, quiet);
    check('recovery below the commit point rolls BACK', dir === 'rolled-back');
    check('the original live tree is restored (verified against the journal hash)', readFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), 'utf8') === '# Test A\n');
    check('the half-swapped tree is quarantined, never deleted (DEC-069)', readdirSync(path.join(w.home, 'memory')).some((n) => n.startsWith('testa.swap-aborted-')));
    check('the journal is closed (swap-recovered)', checkDanglingSwap(plan.ledgerPath).state === 'clean');
    rmSync(w.S, { recursive: true, force: true });
}

// 6) directed recovery — FORWARD (crash past the commit point)
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    mkdirSync(path.dirname(plan.ledgerPath), { recursive: true });
    appendFileSync(plan.ledgerPath, JSON.stringify({ ts: 't', op: 'swap-start', swapId: `swap-${TS}`, schemaTo: 1, stagingDir: staging, moveSet: plan.moveSet, liveHashes: atRender.live, stagedHashes: atRender.staged, tsToken: TS }) + '\n');
    // simulate: everything swapped (trees + DB), crash before swap-done
    sh(`mv ${w.home}/memory/testa ${w.home}/memory/testa.pre-swap-${TS} && mv ${staging}/memory/testa ${w.home}/memory/testa`);
    sh(`mv ${w.home}/gradient.db ${w.home}/gradient.db.pre-v1-${TS} && mv ${staging}/gradient.db ${w.home}/gradient.db`);
    const dir = recoverDanglingSwap(w.home, plan.dbLive, plan.ledgerPath, quiet);
    check('recovery past the commit point rolls FORWARD (swap-done appended)', dir === 'rolled-forward' && checkDanglingSwap(plan.ledgerPath).state === 'clean');
    check('the swapped state stands (live tree keeps the staged edit)', readFileSync(path.join(w.home, 'memory', 'testa', 'identity.md'), 'utf8').includes('Staged edit'));
    rmSync(w.S, { recursive: true, force: true });
}

// 7) gate 4's teeth: a pre-copy that fails hash verification HALTs recovery
{
    const w = buildWorld();
    const staging = stageIt(w);
    const plan = planFor(w.home, staging);
    const atRender = captureSwapHashes(plan);
    mkdirSync(path.dirname(plan.ledgerPath), { recursive: true });
    appendFileSync(plan.ledgerPath, JSON.stringify({ ts: 't', op: 'swap-start', swapId: `swap-${TS}`, schemaTo: 1, stagingDir: staging, moveSet: plan.moveSet, liveHashes: atRender.live, stagedHashes: atRender.staged, tsToken: TS }) + '\n');
    sh(`mv ${w.home}/memory/testa ${w.home}/memory/testa.pre-swap-${TS} && mv ${staging}/memory/testa ${w.home}/memory/testa`);
    writeFileSync(path.join(w.home, 'memory', `testa.pre-swap-${TS}`, 'identity.md'), '# pre-copy TAMPERED\n');
    check('a tampered pre-copy HALTs recovery (the journal locates, never trusts — gate 4)', throwsWith(() => recoverDanglingSwap(w.home, plan.dbLive, plan.ledgerPath, quiet), /does NOT match the journal/));
    rmSync(w.S, { recursive: true, force: true });
}

// 8) staging lifecycle (gate 6/7a + F + the schedule)
{
    const w = buildWorld();
    const staging = stageIt(w);
    discardStaging(staging, w.home, 'ceremony-declined', quiet);
    check('DISCARD: non-empty staging quarantine-archives (never rm)', !existsSync(staging) && readdirSync(path.join(w.home, 'archives', 'staging')).some((n) => n.startsWith('update-current')));
    const empty = path.join(w.home, 'staging', 'update-empty');
    mkdirSync(empty, { recursive: true });
    discardStaging(empty, w.home, 'refused', quiet);
    check('DISCARD: an EMPTY refused staging dir is simply removed (gate 7a)', !existsSync(empty));
    const stale = path.join(w.home, 'staging', 'update-old');
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, 'left-behind.txt'), 'x\n');
    sweepStaleStaging(w.home, path.join(w.home, 'staging', 'update-current2'), quiet);
    check('SWEEP: a stale staging dir archives at the next run (the written schedule)', !existsSync(stale) && readdirSync(path.join(w.home, 'archives', 'staging')).some((n) => n.startsWith('update-old')));
    rmSync(w.S, { recursive: true, force: true });
}

// 9) the boot gate through the REAL script (verify-identity-files.ts, real env)
{
    const w = buildWorld();
    mkdirSync(path.join(w.home, 'health'), { recursive: true });
    // the script's import chain (identity-signing → agent-registry → garden-manifest)
    // fail-loud-loads $HAN_HOME/garden-manifest.json at module eval — seed the scratch home
    // the same way genesis does, so the script can BOOT and the gate itself can be tested.
    writeFileSync(path.join(w.home, 'garden-manifest.json'),
        readFileSync(path.join(hanRepo(), 'seeds', 'garden-manifest.seed.json')));
    const runVerify = (): { code: number; out: string } => {
        try {
            const out = execFileSync('bash', ['-c',
                `HAN_HOME=${w.home} ${path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx')} ${path.join(hanRepo(), 'scripts', 'verify-identity-files.ts')} --agent=testa --entry-point=test-state-swap`],
                { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
            return { code: 0, out };
        } catch (e: any) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
    };
    const r0 = runVerify();
    check('BOOT GATE polarity (i): absent ledger does NOT halt the wake (falls through to identity logic)', r0.code !== 3);
    appendFileSync(path.join(w.home, 'health', 'update-ledger.jsonl'), JSON.stringify({ ts: 't', op: 'swap-start', swapId: 's9' }) + '\n');
    const r1 = runVerify();
    check('BOOT GATE: a dangling swap HALTs the wake (exit 3, names --recover)', r1.code === 3 && /half-swapped/i.test(r1.out) && /--recover/.test(r1.out));
    check('BOOT GATE: the halt-receipt is written', existsSync(path.join(w.home, 'health', 'integrity-failures.jsonl')) && /swap-journal-dangling/.test(readFileSync(path.join(w.home, 'health', 'integrity-failures.jsonl'), 'utf8')));
    appendFileSync(path.join(w.home, 'health', 'update-ledger.jsonl'), 'CORRUPT LINE\n');
    const r2 = runVerify();
    check('BOOT GATE polarity (ii): a corrupt ledger HALTs legibly (exit 3)', r2.code === 3 && /not valid JSON|unreadable/i.test(r2.out));
    rmSync(w.S, { recursive: true, force: true });
}

// 10) Unit 2 — the freshness leaf's accessor (defaults baked; the self-lockout guard)
{
    const t = mkdtempSync(path.join(tmpdir(), 'updatecfg-'));
    const seed = JSON.parse(readFileSync(path.join(hanRepo(), 'seeds', 'garden-manifest.seed.json'), 'utf8'));
    const probe = (update: unknown): { code: number; out: string } => {
        const m = { ...seed, ...(update === undefined ? {} : { update }) };
        writeFileSync(path.join(t, 'garden-manifest.json'), JSON.stringify(m));
        try {
            const out = execFileSync('bash', ['-c',
                `HAN_HOME=${t} ${path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx')} -e "const{updateConfig}=require('${path.join(hanRepo(), 'src', 'server', 'lib', 'garden-manifest')}');console.log(JSON.stringify(updateConfig()))"`,
                ], { stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(hanRepo(), 'src', 'server') }).toString();
            return { code: 0, out };
        } catch (e: any) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
    };
    const r0 = probe(undefined);
    check('LEAF: absent update section → {false, 90} baked (fail-closed on absence, Tenshi F)', r0.code === 0 && r0.out.includes('"enforceFreshnessExpiry":false') && r0.out.includes('"freshnessMaxAgeDays":90'));
    const r1 = probe({ enforceFreshnessExpiry: true, freshnessMaxAgeDays: 30 });
    check('LEAF: armed with a positive max-age → resolves as configured', r1.code === 0 && r1.out.includes('"enforceFreshnessExpiry":true') && r1.out.includes('"freshnessMaxAgeDays":30'));
    const r2 = probe({ enforceFreshnessExpiry: true, freshnessMaxAgeDays: 0 });
    check('LEAF: armed with maxAge ≤ 0 → REFUSED loudly (the self-lockout guard)', r2.code !== 0 && /self-lockout/.test(r2.out));
    const r3 = probe({ enforceFreshnessExpiry: 'yes' });
    check('LEAF: a mistyped field fails the loader loudly (never silently coerced)', r3.code !== 0 && /must be a boolean/.test(r3.out));
    rmSync(t, { recursive: true, force: true });
}

console.log(`\nstate-swap (Unit 2b): ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
