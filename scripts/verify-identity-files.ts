#!/usr/bin/env tsx
/**
 * scripts/verify-identity-files.ts
 *
 * Phase A.5 (DEC-083) — verify (and optionally re-sign) an agent's identity
 * manifest. This is the script the launchers + the supervisor cycle + the
 * heartbeat invoke at session-start.
 *
 * Default mode is option (iii) — verify-and-resign:
 *   - All files match manifest hashes              → exit 0
 *   - File set unchanged, some hashes differ       → AUTO-RESIGN, log, exit 0
 *   - File added or removed                        → halt, exit 2
 *   - Signature invalid / manifest missing / etc.  → halt, exit 1
 *
 * Strict mode (--strict) refuses the auto-resign step. Used by the manual
 * verification path where the operator wants to know *exactly* which files
 * have changed without the script doing anything about it.
 *
 * Usage:
 *   npx tsx scripts/verify-identity-files.ts --agent=leo --entry-point=hanleo
 *   npx tsx scripts/verify-identity-files.ts --agent=jim --strict
 */

import { existsSync, readFileSync } from 'fs';
import {
    DEFAULT_KEY_PATHS,
    KeyPaths,
    readSignedManifest,
    verifySignature,
    diffAgainstManifest,
    verifyAndResign,
    recentResignCount,
} from '../src/server/lib/identity-signing';

function parseArgs(): {
    agent?: string;
    entryPoint: string;
    keyPath?: string;
    pubkeyPath?: string;
    strict: boolean;
} {
    const out: {
        agent?: string;
        entryPoint: string;
        keyPath?: string;
        pubkeyPath?: string;
        strict: boolean;
    } = { entryPoint: 'verify-cli', strict: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === '--strict') out.strict = true;
        else if (arg.startsWith('--agent=')) out.agent = arg.slice('--agent='.length);
        else if (arg.startsWith('--entry-point=')) out.entryPoint = arg.slice('--entry-point='.length);
        else if (arg.startsWith('--key=')) out.keyPath = arg.slice('--key='.length);
        else if (arg.startsWith('--pubkey=')) out.pubkeyPath = arg.slice('--pubkey='.length);
    }
    return out;
}

function strictVerify(agent: string, pubkeyPath: string): number {
    if (!existsSync(pubkeyPath)) {
        process.stderr.write(`HALT: pubkey not found at ${pubkeyPath}\n`);
        return 1;
    }
    const signed = readSignedManifest(agent);
    if (!signed) {
        process.stderr.write(`HALT: no signed manifest for agent '${agent}'\n`);
        return 1;
    }
    const pubkeyPem = readFileSync(pubkeyPath, 'utf8');
    if (!verifySignature(signed, pubkeyPem)) {
        process.stderr.write(`HALT: signature INVALID for agent '${agent}'\n`);
        return 1;
    }
    const diff = diffAgainstManifest(agent, signed.manifest);
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        console.log(`OK — agent '${agent}' identity files verify cleanly against manifest signed at ${signed.manifest.signed_at}.`);
        return 0;
    }
    if (diff.removed.length > 0) {
        process.stderr.write(`HALT: file_missing for agent '${agent}':\n`);
        for (const p of diff.removed) process.stderr.write(`  - ${p}\n`);
    }
    if (diff.added.length > 0) {
        process.stderr.write(`HALT: file_added for agent '${agent}':\n`);
        for (const p of diff.added) process.stderr.write(`  + ${p}\n`);
    }
    if (diff.changed.length > 0) {
        process.stderr.write(`STRICT: file_hash_mismatch for agent '${agent}' (would auto-resign in default mode):\n`);
        for (const p of diff.changed) process.stderr.write(`  ~ ${p}\n`);
    }
    return diff.removed.length > 0 || diff.added.length > 0 ? 2 : 1;
}

