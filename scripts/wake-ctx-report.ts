/**
 * wake-ctx-report.ts <slug> <surface> [YYYY-MM-DD]
 *
 * Prints the per-wake ctx table from the wake-ctx logger (#0, hook `src/hooks/wake-ctx-log.sh`):
 * time | ctx-before | Δ (in the turn) | prompt — the table Jim built by hand from the JSONL today,
 * now a one-shot `cat`. Reads `~/.han/health/wake-ctx-<slug>-<surface>.jsonl` (or the dated archive
 * if a date is given). Read-only; no deps beyond Node.
 *
 *   cd src/server && npx tsx ../../scripts/wake-ctx-report.ts leo session
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const [slug, surface, date] = process.argv.slice(2);
if (!slug || !surface) {
    console.error('usage: wake-ctx-report.ts <slug> <surface> [YYYY-MM-DD]');
    process.exit(2);
}

const health = process.env.HAN_HEALTH_DIR || path.join(os.homedir(), '.han', 'health');
const file = date
    ? path.join(health, `wake-ctx-${slug}-${surface}-${date}.jsonl`)
    : path.join(health, `wake-ctx-${slug}-${surface}.jsonl`);

if (!fs.existsSync(file)) { console.error(`no wake-ctx log at ${file}`); process.exit(1); }

interface Rec { ts: string; event: string; ctx_pct: number | null; prompt?: string; }
const recs: Rec[] = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as Rec; } catch { return null; } })
    .filter((r): r is Rec => r !== null);

const hhmmss = (ts: string) => (ts || '').slice(11, 19);
const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${v}%` : '?');

console.log(`wake-ctx — ${slug}/${surface}${date ? ` ${date}` : ''}   (${file})`);
console.log('time(Z)  | ctx-before |   Δ   | prompt');
console.log('-'.repeat(72));

// Pair each prompt with its LAST complete before the next prompt — the Stop hook can fire
// more than once per logical turn (memory-guard blocks-then-passes), so the latest complete
// is the true post-turn ctx. A prompt with no complete yet = the in-flight turn.
let pending: Rec | null = null;
let lastComplete: Rec | null = null;
const flush = () => {
    if (pending) printRow(pending, lastComplete, lastComplete ? undefined : '(in-flight)');
    pending = null; lastComplete = null;
};
for (const r of recs) {
    if (r.event === 'prompt') { flush(); pending = r; }
    else if (r.event === 'complete') { lastComplete = r; }
}
flush();

function printRow(p: Rec | null, c: Rec | null, note?: string): void {
    const before = p?.ctx_pct, after = c?.ctx_pct;
    const delta = (typeof before === 'number' && typeof after === 'number')
        ? `${after - before >= 0 ? '+' : ''}${after - before}`
        : (note ?? '?');
    const t = hhmmss(p?.ts || c?.ts || '');
    const prompt = (p?.prompt || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`${t} | ${pct(before).padStart(10)} | ${delta.padStart(5)} | ${prompt}`);
}
