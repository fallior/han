/**
 * Operator CLI — ADMIT a discovered resident by garden-signing its `resident.json` (#98 P2, F3).
 *
 * Admitting a new mind is a **human act** (F3): the gatekeeper agent prepares (a resident self-
 * describes via `resident.json`, discovered + validated); the **human runs this** with the garden
 * key to vouch for it. This CLI supplies the operator confirmation + the key; the admission *act*
 * itself lives in `admitResident()` (`lib/resident-discovery.ts`), which a future
 * `POST /api/residents/:slug/admit` will wrap with operator-auth — the same function, no rewrite.
 * Every admission is logged to `~/.han/health/resident-admissions.jsonl`.
 *
 * Run: cd src/server && NODE_PATH="$(pwd)/node_modules" \
 *        npx tsx ../../scripts/sign-resident.ts --slug=<slug> [--yes] [--key=<privkey.pem>]
 */
import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { admitResident, findResidentDir } from '../src/server/lib/resident-discovery';
import { DEFAULT_KEY_PATHS } from '../src/server/lib/identity-signing';

function arg(name: string): string | undefined {
    const a = process.argv.find(x => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : undefined;
}
const slug = arg('slug');
const keyPath = arg('key') ?? DEFAULT_KEY_PATHS.privateKeyPath;
const auto = process.argv.includes('--yes');

if (!slug) {
    console.error('usage: sign-resident.ts --slug=<slug> [--yes] [--key=<privkey.pem>]');
    process.exit(2);
}

async function confirm(q: string): Promise<boolean> {
    if (auto) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(q, ans => { rl.close(); res(/^y(es)?$/i.test(ans.trim())); }));
}

async function main() {
    const found = findResidentDir(slug!);
    if (!found) {
        console.error(`No resident.json self-describing slug '${slug}' found. ` +
            `The resident must first drop its own resident.json (discovery), then you admit it.`);
        process.exit(1);
    }
    if (!existsSync(keyPath)) {
        console.error(`Garden signing key not found at ${keyPath}. Admission is a human act — run this on the operator's machine.`);
        process.exit(1);
    }

    console.log(`\n⚠  You are about to ADMIT a new mind to the garden:`);
    console.log(`     slug:        ${slug}`);
    console.log(`     displayName: ${found.fragment.displayName}`);
    console.log(`     fragment:    ${found.jsonPath}`);
    console.log(`     signing key: ${keyPath}`);
    console.log(`   This garden-signs its resident.json — extending trust. Only do this for a mind you vouch for.\n`);
    if (!(await confirm('   Admit this resident? [y/N] '))) {
        console.log('Aborted — not admitted.');
        process.exit(0);
    }

    // The act — REQUIRES the key (the human just supplied it). Same function a future endpoint calls.
    const res = admitResident(slug!, readFileSync(keyPath, 'utf8'));
    console.log(`✓ Admitted '${res.slug}' (${res.displayName}) — wrote ${res.sigPath}, logged the admission.`);
    console.log(`  (Still inert until it has a gradient config — P4. Admission is trust, not activation.)`);
}

main().catch(e => { console.error('sign-resident failed:', e); process.exit(1); });
