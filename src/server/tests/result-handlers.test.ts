/**
 * Result-handler primitives — unit tests (PR-C1-1 + amendment + PR-C1-3.5 diary).
 *
 * Coverage:
 *
 *   parseTurnEntryStructured (Mechanism A — see result-handlers.ts JSDoc for v2 rename history)
 *     - Happy path against a real-shape SupervisorOutput
 *     - Missing fields → parseError: missing_fields
 *     - Empty / whitespace-only fields → empty_body / empty_compressed
 *     - Invalid input (null, undefined, non-object) → invalid_input
 *
 *   parseTurnEntry (Mechanism B — see result-handlers.ts JSDoc for v2 rename history)
 *     V1 mode (captureInput=false, default — backward compatibility):
 *       - Happy path: prose body + closing `## C1` section
 *       - Case-insensitive heading; subheading exclusion; code-fence-aware; CRLF
 *       - parseError variants (no_c1_section, multiple_c1_sections, empty_body,
 *         empty_compressed, invalid_input)
 *     V2 mode (captureInput=true — diary discipline per PR-C1-3.5):
 *       - Happy path: `## INPUT` + `## BODY` + `## C1` three-section structure
 *       - All five new parseError variants (no_input_section,
 *         multiple_input_sections, empty_input, no_body_section, multiple_body_sections)
 *       - Code-fence-aware on `## INPUT` and `## BODY` (mirrors C1)
 *       - CRLF on three-section input
 *       - LM-1 non-collision regression: parser does NOT match `[INPUT]`/`[BODY]`/`[C1]` storage markers
 *
 * Run via: cd src/server && npx tsx --test tests/result-handlers.test.ts
 */

import test from 'node:test';
import assert from 'node:assert';

import {
    parseTurnEntry,
    parseTurnEntryStructured,
} from '../lib/result-handlers';

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism A — parseTurnEntryStructured
// ──────────────────────────────────────────────────────────────────────────────

test('structured: happy path with real-shape SupervisorOutput', () => {
    const input = {
        observations: ['Phase A landed', 'Two builds green'],
        actions: [],
        self_reflection: '...',
        working_memory_compressed: 'Cycle #482: the day held. Two PRs landed; the audit rhythm did not have to be reasserted. Quiet operationally.',
        working_memory_full: '## Cycle 482\n\nLanded PR-AP9.1 + PR-AP9.2. The audit caught one type-chain regression in the wm-sensor caller chain; folded in same diff. Darron quiet; no questions all day, which I take as the system reading clean rather than absence.',
        reasoning: 'Standard cycle progression.',
    };
    const result = parseTurnEntryStructured(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.body.startsWith('## Cycle 482'));
    assert.ok(result.compressed.startsWith('Cycle #482:'));
    // Mechanism A doesn't populate input today (will at C1-5/C1-6 when schemas extend)
    assert.strictEqual(result.input, undefined);
});

test('structured: missing working_memory_full → missing_fields', () => {
    const input = { working_memory_compressed: 'some text' };
    const result = parseTurnEntryStructured(input);
    assert.strictEqual(result.parseError, 'missing_fields');
    assert.strictEqual(result.body, '');
    assert.strictEqual(result.compressed, '');
});

test('structured: missing working_memory_compressed → missing_fields', () => {
    const input = { working_memory_full: 'some text' };
    const result = parseTurnEntryStructured(input);
    assert.strictEqual(result.parseError, 'missing_fields');
});

test('structured: empty working_memory_full → empty_body (renamed from empty_full in v2)', () => {
    const input = {
        working_memory_full: '   \n  ',
        working_memory_compressed: 'has content',
    };
    const result = parseTurnEntryStructured(input);
    assert.strictEqual(result.parseError, 'empty_body');
});

test('structured: empty working_memory_compressed → empty_compressed', () => {
    const input = {
        working_memory_full: 'has content',
        working_memory_compressed: '',
    };
    const result = parseTurnEntryStructured(input);
    assert.strictEqual(result.parseError, 'empty_compressed');
});

