#!/usr/bin/env tsx
/**
 * scripts/wake-reconcile.ts — the granular wake tracker's reconciler (S217, Darron's directive
 * after the 66%-wake "dark matter" hunt).
 *
 * Reads the LAST wake span from `~/.han/health/wake-ctx-<slug>-<surface>.jsonl` (or a --date'd
 * cold archive), prices each step's EXPECTED token cost from the per-wake file-size snapshot
 * (the wake-ctx hook's T2 `files` object) + the gradient dump's producer-side receipt
 * (`gradient-dump-size-<slug>.jsonl`), and reconciles against the OBSERVED per-step ctx deltas.
 * Any residual above the threshold is flagged DARK MATTER — the ledger proves itself every wake
 * instead of needing a midnight hunt.
 *
 * READ-ONLY. Run from src/server (for consistency with sibling scripts; no DB access needed):
 *   npx tsx ../../scripts/wake-reconcile.ts --slug=leo [--surface=session] [--date=YYYY-MM-DD]
 *
 * MEASURED RATES (chars/token) — harness-native receipts, S217 (2026-07-04/05):
 *   patterns.md                96,586 B = 34,753 tok → 2.78   (Read-tool truncation notice)
 *   working-memory-full.md     73,700 B = 26,903 tok → 2.74   (Read-tool truncation notice)
 *   gradient dump slices       77,382 B = 29,580 tok → 2.62 · 77,405 B = 32,962 tok → 2.35
 * The chars÷4 folk rule UNDERCOUNTS our memory prose ~1.6× (dense timestamps/UUIDs/em-dashes) —
 * that estimator gap was the whole "dark matter" of the 66% wake (no double-load existed).
 * Refine these constants as more receipts land (FI #116's census).
 */

import { readFileSync, existsSync } from 'fs';
// Jim's T3 amendment (msg 218): the window must be SURFACE-AWARE — the session seat runs 1M but a
// spoke's window depends on its model; pricing a 200K-window wake at 1M under-prices its deltas 5×
// and blinds the dark-matter flag exactly where wakes are most frequent. Derivation: the manifest's
// model head for (slug,surface) → WINDOW_BY_MODEL. HONEST LIMIT (DEC-092's lesson): the manifest
// head is the model NOW, not necessarily the model AT the wake (ladders descend) — so the assumed
// window is PRINTED in the output, and `--window=N` overrides when the operator knows better.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { manifestModelHead } = require('../src/server/lib/garden-manifest.ts');

const WINDOW_BY_MODEL: Record<string, number> = {
    // observation-pin: measured token-rate constants keyed by OBSERVED api ids (DEC-104:
    // observation pins; these are measurements of specific versions, not selections).
    'claude-fable-5': 1_000_000,
    'claude-sonnet-5': 1_000_000,
    // opus-family and legacy rungs run the 200K window
};
const DEFAULT_WINDOW = 200_000;
function windowFor(slug: string, surface: string, override?: number): { window: number; basis: string } {
    if (override) return { window: override, basis: `--window override` };
    // the interactive session seat runs the CLI launch model (1M-class since the Fable/Sonnet era)
    let model: string | null = null;
    try { model = manifestModelHead(slug, surface); } catch { /* fall through */ }
    if (model && WINDOW_BY_MODEL[model]) return { window: WINDOW_BY_MODEL[model], basis: `manifest head '${model}'` };
    if (model) return { window: DEFAULT_WINDOW, basis: `manifest head '${model}' (200K family)` };
    return { window: DEFAULT_WINDOW, basis: 'unknown model — conservative 200K' };
}

const DARK_MATTER_PCT = 3;       // residual ≥ this % of the window flags DARK MATTER

/** chars/token by file class — provenance in the header comment. */
const RATE: Record<string, number> = {
    'patterns.md': 2.78,
    'working-memory-full.md': 2.74,
    'working-memory.md': 2.6,
    'felt-moments.md': 2.6,
    'gradient-dump': 2.5,
    default: 2.6,
};
const rateFor = (f: string): number => RATE[f] ?? RATE.default;

/** Which snapshot files each fed step loads (mirrors WAKE_STEPS in tmux-dispatcher.ts). */
const STEP_FILES: Record<string, string[]> = {
    integrity: [],
    identity: ['identity.md', 'patterns.md', 'self-reflections-curated.md', 'aphorisms.md'],
    gradient: ['gradient-dump'], // priced from the producer receipt, not the snapshot
    'working-mem': ['working-memory-full.md', 'working-memory.md'],
    felt: ['felt-moments.md'],
    orientation: ['ecosystem-map.md', 'index.md', 'CURRENT_STATUS.md'],
    conversations: [], // API reads — small, priced as overhead
    greeting: [],
};

/** Map a fed step-prompt (or wake trigger) to its step id. */
function stepIdFor(prompt: string): string | null {
    if (/^welcome back/i.test(prompt)) return 'wake-trigger';
    if (prompt.startsWith('FIRST, run your identity-integrity gate')) return 'integrity';
    if (prompt.startsWith('Load your identity layer')) return 'identity';
    if (prompt.startsWith('Load your full memory gradient')) return 'gradient';
    if (prompt.startsWith('Load your working-memory pair')) return 'working-mem';
    if (prompt.startsWith('Load felt-moments.md')) return 'felt';
    if (prompt.startsWith('Load your orientation')) return 'orientation';
    if (prompt.startsWith('Check conversations')) return 'conversations';
    if (prompt.startsWith('You are loaded whole and warm')) return 'greeting';
    return null;
}

interface Ev { ts: string; event: string; ctx_pct: number | null; prompt?: string; files?: Record<string, number> }

