#!/usr/bin/env npx tsx
/**
 * cognition-envelope-rehearsal.ts — the Ring-2 PRE-INIT rehearsal (Tenshi's E2
 * item 1, Casey/Jim ratified: prove the fail-closed net catches on a THROWAWAY
 * garden BEFORE the real `--init` throws the latch live).
 *
 * Env-driven + HAN_ENVELOPE_ASSUME_ADOPTED=1 (the FAIL-CLOSED-ONLY override —
 * it can only ADD enforcement, never remove it). Run against a scratch copy:
 *   SCRATCH=/tmp/reh; mkdir -p $SCRATCH; cp ~/.han/garden-manifest.json $SCRATCH/
 *   # sign a scratch envelope via resign-manifest with the scratch env paths, then:
 *   HAN_GARDEN_MANIFEST=$SCRATCH/garden-manifest.json \
 *   HAN_COGNITION_ENVELOPE=$SCRATCH/envelope.json \
 *   HAN_ENVELOPE_ASSUME_ADOPTED=1 npx tsx tests/cognition-envelope-rehearsal.ts
 *
 * NEVER point the env at ~/.han — the tamper writes would dirty the live manifest.
 */
import fs from 'node:fs';
import { verifiedCognitionLeaf, CognitionEnvelopeError } from '../lib/cognition-envelope';

const MAN = process.env.HAN_GARDEN_MANIFEST || '';
if (!MAN || MAN.includes('/.han/')) { console.error('refusing to rehearse against the live garden — point HAN_GARDEN_MANIFEST at a scratch copy'); process.exit(2); }

const slug = JSON.parse(fs.readFileSync(MAN, 'utf8')).agents[0].slug;
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✖', m); } };

try { ok(verifiedCognitionLeaf(`agents[${slug}].identitySection`).length > 0, 'clean garden serves the leaf'); }
catch (e: any) { ok(false, 'clean serve threw: ' + e.message.split('\n')[0]); }

const m = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const orig = m.agents[0].identitySection;
m.agents[0].identitySection = orig + ' POISON';
fs.writeFileSync(MAN, JSON.stringify(m, null, 2));
let e: any = null; try { verifiedCognitionLeaf(`agents[${slug}].identitySection`); } catch (x) { e = x; }
ok(e instanceof CognitionEnvelopeError && e.reason === 'digest-mismatch', 'PATH1 tamper → digest-mismatch throw');
ok(/ALERT-AND-HOLD/.test(e?.message || ''), 'PATH1 error carries the alert-and-hold contract (all 3 surfaces map it)');
ok(/resign-manifest/.test(e?.message || ''), 'PATH1 the way-in is printed on the error');
m.agents[0].identitySection = orig; fs.writeFileSync(MAN, JSON.stringify(m, null, 2));

const env = process.env.HAN_COGNITION_ENVELOPE!;
const bak = fs.readFileSync(env); fs.rmSync(env);
let e2: any = null; try { verifiedCognitionLeaf('gardener.name'); } catch (x) { e2 = x; }
ok(e2 instanceof CognitionEnvelopeError && e2.reason === 'missing-envelope', 'PATH2 deleted sidecar → fails closed');
fs.writeFileSync(env, bak);

m.agents[0].identitySection = orig + ' X'; fs.writeFileSync(MAN, JSON.stringify(m, null, 2));
let e3name = ''; try { verifiedCognitionLeaf('gardener.name'); } catch (x: any) { e3name = x.name; }
ok(e3name === 'CognitionEnvelopeError', 'PATH3 err.name matches the driver hold → beat holds lane, one alert, no storm');
m.agents[0].identitySection = orig; fs.writeFileSync(MAN, JSON.stringify(m, null, 2));

console.log(`\nREHEARSAL: ${pass} pass ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
