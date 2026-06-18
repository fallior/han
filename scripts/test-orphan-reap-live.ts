/**
 * scripts/test-orphan-reap-live.ts — LIVE DESTRUCTIVE validation of B2b orphan-reap.
 * Run under the quiesce-window. Fabricates a real pane-less orphan (reparented to init)
 * AND a control under a live tmux pane, then proves the reap takes EXACTLY the orphan and
 * never the live-pane control (the S167 live-spoke guard, validated destructively).
 *   npx tsx scripts/test-orphan-reap-live.ts
 */
import { execSync } from 'child_process';
import { findOrphanedSpokePids } from '../src/server/lib/tmux-dispatcher';

const S = '__reaptest__';
const PANE = 'reaptest-live-pane';
const found = () => findOrphanedSpokePids(S, S);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}`); if (!ok) fail++; };

try { execSync(`tmux kill-session -t ${PANE} 2>/dev/null`); } catch { /* none */ }

check('baseline: no __reaptest__ orphans before fabrication', found().length === 0);

// A real pane-less ORPHAN: setsid → new session (no controlling tty); the spawning bash
// exits so the sleep reparents to init (PPID=1) — a genuine pane-less orphan, not a child
// of this test (which would inherit our live-pane ancestry and be correctly excluded).
const orphanPid = parseInt(
    execSync(`bash -c 'env AGENT_SLUG=${S} AGENT_SURFACE=${S} setsid sleep 300 </dev/null >/dev/null 2>&1 & echo $!'`).toString().trim(), 10);

// A CONTROL under a LIVE tmux pane (same env) — must NEVER be reaped (live-spoke guard).
execSync(`tmux new-session -d -s ${PANE} 'env AGENT_SLUG=${S} AGENT_SURFACE=${S} sleep 300'`);
const controlPid = parseInt(execSync(`tmux list-panes -t ${PANE} -F '#{pane_pid}'`).toString().trim(), 10);
execSync('sleep 1'); // let the orphan reparent to init + procs settle

const f = found();
check('orphan (pane-less, reparented to init) IS detected', f.includes(orphanPid));
check('control (under a live pane) is NOT detected', !f.includes(controlPid));
check('both fabricated procs currently alive', alive(orphanPid) && alive(controlPid));

// Reap exactly what was detected — the real mechanism: SIGTERM → 2s → SIGKILL stragglers.
for (const p of f) { try { process.kill(p, 'SIGTERM'); } catch { /* gone */ } }
execSync('sleep 2');
for (const p of f) { try { process.kill(p, 0); process.kill(p, 'SIGKILL'); } catch { /* dead */ } }
execSync('sleep 1');

check('orphan was REAPED (gone)', !alive(orphanPid));
check('control SURVIVED (live-pane spoke untouched)', alive(controlPid));

// Cleanup
try { execSync(`tmux kill-session -t ${PANE} 2>/dev/null`); } catch { /* none */ }
try { if (alive(controlPid)) process.kill(controlPid, 'SIGKILL'); } catch { /* none */ }
try { if (alive(orphanPid)) process.kill(orphanPid, 'SIGKILL'); } catch { /* none */ }

console.log(fail === 0 ? '\n✅ LIVE DESTRUCTIVE REAP-TEST PASSED' : `\n❌ ${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
