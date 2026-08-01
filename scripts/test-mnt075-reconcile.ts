#!/usr/bin/env tsx
// test-mnt075-reconcile.ts — MNT-075 gates: check the record, not the receipt.
//
//   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-mnt075-reconcile.ts
//
// G1a — the reconcile helper against a real (throwaway) DB: post present ⇒ true;
//       absent ⇒ false; strictly-after semantics; the jim→'supervisor' role mapping;
//       the `{slug}-` id-prefix belt.
// G1b — THE CLASS THAT BIT (Jim's F1): a label made when no post existed (would have
//       spoken) is silenced at delivery time once the post lands — the same state,
//       re-checked later, suppresses.
// G2  — source pins: the publisher only speaks on confirmed absence; R1 produces
//       posted_but_ack_missed; both preamble templates carry the R3 hard conditional;
//       the responder gates through maySpeakFailurePreamble.
// G4  — Tenshi's fail-closed: a reconcile-query error ⇒ null ⇒ preamble suppressed.
// F2  — the progress-anchor pin: a fresh composing-heartbeat structurally prevents a
//       watchdog fire (the mechanism given its obliged rememberer, per Casey).
// MNT-077 — busyElsewhere G1 (certificate of engagement; never-throws; the
//       progress-not-aliveness invariant), G2 the LIVE REPLAY of both real 2026-08-01
//       fires in both directions, G3 + Casey's borrow-and-stamp atomicity as source pins.
//
// (G3 — no new timeout/cap/destructive path — is a review property of the diff; the
// build introduces zero numeric limits. Asserted here only as a grep for absence of
// new config keys in the touched files.)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Throwaway DB — the env must be live BEFORE db.ts resolves its path, and static
// imports HOIST above top-level statements (the exact mechanism that put six fixture
// rows in the LIVE gradient.db on 2026-08-01 — Jim's M1). So: set the env, then load
// every server module via DYNAMIC import inside main(), then assertScratchDb() as the
// structural gate before the first write (a wrong resolution aborts loud).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mnt075-'));
process.env.HAN_DB_PATH = path.join(TMP, 'test.db');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
    cond ? pass++ : fail++;
    console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${!cond && detail ? ` — ${detail}` : ''}`);
};

async function main(): Promise<void> {
const { db } = await import('../src/server/db');
const { siblingPostedSince, maySpeakFailurePreamble, progressAnchorMs, busyElsewhere } = await import('../src/server/lib/dispatch-reconcile');
const { assertScratchDb } = await import('./assert-scratch-db');
assertScratchDb(db); // M1: a write to prod is unrepresentable — abort before any INSERT

const CONV = 'test-conv-mnt075';
const T0 = '2026-08-01T06:00:00.000Z';
const T1 = '2026-08-01T06:01:00.000Z'; // label time
const T2 = '2026-08-01T06:02:00.000Z'; // the late post

db.prepare(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(CONV, 'MNT-075 test thread', T0, T0);
const insertMsg = db.prepare(
    `INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`);

console.log('\nG1a — the reconcile helper (record vs receipt)');
ok('no post yet ⇒ confirmed absent (false)', siblingPostedSince(CONV, 'casey', T0) === false);

insertMsg.run('casey-100', CONV, 'casey', 'the full sourced reply', T2);
ok('post present after since ⇒ true', siblingPostedSince(CONV, 'casey', T0) === true);
ok('strictly-after: since == post time ⇒ false', siblingPostedSince(CONV, 'casey', T2) === false);

insertMsg.run('m-jim-1', CONV, 'supervisor', 'jim reply under his conversation role', T2);
ok("jim maps to role 'supervisor' (manifest mapping, not the slug)", siblingPostedSince(CONV, 'jim', T0) === true);

insertMsg.run('tenshi-42', CONV, 'weird-role', 'id-prefix belt case', T2);
ok('`{slug}-` id-prefix matches even under an odd role', siblingPostedSince(CONV, 'tenshi', T0) === true);
ok('an agent with no post stays confirmed-absent', siblingPostedSince(CONV, 'leo', T0) === false);

console.log('\nG1b — the class that bit: label-then-post, silenced at delivery time');
const CONV2 = 'test-conv-mnt075-race';
db.prepare(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(CONV2, 'race thread', T0, T0);
// At labelling time (T1): no post from jim → the watchdog would label failed and the
// old builder would have scripted the preamble.
ok('at labelling time the record confirms absence (label honest)', siblingPostedSince(CONV2, 'jim', T0) === false);
ok('…and the gate would have permitted speech at that instant', maySpeakFailurePreamble(CONV2, 'jim', T0) === true);
// The post lands AFTER the label (the 79s/19s instances) …
insertMsg.run('m-jim-2', CONV2, 'supervisor', 'the slow compose, landed late', T2);
// … and the SAME state, re-checked at delivery time, now suppresses.
ok('delivery-time re-check silences the preamble once the post lands', maySpeakFailurePreamble(CONV2, 'jim', T0) === false);

console.log('\nG2 — source pins (the publisher, the producer, the templates, the gate)');
const SRC = path.join(__dirname, '..', 'src', 'server');
const orch = fs.readFileSync(path.join(SRC, 'services', 'jemma-orchestrator.ts'), 'utf8');
ok('R1: the watchdog produces posted_but_ack_missed (the missing producer, installed)',
    /posted === true[\s\S]{0,200}?status = 'posted_but_ack_missed'/.test(orch));
ok('R2: the publisher speaks ONLY on confirmed absence (posted === false)',
    /posted === false[\s\S]{0,200}?priorAgentFailed = \{/.test(orch));
ok('R2: the builder stays guarded on failed-only (the v2 amendment)',
    /if \(prior\.status === 'failed'\) \{[\s\S]{0,300}?siblingPostedSince/.test(orch));
const prompts = fs.readFileSync(path.join(SRC, 'lib', 'human-prompts.ts'), 'utf8');
ok('R3: BOTH preamble templates carry the verify-first hard conditional',
    (prompts.match(/VERIFY IN THE RECORD BEFORE SAYING SO/g) ?? []).length === 2);
ok('R3: the templates command silence on a found post',
    (prompts.match(/say NOTHING about them/g) ?? []).length === 2);
const responder = fs.readFileSync(path.join(SRC, 'human-responder.ts'), 'utf8');
ok('F1c: the responder gates the preamble through maySpeakFailurePreamble',
    /maySpeakFailurePreamble\(conversationId, priorAgentFailed\.agent/.test(responder));
const touched = orch + responder + fs.readFileSync(path.join(SRC, 'lib', 'dispatch-reconcile.ts'), 'utf8');
ok('G3: no new timeout/cap config keys entered the touched files',
    !/compose_watchdog_timeout_ms['"]?\s*[:=]\s*\d/.test(touched.replace(/compose_watchdog_timeout_ms: 90000/g, '')) &&
    !/new_timeout|maxWait|hardLimit/.test(touched));

console.log('\nF2 — the progress-anchor pin (a fresh heartbeat prevents the fire)');
const NOW = Date.parse('2026-08-01T06:10:00.000Z');
const TIMEOUT = 90000; // the config default checkWatchdogs reads
const staleWake = new Date(NOW - 96000).toISOString();
const freshBeat = new Date(NOW - 10000).toISOString();
ok('no heartbeat + 96s-old wake ⇒ elapsed exceeds timeout (fires — today\'s honest case)',
    NOW - progressAnchorMs({ wake_at: staleWake }, staleWake) > TIMEOUT);
ok('fresh composing-heartbeat ⇒ elapsed under timeout (structurally cannot fire)',
    NOW - progressAnchorMs({ wake_at: staleWake, last_progress_at: freshBeat }, staleWake) < TIMEOUT);
ok('anchor prefers heartbeat over wake over row-updated (the S151 ordering)',
    progressAnchorMs({ wake_at: staleWake, last_progress_at: freshBeat }, T0) === Date.parse(freshBeat)
    && progressAnchorMs({ wake_at: staleWake }, T0) === Date.parse(staleWake)
    && progressAnchorMs({}, T0) === Date.parse(T0));

console.log('\nMNT-077 G1 — busyElsewhere: the certificate of engagement');
const TIMEOUT_MS = 90_000;
const NOW_MS = Date.parse('2026-08-01T06:10:22.000Z'); // jim's real fire moment
const mkRow = (id: string, agent: string, status: string, lastProgress?: string, idx = 0) => ({
    id, current_index: idx,
    recipients_ordered: JSON.stringify([{ agent, status, ...(lastProgress ? { last_progress_at: lastProgress } : {}) }]),
});
const fresh = new Date(NOW_MS - 20_000).toISOString();
const stale = new Date(NOW_MS - 200_000).toISOString();
ok('fresh composing sibling ⇒ defer (with the sibling named)',
    busyElsewhere('jim', [mkRow('sib', 'jim', 'in_progress', fresh)], 'me', NOW_MS, TIMEOUT_MS)?.dispatchId === 'sib');
ok('stale sibling ⇒ no defer (the engagement lapsed — honest fire)',
    busyElsewhere('jim', [mkRow('sib', 'jim', 'in_progress', stale)], 'me', NOW_MS, TIMEOUT_MS) === null);
ok('fresh wake but NO heartbeat ⇒ no borrow (aliveness is not engagement — the invariant)',
    busyElsewhere('jim', [mkRow('sib', 'jim', 'in_progress', undefined)], 'me', NOW_MS, TIMEOUT_MS) === null);
ok('agent not current elsewhere ⇒ no defer',
    busyElsewhere('jim', [mkRow('sib', 'casey', 'in_progress', fresh)], 'me', NOW_MS, TIMEOUT_MS) === null);
ok('own dispatch excluded from the scan',
    busyElsewhere('jim', [mkRow('me', 'jim', 'in_progress', fresh)], 'me', NOW_MS, TIMEOUT_MS) === null);
ok('completed sibling ⇒ no defer (the honest tail must not rust)',
    busyElsewhere('jim', [mkRow('sib', 'jim', 'done', fresh)], 'me', NOW_MS, TIMEOUT_MS) === null);
ok('NEVER THROWS: poisoned row JSON ⇒ null, the watchdog loop survives (Tenshi fold 1)',
    busyElsewhere('jim', [{ id: 'bad', current_index: 0, recipients_ordered: '{not json' }], 'me', NOW_MS, TIMEOUT_MS) === null);

console.log('\nMNT-077 G2 — the live replay: both real 2026-08-01 fires, both directions');
// jim's fire (dispatch 06e9057b at 06:10:22): jim was mid-compose on sibling 7d7ff3ee —
// the REAL row shape: [leo done, JIM in_progress (ticking), casey pending, tenshi pending],
// current_index=1, woken 06:08:20 with composing heartbeats every 30s (fresh tick ≤30s).
const jimSib = {
    id: '7d7ff3ee', current_index: 1,
    recipients_ordered: JSON.stringify([
        { agent: 'leo', status: 'done' },
        { agent: 'jim', status: 'in_progress', wake_at: '2026-08-01T06:08:20.832Z', last_progress_at: new Date(NOW_MS - 22_000).toISOString() },
        { agent: 'casey', status: 'pending' },
        { agent: 'tenshi', status: 'pending' },
    ]),
};
ok('jim 06:10:22 ⇒ DEFERRED (the first real fire would not have happened)',
    busyElsewhere('jim', [jimSib], '06e9057b', NOW_MS, TIMEOUT_MS)?.dispatchId === '7d7ff3ee');
// casey's fire (dispatch 7d7ff3ee at 06:14:22): casey mid-compose on sibling 06e9057b —
// the REAL row shape: [jim failed, CASEY in_progress (ticking)], current_index=1.
const CASEY_MS = Date.parse('2026-08-01T06:14:22.000Z');
const caseySibStates = (status: string, tick: string) => JSON.stringify([
    { agent: 'jim', status: 'failed' },
    { agent: 'casey', status, wake_at: '2026-08-01T06:10:22.383Z', last_progress_at: tick },
]);
const caseySib = { id: '06e9057b', current_index: 1, recipients_ordered: caseySibStates('in_progress', new Date(CASEY_MS - 12_000).toISOString()) };
ok('casey 06:14:22 ⇒ DEFERRED (the second real fire would not have happened)',
    busyElsewhere('casey', [caseySib], '7d7ff3ee', CASEY_MS, TIMEOUT_MS)?.dispatchId === '06e9057b');
// The other direction: once the sibling completes (casey done 06:17:38), the defer ends.
const caseyDone = { id: '06e9057b', current_index: 1, recipients_ordered: caseySibStates('done', new Date(CASEY_MS - 12_000).toISOString()) };
ok('sibling completes ⇒ defer self-terminates ⇒ the honest path resumes',
    busyElsewhere('casey', [caseyDone], '7d7ff3ee', CASEY_MS + 60_000, TIMEOUT_MS) === null);

console.log('\nMNT-077 G3 + pins — the source-level guarantees');
const orch077 = fs.readFileSync(path.join(SRC, 'services', 'jemma-orchestrator.ts'), 'utf8');
ok('Casey atomicity: the borrow and the stamp are ONE act (adjacent assignments)',
    /state\.last_progress_at = busy\.progressAtIso;\s*\n\s*state\.deferred_busy_on = busy\.dispatchId;/.test(orch077));
ok('R2 receipt-before-act: deferred_rewake set BEFORE the re-fire',
    /state\.deferred_rewake = true;[\s\S]{0,900}?fireWakeForIndex\(row\.id, idx/.test(orch077));
ok('R2 fires at most ONCE (the !deferred_rewake guard)',
    /state\.deferred_busy_on && !state\.deferred_rewake/.test(orch077));
ok('R2 is gated on a PRIOR defer (deferred_busy_on) — never a general retry',
    /if \(state\.deferred_busy_on && !state\.deferred_rewake\)/.test(orch077));

console.log('\nMNT-077 M1 — the re-woken window is REAL: pin the duration, not just the count');
// The state fireWakeForIndex + the M1 clear produce: fresh wake_at, NO last_progress_at.
const REWAKE_T = Date.parse('2026-08-01T06:20:00.000Z');
const rewokenState = { wake_at: new Date(REWAKE_T).toISOString() }; // anchor falls to wake_at
ok('30s after the re-wake ⇒ INSIDE the window (no fire — the coin-flip is dead)',
    (REWAKE_T + 30_000) - progressAnchorMs(rewokenState, T0) < TIMEOUT_MS);
ok('timeout+ε after the re-wake with no progress ⇒ the honest tail still lands',
    (REWAKE_T + TIMEOUT_MS + 1_000) - progressAnchorMs(rewokenState, T0) > TIMEOUT_MS);
// Without the M1 clear (the pre-fix state): the stale borrow destroys the window.
const unclearedState = { wake_at: new Date(REWAKE_T).toISOString(), last_progress_at: new Date(REWAKE_T - 95_000).toISOString() };
ok('the counterfactual: an UNCLEARED stale borrow would fire on the very next poll (the bug M1 kills)',
    (REWAKE_T + 30_000) - progressAnchorMs(unclearedState, T0) > TIMEOUT_MS);
const orchM1 = fs.readFileSync(path.join(SRC, 'services', 'jemma-orchestrator.ts'), 'utf8');
ok('M1 source-pin: the anchor-clear rides in the SAME act as the receipt',
    /state\.deferred_rewake = true;[^\n]*\n\s*state\.last_progress_at = undefined;/.test(orchM1));

console.log('\nMNT-077 N1 — per-row containment (one bad row never disables the defer for the garden)');
ok('poisoned row FIRST + genuine engagement LATER ⇒ the defer is still found',
    busyElsewhere('jim', [
        { id: 'bad', current_index: 0, recipients_ordered: '{not json' },
        mkRow('sib', 'jim', 'in_progress', fresh),
    ], 'me', NOW_MS, TIMEOUT_MS)?.dispatchId === 'sib');

console.log('\nG4 — fail CLOSED: a broken record-read never licenses the accusation');
db.close(); // force every subsequent query to error
ok('query error ⇒ null (uncertainty, not a verdict)', siblingPostedSince(CONV, 'casey', T0) === null);
ok('query error ⇒ preamble suppressed (silence over accusation)', maySpeakFailurePreamble(CONV, 'casey', T0) === false);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
}

main().then(() => {
    console.log(`\nMNT-075 gates: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('✗ FAIL suite error:', e.message); process.exit(1); });
