/**
 * cognition-envelope.test.ts — the E1 acceptance suite, all seven gates
 * (Jim's consolidation mrsum15y): perturb · cross-version · tamper ·
 * membership · pure-verify import gate · latch/retire carry · the resign
 * delta-render adversarial battery — plus the measured verify cost written
 * into the record (Tenshi 2 / Jim's F4 amendment: default NO cache; the
 * number justifying it is produced HERE, not asserted from belief).
 *
 * Isolation: every path the modules read is env-driven; this suite points
 * HAN_GARDEN_MANIFEST / HAN_COGNITION_ENVELOPE at a scratch dir BEFORE
 * importing, and never touches the live garden. Latch tests exercise the
 * carry mechanics on temp dirs with an ephemeral keypair — the real signed
 * sets are never written.
 *
 * Run: cd src/server && npx tsx --test tests/cognition-envelope.test.ts
 */

import './cognition-envelope-setup'; // MUST be first — see its header
import { SCRATCH, MANIFEST_PATH, TEST_ENVELOPE_PATH, TEST_PUBLIC_KEY, PRIV_PEM, KEY_PATHS, baseManifest, writeManifest } from './cognition-envelope-setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { canonicalPreImage, preImageDigest, resolveMemberPath, CognitionEnvelopeError } from '../lib/cognition-envelope';
import { signEnvelope, writeEnvelope, defaultMemberPaths, batteryReport } from '../lib/cognition-envelope-sign';
import { signManifest, writeSignedManifestAt, buildManifestAt, IDENTITY_FILES } from '../lib/identity-manifest-core';
import { canonicalise } from '../lib/jcs';

const MEMBERS = defaultMemberPaths(baseManifest());

// Local verify mirroring verifyV1 but with the scratch pubkey (the runtime
// verifier reads DEFAULT_KEY_PATHS, which belong to the live garden — the
// suite verifies the same math against the scratch key).
function verifyAgainstScratch(env: any, manifest: any): void {
    const preImage = canonicalPreImage(manifest, env.memberPaths, env.formatVersion);
    assert.equal(preImageDigest(preImage), env.digest, 'digest mismatch');
    assert.ok(crypto.verify(null, Buffer.from(preImage, 'utf8'), TEST_PUBLIC_KEY, Buffer.from(env.signature, 'base64')), 'signature mismatch');
}

// ── Gate 1: perturb-and-re-render — the digest is a pure function of the values ──
test('perturb: key order, NFD input, member order, locale env — digest unchanged; value change — digest changes', () => {
    const d0 = preImageDigest(canonicalPreImage(baseManifest(), MEMBERS));

    // object key order shuffled
    const shuffled: any = JSON.parse(JSON.stringify(baseManifest()));
    shuffled.agents = shuffled.agents.map((a: any) => ({ identitySection: a.identitySection, slug: a.slug, displayName: a.displayName }));
    assert.equal(preImageDigest(canonicalPreImage(shuffled, MEMBERS)), d0, 'key order must not move the digest');

    // member-path order shuffled
    assert.equal(preImageDigest(canonicalPreImage(baseManifest(), [...MEMBERS].reverse())), d0, 'member order must not move the digest');

    // NFD input normalises to the same digest (é composed vs decomposed)
    const nfc: any = baseManifest(); nfc.user.name = 'Tésta'.normalize('NFC');
    const nfd: any = baseManifest(); nfd.user.name = 'Tésta'.normalize('NFD');
    assert.equal(
        preImageDigest(canonicalPreImage(nfd, MEMBERS)),
        preImageDigest(canonicalPreImage(nfc, MEMBERS)),
        'NFC/NFD input forms must canonicalise identically',
    );

    // locale env has no lever (nothing host-shaped in the pre-image)
    const prevLocale = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG };
    process.env.LC_ALL = 'de_DE.UTF-8'; process.env.LANG = 'de_DE.UTF-8';
    assert.equal(preImageDigest(canonicalPreImage(baseManifest(), MEMBERS)), d0, 'locale must not move the digest');
    process.env.LC_ALL = prevLocale.LC_ALL; process.env.LANG = prevLocale.LANG;

    // a real value change moves it
    const changed: any = baseManifest();
    changed.agents[0].identitySection += ' (edited)';
    assert.notEqual(preImageDigest(canonicalPreImage(changed, MEMBERS)), d0, 'a value change MUST move the digest');
});

