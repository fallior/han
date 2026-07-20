/**
 * MNT-060 F1–F4 suite — the per-turn swap-flush transitional fix.
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-wm-flush.ts
 *
 * Covers (per the thread mrt84v9k plan + all three seats' folds):
 *   F1 grammar family: ### flushes, ## flushes (legacy), mixed splits at the FIRST marker,
 *      header-only no-ops, jim's `**…**` no-ops (he converges — no family special-case),
 *      Casey's rewrite-not-append semantics (a ## backlog is BODY, never header).
 *   F2 artefact: written on failure + no-op-with-body; no swap CONTENT ever echoed (Tenshi 5b);
 *      rotation at the cap (Tenshi 5a).
 *   F3 guard both polarities: over-cap → alert+preserve; measurement failure → alert+preserve
 *      (NEVER treat-unreadable-as-empty — Tenshi finding 4).
 *   Reset-only-on-success + asymmetric-refusal preserved (append throws → swap intact).
 * The gate/parser contract (Jim fold 1) is asserted by grep-comparing the .sh regex family
 * against ENTRY_RE's source — a mismatch fails the suite.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENTRY_RE, readSwap, flushSwaps } from './wm-flush';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-flush-suite-'));
// Isolate the artefact from real health data (the env seam exists for exactly this; set BEFORE
// the wm-flush import is used — module reads it at load).
const ALERT_FILE = path.join(tmp, 'wm-flush-errors.jsonl');
process.env.WM_FLUSH_ALERT_FILE = ALERT_FILE;
function alertTail(): string {
    try { return fs.readFileSync(ALERT_FILE, 'utf-8').trim().split('\n').pop() ?? ''; } catch { return ''; }
}
function alertCount(): number {
    try { return fs.readFileSync(ALERT_FILE, 'utf-8').trim().split('\n').filter(Boolean).length; } catch { return 0; }
}
function writePair(name: string, fullContent: string, compContent: string): { f: string; c: string } {
    const f = path.join(tmp, `${name}-full.md`), c = path.join(tmp, `${name}-comp.md`);
    fs.writeFileSync(f, fullContent, 'utf-8'); fs.writeFileSync(c, compContent, 'utf-8');
    return { f, c };
}

/** Recording fake for appendPairedMemory — never touches real WM. */
function recorder() {
    const calls: Array<{ slug: string; full: string; comp: string }> = [];
    const fn = async (slug: string, full: string, comp: string, _o?: unknown) => { calls.push({ slug, full, comp }); };
    return { calls, fn: fn as never };
}
function throwingAppend(): never { throw new Error('asymmetric append refused (suite fake)'); }

const HEADER = '# Session Swap — suite\n\n> blurb line\n';

