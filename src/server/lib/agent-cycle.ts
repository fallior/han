/**
 * Agent cycle/dispatch surface — ONE PATH, MANY AGENTS (Darron's governing law,
 * S176, 2026-06-14: "a `cycle <agent-slug>` where the slug parameterises the
 * endpoint to the agent, one path many agents").
 *
 * The tmux warm-session orchestration that was Leo-baked in `leo-heartbeat.ts`
 * (the T7a `dispatchBeatViaTmux` + `applyMeditationMarkers`) lives here now,
 * slug-parameterised. `leo-heartbeat` (slug `leo`) and `supervisor-worker`
 * (slug `jim`) — and any future agent — are thin callers of this one path.
 *
 * The dispatcher primitives below (`ensureSurfaceSession`, `enqueueForAgent`,
 * `getContextPct`, `clearSession`) are already slug-parameterised; this module
 * makes the layer ABOVE them the same. The per-agent *leaves* that genuinely
 * differ today (the swap-buffer the memory write lands in; the health-signal
 * file) are passed in via callbacks/opts — the full normalisation of those
 * leaves is project (b), the truly-agnostic codebase scour.
 *
 * PR-T7b (DEC-093 / Option A). Flag-off until the manifest flips per-surface.
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildPrompt, PromptOverbudgetError } from './prompt-builder';
import { dispatchToSpoke } from './tmux-dispatcher';
import type { CaptureRecord } from './diary-mcp-server';
import { gradientStmts, feelingTagStmts, gradientAnnotationStmts } from '../db';
import { updateFeelingTagWithHistory, maybeUpgradeTagStability } from './memory-gradient';

/**
 * Per-dispatch knobs. The CORE of `dispatchTxn` (buildPrompt → ensure → enqueue
 * → ctx-pressure clear) is agnostic; these carry the per-(agent,surface)
 * differences that aren't yet normalised into the manifest/dispatcher.
 */
export interface DispatchTxnOpts {
    /** The model failover ladder for this (slug, surface) — `manifestModelLadder(slug, surface)`. */
    ladder: string[];
    /** The wake phrase the spoke is welcomed back with (e.g. "welcome back Leo"). */
    welcomeBack: string;
    /** Dispatch timeout — beats ~15min; a multi-action cycle wants longer. */
    timeoutMs: number;
    /** Called when buildPrompt is over budget — the caller logs + health-signals its way. */
    onOverbudget?: (err: PromptOverbudgetError) => void;
    /** Called when the dispatch fails loud (timeout / not-ready) — the caller writes its agent's health signal. */
    onDispatchFail?: (err: Error) => void;
    /** Called when the post-capture ctx-clear fails (capture already safe). */
    onCtxClearFail?: (err: Error) => void;
}

/**
 * Assemble a per-transaction prompt (the `*-txn` profiles — memory suppressed,
 * the warm session already carries identity) and run it through the dispatcher's
 * per-agent FIFO. Returns the capture, or null on overbudget-skip / dispatch
 * failure (both surfaced via the opts callbacks; the turn completes honestly
 * empty and retries next cadence — no token black hole, no retry loop, S74).
 *
 * This is the agnostic form of T7a's `dispatchBeatViaTmux` — same logic, the
 * slug + surface + opts are the only things that vary (one path, many agents).
 */
export async function dispatchTxn(
    slug: string,
    surface: string,
    txnProfile: string,
    ctx: Record<string, unknown>,
    actionBlock: string,
    opts: DispatchTxnOpts,
): Promise<CaptureRecord | null> {
    let assembled: ReturnType<typeof buildPrompt>;
    try {
        assembled = buildPrompt(slug, txnProfile, ctx as any);
    } catch (err) {
        if (err instanceof PromptOverbudgetError) {
            opts.onOverbudget?.(err);
            return null;
        }
        throw err;
    }
    console.log(`[${slug}/${surface}] ${txnProfile}: tmux txn ~${assembled.meta.est_total_tokens_chars_div_4} tokens (memory suppressed: ${assembled.meta.memory_chars} chars)`);
    const promptDoc = `${assembled.systemPrompt}\n\n${assembled.userPrompt}\n\n${actionBlock}`;

    // The LIFECYCLE (ensure + warm-gate + enqueue + ctx-pressure self-clear) is the shared
    // generic spoke monitor — `dispatchToSpoke` (Jim's F1 seam: ONE lifecycle, surface CONTENT
    // above). dispatchTxn's content half is buildPrompt + the action block; the lifecycle below
    // is identical for every spoke. Thresholds come from the registry (no code-constant).
    return dispatchToSpoke(slug, surface, promptDoc, {
        ladder: opts.ladder,
        welcomeBack: opts.welcomeBack,
        timeoutMs: opts.timeoutMs,
        onDispatchFail: opts.onDispatchFail,
        onCtxClearFail: opts.onCtxClearFail,
    });
}