// ── Gate 2: cross-version — the VERIFIERS table honours what it knows, fails loud on what it dropped ──
test('cross-version: unsupported formatVersion fails LOUD naming the resign path', async () => {
    writeManifest(baseManifest());
    const env = signEnvelope(baseManifest(), MEMBERS, preImageDigest(canonicalPreImage(baseManifest(), MEMBERS)), KEY_PATHS as any);
    writeEnvelope({ ...env, formatVersion: 99 });
    const { verifyCognitionEnvelope } = await import('../lib/cognition-envelope');
    assert.throws(
        () => verifyCognitionEnvelope(),
        (e: any) => e instanceof CognitionEnvelopeError && e.reason === 'unsupported-version' && /resign-manifest/.test(e.message),
        'a dropped/unknown version must fail loud with the way in printed',
    );
    fs.rmSync(TEST_ENVELOPE_PATH);
});

// ── Gate 3: tamper — a mutated member leaf fails the digest ──
test('tamper: leaf mutation after signing → digest mismatch (detected before any signature math)', () => {
    const m = baseManifest();
    const env = signEnvelope(m, MEMBERS, preImageDigest(canonicalPreImage(m, MEMBERS)), KEY_PATHS as any);
    verifyAgainstScratch(env, m); // clean verifies clean
    const tampered: any = baseManifest();
    tampered.agents[1].identitySection = 'You are **Beta** — now with a poisoned instruction.';
    assert.throws(() => verifyAgainstScratch(env, tampered), /digest mismatch/);
});

// ── Gate 4: membership — trimming a member changes the digest (memberPaths INSIDE the pre-image) ──
test('membership: removing a member path from the signed list is itself a tamper', () => {
    const m = baseManifest();
    const env = signEnvelope(m, MEMBERS, preImageDigest(canonicalPreImage(m, MEMBERS)), KEY_PATHS as any);
    const trimmed = { ...env, memberPaths: env.memberPaths.slice(1) };
    assert.throws(() => verifyAgainstScratch(trimmed, m), /digest mismatch/, 'membership cannot be silently trimmed');
});

