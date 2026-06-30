/**
 * Test the sleeve-state resolver twin (R2 P-R2.1). Asserts:
 *  1. writeSleeveState (atomic) → sleeveSurface/sleeveSlug read it back.
 *  2. resolver falls back to $AGENT_SURFACE / $AGENT_SLUG when no file (the INERT property).
 *  3. malformed file → fallback (fail-soft).
 *  4. the .sh twin (sleeve-surface.sh) AGREES with the .ts on the SAME fixtures (present + absent).
 * Uses a unique test HAN_SESSION so it never collides with real ~/.han/sleeves entries; cleans up.
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { sleeveSurface, sleeveSlug, writeSleeveState, sleevesDir } from '../src/server/lib/sleeve-state';

const SH = path.resolve(__dirname, '..', 'src', 'hooks', 'sleeve-surface.sh');
const SESSION = `__sleevetest__${process.pid}`;
const filePath = path.join(sleevesDir(), `${SESSION}.json`);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)); };

/** Run the .sh resolver with a controlled env (HAN_SESSION + AGENT_SURFACE fallback). */
function shSurface(hanSession: string, fallback: string): string {
    return execFileSync('bash', [SH], {
        env: { ...process.env, HAN_SESSION: hanSession, AGENT_SURFACE: fallback },
        encoding: 'utf-8',
    }).trim();
}

try {
    // 1. atomic write + .ts read-back
    writeSleeveState(SESSION, 'jim', 'heartbeat');
    ok('writeSleeveState is atomic (no .tmp left behind)',
        !fs.readdirSync(sleevesDir()).some(f => f.startsWith(`${SESSION}.json.tmp`)));
    ok('sleeveSurface reads written surface', sleeveSurface(SESSION, 'session') === 'heartbeat');
    ok('sleeveSlug reads written slug', sleeveSlug(SESSION, 'leo') === 'jim');

    // 4a. .sh twin agrees on sleeve-PRESENT
    ok('.sh twin agrees (present → heartbeat)', shSurface(SESSION, 'session') === 'heartbeat');

    // 2. fallback when absent (INERT) — use a session with no file
    const ABSENT = `${SESSION}__absent`;
    ok('.ts fallback to $AGENT_SURFACE when absent', sleeveSurface(ABSENT, 'human-response') === 'human-response');
    ok('.ts fallback to "session" when absent + no fallback', sleeveSurface(ABSENT, undefined) === 'session');
    // 4b. .sh twin agrees on sleeve-ABSENT
    ok('.sh twin agrees (absent → fallback)', shSurface(ABSENT, 'human-response') === 'human-response');

    // 3. malformed file → fallback (fail-soft), both halves
    fs.writeFileSync(filePath, 'not json {{{', 'utf-8');
    ok('.ts malformed → fallback', sleeveSurface(SESSION, 'session') === 'session');
    ok('.sh malformed → fallback', shSurface(SESSION, 'session') === 'session');
} finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

console.log(`\nsleeve-surface: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
