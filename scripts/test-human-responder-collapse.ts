#!/usr/bin/env npx tsx
/**
 * P2 collapse proof — the human-responder's registry leaves + the agnostic addressed-gate are
 * per-agent-faithful, byte-equivalent to the retired leo/jim mirror regexes, and 4th-agent-free.
 * Run: npx tsx scripts/test-human-responder-collapse.ts   (exit 0 = all pass)
 */
import path from 'node:path';
import os from 'node:os';
import {
    swapPrefixFor, humanResponderTxnTimeoutMs, humanResponderCommitmentScan,
    agentNameAliases, addressedToOtherResponderOnly, conversationRoleFor,
} from '../src/server/lib/garden-manifest';
import { gradientConfigForAgent } from '../src/server/lib/agent-registry';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(got)}${ok ? '' : ` want=${JSON.stringify(want)}`}`);
    if (!ok) failed++;
}
const HOME = os.homedir();

console.log('── per-agent leaves (all registry-derived) ──');
check('swapPrefix leo', swapPrefixFor('leo', 'human-response'), 'human-swap');
check('swapPrefix jim', swapPrefixFor('jim', 'human-response'), 'jim-human-swap');
check('txnTimeout leo', humanResponderTxnTimeoutMs('leo'), 15 * 60_000);
check('txnTimeout jim', humanResponderTxnTimeoutMs('jim'), 15 * 60_000);
check('commitmentScan leo (ON)', humanResponderCommitmentScan('leo'), true);
check('commitmentScan jim (off)', humanResponderCommitmentScan('jim'), false);
check('commitmentScan casey (off — 4th agent free)', humanResponderCommitmentScan('casey'), false);
check('conversationRole leo', conversationRoleFor('leo'), 'leo');
check('conversationRole jim (supervisor)', conversationRoleFor('jim'), 'supervisor');
check('memoryDir leo (/leo)', gradientConfigForAgent('leo').memoryDir, path.join(HOME, '.han', 'memory', 'leo'));
check('memoryDir jim (ROOT)', gradientConfigForAgent('jim').memoryDir, path.join(HOME, '.han', 'memory'));
check('aliases leo', agentNameAliases('leo'), ['leo', 'leonhard']);
check('aliases jim', agentNameAliases('jim'), ['jim', 'jimmy']);
check('aliases casey (fallback = displayName)', agentNameAliases('casey'), ['casey']);

console.log('\n── addressed-gate: byte-equivalent to the retired mirror regexes ──');
// OLD leo: (/\bjim\b|\bjimmy\b/.test(t)) && !(/\bleo\b|\bleonhard\b/.test(t))
check('leo: "jim, thoughts?" → stand down', addressedToOtherResponderOnly('leo', 'jim, thoughts?'), true);
check('leo: "jimmy?" → stand down', addressedToOtherResponderOnly('leo', 'jimmy?'), true);
check('leo: "leo and jim" → answer (names self)', addressedToOtherResponderOnly('leo', 'leo and jim'), false);
check('leo: "leonhard help" → answer (self alias)', addressedToOtherResponderOnly('leo', 'leonhard help'), false);
check('leo: "general q" → answer (names nobody)', addressedToOtherResponderOnly('leo', 'general q'), false);
check('jim: "leo can you" → stand down', addressedToOtherResponderOnly('jim', 'leo can you'), true);
check('jim: "leonhard?" → stand down', addressedToOtherResponderOnly('jim', 'leonhard?'), true);
check('jim: "jimmy thoughts" → answer (self)', addressedToOtherResponderOnly('jim', 'jimmy thoughts'), false);
check('jim: "jim and leo" → answer (names self)', addressedToOtherResponderOnly('jim', 'jim and leo'), false);
// word-boundary discipline: a substring must NOT match (\bjim\b does not fire inside "jimi")
check('leo: "jimi hendrix" → answer (no \\bjim\\b)', addressedToOtherResponderOnly('leo', 'jimi hendrix'), false);

console.log(failed === 0 ? '\n✅ ALL PASS' : `\n❌ ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
