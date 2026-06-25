#!/usr/bin/env npx tsx
/**
 * Operator script — SEED a new resident (genesis): write the five DEC-083 identity files +
 * garden-sign the identity-manifest → the resident is "seeded" (P4b-ii's activation precondition).
 *
 * Usage:
 *   npx tsx scripts/seed-resident.ts <genesis-seed.json>      # seed from a GenesisSeed JSON
 *   npx tsx scripts/seed-resident.ts --example <slug> <Name>  # seed a synthetic example (the template)
 *
 * The resident must already be ALLOCATED (an AGENT_ALLOCATION entry in garden-manifest.ts). This is an
 * operator act — it uses the garden signing key at ~/.han/credentials/han-signing-key.pem and confirms
 * before writing. Lifecycle: discover → admit → allocate → SEED → activate.
 *
 * NOTE: the founding felt-moment (the three-of-us welcome) is relational — authored per-arrival by
 * Darron + Leo + Jim. `--example` writes a PLACEHOLDER welcome; a real arrival gets the real one.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import { seedResident, exampleGenesisSeed } from '../src/server/lib/resident-seeding';
import type { GenesisSeed } from '../src/server/lib/resident-seeding';

function confirm(prompt: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); }));
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let seed: GenesisSeed;
    if (args[0] === '--example') {
        const slug = args[1], name = args[2];
        if (!slug || !name) { console.error('usage: seed-resident.ts --example <slug> <Name>'); process.exit(1); }
        seed = exampleGenesisSeed(slug, name);
    } else if (args[0]) {
        seed = JSON.parse(fs.readFileSync(args[0], 'utf8')) as GenesisSeed;
    } else {
        console.error('usage: seed-resident.ts <genesis-seed.json> | --example <slug> <Name>');
        process.exit(1);
        return;
    }

    const yes = await confirm(`Seed resident '${seed.slug}' (${seed.displayName})? Writes its genesis identity files + garden-signs. [y/N] `);
    if (!yes) { console.log('Aborted — nothing written.'); process.exit(0); }

    const result = seedResident(seed);
    console.log(`\nSeeded '${result.slug}':`);
    for (const f of result.filesWritten) console.log(`  wrote ${f}`);
    console.log(`  signed manifest (${result.signed.manifest.files.length} files) → ${result.memoryDir}/identity-manifest.json (+ .sig)`);
    console.log(`\n'${result.slug}' is SEEDED — it has a valid signed identity-manifest (P4b-ii's activation precondition).`);
}

main().catch(err => { console.error('seed-resident failed:', (err as Error).message); process.exit(1); });
