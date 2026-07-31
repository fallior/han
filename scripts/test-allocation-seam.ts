/**
 * P3 (#98 Dynamic Residence) — proves the allocation/policy seam is a zero-behaviour no-op.
 *
 * The F4 line at the data layer: the four policy accessors (manifestModelHead/Ladder/Transport,
 * runsSupervisorCycle) now read through `allocationFor(slug)` instead of the roster directly. P3
 * derives the allocation from the static seed, so every accessor returns byte-identical data.
 *
 * Asserts:
 *   1. allocationFor(slug) is faithful to the manifest agent (surfaces by-ref, port + cycle match);
 *      unknown slug → undefined.
 *   2. The four accessors return EXACTLY the manifest's values for EVERY agent × EVERY surface
 *      (byte-identical no-op — proven against the source, for all agents, no hardcoded literals).
 *   3. runsSupervisorCycle('jim') === true; every other agent + unknown/undefined === false
 *      (the server.ts bootstrap gate still fires jim-only — no double-fork regression).
 *   4. Unknown slug → accessors fall back exactly as before (null / [] / false).
 *   5. SHARED_SURFACES ('compression') still resolves via the shared branch, untouched by the seam.
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-allocation-seam.ts
 * EXIT 0 iff every assertion holds.
 */
import {
    GARDEN_MANIFEST, allocationFor,
    manifestModelHead, manifestModelLadder, manifestTransport, runsSupervisorCycle,
} from '../src/server/lib/garden-manifest';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';
import { homedir } from 'os';
import { join } from 'path';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; } };
const eqArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log('[1] allocationFor() is faithful to the manifest');
for (const agent of GARDEN_MANIFEST.agents) {
    const alloc = allocationFor(agent.slug);
    ok(!!alloc, `allocationFor('${agent.slug}') is defined`);
    ok(alloc?.surfaces === agent.surfaces, `  '${agent.slug}'.surfaces is the manifest array (by reference — order + identity preserved)`);
    ok(alloc?.port === agent.port, `  '${agent.slug}'.port === manifest port (${agent.port})`);
    ok(alloc?.runsSupervisorCycle === agent.runsSupervisorCycle, `  '${agent.slug}'.runsSupervisorCycle === manifest flag`);
}
ok(allocationFor('nobody') === undefined, `allocationFor('nobody') === undefined (unknown slug)`);

console.log('[1b] R2 (P4b-i): memoryDir is allocation-sourced; gradientConfigForAgent().memoryDir stays the stable accessor (byte-identical)');
const MEM = join(homedir(), '.han', 'memory');
const expectedMemoryDir: Record<string, string> = {
    leo: join(MEM, 'leo'), jim: MEM, tenshi: join(MEM, 'tenshi'), casey: join(MEM, 'casey'),
};
for (const agent of GARDEN_MANIFEST.agents) {
    const exp = expectedMemoryDir[agent.slug];
    ok(allocationFor(agent.slug)?.memoryDir === exp, `  allocationFor('${agent.slug}').memoryDir === ${exp}${agent.slug === 'jim' ? '  (jim root-special, #91)' : ''}`);
    ok(gradientConfigForAgent(agent.slug).memoryDir === exp, `  gradientConfigForAgent('${agent.slug}').memoryDir === allocation memoryDir (stable accessor sources from the allocation)`);
}

console.log('[2] the four accessors are byte-identical to the manifest, for every agent × surface');
for (const agent of GARDEN_MANIFEST.agents) {
    for (const s of agent.surfaces) {
        const head = manifestModelHead(agent.slug, s.name);
        const ladder = manifestModelLadder(agent.slug, s.name);
        const transport = manifestTransport(agent.slug, s.name);
        ok(head === (s.model?.[0] ?? null), `  modelHead('${agent.slug}','${s.name}') === manifest head (${head})`);
        ok(eqArr(ladder, s.model ? [...s.model] : []), `  modelLadder('${agent.slug}','${s.name}') === manifest ladder [${ladder.join(', ')}]`);
        ok(transport === (s.transport ?? null), `  transport('${agent.slug}','${s.name}') === manifest transport (${transport})`);
    }
}

console.log('[3] runsSupervisorCycle: jim-only (the bootstrap gate — no double-fork)');
ok(runsSupervisorCycle('jim') === true, `runsSupervisorCycle('jim') === true`);
for (const agent of GARDEN_MANIFEST.agents.filter(a => a.slug !== 'jim')) {
    ok(runsSupervisorCycle(agent.slug) === false, `runsSupervisorCycle('${agent.slug}') === false`);
}
ok(runsSupervisorCycle('nobody') === false, `runsSupervisorCycle('nobody') === false (unknown slug)`);
ok(runsSupervisorCycle(undefined) === false, `runsSupervisorCycle(undefined) === false`);

console.log('[4] unknown slug → accessors fall back exactly as before');
ok(manifestModelHead('nobody', 'session') === null, `modelHead('nobody', …) === null`);
ok(eqArr(manifestModelLadder('nobody', 'session'), []), `modelLadder('nobody', …) === []`);
ok(manifestTransport('nobody', 'session') === null, `transport('nobody', …) === null`);

console.log('[5] SHARED_SURFACES retired-empty (P3 2026-07-04) — compression resolves PER-AGENT, no shadow');
// The old shared `compression` entry shadowed the per-agent leaves (shared branch resolves
// first) — retired at P3 with runSDK. An unknown slug now falls through to null/[] like any
// other surface; a real agent resolves its own FABLE_LADDER leaf.
ok(manifestModelHead('anyslug', 'compression') === null, `modelHead(unknown, 'compression') === null (no shared shadow)`);
ok(manifestModelHead('jim', 'compression') === 'fable', `modelHead('jim', 'compression') === FABLE head alias (the agent leaf, un-shadowed; DEC-104)`);
ok(manifestModelLadder('jim', 'compression').length > 1, `modelLadder('jim', 'compression') is the full FABLE_LADDER (descent rungs exist)`);

if (failures) { console.error(`\nFAILED: ${failures} assertion(s).`); process.exit(1); }
console.log('\nALL PASS — P3 allocation seam is a zero-behaviour no-op.');
