/**
 * Agnostic Prompt Builder — Phase 1 validation tests
 *
 * Two layers per Jim's audit B2 + Q7:
 *
 *   1. Per-profile budget test — for each registered profile, build with
 *      synthetic context and assert the result fits under the profile's
 *      totalBudgetTokens. Catches future profile changes that bust their
 *      own declared budget.
 *
 *   2. loadFullMemory(slug) upper-bound test — for each registered agent,
 *      assert loadFullMemory(slug) itself fits under MAX_MEMORY_BUDGET.
 *      This is the load-bearing safety net for the uniform-memory design:
 *      if the memory load grows past the ceiling, ALL surfaces would
 *      break simultaneously. The per-profile checks are downstream of
 *      this; the upstream invariant catches the root condition.
 *
 * Run via: cd src/server && npm test (or `tsx --test tests/prompt-builder.test.ts`)
 */

import test from 'node:test';
import assert from 'node:assert';
import {
    buildPrompt,
    loadFullMemory,
    PromptOverbudgetError,
} from '../lib/prompt-builder';
import { PROFILES, profileByName } from '../lib/prompt-profiles';
import { registeredAgentSlugs } from '../lib/agent-registry';

// The upper-bound budget for `loadFullMemory(slug)` itself. Leaves room
// for ~20K tokens of scaffolding under a typical 120K profile budget.
// Bump cautiously as components are added in future phases.
const MAX_MEMORY_BUDGET = 100_000;

function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// ── Layer 2: loadFullMemory upper-bound (B2 — the load-bearing safety net) ──

test('loadFullMemory(slug) for every registered agent fits under MAX_MEMORY_BUDGET', () => {
    const slugs = registeredAgentSlugs();
    assert.ok(slugs.length > 0, 'expected at least one registered agent slug');

    for (const slug of slugs) {
        const mem = loadFullMemory(slug);
        const tokens = estimateTokens(mem.text);
        assert.ok(
            tokens <= MAX_MEMORY_BUDGET,
            `loadFullMemory('${slug}') = ${tokens} tokens > MAX_MEMORY_BUDGET (${MAX_MEMORY_BUDGET}). ` +
            `Component breakdown: ${JSON.stringify(mem.componentSizes)}. ` +
            `If a component grew legitimately, either trim it via tail-trim, ` +
            `add file-level rotation (wm-sensor or rollingWindowRotate), or ` +
            `raise MAX_MEMORY_BUDGET deliberately after auditing the asymmetry.`,
        );
    }
});

test('loadFullMemory(slug) returns componentSizes matching content length', () => {
    for (const slug of registeredAgentSlugs()) {
        const mem = loadFullMemory(slug);
        const sumOfComponents = Object.values(mem.componentSizes).reduce((a, b) => a + b, 0);
        // text contains labelled section headers + separators, so it's
        // longer than the sum of raw component sizes. Bound the slack
        // loosely — text length should never be smaller than the sum.
        assert.ok(
            mem.text.length >= sumOfComponents,
            `${slug}: text length ${mem.text.length} < sum of components ${sumOfComponents}`,
        );
    }
});

// ── Layer 1: Per-profile budget test (Q7) ──

test('every registered profile fits under its declared totalBudgetTokens', () => {
    const profileNames = Object.keys(PROFILES);
    assert.ok(profileNames.length > 0, 'expected at least one registered profile');

    for (const profileName of profileNames) {
        const profile = profileByName(profileName);
        for (const slug of registeredAgentSlugs()) {
            // Use synthetic but realistic context fields. Profiles that don't
            // touch these fields will simply ignore them; profiles that need
            // specific fields should fail loudly if missing — that's the
            // point of the test.
            const synthCtx = {
                phase: 'work',
                recovery: false,
                recentActivity: '(synthetic test context)',
                dreamSeeds: '(synthetic)',
                dreamMemorySection: '',
                conversationTail: '(synthetic)',
                stateSnapshot: '(synthetic)',
                fileLevel: 'c3',
                fileLabel: 'synthetic-test',
                fileContent: '(synthetic)',
                entryLevel: 'c3',
                entrySessionLabel: 'synthetic-test',
                entryContent: '(synthetic)',
                entryId: 'synthetic-id',
                tagContext: '',
            };
            try {
                const built = buildPrompt(slug, profileName, synthCtx);
                assert.ok(
                    built.meta.est_total_tokens_chars_div_4 <= profile.totalBudgetTokens,
                    `profile '${profileName}' for agent '${slug}': ` +
                    `${built.meta.est_total_tokens_chars_div_4} > ${profile.totalBudgetTokens}. ` +
                    `Memory ${built.meta.memory_chars} chars, scaffolding ${built.meta.scaffolding_chars} chars. ` +
                    `Components: ${JSON.stringify(built.meta.component_breakdown)}`,
                );
            } catch (err) {
                if (err instanceof PromptOverbudgetError) {
                    // The build threw because the profile is over budget. That's
                    // exactly the failure mode this test is meant to detect.
                    // Surface the meta so the operator can see the breakdown.
                    assert.fail(
                        `profile '${profileName}' for agent '${slug}' threw PromptOverbudgetError: ${err.message}. ` +
                        `Meta: ${JSON.stringify(err.meta, null, 2)}`,
                    );
                }
                throw err;  // unknown errors propagate
            }
        }
    }
});

// ── PromptOverbudgetError contract tests ──

test('PromptOverbudgetError carries meta with all diagnostic fields', () => {
    // Synthetic: force a budget overflow by registering a profile (in-test only)
    // with an unreasonably small budget. We can't mutate the real PROFILES
    // registry from a test, so we test the error class shape directly.
    const meta = {
        profile_name: 'synthetic-overbudget',
        agent: 'leo',
        envelope: 'system' as const,
        system_chars: 200_000,
        user_chars: 50,
        memory_chars: 199_500,
        scaffolding_chars: 550,
        est_total_tokens_chars_div_4: 50_013,
        total_budget_tokens: 1000,
        component_breakdown: { identity: 3080, aphorisms: 5000 },
    };
    const err = new PromptOverbudgetError(meta);
    assert.strictEqual(err.name, 'PromptOverbudgetError');
    assert.strictEqual(err.meta, meta);
    assert.ok(err.message.includes('synthetic-overbudget'));
    assert.ok(err.message.includes('50013'));
    assert.ok(err.message.includes('1000'));
});

test('buildPrompt throws PromptOverbudgetError when budget tiny', () => {
    // We can register a temporary profile by directly mutating the registry
    // for this test. Restored at the end.
    const original = PROFILES['tiny-budget-test'];
    PROFILES['tiny-budget-test'] = {
        name: 'tiny-budget-test',
        systemPromptOpening: 'You are an agent.',
        envelope: 'system',
        totalBudgetTokens: 1,  // ridiculously small — guaranteed overflow
    };
    try {
        for (const slug of registeredAgentSlugs()) {
            assert.throws(
                () => buildPrompt(slug, 'tiny-budget-test', {}),
                PromptOverbudgetError,
                `expected PromptOverbudgetError for slug='${slug}' on tiny-budget-test profile`,
            );
        }
    } finally {
        if (original === undefined) {
            delete PROFILES['tiny-budget-test'];
        } else {
            PROFILES['tiny-budget-test'] = original;
        }
    }
});
