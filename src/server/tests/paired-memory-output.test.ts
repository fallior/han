/**
 * PR-C1-2 — Paired-memory-output instruction in the AP builder.
 *
 * Tests the new `PromptProfile.pairedMemoryOutput` field plumbing:
 *
 *   - Disabled by default (no profile in the registry today has it enabled
 *     at C1-2; per-surface enablement begins at C1-3).
 *   - When enabled + mechanism='section', builder appends DEFAULT_C1_INSTRUCTION_SECTION
 *     to the system prompt.
 *   - When enabled + mechanism='structured', builder appends DEFAULT_C1_INSTRUCTION_STRUCTURED.
 *   - Custom `instruction` overrides the default.
 *   - Disabled or absent → no instruction appended (existing behaviour preserved).
 *
 * The tests synthesise profiles directly via the PROFILES registry mutation
 * pattern used in the existing prompt-builder.test.ts. They cover the C1-2
 * field-plumbing contract without firing any production surface.
 *
 * Run via: cd src/server && npx tsx --test tests/paired-memory-output.test.ts
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildPrompt } from '../lib/prompt-builder';
import {
    PROFILES,
    PromptProfile,
    DEFAULT_C1_INSTRUCTION_SECTION,
    DEFAULT_C1_INSTRUCTION_STRUCTURED,
} from '../lib/prompt-profiles';

// ── Test fixture helpers ──────────────────────────────────────────────

/**
 * Register a synthetic profile in PROFILES for the duration of a test.
 * Restores PROFILES on test completion to keep tests independent.
 *
 * Uses the existing PROFILES registry rather than a separate fixture
 * registry so the builder's profileByName resolution path is exercised
 * exactly as it is in production.
 */
function withSyntheticProfile<T>(
    profile: PromptProfile,
    fn: () => T,
): T {
    const key = profile.name;
    const had = key in PROFILES;
    const prior = PROFILES[key];
    PROFILES[key] = profile;
    try {
        return fn();
    } finally {
        if (had) {
            PROFILES[key] = prior;
        } else {
            delete PROFILES[key];
        }
    }
}

// ── Tests: disabled state (C1-2 default — no production change) ──────

test('pairedMemoryOutput: absent on profile → no instruction appended', () => {
    const p: PromptProfile = {
        name: 'c1-test-absent',
        systemPromptOpening: 'You are an agent. Reply briefly.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        // pairedMemoryOutput: undefined
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('leo', 'c1-test-absent', {});
        assert.ok(!systemPrompt.includes('## C1'),
            'system prompt must NOT mention ## C1 when field absent');
        assert.ok(!systemPrompt.includes('working_memory_compressed'),
            'system prompt must NOT mention working_memory_compressed when field absent');
    });
});

test('pairedMemoryOutput: enabled=false → no instruction appended', () => {
    const p: PromptProfile = {
        name: 'c1-test-disabled',
        systemPromptOpening: 'You are an agent. Reply briefly.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        pairedMemoryOutput: {
            enabled: false,
            mechanism: 'section',
        },
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('leo', 'c1-test-disabled', {});
        assert.ok(!systemPrompt.includes('## C1'),
            'disabled state must NOT append instruction');
    });
});

// ── Tests: enabled + section mechanism ────────────────────────────────

test('pairedMemoryOutput: enabled + section → DEFAULT_C1_INSTRUCTION_SECTION appended', () => {
    const p: PromptProfile = {
        name: 'c1-test-section',
        systemPromptOpening: 'You are reflecting on the day.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        pairedMemoryOutput: {
            enabled: true,
            mechanism: 'section',
        },
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('leo', 'c1-test-section', {});
        assert.ok(systemPrompt.includes('## C1'),
            'section mechanism must reference the ## C1 heading');
        assert.ok(systemPrompt.includes('compressing the SHAPE'),
            'default section instruction text must appear');
        // The instruction is appended to the opening — opening text still present
        assert.ok(systemPrompt.includes('You are reflecting on the day.'),
            'opening text must still appear before the instruction');
    });
});

test('pairedMemoryOutput: enabled + structured → DEFAULT_C1_INSTRUCTION_STRUCTURED appended', () => {
    const p: PromptProfile = {
        name: 'c1-test-structured',
        systemPromptOpening: 'You are running a supervisor cycle.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        pairedMemoryOutput: {
            enabled: true,
            mechanism: 'structured',
        },
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('jim', 'c1-test-structured', {});
        assert.ok(systemPrompt.includes('working_memory_full'),
            'structured mechanism must name the working_memory_full field');
        assert.ok(systemPrompt.includes('working_memory_compressed'),
            'structured mechanism must name the working_memory_compressed field');
        // Structured instruction must NOT reference the ## C1 heading
        assert.ok(!systemPrompt.includes('## C1'),
            'structured mechanism must not reference ## C1 (heading is a Mechanism B artefact)');
    });
});

