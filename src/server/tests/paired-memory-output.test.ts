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

// ── Tests: C1-2 contract — no production profile has enabled=true ─────

test('PR-C1-2 contract: no PROFILES entry has pairedMemoryOutput.enabled=true', () => {
    // C1-2 ships the field plumbing only. Per-surface enablement begins at
    // C1-3 (philosophy-beat) onward. This test asserts the plan's success
    // criterion — "disabled on every profile by default; no behaviour change"
    // — and protects against accidental enablement during the C1-2 PR.
    const enabled: string[] = [];
    for (const [name, profile] of Object.entries(PROFILES)) {
        if (profile.pairedMemoryOutput?.enabled === true) {
            enabled.push(name);
        }
    }
    assert.deepStrictEqual(
        enabled,
        [],
        `PR-C1-2 should ship with no profiles having pairedMemoryOutput.enabled=true. ` +
        `Found enabled on: ${enabled.join(', ')}. Per-surface enablement begins at C1-3.`,
    );
});
