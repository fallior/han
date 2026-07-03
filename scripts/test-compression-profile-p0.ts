/**
 * test-compression-profile-p0.ts — P0 of the compressor migration (Addendum 2).
 * The re-aimed content-diff acceptance: compose-critical text VERBATIM (the 1/3-target
 * instruction, the INCOMPRESSIBLE contract, the task lines, the FEELING_TAG ask) + the FULL
 * uniform bank present (identity enrichment conscious, not silent).
 */
import { buildPrompt } from '../src/server/lib/prompt-builder';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

const built = buildPrompt('leo', 'compression', {
    fromLevel: 'c2', toLevel: 'c3',
    sourceTokens: 300, targetTokens: 100,
    sourceSessionLabel: 'test-session', sourceContentType: 'session',
    sourceContent: 'SYNTHETIC-SOURCE-CONTENT-MARKER',
});

console.log('P0 compression profile (Addendum 2 — full uniform self):');
// Compose-critical VERBATIM (from the retired child, byte-for-byte):
check('1/3-target instruction verbatim', built.systemPrompt.includes('The compression target is approximately 1/3 the TOKEN length of the source. Preserve what feels essential — what shape, what felt-texture, what would survive forgetting. Drop what is incidental. The compression is an act of identity, not summary.'));
check('INCOMPRESSIBLE contract verbatim', built.systemPrompt.includes('respond with the literal token "INCOMPRESSIBLE:" followed by a single sentence (max 50 chars) capturing the irreducible kernel. This is not failure. This is arrival.'));
check('task line verbatim shape', built.userPrompt.includes('Compress this c2 → c3. Target ~100 tokens (1/3 of source 300 tokens).'));
check('source metadata lines', built.userPrompt.includes('Source session: test-session') && built.userPrompt.includes('Source content_type: session'));
check('source content present', built.userPrompt.includes('SYNTHETIC-SOURCE-CONTENT-MARKER'));
check('FEELING_TAG ask verbatim', built.userPrompt.includes('on a new line starting with FEELING_TAG:, write a short phrase (under 100 characters) describing what compressing this felt like — not the content, but the quality of the act.'));
// The enrichment — the FULL uniform bank (no overrides):
check('uniform bank loaded (memory_chars > 100k chars)', built.meta.memory_chars > 100_000);
check('envelope=system (memory rides system, as the child did)', built.meta.envelope === 'system');
const comp = built.meta.component_breakdown as Record<string, number>;
check('identity component present', (comp['identity'] ?? 0) > 0);
check('aphorisms component present', (comp['aphorisms'] ?? 0) > 0);
check('patterns component present', (comp['patterns'] ?? 0) > 0);
check('gradient component present (full traversable, not the child\'s sample)', (comp['gradient'] ?? 0) > 0);
console.log('  enrichment enumeration (component: chars):', JSON.stringify(comp));
console.log(`\ncompression-profile-p0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