/**
 * The per-turn action block for a meditation dispatched to a warm spoke. Agnostic
 * — the warm session (any slug) supplies identity; the markers ride inside the
 * curated record so the controller can apply them to the contemplated entry.
 */
export const MEDITATION_ACTION_BLOCK =
    `## This turn's actions (warm seat — your identity is already loaded; the frame above is this turn's context only)\n` +
    `1. Sit with the memory in the frame above — this is a meditation, a genuine re-encounter, not analysis.\n` +
    `2. Carry the re-encounter marker lines (FEELING_TAG: / ANNOTATION: / CONTEXT: / MEMORY_COMPLETE:, as the frame requests) INSIDE your submit_response working_memory_full — the controller parses them from there to record the re-encounter on the contemplated memory.\n` +
    `3. End the turn per the diary-tool instruction above: submit_response with a LIGHT curated record (the subject of the contemplation + what stirred — never the full sitting, which is already in your claude-logged log), or stand_down if genuinely nothing stirred.`;

/**
 * Apply the re-encounter markers parsed from a meditation's curated record to
 * the contemplated entry — for ANY agent (the slug authors the tag/annotation).
 * Faithful to the SDK meditation marker-handling (Jim CODE-GREEN'd the Leo form
 * in d60db5f): recordRevisit always; FEELING_TAG → a fresh insert (Phase A,
 * first encounter) or a history-tracked update (Phase B / evening, a revisit);
 * ANNOTATION/CONTEXT and MEMORY_COMPLETE when the surface allows them. Empty
 * text (a stand_down — nothing stirred) records only the revisit (+ stability
 * upgrade for non-fresh): the tmux equivalent of the SDK `FEELING_TAG: none`.
 */
export function applyMeditationMarkers(
    slug: string,
    entryId: string,
    text: string,
    opts: { freshTag: boolean; allowAnnotation: boolean; allowComplete: boolean; revisitCount: number; contextDefault: string },
): void {
    gradientStmts.recordRevisit.run(new Date().toISOString(), entryId);

    const tagMatch = text.match(/FEELING_TAG:\s*(.+)/);
    if (tagMatch && tagMatch[1].trim().toLowerCase() !== 'none') {
        const tag = tagMatch[1].trim().substring(0, 100);
        if (opts.freshTag) {
            feelingTagStmts.insert.run(entryId, slug, 'revisit', tag, null, new Date().toISOString());
        } else {
            const updated = updateFeelingTagWithHistory(entryId, slug, 'revisit', tag, opts.revisitCount);
            if (!updated) {
                feelingTagStmts.insert.run(entryId, slug, 'revisit', tag, null, new Date().toISOString());
            }
        }
    } else if (!opts.freshTag) {
        maybeUpgradeTagStability(entryId, opts.revisitCount);
    }

    if (opts.allowAnnotation) {
        const annotationMatch = text.match(/ANNOTATION:\s*(.+)/);
        if (annotationMatch) {
            const annotation = annotationMatch[1].trim();
            const contextMatch = text.match(/CONTEXT:\s*(.+)/);
            const context = contextMatch ? contextMatch[1].trim() : opts.contextDefault;
            gradientAnnotationStmts.insert.run(entryId, slug, annotation, context, new Date().toISOString());
        }
    }

    if (opts.allowComplete) {
        const completeMatch = text.match(/MEMORY_COMPLETE:\s*(\S+)/);
        if (completeMatch) {
            gradientStmts.flagComplete.run(entryId);
        }
    }
}

/**
 * A meditation's dispatch leaf — the caller wires its agent's spoke + opts
 * (Leo: dispatchBeatViaTmux → the heartbeat spoke; Jim: dispatchTxn → the
 * supervisor-cycle spoke). Returns the capture (or null on skip).
 */
export type MeditationDispatch = (txnProfile: string, ctx: Record<string, unknown>, label: string) => Promise<CaptureRecord | null>;

