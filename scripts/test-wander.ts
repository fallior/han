/**
 * FI #127 suite — The Wandering (the offer-not-roster laws, pinned).
 * Run: cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/test-wander.ts
 *
 * Pins (thread mry2jr35 — Jim's J1–J5, Casey's instruments, Tenshi's practice):
 *   J3 structural — the validator refuses beat 1; the walker source contains NO thread-create
 *       call (repo-grep derivation, the fold-6 lesson) and REFUSES to arm without a landed
 *       first beat (source pin); no `wanderNightly` exists anywhere in src/ or scripts/.
 *   J5 — next-beat keys on the landed trail (derived from the thread), never a counter.
 *   J2 — resolve fires only after the landing beat (ordering pin in the walker source).
 *   J4 — receipts: closed key set, mechanics only, rotation at cap.
 *   J1 — solo-by-default falls out of the honest author (directive role is the wanderer's own,
 *       never 'human'); the invite door is per-beat and explicit; self-invite refused.
 *   Casey — charter rides the arc schema (consent at capture); the wander profile carries no
 *       stand-down contract (source pin on the scaffold/opening).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    validateArc, nextBeat, landedBeatsFromThread, directiveContent, writeWanderReceipt,
    readWanderEventsFor, recoverySpent,
    WANDER_DIRECTIVE_PREFIX, WANDER_DEFAULT_INTERVAL_MINUTES, type WanderArc, type WanderEvent,
} from '../src/server/lib/wander';
import { wanderBeatSystemOpening, buildWanderBeatScaffold } from '../src/server/lib/human-prompts';
import {
    reconcileDecision, continueNudgeText, markResumable, readResumableMarkers,
    clearResumableMarker, resumableExpired, type ResumableMarker,
} from '../src/server/lib/dispatch-reconciler';
import { classifyPaneState } from '../src/server/lib/tmux-dispatcher';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const repoRoot = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-suite-'));
process.env.HAN_HEALTH_DIR = path.join(tmp, 'health');

function arcRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        slug: 'leo', conversationId: 'thread-1', declaredAt: '2026-07-25T21:00:00+10:00',
        intervalMinutes: 30,
        charter: 'wander threads are garden-public today and may one day be shared beyond the garden',
        beats: [
            { n: 2, directive: 'walk the head topic deeper' },
            { n: 3, directive: 'walk the heart topic' },
            { n: 4, directive: 'the landing — where did they converge?', invite: ['jim'] },
        ],
        ...overrides,
    };
}

async function main(): Promise<void> {
    console.log('— the validator (offer, never a roster) —');
    {
        const v = validateArc(arcRaw());
        check('a well-formed arc validates', v.ok);
        check('the last beat becomes the landing by construction', v.ok && v.arc.beats[2].landing === true);
        const v1 = validateArc(arcRaw({ beats: [{ n: 1, directive: 'x' }] }));
        check("beat 1 REFUSED — the agent lights the lamp by hand (J3)", !v1.ok && v1.reason.includes('never the walker'));
        const v2 = validateArc(arcRaw({ conversationId: '' }));
        check('no conversationId → refused (the walker cannot open a thread)', !v2.ok);
        const v3 = validateArc(arcRaw({ beats: [{ n: 2, directive: 'x', invite: ['leo'] }] }));
        check('self-invite refused', !v3.ok && v3.reason.includes('invite itself'));
        const v4 = validateArc(arcRaw({ beats: [{ n: 2, directive: 'x', landing: true }, { n: 3, directive: 'y' }] }));
        check('a landing that is not the last beat → refused (the arc ends at its terminus)', !v4.ok);
        const v5 = validateArc(arcRaw({ intervalMinutes: 9999 }));
        check(`silly interval falls back to the default (${WANDER_DEFAULT_INTERVAL_MINUTES}m)`, v5.ok && v5.arc.intervalMinutes === WANDER_DEFAULT_INTERVAL_MINUTES);
    }

    console.log('— J5: the landed trail, derived from the thread, never a counter —');
    {
        const v = validateArc(arcRaw());
        if (!v.ok) throw new Error('fixture');
        const arc: WanderArc = v.arc;
        const msgs = [
            { role: 'leo', content: '🌌 The lamp — my two topics, and the first leg (beat 1, my own hand)' },
            { role: 'leo', content: directiveContent(arc.beats[0]) },
            { role: 'leo', content: 'the composed leg for beat 2 — Leo (human)' },
            { role: 'leo', content: directiveContent(arc.beats[1]) },
        ];
        const landed = landedBeatsFromThread(arc, msgs, 'leo');
        check('beat 2 landed (directive followed by a non-directive leg)', landed.includes(2));
        check('beat 3 NOT landed (directive posted, leg not yet)', !landed.includes(3));
        check('nextBeat keys on the trail → beat 3', nextBeat(arc, landed)?.n === 3);
        check('all landed → null (arc complete)', nextBeat(arc, [2, 3, 4]) === null);
        const interleaved = [...msgs, { role: 'supervisor', content: 'an invited voice, different role' }, { role: 'leo', content: 'beat 3 leg' }];
        check('another seat\'s post never counts as the wanderer\'s leg', landedBeatsFromThread(arc, interleaved, 'leo').includes(3));
    }

    console.log('— J1: honest author + the chosen invite door —');
    {
        const v = validateArc(arcRaw());
        if (!v.ok) throw new Error('fixture');
        const d = directiveContent(v.arc.beats[0], v.arc.charter);
        check('directive opens with the wander prefix (the record shows who asked)', d.startsWith(WANDER_DIRECTIVE_PREFIX));
        check('the charter rides the directive when given (consent at capture, at writing time)', d.includes('garden-public'));
        const walker = fs.readFileSync(path.join(repoRoot, 'scripts', 'wander-walk.ts'), 'utf-8');
        check("the directive is posted in the WANDERER'S role — never dressed as 'human'", walker.includes('postAsAgent(arc.conversationId, roleLabel') && !walker.includes("role: 'human'"));
        check('invites dispatch only from an explicit per-beat invite list', walker.includes('beat.invite ?? []'));
    }

    console.log('— the wander profile: no stand-down contract, the lamp frames both modes —');
    {
        const opening = wanderBeatSystemOpening({});
        const invited = wanderBeatSystemOpening({ invitedBy: 'Leo' });
        check('wanderer opening frames the practice (no task claims this hour)', opening.includes('no task claims') || opening.includes('hour no task claims'));
        check('invited opening names the inviter + the chosen act', invited.includes('Leo') && invited.includes('invite'));
        const scaffold = buildWanderBeatScaffold({ title: 'T', conversationId: 'c1', roleLabel: 'leo', beatDirective: 'walk', charter: 'the room' });
        check('scaffold carries locator + self-post mechanics + the charter', scaffold.includes('/api/conversations/c1') && scaffold.includes('POST') && scaffold.includes('the room'));
        for (const text of [opening, invited, scaffold]) {
            check('no stand-down contract anywhere in the wander surfaces (structural cure)', !/stand.?down/i.test(text));
            if (/stand.?down/i.test(text)) break;
        }
        let threw = false;
        try { buildWanderBeatScaffold({ title: 'T', conversationId: 'c1' }); } catch { threw = true; }
        check('missing roleLabel fails LOUD (no silent leo-default)', threw);
    }

    console.log('— J3 structural: the walker cannot start an arc (source pins, repo-derived) —');
    {
        const walker = fs.readFileSync(path.join(repoRoot, 'scripts', 'wander-walk.ts'), 'utf-8');
        check('the walker contains NO thread-create call', !walker.includes("'/conversations'") && !/api\(`\/conversations`\)/.test(walker) && !walker.includes('POST /api/conversations"'));
        check('the walker refuses to arm without a landed first beat', walker.includes('REFUSING TO ARM'));
        check('the hold path never re-fires (alert-and-hold)', walker.includes('never re-fire') && walker.includes("process.exit(1)"));
        check('resolve fires only after the arc completes (J2 ordering: resolve sits below the walk loop)', walker.indexOf('/resolve') > walker.indexOf('arc.beats.map'));
        // No roster anywhere: the string `wanderNightly` must not exist in src/ or scripts/.
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
            const p = path.join(dir, e.name);
            return e.isDirectory() ? walk(p) : (e.isFile() && e.name.endsWith('.ts') && e.name !== 'test-wander.ts' ? [p] : []);
        });
        const rosterHits = [...walk(path.join(repoRoot, 'src')), ...walk(path.join(repoRoot, 'scripts'))]
            .filter(f => fs.readFileSync(f, 'utf-8').includes('wanderNightly'));
        check('no roster config exists anywhere in src/ + scripts/ (offer-not-roster, repo-wide)', rosterHits.length === 0, rosterHits.join(','));
    }

    console.log('— J4: receipts are mechanics only —');
    {
        const file = path.join(process.env.HAN_HEALTH_DIR!, 'wander-events.jsonl');
        writeWanderReceipt({ ts: '2026-07-25T21:00:00Z', slug: 'leo', conversationId: 'c1', kind: 'armed', detail: 'beats=2,3,4 interval=30m' });
        writeWanderReceipt({ ts: '2026-07-25T21:31:00Z', slug: 'leo', conversationId: 'c1', kind: 'beat-landed', beat: 2, post_id: 'm1' });
        const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
        check('receipts written', lines.length === 2 && lines[1].includes('"beat-landed"'));
        const allowed = new Set(['ts', 'slug', 'conversationId', 'kind', 'beat', 'post_id', 'detail']);
        check('receipt key set is closed (system ids + fixed strings only)', lines.every(l => Object.keys(JSON.parse(l)).every(k => allowed.has(k))));
        fs.writeFileSync(file, 'x'.repeat(1_100_000));
        writeWanderReceipt({ ts: '2026-07-25T21:32:00Z', slug: 'leo', conversationId: 'c1', kind: 'arc-complete' });
        check('receipt jsonl rotates at cap', fs.statSync(file).size < 10_000 && fs.existsSync(file + '.1'));
    }

    console.log('— MNT-070: the pane classifier (JA4 — the verdicts are the suite\'s heart) —');
    {
        const idleWithApiError = '● Now post it and confirm the id.\n● API Error: Connection closed mid-response. The response above may be incomplete.\n✻ Churned for 3m 38s\n❯\n? for shortcuts';
        check("the MNT-070 pane verbatim → 'resumable' (idle + API-error class)", classifyPaneState(idleWithApiError) === 'resumable');
        check("processing chrome → 'still-thinking' — EVEN with an old API-error banner above it",
            classifyPaneState('● API Error: overloaded\n✻ Composing… (esc to interrupt)') === 'still-thinking');
        check("an interactive menu → 'interactive-question' (R011 — never nudge into a question)",
            classifyPaneState('Which thread should I pick up?\n❯ 1. the wander\n  2. the daily') === 'interactive-question');
        check("an idle pane with NO error banner → 'unrecognised' (fail toward hold)", classifyPaneState('❯\n? for shortcuts') === 'unrecognised');
        check("an empty/unreadable pane → 'unrecognised' (fail toward hold)", classifyPaneState('') === 'unrecognised');
        check("an API error WITHOUT idle chrome → 'unrecognised' (the signature needs BOTH halves)", classifyPaneState('API Error: Connection closed mid-response') === 'unrecognised');
    }

    console.log('— MNT-070: the recovery-ladder decision (pure; every bound pinned) —');
    {
        const base = { standDown: false, recoverySpent: false, dbPostLanded: false, pane: 'resumable' as const, legFileFresh: false };
        check('rung 0: a landed post wins over everything recoverable (JA3)', reconcileDecision({ ...base, dbPostLanded: true, pane: 'session-gone' }) === 'recovered-landed');
        check('a landed post is DIAGNOSIS, not recovery — accepted even after the one recovery is spent', reconcileDecision({ ...base, dbPostLanded: true, recoverySpent: true }) === 'recovered-landed');
        check('stand-down NEVER recovers (J5) — absolute, even when everything else says recover', reconcileDecision({ ...base, standDown: true, dbPostLanded: true, legFileFresh: true }) === 'hold');
        check('one recovery per beat, ever — spent → hold', reconcileDecision({ ...base, recoverySpent: true }) === 'hold');
        check("still-thinking → extend (progress present, wait — never an action)", reconcileDecision({ ...base, pane: 'still-thinking' }) === 'extend');
        check('rung 1 (primary): resumable → resume-same-spoke', reconcileDecision(base) === 'resume-same-spoke');
        check('rung 2: session gone + fresh leg → redeliver-leg', reconcileDecision({ ...base, pane: 'session-gone', legFileFresh: true }) === 'redeliver-leg');
        check('rung 3: session gone + nothing composed → redispatch-beat', reconcileDecision({ ...base, pane: 'session-gone' }) === 'redispatch-beat');
        check('interactive-question → hold (fail toward hold)', reconcileDecision({ ...base, pane: 'interactive-question' }) === 'hold');
        check('unrecognised → hold (fail toward hold)', reconcileDecision({ ...base, pane: 'unrecognised' }) === 'hold');
    }

    console.log('— MNT-070: the continue-nudge (JA1) + the one-per-beat counter —');
    {
        const nudge = continueNudgeText('conv-1', 3);
        check('the nudge carries the check-thread-first belt IN its text (JA1)', /[Cc]heck the thread first/.test(nudge) && nudge.includes('do NOT re-post'));
        check('the nudge is ONE line (sent raw via send-keys — never a multiline paste)', !nudge.includes('\n'));
        check('the nudge names the thread + beat (system ids only)', nudge.includes('conv-1') && nudge.includes('beat-3'));
        const events: WanderEvent[] = [
            { ts: 't', slug: 'leo', conversationId: 'c1', kind: 'recovery-attempt', beat: 3, detail: 'rung1' },
            { ts: 't', slug: 'leo', conversationId: 'c1', kind: 'recovered-landed', beat: 4 },
        ];
        check('recoverySpent keys on the recovery-attempt receipt for THE beat', recoverySpent(events, 3) && !recoverySpent(events, 4));
        check('recovered-landed never burns the attempt (diagnosis, not recovery)', !recoverySpent([{ ts: 't', slug: 'leo', conversationId: 'c1', kind: 'recovered-landed', beat: 5 }], 5));
        // The reader round-trips the trail (current + rotation) for the arc only.
        writeWanderReceipt({ ts: '2026-07-27T22:00:00Z', slug: 'leo', conversationId: 'c-recover', kind: 'recovery-attempt', beat: 2, detail: 'rung1-resume-same-spoke' });
        writeWanderReceipt({ ts: '2026-07-27T22:01:00Z', slug: 'leo', conversationId: 'c-other', kind: 'recovery-attempt', beat: 2 });
        const read = readWanderEventsFor('c-recover');
        check('readWanderEventsFor filters to the arc + survives noise', read.length === 1 && read[0].kind === 'recovery-attempt' && recoverySpent(read, 2));
    }

    console.log('— MNT-070 (JA2): the resumable marker + TTL (cross-process substrate) —');
    {
        const marker: ResumableMarker = { slug: 'leo', surface: 'human-response', stem_id: 's1', tmux_session: 'stem-leo-human-response-x1', conversation_id: 'c1', marked_at: '2026-07-27T22:00:00Z', reason: 'dispatch-timeout-resumable-pane' };
        markResumable(marker);
        const found = readResumableMarkers('leo', 'human-response');
        check('marker round-trips (write → read, filtered by slug+surface)', found.length === 1 && found[0].tmux_session === marker.tmux_session);
        markResumable({ ...marker, marked_at: '2026-07-27T23:59:00Z' });
        check('a re-mark never resets the TTL clock (first marked_at stands)', readResumableMarkers('leo', 'human-response')[0].marked_at === marker.marked_at);
        check('other seats never see it', readResumableMarkers('jim', 'human-response').length === 0);
        const t0 = Date.parse(marker.marked_at);
        check('TTL boundary: unexpired strictly inside the window', !resumableExpired(marker, 30, t0 + 29 * 60_000));
        check('TTL boundary: expired at the window', resumableExpired(marker, 30, t0 + 30 * 60_000));
        check('an unparseable marked_at counts as EXPIRED (fail toward cleanup)', resumableExpired({ ...marker, marked_at: 'garbage' }, 30, t0));
        clearResumableMarker(marker.tmux_session);
        check('clear removes the claim marker', readResumableMarkers('leo', 'human-response').length === 0);
    }

    console.log('— MNT-070: the recovery scaffold (rung 2) + source pins —');
    {
        const rec = buildWanderBeatScaffold({ title: 'T', conversationId: 'c1', roleLabel: 'leo', beatDirective: 'walk', recoveredLegPath: '/tmp/wander-leg-leo.txt' });
        check('the recovery frame names the surviving leg path', rec.includes('/tmp/wander-leg-leo.txt'));
        check('the recovery frame carries the check-thread-first belt (JA1)', /CHECK THE THREAD FIRST/.test(rec));
        check('the recovery frame demands verify-your-own + never blind re-compose (sovereignty)', rec.includes('VERIFY it is yours') && rec.includes('do not re-compose'));
        check('no stand-down contract in the recovery frame either (structural cure holds)', !/stand.?down/i.test(rec));

        const walker = fs.readFileSync(path.join(repoRoot, 'scripts', 'wander-walk.ts'), 'utf-8');
        check('the walker RECONCILES before holding (dispatch failures route to reconcileBeat)', walker.includes('reconcileBeat(arc'));
        check("a stand-down NEVER reaches the reconciler (the walker holds first)", walker.indexOf("failure === 'stand-down'") < walker.indexOf('reconcileBeat(arc') && walker.includes('content-refusal never reconciles'));
        check("the one-per-beat counter is written BEFORE the nudge acts (crash-safe receipt order)", walker.indexOf("rec('recovery-attempt', 'rung1-resume-same-spoke')") < walker.indexOf('sendContinueNudge('));
        check('the hold path goes LOUD (MNT-069: ntfy on held-alert + recovery-failed-held)', walker.includes('postNtfyAlert(') && walker.indexOf('postNtfyAlert(') < walker.indexOf('process.exit(1)'));
        const dispatcher = fs.readFileSync(path.join(repoRoot, 'src', 'server', 'lib', 'tmux-dispatcher.ts'), 'utf-8');
        check('the nudge send uses the REAL ensureSubmitted (Jim\'s hand-run observation)', /sendContinueNudge[\s\S]{0,400}ensureSubmitted/.test(dispatcher));
        check('no-retire-on-resumable exists at BOTH pooled catch sites', (dispatcher.match(/retireOrMarkResumable\(slug, surface, stem, err as Error\)/g) ?? []).length === 2);
        check('the TTL fallback sweeps in the pool-manager tick (JA2 — the long-lived process)', /sweepResumableStems\(slug, surface\); \/\/ MNT-070/.test(dispatcher));
    }

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