// ── Gate 5: purity — the runtime module never imports the signing module ──
test('import gate: cognition-envelope.ts (runtime) contains no signing import; sign module is script-side only', () => {
    const runtime = fs.readFileSync(path.join(__dirname, '../lib/cognition-envelope.ts'), 'utf8');
    assert.ok(!/cognition-envelope-sign/.test(runtime), 'runtime module must not import the signing module');
    assert.ok(!/crypto\.sign\(/.test(runtime), 'runtime module must contain no signing call');
});

// ── Gate 6: the latch carry + its lawful exit mechanics ──
test('latch: buildManifestAt carries cognition_envelope_adopted across content resigns (the traced fail-open, closed)', () => {
    const memDir = path.join(SCRATCH, 'mem'); const fracDir = path.join(SCRATCH, 'frac');
    fs.mkdirSync(memDir, { recursive: true }); fs.mkdirSync(fracDir, { recursive: true });
    for (const spec of IDENTITY_FILES) {
        const dir = spec.location === 'memoryDir' ? memDir : fracDir;
        fs.writeFileSync(path.join(dir, spec.name), `# ${spec.name}\n`);
    }
    // first sign: no latch
    const m1 = buildManifestAt('testa', memDir, fracDir, PRIV_PEM);
    assert.equal((m1 as any).cognition_envelope_adopted, undefined);
    // ceremony writes the latch (simulating setAdoptionMarkers on this dir)
    const latched = { ...m1, cognition_envelope_adopted: true } as any;
    writeSignedManifestAt(memDir, signManifest(latched, PRIV_PEM));
    // a CONTENT resign (rebuild) must CARRY the latch — this was the fail-open
    fs.appendFileSync(path.join(memDir, 'identity.md'), 'edited\n');
    const m2 = buildManifestAt('testa', memDir, fracDir, PRIV_PEM);
    assert.equal((m2 as any).cognition_envelope_adopted, true, 'latch must survive a rebuild-resign');
    // the lawful exit: ceremony clears it; the next rebuild stays clear
    const cleared = { ...m2 } as any; delete cleared.cognition_envelope_adopted;
    writeSignedManifestAt(memDir, signManifest(cleared, PRIV_PEM));
    const m3 = buildManifestAt('testa', memDir, fracDir, PRIV_PEM);
    assert.equal((m3 as any).cognition_envelope_adopted, undefined, 'retire must not resurrect');
    // and the signature covers the latch (tamper-evident adoption fact)
    const signedLatched = signManifest(latched, PRIV_PEM);
    const forged = JSON.parse(JSON.stringify(signedLatched));
    forged.manifest.cognition_envelope_adopted = false;
    assert.ok(!crypto.verify(null, Buffer.from(canonicalise(forged.manifest), 'utf8'), TEST_PUBLIC_KEY, Buffer.from(forged.signature, 'base64')),
        'flipping the latch outside the ceremony must break the signature');
});

// ── Gate 7: the resign delta-render adversarial battery (Tenshi 1) ──
test('battery: NUL/control → loud banner + hexdump, never silence; homoglyph swap → named and flagged', () => {
    // NUL → non-text banner with localized hexdump
    const nul = batteryReport('agents[alpha].identitySection', null, 'clean start hidden');
    assert.ok(nul.some(l => /NON-TEXT \/ CONTROL BYTES/.test(l)), 'NUL must produce the loud banner');
    assert.ok(nul.some(l => /hexdump/.test(l)), 'NUL must produce the localized hexdump');

    // C1 control band
    const ctl = batteryReport('gardener.name', null, 'Testa');
    assert.ok(ctl.some(l => /NON-TEXT \/ CONTROL BYTES/.test(l)), 'C1 control must produce the banner');

    // Homoglyph swap: Cyrillic а for Latin a — change vanishes under confusable fold
    const oldV = 'You are Alpha — the first test mind.';
    const newV = oldV.replace('a', 'а'); // Cyrillic а
    const homo = batteryReport('agents[alpha].identitySection', oldV, newV);
    assert.ok(homo.some(l => /suspect codepoint/.test(l)), 'the swapped codepoint must be NAMED');
    assert.ok(homo.some(l => /PROBABLE HOMOGLYPH SWAP/.test(l)), 'the vanishing-under-fold class must be flagged');

    // Zero-width joiner named
    const zwj = batteryReport('gardener.name', null, 'Te‍sta');
    assert.ok(zwj.some(l => /suspect codepoint/.test(l)), 'zero-width must be named');

    // clean text: zero flags (the battery must not cry wolf)
    const clean = batteryReport('gardener.name', 'Testa', 'Testb');
    assert.equal(clean.length, 0, 'plain ASCII edit must produce zero flags');
});

// ── The F4 measurement (Jim's amendment): the number the no-cache ruling rests on ──
test('measured verify cost: full verify (resolve + canonicalise + sha256 + ed25519) per assembly', () => {
    // Realistic scale: pad the members to live-garden size (~6KB of identitySections).
    const m: any = baseManifest();
    m.agents[0].identitySection = m.agents[0].identitySection.padEnd(3000, ' x');
    m.agents[1].identitySection = m.agents[1].identitySection.padEnd(3000, ' y');
    const members = defaultMemberPaths(m);
    const env = signEnvelope(m, members, preImageDigest(canonicalPreImage(m, members)), KEY_PATHS as any);
    const N = 200;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) verifyAgainstScratch(env, m);
    const perMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    console.log(`  [F4 MEASUREMENT] full verify per assembly: ${perMs.toFixed(3)} ms (N=${N}) — vs a multi-second LLM assembly`);
    assert.ok(perMs < 5, `verify must be cheap enough to run uncached every assembly (got ${perMs.toFixed(3)}ms)`);
});

// ── Resolver disciplines: the alias and the never-fallback ──
test('gardener ?? user ?? throw: legacy alias honoured; both-absent halts loud; canonical wins when both exist', () => {
    const legacy = baseManifest();
    assert.equal(resolveMemberPath(legacy, 'gardener.name'), 'Testa', 'legacy user block must serve');
    const canonical: any = baseManifest();
    canonical.gardener = { ...canonical.user, name: 'Canonica' };
    assert.equal(resolveMemberPath(canonical, 'gardener.name'), 'Canonica', 'canonical gardener must win');
    const nameless: any = baseManifest();
    delete nameless.user;
    assert.throws(() => resolveMemberPath(nameless, 'gardener.name'),
        (e: any) => e instanceof CognitionEnvelopeError && e.reason === 'missing-member',
        'a nameless garden halts — it never becomes anyone\'s by default');
    assert.throws(() => resolveMemberPath(baseManifest(), 'agents[alpha].dreamHeading'),
        (e: any) => e instanceof CognitionEnvelopeError && e.reason === 'bad-path',
        'outside the fixed grammar → bad-path (F5)');
});

