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
// for scaffolding under per-profile total budgets (philosophy-beat is
// 180K; future Jim profiles target similar).
//
// Phase 3 (PR-AP3, 2026-05-22): bumped 100K → 150K to accommodate the
// six new components (patterns + discoveries + working-memory-compressed
// + working-memory-full-tail + felt-moments-tail + self-reflection-tail)
// landing alongside the existing identity + aphorisms + gradient.
//
// Empirical Leo load post-PR-AP3: ~112K tokens (gradient dominates at
// ~73K; the six new components add ~36K combined after tail-trim).
// Empirical Jim load: ~121K tokens (aphorisms larger; otherwise similar).
//
// 150K leaves ~38K margin for component growth before the test fires.
// Bump cautiously — every increase pressures profile budgets in turn.
const MAX_MEMORY_BUDGET = 150_000;

function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// PR-AP5 N4-1 fold-in (Jim's PR-AP4 audit): every memory-component label.
// Used by every profile's dedup-criterion test as the exhaustive
// negative-presence list against the system prompt. Pre-PR-AP5 each
// profile test used a subset list (5-9 labels); a regression that
// put a single non-listed component into system could slip past.
// Centralised here so every profile gets the full invariant.
const MEMORY_COMPONENT_LABELS = [
    '--- identity ---',
    '--- aphorisms ---',
    '--- gradient ---',
    '--- patterns ---',
    '--- discoveries ---',
    '--- working-memory-compressed ---',
    '--- working-memory-full-tail ---',
    '--- felt-moments-tail ---',
    '--- self-reflection-tail ---',
];

