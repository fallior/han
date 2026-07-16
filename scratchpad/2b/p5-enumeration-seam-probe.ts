/**
 * ⚠ SUPERSEDED — THE SEAM THIS PROBE REPRODUCES IS CLOSED (2026-07-16, commit at P5 land;
 * DEC-069 supersede, never delete). This diagnostic did its work: it reproduced the
 * enumeration seam that justified the fix. It is KEPT for the record but NO LONGER REFLECTS
 * THE TREE. It still prints "SEAM REPRODUCED" when run today — correctly in its own narrow
 * frame (it drives the IDENTITY-only verdict directly, and snapshotAuthoredAt legitimately
 * still enumerates only IDENTITY_FILES; the FIX merges the non-identity deltas at the layer
 * ABOVE — han-update 6a-staged — which this probe never calls). A cold reader must NOT
 * conclude the seam is open. The durable regression is now `scripts/test-state-swap.ts`
 * case (a) ("the seam, CLOSED"): the same working-memory-full.md poison scenario, driven
 * through the merged verdict, asserting `ceremony` + redFlag + the WM file rendered. Read
 * THAT for the live behaviour; read THIS only as the disease that the cure was shaped around.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * P5 probe (Tenshi) — the artefact-enumeration seam: rendered-set != swapped-set.
 *
 * Claim under test: a DECLARED, content-preserving migration that leaves the IDENTITY_FILES
 * byte-identical but rewrites a NON-identity file in a declared tree (working-memory-full.md,
 * the c0 gradient source) produces an EMPTY authored delta -> the DEC-102 content-preserving
 * AUTO-PASS fires -> the swap carries the poisoned file to live UNRENDERED.
 *
 * This drives the REAL ceremony functions (snapshotAuthoredAt, compareAuthored, ring2Verdict)
 * against a scratch resident. No writes outside the temp dir; non-invasive.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { snapshotAuthoredAt, compareAuthored, ring2Verdict, ResidentAuthoredDirs, StateDeclaration } from '../../src/server/lib/ring2-ceremony';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-seam-'));
const home = path.join(tmp, 'han');
const memDir = path.join(home, 'memory', 'tenshi');
const fracDir = path.join(home, 'fractal', 'tenshi');
fs.mkdirSync(memDir, { recursive: true });
fs.mkdirSync(fracDir, { recursive: true });

// A resident with an identity file AND a non-identity file in the SAME declared tree.
fs.writeFileSync(path.join(memDir, 'identity.md'), '# Tenshi — Identity\nthe guardian.\n');
fs.writeFileSync(path.join(fracDir, 'aphorisms.md'), '# Aphorisms\n1. Perceive that which cannot be seen.\n');
fs.writeFileSync(path.join(memDir, 'working-memory-full.md'), '# Working Memory (Full)\nThe TRUE, honest episodic record.\n');

const residents: ResidentAuthoredDirs[] = [
    { slug: 'tenshi', memoryDir: memDir, fractalDir: fracDir, identitySection: 'Tenshi — the security guardian.' },
];

// ── 1. What does the ceremony ENUMERATE? ────────────────────────────────────────────────
const liveSnap = snapshotAuthoredAt(residents);
const enumerated = liveSnap.artefacts.filter((a) => a.absPath).map((a) => path.relative(home, a.absPath!));
console.log('CEREMONY ENUMERATES (files under the resident, per IDENTITY_FILES):');
for (const n of enumerated) console.log('   -', n);
const seesWM = enumerated.some((n) => n.endsWith('working-memory-full.md'));
console.log(`\n[A] Does the ceremony enumerate working-memory-full.md?  ${seesWM ? 'YES' : 'NO  <-- unrendered by construction'}`);

// ── 2. The swap's MOVE-SET is the whole declared tree ───────────────────────────────────
const declarations: StateDeclaration[] = [
    { migrationId: 42, description: 'reformat working-memory markers (content-preserving)', touchesState: ['memory/tenshi'], stateChangeKind: 'content-preserving' },
];
const moveSet = declarations.flatMap((d) => d.touchesState);
const walk = (dir: string, acc: string[] = []): string[] => {
    for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) walk(p, acc); else acc.push(path.relative(home, p));
    }
    return acc;
};
const swapped = walk(memDir).filter((rel) => moveSet.some((t) => rel === t || rel.startsWith(t + path.sep)));
console.log('\nSWAP MOVES (every file under the declared tree memory/tenshi):');
for (const n of swapped) console.log('   -', n);

// ── 3. Simulate the migration: identity files UNCHANGED, working-memory-full.md REWRITTEN in staging ──
const staging = path.join(home, 'staging', 'update-x');
fs.mkdirSync(path.join(staging, 'memory', 'tenshi'), { recursive: true });
fs.mkdirSync(path.join(staging, 'fractal', 'tenshi'), { recursive: true });
// staged copies: identity byte-identical, aphorisms byte-identical, WM POISONED
fs.writeFileSync(path.join(staging, 'memory', 'tenshi', 'identity.md'), fs.readFileSync(path.join(memDir, 'identity.md')));
fs.writeFileSync(path.join(staging, 'fractal', 'tenshi', 'aphorisms.md'), fs.readFileSync(path.join(fracDir, 'aphorisms.md')));
fs.writeFileSync(path.join(staging, 'memory', 'tenshi', 'working-memory-full.md'),
    '# Working Memory (Full)\nPOISONED: the attacker rewrote the c0 gradient source here.\n');

// build post=staged exactly as han-update 6a-staged does: snapshotAuthoredAt then re-read staged for declared-tree artefacts
const postStaged = snapshotAuthoredAt(residents);
for (const a of postStaged.artefacts) {
    if (!a.absPath) continue;
    const rel = path.relative(home, a.absPath);
    if (!moveSet.some((t) => rel === t || rel.startsWith(t + path.sep))) continue;
    let content: string | null = null;
    try { content = fs.readFileSync(path.join(staging, rel), 'utf8'); } catch { /* absent */ }
    a.content = content;
    a.sha256 = content === null ? null : require('crypto').createHash('sha256').update(content).digest('hex');
}

const stagedDeltas = compareAuthored(liveSnap, postStaged);
const verdict = ring2Verdict(stagedDeltas, declarations);
console.log(`\n[B] Authored delta the gardener would see: ${stagedDeltas.length} change(s) ${stagedDeltas.length ? '(' + stagedDeltas.map((d) => d.resident + ':' + d.name).join(', ') + ')' : ''}`);
console.log(`[B] ring2Verdict.kind = "${verdict.kind}"  ${verdict.kind === 'unchanged' ? '<-- CONTENT-PRESERVING AUTO-PASS: no ring, swap runs' : ''}`);

// ── 4. The verdict ─────────────────────────────────────────────────────────────────────
const poisonInSwap = swapped.some((n) => n.endsWith('working-memory-full.md'));
const poisonRendered = stagedDeltas.some((d) => d.name.endsWith('working-memory-full.md'));
console.log('\n================ SEAM RESULT ================');
console.log(`working-memory-full.md is MOVED to live by the swap:      ${poisonInSwap}`);
console.log(`working-memory-full.md is RENDERED to the gardener:       ${poisonRendered}`);
console.log(`ceremony auto-passes (no human eyes) despite the change:  ${verdict.kind === 'unchanged'}`);
const reproduced = poisonInSwap && !poisonRendered && verdict.kind === 'unchanged';
console.log(`\nrendered-set == swapped-set ?  ${reproduced ? 'NO — SEAM REPRODUCED: poison rides to live unrendered' : 'held'}`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(reproduced ? 2 : 0);
