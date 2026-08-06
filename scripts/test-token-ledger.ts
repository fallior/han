/**
 * FI #132 P0 suite — runs the harvester on a SCRATCH substrate only (env-pathed; the
 * assert-scratch law: a test write to production paths is unrepresentable here because
 * every path the script touches is injected). Covers the audit-mandated proofs:
 *   T1 reconcile (plan acceptance: totals match a hand-sum)
 *   T2 canary — content string never reaches ledger/state/report (Tenshi: privacy-by-proof)
 *   T3 dark-twin canary — parse-FAILURE path never quotes content (Casey R5)
 *   T4 M2 — non-agent cwd lands as human-other class, never 'unknown' (Jim M2)
 *   T5 incremental + live-append (partial line not consumed; no double-count)
 *   T6 genesis-at-EOF + --backfill (Jim F1)
 *   T7 sidechain column (Jim F4)
 *   T8 rotation is archive-move, bytes kept (Jim F3 / DEC-069)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'token-ledger-test-'));
const PROJECTS = path.join(SCRATCH, 'projects');
const STATE = path.join(SCRATCH, 'state.json');
const LEDGER = path.join(SCRATCH, 'ledger.jsonl');
const SCRIPT = path.join(__dirname, 'han-token-ledger.ts');
const CANARY = 'CANARY-XYZZY-CLIENT-MATTER-8842';
const LEO_CWD = path.join(os.homedir(), '.han', 'agents', 'Leo');

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

function run(args: string[] = ['harvest'], extraEnv: Record<string, string> = {}): string {
    return execFileSync('npx', ['tsx', SCRIPT, ...args], {
        cwd: path.join(__dirname, '..', 'src', 'server'),
        env: {
            ...process.env,
            NODE_PATH: path.join(__dirname, '..', 'src', 'server', 'node_modules'),
            TOKEN_LEDGER_PROJECTS_DIR: PROJECTS,
            TOKEN_LEDGER_STATE: STATE,
            TOKEN_LEDGER_FILE: LEDGER,
            ...extraEnv,
        },
        encoding: 'utf-8',
    });
}

function rec(ts: string, cwd: string, usage: Record<string, number>, opts: { model?: string; side?: boolean; content?: string } = {}): string {
    return JSON.stringify({
        timestamp: ts, cwd, sessionId: 'sess-test', isSidechain: opts.side ?? false,
        message: { model: opts.model ?? 'claude-opus-5', usage, content: [{ type: 'text', text: opts.content ?? 'hello' }] },
    }) + '\n';
}

const dir = path.join(PROJECTS, '-scratch-a');
fs.mkdirSync(dir, { recursive: true });
const tf = path.join(dir, 'session-1.jsonl');

// ── T6a: genesis at EOF — pre-existing content must NOT be harvested ──
fs.writeFileSync(tf, rec('2026-08-06T00:00:30.000Z', LEO_CWD, { input_tokens: 11, output_tokens: 13, cache_creation_input_tokens: 17, cache_read_input_tokens: 19 }));
run();
check('T6a genesis-at-EOF ledgers nothing', !fs.existsSync(LEDGER));

// ── T1/T2/T4/T7: appended records harvest with exact per-family sums ──
fs.appendFileSync(tf,
    rec('2026-08-06T00:01:00.000Z', LEO_CWD, { input_tokens: 1, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000 }, { content: CANARY }) +
    rec('2026-08-06T00:02:00.000Z', LEO_CWD, { input_tokens: 2, output_tokens: 200, cache_creation_input_tokens: 2000, cache_read_input_tokens: 60000 }) +
    rec('2026-08-06T00:03:00.000Z', path.join(os.homedir(), 'Projects', 'somewhere'), { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 7, cache_read_input_tokens: 8 }) +
    rec('2026-08-06T00:04:00.000Z', LEO_CWD, { input_tokens: 3, output_tokens: 300, cache_creation_input_tokens: 3000, cache_read_input_tokens: 70000 }, { side: true }));
run();
const rows = fs.readFileSync(LEDGER, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
const leoMain = rows.find((r) => r.agent === 'leo' && r.side === 0);
const leoSide = rows.find((r) => r.agent === 'leo' && r.side === 1);
const other = rows.find((r) => r.cls === 'human-other');
check('T1 per-family sums reconcile (Jim M1: four first-class columns)',
    !!leoMain && leoMain.turns === 2 && leoMain.in === 3 && leoMain.out === 300 && leoMain.cc === 3000 && leoMain.cr === 110000,
    JSON.stringify(leoMain));
check('T7 sidechain is its own row (Jim F4)', !!leoSide && leoSide.turns === 1 && leoSide.out === 300);
check('T4 non-agent cwd → human-other class, never unknown (Jim M2)',
    !!other && other.agent === 'human-other' && other.cls === 'human-other');
const ledgerText = fs.readFileSync(LEDGER, 'utf-8') + fs.readFileSync(STATE, 'utf-8');
check('T2 canary: content never reaches ledger or state (F5 projection)', !ledgerText.includes(CANARY));

// ── T5: live-append — partial line held, then completed; no double-count ──
fs.appendFileSync(tf, rec('2026-08-06T00:05:00.000Z', LEO_CWD, { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 }).trim()); // no newline
run();
const afterPartial = fs.readFileSync(LEDGER, 'utf-8').trim().split('\n').length;
fs.appendFileSync(tf, '\n');
run();
const afterComplete = fs.readFileSync(LEDGER, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
const totalLeoTurns = afterComplete.filter((r) => r.agent === 'leo').reduce((a, r) => a + r.turns, 0);
check('T5 partial line not consumed until newline; no double-count',
    afterPartial === rows.length && totalLeoTurns === 4, `partialRows=${afterPartial} leoTurns=${totalLeoTurns}`);

// ── T3: dark-twin — malformed line CONTAINING the canary; error path must not quote it ──
fs.appendFileSync(tf, `{"broken": "${CANARY}", no-json-here\n`);
const out3 = run();
const stateObj = JSON.parse(fs.readFileSync(STATE, 'utf-8'));
check('T3 dark-twin: parse error counted with location only, content never quoted (Casey R5)',
    stateObj.parseErrors === 1 && typeof stateObj.lastParseError?.offset === 'number' &&
    !JSON.stringify(stateObj).includes(CANARY) && !out3.includes(CANARY));

// ── T2b: report output clean of canary + carries the coverage declaration (Casey R2) ──
const rep = run(['report']);
check('T2b report: coverage declaration present, canary absent',
    rep.includes('Coverage declaration') && rep.includes('Cannot see') && !rep.includes(CANARY));

// ── T6b: --backfill refused post-genesis ──
let refused = false;
try { run(['harvest', '--backfill', '7']); } catch { refused = true; }
check('T6b --backfill refused once state exists (genesis-only, Jim F1)', refused);

// ── T8: rotation is archive-move — old bytes KEPT ──
const beforeBytes = fs.statSync(LEDGER).size;
fs.appendFileSync(tf, rec('2026-08-06T00:20:00.000Z', LEO_CWD, { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }));
run(['harvest'], { TOKEN_LEDGER_ROTATE_BYTES: '10' });
const archives = fs.readdirSync(SCRATCH).filter((f) => f.startsWith('ledger.jsonl.') && f.endsWith('.archive'));
check('T8 rotation archive-move: old ledger kept whole (F3/DEC-069)',
    archives.length === 1 && fs.statSync(path.join(SCRATCH, archives[0])).size === beforeBytes && fs.existsSync(LEDGER));

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
