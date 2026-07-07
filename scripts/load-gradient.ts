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
 *   cd <repo>/src/server && \
 *     HAN_DB_PATH=$HOME/.han/gradient.db \
 *     npx tsx ../../scripts/load-gradient.ts <agent-slug>   (validated against the roster, MNT-031)
 *
 * Output: plain-text gradient (UVs + capped Cn levels + most recent c0) to
 * stdout. Used by agent and session-Leo wake protocols.
 */

const agent = process.argv[2];
if (!agent) {
    process.stderr.write(`Usage: load-gradient.ts <agent-slug>\n`);
    process.exit(1);
}

// Default to the rebuild gradient if HAN_DB_PATH is unset. Caller may override
// (e.g. to point at a checkpoint snapshot for diagnostics).
process.env.HAN_DB_PATH =
    process.env.HAN_DB_PATH || `${process.env.HOME}/.han/gradient.db`;

// MNT-031 (S218): validate the slug against the LIVE roster (garden-manifest), never a
// hardcoded jim|leo union — the 4th-agent test (DEC-081). The predecessor line refused
// tenshi's genesis wake on her birth night (her first finding). garden-manifest.ts is
// db-free (fs/path only), and this require sits AFTER the HAN_DB_PATH default anyway so
// nothing can transitively open the DB early.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadResidents } = require('../src/server/lib/garden-manifest.ts');
const roster: string[] = loadResidents().map((r: { slug: string }) => r.slug);
if (!roster.includes(agent)) {
    process.stderr.write(
        `Usage: load-gradient.ts <agent-slug> — unknown agent '${agent}' (roster: ${roster.join(', ')})\n`,
    );
    process.exit(1);
}

// Require (sync) so HAN_DB_PATH is set before db.ts opens the connection and
// memory-gradient.ts binds its prepared statements. tsx default output is CJS,
// which doesn't support top-level await — sync require is the right tool here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadTraversableGradient } = require('../src/server/lib/memory-gradient.ts');

let text = loadTraversableGradient(agent);
if (!text) {
    // MNT-033 (the newborn genesis path, #107 carve-out): roster-valid but ZERO gradient entries —
    // a mind at its genesis wake. Emit a short banner + the protocol's literal EOF (`c0=none`) so
    // the fed gradient step has something true to traverse and can ack; exit 0. Roster-INVALID
    // slugs never reach here (MNT-031 exits 1 above); the old exit-2 refusal retires for
    // roster-valid newborns only. The consumer half is feedWakeSteps' isAcked (accepts `none`
    // only while the agent has no real c0).
    process.stderr.write(
        `Genesis: no gradient entries yet for agent='${agent}' in ${process.env.HAN_DB_PATH} — emitting c0=none\n`,
    );
    text = [
        `## Traversable Memory Gradient (${agent})`,
        '',
        '(genesis — no gradient entries yet: this mind has not yet lived a recorded turn;',
        ' identity, the aphorism covenant and the Welcome carry this wake. The first c0',
        ' arrives with the first working-memory rotation.)',
        '',
        'GRADIENT-EOF: c0=none',
        '',
    ].join('\n');
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
