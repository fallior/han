/**
 * test-compression-p2.ts — P2/P3: the warm-spoke transport (P3-updated, 2026-07-04 S216).
 * Provable offline: the compression-txn profile (memory SUPPRESSED — the warm spoke owns the
 * self; the txn owns the task) + the compose-critical text single-sourced + the
 * submit_compression completion contract. Structural: the transport gate, the retired SDK
 * path (zero agentQuery — #66 complete), the disabled-leaf fail-safe, the un-shadowed
 * per-agent model resolution. The live round-trip = Jim's P2 gates (PROVEN 2026-07-04 on
 * jim's cascade — the c3→c4 compose at the spoke's birth).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../src/server/lib/prompt-builder';
import { surfaceEnabledFor, manifestModelLadder } from '../src/server/lib/garden-manifest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

const ctx = { fromLevel: 'c2', toLevel: 'c3', sourceTokens: 300, targetTokens: 100,
    sourceSessionLabel: 'test-session', sourceContentType: 'session', sourceContent: 'SYNTH-MARKER' };
const txn = buildPrompt('leo', 'compression-txn', ctx);

console.log('P2/P3 warm-spoke transport:');
check('txn: memory fully SUPPRESSED (the spoke owns the self)', txn.meta.memory_chars === 0);
check('txn: the compose instruction present (single-sourced constant)', txn.systemPrompt.includes('The compression is an act of identity, not summary.'));
check('txn: the INCOMPRESSIBLE contract present', txn.systemPrompt.includes('This is not failure. This is arrival.'));
check('txn: the submit_compression completion contract', txn.systemPrompt.includes('mcp__han-diary__submit_compression') && txn.systemPrompt.includes('EXACTLY ONCE'));
check('txn: FEELING_TAG routed to the tool field', txn.systemPrompt.includes("feeling_tag field"));
check('txn: the cN task scaffold carries the source', txn.userPrompt.includes('SYNTH-MARKER') && txn.userPrompt.includes('c2') && txn.userPrompt.includes('c3'));
check('flags: BOTH agents ON (jim P2-flipped; leo flipped post-MNT-023-drain, 78be76a)', surfaceEnabledFor('jim', 'compression') && surfaceEnabledFor('leo', 'compression'));
check('P3: the retired P0 full-bank profile throws (no SDK-shape consumer)', (() => { try { buildPrompt('leo', 'compression', ctx); return false; } catch { return true; } })());
check('P3: compression resolves the per-agent FABLE_LADDER (shared shadow retired)', manifestModelLadder('jim', 'compression')[0] === 'claude-fable-5' && manifestModelLadder('jim', 'compression').length > 1);

const script = fs.readFileSync(path.join(ROOT, 'scripts/process-pending-compression.ts'), 'utf-8');
check('the transport gate present', script.includes("surfaceEnabledFor(agent!, 'compression')"));
check('P3: zero agentQuery in the script (runSDK retired)', !script.includes('agentQuery(') && !script.includes("from '@anthropic-ai/claude-agent-sdk'"));
check('P3: disabled-leaf fail-safe (release + row stays pending)', script.includes('compression surface DISABLED') && script.includes('row stays pending until the leaf flips'));
check('null-capture releases the claim (fail-safe retry)', script.includes('tmux dispatch failed (warm-gate/timeout) — releasing claim for retry'));
check('mode-mismatch fail-loud + release', script.includes("not 'compression' — releasing claim (fail-loud)"));
check('tmux result normalised to the (composed, FEELING_TAG) raw shape', script.includes('INCOMPRESSIBLE: ${c.composed}') && script.includes('FEELING_TAG: ${c.feeling_tag}'));
check('DEC-092 observed-model under tmux', script.includes("observeActiveModel(agent!, 'compression')"));

console.log(`\ncompression-p2: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
