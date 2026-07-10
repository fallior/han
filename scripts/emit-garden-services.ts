#!/usr/bin/env tsx
/**
 * emit-garden-services.ts <human|heartbeat|server|units> — the shell bridge to the
 * service enumerator (P3a; the MNT-036 cure's consumer shape).
 *
 * Emits one item per line so bash consumers (`mapfile -t`) derive their lists from the
 * manifest at RUN time instead of carrying a hand-written roster copy:
 *   human     → slugs with an enabled human-response surface
 *   heartbeat → slugs with an enabled heartbeat surface
 *   server    → slugs whose agent server runs under the tmux watchdog
 *   units     → every systemd unit in the garden (resident + shared)
 *
 *   cd src/server && NODE_PATH=$(pwd)/node_modules npx tsx ../../scripts/emit-garden-services.ts human
 */
import { gardenServiceSet, slugsForUnitFamily } from '../src/server/lib/service-enumerator';

const kind = process.argv[2];
if (kind === 'human' || kind === 'heartbeat' || kind === 'server') {
    for (const s of slugsForUnitFamily(kind)) process.stdout.write(s + '\n');
} else if (kind === 'units') {
    for (const u of gardenServiceSet().allSystemdUnits) process.stdout.write(u + '\n');
} else {
    process.stderr.write('usage: emit-garden-services.ts <human|heartbeat|server|units>\n');
    process.exit(1);
}