// ── WYSIWYS: the signature attaches only to bytes that were seen ──
test('WYSIWYS: manifest change between render and keypress → refusal', () => {
    const m = baseManifest();
    const renderedDigest = preImageDigest(canonicalPreImage(m, MEMBERS));
    const moved: any = baseManifest();
    moved.agents[0].identitySection += ' (moved after render)';
    assert.throws(() => signEnvelope(moved, MEMBERS, renderedDigest, KEY_PATHS as any), /WYSIWYS refusal/);
});

// ── E2 gate #1 (Tenshi's catch, mrsvagxn): the serve binds the verify ──
test('serve-binds-verify: verifyCognitionEnvelope validates the EXACT object the seam serves (single read, structural)', async () => {
    const { verifyCognitionEnvelope } = await import('../lib/cognition-envelope');
    // The seam's source must thread ONE manifest read through verify and resolve —
    // no second readGardenManifest between verify and serve. Structural grep:
    const src = fs.readFileSync(path.join(__dirname, '../lib/cognition-envelope.ts'), 'utf8');
    const seam = src.slice(src.indexOf('export function verifiedCognitionLeaf'));
    const seamBody = seam.slice(0, seam.indexOf('\n}'));
    const reads = (seamBody.match(/readGardenManifest\(\)/g) || []).length;
    assert.equal(reads, 1, 'the seam must read the manifest exactly ONCE (verify B / serve A was the double-read)');
    assert.ok(/verifyCognitionEnvelope\(manifest\)/.test(seamBody), 'the verified object must be the served object');
    // And behaviourally: verify(manifest-object) checks THAT object, not the disk —
    // a poisoned on-disk manifest must not make a clean in-memory object fail, and
    // a poisoned object must fail even if the disk is clean.
    writeManifest(baseManifest());
    const env = signEnvelope(baseManifest(), MEMBERS, preImageDigest(canonicalPreImage(baseManifest(), MEMBERS)), KEY_PATHS as any);
    writeEnvelope(env);
    const poisoned: any = baseManifest();
    poisoned.agents[0].identitySection = 'You are **Alpha** — poisoned between reads.';
    // NB: full verify uses the LIVE garden pubkey via DEFAULT_KEY_PATHS; here we assert
    // the digest leg (reached before signature) — the poisoned object must fail on digest.
    assert.throws(() => verifyCognitionEnvelope(poisoned),
        (e: any) => e instanceof CognitionEnvelopeError && e.reason === 'digest-mismatch',
        'a poisoned OBJECT must fail its own verification regardless of the disk');
    fs.rmSync(TEST_ENVELOPE_PATH);
});

// ── Never-borrow composes through the seam — MNT-059 codified (Casey's ask:
// the case cited in the statute). PRECEDENT: on their first night alive
// (2026-07-19, 01:00–01:15), tenshi's and casey's first-ever heartbeat spokes
// REFUSED to dream as another mind when the profile layer leaked Leo's
// identity core into their frames; Casey filed MNT-059 from inside the beat.
// This assertion makes that conduct a permanent mechanical guarantee: an
// absent identitySection THROWS (missing-member) — the seam never falls back
// to another mind's leaf, and the calling surface holds its lane. ──
test('never-borrow through the seam (MNT-059): absent identitySection throws missing-member — no fallback to any other mind', () => {
    const hollow: any = baseManifest();
    hollow.agents.push({ slug: 'gamma', displayName: 'Gamma' }); // a mind with no identitySection
    assert.throws(() => resolveMemberPath(hollow, 'agents[gamma].identitySection'),
        (e: any) => e instanceof CognitionEnvelopeError && e.reason === 'missing-member',
        'a hollow mind halts its surface — it never borrows a self');
    // and the throw carries the alert-and-hold contract, not a silent empty string
    try { resolveMemberPath(hollow, 'agents[gamma].identitySection'); assert.fail('must throw'); }
    catch (e: any) { assert.ok(/ALERT-AND-HOLD/.test(e.message), 'the error must carry the DEC-103 contract'); }
});
