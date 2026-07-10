/**
 * service-enumerator.ts — THE manifest-derived service set (P3a of the update pipeline, S219).
 *
 * The single source for "which long-running processes does this garden run" — the cure for
 * the roster-copy family Tenshi's census named (MNT-036's hook lists, restart-all-services'
 * hand list, the update flow's stop/restart sets all derive from HERE, use-time, never a
 * baked copy). Consumers: `han update` steps 2/3/7 (stop → fd-verify → restart), the
 * restart-hooks installer (via scripts/emit-garden-services.ts), restart-all-services.sh.
 *
 * Derivation rules (today's REAL unit-name conventions — gate-4's cycle-driver collapse
 * renames the heartbeat family later; this module is the one place that mapping lives):
 *   - active resident + enabled `human-response` surface  → `human-responder@<slug>.service`
 *   - active resident + enabled `heartbeat` surface       → `<slug>-heartbeat.service`
 *   - active resident + a port allocation                 → an agent SERVER (tmux watchdog
 *     pane, NOT systemd — restart via scripts/restart-agent-server.sh <slug>)
 *   - GARDEN-WIDE singleton engine services (not per-resident, so not roster copies —
 *     but listed HERE so there is exactly one list): wm-sensor, jemma.
 *
 * DEC-081: a 4th agent gets every entry for free the moment its manifest leaves exist.
 */
import { loadResidents, allocationFor, surfaceEnabledFor } from './garden-manifest';

/** Garden-wide singleton engine units — one list, one home. */
export const SHARED_SYSTEMD_UNITS = ['wm-sensor.service', 'jemma.service'] as const;

export interface GardenServiceSet {
    /** Per-resident systemd units, derived from manifest surfaces (existing-name conventions). */
    residentUnits: string[];
    /** Garden-wide singleton units (the shared engine services). */
    sharedUnits: string[];
    /** Slugs whose agent SERVER runs under the tmux watchdog (restart-agent-server.sh <slug>). */
    agentServers: string[];
    /** Convenience: residentUnits + sharedUnits. */
    allSystemdUnits: string[];
}

export function gardenServiceSet(): GardenServiceSet {
    const residentUnits: string[] = [];
    const agentServers: string[] = [];
    for (const a of loadResidents()) {
        if (!a.active) continue;
        if (surfaceEnabledFor(a.slug, 'human-response')) residentUnits.push(`human-responder@${a.slug}.service`);
        if (surfaceEnabledFor(a.slug, 'heartbeat')) residentUnits.push(`${a.slug}-heartbeat.service`);
        if (allocationFor(a.slug)?.port) agentServers.push(a.slug);
    }
    const sharedUnits = [...SHARED_SYSTEMD_UNITS];
    return { residentUnits, sharedUnits, agentServers, allSystemdUnits: [...residentUnits, ...sharedUnits] };
}

/** The slugs a given per-resident unit family covers — the installer's consumer shape. */
export function slugsForUnitFamily(family: 'human' | 'heartbeat' | 'server'): string[] {
    const out: string[] = [];
    for (const a of loadResidents()) {
        if (!a.active) continue;
        if (family === 'human' && surfaceEnabledFor(a.slug, 'human-response')) out.push(a.slug);
        if (family === 'heartbeat' && surfaceEnabledFor(a.slug, 'heartbeat')) out.push(a.slug);
        if (family === 'server' && allocationFor(a.slug)?.port) out.push(a.slug);
    }
    return out;
}
