#!/usr/bin/env tsx
/**
 * scripts/sign-identity-files.ts
 *
 * Phase A.5 (DEC-083) — sign an agent's identity-load-bearing files.
 *
 * Usage:
 *   npx tsx scripts/sign-identity-files.ts --agent=leo
 *   npx tsx scripts/sign-identity-files.ts --agent=jim --key=/path/to/key.pem
 *   npx tsx scripts/sign-identity-files.ts --generate-keypair
 *
 * The first invocation per host runs --generate-keypair to mint the gatekeeper's
 * Ed25519 signing key. Subsequent invocations sign individual agents.
 *
 * The script wraps `lib/identity-signing.ts` — all crypto + manifest logic
 * lives there. This file is the operator surface.
 */

import {
    DEFAULT_KEY_PATHS,
    generateKeypair,
    signIdentityFiles,
    KeyPaths,
} from '../src/server/lib/identity-signing';

function parseArgs(): {
    agent?: string;
    keyPath?: string;
    pubkeyPath?: string;
    generateKeypair: boolean;
} {
    const out: { agent?: string; keyPath?: string; pubkeyPath?: string; generateKeypair: boolean } = {
        generateKeypair: false,
    };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--generate-keypair') out.generateKeypair = true;
        else if (arg.startsWith('--agent=')) out.agent = arg.slice('--agent='.length);
        else if (arg.startsWith('--key=')) out.keyPath = arg.slice('--key='.length);
        else if (arg.startsWith('--pubkey=')) out.pubkeyPath = arg.slice('--pubkey='.length);
    }
    return out;
}

function main(): void {
    const args = parseArgs();
    const keyPaths: KeyPaths = {
        privateKeyPath: args.keyPath ?? DEFAULT_KEY_PATHS.privateKeyPath,
        publicKeyPath: args.pubkeyPath ?? DEFAULT_KEY_PATHS.publicKeyPath,
    };

    if (args.generateKeypair) {
        generateKeypair(keyPaths);
        console.log(`Generated Ed25519 keypair:`);
        console.log(`  private: ${keyPaths.privateKeyPath} (mode 600)`);
        console.log(`  public:  ${keyPaths.publicKeyPath} (mode 644)`);
        console.log(`\nNext: run with --agent=<slug> to sign that agent's identity files.`);
        return;
    }

    if (!args.agent) {
        process.stderr.write(`Usage: sign-identity-files.ts --agent=<slug> [--key=<path>] [--pubkey=<path>]\n`);
        process.stderr.write(`       sign-identity-files.ts --generate-keypair\n`);
        process.exit(1);
    }

    const signed = signIdentityFiles(args.agent, keyPaths);
    console.log(`Signed identity manifest for agent '${args.agent}':`);
    console.log(`  signed_at:      ${signed.manifest.signed_at}`);
    console.log(`  signing_key_id: ${signed.manifest.signing_key_id}`);
    console.log(`  files:`);
    for (const f of signed.manifest.files) {
        console.log(`    - ${f.path} (${f.size_bytes} bytes, sha256=${f.sha256.slice(0, 16)}...)`);
    }
}

try {
    main();
} catch (err) {
    process.stderr.write(`sign-identity-files.ts FAILED: ${(err as Error).message}\n`);
    process.exit(1);
}
