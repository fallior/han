/**
 * scripts/test-orphan-reap.ts — negative tests for B2b orphaned-spoke reap (Phase-2 liveness).
 *
 * The reap KILLS processes, so the cardinal gate is S167 self-kill safety: it must NEVER
 * flag (a) this process or any of its ancestors, or (b) a process under a live tmux pane
 * (a live spoke). These tests assert `findOrphanedSpokePids` (the read-only identification
 * half) holds both guards, re-deriving the checks INDEPENDENTLY of the implementation.
 *
 * Run from inside a leo session (so the running session matches the ('leo','session') env
 * filter — the real S167 scenario): `npx tsx scripts/test-orphan-reap.ts`
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { findOrphanedSpokePids } from '../src/server/lib/tmux-dispatcher';

function ppidOf(pid: number): number {
    try {
        const m = fs.readFileSync(`/proc/${pid}/status`, 'utf-8').match(/^PPid:\s*(\d+)/m);
        return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
}
function ancestry(pid: number): Set<number> {
    const s = new Set<number>();
    let c = pid;
    for (let d = 0; c > 1 && d < 24 && !s.has(c); d++) { s.add(c); c = ppidOf(c); }
    return s;
}
function livePanePids(): Set<number> {
    try {
        return new Set(execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_pid}'], { encoding: 'utf-8' })
            .split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0));
    } catch { return new Set(); }
}
function underLivePane(pid: number, panes: Set<number>): boolean {
    let c = pid;
    for (let d = 0; c > 1 && d < 24; d++) { if (panes.has(c)) return true; c = ppidOf(c); }
    return false;
}

let fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) fail++; };

const self = process.pid;
const mine = ancestry(self);
const panes = livePanePids();

// Test A — the real S167 self-kill scenario. This test runs inside a leo session
// (AGENT_SLUG=leo, AGENT_SURFACE=session), so the running session's `claude` MATCHES the
// ('leo','session') env filter and is therefore a candidate — it MUST be excluded (self-
// ancestry + live-pane), never returned for reaping.
const sessionFlagged = findOrphanedSpokePids('leo', 'session');
check('self pid is never flagged as an orphan (S167)', !sessionFlagged.includes(self));
check('no ancestor of self is flagged (S167 walk-ppid)', !sessionFlagged.some((p) => mine.has(p)));

// Test B — across every real surface, EVERY pid the reap would flag must be genuinely
// pane-less AND not in our ancestry. This is the live-spoke + self guard, checked against
// independently-derived pane/ancestry truth.
const SURFACES: Array<[string, string]> = [
    ['leo', 'session'], ['leo', 'heartbeat'], ['leo', 'human-response'],
    ['jim', 'human-response'], ['jim', 'supervisor-cycle'], ['jim', 'session'],
];
let leak = false;
for (const [slug, surface] of SURFACES) {
    for (const pid of findOrphanedSpokePids(slug, surface)) {
        if (underLivePane(pid, panes)) { console.log(`  LEAK: ${slug}/${surface} flagged pid ${pid} which IS under a live pane`); leak = true; }
        if (mine.has(pid)) { console.log(`  LEAK: ${slug}/${surface} flagged pid ${pid} which is in self-ancestry`); leak = true; }
    }
}
check('no flagged pid is under a live pane or in self-ancestry (live-spoke + self guard)', !leak);

// Test C — no false positives for a slug/surface no process uses.
check('unknown slug/surface yields [] (no false positives)', findOrphanedSpokePids('__nonexistent__', '__x__').length === 0);

console.log(fail === 0 ? '\n✅ ALL NEGATIVE TESTS PASSED' : `\n❌ ${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
