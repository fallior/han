/**
 * Phase-2 P2.1 (thread mqun1to5) — proves the wake-feed queue primitive `feedWakeSteps`:
 *   1. steps fed in ORDER, one at a time;
 *   2. ack-before-next — the next step is NEVER fed until the current step's `STEP-OK <id>`
 *      marker appears (the queue IS the gate);
 *   3. the gradient step's OBJECTIVE ack — marker alone is not enough; the echoed sentinel c0
 *      must be a real c0 of the agent (isAgentC0, Phase-1 reused);
 *   4. fail-safe — a step that never acks → DispatchTimeoutError (no infinite wait, no work).
 *
 * INERT primitive (not yet wired into ensureSurfaceSession). Driven entirely by test hooks —
 * no real spoke. Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-wake-feed-queue.ts
 * EXIT 0 iff every assertion holds.
 */
import * as os from 'os';
import * as path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { feedWakeSteps, __setTestHooks, DispatchTimeoutError, type WakeStep } from '../src/server/lib/tmux-dispatcher';
import { mostRecentC0Id } from '../src/server/lib/memory-gradient';

let failures = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const SLUG = 'leo', SURFACE = 'wakefeedtest';
const sentinel = path.join(os.homedir(), '.han', 'health', `${SLUG}-${SURFACE}-ready`);
const writeSentinel = (id: string) => writeFileSync(sentinel, id + '\n');
const clearSentinel = () => { try { rmSync(sentinel); } catch { /* none */ } };

async function main() {
    console.log('[1] steps fed in order + ack-before-next (the queue is the gate)');
    const steps: WakeStep[] = [
        { id: 'identity', prompt: 'load identity+patterns ... reply STEP-OK identity', ack: { kind: 'marker' } },
        { id: 'wmpair',   prompt: 'load the WM pair whole ... reply STEP-OK wmpair',    ack: { kind: 'marker' } },
        { id: 'felt',     prompt: 'load felt-moments whole ... reply STEP-OK felt',     ack: { kind: 'marker' } },
    ];
    const sent: string[] = [];
    const withheld: Record<string, number> = {};
    let gatingViolation = false;
    __setTestHooks({
        sleep: () => {},
        sendLine: (_s, line) => { const st = steps.find((x) => line.includes(`STEP-OK ${x.id}`)); if (st) sent.push(st.id); },
        capturePaneTail: () => {
            const cur = sent[sent.length - 1];               // the step most recently fed
            withheld[cur] = (withheld[cur] ?? 0) + 1;
            if (withheld[cur] <= 2) {                          // withhold the ack twice → force the feeder to wait
                const idx = steps.findIndex((x) => x.id === cur);
                if (sent.length !== idx + 1) gatingViolation = true; // a later step was fed before this one acked
                return '';                                     // no marker yet
            }
            return `STEP-OK ${cur}`;                            // now ack
        },
    });
    await feedWakeSteps(SLUG, SURFACE, steps, { perStepTimeoutMs: 5000 });
    ok(JSON.stringify(sent) === JSON.stringify(['identity', 'wmpair', 'felt']), 'all 3 steps fed in order');
    ok(!gatingViolation, 'ack-before-next held — no step fed while the prior was un-acked');

    console.log('[2] the gradient step — marker + an OBJECTIVE real c0 (isAgentC0)');
    const realC0 = mostRecentC0Id('leo');
    ok(!!realC0, 'have a real leo c0 to echo');
    const gradStep: WakeStep[] = [{ id: 'gradient', prompt: 'load the gradient to GRADIENT-EOF ... reply STEP-OK gradient', ack: { kind: 'c0' } }];
    writeSentinel(realC0!);
    __setTestHooks({ sleep: () => {}, sendLine: () => {}, capturePaneTail: () => 'STEP-OK gradient' });
    await feedWakeSteps(SLUG, SURFACE, gradStep, { perStepTimeoutMs: 5000 });
    ok(true, 'gradient step accepts: marker present AND sentinel carries a real c0');

    writeSentinel('bogus-not-a-real-c0');
    let threwBogus = false;
    try { await feedWakeSteps(SLUG, SURFACE, gradStep, { perStepTimeoutMs: 300 }); }
    catch (e) { threwBogus = e instanceof DispatchTimeoutError; }
    ok(threwBogus, 'gradient step with marker but BOGUS c0 → does NOT ack → DispatchTimeoutError (the objective check bites)');

    console.log('[3] fail-safe — a step that never acks');
    __setTestHooks({ sleep: () => {}, sendLine: () => {}, capturePaneTail: () => '' });
    let threwNever = false;
    try { await feedWakeSteps(SLUG, SURFACE, [{ id: 'x', prompt: 'do x ... reply STEP-OK x', ack: { kind: 'marker' } }], { perStepTimeoutMs: 300 }); }
    catch (e) { threwNever = e instanceof DispatchTimeoutError; }
    ok(threwNever, 'never-acking step → DispatchTimeoutError (no infinite wait, no work released)');

    clearSentinel();
    __setTestHooks(null);
    console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); clearSentinel(); __setTestHooks(null); process.exit(1); });
