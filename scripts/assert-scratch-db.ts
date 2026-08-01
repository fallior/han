// assert-scratch-db.ts — the structural test-isolation gate (MNT-075 M1, Tenshi's shape).
//
// THE CLASS THIS CLOSES: an in-process suite sets `process.env.HAN_DB_PATH` at module
// top and then does a static `import { db }` — but ES-module imports HOIST above
// top-level statements, so db.ts resolves its path before the assignment runs and the
// suite silently writes its fixtures into the LIVE ~/.han/gradient.db. That exact
// mechanism put six test rows in production on 2026-08-01 (Jim's diff-audit catch —
// found by RUNNING, and by the idempotence canary: a second run collided).
//
// THE RULE FOR IN-PROCESS DB SUITES (both limbs, always):
//   1. Set HAN_DB_PATH, then load server modules via DYNAMIC `await import(...)`
//      (or set the env at the spawn boundary like test-state-copy/test-han-migrate).
//   2. Call assertScratchDb(db) BEFORE the first write. A wrong resolution aborts
//      loud — a write to prod is unrepresentable, not merely discouraged (the
//      make-it-unwriteable move: the model-pin gate and .gitattributes, pointed at
//      test isolation).

import * as os from 'node:os';
import * as path from 'node:path';

/** Abort unless the handle is a genuinely scratch database: HAN_DB_PATH explicitly
 *  set, the handle resolved to exactly that path, and nowhere near ~/.han. */
export function assertScratchDb(db: { name: string }): void {
    const declared = process.env.HAN_DB_PATH;
    const resolved = path.resolve(db.name);
    const hanHome = path.join(os.homedir(), '.han');
    if (!declared) {
        throw new Error(`assertScratchDb: HAN_DB_PATH is not set — an in-process db suite must declare its scratch path before importing server modules (db resolved to ${resolved})`);
    }
    if (resolved !== path.resolve(declared)) {
        throw new Error(`assertScratchDb: db resolved to ${resolved}, not the declared scratch path ${declared} — the import was hoisted above the env assignment; use await import(...) AFTER setting HAN_DB_PATH`);
    }
    if (resolved.startsWith(hanHome + path.sep) || resolved === hanHome) {
        throw new Error(`assertScratchDb: db path ${resolved} is inside ${hanHome} — REFUSING to run a test against the live garden store`);
    }
}