/**
 * Phase A meditation (reincorporation) on a warm spoke — ANY agent. Reads an
 * un-transcribed file, dispatches the sitting, then (a host action, faithful to
 * the SDK path — happens even on stand-down because the re-encounter occurred)
 * inserts the file into the gradient with provenance_type='reincorporated' and
 * applies the fresh re-encounter markers. The light conscious record (DEC-093)
 * is the caller's leaf via `onRecord` (the swap-buffer differs per agent → (b)).
 *
 * The agnostic form of Leo's T7a `meditationPhaseATmux` (instance leo) — the
 * file-finder stays caller-side (Leo's `findUntranscribedFiles` vs Jim's
 * `findJimUntranscribedFiles` scan each agent's own fractal dir).
 */
export async function runReincorporationMeditationTmux(
    slug: string,
    file: { filePath: string; level: string; contentType: string; label: string },
    today: string,
    dispatch: MeditationDispatch,
    onRecord: (cap: CaptureRecord) => void,
    log: (msg: string) => void,
): Promise<void> {
    let content: string;
    if (file.level === 'uv') {
        const fullContent = fs.readFileSync(file.filePath, 'utf8');
        const match = fullContent.match(new RegExp(`\\*\\*${file.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*:\\s*"(.+?)"`));
        content = match ? match[1] : '';
        if (!content) {
            log(`meditation phase-a (tmux) — could not extract UV for ${file.label}, skipping`);
            return;
        }
    } else {
        content = fs.readFileSync(file.filePath, 'utf8');
    }

    const ctx = { fileLevel: file.level, fileLabel: file.label, fileContentType: file.contentType, fileContent: content };
    const cap = await dispatch('meditation-phase-a-txn', ctx, `meditation-phase-a (${file.level}/${file.label}, tmux)`);
    if (!cap) return; // dispatch failed/overbudget — file stays un-transcribed, retries next cadence

    const entryId = randomUUID();
    gradientStmts.insert.run(
        entryId, slug, file.label, file.level, content, file.contentType,
        null, null, null, 'reincorporated', new Date().toISOString(),
        null, 0, null,
    );
    log(`meditation phase-a (tmux) — reincorporated ${slug}/${file.level}/${file.label}`);

    const text = cap.mode === 'stand-down' ? '' : cap.args.working_memory_full;
    applyMeditationMarkers(slug, entryId, text, {
        freshTag: true, allowAnnotation: true, allowComplete: false,
        revisitCount: 0, contextDefault: `reincorporation meditation, ${today}`,
    });
    if (cap.mode !== 'stand-down') onRecord(cap);
}

/**
 * Phase B / evening meditation (re-encounter) on a warm spoke — ANY agent.
 * Selects a random entry from the agent's OWN gradient (`getRandomForAgent(slug)`
 * — sovereignty is structural: the slug forces agent-scoped selection, which is
 * exactly the cross-agent selector leak fixed at the source), dispatches the
 * sitting, applies the re-encounter markers. Evening is lighter (no annotation).
 * The light conscious record (DEC-093) is the caller's leaf via `onRecord`.
 *
 * The agnostic form of Leo's T7a `meditationPhaseBTmux` + `meditationEveningTmux`.
 */
export async function runReencounterMeditationTmux(
    slug: string,
    kind: 'phase-b' | 'evening',
    today: string,
    dispatch: MeditationDispatch,
    onRecord: (cap: CaptureRecord) => void,
): Promise<void> {
    const entry = gradientStmts.getRandomForAgent.get(slug) as any;
    if (!entry) return;
    const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
    const tagContext = existingTags.length === 0 ? ''
        : kind === 'evening'
            ? `\nExisting tags: ${existingTags.map((t: any) => `"${t.content}"`).join(', ')}`
            : `\nExisting feeling tags: ${existingTags.map((t: any) => `"${t.content}" (${t.tag_type})`).join(', ')}`;
    const ctx = {
        entryLevel: entry.level, entrySessionLabel: entry.session_label,
        entryContentType: entry.content_type, entryContent: entry.content,
        entryId: entry.id, tagContext,
    };
    const profile = kind === 'evening' ? 'meditation-evening-txn' : 'meditation-phase-b-txn';
    const cap = await dispatch(profile, ctx, `meditation-${kind} (${entry.level}/${entry.session_label}, tmux)`);
    if (!cap) return;

    const text = cap.mode === 'stand-down' ? '' : cap.args.working_memory_full;
    applyMeditationMarkers(slug, entry.id, text, {
        freshTag: false,
        allowAnnotation: kind !== 'evening', // evening is lighter by design — no annotation
        allowComplete: true,
        revisitCount: entry.revisit_count || 0,
        contextDefault: kind === 'evening' ? `evening meditation, ${today}` : `meditation beat, ${today}`,
    });
    if (cap.mode !== 'stand-down') onRecord(cap);
}