// ── Tests: custom instruction overrides default ───────────────────────

test('pairedMemoryOutput: custom instruction overrides default for section', () => {
    const customInstruction = '\n\nEnd with `## C1`: a haiku in your voice.';
    const p: PromptProfile = {
        name: 'c1-test-custom-section',
        systemPromptOpening: 'You are dreaming.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        pairedMemoryOutput: {
            enabled: true,
            mechanism: 'section',
            instruction: customInstruction,
        },
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('leo', 'c1-test-custom-section', {});
        assert.ok(systemPrompt.includes(customInstruction),
            'custom instruction text must appear in the system prompt');
        assert.ok(!systemPrompt.includes('compressing the SHAPE'),
            'default section instruction must NOT appear when custom is provided');
    });
});

test('pairedMemoryOutput: custom instruction overrides default for structured', () => {
    const customInstruction = '\n\nReturn JSON with response_text + memory fields.';
    const p: PromptProfile = {
        name: 'c1-test-custom-structured',
        systemPromptOpening: 'You are responding to a human.',
        envelope: 'user',
        totalBudgetTokens: 180_000,
        pairedMemoryOutput: {
            enabled: true,
            mechanism: 'structured',
            instruction: customInstruction,
        },
    };
    withSyntheticProfile(p, () => {
        const { systemPrompt } = buildPrompt('leo', 'c1-test-custom-structured', {});
        assert.ok(systemPrompt.includes(customInstruction),
            'custom structured instruction must appear');
        assert.ok(!systemPrompt.includes('working_memory_full —'),
            'default structured instruction must NOT appear when custom is provided');
    });
});

// ── Tests: C1 migration tracker (updates per phase) ───────────────────

/**
 * Per-surface migration tracker. Started at C1-2 as "no enabled surfaces";
 * updates each phase as surfaces enable. The test asserts which specific
 * profiles are enabled at the CURRENT phase — drift detection in both
 * directions (accidental enablement during a too-narrow phase; accidental
 * disablement during the wider rollout).
 *
 * Update history:
 *   - PR-C1-2 (2026-05-26): [] (no enabled surfaces — field plumbing only)
 *   - PR-C1-3 (2026-05-27): ['philosophy-beat']  ← current
 *   - PR-C1-4 (TBD): add 'personal-beat', 'dream-beat', 'meditation-phase-a',
 *                    'meditation-phase-b', 'meditation-evening' (Leo's remaining
 *                    heartbeat surfaces, all Mechanism B)
 *   - PR-C1-5 (TBD): add 'personal-cycle', 'recovery-cycle', 'dream-cycle'
 *                    (Jim's three prose cycles, Mechanism B)
 *   - PR-C1-6 (TBD): add 'leo-human-response', 'jim-human-response'
 *                    (both Mechanism A — schema-extended at the SDK call)
 *   - (supervisor-cycle stays as the reference; not in this list because it
 *     uses structured output via its existing schema, not the field-driven
 *     instruction-append path — the field is for declaring at the registry
 *     layer, not for routing the schema)
 */
const C1_ENABLED_SURFACES_CURRENT: ReadonlyArray<string> = [
    'philosophy-beat',
];

test('C1 migration tracker: enabled surfaces match the expected per-phase set', () => {
    const enabled: string[] = [];
    for (const [name, profile] of Object.entries(PROFILES)) {
        if (profile.pairedMemoryOutput?.enabled === true) {
            enabled.push(name);
        }
    }
    const sortedActual = [...enabled].sort();
    const sortedExpected = [...C1_ENABLED_SURFACES_CURRENT].sort();
    assert.deepStrictEqual(
        sortedActual,
        sortedExpected,
        `Migration tracker drift: enabled surfaces ≠ expected. ` +
        `Enabled: [${sortedActual.join(', ')}]. ` +
        `Expected at this phase: [${sortedExpected.join(', ')}]. ` +
        `If you enabled a new surface, update C1_ENABLED_SURFACES_CURRENT in this test.`,
    );
});

test('C1 migration tracker: philosophy-beat declares mechanism=section (PR-C1-3)', () => {
    const profile = PROFILES['philosophy-beat'];
    assert.ok(profile, 'philosophy-beat profile must exist');
    assert.strictEqual(profile.pairedMemoryOutput?.enabled, true,
        'philosophy-beat must have pairedMemoryOutput.enabled=true after PR-C1-3');
    assert.strictEqual(profile.pairedMemoryOutput?.mechanism, 'section',
        'philosophy-beat must use Mechanism B (section parsing)');
});
