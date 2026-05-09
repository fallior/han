/**
 * Memory paired-writer — atomic both-or-neither appends to the working-memory
 * pair (working-memory-full.md + working-memory.md).
 *
 * Future-idea #49 (S153, 2026-05-09): structural prevention of single-side
 * writes that produce silent c0/c1 drift in the gradient. Sibling-shape to
 * #53's pre-slice parity-check + drift signal. #53 detects drift after the
 * fact via fs.watch; #49 prevents drift at the API layer. Both layers run.
 *
 * Maturity-arc placement (per Jim's S150-extended pattern):
 *   1. Two-surface audit (static)               — static-time guarantee
 *   2. Pre-slice parity-check + drift signal    — runtime visibility (#53)
 *   3. Slice-time parity-check + smaller-of-two — runtime recovery (DEC-085)
 *   4. ATOMIC PAIRED-WRITE HELPER (THIS FILE)   — runtime prevention (#49)
 *   5. UserPromptSubmit hook                    — harness-enforced (#50)
 *
 * Contract:
 *   - Both content args required at the type level (TypeScript signature
 *     enforces; cannot be called single-side).
 *   - If both contents are empty (after trim), helper returns no-op.
 *   - If one content is empty and the other non-empty, helper THROWS — that
 *     is the drift mode this helper exists to prevent. Callers must validate
 *     symmetry upstream and preserve their swap state for retry / observation.
 *   - If both contents are non-empty, helper acquires the memory-slot lock
 *     (via withMemorySlot) and appends both files. On second-write failure,
 *     truncates the first file back to its pre-append size — both-or-neither
 *     at the FS level for the failure mode that matters.
 *
 * The throw on asymmetry is the load-bearing piece: it's what makes
 * single-side writes impossible by construction. Callers can't accidentally
 * pass empty for one and substantial for the other; if they do, the caller
 * gets a loud error and the data isn't lost (it stays in their swap files).
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradientConfigForAgent } from './agent-registry';
import { withMemorySlot } from './memory-slot';

export interface AppendPairedMemoryOpts {
    /** Caller identifier for log context (e.g. 'leo-human-flush'). */
    source?: string;
}

/**
 * Append paired content to the working-memory pair atomically (best-effort
 * at the FS level via rollback-on-second-failure; structurally enforced at
 * the API level).
 *
 * @param agent - Agent slug ('leo', 'jim', 'tenshi', 'casey', ...)
 * @param fullContent - Content to append to working-memory-full.md (must
 *                      be non-empty if compressedContent is non-empty)
 * @param compressedContent - Content to append to working-memory.md (must
 *                            be non-empty if fullContent is non-empty)
 * @param opts.source - Optional caller identifier for log context
 *
 * @throws Error if content is asymmetric (one side empty, the other not).
 * @throws Error if the second append fails (after rolling back the first).
 *               Rollback failure is logged but not re-thrown beyond the
 *               original error — files may be in inconsistent state in
 *               that worst-case scenario; manual intervention warranted.
 */
export async function appendPairedMemory(
    agent: string,
    fullContent: string,
    compressedContent: string,
    opts: AppendPairedMemoryOpts = {},
): Promise<void> {
    const cfg = gradientConfigForAgent(agent);
    const fullPath = path.join(cfg.memoryDir, 'working-memory-full.md');
    const compPath = path.join(cfg.memoryDir, 'working-memory.md');
    const source = opts.source ?? 'unknown';

    const fullPresent = !!fullContent.trim();
    const compPresent = !!compressedContent.trim();

    // No-op for both-empty (legitimate "nothing to flush" case)
    if (!fullPresent && !compPresent) return;

    // Refuse asymmetric — preserves the structural promise.
    // Callers must validate symmetry upstream; on throw, swap state is
    // preserved (caller hasn't cleared swap yet) so next flush retries.
    if (fullPresent !== compPresent) {
        throw new Error(
            `appendPairedMemory: asymmetric content from ${source} for ${agent} ` +
            `(full=${fullContent.length}c present=${fullPresent}, ` +
            `comp=${compressedContent.length}c present=${compPresent}). ` +
            `Caller must pass both-or-neither; preserve swap state and retry.`,
        );
    }

    // Both present — pair-write under lock with rollback-on-second-failure
    const slotResult = await withMemorySlot(cfg.memoryDir, `${agent}-paired-write`, () => {
        const fullSizeBefore = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
        fs.appendFileSync(fullPath, fullContent);
        try {
            fs.appendFileSync(compPath, compressedContent);
            return true;
        } catch (err) {
            // Roll back the full append — both-or-neither at the FS level.
            try {
                fs.truncateSync(fullPath, fullSizeBefore);
            } catch (truncErr) {
                console.error(
                    `[appendPairedMemory] CRITICAL: rollback truncate failed for ${agent} (${source}): ` +
                    `${(truncErr as Error).message}. Files may be in inconsistent state — manual intervention warranted.`,
                );
            }
            throw new Error(
                `appendPairedMemory: comp append failed for ${agent} (${source}); ` +
                `rolled back full append: ${(err as Error).message}`,
            );
        }
    });

    // withMemorySlot returns null if it fails to acquire the lock after
    // MAX_RETRIES. Treat that as a failure to write — caller should preserve
    // swap state and retry next cycle.
    if (slotResult === null) {
        throw new Error(
            `appendPairedMemory: failed to acquire memory slot for ${agent} (${source}). ` +
            `Caller must preserve swap state and retry.`,
        );
    }
}
