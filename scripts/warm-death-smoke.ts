#!/usr/bin/env npx tsx
/**
 * warm-death-smoke.ts — evidence harness for the model-failover WARM-DEATH handoff
 * (DEC-093 humans-PR / failover-ladder enable-gate; Jim's AMBER on `8b015ea`, mqc85vwb).
 *
 * Jim runs the evidence; this is the rig. His AMBER had two halves:
 *   (a) does `capturePaneTail` reliably MATCH a real dead-model pane at the next-ensure
 *       moment (the stale-scrollback false-match/false-miss risk)?  → `--detect`
 *   (b) does the descent fire end-to-end — `awaitChromeOrDescend` probe → `/model` descend
 *       to a working rung?                                          → `--descend`
 *   (full) the true `ensureSurfaceSession` warm-death (needs-reconcile + model-error pane
 *       → kill + drop-adoption → cold-relaunch → descent → adopt)   → `--full` (documented)
 *
 * The model-error is MESSAGE-triggered (S173 lesson): a bogus `--model` shows healthy idle
 * chrome and only errors after a prompt. So every mode sends a cheap "Hi" probe to surface it.
 *
 *   --detect   (cheap, ~40s): bogus model → Hi → assert MODEL_UNAVAILABLE_RE matches; then a
 *              WORKING model → Hi → assert it does NOT match (the control). Closes (a).
 *   --descend  (medium, ~90s): bogus model session → awaitChromeOrDescend(ladder=[bogus,working])
 *              → assert it returns (descended in-session via /model) + /status shows the working
 *              rung. Closes (b) — the descent engine against a real bogus→working transition.
 *   --full     (heavy, ~7-10min, BILLED): documented below — the end-to-end ensureSurfaceSession
 *              warm-death. Needs a real surface launch; Jim runs it with his chosen rig.
 *
 * Fixtures launch BARE claude (no claude-logged, no sink) so they never pollute the canonical
 * log or a real diary sink; every fixture session is killed on exit (verify-not-me first — it's
 * a fresh tmux session this script created, never an adopted spoke).
 *
 * Usage:  npx tsx scripts/warm-death-smoke.ts --detect | --descend
 *   (run from src/server with NODE_PATH set, like the other dispatcher smokes)
 */

import { execFileSync } from 'child_process';
import { awaitChromeOrDescend, capturePaneTail, MODEL_UNAVAILABLE_RE } from '../src/server/lib/tmux-dispatcher';

const BOGUS = 'claude-bogus-not-real-xyz';
const WORKING = 'claude-opus-4-8';
const READY_CHROME_RE = /❯|shortcuts|bypass permissions/i;

function tmux(args: string[]): string {
    try { return execFileSync('tmux', args, { encoding: 'utf-8' }); } catch { return ''; }
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Launch a BARE claude fixture on `model` in a fresh tmux session; return the session name. */
function launchFixture(model: string, tag: string): string {
    const session = `wd-smoke-${tag}-${process.pid}`;
    try { tmux(['kill-session', '-t', session]); } catch { /* none */ }
    // Matches launch-tmux-surface.sh's bare-claude line (CLAUDECODE unset, skip-permissions).
    tmux(['new-session', '-d', '-s', session, `unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; claude --model ${model} --dangerously-skip-permissions`]);
    return session;
}
function killFixture(session: string): void {
    // verify-not-me: this is a session WE created this run (wd-smoke-*-<pid>), never an adopted spoke.
    if (!session.startsWith('wd-smoke-')) throw new Error(`refusing to kill non-fixture session ${session}`);
    try { tmux(['kill-session', '-t', session]); } catch { /* already gone */ }
}
async function waitChrome(session: string, timeoutMs = 60_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (READY_CHROME_RE.test(capturePaneTail(session))) return true;
        await sleep(2_000);
    }
    return false;
}
function sendHi(session: string): void {
    tmux(['send-keys', '-t', session, '-l', 'Hi']);
    tmux(['send-keys', '-t', session, 'Enter']);
}

let failures = 0;
function assert(cond: boolean, label: string): void {
    console.log(`  ${cond ? '✓' : '✗ FAIL'} ${label}`);
    if (!cond) failures++;
}

