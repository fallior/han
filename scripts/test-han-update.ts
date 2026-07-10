#!/usr/bin/env tsx
/**
 * test-han-update.ts — the standing byte-fidelity suite for signature-covered metadata
 * (Tenshi F3, S219): "the diff you sign is bytes." A genuine signed freshness must verify
 * THROUGH THE CODE'S OWN PATH (--check on a scratch world); flipping a single byte of the
 * signature must flip the verdict. No refactor can re-introduce a trim/normalise on
 * signature-covered content without turning this suite red.
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-han-update.ts
 */
import { execFileSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { hanRepo } from '../src/server/lib/paths';

let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };
const sh = (cmd: string, cwd?: string) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// build the minimal scratch world: bare origin + clone + test key + pinned root + freshness
const S = mkdtempSync(path.join(tmpdir(), 'hu-test-'));
sh(`git init --bare -q ${S}/origin.git`);
sh(`git clone -q ${S}/origin.git ${S}/repo`);
sh(`git -C ${S}/repo -c user.email=t@s -c user.name=s commit -q --allow-empty -m root`);
sh(`git -C ${S}/repo push -q origin HEAD:main`);
execSync(`ln -s ${hanRepo()}/src/server/node_modules ${S}/repo/src 2>/dev/null; mkdir -p ${S}/repo/src; ln -sfn ${hanRepo()}/src/server ${S}/repo/src/server 2>/dev/null || true`);
sh(`mkdir -p ${S}/han/credentials ${S}/han/signals`);
sh(`ssh-keygen -t ed25519 -N '' -C t -f ${S}/key -q`);
writeFileSync(`${S}/han/credentials/release-allowed-signers`, `han-release ${readFileSync(`${S}/key.pub`, 'utf8').split(' ').slice(0, 2).join(' ')}\n`, { mode: 0o600 });
writeFileSync(`${S}/repo/freshness.json`, JSON.stringify({ latest_version: 'v2026.01.01', released_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }) + '\n');
sh(`ssh-keygen -Y sign -f ${S}/key -n file freshness.json 2>/dev/null`, `${S}/repo`);
sh(`git -C ${S}/repo add . && git -C ${S}/repo -c user.email=t@s -c user.name=s commit -q -m f && git -C ${S}/repo push -q origin main`);

const runCheck = (): string => {
    try {
        return execFileSync(path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(hanRepo(), 'scripts', 'han-update.ts'), '--check', '--scratch', S],
            { cwd: path.join(hanRepo(), 'src', 'server'), stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, NODE_PATH: path.join(hanRepo(), 'src', 'server', 'node_modules') } }).toString();
    } catch (e: any) { return String(e.stdout ?? '') + String(e.stderr ?? ''); }
};

// 1) genuine signed freshness verifies THROUGH THE CODE'S OWN PATH
check('byte-fidelity: genuine signed freshness verifies ok through --check', /freshness: ok/.test(runCheck()));

// 2) flip ONE byte of the signature → verdict flips to BAD-SIGNATURE
{
    const sigPath = `${S}/repo/freshness.json.sig`;
    const sig = readFileSync(sigPath, 'utf8');
    const mid = Math.floor(sig.length / 2);
    const flipped = sig.slice(0, mid) + (sig[mid] === 'A' ? 'B' : 'A') + sig.slice(mid + 1);
    writeFileSync(sigPath, flipped);
    sh(`git -C ${S}/repo add . && git -C ${S}/repo -c user.email=t@s -c user.name=s commit -q -m flip && git -C ${S}/repo push -q origin main`);
    check('byte-fidelity: ONE flipped signature byte → BAD-SIGNATURE', /BAD-SIGNATURE/.test(runCheck()));
}
// 3) the --scratch production belt: pointing --scratch at the real HAN home is refused
{
    const fakeReal = mkdtempSync(path.join(tmpdir(), 'hu-belt-'));
    let out = '';
    try {
        out = execFileSync(path.join(hanRepo(), 'src', 'server', 'node_modules', '.bin', 'tsx'),
            [path.join(hanRepo(), 'scripts', 'han-update.ts'), '--check', '--scratch', fakeReal],
            { cwd: path.join(hanRepo(), 'src', 'server'), stdio: ['ignore', 'pipe', 'pipe'],
              env: { ...process.env, HAN_HOME: path.join(fakeReal, 'han'), NODE_PATH: path.join(hanRepo(), 'src', 'server', 'node_modules') } }).toString();
    } catch (e: any) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
    check('--scratch belt: refuses when it resolves to the real HAN home', /refusing \(test affordance/.test(out));
    rmSync(fakeReal, { recursive: true, force: true });
}
rmSync(S, { recursive: true, force: true });
console.log(`\nhan-update byte-fidelity: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
