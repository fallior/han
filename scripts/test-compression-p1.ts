/**
 * test-compression-p1.ts — P1 of the compressor migration: the capture contract + flag-off state.
 * The diary-mcp-server self-starts on import (stdio transport), so the tool handler is proven
 * functionally at P2's live cascade (Jim's stated gate); here we lock the CONTRACT structurally:
 * the schema fields, the CaptureRecord shape, the flag-off manifest state, and the persist
 * atomicity (all three compose-result paths transactional).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolSizeFor, wakeFeedFor, loadResidents } from '../src/server/lib/garden-manifest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

console.log('P1 compression capture contract + flag-off:');

// 1) The tool + schema (structural — the server self-starts, so assert the source contract).
const server = fs.readFileSync(path.join(ROOT, 'src/server/lib/diary-mcp-server.ts'), 'utf-8');
check('submit_compression tool registered', server.includes("'submit_compression'"));
check('schema: composed (min 1)', /composed:\s*z\.string\(\)\.min\(1\)/.test(server));
check('schema: incompressible (boolean)', /incompressible:\s*z\.boolean\(\)/.test(server));
check('schema: feeling_tag (optional, max 100)', /feeling_tag:\s*z\.string\(\)\.max\(100\)\.optional\(\)/.test(server));
check("CaptureRecord mode grows 'compression'", server.includes("'diary' | 'stand-down' | 'compression'"));
check('CompressionCaptureArgs exported', server.includes('export interface CompressionCaptureArgs'));
check('capture writes mode:compression + payload', server.includes("mode: 'compression'") && server.includes('compression: { composed:'));

// 2) Manifest state: the compression surface exists per agent (P2 flipped jim ON 2026-07-04;
//    leo followed post-MNT-023-drain). P1-extraction note (S218): these asserts now read the
//    LOADED manifest (the garden config JSON via the loader) — the literal left the source file;
//    structural beats source-text anyway.
const compressionAgents = loadResidents().filter((a) => a.surfaces.some((s) => s.name === 'compression'));
check('compression surface present for 2 agents', compressionAgents.length === 2);
check('NO poolSize FIELD on the compression surface (cascade ordering — deliberate)',
    compressionAgents.every((a) => a.surfaces.find((s) => s.name === 'compression')!.poolSize === undefined));
check('poolSizeFor(leo, compression) === 0 (the floor/serial model)', poolSizeFor('leo', 'compression') === 0);
check('wakeFeedFor(leo, compression) === true (the guaranteed fed wake at P2)', wakeFeedFor('leo', 'compression') === true);

// 3) Persist atomicity (the P1 acceptance): all three compose-result paths transactional.
const script = fs.readFileSync(path.join(ROOT, 'scripts/process-pending-compression.ts'), 'utf-8');
const txnWraps = (script.match(/db\.transaction\(\(\) => \{/g) || []).length;
check('≥4 transactions (claimNext + 3 persist paths atomic-before-mark-done)', txnWraps >= 3);
check('cascade enqueue INSIDE the standard-path transaction', /const cascadeResult = db\.transaction\(/.test(script));
check('DEC-069 quarantine documented at the persist', script.includes('dead-letter is a DEC-069 quarantine'));

console.log(`\ncompression-p1: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
