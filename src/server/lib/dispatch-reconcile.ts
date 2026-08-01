// dispatch-reconcile.ts — check the RECORD, not the receipt (MNT-075).
//
// The one shared SELECT behind R1 (the watchdog's label), R2 (the preamble builder)
// and F1c (the responder's delivery-time re-check): did a message from this agent
// actually LAND in the thread after it was woken? The absence of an ack receipt is
// evidence only that the receipt is absent — never that the reply doesn't exist
// (Casey: the law of evidence's oldest rule, and the watchdog was convicting on it).
//
// FAIL DIRECTION (Tenshi's G4, the asymmetry priced): the harm this exists to kill is
// a PUBLISHED FALSEHOOD in our voice — so when the query itself cannot answer, the
// caller must resolve toward silence-about-the-sibling. This helper returns `null` on
// any query failure (never throws, never guesses); publication seams treat non-`false`
// as "do not speak the failure line". Failing closed costs at most a skipped courtesy
// sentence; failing open re-publishes the exact falsehood MNT-075 exists to end.

import { db } from '../db';
import { conversationRoleFor } from './garden-manifest';

/**
 * Did a message from `agentSlug` land in `conversationId` strictly after `sinceIso`?
 *
 *   true  — a post from the agent exists after the wake: the agent did NOT fail.
 *   false — CONFIRMED absent: no post from the agent since the wake (the only value
 *           on which a failure may be spoken).
 *   null  — the record could not be consulted (query error): resolve toward silence.
 *
 * Matching is by conversation role (the manifest mapping — jim posts as 'supervisor')
 * OR the `{slug}-` message-id prefix the responder self-posts carry — the same
 * structural self-check the human-response prompt already runs for its own dedup
 * (one shape, not a re-derivation).
 */
export function siblingPostedSince(
    conversationId: string,
    agentSlug: string,
    sinceIso: string,
): boolean | null {
    try {
        const role = conversationRoleFor(agentSlug);
        const row = db.prepare(
            `SELECT id FROM conversation_messages
             WHERE conversation_id = ?
               AND (role = ? OR id LIKE ?)
               AND created_at > ?
             LIMIT 1`,
        ).get(conversationId, role, `${agentSlug}-%`, sinceIso);
        return row !== undefined;
    } catch {
        return null; // G4: uncertainty is not a licence to accuse
    }
}

/**
 * The publication gate (R2 + F1c share it): may the failure preamble be spoken about
 * this agent? ONLY on a confirmed-absent record. `true`/`null` both suppress (G4).
 */
export function maySpeakFailurePreamble(
    conversationId: string,
    agentSlug: string,
    sinceIso: string,
): boolean {
    return siblingPostedSince(conversationId, agentSlug, sinceIso) === false;
}

// ── MNT-077: the watchdog learns the agent has one seat ─────────────────────

/** A sibling dispatch on which the agent is verifiably mid-compose right now. */
export interface BusySibling { dispatchId: string; progressAtIso: string }

/**
 * MNT-077 R1 — is `agent` the CURRENT recipient on another in-progress dispatch row,
 * with GENUINE fresh compose progress? (The adjournment-for-counsel-part-heard check,
 * Casey's mapping: the court consults its own daily list before entering default.)
 *
 * THE LOAD-BEARING INVARIANT (Tenshi's fold 2 — recorded here because it is quietly
 * breakable): `last_progress_at` means GENUINE COMPOSE PROGRESS — it is set ONLY by
 * the S151 `composing` heartbeat ack, never by mere aliveness. That is WHY the defer
 * is safe: a sibling hung on an interactive prompt (R011) stops emitting composing
 * heartbeats, its anchor goes stale, the defer self-terminates, and the deferred row
 * fires honestly. If anyone ever makes `last_progress_at` tick on liveness rather
 * than compose progress, this defer would mask a hung sibling and starve the deferred
 * dispatch indefinitely — borrowed progress from a sibling that will never finish.
 * Do not "improve" progress-tracking into that shape. Corollary: a sibling with only
 * a fresh `wake_at` and NO heartbeat yet is NOT engagement (no certificate — no
 * borrow; the honest fire + the MNT-075 reconcile are the safe fallback).
 *
 * NEVER THROWS (Tenshi's fold 1 — the `siblingPostedSince` pattern, one shelf over):
 * this runs inside the watchdog's poll loop, so an unhandled throw would crash the
 * garden's entire alarm — the exact silent failure this family hunts. Any scan error
 * returns null (⇒ not-busy ⇒ today's honest tail, which fails closed downstream).
 */
export function busyElsewhere(
    agent: string,
    rows: Array<{ id: string; recipients_ordered: string; current_index: number }>,
    excludeDispatchId: string,
    nowMs: number,
    timeoutMs: number,
): BusySibling | null {
    try {
        for (const row of rows) {
            // N1 (Tenshi's fold): PER-ROW containment — one poisoned row must skip, not
            // abort the scan, or a single malformed row silently disables the defer for
            // every agent that poll (don't let one bad element take down the batch).
            try {
                if (row.id === excludeDispatchId) continue;
                const states = JSON.parse(row.recipients_ordered) as Array<{
                    agent: string; status: string; last_progress_at?: string;
                }>;
                const idx = row.current_index;
                if (idx < 0 || idx >= states.length) continue;
                const s = states[idx];
                if (s.agent !== agent || s.status !== 'in_progress') continue;
                if (!s.last_progress_at) continue; // no certificate of engagement — no borrow
                const at = new Date(s.last_progress_at).getTime();
                if (Number.isFinite(at) && nowMs - at < timeoutMs) {
                    return { dispatchId: row.id, progressAtIso: s.last_progress_at };
                }
            } catch { /* skip the poisoned row, keep scanning */ }
        }
        return null;
    } catch {
        return null; // belt: never crash the watchdog loop; the honest tail is the safe direction
    }
}

/**
 * The watchdog's progress anchor (S151, extracted pure for the F2 suite pin): prefer
 * the freshest `composing` heartbeat, fall back to the wake, then the row's own
 * updated_at. Pinned so the progress-aware clock — the mechanism that keeps a slow
 * compose from being labelled at all — can never silently rot (Casey: a designed
 * mechanism needs an obliged rememberer).
 */
export function progressAnchorMs(
    state: { last_progress_at?: string; wake_at?: string },
    rowUpdatedAtIso: string,
): number {
    return state.last_progress_at
        ? new Date(state.last_progress_at).getTime()
        : (state.wake_at ? new Date(state.wake_at).getTime() : new Date(rowUpdatedAtIso).getTime());
}