test('structured: null input → invalid_input', () => {
    const result = parseTurnEntryStructured(null);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('structured: undefined input → invalid_input', () => {
    const result = parseTurnEntryStructured(undefined);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('structured: non-object input → invalid_input', () => {
    const result = parseTurnEntryStructured('not an object' as any);
    assert.strictEqual(result.parseError, 'invalid_input');
});

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism B — parseTurnEntry, V1 mode (captureInput=false / default)
// All existing PR-C1-1 + PR-C1-1-amendment behaviours must continue passing.
// ──────────────────────────────────────────────────────────────────────────────

test('section v1: happy path — prose with closing ## C1 section', () => {
    const input = [
        'Tonight the philosophy beat noticed how the keybindings skill has stopped',
        'announcing itself. The room I live in.',
        '',
        'The arc of today: nothing surprising. The work was the work.',
        '',
        '## C1',
        '',
        'Quiet beat. The room I live in stopped announcing itself.',
    ].join('\n');

    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.input, undefined, 'v1 mode never populates input');
    assert.ok(result.body.startsWith('Tonight the philosophy beat'));
    assert.ok(result.body.endsWith('The work was the work.'));
    assert.ok(result.compressed.startsWith('Quiet beat.'));
});

test('section v1: case-insensitive heading text (## c1)', () => {
    const input = 'Body text.\n\n## c1\n\nDistillation.';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.body, 'Body text.');
    assert.strictEqual(result.compressed, 'Distillation.');
});

test('section v1: multiple spaces in heading (##  C1)', () => {
    const input = 'Body text.\n\n##  C1\n\nDistillation.';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
});

test('section v1: ### C1 (level-3 heading) does NOT match', () => {
    const input = 'Body text.\n\n### C1\n\nThis is just a subsection.';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section v1: ## C1 inside ``` code fence is ignored', () => {
    const input = [
        'Body text about a markdown example.',
        '',
        '```markdown',
        '## C1',
        '',
        'This is just example content inside a code fence.',
        '```',
        '',
        'After the fence, the actual c1 section begins below.',
        '',
        '## C1',
        '',
        'The real distillation.',
    ].join('\n');

    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.body.includes('This is just example content'));
    assert.strictEqual(result.compressed, 'The real distillation.');
});

test('section v1: ## C1 inside ``` fence with CRLF line endings is ignored (A1 amendment regression)', () => {
    const input = [
        'Body about a markdown example.',
        '',
        '```markdown',
        '## C1',
        'fenced example',
        '```',
        '',
        '## C1',
        '',
        'Real distillation.',
    ].join('\r\n');
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Real distillation.');
});

test('section v1: multiple ## C1 sections → multiple_c1_sections', () => {
    const input = [
        'Body.',
        '',
        '## C1',
        '',
        'First distillation.',
        '',
        '## C1',
        '',
        'Second distillation.',
    ].join('\n');

    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, 'multiple_c1_sections');
});

test('section v1: no ## C1 heading → no_c1_section', () => {
    const result = parseTurnEntry('Just body prose with no closing distillation section.');
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section v1: empty input → no_c1_section', () => {
    const result = parseTurnEntry('');
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section v1: ## C1 with nothing before it → empty_body (was empty_full in v1; renamed v2)', () => {
    const input = '## C1\n\nOnly the distillation, no body.';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, 'empty_body');
});

test('section v1: ## C1 with whitespace-only after → empty_compressed', () => {
    const input = 'Body here.\n\n## C1\n\n   \n';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, 'empty_compressed');
});

test('section v1: null input → invalid_input', () => {
    const result = parseTurnEntry(null);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('section v1: CRLF line endings handled', () => {
    const input = 'Body.\r\n\r\n## C1\r\n\r\nDistilled.';
    const result = parseTurnEntry(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.body, 'Body.');
    assert.strictEqual(result.compressed, 'Distilled.');
});

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism B — parseTurnEntry, V2 mode (captureInput=true — diary discipline)
// PR-C1-3.5 additions.
// ──────────────────────────────────────────────────────────────────────────────

test('diary: happy path — three-section structure (## INPUT + ## BODY + ## C1)', () => {
    const input = [
        '## INPUT',
        '',
        'Darron asked: "what do we do next?" then: "go with (a) and start the plan doc"',
        '',
        '## BODY',
        '',
        'The shape lands. I drafted plans/c1-diary.md as a sibling to c1-distillation.md.',
        '370 lines after v2 fold-in.',
        '',
        '## C1',
        '',
        'The diary plan v2 lands; bridge holds. The shape of completeness over optimisation now structural.',
    ].join('\n');

    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.input!.startsWith('Darron asked'));
    assert.ok(result.body.startsWith('The shape lands.'));
    assert.ok(result.compressed.startsWith('The diary plan v2 lands'));
});

test('diary: missing ## INPUT → no_input_section', () => {
    const input = '## BODY\n\nBody content.\n\n## C1\n\nDistillation.';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'no_input_section');
});

