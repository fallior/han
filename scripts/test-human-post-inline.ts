/**
 * Regression guard for the leo-human silent-post-fail fix (S203, Jim's folded fix mqt60e7r).
 *
 * Root: the conversation txn scaffold DEFERRED the curl-post to "the Posting pattern in CLAUDE.md"; a
 * spoke that welcome-back-loads LIGHT (#107) lacks that section → composes, calls submit_response, skips
 * the curl → SILENT POST FAILURE. Fix: inline the literal, self-contained POST sequence into the
 * turn-prompt (S156 intact — the spoke still self-posts; the controller does NOT post for it). This test
 * asserts the scaffold is self-contained + slug-agnostic — the pure-function half of Jim's missing test
 * class (the live dispatch→compose→POST-lands round-trip is the deploy-verification half).
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-human-post-inline.ts
 */
import { buildHumanResponseTxnScaffold } from '../src/server/lib/human-prompts';

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const CID = 'mqTESTxx-abc123';
// Every human-response surface, incl. a synthetic 4th agent — the fix must be slug-agnostic.
const cases = [
    { who: 'leo', roleLabel: 'leo' },
    { who: 'jim', roleLabel: 'supervisor' },
    { who: 'casey (synthetic 4th)', roleLabel: 'casey' },
];

for (const { who, roleLabel } of cases) {
    console.log(`[${who}] conversation txn scaffold`);
    const s = buildHumanResponseTxnScaffold({ source: 'conversation', title: 'A Thread', conversationId: CID, roleLabel });

    // 1. The literal, self-contained POST command is present (the conversationId interpolated).
    ok(s.includes(`curl -sk -X POST "https://localhost:3847/api/conversations/${CID}/messages"`),
        'inlines the literal POST curl with the conversation id (no CLAUDE.md deferral)');
    // 2. The role is the AGENT'S role, slug-parameterised (leo→leo, jim→supervisor, casey→casey).
    ok(s.includes(`'role':'${roleLabel}'`), `payload uses role:'${roleLabel}' (slug-agnostic, not a hardcoded leo)`);
    // 3. The python3 payload builder is present (escapes a multi-paragraph body — the JSON-escape dodge).
    ok(s.includes('python3 -c "import json'), 'builds the JSON payload via python3 (no hand-escaping)');
    // 4. The deferral is GONE — the bug was exactly this string.
    ok(!/Posting pattern in CLAUDE\.md/.test(s), 'does NOT defer the post to CLAUDE.md (the bug)');
    // 5. S156 intact — the spoke self-posts; the controller does NOT post for it on the conversation path.
    ok(s.includes('controller does NOT post on your behalf (S156)'), 'states S156: the spoke must self-post');
    // 6. The fetch (LOCATOR) curl is still there — the spoke reads live thread state for the gates.
    ok(s.includes(`curl -sk "https://localhost:3847/api/conversations/${CID}"`), 'keeps the LOCATOR fetch curl');
}

// The Discord path is UNCHANGED: do NOT curl, the controller posts. (Guards against over-reach.)
console.log('[discord] unchanged — controller posts');
const d = buildHumanResponseTxnScaffold({ source: 'discord', channelName: 'general', conversationContext: 'hi', roleLabel: 'leo' });
ok(/do NOT curl-post/i.test(d), 'Discord path still says do NOT curl-post (controller delivers) — untouched');
ok(!d.includes('python3 -c'), 'Discord path has no inlined POST (it is controller-delivered)');

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
