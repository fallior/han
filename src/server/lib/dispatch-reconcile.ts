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
