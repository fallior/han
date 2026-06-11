/**
 * #5 reconcile smoke — UNBILLED behavioural test of the dispatcher's turn-state
 * machine (idle-precondition + needs-reconcile-on-timeout), using a bash-pane
 * fixture that never answers. Run from src/server:
 *
 *   tmux new-session -d -s t5-smoke 'bash'
 *   touch ~/.han/health/leo-smoketest-ready
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/t5-reconcile-smoke.ts
 *   tmux kill-session -t t5-smoke && rm ~/.han/health/leo-smoketest-ready
 *
 * Asserts: (1) a dispatch timeout throws AND marks the session needs-reconcile;
 * (2) the idle precondition refuses a direct dispatch into that state.
 * (The forced-reconcile path itself — clearSession → newer sentinel — needs a real
 * welcome-back-capable session; it is exercised at the thaw, not here.)
 */
import { spawnAgentSession, sendTransactionPrompt } from '../src/server/lib/tmux-dispatcher';

async function main() {
    await spawnAgentSession('leo', 'smoketest', { tmuxSession: 't5-smoke', launchCommand: '', adoptExisting: true });
    try {
        await sendTransactionPrompt('leo', 'smoketest', 'noop', { timeoutMs: 1500 });
        console.log('FAIL: expected timeout'); process.exit(1);
    } catch (e) {
        const m = (e as Error).message;
        console.log(m.includes('needs-reconcile') ? 'PASS-1 timeout threw + marked needs-reconcile' : `FAIL-1: ${m}`);
        if (!m.includes('needs-reconcile')) process.exit(1);
    }
    try {
        await sendTransactionPrompt('leo', 'smoketest', 'noop2', { timeoutMs: 1500 });
        console.log('FAIL: expected refusal'); process.exit(1);
    } catch (e) {
        const m = (e as Error).message;
        const pass = m.includes("'needs-reconcile', not idle");
        console.log(pass ? 'PASS-2 idle-precondition refused dispatch' : `FAIL-2: ${m}`);
        if (!pass) process.exit(1);
    }
    console.log('SMOKE GREEN');
    process.exit(0);
}
main();