async function detect(): Promise<void> {
    console.log('[warm-death-smoke] --detect : does capturePaneTail reliably match a real dead-model pane? (Jim a)');

    // dead model — must MATCH after the probe
    const dead = launchFixture(BOGUS, 'dead');
    try {
        assert(await waitChrome(dead), `bogus-model fixture reached idle chrome (the message-triggered trap: idle looks healthy)`);
        sendHi(dead);
        let matched = false;
        const dl = Date.now() + 20_000;
        while (Date.now() < dl) {
            const tail = capturePaneTail(dead, 30);
            const after = tail.includes('Hi') ? tail.slice(tail.lastIndexOf('Hi')) : tail;
            if (MODEL_UNAVAILABLE_RE.test(after)) { matched = true; break; }
            await sleep(1_500);
        }
        assert(matched, `MODEL_UNAVAILABLE_RE matched the dead-model pane within 20s of the probe`);
    } finally { killFixture(dead); }

    // working model — must NOT match (the control: a live model replies, no error chrome)
    const live = launchFixture(WORKING, 'live');
    try {
        assert(await waitChrome(live), `working-model fixture reached idle chrome`);
        sendHi(live);
        await sleep(12_000);
        const tail = capturePaneTail(live, 30);
        const after = tail.includes('Hi') ? tail.slice(tail.lastIndexOf('Hi')) : tail;
        assert(!MODEL_UNAVAILABLE_RE.test(after), `MODEL_UNAVAILABLE_RE did NOT match the working-model pane (no false-positive)`);
    } finally { killFixture(live); }
}

async function descend(): Promise<void> {
    console.log('[warm-death-smoke] --descend : does awaitChromeOrDescend descend bogus→working in-session? (Jim b)');
    const s = launchFixture(BOGUS, 'descend');
    try {
        let threw: Error | null = null;
        try {
            await awaitChromeOrDescend('smoke', 'warm-death', s, [BOGUS, WORKING]);
        } catch (e) { threw = e as Error; }
        assert(threw === null, `awaitChromeOrDescend returned (probe → /model ${WORKING} descend → re-probe succeeded), did not throw${threw ? ` — ${threw.message}` : ''}`);
        // Confirm the live model via /status — scoped AFTER a fresh unique marker so the
        // prior rung's error still in scrollback can't false-match (same root cause as the
        // A1 dispatcher fix; the post-check needs the same discipline).
        const chk = `__chk_${Date.now()}__`;
        tmux(['send-keys', '-t', s, '-l', chk]); tmux(['send-keys', '-t', s, 'Enter']);
        await sleep(1_500);
        tmux(['send-keys', '-t', s, '-l', '/status']); tmux(['send-keys', '-t', s, 'Enter']);
        await sleep(4_000);
        const tail = capturePaneTail(s, 40);
        const after = tail.lastIndexOf(chk) >= 0 ? tail.slice(tail.lastIndexOf(chk)) : tail;
        assert(!MODEL_UNAVAILABLE_RE.test(after), `post-descent pane (after fresh marker) shows no model error`);
        assert(/opus|4-8|4\.8/i.test(after), `post-descent /status references the working model (opus/4-8)`);
    } finally { killFixture(s); }
}

const FULL_DOC = `
[warm-death-smoke] --full : the end-to-end ensureSurfaceSession warm-death (HEAVY, ~7-10min, BILLED).

  Run by Jim (he runs the evidence). It exercises the warm-death-SPECIFIC code in
  ensureSurfaceSession (the kill + drop-adoption on a needs-reconcile + model-error pane),
  which then reuses the already-GREEN cold-launch path (launch-tmux-surface.sh) + descent.

  Rig (the one decision for the evidence-runner): the cold-RELAUNCH inside ensureSurfaceSession
  uses launch-tmux-surface.sh, which reads the surface's model from the manifest. To force the
  relaunch onto a bogus head so the descent fires, either:
    (i)  add a throwaway manifest surface with model: [BOGUS, WORKING], OR
    (ii) launch-tmux-surface.sh already takes '--model <override>' — extend ensureSurfaceSession
         (test-only) to thread an override, OR simplest: point a real surface's manifest ladder
         head at BOGUS for the run and revert.

  Procedure once the rig forces BOGUS at relaunch:
    1. launch-tmux-surface.sh <slug> <test-surface> --no-log --model ${BOGUS}  (the "wedged" spoke)
    2. send a prompt → the model-error surfaces on the pane.
    3. inject the session into the dispatcher (_sessionsForTest) with turnState='needs-reconcile'.
    4. call ensureSurfaceSession(slug, test-surface, {ladder:[BOGUS, WORKING]}).
    5. ASSERT: the wedged session is killed (tmux has-session fails); a fresh session launched;
       awaitChromeOrDescend descends BOGUS→WORKING; adoption succeeds; the [model:]/surface-index
       reads the ACTUAL landed rung (WORKING), not the assumed head (DEC-092 observed-banner —
       the OTHER failover enable-gate; verify it together here).

  --detect + --descend (above) cover the cheap crux of (a)+(b); --full is the billed confirmation.
`;

async function main(): Promise<void> {
    const mode = process.argv[2];
    if (mode === '--detect') await detect();
    else if (mode === '--descend') await descend();
    else if (mode === '--full') { console.log(FULL_DOC); process.exit(0); }
    else {
        console.error('usage: warm-death-smoke.ts --detect | --descend | --full');
        process.exit(64);
    }
    console.log(failures === 0 ? `\n[warm-death-smoke] ✓ ${mode} PASS` : `\n[warm-death-smoke] ✗ ${mode} ${failures} assertion(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[warm-death-smoke] FATAL:', e); process.exit(2); });
