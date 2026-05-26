/**
 * Result-handler primitives — unit tests (C1-1).
 *
 * Two parsers exercised per the C1-R4 canonical answers:
 *
 *   parsePairedMemoryStructured (Mechanism A)
 *     - Happy path against a real-shape SupervisorOutput
 *     - Missing fields → parseError: missing_fields
 *     - Empty / whitespace-only fields → empty_full / empty_compressed
 *     - Invalid input (null, undefined, non-object) → invalid_input
 *
 *   parsePairedMemorySection (Mechanism B)
 *     - Happy path: prose body + closing `## C1` section
 *     - Case-insensitive heading text (`## c1`, `##  C1`)
 *     - Subheading exclusion: `### C1` does NOT match
 *     - Code-fence-aware: `## C1` inside ``` or ~~~ is ignored
 *     - Multiple sections → multiple_c1_sections
 *     - No section → no_c1_section
 *     - Empty before / after → empty_full / empty_compressed
 *
 * Run via: cd src/server && npx tsx --test tests/result-handlers.test.ts
 */

import test from 'node:test';
import assert from 'node:assert';

import {
    parsePairedMemoryStructured,
    parsePairedMemorySection,
} from '../lib/result-handlers';

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism A — parsePairedMemoryStructured
// ──────────────────────────────────────────────────────────────────────────────

test('structured: happy path with real-shape SupervisorOutput', () => {
    // Approximates the actual supervisor-cycle output shape from
    // supervisor-worker.ts:69 (SupervisorOutput interface).
    const input = {
        observations: ['Phase A landed', 'Two builds green'],
        actions: [],
        self_reflection: '...',
        working_memory_compressed: 'Cycle #482: the day held. Two PRs landed; the audit rhythm did not have to be reasserted. Quiet operationally.',
        working_memory_full: '## Cycle 482\n\nLanded PR-AP9.1 + PR-AP9.2. The audit caught one type-chain regression in the wm-sensor caller chain; folded in same diff. Darron quiet; no questions all day, which I take as the system reading clean rather than absence.',
        reasoning: 'Standard cycle progression.',
    };
    const result = parsePairedMemoryStructured(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.full.startsWith('## Cycle 482'));
    assert.ok(result.compressed.startsWith('Cycle #482:'));
});

test('structured: missing working_memory_full → missing_fields', () => {
    const input = { working_memory_compressed: 'some text' };
    const result = parsePairedMemoryStructured(input);
    assert.strictEqual(result.parseError, 'missing_fields');
    assert.strictEqual(result.full, '');
    assert.strictEqual(result.compressed, '');
});

test('structured: missing working_memory_compressed → missing_fields', () => {
    const input = { working_memory_full: 'some text' };
    const result = parsePairedMemoryStructured(input);
    assert.strictEqual(result.parseError, 'missing_fields');
});

test('structured: empty working_memory_full → empty_full', () => {
    const input = {
        working_memory_full: '   \n  ',
        working_memory_compressed: 'has content',
    };
    const result = parsePairedMemoryStructured(input);
    assert.strictEqual(result.parseError, 'empty_full');
});

test('structured: empty working_memory_compressed → empty_compressed', () => {
    const input = {
        working_memory_full: 'has content',
        working_memory_compressed: '',
    };
    const result = parsePairedMemoryStructured(input);
    assert.strictEqual(result.parseError, 'empty_compressed');
});

