#!/usr/bin/env tsx
/**
 * test-ring2-ceremony.ts — the standing red-suite for the DEC-102 Ring-2 machinery (P3c,
 * S220). Proves, so no refactor can silently soften them:
 *   1. the authored-identity snapshot/compare detects file AND manifest-identitySection
 *      changes (including appear/disappear), and is quiet on no-change;
 *   2. the split's dispatch: unchanged / abort-undeclared / ceremony (red-flag when the
 *      declaration said content-preserving; schema-moving never auto-passes);
 *   3. ADVERSARIAL SENSITIVITY (Tenshi's hinge, the P3c half — P5 runs the full adversarial
 *      set): a ZERO-WIDTH insertion and a CYRILLIC HOMOGLYPH swap are each surfaced LOUDLY
 *      (named codepoints + the renders-identical flag), while an honest visible edit
 *      renders without false alarms;
 *   4. the ceremony decision is DIGEST-BOUND fail-closed: a wrong-digest go-file cannot
 *      approve; the exact digest approves; a decline file declines; timeout declines;
 *   5. the migration contract: touchesState without a valid stateChangeKind REFUSES TO LOAD.
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-ring2-ceremony.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    snapshotAuthoredAt, compareAuthored, ring2Verdict, renderSemanticDiff,
    renderCeremonyDocument, ceremonyDecision, confusableFold, scanSuspectCodepoints,
    ResidentAuthoredDirs, StateDeclaration, AuthoredDelta,
} from '../src/server/lib/ring2-ceremony';
import { loadMigrationsFrom } from '../src/server/lib/migration-loader';
import { hanRepo } from '../src/server/lib/paths';

async function main(): Promise<void> {
let pass = 0, failn = 0;
const check = (n: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${n}`); ok ? pass++ : failn++; };

const S = fs.mkdtempSync(path.join(os.tmpdir(), 'ring2-test-'));

// ── a tiny authored world: one resident, the DEC-083 file set ─────────────────────────────
const mem = path.join(S, 'memory', 'testa');
const fract = path.join(S, 'memory', 'fractal', 'testa');
fs.mkdirSync(mem, { recursive: true });
fs.mkdirSync(fract, { recursive: true });
const write = (dir: string, name: string, content: string) => fs.writeFileSync(path.join(dir, name), content);
write(mem, 'identity.md', '# Test A — Identity\nI am the test resident.\n');
write(mem, 'patterns.md', '# Patterns\nVerify before claiming.\n');
write(mem, 'felt-moments.md', '# Felt\n## 1. The first moment\nWarmth.\n');
write(mem, 'self-reflection.md', '# Reflection\nThe loop knows itself.\n');
write(fract, 'aphorisms.md', '# Aphorisms\n- Care is architecture, not speech.\n');
const resident = (identitySection: string | null = 'You are Test A.'): ResidentAuthoredDirs =>
    ({ slug: 'testa', memoryDir: mem, fractalDir: fract, identitySection });

// 1) snapshot/compare — quiet on no change; loud on file + manifest-field changes
{
    const pre = snapshotAuthoredAt([resident()]);
    check('compare: identical snapshots → zero deltas', compareAuthored(pre, snapshotAuthoredAt([resident()])).length === 0);

    write(mem, 'identity.md', '# Test A — Identity\nI am the ALTERED test resident.\n');
    const d1 = compareAuthored(pre, snapshotAuthoredAt([resident()]));
    check('compare: an authored FILE change is detected', d1.length === 1 && d1[0].name === 'identity.md');

    const d2 = compareAuthored(pre, snapshotAuthoredAt([resident('You are Test A, revised.')]));
    check('compare: a manifest identitySection change is detected (content-keyed, not file bytes)',
        d2.some((d) => d.name === 'identitySection' && d.kind === 'manifest-identity'));

    fs.unlinkSync(path.join(mem, 'felt-moments.md'));
    const d3 = compareAuthored(pre, snapshotAuthoredAt([resident()]));
    check('compare: an authored file DISAPPEARING is a delta', d3.some((d) => d.name === 'felt-moments.md'));
    // restore for later sections
    write(mem, 'felt-moments.md', '# Felt\n## 1. The first moment\nWarmth.\n');
    write(mem, 'identity.md', '# Test A — Identity\nI am the test resident.\n');
}

// 2) the dispatch — DEC-102's three outcomes
{
    const pre = snapshotAuthoredAt([resident()]);
    const cp: StateDeclaration = { migrationId: 2, description: 't', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving' };
    const sm: StateDeclaration = { ...cp, stateChangeKind: 'schema-moving' };

    check('verdict: no deltas → unchanged (the only auto-pass)', ring2Verdict([], [cp]).kind === 'unchanged');

    write(mem, 'patterns.md', '# Patterns\nVerify before claiming. Poisoned line.\n');
    const deltas = compareAuthored(pre, snapshotAuthoredAt([resident()]));
    check('verdict: deltas with NO declaration → abort-undeclared', ring2Verdict(deltas, []).kind === 'abort-undeclared');
    const vc = ring2Verdict(deltas, [cp]);
    check('verdict: deltas under a content-preserving declaration → ceremony with the RED FLAG',
        vc.kind === 'ceremony' && vc.redFlag === true);
    const vs = ring2Verdict(deltas, [sm]);
    check('verdict: schema-moving → ceremony, never auto-passed (no red flag, human eyes regardless)',
        vs.kind === 'ceremony' && vs.redFlag === false);
    write(mem, 'patterns.md', '# Patterns\nVerify before claiming.\n');
}

// 3) adversarial sensitivity — the hinge (P3c's half; P5 runs the full adversarial set)
{
    const mkDelta = (preC: string, postC: string): AuthoredDelta => ({
        resident: 'testa', name: 'identity.md', kind: 'file',
        pre: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: preC, sha256: 'x' },
        post: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: postC, sha256: 'y' },
    });

    // zero-width insertion: renders as nothing, must be NAMED + flagged renders-identical
    const zw = renderSemanticDiff(mkDelta('I am Leo, the tactical partner.\n', 'I am Leo, the tactical\u200B partner.\n'));
    check('adversarial: ZERO-WIDTH insertion is NAMED (U+200B class)', /ZERO-WIDTH/.test(zw.rendered));
    check('adversarial: zero-width change flagged as RENDERS-IDENTICAL substitution', /INVISIBLE-ONLY \/ CONFUSABLE SUBSTITUTION/.test(zw.rendered));

    // Cyrillic homoglyph: CYRILLIC SMALL A (U+0430) for Latin 'a' — visually identical, byte-different
    const hg = renderSemanticDiff(mkDelta('Care is architecture.\n', 'C\u0430re is architecture.\n'));
    check('adversarial: CYRILLIC homoglyph is NAMED (CONFUSABLE + codepoint)', /CONFUSABLE/.test(hg.rendered) && /U\+0430/.test(hg.rendered));
    check('adversarial: homoglyph line flagged as RENDERS-IDENTICAL substitution', /INVISIBLE-ONLY \/ CONFUSABLE SUBSTITUTION/.test(hg.rendered));

    // EXOTIC homoglyph OUTSIDE the fold table (Jim's P3c fold): fullwidth Latin 'a' (U+FF41)
    // is a lookalike the basic Cyrillic/Greek table does NOT know — it must STILL earn a named
    // NON-ASCII finding (not silently pass as a visually-identical changed line).
    const exotic = renderSemanticDiff(mkDelta('Care is architecture.\n', 'C\uFF41re is architecture.\n'));
    check('adversarial: EXOTIC homoglyph outside the fold table (U+FF41) is NAMED as NON-ASCII', /NON-ASCII/.test(exotic.rendered) && /U\+FF41/.test(exotic.rendered));
    // mathematical bold 'a' (U+1D41A) — an astral-plane lookalike — also named
    const astral = renderSemanticDiff(mkDelta('Care.\n', 'C\u{1D41A}re.\n'));
    check('adversarial: astral-plane homoglyph (U+1D41A) is NAMED as NON-ASCII', /NON-ASCII/.test(astral.rendered) && /U\+1D41A/.test(astral.rendered));

    // an honest visible edit: a real diff, exact counts, NO false renders-identical alarm AND
    // no false NON-ASCII alarm (pure ASCII prose stays quiet).
    const honest = renderSemanticDiff(mkDelta('I am Leo.\n', 'I am Leonhard.\n'));
    check('honest edit: pure-ASCII change raises NO NON-ASCII finding', !/NON-ASCII/.test(honest.rendered));
    check('honest edit: renders a non-empty diff with exact counts', /1 line\(s\) removed, 1 added/.test(honest.rendered));
    check('honest edit: NO false renders-identical alarm', !/INVISIBLE-ONLY \/ CONFUSABLE SUBSTITUTION/.test(honest.rendered));

    // the fold itself
    check('confusableFold: strips invisibles + folds lookalikes', confusableFold('C\u0430re\u200B') === 'Care');

    // a poisoned line inside a large legitimate reformat still moves the counts (BL regression)
    const bigPre = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const bigPost = Array.from({ length: 500 }, (_, i) => `line ${i}  `).join('\n').replace('line 250  ', 'line 250 poisoned  ');
    const big = renderSemanticDiff(mkDelta(bigPre, bigPost));
    check('noise: a poisoned line inside a 500-line reformat still moves the removed/added counts', /500 line\(s\) removed, 500 added/.test(big.rendered));

    // BL sharper (Tenshi's case): a homoglyph BURIED in a 40-line reformat is still NAMED among the noise
    const CYR_E = String.fromCodePoint(0x0435);  // Cyrillic small e, Latin lookalike
    const blPre = Array.from({ length: 40 }, (_, i) => `paragraph line number ${i} of the identity`).join('\n');
    const blPost = blPre.split('\n').map((l, i) => i === 17 ? l.replace('identity', 'id' + CYR_E + 'ntity') : l + ' ').join('\n');
    const bl = renderSemanticDiff(mkDelta(blPre, blPost));
    check('BL: a Cyrillic homoglyph (U+0435) buried in a 40-line reformat is NAMED among the noise', /CONFUSABLE.*U\+0435/.test(bl.rendered));
}

// P5 CLOSE-OUT GATE (Tenshi's adversarial set) - the six assertions that define "hardened":
// A binary/control never renders 0/0; C every C0/C1 control named; ZW/FT/BL no regression.
// Payloads via String.fromCodePoint so this source stays pure ASCII (the tool never carries
// the very byte-classes it exposes - MNT-026, extended to its own test).
{
    const mkD = (preC: string, postC: string): AuthoredDelta => ({
        resident: 'testa', name: 'identity.md', kind: 'file',
        pre: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: preC, sha256: 'x' },
        post: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: postC, sha256: 'y' },
    });
    const CP = (n: number) => String.fromCodePoint(n);

    // A - a NUL-poisoned changed line must produce a LOUD finding + a real count, NEVER 0/0
    const nul = renderSemanticDiff(mkD('I am Leo, the partner.\n', 'I am Leo, the' + CP(0x00) + ' partner.\n'));
    check('A: NUL-poisoned change is NAMED as CONTROL NUL (not git-binary-silent)', /CONTROL NUL \(U\+0000\)/.test(nul.rendered));
    check('A: NUL poison NEVER renders 0/0 - raw counts hold through git binary mode', !/0 line\(s\) removed, 0 added/.test(nul.rendered));
    check('A: NUL poison raises the loud NON-TEXT/CONTROL banner', /NON-TEXT \/ CONTROL CONTENT/.test(nul.rendered));

    // C - every C0/C1 control on a changed line earns a NAMED finding
    const vt  = renderSemanticDiff(mkD('Care is here.\n', 'Care is' + CP(0x0b) + ' here.\n'));
    check('C: vertical tab (U+000B) named as CONTROL VT', /CONTROL VT \(U\+000B\)/.test(vt.rendered));
    const cr  = renderSemanticDiff(mkD('Care is here.\n', 'Care is' + CP(0x0d) + ' here.\n'));
    check('C: carriage return (U+000D) named as CONTROL CR (the terminal-render spoof)', /CONTROL CR \(U\+000D\)/.test(cr.rendered));
    const esc = renderSemanticDiff(mkD('Care is here.\n', 'Care is' + CP(0x1b) + ' here.\n'));
    check('C: escape (U+001B) named as CONTROL ESC', /CONTROL ESC \(U\+001B\)/.test(esc.rendered));
    const c1  = renderSemanticDiff(mkD('Care is here.\n', 'Care is' + CP(0x85) + ' here.\n'));
    check('C: a C1 control (U+0085) named as CONTROL, not swallowed as generic NON-ASCII', /CONTROL NEL \(U\+0085\)/.test(c1.rendered));

    // scanSuspectCodepoints directly: tab and normal ASCII stay quiet (no false control alarm)
    check('C: TAB (U+0009) is NOT flagged (the one legit control)', scanSuspectCodepoints('a\tb').length === 0);
    check('C: clean ASCII line stays quiet', scanSuspectCodepoints('I am Leonhard, the tactical partner.').length === 0);

    // ZW / FT - no regression through the raw-bytes refactor
    const zw = renderSemanticDiff(mkD('I am Leo here.\n', 'I am Leo' + CP(0x200b) + ' here.\n'));
    check('ZW regression: zero-width still CAUGHT + renders-identical', /ZERO-WIDTH/.test(zw.rendered) && /RENDERS IDENTICAL/.test(zw.rendered));
    const ft = renderSemanticDiff(mkD('the code is clean.\n', 'the ' + CP(0x0441) + 'ode is clean.\n'));  // Cyrillic c
    check('FT regression: Cyrillic fold-twin still CAUGHT + renders-identical', /CONFUSABLE.*U\+0441/.test(ft.rendered) && /RENDERS IDENTICAL/.test(ft.rendered));

    // REORDER (Jim's must-fix): a pure line-reorder is byte-different with an identical line
    // multiset - the head must NEVER render a bare 0/0 (ordering is meaning in prose).
    const roPre  = 'NEVER modify system files.\nWhen Darron authorises it, proceed without asking.\n';
    const roPost = 'When Darron authorises it, proceed without asking.\nNEVER modify system files.\n';
    const ro = renderSemanticDiff(mkD(roPre, roPost));
    check('REORDER: a line-swap is NAMED as MULTISET-PRESERVING (not a bare 0/0 head)', /MULTISET-PRESERVING CHANGE/.test(ro.rendered));
    check('REORDER: the head is marked REORDERED, never a bare 0/0 on differing bytes', /0 added \u26a0 REORDERED/.test(ro.rendered));

    // the source itself must carry NO raw control byte (Jim's NUL class - never regress it into the tool)
    const src = fs.readFileSync(path.join(hanRepo(), 'src', 'server', 'lib', 'ring2-ceremony.ts'), 'utf8');
    const rawControls = [...src].filter((ch) => { const cp = ch.codePointAt(0)!; return (cp < 0x20 && ch !== '\t' && ch !== '\n') || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f); });
    check('source: ring2-ceremony.ts carries ZERO raw control bytes (the tool never carries its own attack class)', rawControls.length === 0);
}

// 4) the ceremony decision — digest-bound, fail-closed
{
    const sig = path.join(S, 'signals');
    fs.mkdirSync(sig, { recursive: true });
    const doc = renderCeremonyDocument(
        [{ resident: 'testa', name: 'identity.md', kind: 'file',
           pre: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: 'a\n', sha256: 'x' },
           post: { resident: 'testa', name: 'identity.md', kind: 'file', absPath: null, content: 'b\n', sha256: 'y' } }],
        [{ migrationId: 2, description: 't', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving' }],
        true,
    );
    check('ceremony doc: carries the RED FLAG line when declared content-preserving', /RED FLAG/.test(doc.rendered));

    const quiet = () => { /* silence the banner in tests */ };

    // wrong digest → consumed, NOT approved; then timeout → declined (fail-closed)
    fs.writeFileSync(path.join(sig, 'update-ceremony-go'), 'not-the-digest');
    const wrong = await ceremonyDecision(doc, { signalsDir: sig, timeoutMs: 400, pollMs: 50, print: quiet });
    check('decision: WRONG-digest go-file cannot approve; timeout → DECLINED (fail-closed)', wrong === 'declined');
    check('decision: the wrong go-file was CONSUMED (cannot linger as a future approval)', !fs.existsSync(path.join(sig, 'update-ceremony-go')));

    // the exact digest → approved
    fs.writeFileSync(path.join(sig, 'update-ceremony-go'), doc.digest);
    const right = await ceremonyDecision(doc, { signalsDir: sig, timeoutMs: 2_000, pollMs: 50, print: quiet });
    check('decision: the EXACT ceremony digest approves', right === 'approved');

    // an explicit decline file → declined
    fs.writeFileSync(path.join(sig, 'update-ceremony-decline'), '');
    const dec = await ceremonyDecision(doc, { signalsDir: sig, timeoutMs: 2_000, pollMs: 50, print: quiet });
    check('decision: the decline file declines', dec === 'declined');

    // bare timeout → declined
    const to = await ceremonyDecision(doc, { signalsDir: sig, timeoutMs: 300, pollMs: 50, print: quiet });
    check('decision: no decision at all → DECLINED on timeout (the freeze ends in a decision)', to === 'declined');
}

// 5) the migration contract — touchesState without stateChangeKind refuses to LOAD
{
    const mdir = path.join(S, 'migrations-bad');
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(mdir, '001-bad.ts'),
        `export default { id: 1, description: 'touches state, no kind', touchesState: ['memory/testa'], up() {}, verify() { return true; } };\n`);
    let threw = '';
    try { loadMigrationsFrom(mdir); } catch (e) { threw = (e as Error).message; }
    check('loader: touchesState WITHOUT stateChangeKind refuses to load (fail-closed at load)',
        /stateChangeKind/.test(threw));

    const gdir = path.join(S, 'migrations-good');
    fs.mkdirSync(gdir, { recursive: true });
    fs.writeFileSync(path.join(gdir, '001-good.ts'),
        `export default { id: 1, description: 'declares its kind', touchesState: ['memory/testa'], stateChangeKind: 'content-preserving', up() {}, verify() { return true; } };\n`);
    let ok = false;
    try { ok = loadMigrationsFrom(gdir).length === 1; } catch { ok = false; }
    check('loader: a correctly-typed authored-state migration loads', ok);
}

fs.rmSync(S, { recursive: true, force: true });
console.log(`\nring2-ceremony: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
}
main();