async function main(): Promise<void> {
    console.log('— F1 grammar family —');
    {
        const { f, c } = writePair('canon', HEADER + '### E1\nbody-a\n', HEADER + '### E1c\nbody-b\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('### entries flush', res.outcome === 'flushed' && r.calls.length === 1);
        check('### reset to header-only', !ENTRY_RE.test(fs.readFileSync(f, 'utf-8')) && fs.readFileSync(f, 'utf-8').startsWith('# Session Swap'));
        check('flushed body carries the entry', r.calls[0]?.full.includes('### E1') === true);
    }
    {
        const { f, c } = writePair('legacy', HEADER + '## Old entry\nlegacy body\n', HEADER + '## Old c\nlegacy c\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('## legacy entries flush (family)', res.outcome === 'flushed' && r.calls[0]?.full.includes('## Old entry') === true);
        check('## backlog is BODY not header (Casey)', !fs.readFileSync(f, 'utf-8').includes('Old entry'));
    }
    {
        const { f, c } = writePair('mixed', HEADER + '## First\nx\n### Second\ny\n', HEADER + '### Only\nz\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('mixed grammars: split at FIRST marker, whole body moves', res.outcome === 'flushed' && r.calls[0]?.full.includes('## First') === true && r.calls[0]?.full.includes('### Second') === true);
    }
    {
        const { f, c } = writePair('hdr', HEADER, HEADER);
        const res = await flushSwaps('leo', f, c, recorder().fn);
        check('header-only no-ops', res.outcome === 'noop');
    }
    {
        const { f, c } = writePair('jimstyle', HEADER + '**A jim-style note** with prose but no family marker.\n', HEADER + '**c side**\n');
        const before = alertCount();
        const res = await flushSwaps('jim-suite', f, c, recorder().fn);
        check('**-style no-ops small (jim converges; no special-case)', res.outcome === 'noop' && alertCount() === before);
        check('**-style swap preserved', fs.readFileSync(f, 'utf-8').includes('jim-style'));
    }
    {
        const big = HEADER + '**stranded**\n' + 'prose line with no marker\n'.repeat(300);
        const { f, c } = writePair('drift', big, big);
        const res = await flushSwaps('drift-suite', f, c, recorder().fn);
        const t = alertTail();
        check('large no-entry swap → no-entries-but-large alert (grammar drift made loud)', res.outcome === 'alerted' && res.kind === 'no-entries-but-large' && t.includes('no-entries-but-large'));
        check('drift swap preserved', fs.readFileSync(f, 'utf-8') === big);
    }

    console.log('— F3 backlog guard —');
    {
        const bigBody = '### Backlog\n' + 'SECRETMARKER-content-line\n'.repeat(2000); // >20K body
        const { f, c } = writePair('cap', HEADER + bigBody, HEADER + '### small\nok\n');
        const before = fs.readFileSync(f, 'utf-8');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        const t = alertTail();
        check('over-cap → alert, never dump', res.outcome === 'alerted' && res.kind === 'backlog-over-cap' && r.calls.length === 0);
        check('over-cap swap preserved byte-identical', fs.readFileSync(f, 'utf-8') === before);
        check('alert names the by-design repetition', t.includes('BY DESIGN'));
        check('alert carries NO swap content (Tenshi 5b)', !t.includes('SECRETMARKER'));
    }
    {
        const res = await flushSwaps('leo', path.join(tmp, 'missing-full.md'), path.join(tmp, 'missing-comp.md'), recorder().fn);
        check('unreadable swap → measurement-failure alert + preserve (fail-closed, Tenshi f4)', res.outcome === 'alerted' && res.kind === 'measurement-failure' && alertTail().includes('measurement-failure'));
    }

    console.log('— reset-only-on-success / asymmetric refusal —');
    {
        const fullC = HEADER + '### Real entry\nbody\n';
        const { f, c } = writePair('asym', fullC, HEADER); // comp header-only → asymmetric
        const res = await flushSwaps('leo', f, c, throwingAppend as never);
        check('append throws → flush-failed alert', res.outcome === 'failed' && alertTail().includes('flush-failed'));
        check('failed flush preserves BOTH swaps', fs.readFileSync(f, 'utf-8') === fullC && fs.readFileSync(c, 'utf-8') === HEADER);
    }

    console.log('— F2 artefact hygiene —');
    {
        // Rotation: inflate past the cap, trigger one alert, assert rotation happened.
        fs.mkdirSync(path.dirname(ALERT_FILE), { recursive: true });
        const keep = fs.existsSync(ALERT_FILE) ? fs.readFileSync(ALERT_FILE) : null;
        const keep1 = fs.existsSync(ALERT_FILE + '.1') ? fs.readFileSync(ALERT_FILE + '.1') : null;
        try {
            fs.writeFileSync(ALERT_FILE, 'x'.repeat(1_100_000), 'utf-8');
            const res = await flushSwaps('rotate-suite', path.join(tmp, 'nope.md'), path.join(tmp, 'nope2.md'), recorder().fn);
            const nowSize = fs.statSync(ALERT_FILE).size;
            check('jsonl rotates at cap (Tenshi 5a)', res.outcome === 'alerted' && nowSize < 10_000 && fs.existsSync(ALERT_FILE + '.1'));
        } finally {
            if (keep !== null) fs.writeFileSync(ALERT_FILE, keep); else fs.rmSync(ALERT_FILE, { force: true });
            if (keep1 !== null) fs.writeFileSync(ALERT_FILE + '.1', keep1); else fs.rmSync(ALERT_FILE + '.1', { force: true });
        }
    }

    console.log('— gate/parser one-contract assert (Jim fold 1) —');
    {
        const sh = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'wm-flush.sh'), 'utf-8');
        const gate = sh.match(/has_body\(\)\s*\{\s*grep -qE '([^']+)'/)?.[1];
        const parser = ENTRY_RE.source.replace(/^\^/, '^'); // '^(### |## )'
        check(`.sh gate regex present`, gate !== undefined, `found: ${gate}`);
        check(`.sh gate == ts parser family ('${gate}' vs '${parser}')`, gate === parser);
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