function main(): number {
    const args = parseArgs();
    // ── P3d Unit-2b (gate 3, the BOOT half — Tenshi C, Jim's polarities mrmxwrnw): a dangling
    // swap journal means the garden may be HALF-SWAPPED — no wake may proceed until recovery
    // resolves (`han update --recover`). This gate is the one door every wake already passes
    // (launcher pre-flight, fed-wake step 0, interactive step 0), which is why the check lives
    // here. Polarity (i): an ABSENT ledger = no swap has ever run = clean — the genesis
    // carve-out (a fresh garden must not halt on a file that doesn't exist yet). Polarity (ii):
    // an UNREADABLE/CORRUPT ledger = HALT with a legible receipt (fail-closed — a corrupt
    // trust-root journal is the moment you want a human, not a guess). Additive to DEC-083:
    // the identity verify below is untouched.
    {
        const { checkDanglingSwap } = require('../src/server/lib/state-swap');
        const { hanHome } = require('../src/server/lib/paths');
        const path = require('path');
        const st = checkDanglingSwap(path.join(hanHome(), 'health', 'update-ledger.jsonl'));
        if (st.state === 'dangling' || st.state === 'corrupt') {
            const receipt = {
                ts: new Date().toISOString(), kind: `swap-journal-${st.state}`,
                agent: args.agent ?? null, entryPoint: args.entryPoint, detail: st.detail,
            };
            try {
                const fs = require('fs');
                const rp = path.join(hanHome(), 'health', 'integrity-failures.jsonl');
                fs.mkdirSync(path.dirname(rp), { recursive: true });
                fs.appendFileSync(rp, JSON.stringify(receipt) + '\n');
            } catch { /* the receipt is best-effort; the HALT is not */ }
            process.stderr.write(`HALT: ${st.detail}\n`);
            process.stderr.write(`No wake may proceed on a possibly half-swapped garden. Run 'han update --recover'.\n`);
            process.stderr.write(`Halt-receipt at ~/.han/health/integrity-failures.jsonl.\n`);
            return 3;
        }
    }
    if (!args.agent) {
        process.stderr.write(`Usage: verify-identity-files.ts --agent=<slug> [--entry-point=<name>] [--strict]\n`);
        return 1;
    }
    const keyPaths: KeyPaths = {
        privateKeyPath: args.keyPath ?? DEFAULT_KEY_PATHS.privateKeyPath,
        publicKeyPath: args.pubkeyPath ?? DEFAULT_KEY_PATHS.publicKeyPath,
    };

    if (args.strict) return strictVerify(args.agent, keyPaths.publicKeyPath);

    const outcome = verifyAndResign(args.agent, args.entryPoint, keyPaths);
    switch (outcome.kind) {
        case 'verified':
            console.log(`OK — agent '${args.agent}' identity files verify cleanly.`);
            return 0;
        case 'resigned': {
            console.log(`AUTO-RESIGNED — agent '${args.agent}' identity files content-changed; manifest re-signed.`);
            for (const p of outcome.changedFiles) console.log(`  ~ ${p}`);
            const recent = recentResignCount(args.agent, 24 * 60 * 60 * 1000);
            if (recent >= 5) {
                console.warn(`WARNING: ${recent} auto-resigns in the last 24h for agent '${args.agent}'. Investigate.`);
            }
            return 0;
        }
        case 'structural-change':
            process.stderr.write(`HALT: structural change for agent '${args.agent}' (file added/removed):\n`);
            for (const p of outcome.removedFiles) process.stderr.write(`  - ${p}\n`);
            for (const p of outcome.addedFiles) process.stderr.write(`  + ${p}\n`);
            process.stderr.write(`Halt-receipt at ~/.han/health/integrity-failures.jsonl. Re-sign manually if intentional.\n`);
            return 2;
        case 'invalid-signature':
            process.stderr.write(`HALT: signature INVALID for agent '${args.agent}'.\n`);
            process.stderr.write(`Halt-receipt at ~/.han/health/integrity-failures.jsonl.\n`);
            return 1;
        case 'missing-manifest':
            process.stderr.write(`HALT: no signed manifest for agent '${args.agent}'. Run sign-identity-files.ts --agent=${args.agent} to sign.\n`);
            return 1;
        case 'missing-pubkey':
            process.stderr.write(`HALT: pubkey not found at ${keyPaths.publicKeyPath}.\n`);
            return 1;
    }
}

try {
    process.exit(main());
} catch (err) {
    process.stderr.write(`verify-identity-files.ts FAILED: ${(err as Error).message}\n`);
    process.exit(1);
}
