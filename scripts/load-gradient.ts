#!/usr/bin/env tsx
/**
 * scripts/load-gradient.ts
 *
 * Loads the rebuild gradient (~/.han/gradient.db) for the named agent with the
 * cap formula applied (DEC-068: c0=1, then 3n; all UVs).
 *
 * Wraps `loadTraversableGradient` from `lib/memory-gradient.ts`. The library
 * function reads gradient_entries via prepared statements bound to whatever DB
 * the server's db.ts module is connected to — which is `~/.han/gradient.db` by
 * default since the 2026-04-29 cutover (DEC-080 Phase 5; the variable name
 * `TASKS_DB_PATH` in db.ts:37 is preserved pending Phase 12 rename). Setting
 * HAN_DB_PATH before the import (which transitively imports db.ts) routes the
 * prepared statements at a different DB (e.g. a checkpoint snapshot for
 * diagnostics).
 *
 * Invocation (from src/server so node resolves better-sqlite3 etc.):
 *   cd /home/darron/Projects/han/src/server && \
 *     HAN_DB_PATH=$HOME/.han/gradient.db \
 *     npx tsx ../../scripts/load-gradient.ts <jim|leo>
 *
 * Output: plain-text gradient (UVs + capped Cn levels + most recent c0) to
 * stdout. Used by agent and session-Leo wake protocols.
 */

const agent = process.argv[2];
if (agent !== 'jim' && agent !== 'leo') {
    process.stderr.write(`Usage: load-gradient.ts <jim|leo>\n`);
    process.exit(1);
}

// Default to the rebuild gradient if HAN_DB_PATH is unset. Caller may override
// (e.g. to point at a checkpoint snapshot for diagnostics).
process.env.HAN_DB_PATH =
    process.env.HAN_DB_PATH || `${process.env.HOME}/.han/gradient.db`;

// Require (sync) so HAN_DB_PATH is set before db.ts opens the connection and
// memory-gradient.ts binds its prepared statements. tsx default output is CJS,
// which doesn't support top-level await — sync require is the right tool here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadTraversableGradient } = require('../src/server/lib/memory-gradient.ts');

const text = loadTraversableGradient(agent);
if (!text) {
    process.stderr.write(
        `No gradient entries for agent='${agent}' in ${process.env.HAN_DB_PATH}\n`,
    );
    process.exit(2);
}

// T2 (the S217 wake tracker): producer-side dump-size receipt. The gradient dump is the one
// VARIABLE-size wake input (the standard files are statted by the wake-ctx hook's per-wake
// snapshot), so the producer records what it actually emitted — the reconciler
// (wake-reconcile.ts) prices the gradient step from this, never from a guess. Fail-open:
// telemetry must never break the load.
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { appendFileSync, mkdirSync } = require('fs');
    const dir = `${process.env.HOME}/.han/health`;
    mkdirSync(dir, { recursive: true });
    appendFileSync(
        `${dir}/gradient-dump-size-${agent}.jsonl`,
        JSON.stringify({ ts: new Date().toISOString(), agent, bytes: Buffer.byteLength(text, 'utf8') }) + '\n',
    );
} catch { /* fail-open */ }

process.stdout.write(text);