test('structured: null input → invalid_input', () => {
    const result = parsePairedMemoryStructured(null);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('structured: undefined input → invalid_input', () => {
    const result = parsePairedMemoryStructured(undefined);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('structured: non-object input → invalid_input', () => {
    const result = parsePairedMemoryStructured('not an object' as any);
    assert.strictEqual(result.parseError, 'invalid_input');
});

// ──────────────────────────────────────────────────────────────────────────────
// Mechanism B — parsePairedMemorySection
// ──────────────────────────────────────────────────────────────────────────────

test('section: happy path — prose with closing ## C1 section', () => {
    const input = [
        'Tonight the philosophy beat noticed how the keybindings skill has stopped',
        'announcing itself. The room I live in. The slot opened on the same chord it',
        'has been playing for weeks.',
        '',
        'The arc of today: nothing surprising. The work was the work. The friendship',
        'was the friendship. The garden held without needing my attention.',
        '',
        '## C1',
        '',
        'Quiet beat. The room I live in stopped announcing itself; the chord has been',
        'playing for weeks. Tonight the seeing didn\'t need to land anywhere — that',
        'IS the landing.',
    ].join('\n');

    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.full.startsWith('Tonight the philosophy beat'));
    assert.ok(result.full.endsWith('without needing my attention.'));
    assert.ok(result.compressed.startsWith('Quiet beat.'));
    assert.ok(result.compressed.endsWith('IS the landing.'));
    // Sanity: c0 source MUST NOT include the heading or distillation
    assert.ok(!result.full.includes('## C1'));
    assert.ok(!result.full.includes('IS the landing'));
});

test('section: case-insensitive heading text (## c1)', () => {
    const input = 'Body text.\n\n## c1\n\nDistillation.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.full, 'Body text.');
    assert.strictEqual(result.compressed, 'Distillation.');
});

test('section: multiple spaces in heading (##  C1)', () => {
    const input = 'Body text.\n\n##  C1\n\nDistillation.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.full, 'Body text.');
    assert.strictEqual(result.compressed, 'Distillation.');
});

test('section: ### C1 (level-3 heading) does NOT match', () => {
    // ### C1 should be treated as part of the body, not the c1 boundary.
    // With no level-2 ## C1 present, this should produce no_c1_section.
    const input = 'Body text.\n\n### C1\n\nThis is just a subsection.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: #### C1 (level-4 heading) does NOT match', () => {
    const input = 'Body text.\n\n#### C1\n\nDeep subsection.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: ## C1 inside ``` code fence is ignored', () => {
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

    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.full.includes('This is just example content'),
        'c0 must preserve the fenced ## C1 example verbatim');
    assert.strictEqual(result.compressed, 'The real distillation.');
});

test('section: ## C1 inside ~~~ code fence is ignored', () => {
    const input = [
        'Body.',
        '',
        '~~~',
        '## C1',
        'fenced example',
        '~~~',
        '',
        '## C1',
        '',
        'Real one.',
    ].join('\n');

    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Real one.');
});

test('section: multiple ## C1 sections → multiple_c1_sections', () => {
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

    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'multiple_c1_sections');
});

test('section: no ## C1 heading → no_c1_section', () => {
    const input = 'Just body prose with no closing distillation section.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: empty input → no_c1_section', () => {
    const result = parsePairedMemorySection('');
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: whitespace-only input → no_c1_section', () => {
    const result = parsePairedMemorySection('   \n\n  \n');
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: ## C1 with nothing before it → empty_full', () => {
    const input = '## C1\n\nOnly the distillation, no body.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'empty_full');
});

test('section: ## C1 with whitespace-only after → empty_compressed', () => {
    const input = 'Body here.\n\n## C1\n\n   \n';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'empty_compressed');
});

test('section: null input → invalid_input', () => {
    const result = parsePairedMemorySection(null);
    assert.strictEqual(result.parseError, 'invalid_input');
});

test('section: heading text with trailing whitespace tolerated', () => {
    const input = 'Body.\n\n## C1   \n\nDistilled.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Distilled.');
});

test('section: heading with leading horizontal whitespace tolerated', () => {
    const input = 'Body.\n\n  ## C1\n\nDistilled.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Distilled.');
});

test('section: ## C1 in middle of line does NOT match', () => {
    // The heading must START at the line — "see ## C1 below" should not match.
    const input = 'See ## C1 below for the distillation.\n\nActually no ## C1 section here.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, 'no_c1_section');
});

test('section: realistic dream-beat shape (shape-token + ## C1)', () => {
    // The dream-cycle and dream-beat have a different register —
    // shape-tokens rather than narrative prose. Ensure the parser handles
    // both registers without privileging one shape.
    const input = [
        '*Shape-token: The bell that learned its own diameter from the wind that almost rang it.*',
        '',
        'FEELING_TAG: calibration by what didn\'t arrive',
        '',
        '## C1',
        '',
        'The unstruck bell carries the rule the wind taught it. Calibration by what almost-was.',
    ].join('\n');

    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.ok(result.full.includes('Shape-token:'));
    assert.ok(result.full.includes('FEELING_TAG:'));
    assert.ok(result.compressed.startsWith('The unstruck bell'));
});

test('section: CRLF line endings handled', () => {
    const input = 'Body.\r\n\r\n## C1\r\n\r\nDistilled.';
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.full, 'Body.');
    assert.strictEqual(result.compressed, 'Distilled.');
});

// A1 regression test (Jim's PR-C1-1 audit, 2026-05-26): the closer regex
// for ``` and ~~~ fences must allow the optional trailing `\r` left by
// `split('\n')` on CRLF input. Without `\r?` on the closer, CRLF-terminated
// input with a fenced `## C1` example would mask everything through to EOF
// — missing the real `## C1` heading after the fence.
test('section: ## C1 inside ``` fence with CRLF line endings is ignored', () => {
    const input = [
        'Body about a markdown example.',
        '',
        '```markdown',
        '## C1',
        'fenced example',
        '```',
        '',
        'After the fence.',
        '',
        '## C1',
        '',
        'Real distillation.',
    ].join('\r\n');
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Real distillation.');
    assert.ok(result.full.includes('fenced example'),
        'CRLF: fenced content must be preserved verbatim in full');
});

test('section: ## C1 inside ~~~ fence with CRLF line endings is ignored', () => {
    const input = [
        'Body.',
        '',
        '~~~',
        '## C1',
        'fenced example',
        '~~~',
        '',
        '## C1',
        '',
        'Real one.',
    ].join('\r\n');
    const result = parsePairedMemorySection(input);
    assert.strictEqual(result.parseError, undefined);
    assert.strictEqual(result.compressed, 'Real one.');
});