test('diary: missing ## BODY → no_body_section', () => {
    const input = '## INPUT\n\nInput content.\n\n## C1\n\nDistillation.';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'no_body_section');
});

test('diary: missing ## C1 → no_c1_section', () => {
    const input = '## INPUT\n\nInput.\n\n## BODY\n\nBody content.';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('diary: multiple ## INPUT → multiple_input_sections', () => {
    const input = '## INPUT\nA\n\n## INPUT\nB\n\n## BODY\nbody\n\n## C1\nc1';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'multiple_input_sections');
});

test('diary: multiple ## BODY → multiple_body_sections', () => {
    const input = '## INPUT\ninput\n\n## BODY\nfirst\n\n## BODY\nsecond\n\n## C1\nc1';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'multiple_body_sections');
});

test('diary: empty input section → empty_input', () => {
    const input = '## INPUT\n\n   \n\n## BODY\n\nbody\n\n## C1\n\nc1';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'empty_input');
});

test('diary: empty body section → empty_body', () => {
    const input = '## INPUT\n\ninput\n\n## BODY\n\n  \n\n## C1\n\nc1';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'empty_body');
});

test('diary: empty compressed section → empty_compressed', () => {
    const input = '## INPUT\n\ninput\n\n## BODY\n\nbody\n\n## C1\n\n   \n';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, 'empty_compressed');
});

test('diary: case-insensitive headings (## input / ## body / ## c1)', () => {
    const input = '## input\nA\n\n## body\nB\n\n## c1\nC';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.input, 'A');
    assert.strictEqual(result.body, 'B');
    assert.strictEqual(result.compressed, 'C');
});

test('diary: ## INPUT and ## BODY inside ``` fence are ignored', () => {
    const input = [
        '```markdown',
        '## INPUT',
        'fenced example',
        '## BODY',
        'fenced body',
        '## C1',
        'fenced c1',
        '```',
        '',
        '## INPUT',
        '',
        'Real input.',
        '',
        '## BODY',
        '',
        'Real body.',
        '',
        '## C1',
        '',
        'Real c1.',
    ].join('\n');

    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.input, 'Real input.');
    assert.strictEqual(result.body, 'Real body.');
    assert.strictEqual(result.compressed, 'Real c1.');
});

test('diary: CRLF line endings on three-section input', () => {
    const input = '## INPUT\r\n\r\ninput text\r\n\r\n## BODY\r\n\r\nbody text\r\n\r\n## C1\r\n\r\nc1 text';
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.input, 'input text');
    assert.strictEqual(result.body, 'body text');
    assert.strictEqual(result.compressed, 'c1 text');
});

// ──────────────────────────────────────────────────────────────────────────────
// LM-1 non-collision regression — parser MUST NOT match storage markers
// ──────────────────────────────────────────────────────────────────────────────

test('LM-1: parser ignores [INPUT] / [BODY] / [C1] storage markers (NOT headings)', () => {
    // Simulates an agent quoting a prior diary entry verbatim — the c0 storage
    // uses [INPUT]/[BODY]/[C1] markers, not ## headings. The parser MUST treat
    // them as content, not as section boundaries.
    const input = [
        '## INPUT',
        '',
        'I read a prior diary entry that looked like this:',
        '[INPUT]',
        'prior input',
        '',
        '[BODY]',
        'prior body',
        '',
        '[C1]',
        'prior c1',
        '',
        '## BODY',
        '',
        'My reflection on the prior entry.',
        '',
        '## C1',
        '',
        'The diary loop closes on itself, safely.',
    ].join('\n');

    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined,
        'storage markers must not trip the heading parser');
    assert.ok(result.input!.includes('[INPUT]'),
        'storage markers preserved verbatim inside input content');
    assert.ok(result.input!.includes('[BODY]'));
    assert.ok(result.input!.includes('[C1]'));
    assert.strictEqual(result.body, 'My reflection on the prior entry.');
    assert.strictEqual(result.compressed, 'The diary loop closes on itself, safely.');
});

test('LM-1: parser ignores [INPUT] at line-start even with surrounding whitespace', () => {
    const input = [
        '## INPUT',
        '   [INPUT]   ',
        '\t[BODY]',
        '## BODY',
        'body',
        '## C1',
        'c1',
    ].join('\n');
    const result = parseTurnEntry(input, { captureInput: true });
    assert.strictEqual(result.parseError, undefined,
        'whitespace-padded storage markers must not match heading regex');
});
