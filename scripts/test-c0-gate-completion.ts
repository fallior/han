/**
 * #107 Phase-1 (thread mqun1to5) — proves the c0-gate's COMPLETION-not-correctness predicate:
 * `isAgentC0(agent, id)` answers "did a c0 of this agent load" (the gradient finished), NOT
 * "which c0" (correctness is the loading procedure's job). The behavioural change from the prior
 * recency-window: ANY real c0 of the agent satisfies the gate, so a newer-c0-inserted-mid-wake can
 * never false-nudge a fully-loaded spoke. Invariant-based (asserts properties over the live c0 set,
 * not specific ids) so it's robust to gradient growth.
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-c0-gate-completion.ts
 * EXIT 0 iff every assertion holds.
 */
import { isAgentC0, mostRecentC0Id } from '../src/server/lib/memory-gradient';
import { gradientStmts } from '../src/server/db';

let failures = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

function c0Ids(agent: string): string[] {
    return (gradientStmts.getByAgentLevel.all(agent, 'c0') as any[]).map((e) => e.id);
}

async function main() {
    const AGENT = 'leo';
    const leoC0s = c0Ids(AGENT);
    console.log(`[setup] ${AGENT} has ${leoC0s.length} c0(s)`);
    ok(leoC0s.length >= 2, `${AGENT} has ≥2 c0s (so "most-recent vs oldest" is meaningful)`);
    if (leoC0s.length < 2) { console.error('insufficient live data — cannot run the matrix'); process.exit(1); }

    console.log('[1] ANY real c0 of the agent → accepted (completion, not correctness)');
    const most = mostRecentC0Id(AGENT)!;
    const oldest = leoC0s[leoC0s.length - 1]; // getByAgentLevel orders created_at DESC → last = oldest
    ok(isAgentC0(AGENT, most), `most-recent c0 accepted`);
    ok(isAgentC0(AGENT, oldest), `OLDEST c0 accepted — the behavioural change (a recency window would reject it)`);
    ok(leoC0s.every((id) => isAgentC0(AGENT, id)), `EVERY one of the agent's ${leoC0s.length} c0s is accepted`);

    console.log('[2] a non-c0 id → rejected (nudge)');
    ok(!isAgentC0(AGENT, 'not-a-real-c0-id-00000000'), `garbage id rejected`);
    ok(!isAgentC0(AGENT, ''), `empty string rejected`);

    console.log('[3] agent-scoped — one agent\'s c0 is not another\'s');
    // uuid ids don't collide across agents; the most-recent leo c0 must not validate under jim
    ok(!isAgentC0('jim', most), `leo's most-recent c0 is NOT a jim c0 (cross-agent rejected)`);

    console.log('[4] newborn discriminator (F4) — a never-lived resident has no c0');
    ok(mostRecentC0Id('no-such-resident-xyz') === null, `mostRecentC0Id(unknown) === null (→ genesis carve-out, not the c0-gate)`);

    console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
