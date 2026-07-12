#!/usr/bin/env tsx
/**
 * test-quarantine.ts — the standing suite for the rollback-QUARANTINE set (P3d, Tenshi
 * finding-1). A rollback records the abandoned (known-bad) tag; `--check` annotates it; a
 * forward apply of a quarantined tag is refused without `--force-quarantined <tag>`. The set
 * is a ledger PROJECTION (append-only quarantine/unquarantine ops), so it inherits the
 * ledger's off-box tamper-evidence witness. This suite proves the projection + the --check
 * annotation on scratch ledgers (no signing infra needed); the full rollback→refuse→force
 * apply E2E rides the P3d scratch-garden acceptance.
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-quarantine.ts
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanRepo } from '../src/server/lib/paths';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };

function scratchCheck(ledgerLines: string[]): string {
    const S = mkdtempSync(path.join(tmpdir(), 'quar-'));
    mkdirSync(path.join(S, 'han', 'health'), { recursive: true });
    mkdirSync(path.join(S, 'han', 'credentials'), { recursive: true });
    mkdirSync(path.join(S, 'repo'), { recursive: true });
    execFileSync('git', ['-C', path.join(S, 'repo'), 'init', '-q', '.']);
    execFileSync('git', ['-C', path.join(S, 'repo'), '-c', 'user.email=t@s', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'root']);
    if (ledgerLines.length) writeFileSync(path.join(S, 'han', 'health', 'update-ledger.jsonl'), ledgerLines.join('\n') + '\n');
    let out = '';
    try {
        out = execFileSync(path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(hanRepo(), 'scripts', 'han-update.ts'), '--check', '--scratch', S],
            { cwd: path.join(hanRepo(), 'src', 'server'), stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, HAN_HOME: path.join(S, 'han'), NODE_PATH: path.join(hanRepo(), 'src', 'server', 'node_modules') } }).toString();
    } catch (e: any) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    rmSync(S, { recursive: true, force: true });
    return out;
}

// 1) a quarantine op → --check reports the tag as quarantined
{
    const out = scratchCheck([
        '{"ts":"2026-07-10T00:00:00Z","op":"apply-done","target":"v2026.01.02","freshness_latest":"v2026.01.02"}',
        '{"ts":"2026-07-11T00:00:00Z","op":"quarantine","tag":"v2026.01.02","reason":"rolled back to v2026.01.01"}',
    ]);
    check('a quarantine op → --check names the quarantined tag', /quarantined tag\(s\): v2026\.01\.02/.test(out));
}

// 2) an unquarantine op after it → the tag clears (last op wins, the projection is order-honest)
{
    const out = scratchCheck([
        '{"ts":"2026-07-10T00:00:00Z","op":"apply-done","target":"v2026.01.02","freshness_latest":"v2026.01.02"}',
        '{"ts":"2026-07-11T00:00:00Z","op":"quarantine","tag":"v2026.01.02","reason":"rolled back"}',
        '{"ts":"2026-07-12T00:00:00Z","op":"unquarantine","tag":"v2026.01.02","reason":"operator override"}',
    ]);
    check('a later unquarantine op → the tag is NO LONGER reported (projection clears)', !/quarantined tag/.test(out));
}

// 3) re-quarantine after an unquarantine → quarantined again (append-only, last state wins)
{
    const out = scratchCheck([
        '{"ts":"2026-07-11T00:00:00Z","op":"quarantine","tag":"v2026.01.02","reason":"a"}',
        '{"ts":"2026-07-12T00:00:00Z","op":"unquarantine","tag":"v2026.01.02","reason":"b"}',
        '{"ts":"2026-07-13T00:00:00Z","op":"quarantine","tag":"v2026.01.02","reason":"c"}',
    ]);
    check('re-quarantine after unquarantine → quarantined again (last op wins)', /quarantined tag\(s\): v2026\.01\.02/.test(out));
}

// 4) an empty / no ledger → no quarantine noise, no crash
{
    const out = scratchCheck([]);
    check('no ledger → no quarantine line, clean --check', !/quarantined/.test(out) && /han-update/.test(out));
}

// 5) a malformed ledger line is skipped, valid ops still project
{
    const out = scratchCheck([
        'not json at all',
        '{"ts":"2026-07-11T00:00:00Z","op":"quarantine","tag":"v2026.01.02"}',
    ]);
    check('malformed ledger line skipped; valid quarantine still projects', /quarantined tag\(s\): v2026\.01\.02/.test(out));
}

console.log(`\nquarantine: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
