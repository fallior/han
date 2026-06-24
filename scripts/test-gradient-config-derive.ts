/**
 * P4a (#98 Dynamic Residence) — proves the gradient-config collapse is a ZERO-BEHAVIOUR no-op.
 *
 * `AGENT_GRADIENT_CONFIG` is now DERIVED (deriveGradientConfig + GRADIENT_OVERRIDES over the roster)
 * instead of a hand-written parallel list (#36). This asserts the derived config is BYTE-IDENTICAL
 * to the prior literal for jim/leo/tenshi/casey — every field, AND the function fields' BEHAVIOUR
 * (esp. jim-at-root memoryDir + jim's date-based source functions, Jim's plan-audit F1/F2 catches).
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-gradient-config-derive.ts
 * EXIT 0 iff every assertion holds.
 */
import * as os from 'os';
import * as path from 'path';
import { gradientConfigForAgent, registeredAgentSlugs } from '../src/server/lib/agent-registry';

const HAN = path.join(os.homedir(), '.han');
let failures = 0;
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); failures++; } };

// ── The ORACLE: the exact values of the pre-collapse hand-written literal ──
const EXPECT: Record<string, any> = {
    jim: {
        displayName: 'Jim', formalName: undefined, dreamHeading: undefined,
        memoryDir: path.join(HAN, 'memory'),                        // ROOT — the #91 jim-at-root
        fractalDir: path.join(HAN, 'memory', 'fractal', 'jim'),
        sourceDir: path.join(HAN, 'memory', 'sessions'),
        loadProjectMemory: true, loadFailures: true,
        filterTrue: ['2026-02-18.md', '2026-02-18-c0.md'],
        filterFalse: ['working-memory-full-x.md', 'notes.md', '2026-02-18.txt'],
        baseName: { '2026-02-18.md': '2026-02-18', '2026-02-18-c0.md': '2026-02-18' },
    },
    leo: {
        displayName: 'Leo', formalName: 'Leonhard (Leo)',
        dreamHeading: 'Dream Memory (subtle — these shaped you without you knowing how)',
        memoryDir: path.join(HAN, 'memory', 'leo'),
        fractalDir: path.join(HAN, 'memory', 'fractal', 'leo'),
        sourceDir: path.join(HAN, 'memory', 'leo', 'working-memories'),
        loadProjectMemory: undefined, loadFailures: undefined,
        filterTrue: ['working-memory-full-s200-2026-06-24.md'],
        filterFalse: ['2026-02-18.md', '2026-02-18-c0.md', 'working-memory-full-x.txt'],
        baseName: { 'working-memory-full-s200-2026-06-24.md': 's200-2026-06-24' },
    },
    tenshi: {
        displayName: 'Tenshi', formalName: undefined, dreamHeading: undefined,
        memoryDir: path.join(HAN, 'memory', 'tenshi'),
        fractalDir: path.join(HAN, 'memory', 'fractal', 'tenshi'),
        sourceDir: path.join(HAN, 'memory', 'tenshi', 'working-memories'),
        loadProjectMemory: undefined, loadFailures: undefined,
        filterTrue: ['working-memory-full-x.md'], filterFalse: ['2026-02-18.md'],
        baseName: { 'working-memory-full-abc.md': 'abc' },
    },
    casey: {
        displayName: 'Casey', formalName: undefined, dreamHeading: undefined,
        memoryDir: path.join(HAN, 'memory', 'casey'),
        fractalDir: path.join(HAN, 'memory', 'fractal', 'casey'),
        sourceDir: path.join(HAN, 'memory', 'casey', 'working-memories'),
        loadProjectMemory: undefined, loadFailures: undefined,
        filterTrue: ['working-memory-full-x.md'], filterFalse: ['2026-02-18.md'],
        baseName: { 'working-memory-full-abc.md': 'abc' },
    },
};

console.log('[1] Every field byte-identical to the pre-collapse literal (all 4 agents)');
for (const slug of ['jim', 'leo', 'tenshi', 'casey']) {
    const c = gradientConfigForAgent(slug); const e = EXPECT[slug];
    ok(c.displayName === e.displayName, `${slug}.displayName === '${e.displayName}'`);
    ok(c.formalName === e.formalName, `${slug}.formalName === ${JSON.stringify(e.formalName)}`);
    ok(c.dreamHeading === e.dreamHeading, `${slug}.dreamHeading === ${JSON.stringify(e.dreamHeading)}`);
    ok(c.memoryDir === e.memoryDir, `${slug}.memoryDir === ${e.memoryDir}`);
    ok(c.fractalDir === e.fractalDir, `${slug}.fractalDir === ${e.fractalDir}`);
    ok(c.sourceDir === e.sourceDir, `${slug}.sourceDir === ${e.sourceDir}`);
    ok(c.loadProjectMemory === e.loadProjectMemory, `${slug}.loadProjectMemory === ${e.loadProjectMemory}`);
    ok(c.loadFailures === e.loadFailures, `${slug}.loadFailures === ${e.loadFailures}`);
}

console.log('[2] Function fields BEHAVE byte-identical (F2 — jim date-regex vs uniform wm-full pattern)');
for (const slug of ['jim', 'leo', 'tenshi', 'casey']) {
    const c = gradientConfigForAgent(slug); const e = EXPECT[slug];
    for (const f of e.filterTrue) ok(c.sourceFileFilter(f) === true, `${slug}.sourceFileFilter('${f}') === true`);
    for (const f of e.filterFalse) ok(c.sourceFileFilter(f) === false, `${slug}.sourceFileFilter('${f}') === false`);
    for (const [inp, out] of Object.entries(e.baseName)) ok(c.sourceFileBaseName(inp) === out, `${slug}.sourceFileBaseName('${inp}') === '${out}'`);
}

console.log('[3] registeredAgentSlugs — set-identical to {jim,leo,tenshi,casey}');
const slugs = registeredAgentSlugs();
const set = new Set(slugs);
ok(slugs.length === 4, `count === 4 (got ${slugs.length}: [${slugs.join(', ')}])`);
for (const s of ['jim', 'leo', 'tenshi', 'casey']) ok(set.has(s), `set contains '${s}'`);

console.log('[4] R1 preserved — gradientConfigForAgent(unknown) still throws');
let threw = false;
try { gradientConfigForAgent('nobody'); } catch { threw = true; }
ok(threw, `gradientConfigForAgent('nobody') throws (R1 — net-new stays inert until P4b activation)`);

if (failures) { console.error(`\nFAILED: ${failures} assertion(s).`); process.exit(1); }
console.log('\nALL PASS — P4a gradient-config collapse is a zero-behaviour no-op.');