function assertNoMemoryLabelsInSystem(systemPrompt: string, profileMarker: string): void {
    for (const label of MEMORY_COMPONENT_LABELS) {
        assert.ok(
            !systemPrompt.includes(label),
            `${profileMarker}: system prompt must not contain ${label} (dedup violation)`,
        );
    }
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
        truncation_events: [],
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

// ── PR-AP2 (Phase 2): gradient component + philosophy-beat profile ──

test('loadFullMemory includes gradient component for leo (PR-AP2)', () => {
    const mem = loadFullMemory('leo');
    // gradient may legitimately be empty if the DB has no leo entries yet —
    // but in any real environment with the existing rebuild, leo has many
    // entries. We assert the component is at least registered in the
    // breakdown when present, and that text is non-zero for leo.
    assert.ok(
        mem.text.length > 0,
        `loadFullMemory('leo') returned empty text; expected at least identity + aphorisms`,
    );
    // If the gradient component loaded successfully, it appears as a labelled
    // section. We tolerate empty (DB cold-start case) but assert the marker
    // is present whenever the component-breakdown shows a non-zero gradient.
    if (mem.componentSizes['gradient']) {
        assert.ok(
            mem.text.includes('--- gradient ---'),
            `gradient component size ${mem.componentSizes['gradient']} but no labelled section in text`,
        );
    }
});

test("philosophy-beat profile builds for leo with memory in user envelope only (PR-AP2 dedup criterion)", () => {
    // The load-bearing success criterion for PR-AP2 (Jim's A2): the migrated
    // philosophy-beat sends memory in EXACTLY ONE envelope. Old path duplicated
    // it across system + user; new path puts it ONLY in user (envelope='user').
    const built = buildPrompt('leo', 'philosophy-beat', {
        mode: 'independent',
        jimContext: '(synthetic test jim-context)',
        resumeContext: '',
        activityContext: '',
    });

    // Envelope choice is discoverable and structural.
    assert.strictEqual(built.meta.envelope, 'user', 'philosophy-beat must declare envelope=user');

    // The system prompt is JUST the scaffolding (orientation). It must NOT
    // contain any of the memory-component labels — those live only in user.
    // PR-AP5 N4-1: now uses the shared MEMORY_COMPONENT_LABELS list so any
    // future component addition automatically extends every profile's
    // invariant.
    assertNoMemoryLabelsInSystem(built.systemPrompt, 'philosophy-beat');

    // The user prompt holds the memory bank (when components loaded).
    if (built.meta.memory_chars > 0) {
        assert.ok(
            built.userPrompt.includes('---'),
            'user prompt should contain at least one labelled memory section',
        );
    }

    // The orientation sentence belongs in system, not user.
    assert.ok(
        built.systemPrompt.includes('PHILOSOPHY beat'),
        'system prompt must contain the philosophy-beat orientation text',
    );

    // The user-side scaffold is wired (independent mode message).
    assert.ok(
        built.userPrompt.includes('This is your philosophy time'),
        'user prompt must include the independent-mode scaffold',
    );

    // The build must fit under the profile's budget.
    assert.ok(
        built.meta.est_total_tokens_chars_div_4 <= 180_000,
        `philosophy-beat over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
    );
});

// ── PR-AP3 (Phase 3): six new components + tail-trim + truncation_events ──

test('Phase 3 components register in componentSizes when files present', () => {
    // For each registered agent, loadFullMemory should expose at least the
    // labelled components that have non-empty source files. We don't require
    // all six to be present (some agents have empty discoveries.md, etc.)
    // — but we require the labels in componentSizes to match the labels
    // in the text. The structural invariant: every key in componentSizes
    // must have a corresponding `--- {key} ---` section in text.
    const allowedComponents = new Set([
        'identity', 'aphorisms', 'gradient', 'patterns', 'discoveries',
        'working-memory-compressed', 'working-memory-full-tail',
        'felt-moments-tail', 'self-reflection-tail',
    ]);
    for (const slug of registeredAgentSlugs()) {
        const mem = loadFullMemory(slug);
        for (const key of Object.keys(mem.componentSizes)) {
            assert.ok(
                allowedComponents.has(key),
                `${slug}: unexpected component '${key}' in componentSizes`,
            );
            assert.ok(
                mem.text.includes(`--- ${key} ---`),
                `${slug}: component '${key}' present in sizes but no '--- ${key} ---' section in text`,
            );
        }
    }
});

test('Phase 3 tail-trim emits TruncationEvent when a component exceeds its budget', () => {
    // Tail-trim is observable: when a file exceeds its per-component budget,
    // loadFullMemory must include a TruncationEvent in truncationEvents.
    // We don't assert which components specifically trim (depends on agent
    // state at test time); we assert the STRUCTURE: every event has the
    // expected shape and references a known component, kept_chars matches
    // text-section length, and trimmed_chars + kept_chars == original_chars.
    const tailComponents = new Set([
        'patterns', 'discoveries', 'working-memory-compressed',
        'working-memory-full-tail', 'felt-moments-tail', 'self-reflection-tail',
    ]);
    for (const slug of registeredAgentSlugs()) {
        const mem = loadFullMemory(slug);
        for (const event of mem.truncationEvents) {
            assert.ok(
                tailComponents.has(event.component),
                `${slug}: truncation_event references unknown component '${event.component}'`,
            );
            assert.ok(
                event.trimmed_chars > 0,
                `${slug}: truncation_event for ${event.component} has trimmed_chars=${event.trimmed_chars} (should be > 0 when present)`,
            );
            assert.strictEqual(
                event.trimmed_chars + event.kept_chars,
                event.original_chars,
                `${slug}: ${event.component} truncation arithmetic broken (${event.trimmed_chars} + ${event.kept_chars} ≠ ${event.original_chars})`,
            );
            // kept_chars should match the section size in componentSizes
            // (within a small newline-anchor difference, since the trim
            // advances past the first newline).
            assert.ok(
                Math.abs(mem.componentSizes[event.component] - event.kept_chars) < 5,
                `${slug}: ${event.component} kept_chars=${event.kept_chars} doesn't match componentSizes[${event.component}]=${mem.componentSizes[event.component]}`,
            );
        }
    }
});