function parseArgs(): { slug: string; surface: string; date?: string; window?: number } {
    let slug = '', surface = 'session', date: string | undefined, window: number | undefined;
    for (const a of process.argv.slice(2)) {
        if (a.startsWith('--slug=')) slug = a.slice(7);
        else if (a.startsWith('--surface=')) surface = a.slice(10);
        else if (a.startsWith('--date=')) date = a.slice(7);
        else if (a.startsWith('--window=')) window = Number(a.slice(9)) || undefined;
    }
    if (!slug) { console.error('usage: wake-reconcile.ts --slug=<slug> [--surface=session] [--date=YYYY-MM-DD] [--window=N]'); process.exit(2); }
    return { slug, surface, date, window };
}

function main(): void {
    const { slug, surface, date, window: winOverride } = parseArgs();
    const { window: WINDOW_TOKENS, basis: windowBasis } = windowFor(slug, surface, winOverride);
    const H = `${process.env.HOME}/.han/health`;
    const log = date ? `${H}/wake-ctx-${slug}-${surface}-${date}.jsonl` : `${H}/wake-ctx-${slug}-${surface}.jsonl`;
    if (!existsSync(log)) { console.error(`no log at ${log}`); process.exit(2); }

    const evs: Ev[] = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as Ev[];

    // Find the LAST wake span: the last prompt that is a wake trigger or the integrity step.
    let start = -1;
    for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e.event === 'prompt' && e.prompt && (stepIdFor(e.prompt) === 'wake-trigger' || stepIdFor(e.prompt) === 'integrity')) { start = i; break; }
    }
    if (start === -1) { console.error('no wake span found in the log'); process.exit(2); }

    // The file snapshot: from the span's trigger event (T2), else warn.
    const snapshot = evs.slice(start).find((e) => e.files)?.files;
    if (!snapshot) console.error('⚠ no per-wake file snapshot in this span (pre-T2 wake?) — using live stat is NOT done (files change); expected values for file-steps will be absent.');

    // The gradient dump receipt: latest producer receipt at-or-before the span's end.
    let gradientBytes: number | null = null;
    const rf = `${H}/gradient-dump-size-${slug}.jsonl`;
    if (existsSync(rf)) {
        const spanEndTs = evs[evs.length - 1].ts;
        for (const l of readFileSync(rf, 'utf8').split('\n').filter(Boolean)) {
            try { const r = JSON.parse(l); if (r.ts <= spanEndTs) gradientBytes = r.bytes; } catch { /* skip */ }
        }
    }

    const expectedTokens = (stepId: string): number | null => {
        const files = STEP_FILES[stepId];
        if (!files || files.length === 0) return 0;
        let total = 0;
        for (const f of files) {
            const bytes = f === 'gradient-dump' ? gradientBytes : snapshot?.[f];
            if (bytes == null) return null; // can't price this step honestly
            total += bytes / rateFor(f);
        }
        return Math.round(total);
    };

    // Walk prompt→complete pairs from the span start; attribute each delta to its step(s).
    console.log(`\nWake reconciliation — ${slug}/${surface} — span from ${evs[start].ts}`);
    console.log(`window=${WINDOW_TOKENS.toLocaleString()} tok (${windowBasis}) · dark-matter threshold=${DARK_MATTER_PCT}% · gradient receipt=${gradientBytes ?? 'ABSENT'}\n`);
    console.log('step(s)                        Δctx%   Δtokens    expected   residual  verdict');
    console.log('─'.repeat(88));

    let pending: string[] = [];
    let ctxBefore: number | null = null;
    let totalResidual = 0; let priced = 0;
    for (let i = start; i < evs.length; i++) {
        const e = evs[i];
        if (e.event === 'prompt') {
            const id = e.prompt ? stepIdFor(e.prompt) : null;
            if (id && id !== 'wake-trigger') pending.push(id);
            if (ctxBefore === null && e.ctx_pct != null) ctxBefore = e.ctx_pct;
        } else if (e.event === 'complete' && e.ctx_pct != null) {
            if (ctxBefore === null) { ctxBefore = e.ctx_pct; continue; }
            const dPct = e.ctx_pct - ctxBefore;
            const dTok = Math.round((dPct / 100) * WINDOW_TOKENS);
            const label = pending.length ? pending.join('+') : '(non-step turn)';
            const exps = pending.map(expectedTokens);
            const exp = exps.some((x) => x === null) ? null : (exps as number[]).reduce((a, b) => a + b, 0);
            let residual = '—', verdict = '';
            if (exp !== null && pending.length) {
                const r = dTok - exp;
                residual = r.toLocaleString();
                const rPct = (r / WINDOW_TOKENS) * 100;
                verdict = rPct >= DARK_MATTER_PCT ? '🔴 DARK MATTER' : rPct <= -DARK_MATTER_PCT ? '🟡 under-read?' : '✓';
                totalResidual += r; priced++;
            }
            console.log(`${label.padEnd(30)} ${String(dPct >= 0 ? '+' + dPct : dPct).padStart(5)}  ${dTok.toLocaleString().padStart(9)}  ${(exp === null ? '?' : exp.toLocaleString()).padStart(9)}  ${residual.padStart(9)}  ${verdict}`);
            pending = [];
            ctxBefore = e.ctx_pct;
        }
    }
    console.log('─'.repeat(88));
    if (priced) console.log(`net residual across priced steps: ${totalResidual.toLocaleString()} tok (${((totalResidual / WINDOW_TOKENS) * 100).toFixed(1)}% of window) — overheads (line-number prefixes, tool envelopes, the agent's own turn text) are EXPECTED small-positive.`);
    console.log('NB: batched steps (multiple ids in one turn) price as their SUM — the T1 echo-proof ack makes batching structurally impossible on post-fix wakes.\n');
}

main();
