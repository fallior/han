/**
 * MNT-067 suite — the wake-window flag (the fed wake's grace, prompt-sniffing retired).
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-wake-window.ts
 *
 * Pins the four ruled polarities (Darron's addendum + fork ruling; Jim's three assertions +
 * Casey's fourth) plus the one-contract law (MNT-060's gate==parser lesson applied here):
 *   P1  no block while the window is up (fresh flag → guard allows an unframed turn, receipted)
 *   P2  a VOLUNTARY framed write during the window still flushes whole (the flag gates the
 *       guard's block only — wm-flush never reads it; suppress the nag, keep the door open)
 *   P3  guard live on the first post-greeting turn (flag lowered → unframed turn blocks)
 *   P4  stale flag → guard live again AND the alert actually written (lapse-by-its-own-terms,
 *       fail toward guarded-and-loud)
 *   Pins: flag path template + staleness ceiling identical between tmux-dispatcher.ts and
 *       memory-guard.sh; the retired sniff is ABSENT from orient-inject.sh; the feeder lowers
 *       the flag only in its finally (delivered-in-full — the greeting turn's own Stop hook
 *       runs with the flag still up).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { WAKE_WINDOW_STALE_MINUTES, wakeWindowFlagPath } from '../src/server/lib/tmux-dispatcher';
import { flushSwaps } from './wm-flush';
import { swapFrame, SWAP_FRAME_RE_M } from '../src/server/lib/swap-frame';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const repoRoot = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-window-suite-'));
const HOME = path.join(tmp, 'home');
const MEM = path.join(tmp, 'mem');
fs.mkdirSync(path.join(HOME, '.han', 'signals'), { recursive: true });
fs.mkdirSync(MEM, { recursive: true });
const FULL = path.join(MEM, 'session-swap-full.md');
const COMP = path.join(MEM, 'session-swap.md');
const HEADER = '# Session Swap — suite\n';
const STATE = path.join(HOME, '.han', 'signals', 'memory-guard-wsuite.state');
const FLAG = path.join(HOME, '.han', 'signals', 'wake-window-wsuite.flag');
const EVENTS = path.join(HOME, '.han', 'health', 'wake-window-events.jsonl');

function resetSwaps(): void { fs.writeFileSync(FULL, HEADER); fs.writeFileSync(COMP, HEADER); }
function runOrient(): void {
    execFileSync('bash', [path.join(repoRoot, 'src', 'hooks', 'orient-inject.sh')], {
        env: { ...process.env, HOME, AGENT_MEMORY_DIR: MEM, AGENT_SLUG: 'wsuite', AGENT_SURFACE: 'session' },
        input: '{}', stdio: ['pipe', 'ignore', 'ignore'],
    });
}
function runGuard(): string {
    return execFileSync('bash', [path.join(repoRoot, 'src', 'hooks', 'memory-guard.sh')], {
        env: { ...process.env, HOME, AGENT_MEMORY_DIR: MEM, AGENT_SLUG: 'wsuite', AGENT_SURFACE: 'session', HAN_SESSION: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
}
function eventTail(): string {
    try { return fs.readFileSync(EVENTS, 'utf-8').trim().split('\n').pop() ?? ''; } catch { return ''; }
}

async function main(): Promise<void> {
    console.log('— P1: no block while the window is up —');
    {
        resetSwaps(); runOrient();                       // baselines recorded, no grace triggers
        fs.writeFileSync(FLAG, new Date().toISOString()); // the feeder raises the window
        const out = runGuard();                           // unframed turn ends
        check('fresh flag → guard allows an unframed turn (the obligation is gone)', out.trim() === '');
        check('the skip is RECEIPTED (flag-grace event written — no invisible exemption)', eventTail().includes('"flag-grace"') && eventTail().includes('"wsuite"'));
    }

    console.log('— P2: the door stays open — a chosen noticing during the window still flushes whole —');
    {
        // The flag is STILL UP. A voluntary framed write lands in the swap, and the flush path
        // (a separate Stop hook that never reads the flag) flushes it exactly as normal.
        const frame = swapFrame('2026-07-24T19:30:00+10:00');
        fs.writeFileSync(FULL, HEADER + frame + '\n### Chosen noticing\na felt-moment at a seam\n');
        fs.writeFileSync(COMP, HEADER + frame + '\n### Chosen c1\nsmall\n');
        const calls: Array<{ full: string }> = [];
        const rec = (async (_s: string, full: string, _c: string) => { calls.push({ full }); }) as never;
        const res = await flushSwaps('wsuite', FULL, COMP, rec);
        check('voluntary framed write flushes whole while the window is up', res.outcome === 'flushed' && calls[0]?.full.includes('a felt-moment at a seam') === true);
        check('the flush stripped transport as normal (window changes nothing about the channel)', !SWAP_FRAME_RE_M.test(calls[0]?.full ?? 'x'));
        const flushSh = fs.readFileSync(path.join(repoRoot, 'src', 'hooks', 'wm-flush.sh'), 'utf-8');
        const flushTs = fs.readFileSync(path.join(repoRoot, 'scripts', 'wm-flush.ts'), 'utf-8');
        check('wm-flush NEVER reads the wake-window flag (polarity structural, both layers)', !flushSh.includes('wake-window') && !flushTs.includes('wake-window'));
    }

    console.log('— P3: guard live on the first post-greeting turn —');
    {
        resetSwaps(); runOrient();
        fs.rmSync(FLAG, { force: true });                 // the greeting landed; the feeder lowered it
        const out = runGuard();                           // unframed turn
        check('flag lowered → unframed turn BLOCKS (the next human prompt is fully guarded)', out.includes('"decision":"block"'));
    }

    console.log('— P4: stale flag → guard live + the alert actually written —');
    {
        resetSwaps(); runOrient();
        fs.writeFileSync(FLAG, 'stale\n');
        const staleSec = (WAKE_WINDOW_STALE_MINUTES + 5) * 60;
        const old = (Date.now() - staleSec * 1000) / 1000;
        fs.utimesSync(FLAG, old, old);                    // backdate past the ceiling
        const out = runGuard();
        check('stale flag reads as LOWERED (guard blocks the unframed turn)', out.includes('"decision":"block"'));
        check('stale-flag alert written (lapse-by-its-own-terms is LOUD)', eventTail().includes('"stale-flag"'));
        fs.rmSync(FLAG, { force: true });
    }

    console.log('— one-contract pins (the MNT-060 gate==parser law, applied here) —');
    {
        const guardSh = fs.readFileSync(path.join(repoRoot, 'src', 'hooks', 'memory-guard.sh'), 'utf-8');
        const orientSh = fs.readFileSync(path.join(repoRoot, 'src', 'hooks', 'orient-inject.sh'), 'utf-8');
        const dispatcher = fs.readFileSync(path.join(repoRoot, 'src', 'server', 'lib', 'tmux-dispatcher.ts'), 'utf-8');
        check('flag path template identical: guard vs feeder (wake-window-<slug>.flag)',
            guardSh.includes('wake-window-${SLUG}.flag') && dispatcher.includes('wake-window-${slug}.flag')
            && wakeWindowFlagPath('x').endsWith(path.join('.han', 'signals', 'wake-window-x.flag')));
        const shCeiling = guardSh.match(/WAKE_WINDOW_STALE_MIN=(\d+)/)?.[1];
        check(`staleness ceiling identical: guard (${shCeiling}) vs feeder (${WAKE_WINDOW_STALE_MINUTES})`, Number(shCeiling) === WAKE_WINDOW_STALE_MINUTES);
        check('the defeated fed-step sniff is RETIRED from orient-inject.sh', !orientSh.includes('reply on its own line EXACTLY') && !orientSh.includes('loaded whole and warm'));
        check('the human wake triggers REMAIN in orient-inject.sh (the self-run path has no feeder)', /welcome back\|good morning\|session start/.test(orientSh));
        // Casey's delivered-in-full, pinned at source: the feeder lowers the flag in EXACTLY one
        // place — its finally — and the terminal branch waits for the greeting turn's COMPLETION
        // (chrome-idle ticks) before returning into it. First-text lowering is unrepresentable.
        const lowers = dispatcher.match(/lowerWakeWindow\(/g)?.length ?? 0;
        check('the feeder lowers the flag in exactly ONE place (its finally — every exit path)', lowers === 2, `found ${lowers} (definition + 1 call expected)`);
        const finallyIdx = dispatcher.indexOf('lowerWakeWindow(slug);');
        const idleWaitIdx = dispatcher.indexOf('GREETING_IDLE_TICKS) {');
        check('the terminal branch waits for greeting-turn COMPLETION before the lower (delivered-in-full)', idleWaitIdx !== -1 && finallyIdx > idleWaitIdx);
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
