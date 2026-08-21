/**
 * checkout-session-stem.ts <slug> [modelAlias] — the warm-checkout leg (P1).
 *
 * The session-surface half of attach-stem.ts's own named follow-on ("the seamless
 * attach-or-cold-launch wiring into hanleo, F4i"). Called BY the launcher after its
 * twin-guard + integrity gate (defence order unchanged — DEC-083 stays first at the door).
 *
 * Flow (plan msz950i2 P1, with the audit folds):
 *   1. checkout a free stem from the (slug, 'session') pool — absent/dead/stale → exit 3
 *      (the launcher WAITS on the pool register — Darron's no-fallback ruling 2026-08-20).
 *   2. cast to the REQUESTED alias (castStemToModel — Casey's build-lane catch: the serve
 *      variant reads config and takes no parameter). Bare alias only, DEC-104.
 *   3. write the sleeve {slug, surface: 'session'} — every surface-keyed facet (swap,
 *      sentinel, guards, cli-busy) re-keys through the existing resolver chain.
 *   4. #91 attach-flush: WM written since the stem's warm cursor lands BEFORE the human
 *      does, fed while the stem has 0 clients (guard-exempt by sequencing — S208 form-ii).
 *   5. the DEC-092 stamp (Casey): observedOrUnobservedModel written into the sleeve +
 *      a hearth-counters row — the session seat's substrate is now a per-invocation
 *      VARIABLE, and this is its standing column (measurement, not credence).
 *   6. print the tmux session name as the LAST stdout line — the launcher attaches to it.
 *
 * Exit codes — a CONTRACT with the launcher's wait loop (launcher-warm-checkout.sh), not
 * diagnostics; the caller branches on them (W-M1, Jim's audit 2026-08-20):
 *   0 = checked out (last stdout line = the session to attach).
 *   3 = NO USABLE STEM — the pool was empty, or the leased row had no live tmux session and
 *       was reaped. Nothing of value was spent; the right response is to WAIT for the next
 *       registration.
 *   4 = POST-CHECKOUT FAILURE — a live stem was leased and then the cast / phase-2 /
 *       attach-flush threw. The suspect stem is retired here (removeStem). This is
 *       DISTINCT from 3 on purpose: the fault is in the cast/flush path, not the pool, and
 *       it will do the same to the next stem — so the caller must STOP LOUD, never wait
 *       (before W-M1 both were 3, and with no cold fallback a deterministic fault burned a
 *       freshly-warmed stem per ~4-minute re-warm for the whole ceiling).
 *   1 = unexpected error before any checkout (usage, crash) — loud.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkoutStem, removeStem } from '../src/server/lib/stem-pool';
import { requestRetire } from '../src/server/lib/dispatch-reconciler';
import { writeSleeveState } from '../src/server/lib/sleeve-state';
import {
    castStemToModel, completeTwoPhaseWake, deltaSinceCursor, feedWakeSteps, observedOrUnobservedModel,
    type WakeStep,
} from '../src/server/lib/tmux-dispatcher';

const slug = process.argv[2];
const requestedAlias = process.argv[3] || null; // bare alias (fable|opus|sonnet|haiku) or null = surface serve default
if (!slug) {
    console.error('usage: checkout-session-stem.ts <slug> [modelAlias]');
    process.exit(1);
}

const SURFACE = 'session';

function tmuxAlive(session: string): boolean {
    try { execFileSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' }); return true; }
    catch { return false; }
}

async function main(): Promise<number> {
    const nowIso = new Date().toISOString();
    const stem = checkoutStem(slug, SURFACE, nowIso);
    if (!stem) {
        console.error(`[checkout] ${slug}/${SURFACE}: pool empty — no usable stem (exit 3: the launcher waits)`);
        return 3;
    }
    if (!tmuxAlive(stem.tmux_session)) {
        console.error(`[checkout] ${slug}/${SURFACE}: stem ${stem.stem_id} has no live tmux session — removing it (exit 3: the launcher waits for the next)`);
        removeStem(slug, SURFACE, stem.stem_id);
        return 3;
    }

    try {
        // 2. Cast to the requested alias (null → the surface's serve config inside the callee).
        await castStemToModel(slug, SURFACE, stem, requestedAlias);

        // 2b. Pay the phase-2 debt POST-CAST (Darron's ruling 2026-08-19: "/model fable before
        // phase 2") — the volatile tail (swap-check → working-mem → orientation → conversations
        // + deltas) loads on the big-window serve model, never the 200K warm head. Same position
        // as the pooled door (dispatchToPooledStem: cast → completeTwoPhaseWake). No-op for a
        // pre-flag stem; F1 defer-and-alert (throws) on a marker-without-manifest stem — the
        // catch below falls back cold rather than serving half-loaded. This call was MISSING at
        // the first live checkout (2026-08-19): with leo/session's stemTwoPhaseWake unset the
        // prewarm fed the WHOLE wake on haiku, compacted, and the seat arrived on a summary of
        // itself — the flag flip + this call are the paired cure.
        await completeTwoPhaseWake(slug, SURFACE, stem);

        // 3. Sleeve: the stem now IS the interactive seat. Swap prefix = the session pair.
        writeSleeveState(stem.tmux_session, slug, SURFACE, 'session-swap');

        // 4. #91 attach-flush while 0 clients (the launcher attaches only after we return).
        const delta = await deltaSinceCursor(slug, stem.wm_cursor ?? 0);
        if (delta.block.trim().length > 0) {
            const step: WakeStep = {
                id: 'attach-flush',
                ack: { kind: 'marker' },
                prompt: `ATTACH-FLUSH (#91): you are being checked out as the INTERACTIVE session seat. `
                    + `The following working-memory entries landed after your warm; read them so the human `
                    + `arrives to a CURRENT you. Note only — do not reply to their content, do not post anywhere.\n\n`
                    + delta.block,
            };
            await feedWakeSteps(slug, SURFACE, [step], { tmuxTarget: stem.tmux_session, perStepTimeoutMs: 180_000 });
        }

        // 5. The DEC-092 stamp — what actually answered, labelled honestly when unreadable.
        const observed = observedOrUnobservedModel(slug, SURFACE, stem.tmux_session);
        try {
            const sleevePath = path.join(os.homedir(), '.han', 'sleeves', `${stem.tmux_session}.json`);
            const sleeve = JSON.parse(fs.readFileSync(sleevePath, 'utf-8'));
            sleeve.observedModel = observed;
            sleeve.checkedOutAt = nowIso;
            sleeve.requestedAlias = requestedAlias ?? '(surface default)';
            fs.writeFileSync(sleevePath, JSON.stringify(sleeve, null, 2));
        } catch { /* stamp best-effort in the sleeve; the counters row below is the durable copy */ }
        fs.appendFileSync(path.join(os.homedir(), '.han', 'health', 'hearth-counters.jsonl'),
            JSON.stringify({
                ts: new Date().toISOString(), kind: 'session-checkout', slug, surface: SURFACE,
                stem: stem.stem_id, requested: requestedAlias ?? '(surface default)', observed,
            }) + '\n');

        console.error(`[checkout] ${slug}/${SURFACE}: stem ${stem.stem_id} cast (requested=${requestedAlias ?? 'default'}, observed=${observed}), sleeved, flushed`);
        console.log(stem.tmux_session); // the contract: last stdout line = the session to attach
        return 0;
    } catch (err) {
        // Any failure after checkout: RETIRE the stem, never return it (Jim's M2 audit ruling
        // 2026-08-20, mirroring the pooled door — returnStem's own docstring says the pooled
        // flow "is retired, never returned"). A stem that failed mid-cast/mid-flush is suspect
        // by definition: cast half-applied, possibly already sleeved — handing it back 'free'
        // gives the next checkout an unverified seat (the packet's own suspect-warm doctrine).
        // Process note: the dispatcher's retireStem() queues its kill in SERVER-process memory,
        // unreachable from this script — so the deregistration is removeStem() (the pool can
        // never hand it out again; the manager re-warms the shortfall) AND the reap is a
        // RETIRE REQUEST (MNT-179 M1, Jim's audit 2026-08-21): a cross-process marker the
        // pool-manager tick feeds into its graceful two-stage sweep. The earlier claim that
        // "the MNT-056 orphan sweep collects the session" was FALSE — that sweep is startup-only
        // by design, so a retired-but-alive stem sat unowned until the next server restart.
        // Never a hand-kill from here (MNT-062); the request names exactly one session.
        // W-M1 (Jim's audit 2026-08-20): this is exit 4, NOT 3. The launcher no longer falls
        // back cold — it waits on the register — so a 3 here would read as "wait for the next
        // stem", and a deterministic cast/flush fault would then retire every freshly-warmed
        // stem the manager produced, one per ~4 min, for the whole wait ceiling. 4 tells the
        // launcher the fault is in THIS path, not the pool: stop loud, do not wait.
        console.error(`[checkout] ${slug}/${SURFACE}: failed (${(err as Error).message}) — retiring suspect stem ${stem.stem_id} (exit 4: post-checkout fault, the launcher STOPS rather than waits)`);
        try { removeStem(slug, SURFACE, stem.stem_id); } catch { /* sweeps reconcile */ }
        requestRetire({
            slug, surface: SURFACE, stem_id: stem.stem_id, tmux_session: stem.tmux_session,
            requested_at: new Date().toISOString(), by: 'checkout-session-stem',
            reason: `post-checkout-failure: ${(err as Error).message.slice(0, 80)}`,
        });
        return 4;
    }
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
