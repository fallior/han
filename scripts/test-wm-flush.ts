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
 *   F3 → MNT-098 leg 2: over-cap DRAINS oldest-first whole entries within the per-turn budget
 *      (the cap is a budget, never a refusal — Darron's polarity ruling 2026-08-07), alerting
 *      until drained; one-sided residue stays alert+preserve (the hand class); measurement
 *      failure → alert+preserve (NEVER treat-unreadable-as-empty — Tenshi finding 4).
 *   Reset-only-on-success + asymmetric-refusal preserved (append throws → swap intact).
 * The gate/parser contract (Jim fold 1) is asserted by grep-comparing the .sh regex family
 * against ENTRY_RE's source — a mismatch fails the suite.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENTRY_RE, readSwap, flushSwaps } from './wm-flush';
import {
    SWAP_FRAME_RE_M,
    SWAP_FRAME_RE_SRC,
    sanitizeSwapFrameText,
    swapFrame,
} from '../src/server/lib/swap-frame';

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

    console.log('— F3 → MNT-098 leg 2: the cap is a BUDGET — over-cap drains oldest-first, bounded, alerting until done —');
    {
        // Multi-entry backlog >20K on the full side: ONE bounded chunk drains per call, oldest
        // first, whole entries only; remainder preserved byte-exact; alert names the drain.
        const entryOf = (n: number) => `### E${n}\n` + `SECRETMARKER-line-${n}\n`.repeat(200); // ~4.4K each
        const bigBody = [1, 2, 3, 4, 5, 6, 7, 8].map(entryOf).join(''); // ~35K, 8 entries
        const { f, c } = writePair('drain', HEADER + bigBody, HEADER + '### small\nok\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        const t = alertTail();
        const remainder = fs.readFileSync(f, 'utf-8');
        check('over-cap → drains a bounded chunk (not refused, not dumped whole)',
            res.outcome === 'flushed' && res.kind === 'backlog-draining' && r.calls.length === 1);
        check('chunk is OLDEST-first whole entries', r.calls[0]?.full.includes('### E1') === true && r.calls[0]?.full.includes('### E4') === true && r.calls[0]?.full.includes('### E6') === false);
        check('remainder preserved byte-exact (suffix of the original body)',
            remainder.startsWith('# Session Swap') && remainder.includes('### E6') && remainder.includes('### E8') && !remainder.includes('### E1\n'));
        check('drain alert fires (visibility until drained) with NO swap content (Tenshi 5b)',
            t.includes('backlog-draining') && !t.includes('SECRETMARKER'));
        // Successive calls fully drain: run until under cap, then the normal path clears it.
        let guard = 0;
        let last = res;
        while (guard++ < 10) {
            last = await flushSwaps('leo', f, c, r.fn);
            if (last.kind !== 'backlog-draining') break;
        }
        check('successive turns fully drain, ending in an ordinary flush',
            last.outcome === 'flushed' && last.kind === undefined && !ENTRY_RE.test(fs.readFileSync(f, 'utf-8')));
        check('every entry delivered exactly once across the drain',
            [1, 2, 3, 4, 5, 6, 7, 8].every((n) => r.calls.filter((x) => x.full.includes(`### E${n}\n`)).length === 1));
    }
    {
        // A SINGLE oversize entry (> budget alone) is taken anyway — progress over latency;
        // an un-chunkable entry must never re-create the permanent jam.
        const { f, c } = writePair('oversize', HEADER + '### Huge\n' + 'x'.repeat(25_000) + '\n', HEADER + '### small\nok\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('oversize single entry drains alone (no permanent jam)', res.outcome === 'flushed' && r.calls.length === 1 && !ENTRY_RE.test(fs.readFileSync(f, 'utf-8')));
    }
    {
        // ONE-SIDED over-cap residue (entries on one side, none on the other): the append
        // contract would refuse (content,'') — stays the standing alert + hand-repair class.
        const { f, c } = writePair('onesided', HEADER + '### Big\n' + 'y'.repeat(21_000) + '\n', HEADER);
        const before = fs.readFileSync(f, 'utf-8');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('one-sided over-cap → alert + preserve (hand class, never manufactured symmetry)',
            res.outcome === 'alerted' && res.kind === 'backlog-over-cap' && r.calls.length === 0 && fs.readFileSync(f, 'utf-8') === before && alertTail().includes('ONE-SIDED'));
    }
    {
        // Append throw mid-drain → flush-failed + BOTH swaps preserved (both-or-neither, #49).
        const fullC = HEADER + '### A\n' + 'z'.repeat(21_000) + '\n### B\nsecond\n';
        const compC = HEADER + '### Ac\nsmall\n';
        const { f, c } = writePair('drainthrow', fullC, compC);
        const res = await flushSwaps('leo', f, c, throwingAppend as never);
        check('drain append-throw → flush-failed, both swaps preserved',
            res.outcome === 'failed' && fs.readFileSync(f, 'utf-8') === fullC && fs.readFileSync(c, 'utf-8') === compC);
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

    console.log('— sentinel frame: transport in, payload out (the addendum build) —');
    {
        // A framed canonical entry: frame line (transport) + ### heading + body (payload).
        const frame = swapFrame('2026-07-23T11:00:00+10:00');
        const { f, c } = writePair('framed',
            HEADER + frame + '\n### Framed entry\npayload line\n',
            HEADER + frame + '\n### Framed c1\npayload c\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('framed entry flushes', res.outcome === 'flushed' && r.calls.length === 1);
        check('payload (heading+body) moves to WM', r.calls[0]?.full.includes('### Framed entry') === true && r.calls[0]?.full.includes('payload line') === true);
        check('transport frame is STRIPPED — never enters WM', !SWAP_FRAME_RE_M.test(r.calls[0]?.full ?? 'x') && !SWAP_FRAME_RE_M.test(r.calls[0]?.comp ?? 'x'));
        check('framed swap resets to header-only', fs.readFileSync(f, 'utf-8').startsWith('# Session Swap') && !fs.readFileSync(f, 'utf-8').includes('SWAP-ENTRY'));
    }
    {
        // Tenshi gate 1 — the thread's own test vector: a body that QUOTES well-formed frames
        // (mid-line prose + inline code span, the forms the bell post itself carries) must
        // (a) NOT split the entry and (b) NOT survive the strip into WM.
        const quoted = `<!-- SWAP-ENTRY ts=2026-07-23T00:42:00Z -->`;
        const body = `### Quoting entry\nThe design uses the frame ${quoted} as transport, and prose like \`${quoted}\` in inline code.\n`;
        const { f, c } = writePair('quote',
            HEADER + swapFrame('2026-07-23T11:01:00+10:00') + '\n' + body,
            HEADER + swapFrame('2026-07-23T11:01:00+10:00') + '\n### Quote c\nsmall\n');
        const parsed = readSwap(f);
        const boundaries = parsed.body.match(new RegExp(SWAP_FRAME_RE_SRC, 'gm'))?.length ?? 0;
        check('mid-line/code-span frame quotes do NOT split (one real frame boundary)', boundaries === 1, `boundaries=${boundaries}`);
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('frame-quoting body flushes', res.outcome === 'flushed');
        check('NO well-formed frame survives into WM (quote is byte-stuffed)', !SWAP_FRAME_RE_M.test(r.calls[0]?.full ?? 'x'));
        check('the quoted mention stays legible (stuffed form present)', r.calls[0]?.full.includes('<!·-- SWAP-ENTRY') === true);
        check('surrounding prose intact around the stuffed quote', r.calls[0]?.full.includes('as transport, and prose like') === true);
    }
    {
        // The residual case, handled without loss: an own-line RAW frame quote (a writer-side
        // stuffing violation — the convention says quote it stuffed) DOES read as a boundary,
        // but the whole body still moves in ONE flush and nothing frame-shaped survives.
        const { f, c } = writePair('rawline',
            HEADER + swapFrame('2026-07-23T11:02:00+10:00') + '\n### Raw-line entry\nbefore\n' + swapFrame('2026-07-23T11:02:30+10:00') + '\nafter\n',
            HEADER + swapFrame('2026-07-23T11:02:00+10:00') + '\n### Raw c\nsmall\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('own-line raw quote: whole body moves in ONE flush, no bytes lost', res.outcome === 'flushed' && r.calls.length === 1 && r.calls[0]?.full.includes('before') === true && r.calls[0]?.full.includes('after') === true);
        check('own-line raw quote: nothing frame-shaped survives', !SWAP_FRAME_RE_M.test(r.calls[0]?.full ?? 'x'));
    }
    {
        // Tenshi gate 3 — header/entry classification is TOTAL: content before the first
        // boundary is header BY DECLARATION (preserved on reset, never flushed); a frame on
        // line one means an empty header; every byte is header or belongs to an entry.
        const frame = swapFrame('2026-07-23T11:03:00+10:00');
        const withHdr = readSwap((() => { const p = path.join(tmp, 'tot1.md'); fs.writeFileSync(p, HEADER + frame + '\n### E\nb\n'); return p; })());
        check('header totality: pre-frame region is the header, exactly', withHdr.header === HEADER && withHdr.body.startsWith(frame));
        const noHdr = readSwap((() => { const p = path.join(tmp, 'tot2.md'); fs.writeFileSync(p, frame + '\n### E\nb\n'); return p; })());
        check('header totality: frame-first file has empty header', noHdr.header === '' && noHdr.header.length + noHdr.body.length === fs.readFileSync(path.join(tmp, 'tot2.md'), 'utf-8').length);
        const { f, c } = writePair('tot3', HEADER + frame + '\n### E\nbody\n', HEADER + frame + '\n### Ec\nbody\n');
        await flushSwaps('leo', f, c, recorder().fn);
        check('header survives the flush byte-exact (reset writes it back)', fs.readFileSync(f, 'utf-8') === HEADER);
    }
    {
        // Migration proof (the bell, gate 6): a MIXED swap — legacy `## `/`### ` entries from
        // the transition + new framed entries — drains in one flush; legacy headings are
        // PAYLOAD (kept), frames are TRANSPORT (stripped).
        const { f, c } = writePair('migrate',
            HEADER + '## Legacy first\nold body\n### Legacy second\nmid body\n' + swapFrame('2026-07-23T11:04:00+10:00') + '\n### Framed third\nnew body\n',
            HEADER + '## Legacy c\nold c\n' + swapFrame('2026-07-23T11:04:00+10:00') + '\n### Framed c\nnew c\n');
        const r = recorder();
        const res = await flushSwaps('leo', f, c, r.fn);
        check('mixed legacy+framed drains in ONE flush', res.outcome === 'flushed' && r.calls.length === 1);
        check('legacy headings kept as payload', r.calls[0]?.full.includes('## Legacy first') === true && r.calls[0]?.full.includes('### Legacy second') === true && r.calls[0]?.full.includes('### Framed third') === true);
        check('frames stripped from the mixed drain', !SWAP_FRAME_RE_M.test(r.calls[0]?.full ?? 'x'));
        check('mixed swap resets clean', fs.readFileSync(f, 'utf-8') === HEADER);
    }
    {
        // Frames with no payload (bare transport satisfying the guard): alert + preserve —
        // an empty-framed turn must be legible, never silently consumed.
        const raw = HEADER + swapFrame('2026-07-23T11:05:00+10:00') + '\n';
        const { f, c } = writePair('bare', raw, raw);
        const res = await flushSwaps('leo', f, c, recorder().fn);
        check('frames-without-payload → alert + preserve', res.outcome === 'alerted' && res.kind === 'frames-without-payload' && fs.readFileSync(f, 'utf-8') === raw && alertTail().includes('frames-without-payload'));
    }

    console.log('— one-contract asserts (Jim fold 1, extended to the frame — all hooks vs swap-frame.ts) —');
    {
        const sh = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'wm-flush.sh'), 'utf-8');
        const gate = sh.match(/has_body\(\)\s*\{\s*grep -qE '([^']+)'/)?.[1];
        const parser = ENTRY_RE.source;
        check(`.sh gate regex present`, gate !== undefined, `found: ${gate}`);
        check(`.sh gate == ts parser family ('${gate}' vs '${parser}')`, gate === parser);
    }
    {
        // The guard and the recorder must cite the IDENTICAL frame regex as swap-frame.ts —
        // the upgrade's whole point is one contract, all hooks (never mtime vs grammar again).
        const guardSh = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'memory-guard.sh'), 'utf-8');
        const orientSh = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'orient-inject.sh'), 'utf-8');
        const guardRe = guardSh.match(/FRAME_RE='([^']+)'/)?.[1];
        const orientRe = orientSh.match(/FRAME_RE='([^']+)'/)?.[1];
        check(`memory-guard.sh FRAME_RE == swap-frame.ts ('${guardRe}')`, guardRe === SWAP_FRAME_RE_SRC);
        check(`orient-inject.sh FRAME_RE == swap-frame.ts ('${orientRe}')`, orientRe === SWAP_FRAME_RE_SRC);
        check('frame regex is the head of the parser family (frame canonical, legacy read-only tail)', ENTRY_RE.source.startsWith('^(' + SWAP_FRAME_RE_SRC.slice(1)));
        check(`taught placeholder 'ts=<ISO>' is INERT (cannot parse as a frame)`, !SWAP_FRAME_RE_M.test('<!-- SWAP-ENTRY ts=<ISO> -->'));
        // Casey's derivation pin (folded at land): the sanitiser must cover everything the
        // parser accepts — asserted by DERIVATION, not prose: a sanitised specimen frame can
        // never parse. The gate==parser law turned inward on the module's own two halves;
        // survives any future token change or fails the suite.
        check('derivation pin: sanitizeSwapFrameText(swapFrame()) can never parse (sanitiser ⊇ parser)', !SWAP_FRAME_RE_M.test(sanitizeSwapFrameText(swapFrame())));
    }
    {
        // Casey's live exhibit (either-side gate, folded at land): a ONE-sided grammar drift —
        // entries on the full side, an unparseable shape (e.g. `- ` bullets) on the compressed —
        // must reach the alert layer as a legible failure, never a silent no-op. The append
        // contract refuses asymmetry (modelled by the throwing fake, mirroring
        // appendPairedMemory's real refusal) → flush-failed alert, both swaps preserved.
        const fullC = HEADER + '### One-sided entry\nreal body\n';
        const compC = HEADER + '- bullet style, no family marker\n- another\n';
        const { f, c } = writePair('oneside', fullC, compC);
        const res = await flushSwaps('leo', f, c, throwingAppend as never);
        check('one-sided drift → legible flush-failed (never silent)', res.outcome === 'failed' && alertTail().includes('flush-failed'));
        check('one-sided drift preserves both swaps', fs.readFileSync(f, 'utf-8') === fullC && fs.readFileSync(c, 'utf-8') === compC);
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
