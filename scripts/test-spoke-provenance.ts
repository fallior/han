#!/usr/bin/env tsx
// test-spoke-provenance.ts — proof harness for the spoke provenance capture (S218, build B).
//
//   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-spoke-provenance.ts
//
// Part A: the anchor-diff core (renderAppend) — deterministic cases (first-capture, scroll-append,
//         no-change→empty, context-refresh), injected clock.
// Part B: a LIVE scratch tmux spoke — set a large history-limit, emit a burst, capture, emit more,
//         KILL the session mid-burst, and prove the capture caught what the last window held (the
//         exact failure B exists to close — Jim's suggested proof, my P5 instinct aimed at B).
//
// Self-contained: writes to a throwaway $HAN_HOME, cleans up its tmux session + temp dir.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderAppend } from '../src/server/lib/terminal-anchor-diff';
import { captureSpokeProvenance, spokeProvenanceLogPath, __resetSpokeState } from '../src/server/lib/spoke-provenance';

// throwaway HAN_HOME so the test never touches ~/.han (hanHome() resolves $HAN_HOME at call time)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-prov-'));
process.env.HAN_HOME = TMP;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}`); };
const T0 = 1_700_000_000_000; // fixed epoch for deterministic headers

// ── Part A: the anchor-diff core ─────────────────────────────────────────────
{
    // first capture writes everything non-noise + a header
    const r1 = renderAppend({ prev: [], lastTs: 0 }, 'alpha\nbeta\ngamma', T0, 'Australia/Brisbane');
    ok('A1 first-capture emits all lines', /alpha/.test(r1.output) && /beta/.test(r1.output) && /gamma/.test(r1.output));
    ok('A1 first-capture sets a timestamp header', /--- .* ---/.test(r1.output));

    // scroll: same tail + new lines below → only the new lines are emitted
    const r2 = renderAppend(r1.state, 'beta\ngamma\ndelta\nepsilon', T0 + 1000, 'Australia/Brisbane');
    ok('A2 scroll emits only new lines (delta,epsilon)', /delta/.test(r2.output) && /epsilon/.test(r2.output));
    ok('A2 scroll does NOT re-emit anchor content', !/alpha/.test(r2.output) && !/\bbeta\b/.test(r2.output.replace(/.*epsilon.*/s, '')));

    // no change → empty output, state still advances
    const r3 = renderAppend(r2.state, 'beta\ngamma\ndelta\nepsilon', T0 + 2000, 'Australia/Brisbane');
    ok('A3 unchanged snapshot emits nothing', r3.output === '');

    // anchor lost (whole screen replaced) → context-refresh marker + all new content
    const r4 = renderAppend(r3.state, 'totally\ndifferent\nscreen', T0 + 3000, 'Australia/Brisbane');
    ok('A4 lost-anchor emits context-refresh marker', /context refreshed/.test(r4.output));
    ok('A4 lost-anchor emits the new screen', /totally/.test(r4.output) && /different/.test(r4.output));

    // timestamp header only re-emits after the 5-min interval
    const r5 = renderAppend(r4.state, 'different\nscreen\nmore', T0 + 3000 + 4 * 60 * 1000, 'Australia/Brisbane');
    ok('A5 sub-interval append has NO new header', !/--- .* ---/.test(r5.output));
    const r6 = renderAppend(r5.state, 'screen\nmore\nyet', T0 + 3000 + 10 * 60 * 1000, 'Australia/Brisbane');
    ok('A6 post-interval append re-emits a header', /--- .* ---/.test(r6.output));
}

// ── Part B: live scratch tmux spoke, killed mid-burst ────────────────────────
const SESSION = `test-spoke-prov-${process.pid}`;
function tmux(args: string[]) { return execFileSync('tmux', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  try {
    __resetSpokeState();
    // large history so a burst isn't lost before capture (rider 2 sizing)
    tmux(['new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50', 'bash', '--norc']);
    tmux(['set-option', '-t', SESSION, 'history-limit', '200000']);
    // empty prompt + clear so the pane is a stream of unique content lines — faithful to the
    // real spoke (a Claude TUI whose last line is unique content), not a bash prompt that repeats
    // every command (a repeated last line is pathological for ANY last-line anchor-diff; the real
    // TUI never hits it — leo's 177 MB interactive log is the proof the algorithm works in situ).
    tmux(['send-keys', '-t', SESSION, `export PS1=''`, 'Enter']);
    await sleep(200);
    tmux(['send-keys', '-t', SESSION, 'clear', 'Enter']);
    await sleep(300);

    // burst 1 — the "transaction" output
    for (let i = 1; i <= 40; i++) tmux(['send-keys', '-t', SESSION, `echo "TXN1-line-${i}-marker"`, 'Enter']);
    await sleep(600);
    const cap1 = captureSpokeProvenance('testagent', 'scratch', SESSION, { reason: 'txn', now: T0 });
    ok('B1 post-transaction capture succeeded', cap1);

    const logPath = spokeProvenanceLogPath('testagent', 'scratch');
    let log = fs.readFileSync(logPath, 'utf8');
    ok('B1 log contains the transaction burst (line 1 and line 40)', /TXN1-line-1-marker/.test(log) && /TXN1-line-40-marker/.test(log));
    ok('B1 log carries the declared-cadence metadata [capture:txn]', /\[capture:txn\]/.test(log));

    // burst 2 — more output, then KILL the session mid-burst (the pane dies)
    for (let i = 1; i <= 30; i++) tmux(['send-keys', '-t', SESSION, `echo "TXN2-line-${i}-marker"`, 'Enter']);
    await sleep(500);
    // the pre-clear/reap capture fires BEFORE the pane is gone (the whole point of B)
    const cap2 = captureSpokeProvenance('testagent', 'scratch', SESSION, { reason: 'pre-clear', now: T0 + 1000 });
    ok('B2 pre-clear capture succeeded', cap2);
    tmux(['kill-session', '-t', SESSION]); // pane is now GONE

    log = fs.readFileSync(logPath, 'utf8');
    ok('B2 pre-clear capture caught burst-2 before the kill (line 1 and line 30)', /TXN2-line-1-marker/.test(log) && /TXN2-line-30-marker/.test(log));

    // a capture AFTER the kill is a clean no-op (best-effort, never throws)
    const cap3 = captureSpokeProvenance('testagent', 'scratch', SESSION, { reason: 'reap', now: T0 + 2000 });
    ok('B3 capture after kill is a graceful no-op (pane gone)', cap3 === false);
  } finally {
    try { tmux(['kill-session', '-t', SESSION]); } catch { /* already gone */ }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().then(() => {
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail ? 1 : 0);
});