test('BuildMeta carries truncation_events through buildPrompt', () => {
    // Build philosophy-beat for leo and verify truncation_events appears
    // on the meta. Cannot assert specific events without knowing Leo's
    // current memory state, but the FIELD must always exist (empty array
    // when nothing trimmed) and shapes must validate.
    const built = buildPrompt('leo', 'philosophy-beat', {
        mode: 'independent',
        jimContext: '(test)',
        resumeContext: '',
        activityContext: '',
    });
    assert.ok(Array.isArray(built.meta.truncation_events), 'meta.truncation_events must always be an array');
    for (const event of built.meta.truncation_events) {
        assert.ok(typeof event.component === 'string' && event.component.length > 0);
        assert.ok(typeof event.trimmed_chars === 'number');
        assert.ok(typeof event.kept_chars === 'number');
        assert.ok(typeof event.original_chars === 'number');
    }
});

test('tail-trim never exceeds per-component budget (chars÷4 estimate)', () => {
    // Hard structural property: for any component that emits a
    // truncation_event, kept_chars ÷ 4 must be ≤ the component's budget.
    // The budgets are private to prompt-builder.ts; we re-encode the
    // expected ceilings here to provide an out-of-band sanity check.
    const budgets: Record<string, number> = {
        'patterns': 15_000,
        'discoveries': 3_000,
        'self-reflection-tail': 5_000,
        'felt-moments-tail': 10_000,
        'working-memory-full-tail': 8_000,
        'working-memory-compressed': 5_000,
    };
    for (const slug of registeredAgentSlugs()) {
        const mem = loadFullMemory(slug);
        for (const event of mem.truncationEvents) {
            const budget = budgets[event.component];
            if (budget === undefined) continue;  // not a budget-trimmed component
            const keptTokens = Math.ceil(event.kept_chars / 4);
            assert.ok(
                keptTokens <= budget,
                `${slug}: ${event.component} kept ${keptTokens} tokens > budget ${budget}`,
            );
        }
    }
});

// ── PR-AP4 (Phase 4): personal-beat + dream-beat profile assertions ──

