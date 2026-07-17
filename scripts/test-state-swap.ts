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
    discardStaging, sweepStaleStaging, declaredTreeFileDeltas, SwapPlan,
} from '../src/server/lib/state-swap';
import {
    snapshotAuthoredAt, compareAuthored, ring2Verdict, renderCeremonyDocument,
    nonIdentityTreeDeltas,
} from '../src/server/lib/ring2-ceremony';
import * as crypto from 'crypto';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };
const sh = (cmd: string) => execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const quiet = () => { /* silent log sink */ };
const throwsWith = (fn: () => void, re: RegExp): boolean => { try { fn(); return false; } catch (e) { return re.test((e as Error).message); } };

// ── scratch world builder (the test-state-copy fixture, reused) ─────────────────────────────
// `stateWrites` = the migration's ctx.stateDir body (default: the classic identity.md edit);
// the P5 seam cases inject non-identity writes instead (identity files left byte-identical).
function buildWorld(stateWrites?: string): { S: string; home: string; migrate: (args: string) => string } {
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
        if (ctx.stateDir) { ${stateWrites ?? `fs.writeFileSync(path.join(ctx.stateDir, 'memory/testa/identity.md'), '# Test A\\nStaged edit.\\n');`} }
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

// 11) P5 — the enumeration-seam fix: rendered-set == swapped-set (Tenshi mrnd1cqj/mrndfo4b, Jim mrndq9k5)
// The verdict-time model the fix computes in 6a-staged: identity deltas (compareAuthored over
// IDENTITY_FILES) ∪ non-identity deltas (declaredTreeFileDeltas, excluding rendered rels) →
// ring2Verdict. These cases drive that exact pipeline over scratch worlds.
{
    const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
    // residents shape for snapshotAuthoredAt: testa lives at memory/testa (the fixture layout).
    const residentsFor = (home: string) => [{ slug: 'testa', memoryDir: path.join(home, 'memory', 'testa'), fractalDir: path.join(home, 'memory', 'fractal', 'testa'), identitySection: null }];
    const IDENT = 'memory/testa/identity.md';
    // the merged verdict exactly as 6a-staged computes it (identity ∪ non-identity)
    const mergedVerdict = (w: ReturnType<typeof buildWorld>, staging: string) => {
        const residents = residentsFor(w.home);
        const pre = snapshotAuthoredAt(residents);
        // post-staged view: identity artefacts re-read through staging (as han-update does)
        const post = snapshotAuthoredAt(residents);
        for (const a of post.artefacts) {
            if (!a.absPath) continue;
            const rel = path.relative(w.home, a.absPath);
            let content: string | null = null;
            try { content = readFileSync(path.join(staging, rel), 'utf8'); } catch { /* absent */ }
            a.content = content; a.sha256 = content === null ? null : sha(content);
        }
        const identityDeltas = compareAuthored(pre, post);
        const renderedRels = new Set<string>();
        for (const a of [...pre.artefacts, ...post.artefacts]) if (a.absPath) renderedRels.add(path.relative(w.home, a.absPath));
        const nonIdentity = nonIdentityTreeDeltas('memory/testa', declaredTreeFileDeltas(staging, w.home, 'memory/testa', renderedRels));
        const merged = [...identityDeltas, ...nonIdentity];
        const decl = [{ migrationId: 1, description: 'fixture', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving' as const }];
        return { verdict: ring2Verdict(merged, decl), merged, nonIdentity };
    };

    // (a) THE INVERTED PROBE — the seam is closed: a content-preserving migration that poisons
    // working-memory-full.md (identity files byte-identical) now ESCALATES + renders + red-flags.
    {
        const w = buildWorld("fs.writeFileSync(path.join(ctx.stateDir, 'memory/testa/working-memory-full.md'), '# WM\\nPOISON injected under a content-preserving claim.\\n');");
        writeFileSync(path.join(w.home, 'memory', 'testa', 'working-memory-full.md'), '# WM\n');
        const staging = stageIt(w);
        const { verdict, nonIdentity } = mergedVerdict(w, staging);
        check('P5 (the seam, CLOSED): non-identity poison → verdict CEREMONY (not the auto-pass)', verdict.kind === 'ceremony');
        check('P5: the poisoned working-memory-full.md IS in the rendered set', nonIdentity.some((d) => d.name === 'memory/testa/working-memory-full.md'));
        check('P5 (Jim fold-3): the content-preserving-but-changed case wears the RED FLAG', verdict.kind === 'ceremony' && verdict.redFlag === true);
        const doc = renderCeremonyDocument((verdict as any).deltas, [{ migrationId: 1, description: 'fixture', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving' }], (verdict as any).redFlag);
        check('P5: the ceremony document renders the WM file for the gardener', /working-memory-full\.md/.test(doc.rendered));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (b) genuine content-preserving (NOTHING changed in staging) → still the auto-pass
    {
        const w = buildWorld("/* no-op: a truly content-preserving migration touches no bytes */");
        writeFileSync(path.join(w.home, 'memory', 'testa', 'working-memory-full.md'), '# WM\n');
        const staging = stageIt(w);
        const { verdict } = mergedVerdict(w, staging);
        check('P5: whole declared tree byte-identical → still UNCHANGED (auto-pass preserved)', verdict.kind === 'unchanged');
        rmSync(w.S, { recursive: true, force: true });
    }
    // (c) identity-only change → still ceremony (unchanged behaviour)
    {
        const w = buildWorld(); // default: edits identity.md in staging
        const staging = stageIt(w);
        const { verdict, nonIdentity } = mergedVerdict(w, staging);
        check('P5: identity-only change → CEREMONY (unchanged), no phantom non-identity delta', verdict.kind === 'ceremony' && nonIdentity.length === 0);
        rmSync(w.S, { recursive: true, force: true });
    }
    // (d) an APPEARED non-identity file → rendered
    {
        const w = buildWorld("fs.writeFileSync(path.join(ctx.stateDir, 'memory/testa/quiet-hours.md'), 'new file appeared\\n');");
        const staging = stageIt(w);
        const { verdict, nonIdentity } = mergedVerdict(w, staging);
        check('P5: an APPEARED non-identity file → rendered + CEREMONY', verdict.kind === 'ceremony' && nonIdentity.some((d) => d.name === 'memory/testa/quiet-hours.md' && d.pre === null));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (e) a NESTED-subdir file → rendered (proves the walk recurses where enumeration never did)
    {
        const w = buildWorld("const d=path.join(ctx.stateDir,'memory/testa/sub'); fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(path.join(d,'deep.md'),'nested change\\n');");
        const staging = stageIt(w);
        const { verdict, nonIdentity } = mergedVerdict(w, staging);
        check('P5: a NESTED-subdir file → rendered (the fixed enumeration never recursed; the walk does)', verdict.kind === 'ceremony' && nonIdentity.some((d) => d.name === path.join('memory/testa', 'sub', 'deep.md')));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (f) Jim fold-1: a fractal identity.md (never enumerated) must NOT be excluded by basename
    {
        const w = buildWorld("const d=path.join(ctx.stateDir,'memory/testa/fractal'); fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(path.join(d,'identity.md'),'a fractal file wearing the identity name\\n');");
        const staging = stageIt(w);
        const renderedRels = new Set<string>();
        const residents = residentsFor(w.home);
        for (const a of snapshotAuthoredAt(residents).artefacts) if (a.absPath) renderedRels.add(path.relative(w.home, a.absPath));
        const deltas = declaredTreeFileDeltas(staging, w.home, 'memory/testa', renderedRels);
        check('P5 (fold-1): a fractal/identity.md (never enumerated) is NOT excluded by basename — the seam does not re-open one dir deeper', deltas.some((d) => d.rel === path.join('memory/testa', 'fractal', 'identity.md')));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (g) Jim fold-2: a retargeted symlink renders as the target-string change, never followed.
    // The migration RETARGETS the staged copy (stageIt copies live→staging first, so the link
    // already exists there — unlink then re-point, to a different target).
    {
        const w = buildWorld("const lp=path.join(ctx.stateDir,'memory/testa/link'); fs.unlinkSync(lp); fs.symlinkSync('/etc/hostname', lp);");
        require('fs').symlinkSync('/etc/hosts', path.join(w.home, 'memory', 'testa', 'link')); // live target
        const staging = stageIt(w);
        const renderedRels = new Set<string>();
        for (const a of snapshotAuthoredAt(residentsFor(w.home)).artefacts) if (a.absPath) renderedRels.add(path.relative(w.home, a.absPath));
        const deltas = declaredTreeFileDeltas(staging, w.home, 'memory/testa', renderedRels);
        const link = deltas.find((d) => d.rel === path.join('memory/testa', 'link'));
        check('P5 (fold-2): a symlink delta renders the TARGET string, never followed content', !!link && (link!.staged ?? '').startsWith('symlink → ') && (link!.live ?? '').startsWith('symlink → '));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (h) THE P5 INVARIANT, asserted directly: rendered/approved set == the swap move-set
    // (minus DB+sidecars, governed by the schema/verify/DB-rehash legs). Any file the swap
    // would move under a declared tree is either an identity delta or a non-identity delta.
    {
        const w = buildWorld("fs.writeFileSync(path.join(ctx.stateDir,'memory/testa/working-memory.md'),'c1 changed\\n'); fs.writeFileSync(path.join(ctx.stateDir,'memory/testa/session-swap.md'),'swap changed\\n');");
        writeFileSync(path.join(w.home, 'memory', 'testa', 'working-memory.md'), '# c1\n');
        writeFileSync(path.join(w.home, 'memory', 'testa', 'session-swap.md'), '# swap\n');
        const staging = stageIt(w);
        // the swap's move-set: every file differing staged↔live under the declared tree
        const swapMoved = new Set<string>();
        const walk = (rel: string) => { for (const n of readdirSync(path.join(staging, rel))) { const r = path.join(rel, n); const p = path.join(staging, r); if (require('fs').lstatSync(p).isDirectory()) walk(r); else if (n !== path.basename(w.home + '/gradient.db')) swapMoved.add(r); } };
        walk('memory/testa');
        const { merged } = mergedVerdict(w, staging);
        const renderedNames = new Set(merged.map((d) => d.name));
        // every CHANGED file the swap moves is in the rendered set (identity or non-identity)
        const changed = [...swapMoved].filter((rel) => { try { return readFileSync(path.join(staging, rel), 'utf8') !== readFileSync(path.join(w.home, rel), 'utf8'); } catch { return true; } });
        check('P5 (the invariant): every CHANGED file in the swap move-set is in the rendered/approved set', changed.every((rel) => renderedNames.has(rel)));
        rmSync(w.S, { recursive: true, force: true });
    }
    // (i) ADDITION-1 (Casey/Jim mrnfodkb/mrnfr2zs): the evasion-inheritance PINNED. Closing the
    // seam makes a poisoned non-identity file APPEAR in the delta — but appearing isn't VISIBLE.
    // This drives a NUL-poisoned working-memory-full.md through the FULL merged render path and
    // asserts the renderer's raw-byte scan + non-text banner fire on the NON-IDENTITY delta, so
    // the landed hardening's inheritance can't be silently severed by a future "summarise large
    // WM before render" pass (all other suites would stay green). The one-layer-down sibling of
    // Jim fold-3. NUL written via the   escape (never a literal byte — MNT-026 house rule).
    {
        const w = buildWorld("fs.writeFileSync(path.join(ctx.stateDir,'memory/testa/working-memory-full.md'),'# WM\\nclean\\u0000NUL-poisoned line\\n');");
        writeFileSync(path.join(w.home, 'memory', 'testa', 'working-memory-full.md'), '# WM\nclean line\n');
        const staging = stageIt(w);
        const { verdict, nonIdentity } = mergedVerdict(w, staging);
        check('P5 addition-1: a NUL-poisoned NON-identity file escalates to CEREMONY', verdict.kind === 'ceremony' && nonIdentity.some((d) => d.name === 'memory/testa/working-memory-full.md'));
        const doc = renderCeremonyDocument((verdict as any).deltas, [{ migrationId: 1, description: 'fixture', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving' }], (verdict as any).redFlag);
        check('P5 addition-1: the NUL earns a NAMED finding through the merged render (hardening inherited)', /CONTROL|non-text|NON-TEXT/i.test(doc.rendered));
        check('P5 addition-1: the 🔴 non-text banner fires on the non-identity delta (no blind 0/0)', /🔴 NON-TEXT \/ CONTROL/.test(doc.rendered));
        rmSync(w.S, { recursive: true, force: true });
    }
}

console.log(`\nstate-swap (Unit 2b): ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
