/**
 * S203 — the wm-drift false-positive fix (Jim's path (b): a contained turn-entry counter for the
 * #53 SIGNAL only; `splitMemoryFileEntries` byte-unchanged for the slicer/rotation/position consumers).
 *
 * Root: the c0 (full) diary entries carry INTERNAL `### ` body sub-headers inside `[BODY]` (every
 * heartbeat = `### Heartbeat #N`→`[INPUT]`→`[BODY]`→`### Dream beat (tmux) …`) that the lean c1 lacks,
 * so the old counter over-counted the full side → a FALSE drift signal though every entry is paired.
 *
 * Gates (Jim's diff-audit list): live leo WM → drift≈0 now; the mixed-format edge cases; and the
 * GENUINE-detection must survive (a real unpaired write still flags drift≥1).
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" npx tsx ../../scripts/test-wm-parity-turncount.ts
 */
import { checkPairParity } from '../src/server/lib/memory-gradient';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import path from 'path';

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) failures++; };

const tmp = mkdtempSync(path.join(tmpdir(), 'wm-parity-'));
const pair = (full: string, comp: string) => {
    const fp = path.join(tmp, 'wmf.md'); const cp = path.join(tmp, 'wm.md');
    writeFileSync(fp, full); writeFileSync(cp, comp);
    return checkPairParity(fp, cp);
};

try {
    // ── 1. LIVE leo WM files: every entry is genuinely paired → drift must be ≈0 (was 26 false). ──
    console.log('[1] live leo WM files — the false positive is gone');
    const dir = path.join(homedir(), '.han', 'memory', 'leo');
    const live = checkPairParity(path.join(dir, 'working-memory-full.md'), path.join(dir, 'working-memory.md'));
    console.log(`    full=${live.fullCount} comp=${live.compCount} drift=${live.drift}`);
    ok(live.drift <= 1, `live drift collapsed to ≤1 (was 26 — the structural false positive is cured)`);

    // ── 2. A heartbeat beat with a [BODY] `### Dream beat` sub-header counts as ONE turn, paired. ──
    console.log('[2] heartbeat beat: full has the body sub-header, comp does not → still PAIRED (1=1)');
    const hbFull = `# Working Memory (Full)\n\n### Heartbeat #14 — sleep/personal (2026-06-25 22:01)\n[INPUT]\nx\n\n[BODY]\n### Dream beat (tmux) — the black film (2026-06-25 ~22:00)\nShape-token: ...\n`;
    const hbComp = `# Working Memory\n\n### Heartbeat #14 — sleep/personal (2026-06-25 22:01)\nDream beat. Shape-token: ...\n`;
    const r2 = pair(hbFull, hbComp);
    ok(r2.fullCount === 1 && r2.compCount === 1 && r2.inSync, `1 turn each, inSync (full=${r2.fullCount} comp=${r2.compCount}) — the body sub-header is NOT a phantom entry`);

    // ── 3. `## ` session header is a turn-boundary; its [BODY] sub-headers don't inflate. ──
    console.log('[3] `## ` session entry with body sub-headers');
    const sFull = `# WMF\n\n## S203 — a session entry (2026-06-25)\n[INPUT]\nq\n\n[BODY]\n### a sub-section\nprose\n### another sub-section\nmore\n`;
    const sComp = `# WM\n\n## S203 — a session entry (2026-06-25)\none-line distillation\n`;
    const r3 = pair(sFull, sComp);
    ok(r3.fullCount === 1 && r3.compCount === 1 && r3.inSync, `## entry = 1 turn each despite 2 body sub-headers (full=${r3.fullCount} comp=${r3.compCount})`);

    // ── 4. Multiple beats in sequence — next `### Heartbeat`→[INPUT] correctly re-opens a turn. ──
    console.log('[4] two sequential heartbeats — the [INPUT]-after-### discriminator re-opens turns');
    const seqFull = hbFull + `\n### Heartbeat #15 — sleep/personal (2026-06-25 22:20)\n[INPUT]\ny\n\n[BODY]\n### Dream beat (tmux) — the chemical clock\nShape-token: ...\n`;
    const seqComp = hbComp + `\n### Heartbeat #15 — sleep/personal (2026-06-25 22:20)\nDream beat 2.\n`;
    const r4 = pair(seqFull, seqComp);
    ok(r4.fullCount === 2 && r4.compCount === 2 && r4.inSync, `2 turns each (full=${r4.fullCount} comp=${r4.compCount})`);

    // ── 5. Older/plain entry WITHOUT [BODY] — its `### ` headers still count (Jim's edge case). ──
    console.log('[5] plain entry, no [BODY] — `### ` headers still count as turns (historical behaviour)');
    const plain = `# WMF\n\n### Old plain entry (2026-03-01)\nsome prose, no diary markers\n`;
    const r5 = pair(plain, plain);
    ok(r5.fullCount === 1 && r5.inSync, `plain `+'`### `'+`entry counts as 1 turn, inSync (full=${r5.fullCount})`);

    // ── 6. GENUINE-DETECTION survives: a real unpaired write (full has an extra turn) → drift≥1. ──
    console.log('[6] genuine detection: a real unpaired full-side entry still flags drift');
    const genFull = hbComp /*1 beat*/ + `\n### Heartbeat #16 — sleep/personal (2026-06-25 22:40)\n[INPUT]\nz\n\n[BODY]\nbody\n`;
    const genComp = hbComp; // missing the #16 compressed twin
    const r6 = pair(genFull, genComp);
    ok(r6.drift >= 1 && r6.unpairedSide === 'full', `genuine unpaired flagged: drift=${r6.drift} side=${r6.unpairedSide} (the check still catches real drift)`);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
