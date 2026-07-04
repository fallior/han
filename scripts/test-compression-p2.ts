/**
 * test-compression-p2.ts — P2: the transport flip (flag-off build).
 * Provable offline: the compression-txn profile (memory SUPPRESSED — the warm spoke owns the
 * self; the txn owns the task) + compose-critical text shared verbatim with the SDK shape +
 * the submit_compression completion contract. Structural: the transport gate + the byte-intact
 * SDK rollback path. The live round-trip = Jim's P2 gates on jim's cascade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../src/server/lib/prompt-builder';
import { surfaceEnabledFor } from '../src/server/lib/garden-manifest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

const ctx = { fromLevel: 'c2', toLevel: 'c3', sourceTokens: 300, targetTokens: 100,
    sourceSessionLabel: 'test-session', sourceContentType: 'session', sourceContent: 'SYNTH-MARKER' };
const txn = buildPrompt('leo', 'compression-txn', ctx);
const sdk = buildPrompt('leo', 'compression', ctx);

console.log('P2 transport flip (flag-off):');
check('txn: memory fully SUPPRESSED (the spoke owns the self)', txn.meta.memory_chars === 0);
check('txn: the compose instruction verbatim (shared with the SDK shape)', txn.systemPrompt.includes('The compression is an act of identity, not summary.'));
check('txn: the INCOMPRESSIBLE contract verbatim', txn.systemPrompt.includes('This is not failure. This is arrival.'));
check('txn: the submit_compression completion contract', txn.systemPrompt.includes('mcp__han-diary__submit_compression') && txn.systemPrompt.includes('EXACTLY ONCE'));
check('txn: FEELING_TAG routed to the tool field', txn.systemPrompt.includes("feeling_tag field"));
check('txn: the task scaffold identical to the SDK shape', txn.userPrompt.split('\n\nAfter your compression')[0] === sdk.userPrompt.split('\n\nAfter your compression')[0]);
check('flag OFF both agents (surfaceEnabledFor === false)', !surfaceEnabledFor('leo', 'compression') && !surfaceEnabledFor('jim', 'compression'));

const script = fs.readFileSync(path.join(ROOT, 'scripts/process-pending-compression.ts'), 'utf-8');
check('the transport gate present', script.includes("surfaceEnabledFor(agent!, 'compression')"));
check('SDK rollback path byte-intact (runSDK still fires on flag-off)', script.includes('raw = await runSDK(built.systemPrompt, built.userPrompt);'));
check('null-capture releases the claim (fail-safe retry)', script.includes('tmux dispatch failed (warm-gate/timeout) — releasing claim for retry'));
check('mode-mismatch fail-loud + release', script.includes("not 'compression' — releasing claim (fail-loud)"));
check('tmux result normalised to the SDK (composed, FEELING_TAG) shape', script.includes('INCOMPRESSIBLE: ${c.composed}') && script.includes('FEELING_TAG: ${c.feeling_tag}'));
check('DEC-092 observed-model under tmux', script.includes("observeActiveModel(agent!, 'compression')"));

console.log(`\ncompression-p2: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
