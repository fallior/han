/**
 * MNT-061 suite (test-idle-recycle) — idle-recycle/reap decisions, fit-calculation, pool ops,
 * receipts. (Named distinctly from the pre-existing test-spoke-lifecycle.ts, S200's warm-gate
 * suite — untouched.)
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-idle-recycle.ts
 *
 * Pure-logic + registry-op coverage (no tmux needed — the dispatcher wiring routes through
 * retireStem/the chrome-guarded sweep, which MNT-056/graceful-reap already prove live):
 *   decide: keep-under-idle · recycle-at-idle-under-ceiling · reap-at-idle-over-ceiling ·
 *           null-ctx→RECYCLE (fail-toward-holding) · null-clock→skip-alert ·
 *           unreadable-clock→skip-alert · null-clock-falls-back-to-bound_at (Jim's ruling) ·
 *           leased-stem-invisible · recycle-resets-the-clock
 *   fit:    affinity preferred (delta-burden) · best-fit = tightest fitting · freshest when
 *           nothing fits · unmeasurable-ctx candidates skipped · all-unmeasurable → null ·
 *           burden uses the MEASURED rate (never chars÷4) · affinity-over-ceiling refused
 *   ops:    decoupleSpoke (spoke→free, last_thread kept, ids cleared; no-op on non-spoke) ·
 *           checkoutStemById (atomic, refuses non-free) · touchSpokeServed
 *   receipts: both verbs · rotation at cap · env-isolated (HAN_HEALTH_DIR/HAN_POOL_DIR temp)
 *   revive-during-sweep: a decoupled spoke's thread revives → affinity re-binds — never lost
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-recycle-suite-'));
process.env.HAN_POOL_DIR = path.join(tmp, 'pool');
process.env.HAN_HEALTH_DIR = path.join(tmp, 'health');

import { decideIdleAction, selectStemForThread, burdenPctForChars, writeSpokeLifecycleReceipt, idleClock, tierCompatible, stampTier, bindTierDecision, MIXED_TRUST_TIER, FAMILY_TRUST_TIER, CHARS_PER_TOKEN, RESPONSE_HEADROOM_TOKENS, TOKENS_PER_CTX_PCT } from '../src/server/lib/spoke-lifecycle';
import { decoupleSpoke, checkoutStemById, touchSpokeServed, upsertStem, readPool, findSpokeForThread, bindSpoke, type PoolStem } from '../src/server/lib/stem-pool';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const H = 3600_000;
const NOW = Date.parse('2026-07-21T00:00:00.000Z');
function mkStem(o: Partial<PoolStem>): PoolStem {
    return { stem_id: 's1', tmux_session: 's1', state: 'spoke', c0: 'c0', wm_cursor: 0, cursor_set_ts: new Date(NOW).toISOString(), model: 'm', warm_at: new Date(NOW - 50 * H).toISOString(), ...o } as PoolStem;
}
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

async function main(): Promise<void> {
    console.log('— decideIdleAction —');
    {
        const r = decideIdleAction(mkStem({ last_served_at: iso(10 * H) }), NOW, 48, 70, 40);
        check('under idle threshold → keep', r.action === 'keep');
    }
    {
        const r = decideIdleAction(mkStem({ last_served_at: iso(49 * H) }), NOW, 48, 70, 40);
        check('idle + ctx<ceiling → recycle', r.action === 'recycle');
    }
    {
        const r = decideIdleAction(mkStem({ last_served_at: iso(49 * H) }), NOW, 48, 70, 85);
        check('idle + ctx≥ceiling → reap', r.action === 'reap');
    }
    {
        const r = decideIdleAction(mkStem({ last_served_at: iso(49 * H) }), NOW, 48, 70, null);
        check('idle + UNMEASURABLE ctx → RECYCLE (fail-toward-holding, never kill)', r.action === 'recycle');
    }
    {
        const stem = mkStem({}); delete stem.last_served_at; delete stem.bound_at; delete stem.leased_at;
        const r = decideIdleAction(stem, NOW, 48, 70, 40);
        check('no clock at all → skip-alert, never reap', r.action === 'skip-alert');
    }
    {
        const r = decideIdleAction(mkStem({ last_served_at: 'not-a-date' }), NOW, 48, 70, 40);
        check('unreadable clock → skip-alert, never reap', r.action === 'skip-alert');
    }
    {
        const stem = mkStem({ bound_at: iso(49 * H) }); delete stem.last_served_at;
        const r = decideIdleAction(stem, NOW, 48, 70, 40);
        check("null last_served_at → clock reads bind time (Jim's ruling)", r.action === 'recycle' && idleClock(stem) === stem.bound_at);
    }
    {
        const r = decideIdleAction(mkStem({ state: 'leased', last_served_at: iso(60 * H) }), NOW, 48, 70, 40);
        check('leased (mid-dispatch) stem invisible to the sweep', r.action === 'keep');
    }

    console.log('— burden estimator —');
    {
        const chars = 260_000;
        const expected = (chars / CHARS_PER_TOKEN + RESPONSE_HEADROOM_TOKENS) / TOKENS_PER_CTX_PCT;
        check('burden uses measured 2.6 chars/token + headroom', Math.abs(burdenPctForChars(chars) - expected) < 1e-9);
        check('burden(0) = headroom only (fail-soft floor)', burdenPctForChars(0) === RESPONSE_HEADROOM_TOKENS / TOKENS_PER_CTX_PCT);
        const folk = chars / 4 / TOKENS_PER_CTX_PCT;
        check('measured rate ≠ the falsified chars÷4 (FI #116)', Math.abs(burdenPctForChars(chars) - folk) > 10);
    }

    console.log('— selectStemForThread (fit + best-fit + affinity) —');
    const ctxMap: Record<string, number | null> = {};
    const ctxOf = (s: PoolStem) => ctxMap[s.stem_id] ?? null;
    const free = (id: string, extra: Partial<PoolStem> = {}) => mkStem({ stem_id: id, tmux_session: id, state: 'free', ...extra });
    {
        ctxMap.a = 35; ctxMap.b = 60; ctxMap.c = 68;
        const sel = selectStemForThread([free('a'), free('b'), free('c')], 'T1', ctxOf, 15, 80, 70);
        check('best-fit picks the TIGHTEST fitting stem (c at 68 overflows 80; b fits at 75)', sel?.stemId === 'b' && sel.mode === 'best-fit', JSON.stringify(sel));
    }
    {
        ctxMap.a = 35; ctxMap.b = 60; ctxMap.aff = 65;
        const sel = selectStemForThread([free('a'), free('b'), free('aff', { last_thread: 'T2' })], 'T2', ctxOf, 30, 80, 70);
        check('affinity preferred at delta-burden (former spoke wins despite fuller)', sel?.stemId === 'aff' && sel.mode === 'affinity');
    }
    {
        ctxMap.a = 35; ctxMap.b = 60;
        const sel = selectStemForThread([free('a'), free('b')], 'T3', ctxOf, 55, 80, 70);
        check('nothing fits (big thread) → freshest (lowest ctx)', sel?.stemId === 'a' && sel.mode === 'freshest');
    }
    {
        ctxMap.u = null; ctxMap.b = 60;
        const sel = selectStemForThread([free('u'), free('b')], 'T4', ctxOf, 10, 80, 70);
        check('unmeasurable-ctx candidate skipped', sel?.stemId === 'b');
        const sel2 = selectStemForThread([free('u')], 'T4', ctxOf, 10, 80, 70);
        check('all-unmeasurable → null (generic checkout fallback)', sel2 === null);
    }
    {
        ctxMap.full = 75;
        const sel = selectStemForThread([free('full', { last_thread: 'T5' })], 'T5', ctxOf, 5, 80, 70);
        check('affinity stem at/over rethread ceiling NOT re-bound via affinity', sel?.mode !== 'affinity');
    }

    console.log("— Tenshi's folds: trust partition + null-burden fail-toward-fresh —");
    {
        check('one tier today: tierCompatible is a no-op (undefined = family)', tierCompatible(undefined, FAMILY_TRUST_TIER) && tierCompatible('family', 'family'));
        check('the partition slot: cross-tier is INCOMPATIBLE', !tierCompatible('untrusted', FAMILY_TRUST_TIER));
    }
    {
        ctxMap.priv = 40; ctxMap.b = 60;
        const sel = selectStemForThread([free('priv', { trust_tier: 'untrusted' }), free('b')], 'T6', ctxOf, 10, 80, 70);
        check('cross-tier stem invisible to the fit (partition before packing)', sel?.stemId === 'b');
    }
    {
        ctxMap.aff2 = 50; ctxMap.b = 60;
        const sel = selectStemForThread([free('aff2', { last_thread: 'T7', trust_tier: 'untrusted' }), free('b')], 'T7', ctxOf, 10, 80, 70);
        check('PARTITION WINS OVER AFFINITY (tier-crossed former spoke never re-binds on the hint)', sel?.stemId === 'b' && sel.mode !== 'affinity');
    }
    {
        ctxMap.a = 35; ctxMap.b = 60;
        const sel = selectStemForThread([free('a'), free('b')], 'T8', ctxOf, null, 80, 70);
        check('NULL burden (estimator failure) → freshest, never best-fit packing', sel?.stemId === 'a' && sel.mode === 'freshest');
    }
    {
        ctxMap.aff3 = 50;
        const sel = selectStemForThread([free('aff3', { last_thread: 'T9' })], 'T9', ctxOf, null, 80, 70);
        check('NULL burden still allows affinity (delta-only, no estimate needed)', sel?.mode === 'affinity');
    }

    console.log("— the stamp-fix (Tenshi's re-run finding, folded at land): sticky-with-a-fuse + bind refusal —");
    {
        check('first bind stamps the thread tier', stampTier(undefined, 'family') === 'family');
        check('same-tier re-bind is idempotent (a history, not last-writer-wins)', stampTier('family', 'family') === 'family');
        check("differing tier quarantines as 'mixed' (the crossing is RECORDED, never erased)", stampTier('family', 'untrusted') === MIXED_TRUST_TIER && stampTier('untrusted', 'family') === MIXED_TRUST_TIER);
        check("'mixed' is equality-incompatible with every tier (finishes tenure, ages out)", !tierCompatible(MIXED_TRUST_TIER, 'family') && !tierCompatible(MIXED_TRUST_TIER, 'untrusted') && !tierCompatible(MIXED_TRUST_TIER, MIXED_TRUST_TIER + 'x'));
    }
    {
        ctxMap.mx = 30; ctxMap.b = 60;
        const sel = selectStemForThread([free('mx', { trust_tier: MIXED_TRUST_TIER }), free('b')], 'T10', ctxOf, 10, 80, 70);
        check("'mixed' stem never fit-selected (quarantine by construction)", sel?.stemId === 'b');
    }
    {
        const bind = bindTierDecision(undefined, 'family');
        const rebind = bindTierDecision('family', 'family');
        const cross = bindTierDecision('family', 'untrusted');
        check('bindTierDecision: first/same-tier binds with the sticky stamp', bind.action === 'bind' && bind.stamp === 'family' && rebind.action === 'bind' && rebind.stamp === 'family');
        check('bindTierDecision: cross-tier REFUSES (physics at the chokepoint, not a label)', cross.action === 'refuse' && cross.stemTier === 'family');
    }
    {
        // Casey's fold 6 — the single-chokepoint pin: the refusal's coverage is an INVARIANT,
        // not an accident of the call-graph. bindSpoke must have exactly ONE production
        // call-site (after all three checkout doors converge), and bindTierDecision's refusal
        // must guard it (appear before it in the same function). A second bind door added
        // anywhere fails this suite instead of silently growing a hole behind the partition.
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'lib', 'tmux-dispatcher.ts'), 'utf-8');
        const calls = src.match(/\bbindSpoke\(/g)?.length ?? 0; // the import names it WITHOUT a paren, so this counts call-sites exactly
        const importsIt = /import\s*\{[^}]*\bbindSpoke\b[^}]*\}\s*from/.test(src);
        check('bindSpoke has exactly ONE production call-site in the dispatcher', calls === 1 && importsIt, `calls=${calls}`);
        const refusalIdx = src.indexOf('bindTierDecision(stem.trust_tier');
        const bindIdx = src.indexOf('bindSpoke(slug, surface, stem.stem_id');
        check('the refusal GUARDS the chokepoint (decision precedes the bind at the one site)', refusalIdx !== -1 && bindIdx !== -1 && refusalIdx < bindIdx);
        const grepOthers = ['stem-pool.ts'].every(f => {
            const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'lib', f), 'utf-8');
            return (s.match(/\bbindSpoke\(/g)?.length ?? 0) === 1; // the definition itself, no self-calls
        });
        check('no second bind door elsewhere in the pool layer', grepOthers);
    }

    console.log('— pool ops (temp registry) —');
    {
        const spoke = mkStem({ stem_id: 'p1', tmux_session: 'p1', state: 'spoke', conversation_id: 'TC', bound_at: iso(50 * H) });
        upsertStem('suite', 'human-response', spoke);
        decoupleSpoke('suite', 'human-response', 'p1', new Date(NOW).toISOString());
        const row = readPool('suite', 'human-response').stems.find(s => s.stem_id === 'p1')!;
        check('decouple: spoke→free, last_thread kept, ids cleared', row.state === 'free' && row.last_thread === 'TC' && !row.conversation_id && !row.bound_at);
        check('decouple resets the idle clock (no re-fire next tick)', row.last_served_at === new Date(NOW).toISOString());
        decoupleSpoke('suite', 'human-response', 'p1', new Date(NOW).toISOString());
        check('decouple no-ops on a non-spoke', readPool('suite', 'human-response').stems.find(s => s.stem_id === 'p1')!.state === 'free');
    }
    {
        const got = checkoutStemById('suite', 'human-response', 'p1', new Date(NOW).toISOString());
        check('checkoutStemById leases the specific free stem', got?.stem_id === 'p1' && readPool('suite', 'human-response').stems[0].state === 'leased');
        const again = checkoutStemById('suite', 'human-response', 'p1', new Date(NOW).toISOString());
        check('checkoutStemById refuses a non-free stem (race-safe)', again === null);
    }
    {
        bindSpoke('suite', 'human-response', 'p1', 'TC', new Date(NOW).toISOString());
        touchSpokeServed('suite', 'human-response', 'p1', iso(0));
        const row = readPool('suite', 'human-response').stems[0];
        check('touchSpokeServed stamps the clock on the bound spoke', row.last_served_at === iso(0) && row.state === 'spoke');
    }
    {
        // revive-during-sweep shape: decoupled spoke's thread revives → affinity re-binds (never lost)
        decoupleSpoke('suite', 'human-response', 'p1', new Date(NOW).toISOString());
        const pool = readPool('suite', 'human-response');
        ctxMap.p1 = 50;
        const sel = selectStemForThread(pool.stems.filter(s => s.state === 'free'), 'TC', (s) => ctxMap[s.stem_id] ?? null, 20, 80, 70);
        check('revive: decoupled thread re-binds its former spoke via affinity', sel?.stemId === 'p1' && sel.mode === 'affinity');
        check('findSpokeForThread empty after decouple (normal assignment serves the revive)', findSpokeForThread('suite', 'human-response', 'TC') === null);
    }

    console.log('— receipts —');
    {
        const file = path.join(process.env.HAN_HEALTH_DIR!, 'spoke-lifecycle-events.jsonl');
        writeSpokeLifecycleReceipt({ ts: iso(0), slug: 'suite', surface: 'human-response', stem_id: 'p1', tmux_session: 'p1', verb: 'recycle', thread: 'TC', idle_hours: 49, ctx_pct: 50 });
        writeSpokeLifecycleReceipt({ ts: iso(0), slug: 'suite', surface: 'human-response', stem_id: 'p2', tmux_session: 'p2', verb: 'reap', thread: 'TD', idle_hours: 60, ctx_pct: 88 });
        const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
        check('receipts written for both verbs', lines.length === 2 && lines[0].includes('"recycle"') && lines[1].includes('"reap"'));
        fs.writeFileSync(file, 'x'.repeat(1_100_000));
        writeSpokeLifecycleReceipt({ ts: iso(0), slug: 'suite', surface: 'human-response', stem_id: 'p3', tmux_session: 'p3', verb: 'skip-alert', detail: 'rotation probe' });
        check('receipt jsonl rotates at cap', fs.statSync(file).size < 10_000 && fs.existsSync(file + '.1'));
        // Tenshi's hygiene: receipts carry system ids/numbers/fixed strings only — the key set
        // is closed (no free content channel), and JSON.stringify makes newline injection
        // structurally impossible (any content lands escaped inside one JSON line).
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8').trim().split('\n').pop()!);
        const allowed = new Set(['ts', 'slug', 'surface', 'stem_id', 'tmux_session', 'verb', 'thread', 'idle_hours', 'ctx_pct', 'detail']);
        check('receipt key set is closed (schema-only fields, parseable line)', parsed.verb === 'skip-alert' && Object.keys(parsed).every(k => allowed.has(k)));
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
