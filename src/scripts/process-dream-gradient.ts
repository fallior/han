/**
 * Process Dream Gradient — Bootstrap / Manual Trigger
 *
 * Runs the full dream gradient pipeline for one or all registered agents:
 *   explorations.md → nightly blocks → dream-day → dream-week → dream-month → unit vectors
 *
 * Usage: cd src/server && npx tsx ../scripts/process-dream-gradient.ts [<slug>|all]
 * Default: all (iterates registeredAgentSlugs() per DEC-081 agent-agnostic discipline).
 *
 * Phase A Batch 3 (S155, 2026-05-10): widen agent type to string; validate
 * against registeredAgentSlugs(); 'all' iterates registry (was hardcoded
 * ['leo', 'jim']). 'both' kept as a back-compat alias for 'all'.
 */

import { processDreamGradient, parseExplorations, groupIntoNights, type AgentName } from '../server/lib/dream-gradient.js';
import { registeredAgentSlugs } from '../server/lib/agent-registry';

async function processAgent(agent: AgentName) {
    console.log(`\n=== ${agent.toUpperCase()} Dream Gradient ===\n`);

    // Show what we're working with
    const entries = parseExplorations(agent);
    const nights = groupIntoNights(entries);
    console.log(`Found ${entries.length} dream entries across ${nights.length} nights`);
    if (nights.length > 0) {
        console.log(`Date range: ${nights[0].date} to ${nights[nights.length - 1].date}\n`);
    }

    if (entries.length === 0) {
        console.log(`No explorations.md found for ${agent} — nothing to process.`);
        return;
    }

    // Run the pipeline
    const result = await processDreamGradient(agent);

    // Report
    console.log(`\n--- ${agent} Results ---`);
    console.log(`Nights processed: ${result.nightsProcessed}`);
    if (result.dayCreated.length > 0) console.log(`dream-day files created: ${result.dayCreated.join(', ')}`);
    if (result.weekCreated.length > 0) console.log(`dream-week files created: ${result.weekCreated.join(', ')}`);
    if (result.monthCreated.length > 0) console.log(`dream-month files created: ${result.monthCreated.join(', ')}`);
    if (result.uvsCreated.length > 0) console.log(`Unit vectors created: ${result.uvsCreated.join(', ')}`);
    if (result.errors.length > 0) {
        console.log(`\nErrors:`);
        result.errors.forEach(e => console.log(`  - ${e}`));
    }
    if (result.uvReviewNeeded) {
        console.log(`\n⚠️ Dream unit vectors at ${result.uvTokenCount} tokens — review needed (4K marker)`);
    }
    if (result.nightsProcessed === 0 && result.weekCreated.length === 0 && result.monthCreated.length === 0) {
        console.log('Everything up to date — nothing to process.');
    }
}

async function main() {
    const arg = process.argv[2] || 'all';
    const validSlugs = registeredAgentSlugs();
    let agents: AgentName[];

    if (arg === 'all' || arg === 'both') {
        // 'both' kept as back-compat alias; 'all' is the canonical form.
        if (validSlugs.length === 0) {
            console.error(`No agents registered in agent-registry.ts. Cannot proceed with --agent=${arg}.`);
            process.exit(1);
        }
        agents = validSlugs;
    } else if (validSlugs.includes(arg)) {
        agents = [arg];
    } else {
        const slugList = validSlugs.length > 0 ? validSlugs.join('|') : '<no-agents-registered>';
        console.error(`Usage: process-dream-gradient.ts [${slugList}|all]`);
        if (validSlugs.length > 0) {
            console.error(`Unknown agent slug: '${arg}'. Registered: ${validSlugs.join(', ')}`);
        }
        process.exit(1);
    }

    for (const agent of agents) {
        await processAgent(agent);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