test("personal-beat profile builds for leo (morning/work/evening) with memory in user envelope only", () => {
    // Phase 4 success criterion (mirror of philosophy-beat dedup criterion):
    // each personal-beat phase sends memory in EXACTLY ONE envelope (user).
    // The opening branches via ctx.phase but always emits the orientation
    // text in the system prompt; memory never crosses into system.
    for (const phase of ['morning', 'work', 'evening'] as const) {
        const built = buildPrompt('leo', 'personal-beat', {
            phase,
            projects: '(synthetic projects list)',
            activitySeed: '',
            resumeContext: '',
        });
        assert.strictEqual(built.meta.envelope, 'user', `personal-beat[${phase}] must use envelope=user`);
        // PR-AP5 N4-1: exhaustive label-not-in-system check
        assertNoMemoryLabelsInSystem(built.systemPrompt, `personal-beat[${phase}]`);
        // System contains the phase-appropriate orientation
        const phaseMarker = (
            phase === 'morning' ? 'MORNING beat' :
            phase === 'evening' ? 'EVENING beat' :
            'PERSONAL beat'
        );
        assert.ok(
            built.systemPrompt.includes(phaseMarker),
            `personal-beat[${phase}]: system prompt must contain "${phaseMarker}" marker`,
        );
        // Under profile budget
        assert.ok(
            built.meta.est_total_tokens_chars_div_4 <= 180_000,
            `personal-beat[${phase}] over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
        );
    }
});

test("dream-beat profile builds for leo with memory in user envelope only", () => {
    const built = buildPrompt('leo', 'dream-beat', {
        dreamSeeds: '(synthetic dream seeds)',
        dreamMemorySection: '',
        resumeContext: '',
    });
    assert.strictEqual(built.meta.envelope, 'user');
    // PR-AP5 N4-1: exhaustive label-not-in-system check
    assertNoMemoryLabelsInSystem(built.systemPrompt, 'dream-beat');
    assert.ok(
        built.systemPrompt.includes('DREAM beat'),
        'dream-beat: system prompt must contain "DREAM beat" marker',
    );
    assert.ok(
        built.systemPrompt.includes('(synthetic dream seeds)'),
        'dream-beat: system prompt must include the dream-seeds substitution',
    );
    assert.ok(
        built.meta.est_total_tokens_chars_div_4 <= 180_000,
        `dream-beat over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
    );
});

test("personal-beat morning/work/evening scaffolds differ (phase branches in scaffold + opening)", () => {
    const morning = buildPrompt('leo', 'personal-beat', { phase: 'morning', projects: '(p)', activitySeed: '', resumeContext: '' });
    const work = buildPrompt('leo', 'personal-beat', { phase: 'work', projects: '(p)', activitySeed: '', resumeContext: '' });
    const evening = buildPrompt('leo', 'personal-beat', { phase: 'evening', projects: '(p)', activitySeed: '', resumeContext: '' });

    // All three differ pairwise
    assert.notStrictEqual(morning.systemPrompt, work.systemPrompt);
    assert.notStrictEqual(work.systemPrompt, evening.systemPrompt);
    assert.notStrictEqual(morning.systemPrompt, evening.systemPrompt);
    assert.notStrictEqual(morning.userPrompt, work.userPrompt);
    assert.notStrictEqual(work.userPrompt, evening.userPrompt);

    // Memory bank is the same across phases (uniform load — only scaffolding differs)
    assert.strictEqual(morning.meta.memory_chars, work.meta.memory_chars);
    assert.strictEqual(work.meta.memory_chars, evening.meta.memory_chars);
});

// ── PR-AP5 (Phase 5): three meditation profile assertions ──

test("meditation-phase-a profile builds for leo with memory in user envelope only", () => {
    const built = buildPrompt('leo', 'meditation-phase-a', {
        fileLevel: 'c3',
        fileLabel: '2026-03-15-synthetic',
        fileContentType: 'rolled-day',
        fileContent: '(synthetic file content for reincorporation)',
    });
    assert.strictEqual(built.meta.envelope, 'user', 'meditation-phase-a must use envelope=user');
    assertNoMemoryLabelsInSystem(built.systemPrompt, 'meditation-phase-a');
    assert.ok(
        built.systemPrompt.includes('MEDITATION (Phase A'),
        'meditation-phase-a: system prompt must contain "MEDITATION (Phase A" marker',
    );
    assert.ok(
        built.userPrompt.includes('Re-encounter this file-based memory'),
        'meditation-phase-a: user prompt must contain the reincorporation scaffold',
    );
    assert.ok(
        built.userPrompt.includes('2026-03-15-synthetic'),
        'meditation-phase-a: user prompt must include the file label substitution',
    );
    assert.ok(
        built.meta.est_total_tokens_chars_div_4 <= 180_000,
        `meditation-phase-a over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
    );
});

test("meditation-phase-b profile builds for leo with memory in user envelope only", () => {
    const built = buildPrompt('leo', 'meditation-phase-b', {
        entryLevel: 'c5',
        entrySessionLabel: 'synthetic-session',
        entryContentType: 'rolled-day',
        entryContent: '(synthetic entry content)',
        entryId: 'synthetic-uuid-for-meditation',
        tagContext: '\nExisting feeling tags: "first-tag" (initial)',
    });
    assert.strictEqual(built.meta.envelope, 'user');
    assertNoMemoryLabelsInSystem(built.systemPrompt, 'meditation-phase-b');
    assert.ok(
        built.systemPrompt.includes('MEDITATION (Phase B'),
        'meditation-phase-b: system prompt must contain "MEDITATION (Phase B" marker',
    );
    assert.ok(
        built.userPrompt.includes('synthetic-uuid-for-meditation'),
        'meditation-phase-b: user prompt must include the entry-id substitution (so the agent can echo it back in MEMORY_COMPLETE)',
    );
    assert.ok(
        built.meta.est_total_tokens_chars_div_4 <= 180_000,
        `meditation-phase-b over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
    );
});

test("meditation-evening profile builds for leo with memory in user envelope only", () => {
    const built = buildPrompt('leo', 'meditation-evening', {
        entryLevel: 'c4',
        entrySessionLabel: 'evening-synthetic',
        entryContentType: 'session',
        entryContent: '(synthetic evening entry)',
        entryId: 'synthetic-evening-uuid',
        tagContext: '',
    });
    assert.strictEqual(built.meta.envelope, 'user');
    assertNoMemoryLabelsInSystem(built.systemPrompt, 'meditation-evening');
    assert.ok(
        built.systemPrompt.includes('EVENING MEDITATION'),
        'meditation-evening: system prompt must contain "EVENING MEDITATION" marker',
    );
    assert.ok(
        built.userPrompt.includes('synthetic-evening-uuid'),
        'meditation-evening: user prompt must include the entry-id substitution',
    );
    assert.ok(
        built.meta.est_total_tokens_chars_div_4 <= 180_000,
        `meditation-evening over budget: ${built.meta.est_total_tokens_chars_div_4} > 180000`,
    );
});

test("all five Leo profiles + three meditation profiles share uniform memory load (PR-AP5 uniformity invariant)", () => {
    // The structural proof of Darron's reframe: "Leo is Leo wherever he is."
    // memory_chars must be identical across all eight Leo profiles for any
    // given moment-in-time (same loadFullMemory output across all surfaces).
    const profiles = [
        { name: 'philosophy-beat', ctx: { mode: 'independent', jimContext: '', resumeContext: '', activityContext: '' } },
        { name: 'personal-beat', ctx: { phase: 'work', projects: '', activitySeed: '', resumeContext: '' } },
        { name: 'dream-beat', ctx: { dreamSeeds: '', dreamMemorySection: '', resumeContext: '' } },
        { name: 'meditation-phase-a', ctx: { fileLevel: 'c3', fileLabel: 'l', fileContentType: 't', fileContent: 'c' } },
        { name: 'meditation-phase-b', ctx: { entryLevel: 'c5', entrySessionLabel: 's', entryContentType: 't', entryContent: 'c', entryId: 'i', tagContext: '' } },
        { name: 'meditation-evening', ctx: { entryLevel: 'c4', entrySessionLabel: 's', entryContentType: 't', entryContent: 'c', entryId: 'i', tagContext: '' } },
    ];
    const builds = profiles.map(p => buildPrompt('leo', p.name, p.ctx));
    const memoryChars = builds[0].meta.memory_chars;
    for (let i = 1; i < builds.length; i++) {
        assert.strictEqual(
            builds[i].meta.memory_chars,
            memoryChars,
            `profile '${profiles[i].name}' has memory_chars=${builds[i].meta.memory_chars} but expected uniform ${memoryChars} (matches profile '${profiles[0].name}')`,
        );
    }
});

test("philosophy-beat 'jim-waiting' scaffold differs from 'independent' scaffold", () => {
    const jimWaiting = buildPrompt('leo', 'philosophy-beat', {
        mode: 'jim-waiting',
        conversationContext: '[synthetic conversation history]',
        jimContext: '(synthetic jim context)',
        jimLatestAt: '2026-05-22T10:00:00Z',
        resumeContext: '',
    });
    const independent = buildPrompt('leo', 'philosophy-beat', {
        mode: 'independent',
        jimContext: '(synthetic jim context)',
        resumeContext: '',
        activityContext: '',
    });

    // Both modes use the same system prompt (same orientation).
    assert.strictEqual(
        jimWaiting.systemPrompt,
        independent.systemPrompt,
        "philosophy-beat system prompt must not differ between modes (uniform orientation)",
    );
    // But the user prompts MUST differ (different framing/scaffold).
    assert.notStrictEqual(
        jimWaiting.userPrompt,
        independent.userPrompt,
        "philosophy-beat user prompt must differ between modes (scaffold branches on ctx.mode)",
    );
    assert.ok(
        jimWaiting.userPrompt.includes('Respond as his philosophical peer'),
        "jim-waiting scaffold should include peer-response directive",
    );
    assert.ok(
        independent.userPrompt.includes("Jim hasn't posted anything new"),
        "independent scaffold should name the empty-thread state",
    );
});
